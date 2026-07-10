use std::collections::HashMap;
use std::rc::Rc;

use visualiser::input::{BandSignalMap, InputSignal, SignalMap};
use visualiser::scripting::ScriptEngine;

const DEFAULT_SCRIPTS_SOURCE: &str =
    include_str!("../../../apps/web/src/lib/scripting/defaultScripts.ts");

fn default_script() -> &'static str {
    let (_, script_and_rest) = DEFAULT_SCRIPTS_SOURCE
        .split_once("export const DEFAULT_SCRIPT = `")
        .expect("DEFAULT_SCRIPT template literal should exist");
    let (script, _) = script_and_rest
        .split_once("`;\n\nexport const BASIC_AUDIO_SCRIPT")
        .expect("DEFAULT_SCRIPT template literal should precede BASIC_AUDIO_SCRIPT");
    script
}

#[test]
fn web_default_script_loads_and_initializes() {
    let mut engine = ScriptEngine::new();
    engine.set_available_signals(
        [
            "time",
            "dt",
            "amplitude",
            "flux",
            "rms",
            "energy",
            "centroid",
            "onset",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    );

    assert!(
        engine.load_script(default_script()),
        "default web script should load: {:?}",
        engine.last_error
    );

    engine.call_init();

    assert!(
        engine.last_error.is_none(),
        "default web script should initialize: {:?}",
        engine.last_error
    );

    let mut input_signals = SignalMap::new();
    for name in ["energy", "onset", "flux", "rms"] {
        input_signals.insert(
            name.to_string(),
            Rc::new(InputSignal::new(vec![0.5; 100], 100.0)),
        );
    }
    let frame_inputs = HashMap::from([
        ("time".to_string(), 0.5),
        ("dt".to_string(), 0.016),
        ("amplitude".to_string(), 0.5),
        ("flux".to_string(), 0.5),
    ]);
    let band_signals = BandSignalMap::new();
    let stem_signals = BandSignalMap::new();
    let custom_signals = SignalMap::new();
    let composed_signals = SignalMap::new();

    engine.update(
        0.5,
        0.016,
        &frame_inputs,
        &input_signals,
        &band_signals,
        &stem_signals,
        &custom_signals,
        &composed_signals,
        None,
    );

    assert_eq!(engine.scene_graph.scene_entities().count(), 4);
}
