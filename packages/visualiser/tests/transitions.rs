//! Two scenes running side by side, as they do during a transition, must not
//! disturb each other.

use std::collections::HashMap;

use visualiser::visualiser::VisualiserState;

const TRAILS: &str = r#"
fn init(ctx) {
    let fb = feedback.builder()
        .warp.affine(1.0, 0.0, 0.0, 0.05)
        .color.decay(0.9)
        .blend.over()
        .opacity(1.0)
        .build();
    feedback.enable(fb);
}
"#;

const SPIRAL: &str = r#"
fn init(ctx) {
    let fb = feedback.builder()
        .warp.spiral(0.4, 0.02)
        .color.decay(0.5)
        .blend.add()
        .opacity(0.25)
        .build();
    feedback.enable(fb);
}
"#;

const PLAIN: &str = "fn init(ctx) {}";

fn step(state: &mut VisualiserState) {
    state.update(1.0 / 30.0, None, None, &HashMap::new(), &HashMap::new(), &HashMap::new(), None);
    assert_eq!(state.get_script_error(), None);
}

/// (enabled, decay, opacity, wants a transparent scene)
fn feedback_of(state: &VisualiserState) -> (bool, f32, f32, bool) {
    let config = state.feedback_config();
    let uniforms = state.feedback_uniforms();
    (config.enabled, uniforms.color_steps[0].decay_rate, uniforms.opacity, config.wants_transparent_scene())
}

#[test]
fn each_scene_keeps_its_own_feedback_while_another_runs() {
    let mut old = VisualiserState::new();
    assert!(old.load_script(TRAILS));
    step(&mut old);
    step(&mut old);
    assert_eq!(feedback_of(&old), (true, 0.9, 1.0, true));

    // A second scene is loaded and starts running beside the first, as at the
    // start of a transition. Loading it must not switch the first one's feedback
    // off, and its own setting must not replace the first one's.
    let mut new = VisualiserState::new();
    assert!(new.load_script(SPIRAL));
    for _ in 0..3 {
        step(&mut old);
        step(&mut new);
        assert_eq!(feedback_of(&old), (true, 0.9, 1.0, true));
        assert_eq!(feedback_of(&new), (true, 0.5, 0.25, false));
    }
}

#[test]
fn a_scene_without_feedback_does_not_pick_up_another_scenes() {
    let mut old = VisualiserState::new();
    assert!(old.load_script(TRAILS));
    step(&mut old);

    let mut new = VisualiserState::new();
    assert!(new.load_script(PLAIN));
    for _ in 0..3 {
        step(&mut old);
        step(&mut new);
        assert!(feedback_of(&old).0, "the first scene still has its feedback");
        assert!(!feedback_of(&new).0, "the scene that asked for none has none");
    }
}
