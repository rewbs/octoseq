//! A show: which scene plays when.
//!
//! A show file is the director's output in the form the renderer reads: a list
//! of segments, each a start time and the scene script that takes over at that
//! moment. The scripts are read when the show is loaded, so a render uses
//! exactly the scenes the show names, as they were then.
//!
//! ```json
//! { "segments": [
//!     { "start": 0.0,  "script": "scenes/01-pulse.rhai" },
//!     { "start": 15.4, "script": "scenes/02-lattice.rhai", "transition": 2.0 }
//! ] }
//! ```
//!
//! Script paths are relative to the show file. When a segment starts, its
//! script replaces the one running; the clock, the bundle and the feedback
//! buffer carry on, so a scene that draws over the previous frame begins on top
//! of the last scene's picture and sweeps it away.
//!
//! A segment with a `transition` blends in over that many seconds instead of
//! cutting. From its start both scenes run and draw; the picture and the
//! feedback warp field move from the old scene's to the new one's, and when the
//! time is up the old scene is dropped. A transition must be over before the
//! next segment starts.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ShowFile {
    segments: Vec<SegmentEntry>,
}

#[derive(Debug, Deserialize)]
struct SegmentEntry {
    start: f32,
    script: PathBuf,
    #[serde(default)]
    transition: f32,
}

/// One stretch of a show, with its scene's source already read.
#[derive(Debug, Clone)]
pub struct ShowSegment {
    /// When this scene takes over, in seconds from the start of the track.
    pub start: f32,
    /// Where the script came from (for messages).
    pub path: PathBuf,
    /// The script's source.
    pub source: String,
    /// How long this scene takes to blend in over the one before, in seconds.
    /// 0 is a cut.
    pub transition: f32,
}

/// A loaded show: segments in time order, the first starting at zero.
#[derive(Debug, Clone)]
pub struct Show {
    pub segments: Vec<ShowSegment>,
}

impl Show {
    /// Read a show file and every script it names.
    pub fn load(path: &Path) -> Result<Self> {
        let json = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read show file {path:?}"))?;
        let base = path.parent().unwrap_or_else(|| Path::new("."));
        Self::parse(&json, base)
    }

    /// Parse show JSON, reading scripts relative to `base`.
    pub fn parse(json: &str, base: &Path) -> Result<Self> {
        let file: ShowFile = serde_json::from_str(json).context("failed to parse show file")?;
        if file.segments.is_empty() {
            return Err(anyhow!("a show needs at least one segment"));
        }
        if file.segments[0].start.abs() > 1e-6 {
            return Err(anyhow!(
                "the first segment of a show must start at 0, not {}",
                file.segments[0].start
            ));
        }
        if file.segments[0].transition != 0.0 {
            return Err(anyhow!("the first segment of a show has nothing to blend in from"));
        }
        let mut segments: Vec<ShowSegment> = Vec::with_capacity(file.segments.len());
        let mut previous = -1.0_f32;
        for entry in file.segments {
            if entry.start <= previous {
                return Err(anyhow!(
                    "show segments must be in time order: {} follows {}",
                    entry.start,
                    previous
                ));
            }
            if !(entry.transition >= 0.0) {
                return Err(anyhow!(
                    "a transition cannot take {} seconds (segment at {})",
                    entry.transition,
                    entry.start
                ));
            }
            if let Some(before) = segments.last() {
                if before.transition > 0.0 && before.start + before.transition > entry.start + 1e-6 {
                    return Err(anyhow!(
                        "the transition into the segment at {} takes {} s and is not over when the next segment starts at {}",
                        before.start,
                        before.transition,
                        entry.start
                    ));
                }
            }
            previous = entry.start;
            let script_path = if entry.script.is_absolute() {
                entry.script.clone()
            } else {
                base.join(&entry.script)
            };
            let source = std::fs::read_to_string(&script_path)
                .with_context(|| format!("failed to read scene {script_path:?} named by the show"))?;
            segments.push(ShowSegment {
                start: entry.start,
                path: script_path,
                source,
                transition: entry.transition,
            });
        }
        Ok(Self { segments })
    }

    /// During a transition, how much of the picture still belongs to the scene
    /// before segment `index`: 1 at the segment's start, easing to 0 when its
    /// transition is over. `None` when `time` is outside that transition.
    pub fn outgoing_share(&self, index: usize, time: f32) -> Option<f32> {
        let segment = &self.segments[index];
        if index == 0 || segment.transition <= 0.0 {
            return None;
        }
        let progress = (time - segment.start) / segment.transition;
        if !(0.0..1.0).contains(&progress) {
            return None;
        }
        // Ease in and out, so the change neither starts nor stops with a jolt.
        let eased = progress * progress * (3.0 - 2.0 * progress);
        Some(1.0 - eased)
    }

    /// The index of the segment playing at `time`.
    pub fn segment_at(&self, time: f32) -> usize {
        self.segments.iter().rposition(|s| s.start <= time + 1e-6).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory holding two tiny scenes. Removed when dropped.
    struct SceneDir(PathBuf);

    impl SceneDir {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for SceneDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scene_dir() -> SceneDir {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "octoseq-show-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.rhai"), "// a").unwrap();
        std::fs::write(dir.join("b.rhai"), "// b").unwrap();
        SceneDir(dir)
    }

    #[test]
    fn loads_segments_and_their_scripts() {
        let dir = scene_dir();
        let show = Show::parse(
            r#"{"segments": [{"start": 0.0, "script": "a.rhai"}, {"start": 8.5, "script": "b.rhai"}]}"#,
            dir.path(),
        )
        .unwrap();
        assert_eq!(show.segments.len(), 2);
        assert_eq!(show.segments[1].source, "// b");
        assert_eq!(show.segment_at(0.0), 0);
        assert_eq!(show.segment_at(8.49), 0);
        assert_eq!(show.segment_at(8.5), 1);
        assert_eq!(show.segment_at(100.0), 1);
    }

    #[test]
    fn rejects_shows_that_cannot_be_played() {
        let dir = scene_dir();
        let late = Show::parse(r#"{"segments": [{"start": 2.0, "script": "a.rhai"}]}"#, dir.path());
        assert!(late.unwrap_err().to_string().contains("must start at 0"));
        let unordered = Show::parse(
            r#"{"segments": [{"start": 0.0, "script": "a.rhai"}, {"start": 0.0, "script": "b.rhai"}]}"#,
            dir.path(),
        );
        assert!(unordered.unwrap_err().to_string().contains("time order"));
        let missing = Show::parse(r#"{"segments": [{"start": 0.0, "script": "nope.rhai"}]}"#, dir.path());
        assert!(missing.unwrap_err().to_string().contains("named by the show"));
        assert!(Show::parse(r#"{"segments": []}"#, dir.path()).is_err());
    }

    #[test]
    fn a_transition_eases_from_the_old_scene_to_the_new() {
        let dir = scene_dir();
        let show = Show::parse(
            r#"{"segments": [{"start": 0.0, "script": "a.rhai"}, {"start": 8.0, "script": "b.rhai", "transition": 2.0}, {"start": 12.0, "script": "a.rhai"}]}"#,
            dir.path(),
        )
        .unwrap();
        assert_eq!(show.segments[1].transition, 2.0);
        assert_eq!(show.outgoing_share(1, 7.9), None);
        assert_eq!(show.outgoing_share(1, 8.0), Some(1.0));
        assert_eq!(show.outgoing_share(1, 9.0), Some(0.5));
        let late = show.outgoing_share(1, 9.9).unwrap();
        assert!(late > 0.0 && late < 0.02);
        assert_eq!(show.outgoing_share(1, 10.0), None);
        // A cut has no transition, and neither has the first scene.
        assert_eq!(show.outgoing_share(2, 12.0), None);
        assert_eq!(show.outgoing_share(0, 0.0), None);
    }

    #[test]
    fn rejects_transitions_that_cannot_be_played() {
        let dir = scene_dir();
        let first = Show::parse(r#"{"segments": [{"start": 0.0, "script": "a.rhai", "transition": 1.0}]}"#, dir.path());
        assert!(first.unwrap_err().to_string().contains("nothing to blend in from"));
        let overlapping = Show::parse(
            r#"{"segments": [{"start": 0.0, "script": "a.rhai"}, {"start": 4.0, "script": "b.rhai", "transition": 3.0}, {"start": 6.0, "script": "a.rhai"}]}"#,
            dir.path(),
        );
        assert!(overlapping.unwrap_err().to_string().contains("is not over when the next segment starts"));
        let negative = Show::parse(
            r#"{"segments": [{"start": 0.0, "script": "a.rhai"}, {"start": 4.0, "script": "b.rhai", "transition": -1.0}]}"#,
            dir.path(),
        );
        assert!(negative.unwrap_err().to_string().contains("cannot take"));
    }
}
