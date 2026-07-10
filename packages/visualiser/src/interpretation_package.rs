//! Interpretation Package v1 loading.
//!
//! The package is the wasm push contract, serialized: one JSON file exported by
//! the web app (`docs/design/phase3-interpretation-package.md`) and ingested by
//! the native CLI so the same script sees the same inputs in both environments.
//!
//! This module mirrors the storage performed by the `wasm.rs` push functions
//! exactly:
//!
//! - `push_signal`               -> [`LoadedPackage::named_signals`] keyed by name
//! - `push_band_signal`          -> [`LoadedPackage::band_signals`] dual-keyed by
//!   band id AND label (when they differ), sharing one `Rc` per signal, plus
//!   [`LoadedPackage::band_id_to_label`]
//! - `push_custom_signal`        -> [`LoadedPackage::custom_signals`] dual-keyed by
//!   id AND name (when they differ), plus [`LoadedPackage::custom_signal_id_to_label`]
//! - `push_composed_signal`      -> applied via `VisualiserState::push_composed_signal`
//!   (keyed by name only)
//! - `push_stem_signal`          -> applied via `VisualiserState::push_stem_signal`
//!   (which dual-keys by stem id AND label internally)
//! - `push_event_stream`         -> `event_rhai::store_named_event_stream`
//! - `push_authored_event_stream`-> `event_rhai::store_authored_event_stream`
//! - `push_band_events`          -> `event_rhai::store_band_event_stream` (band id only)
//! - `set_musical_time`          -> [`LoadedPackage::musical_time`] (passed to
//!   `VisualiserState::update` each frame)
//! - `set_frequency_bands`       -> [`LoadedPackage::frequency_bands`] (in the
//!   browser this only backs query APIs like `get_band_bounds_at`; it is never
//!   passed to `VisualiserState::update`, so scripts do not see it — we parse and
//!   retain it for parity but apply nothing)
//! - `set_available_stems`       -> `VisualiserState::set_available_stems`
//! - `load_script` preamble      -> `set_available_signals` / `set_available_bands`
//!   / `set_available_custom_signals` / `set_available_composed_signals`
//!   (see [`apply_to_state`])
//!
//! This module is wasm-agnostic: it has no wasm-bindgen dependency and compiles
//! for both native and wasm targets.

use std::collections::HashMap;
use std::rc::Rc;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::event_rhai::{
    clear_authored_event_streams, clear_band_event_streams, clear_named_event_streams,
    store_authored_event_stream, store_band_event_stream, store_named_event_stream,
};
use crate::event_stream::{Event, EventStream, PickEventsOptions};
use crate::frequency_band::FrequencyBandStructure;
use crate::input::{BandSignalMap, InputSignal, SharedSignal, SignalMap};
use crate::musical_time::MusicalTimeStructure;
use crate::visualiser::VisualiserState;

/// The package format version this loader understands.
pub const SUPPORTED_FORMAT_VERSION: u64 = 1;

// === Serde mirror of the InterpretationPackageV1 JSON schema ===
//
// Field names match docs/design/phase3-interpretation-package.md exactly.
// Unknown fields are ignored (serde's default). Collections default to empty so
// a sparse package is equivalent to "nothing pushed", matching the push contract.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InterpretationPackageV1 {
    #[allow(dead_code)] // validated up front via VersionProbe
    format_version: u64,
    /// Informational only.
    created_at: Option<String>,
    project_name: Option<String>,
    duration_sec: f32,
    script: Option<String>,
    #[serde(default)]
    signals: Vec<PackageSignal>,
    #[serde(default)]
    band_signals: Vec<PackageBandSignal>,
    #[serde(default)]
    stem_signals: Vec<PackageStemSignal>,
    #[serde(default)]
    custom_signals: Vec<PackageCustomSignal>,
    #[serde(default)]
    composed_signals: Vec<PackageSignal>,
    #[serde(default)]
    event_streams: Vec<PackageEventStream>,
    #[serde(default)]
    authored_event_streams: Vec<PackageEventStream>,
    #[serde(default)]
    band_events: Vec<PackageBandEvents>,
    musical_time: Option<MusicalTimeStructure>,
    frequency_bands: Option<FrequencyBandStructure>,
    #[serde(default)]
    available_stems: Vec<(String, String)>,
}

#[derive(Debug, Deserialize)]
struct PackageSignal {
    name: String,
    rate: f32,
    values: Vec<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageBandSignal {
    band_id: String,
    label: String,
    feature: String,
    rate: f32,
    values: Vec<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageStemSignal {
    stem_id: String,
    label: String,
    feature: String,
    rate: f32,
    values: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct PackageCustomSignal {
    id: String,
    name: String,
    rate: f32,
    values: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct PackageEventStream {
    name: String,
    events: Vec<PackageEvent>,
}

/// Matches the `EventInput` element shape the wasm push functions parse:
/// snake_case, with optional beat metadata (band events typically carry only
/// `time` + `weight`, which is accepted here too).
#[derive(Debug, Deserialize)]
struct PackageEvent {
    time: f32,
    weight: f32,
    beat_position: Option<f32>,
    beat_phase: Option<f32>,
    cluster_id: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageBandEvents {
    band_id: String,
    events: Vec<PackageEvent>,
}

/// A stem-scoped signal ready to be applied via `VisualiserState::push_stem_signal`
/// (which performs the id/label dual-keying itself, exactly as the wasm layer does).
pub struct LoadedStemSignal {
    pub stem_id: String,
    pub label: String,
    pub feature: String,
    pub signal: SharedSignal,
}

/// An interpretation package parsed into the runtime shapes the visualiser consumes.
///
/// The signal maps and `musical_time` are per-frame inputs: pass them to
/// `VisualiserState::update` on every frame. Everything that lives on the state
/// or in the `event_rhai` thread-local stores is applied once via [`apply_to_state`].
pub struct LoadedPackage {
    /// The active Rhai script, if the package embeds one.
    pub script: Option<String>,
    /// Default render duration in seconds.
    pub duration_sec: f32,
    pub project_name: Option<String>,
    /// Informational only.
    pub created_at: Option<String>,
    /// Named signals, keyed by name (mirrors `push_signal`).
    pub named_signals: SignalMap,
    /// Band signals, keyed by BOTH band id and label when they differ
    /// (mirrors `push_band_signal`); the inner map is keyed by feature.
    pub band_signals: BandSignalMap,
    /// Band id -> label (mirrors the wasm context's `band_id_to_label`, used to
    /// derive the `inputs.bands` script namespace).
    pub band_id_to_label: HashMap<String, String>,
    /// Custom signals, keyed by BOTH id and name when they differ
    /// (mirrors `push_custom_signal`).
    pub custom_signals: SignalMap,
    /// Custom signal id -> name (mirrors `custom_signal_id_to_label`).
    pub custom_signal_id_to_label: HashMap<String, String>,
    /// Composed signals, keyed by name (mirrors `push_composed_signal`); applied
    /// to the state via `VisualiserState::push_composed_signal` in
    /// [`apply_to_state`], exactly like stem signals.
    pub composed_signals: SignalMap,
    /// Stem signals to apply via `VisualiserState::push_stem_signal`.
    pub stem_signals: Vec<LoadedStemSignal>,
    /// (id, label) pairs for `VisualiserState::set_available_stems`.
    pub available_stems: Vec<(String, String)>,
    /// Named event streams (mirrors `push_event_stream`).
    pub event_streams: Vec<(String, EventStream)>,
    /// Authored event streams (mirrors `push_authored_event_stream`).
    pub authored_event_streams: Vec<(String, EventStream)>,
    /// Band event streams keyed by band id (mirrors `push_band_events`).
    pub band_event_streams: Vec<(String, EventStream)>,
    /// Musical time structure (mirrors `set_musical_time`); pass to
    /// `VisualiserState::update` each frame.
    pub musical_time: Option<MusicalTimeStructure>,
    /// Frequency band structure (mirrors `set_frequency_bands`). In the browser
    /// this only backs query APIs and never reaches `VisualiserState::update`,
    /// so nothing applies it — retained for parity and future use.
    pub frequency_bands: Option<FrequencyBandStructure>,
}

impl LoadedPackage {
    /// Signal names for `VisualiserState::set_available_signals`, computed
    /// exactly as the wasm `load_script` preamble does: the named signal keys
    /// plus the core `time` / `dt` / `amplitude` / `flux` names, sorted, deduped.
    pub fn available_signal_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.named_signals.keys().cloned().collect();
        names.extend(
            ["time", "dt", "amplitude", "flux"]
                .into_iter()
                .map(|s| s.to_string()),
        );
        names.sort();
        names.dedup();
        names
    }

    /// (id, label) pairs for `VisualiserState::set_available_bands`, sorted by
    /// label then id, exactly as the wasm `load_script` preamble does.
    pub fn available_bands(&self) -> Vec<(String, String)> {
        let mut bands: Vec<(String, String)> = self
            .band_id_to_label
            .iter()
            .map(|(id, label)| (id.clone(), label.clone()))
            .collect();
        bands.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        bands
    }

    /// (id, name) pairs for `VisualiserState::set_available_custom_signals`,
    /// sorted by name then id, exactly as the wasm `load_script` preamble does.
    pub fn available_custom_signals(&self) -> Vec<(String, String)> {
        let mut signals: Vec<(String, String)> = self
            .custom_signal_id_to_label
            .iter()
            .map(|(id, label)| (id.clone(), label.clone()))
            .collect();
        signals.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        signals
    }

    /// (id, label) pairs for `VisualiserState::set_available_composed_signals`,
    /// sorted by name. Composed signals are keyed by name only, so id and label
    /// are both the name — exactly the `[name, name]` pairs VisualiserPanel sends
    /// to the wasm `set_available_composed_signals`.
    pub fn available_composed_signals(&self) -> Vec<(String, String)> {
        let mut signals: Vec<(String, String)> = self
            .composed_signals
            .keys()
            .map(|name| (name.clone(), name.clone()))
            .collect();
        signals.sort();
        signals
    }

    /// The legacy rotation/amplitude signal to pass as `rotation_signal` to
    /// `VisualiserState::update`.
    ///
    /// In the browser, `rotation_signal` is only set by the legacy
    /// `push_rotation_data` / `push_data` calls, which VisualiserPanel no longer
    /// makes; the modern push layer supplies `amplitude` as a *named* signal,
    /// which takes precedence inside `update()` (the rotation-derived value is
    /// only used when `named_signals` has no `amplitude` entry). Passing the
    /// package's `amplitude` signal here keeps parity with the legacy CLI
    /// `--input` path while producing the exact same sampled values the browser
    /// sees.
    pub fn rotation_signal(&self) -> Option<SharedSignal> {
        self.named_signals.get("amplitude").cloned()
    }
}

/// Convert package events into runtime [`Event`]s with the given source tag,
/// matching the conversion performed by the wasm push functions.
fn events_from_package(events: &[PackageEvent], source: &str) -> Vec<Event> {
    events
        .iter()
        .map(|e| Event {
            time: e.time,
            weight: e.weight,
            beat_position: e.beat_position,
            beat_phase: e.beat_phase,
            cluster_id: e.cluster_id,
            source: Some(source.to_string()),
        })
        .collect()
}

/// Parse an Interpretation Package v1 JSON string into runtime shapes.
///
/// Unknown fields are ignored; a `formatVersion` other than
/// [`SUPPORTED_FORMAT_VERSION`] is a hard error.
pub fn load_package(json: &str) -> Result<LoadedPackage> {
    // Probe the version first so version mismatches produce a clear error even
    // if a future format also changed field shapes.
    #[derive(Deserialize)]
    struct VersionProbe {
        #[serde(rename = "formatVersion")]
        format_version: u64,
    }

    let probe: VersionProbe = serde_json::from_str(json).context(
        "failed to parse interpretation package JSON \
         (expected an object with a numeric `formatVersion` field)",
    )?;
    if probe.format_version != SUPPORTED_FORMAT_VERSION {
        return Err(anyhow!(
            "unsupported interpretation package formatVersion: {} (this build supports version {})",
            probe.format_version,
            SUPPORTED_FORMAT_VERSION
        ));
    }

    let pkg: InterpretationPackageV1 = serde_json::from_str(json)
        .context("failed to parse interpretation package (formatVersion 1)")?;

    // Named signals — mirrors wasm `push_signal`.
    let mut named_signals: SignalMap = HashMap::new();
    for s in pkg.signals {
        named_signals.insert(s.name, Rc::new(InputSignal::new(s.values, s.rate)));
    }

    // Band signals — mirrors wasm `push_band_signal`: one Rc per signal stored
    // under the band id and, when different, also under the label.
    let mut band_signals: BandSignalMap = HashMap::new();
    let mut band_id_to_label: HashMap<String, String> = HashMap::new();
    for s in pkg.band_signals {
        let signal: SharedSignal = Rc::new(InputSignal::new(s.values, s.rate));

        band_signals
            .entry(s.band_id.clone())
            .or_default()
            .insert(s.feature.clone(), Rc::clone(&signal));
        band_id_to_label.insert(s.band_id.clone(), s.label.clone());

        if s.label != s.band_id {
            band_signals
                .entry(s.label)
                .or_default()
                .insert(s.feature, signal);
        }
    }

    // Custom signals — mirrors wasm `push_custom_signal`: stored under the id
    // and, when different, also under the name (the user-visible label).
    let mut custom_signals: SignalMap = HashMap::new();
    let mut custom_signal_id_to_label: HashMap<String, String> = HashMap::new();
    for s in pkg.custom_signals {
        let signal: SharedSignal = Rc::new(InputSignal::new(s.values, s.rate));

        custom_signals.insert(s.id.clone(), Rc::clone(&signal));
        custom_signal_id_to_label.insert(s.id.clone(), s.name.clone());

        if s.name != s.id {
            custom_signals.insert(s.name, signal);
        }
    }

    // Composed signals — mirrors wasm `push_composed_signal`: keyed by name only.
    let mut composed_signals: SignalMap = HashMap::new();
    for s in pkg.composed_signals {
        composed_signals.insert(s.name, Rc::new(InputSignal::new(s.values, s.rate)));
    }

    // Stem signals — kept as raw entries; `VisualiserState::push_stem_signal`
    // performs the dual-keyed storage when applied.
    let stem_signals: Vec<LoadedStemSignal> = pkg
        .stem_signals
        .into_iter()
        .map(|s| LoadedStemSignal {
            stem_id: s.stem_id,
            label: s.label,
            feature: s.feature,
            signal: Rc::new(InputSignal::new(s.values, s.rate)),
        })
        .collect();

    // Named event streams — mirrors wasm `push_event_stream`:
    // source = name, description = "events:{name}".
    let event_streams: Vec<(String, EventStream)> = pkg
        .event_streams
        .iter()
        .map(|es| {
            let events = events_from_package(&es.events, &es.name);
            let stream = EventStream::new(
                events,
                format!("events:{}", es.name),
                PickEventsOptions::default(),
            );
            (es.name.clone(), stream)
        })
        .collect();

    // Authored event streams — mirrors wasm `push_authored_event_stream`:
    // source = "authored:{name}", description = "authored:{name}".
    let authored_event_streams: Vec<(String, EventStream)> = pkg
        .authored_event_streams
        .iter()
        .map(|es| {
            let source = format!("authored:{}", es.name);
            let events = events_from_package(&es.events, &source);
            let stream = EventStream::new(events, source, PickEventsOptions::default());
            (es.name.clone(), stream)
        })
        .collect();

    // Band event streams — mirrors wasm `push_band_events`:
    // source = "band:{band_id}", description = "band_events:{band_id}",
    // stored under the band id only (no label dual-keying for events).
    let band_event_streams: Vec<(String, EventStream)> = pkg
        .band_events
        .iter()
        .map(|be| {
            let events = events_from_package(&be.events, &format!("band:{}", be.band_id));
            let stream = EventStream::new(
                events,
                format!("band_events:{}", be.band_id),
                PickEventsOptions::default(),
            );
            (be.band_id.clone(), stream)
        })
        .collect();

    Ok(LoadedPackage {
        script: pkg.script,
        duration_sec: pkg.duration_sec,
        project_name: pkg.project_name,
        created_at: pkg.created_at,
        named_signals,
        band_signals,
        band_id_to_label,
        custom_signals,
        custom_signal_id_to_label,
        composed_signals,
        stem_signals,
        available_stems: pkg.available_stems,
        event_streams,
        authored_event_streams,
        band_event_streams,
        musical_time: pkg.musical_time,
        frequency_bands: pkg.frequency_bands,
    })
}

/// Apply the state-resident parts of a loaded package to a [`VisualiserState`],
/// mirroring the wasm push layer:
///
/// - stem signals     -> `VisualiserState::push_stem_signal` (dual-keyed id + label)
/// - composed signals -> `VisualiserState::push_composed_signal` (keyed by name)
/// - available stems  -> `VisualiserState::set_available_stems`
/// - event streams    -> the `event_rhai` thread-local stores (named / authored / band)
/// - script env       -> `set_available_signals` / `set_available_bands` /
///   `set_available_custom_signals` / `set_available_composed_signals`, exactly
///   as the wasm `load_script` preamble / VisualiserPanel do
///
/// Existing stem signals, composed signals, and event streams are cleared first
/// so repeated applications (e.g. sequential batch jobs) behave like a fresh
/// browser session.
///
/// The per-frame inputs (named / band / custom signal maps and `musical_time`)
/// stay on the [`LoadedPackage`] and must be passed to `VisualiserState::update`
/// every frame. Call this before `VisualiserState::load_script`.
pub fn apply_to_state(pkg: &LoadedPackage, state: &mut VisualiserState) {
    // Reset any state-resident inputs from a previous package.
    state.clear_stem_signals();
    state.clear_composed_signals();
    clear_named_event_streams();
    clear_authored_event_streams();
    clear_band_event_streams();

    for stem in &pkg.stem_signals {
        state.push_stem_signal(
            &stem.stem_id,
            &stem.label,
            &stem.feature,
            Rc::clone(&stem.signal),
        );
    }
    state.set_available_stems(pkg.available_stems.clone());

    for (name, signal) in &pkg.composed_signals {
        state.push_composed_signal(name, Rc::clone(signal));
    }

    for (name, stream) in &pkg.event_streams {
        store_named_event_stream(name.clone(), stream.clone());
    }
    for (name, stream) in &pkg.authored_event_streams {
        store_authored_event_stream(name.clone(), stream.clone());
    }
    for (band_id, stream) in &pkg.band_event_streams {
        store_band_event_stream(band_id.clone(), stream.clone());
    }

    // Script environment configuration, mirroring the wasm `load_script` preamble.
    state.set_available_signals(pkg.available_signal_names());
    state.set_available_bands(pkg.available_bands());
    state.set_available_custom_signals(pkg.available_custom_signals());
    state.set_available_composed_signals(pkg.available_composed_signals());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_rhai::{
        get_authored_event_stream, get_band_event_stream, get_named_event_stream,
    };

    /// A package exercising every section of the schema, including dual keying
    /// (band label != id, custom name != id) and single keying (label == id).
    const HAPPY_PACKAGE: &str = r#"{
        "formatVersion": 1,
        "createdAt": "2026-06-01T00:00:00Z",
        "projectName": "Test Project",
        "durationSec": 12.5,
        "script": "// noop",
        "unknownTopLevelField": { "ignored": true },
        "signals": [
            { "name": "energy", "rate": 50.0, "values": [0.0, 0.5, 1.0], "unknown": 1 },
            { "name": "amplitude", "rate": 200.0, "values": [0.1, 0.2] }
        ],
        "bandSignals": [
            { "bandId": "band-1", "label": "Bass", "feature": "energy", "rate": 50.0, "values": [0.1, 0.2] },
            { "bandId": "band-1", "label": "Bass", "feature": "onset", "rate": 50.0, "values": [0.3, 0.4] },
            { "bandId": "band-2", "label": "band-2", "feature": "energy", "rate": 50.0, "values": [0.5] }
        ],
        "stemSignals": [
            { "stemId": "stem-1", "label": "Drums", "feature": "energy", "rate": 50.0, "values": [0.4] }
        ],
        "customSignals": [
            { "id": "custom-1", "name": "My Signal", "rate": 25.0, "values": [0.9, 0.8] }
        ],
        "composedSignals": [
            { "name": "buildup", "rate": 50.0, "values": [0.0, 1.0] },
            { "name": "Intensity", "rate": 25.0, "values": [0.5] }
        ],
        "eventStreams": [
            { "name": "beatCandidates", "events": [
                { "time": 0.5, "weight": 1.0, "beat_position": 1.0, "beat_phase": 0.0, "cluster_id": 2 }
            ] }
        ],
        "authoredEventStreams": [
            { "name": "drops", "events": [ { "time": 2.0, "weight": 0.8 } ] }
        ],
        "bandEvents": [
            { "bandId": "band-1", "events": [ { "time": 1.0, "weight": 0.7 } ] }
        ],
        "musicalTime": {
            "version": 1,
            "segments": [{
                "id": "seg-1",
                "bpm": 128.0,
                "phaseOffset": 0.25,
                "startTime": 0.0,
                "endTime": 12.5,
                "confidence": 0.9,
                "provenance": {
                    "source": "test",
                    "sourceHypothesisId": null,
                    "promotedAt": "2026-06-01T00:00:00Z",
                    "userNudge": null
                }
            }],
            "createdAt": "2026-06-01T00:00:00Z",
            "modifiedAt": "2026-06-01T00:00:00Z"
        },
        "frequencyBands": {
            "version": 1,
            "bands": [{
                "id": "band-1",
                "label": "Bass",
                "enabled": true,
                "timeScope": { "kind": "global" },
                "frequencyShape": [{
                    "startTime": 0.0,
                    "endTime": 12.5,
                    "lowHzStart": 20.0,
                    "highHzStart": 150.0,
                    "lowHzEnd": 20.0,
                    "highHzEnd": 150.0
                }],
                "sortOrder": 0,
                "provenance": {
                    "source": "manual",
                    "createdAt": "2026-06-01T00:00:00Z",
                    "presetName": null
                }
            }],
            "createdAt": "2026-06-01T00:00:00Z",
            "modifiedAt": "2026-06-01T00:00:00Z"
        },
        "availableStems": [ ["stem-1", "Drums"] ]
    }"#;

    #[test]
    fn parses_happy_path_package() {
        let pkg = load_package(HAPPY_PACKAGE).expect("happy path package parses");

        assert_eq!(pkg.script.as_deref(), Some("// noop"));
        assert!((pkg.duration_sec - 12.5).abs() < f32::EPSILON);
        assert_eq!(pkg.project_name.as_deref(), Some("Test Project"));

        // Named signals keyed by name; duration derives from len / rate.
        assert_eq!(pkg.named_signals.len(), 2);
        let energy = pkg.named_signals.get("energy").expect("energy signal");
        assert!((energy.get_duration() - 3.0 / 50.0).abs() < 1e-6);
        assert!(pkg.named_signals.contains_key("amplitude"));

        // Band signals dual-keyed by id AND label (when they differ), sharing one Rc.
        assert_eq!(pkg.band_signals.len(), 3); // band-1, Bass, band-2
        let by_id = pkg.band_signals.get("band-1").expect("band-1 by id");
        let by_label = pkg.band_signals.get("Bass").expect("band-1 by label");
        assert_eq!(by_id.len(), 2); // energy + onset
        assert_eq!(by_label.len(), 2);
        assert!(Rc::ptr_eq(
            by_id.get("energy").expect("energy under id"),
            by_label.get("energy").expect("energy under label"),
        ));
        // label == id stores a single key.
        assert!(pkg.band_signals.contains_key("band-2"));
        assert_eq!(
            pkg.band_id_to_label.get("band-1").map(String::as_str),
            Some("Bass")
        );
        assert_eq!(
            pkg.band_id_to_label.get("band-2").map(String::as_str),
            Some("band-2")
        );

        // Custom signals dual-keyed by id AND name, sharing one Rc.
        assert_eq!(pkg.custom_signals.len(), 2);
        assert!(Rc::ptr_eq(
            pkg.custom_signals.get("custom-1").expect("by id"),
            pkg.custom_signals.get("My Signal").expect("by name"),
        ));
        assert_eq!(
            pkg.custom_signal_id_to_label
                .get("custom-1")
                .map(String::as_str),
            Some("My Signal")
        );

        // Composed signals keyed by name; duration derives from len / rate.
        assert_eq!(pkg.composed_signals.len(), 2);
        let buildup = pkg.composed_signals.get("buildup").expect("buildup signal");
        assert!((buildup.get_duration() - 2.0 / 50.0).abs() < 1e-6);
        let intensity = pkg
            .composed_signals
            .get("Intensity")
            .expect("Intensity signal");
        assert!((intensity.get_duration() - 1.0 / 25.0).abs() < 1e-6);

        // Stem signals kept as raw entries for VisualiserState::push_stem_signal.
        assert_eq!(pkg.stem_signals.len(), 1);
        assert_eq!(pkg.stem_signals[0].stem_id, "stem-1");
        assert_eq!(pkg.stem_signals[0].label, "Drums");
        assert_eq!(pkg.stem_signals[0].feature, "energy");
        assert_eq!(
            pkg.available_stems,
            vec![("stem-1".to_string(), "Drums".to_string())]
        );

        // Named event streams: source = name, description = "events:{name}".
        assert_eq!(pkg.event_streams.len(), 1);
        let (name, stream) = &pkg.event_streams[0];
        assert_eq!(name, "beatCandidates");
        assert_eq!(stream.source_description, "events:beatCandidates");
        assert_eq!(stream.len(), 1);
        let event = stream.get(0).expect("event present");
        assert_eq!(event.source.as_deref(), Some("beatCandidates"));
        assert_eq!(event.beat_position, Some(1.0));
        assert_eq!(event.beat_phase, Some(0.0));
        assert_eq!(event.cluster_id, Some(2));

        // Authored streams: source and description = "authored:{name}".
        let (name, stream) = &pkg.authored_event_streams[0];
        assert_eq!(name, "drops");
        assert_eq!(stream.source_description, "authored:drops");
        let event = stream.get(0).expect("event present");
        assert_eq!(event.source.as_deref(), Some("authored:drops"));
        assert_eq!(event.beat_position, None);
        assert_eq!(event.cluster_id, None);

        // Band events: keyed by band id only, source "band:{id}", desc "band_events:{id}".
        let (band_id, stream) = &pkg.band_event_streams[0];
        assert_eq!(band_id, "band-1");
        assert_eq!(stream.source_description, "band_events:band-1");
        assert_eq!(
            stream.get(0).and_then(|e| e.source.as_deref()),
            Some("band:band-1")
        );

        // Musical time and frequency bands parsed as their runtime structures.
        let musical_time = pkg.musical_time.as_ref().expect("musical time");
        assert_eq!(musical_time.segments.len(), 1);
        assert!((musical_time.segments[0].bpm - 128.0).abs() < f32::EPSILON);
        let bands = pkg.frequency_bands.as_ref().expect("frequency bands");
        assert_eq!(bands.bands.len(), 1);
        assert_eq!(bands.bands[0].label, "Bass");
    }

    #[test]
    fn script_environment_mirrors_wasm_load_script() {
        let pkg = load_package(HAPPY_PACKAGE).expect("happy path package parses");

        // Named keys + core names, sorted and deduped ("amplitude" appears once).
        assert_eq!(
            pkg.available_signal_names(),
            vec!["amplitude", "dt", "energy", "flux", "time"]
        );

        // Sorted by label then id ("Bass" sorts before "band-2").
        assert_eq!(
            pkg.available_bands(),
            vec![
                ("band-1".to_string(), "Bass".to_string()),
                ("band-2".to_string(), "band-2".to_string()),
            ]
        );

        assert_eq!(
            pkg.available_custom_signals(),
            vec![("custom-1".to_string(), "My Signal".to_string())]
        );

        // Composed signals advertise [name, name] pairs, sorted by name -
        // exactly what VisualiserPanel sends to set_available_composed_signals.
        assert_eq!(
            pkg.available_composed_signals(),
            vec![
                ("Intensity".to_string(), "Intensity".to_string()),
                ("buildup".to_string(), "buildup".to_string()),
            ]
        );

        // The rotation/amplitude signal is the package's named "amplitude".
        let rotation = pkg.rotation_signal().expect("amplitude present");
        assert!(Rc::ptr_eq(
            &rotation,
            pkg.named_signals.get("amplitude").expect("amplitude"),
        ));
    }

    #[test]
    fn apply_to_state_populates_event_stores_and_clears_previous() {
        let pkg = load_package(HAPPY_PACKAGE).expect("happy path package parses");
        let mut state = VisualiserState::new();

        apply_to_state(&pkg, &mut state);

        let named = get_named_event_stream("beatCandidates").expect("named stream stored");
        assert_eq!(named.len(), 1);
        assert!(get_authored_event_stream("drops").is_some());
        assert!(get_band_event_stream("band-1").is_some());

        // Composed signals land in the state, keyed by name, sharing the
        // package's Rc (so rates/durations match the parsed signals).
        assert_eq!(state.composed_signals().len(), 2);
        let buildup = state
            .composed_signals()
            .get("buildup")
            .expect("buildup composed signal in state");
        assert!((buildup.get_duration() - 2.0 / 50.0).abs() < 1e-6);
        assert!(Rc::ptr_eq(
            buildup,
            pkg.composed_signals
                .get("buildup")
                .expect("buildup in package"),
        ));
        let intensity = state
            .composed_signals()
            .get("Intensity")
            .expect("Intensity composed signal in state");
        assert!((intensity.get_duration() - 1.0 / 25.0).abs() < 1e-6);

        // Applying an empty package clears everything from the previous one.
        let empty = load_package(r#"{ "formatVersion": 1, "durationSec": 1.0 }"#)
            .expect("minimal package parses");
        apply_to_state(&empty, &mut state);
        assert!(get_named_event_stream("beatCandidates").is_none());
        assert!(get_authored_event_stream("drops").is_none());
        assert!(get_band_event_stream("band-1").is_none());
        assert!(state.composed_signals().is_empty());
    }

    #[test]
    fn rejects_unsupported_format_version() {
        let err = load_package(r#"{ "formatVersion": 2, "durationSec": 1.0 }"#)
            .err()
            .expect("version 2 must be rejected");
        let message = err.to_string();
        assert!(
            message.contains("formatVersion: 2"),
            "error should name the bad version, got: {message}"
        );
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(load_package("{ not json").is_err());
        assert!(load_package("[1, 2, 3]").is_err());
        // Missing formatVersion entirely.
        assert!(load_package(r#"{ "durationSec": 1.0 }"#).is_err());
    }

    #[test]
    fn accepts_empty_collections_and_nulls() {
        let json = r#"{
            "formatVersion": 1,
            "createdAt": "2026-06-01T00:00:00Z",
            "durationSec": 3.0,
            "script": null,
            "signals": [],
            "bandSignals": [],
            "stemSignals": [],
            "customSignals": [],
            "composedSignals": [],
            "eventStreams": [],
            "authoredEventStreams": [],
            "bandEvents": [],
            "musicalTime": null,
            "frequencyBands": null,
            "availableStems": []
        }"#;

        let pkg = load_package(json).expect("empty package parses");
        assert!(pkg.script.is_none());
        assert!((pkg.duration_sec - 3.0).abs() < f32::EPSILON);
        assert!(pkg.named_signals.is_empty());
        assert!(pkg.band_signals.is_empty());
        assert!(pkg.custom_signals.is_empty());
        assert!(pkg.composed_signals.is_empty());
        assert!(pkg.stem_signals.is_empty());
        assert!(pkg.event_streams.is_empty());
        assert!(pkg.authored_event_streams.is_empty());
        assert!(pkg.band_event_streams.is_empty());
        assert!(pkg.musical_time.is_none());
        assert!(pkg.frequency_bands.is_none());
        assert!(pkg.available_stems.is_empty());
        // Core signal names are still advertised to the script engine.
        assert_eq!(
            pkg.available_signal_names(),
            vec!["amplitude", "dt", "flux", "time"]
        );
    }

    #[test]
    fn accepts_sparse_package_with_missing_collections() {
        // Absent collections behave exactly like "nothing pushed".
        let pkg = load_package(r#"{ "formatVersion": 1, "durationSec": 2.0 }"#)
            .expect("sparse package parses");
        assert!(pkg.named_signals.is_empty());
        assert!(pkg.rotation_signal().is_none());
        assert!(pkg.available_bands().is_empty());
    }
}
