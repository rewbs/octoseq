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
//!     { "start": 15.4, "script": "scenes/02-lattice.rhai" }
//! ] }
//! ```
//!
//! Script paths are relative to the show file. When a segment starts, its
//! script replaces the one running; the clock, the bundle and the feedback
//! buffer carry on, so a scene that draws over the previous frame begins on top
//! of the last scene's picture and sweeps it away.

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
        let mut segments = Vec::with_capacity(file.segments.len());
        let mut previous = -1.0_f32;
        for entry in file.segments {
            if entry.start <= previous {
                return Err(anyhow!(
                    "show segments must be in time order: {} follows {}",
                    entry.start,
                    previous
                ));
            }
            previous = entry.start;
            let script_path = if entry.script.is_absolute() {
                entry.script.clone()
            } else {
                base.join(&entry.script)
            };
            let source = std::fs::read_to_string(&script_path)
                .with_context(|| format!("failed to read scene {script_path:?} named by the show"))?;
            segments.push(ShowSegment { start: entry.start, path: script_path, source });
        }
        Ok(Self { segments })
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
}
