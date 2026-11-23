//! Role binding, end to end: a bundle binds roles, a scene declares and reads
//! them, and a scene that asks for a role the bundle lacks does not run.

use visualiser::interpretation_package::{apply_to_state, load_package};
use visualiser::visualiser::VisualiserState;

/// A small bundle with one role of every kind.
const BUNDLE: &str = r#"{
    "formatVersion": 1,
    "durationSec": 4.0,
    "signals": [
        { "name": "energy", "rate": 50.0, "values": [0.0, 0.5, 1.0, 0.5] },
        { "name": "onsetEnvelope", "rate": 50.0, "values": [0.0, 1.0, 0.0, 0.0] }
    ],
    "bandSignals": [
        { "bandId": "band-1", "label": "Bass", "feature": "energy", "rate": 50.0, "values": [0.1, 0.2] }
    ],
    "stemSignals": [
        { "stemId": "stem-drums", "label": "Drums", "feature": "energy", "rate": 50.0, "values": [0.4, 0.6] }
    ],
    "customSignals": [
        { "id": "custom-1", "name": "Swell", "rate": 25.0, "values": [0.9, 0.8] }
    ],
    "composedSignals": [
        { "name": "arc", "rate": 50.0, "values": [0.0, 1.0] }
    ],
    "eventStreams": [
        { "name": "kick", "events": [ { "time": 0.5, "weight": 1.0 }, { "time": 1.0, "weight": 0.8 } ] }
    ],
    "authoredEventStreams": [
        { "name": "sections", "events": [ { "time": 0.0, "weight": 1.0 }, { "time": 2.0, "weight": 0.6 } ] }
    ],
    "availableStems": [["stem-drums", "Drums"]],
    "roles": {
        "kick": { "events": "kick" },
        "section": { "authoredEvents": "sections" },
        "energy": { "signal": "energy" },
        "onset": { "signal": "onset" },
        "drums": { "stem": "Drums", "feature": "energy" },
        "low": { "band": "Bass", "feature": "energy" },
        "swell": { "custom": "Swell" },
        "arc": { "composed": "arc" }
    }
}"#;

fn state_with_bundle() -> (VisualiserState, visualiser::interpretation_package::LoadedPackage) {
    let package = load_package(BUNDLE).expect("the bundle parses and its roles are all bound");
    let mut state = VisualiserState::new();
    apply_to_state(&package, &mut state);
    (state, package)
}

/// Load a scene and run one frame, so `init` has been called. Returns the error, if any.
fn run(scene: &str) -> Option<String> {
    let (mut state, package) = state_with_bundle();
    if !state.load_script(scene) {
        return Some(state.get_script_error().unwrap_or("load failed without a message").to_string());
    }
    state.update(
        1.0 / 30.0,
        None,
        None,
        &package.named_signals,
        &package.band_signals,
        &package.custom_signals,
        package.musical_time.as_ref(),
    );
    state.get_script_error().map(str::to_string)
}

#[test]
fn a_scene_reads_every_kind_of_role() {
    let scene = r#"
//! roles: kick, section, energy, onset
//! roles: drums, low, swell, arc

let cube = mesh.cube();

fn init(ctx) {
    // Event roles behave as event streams...
    let pulse = roles.kick.to_signal(#{ envelope: "attack_decay", decay_beats: 0.5 });
    let turn = roles.section.to_signal();
    // ...and signal roles as signals, with the whole signal API.
    cube.scale = roles.energy.smooth.exponential(0.05, 0.3).add(pulse).add(0.5);
    cube.rotation.y = roles.onset.add(roles.drums).add(roles.low).add(roles.swell).add(roles.arc).add(turn);
    scene.add(cube);
}
"#;
    assert_eq!(run(scene), None);
}

#[test]
fn a_scene_that_needs_a_missing_role_does_not_load() {
    let scene = "//! roles: kick, vocal_presence\nfn init(ctx) { let v = roles.vocal_presence; }\n";
    let error = run(scene).expect("the scene must be refused");
    assert!(error.contains("needs the role `vocal_presence`"), "{error}");
    assert!(error.contains("does not provide"), "{error}");
    assert!(error.contains("It provides: arc, drums, energy, kick, low, onset, section, swell"), "{error}");
}

#[test]
fn a_scene_that_reads_an_undeclared_role_does_not_load() {
    let error = run("fn init(ctx) { let k = roles.kick; }\n").expect("the scene must be refused");
    assert!(error.contains("reads the role `kick` without declaring it"), "{error}");
}

#[test]
fn scenes_without_roles_still_load_on_a_bundle_with_roles() {
    let scene = "let cube = mesh.cube();\nfn init(ctx) {\n    cube.scale = inputs.mix.energy.add(0.5);\n    scene.add(cube);\n}\n";
    assert_eq!(run(scene), None);
}

#[test]
fn a_bundle_whose_role_points_at_nothing_is_rejected() {
    let broken = BUNDLE.replace(r#""kick": { "events": "kick" }"#, r#""kick": { "events": "no-such-stream" }"#);
    let error = load_package(&broken).err().expect("a dangling role is an error").to_string();
    assert!(error.contains("role `kick` is bound to event stream \"no-such-stream\""), "{error}");
    assert!(error.contains("does not contain"), "{error}");

    let bad_name = BUNDLE.replace(r#""kick": { "events": "kick" }"#, r#""Kick Drum": { "events": "kick" }"#);
    let error = load_package(&bad_name).err().expect("a bad role name is an error").to_string();
    assert!(error.contains("role name `Kick Drum` is not usable"), "{error}");
}

#[test]
fn a_bundle_without_roles_provides_none() {
    let package = load_package(r#"{ "formatVersion": 1, "durationSec": 1.0 }"#).expect("minimal package parses");
    assert!(package.roles.is_empty());
    let mut state = VisualiserState::new();
    apply_to_state(&package, &mut state);
    assert!(!state.load_script("//! roles: kick\nfn init(ctx) {}\n"));
    let error = state.get_script_error().unwrap_or_default().to_string();
    assert!(error.contains("provides no roles at all"), "{error}");
}
