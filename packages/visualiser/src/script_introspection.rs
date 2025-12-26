//! In-script introspection helpers.
//!
//! These functions are intentionally powered by the host-defined Script API
//! metadata, not by Rhai reflection or heuristics. They provide script authors
//! a way to discover the available host API at runtime:
//! - `describe(x)` -> Map (JSON-like)
//! - `help(x)` -> String
//! - `doc("Type.member")` -> Map (JSON-like)

use std::collections::HashMap;

use rhai::{Array, Dynamic, Engine, ImmutableString, Map};

use crate::script_api::{script_api_metadata, ApiGlobal, ApiMethod, ApiProperty, ApiType};
use crate::{event_stream::EventStream, signal::Signal};

fn build_type_index(types: &[ApiType]) -> HashMap<&str, &ApiType> {
    types.iter().map(|t| (t.name.as_str(), t)).collect()
}

fn build_global_index(globals: &[ApiGlobal]) -> HashMap<&str, &ApiGlobal> {
    globals.iter().map(|g| (g.name.as_str(), g)).collect()
}

fn api_property_to_map(p: &ApiProperty) -> Map {
    let mut m = Map::new();
    m.insert("name".into(), Dynamic::from(p.name.clone()));
    m.insert("type".into(), Dynamic::from(p.type_name.clone()));
    m.insert("description".into(), Dynamic::from(p.description.clone()));
    m.insert("readonly".into(), Dynamic::from(p.readonly));
    m.insert("optional".into(), Dynamic::from(p.optional));
    m
}

fn api_method_to_map(method: &ApiMethod) -> Map {
    let mut m = Map::new();
    m.insert("name".into(), Dynamic::from(method.name.clone()));
    m.insert("description".into(), Dynamic::from(method.description.clone()));

    let mut params = Array::new();
    for p in &method.params {
        let mut pm = Map::new();
        pm.insert("name".into(), Dynamic::from(p.name.clone()));
        pm.insert("type".into(), Dynamic::from(p.type_name.clone()));
        pm.insert("description".into(), Dynamic::from(p.description.clone()));
        pm.insert("optional".into(), Dynamic::from(p.optional));
        if let Some(default) = &p.default {
            pm.insert("default".into(), Dynamic::from(default.to_string()));
        }
        params.push(Dynamic::from(pm));
    }
    m.insert("params".into(), Dynamic::from(params));

    m.insert("returns".into(), Dynamic::from(method.returns.clone()));
    if let Some(example) = &method.example {
        m.insert("example".into(), Dynamic::from(example.clone()));
    }
    if let Some(notes) = &method.notes {
        m.insert("notes".into(), Dynamic::from(notes.clone()));
    }
    if let Some(overload_id) = &method.overload_id {
        m.insert("overload_id".into(), Dynamic::from(overload_id.clone()));
    }
    m
}

fn api_type_to_map(t: &ApiType) -> Map {
    let mut m = Map::new();
    m.insert("name".into(), Dynamic::from(t.name.clone()));
    m.insert("kind".into(), Dynamic::from(format!("{:?}", t.kind)));
    m.insert("description".into(), Dynamic::from(t.description.clone()));

    let mut props = Array::new();
    for p in &t.properties {
        props.push(Dynamic::from(api_property_to_map(p)));
    }
    m.insert("properties".into(), Dynamic::from(props));

    let mut methods = Array::new();
    for method in &t.methods {
        methods.push(Dynamic::from(api_method_to_map(method)));
    }
    m.insert("methods".into(), Dynamic::from(methods));

    m
}

fn api_global_to_map(g: &ApiGlobal) -> Map {
    let mut m = Map::new();
    m.insert("name".into(), Dynamic::from(g.name.clone()));
    m.insert("kind".into(), Dynamic::from(format!("{:?}", g.kind)));
    m.insert("type".into(), Dynamic::from(g.type_name.clone()));
    m.insert("description".into(), Dynamic::from(g.description.clone()));
    m
}

fn describe_type_name(type_name: &str, types: &HashMap<&str, &ApiType>) -> Map {
    if let Some(t) = types.get(type_name) {
        let mut m = api_type_to_map(t);
        m.insert("kind".into(), Dynamic::from("type"));
        return m;
    }

    // Fallback for unknown types
    let mut m = Map::new();
    m.insert("kind".into(), Dynamic::from("unknown"));
    m.insert("name".into(), Dynamic::from(type_name.to_string()));
    m
}

fn infer_host_type_name(value: &Dynamic) -> Option<&'static str> {
    if value.is::<Signal>() {
        return Some("Signal");
    }
    if value.is::<EventStream>() {
        return Some("EventStream");
    }

    // Maps are used for namespaces and entities; we tag host-defined ones with __type.
    if value.is_map() {
        if let Some(map) = value.clone().try_cast::<Map>() {
            if let Some(t) = map.get("__type") {
                if let Ok(s) = t.clone().into_immutable_string() {
                    return Some(match s.as_str() {
                        "mesh_namespace" => "Mesh",
                        "line_namespace" => "Line",
                        "scene_namespace" => "Scene",
                        "log_namespace" => "Log",
                        "dbg_namespace" => "Dbg",
                        "gen_namespace" => "Gen",
                        "inputs_signals" => "InputsSignals",
                        "bands_namespace" => "Bands",
                        "band_signals" => "BandSignals",
                        "mesh_cube" | "mesh_plane" => "MeshEntity",
                        "line_strip" => "LineStripEntity",
                        _ => return None,
                    });
                }
            }
        }
    }

    None
}

fn help_for_type(t: &ApiType) -> String {
    let mut out = String::new();
    out.push_str(&format!("{}\n\n{}\n", t.name, t.description));

    if !t.properties.is_empty() {
        out.push_str("\nProperties:\n");
        for p in &t.properties {
            out.push_str(&format!(
                "- {}: {}{}\n",
                p.name,
                p.type_name,
                if p.optional { " (optional)" } else { "" }
            ));
        }
    }

    if !t.methods.is_empty() {
        out.push_str("\nMethods:\n");
        for m in &t.methods {
            let params = m
                .params
                .iter()
                .map(|p| format!("{}: {}", p.name, p.type_name))
                .collect::<Vec<_>>()
                .join(", ");
            out.push_str(&format!("- {}({}) -> {}\n", m.name, params, m.returns));
        }
    }

    out
}

fn doc_lookup(path: &str, types: &HashMap<&str, &ApiType>, globals: &HashMap<&str, &ApiGlobal>) -> Map {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        let mut m = Map::new();
        m.insert("kind".into(), Dynamic::from("error"));
        m.insert("message".into(), Dynamic::from("doc() requires a non-empty string"));
        return m;
    }

    // Type.member
    if let Some((type_name, member)) = trimmed.split_once('.') {
        if let Some(t) = types.get(type_name.trim()) {
            // Property match
            if let Some(p) = t.properties.iter().find(|p| p.name == member.trim()) {
                let mut m = Map::new();
                m.insert("kind".into(), Dynamic::from("property"));
                m.insert("type".into(), Dynamic::from(t.name.clone()));
                m.insert("property".into(), Dynamic::from(api_property_to_map(p)));
                return m;
            }
            // Method match (may have overloads)
            let matches: Vec<&ApiMethod> = t
                .methods
                .iter()
                .filter(|m| m.name == member.trim())
                .collect();
            if !matches.is_empty() {
                let mut m = Map::new();
                m.insert("kind".into(), Dynamic::from("method"));
                m.insert("type".into(), Dynamic::from(t.name.clone()));
                let mut overloads = Array::new();
                for mm in matches {
                    overloads.push(Dynamic::from(api_method_to_map(mm)));
                }
                m.insert("overloads".into(), Dynamic::from(overloads));
                return m;
            }
        }
    }

    // Global identifier
    if let Some(g) = globals.get(trimmed) {
        let mut m = api_global_to_map(g);
        m.insert("kind".into(), Dynamic::from("global"));
        return m;
    }

    // Type by name
    if let Some(t) = types.get(trimmed) {
        let mut m = api_type_to_map(t);
        m.insert("kind".into(), Dynamic::from("type"));
        return m;
    }

    let mut m = Map::new();
    m.insert("kind".into(), Dynamic::from("not_found"));
    m.insert("query".into(), Dynamic::from(trimmed.to_string()));
    m.insert(
        "message".into(),
        Dynamic::from("No docs found. Try doc(\"Type.method\") or doc(\"Type\")."),
    );
    m
}

pub fn register_introspection_api(engine: &mut Engine) {
    // describe(x) -> Map
    engine.register_fn("describe", |value: Dynamic| -> Map {
        let api = script_api_metadata();
        let type_index = build_type_index(&api.types);
        let global_index = build_global_index(&api.globals);

        // Convenience: describe("Type.method") routes to doc lookup.
        if let Ok(s) = value.clone().into_immutable_string() {
            return doc_lookup(s.as_str(), &type_index, &global_index);
        }

        if let Some(type_name) = infer_host_type_name(&value) {
            return describe_type_name(type_name, &type_index);
        }

        // Basic fallback for primitives and unknown maps.
        let mut m = Map::new();
        m.insert("kind".into(), Dynamic::from("value"));
        m.insert("type".into(), Dynamic::from(value.type_name()));

        if value.is_map() {
            if let Some(map) = value.clone().try_cast::<Map>() {
                let mut keys = Array::new();
                for (k, _v) in map.iter() {
                    keys.push(Dynamic::from(k.clone()));
                }
                m.insert("keys".into(), Dynamic::from(keys));
            }
        }

        m
    });

    // doc("Type.member") -> Map
    engine.register_fn("doc", |path: ImmutableString| -> Map {
        let api = script_api_metadata();
        let type_index = build_type_index(&api.types);
        let global_index = build_global_index(&api.globals);
        doc_lookup(path.as_str(), &type_index, &global_index)
    });

    // help(x) -> string
    engine.register_fn("help", |value: Dynamic| -> ImmutableString {
        let api = script_api_metadata();
        let type_index = build_type_index(&api.types);

        if let Ok(s) = value.clone().into_immutable_string() {
            // help("Type") behaves like doc("Type") but formatted.
            if let Some(t) = type_index.get(s.as_str()) {
                return ImmutableString::from(help_for_type(t));
            }
            return s;
        }

        if let Some(type_name) = infer_host_type_name(&value) {
            if let Some(t) = type_index.get(type_name) {
                return ImmutableString::from(help_for_type(t));
            }
        }

        ImmutableString::from(format!("{} (no host docs)", value.type_name()))
    });
}
