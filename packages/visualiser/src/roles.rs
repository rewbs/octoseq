//! Musical roles: what a scene asks for, and what an analysis bundle binds it to.
//!
//! A scene does not name signals. It declares the musical roles it needs
//! (`kick`, `energy`, `section` and so on) and reads them from the `roles`
//! namespace; the bundle says what each role is bound to. A scene written
//! against roles therefore runs on any bundle that provides them, whichever
//! analyser, stem source or tracker module the bundle came from, and a scene
//! that needs a role the bundle lacks fails when it is loaded, with a message
//! that says which role, instead of running unwired.
//!
//! A scene declares its roles in doc comments at the top of the script:
//!
//! ```rhai
//! //! roles: kick, snare, energy
//!
//! fn init(ctx) {
//!     let pulse = roles.kick.to_signal(#{ envelope: "attack_decay", decay_beats: 0.5 });
//!     let level = roles.energy.smooth.exponential(0.05, 0.3);
//! }
//! ```
//!
//! The bundle binds each role to something it already carries:
//!
//! ```json
//! "roles": {
//!   "kick":    { "events": "kick" },
//!   "section": { "authoredEvents": "sections" },
//!   "energy":  { "signal": "energy" },
//!   "bass":    { "stem": "Bass", "feature": "energy" },
//!   "low":     { "band": "Bass", "feature": "energy" }
//! }
//! ```
//!
//! This module is plain string handling with no GPU or wasm dependency, so the
//! same check runs in the native CLI and in the browser preview.

use std::collections::{BTreeMap, BTreeSet};

use regex::Regex;
use serde::Deserialize;

/// What a role is bound to. Exactly one of these shapes per role.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "RawBinding")]
pub enum RoleBinding {
    /// A named event stream (`eventStreams` in the bundle).
    Events { events: String },
    /// An authored event stream (`authoredEventStreams` in the bundle).
    AuthoredEvents { authored_events: String },
    /// One feature of a stem, by the stem's label.
    Stem { stem: String, feature: String },
    /// One feature of a frequency band of the mix, by the band's label.
    Band { band: String, feature: String },
    /// A signal of the full mix, by the name scripts know it by.
    Signal { signal: String },
    /// A custom (derived) signal, by name or id.
    Custom { custom: String },
    /// A composed signal, by name.
    Composed { composed: String },
}

/// A binding as written in the bundle, before checking it is exactly one thing.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawBinding {
    events: Option<String>,
    authored_events: Option<String>,
    stem: Option<String>,
    band: Option<String>,
    feature: Option<String>,
    signal: Option<String>,
    custom: Option<String>,
    composed: Option<String>,
}

impl TryFrom<RawBinding> for RoleBinding {
    type Error = String;

    fn try_from(raw: RawBinding) -> Result<Self, String> {
        let targets = [&raw.events, &raw.authored_events, &raw.stem, &raw.band, &raw.signal, &raw.custom, &raw.composed];
        if targets.iter().filter(|t| t.is_some()).count() != 1 {
            return Err("a role is bound to exactly one of: events, authoredEvents, stem, band, signal, custom, composed".to_string());
        }
        let needs_feature = raw.stem.is_some() || raw.band.is_some();
        match (needs_feature, raw.feature) {
            (true, Some(feature)) => Ok(match (raw.stem, raw.band) {
                (Some(stem), _) => RoleBinding::Stem { stem, feature },
                (_, Some(band)) => RoleBinding::Band { band, feature },
                _ => unreachable!("one of stem and band is set"),
            }),
            (true, None) => Err("a role bound to a stem or a band also names a `feature`, such as \"energy\"".to_string()),
            (false, Some(_)) => Err("`feature` only applies to a role bound to a stem or a band".to_string()),
            (false, None) => Ok(if let Some(events) = raw.events {
                RoleBinding::Events { events }
            } else if let Some(authored_events) = raw.authored_events {
                RoleBinding::AuthoredEvents { authored_events }
            } else if let Some(signal) = raw.signal {
                RoleBinding::Signal { signal }
            } else if let Some(custom) = raw.custom {
                RoleBinding::Custom { custom }
            } else {
                RoleBinding::Composed { composed: raw.composed.expect("exactly one target is set") }
            }),
        }
    }
}

impl RoleBinding {
    /// Whether the role gives an event stream (`true`) or a signal (`false`).
    pub fn is_events(&self) -> bool {
        matches!(self, RoleBinding::Events { .. } | RoleBinding::AuthoredEvents { .. })
    }

    /// The Rhai expression that fetches what the role is bound to.
    pub fn rhai_expr(&self) -> String {
        match self {
            RoleBinding::Events { events } => format!("__event_stream_get({})", quote(events)),
            RoleBinding::AuthoredEvents { authored_events } => {
                format!("__authored_events_get({})", quote(authored_events))
            }
            RoleBinding::Stem { stem, feature } => {
                format!("inputs.stems[{}][{}]", quote(stem), quote(feature))
            }
            RoleBinding::Band { band, feature } => {
                format!("inputs.mix.bands[{}][{}]", quote(band), quote(feature))
            }
            RoleBinding::Signal { signal } => format!("inputs.mix[{}]", quote(signal)),
            RoleBinding::Custom { custom } => format!("inputs.customSignals[{}]", quote(custom)),
            RoleBinding::Composed { composed } => {
                format!("inputs.composedSignals[{}]", quote(composed))
            }
        }
    }

    /// A short description for error messages.
    pub fn describe(&self) -> String {
        match self {
            RoleBinding::Events { events } => format!("event stream \"{events}\""),
            RoleBinding::AuthoredEvents { authored_events } => {
                format!("authored event stream \"{authored_events}\"")
            }
            RoleBinding::Stem { stem, feature } => format!("the {feature} of stem \"{stem}\""),
            RoleBinding::Band { band, feature } => format!("the {feature} of band \"{band}\""),
            RoleBinding::Signal { signal } => format!("mix signal \"{signal}\""),
            RoleBinding::Custom { custom } => format!("custom signal \"{custom}\""),
            RoleBinding::Composed { composed } => format!("composed signal \"{composed}\""),
        }
    }
}

/// A Rhai string literal for `text`.
fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Whether `name` can be a role: lower-case words joined by underscores, so that
/// `roles.<name>` is always a plain property access.
pub fn is_valid_role_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// The roles a bundle provides, by name, in name order.
pub type RoleBindings = BTreeMap<String, RoleBinding>;

/// Rhai code that defines the `roles` namespace. Runs after the `inputs`
/// namespaces in the prelude, since the bindings are written in terms of them.
pub fn generate_roles_namespace(roles: &RoleBindings) -> String {
    let mut code = String::from("let roles = #{};\nroles.__type = \"roles_namespace\";\n");
    for (name, binding) in roles {
        code.push_str(&format!("roles.{} = {};\n", name, binding.rhai_expr()));
    }
    code
}

/// The roles a scene declares, from its `//! roles: a, b` lines.
///
/// Several such lines add up. A script with none declares no roles, which is
/// right for scripts that predate roles and use `inputs` directly.
pub fn declared_roles(script: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for line in script.lines() {
        let Some(rest) = line.trim_start().strip_prefix("//!") else {
            continue;
        };
        let Some(list) = rest.trim_start().strip_prefix("roles:") else {
            continue;
        };
        for name in list.split(',') {
            let name = name.trim();
            if !name.is_empty() {
                out.insert(name.to_string());
            }
        }
    }
    out
}

/// The roles a scene actually reads: every `roles.<name>` outside a comment.
pub fn used_roles(script: &str) -> BTreeSet<String> {
    let re = Regex::new(r"\broles\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)").unwrap();
    let mut out = BTreeSet::new();
    for line in script.lines() {
        let code = line.split("//").next().unwrap_or("");
        for cap in re.captures_iter(code) {
            let name = &cap[1];
            if !name.starts_with("__") {
                out.insert(name.to_string());
            }
        }
    }
    out
}

/// Check a scene against the roles a bundle provides.
///
/// Returns the message to show if the scene cannot run: it declares a role the
/// bundle does not provide, reads one it did not declare, or declares a name
/// that cannot be a role.
pub fn check_scene(script: &str, available: &RoleBindings) -> Result<(), String> {
    let declared = declared_roles(script);
    let used = used_roles(script);

    let invalid: Vec<&String> = declared.iter().filter(|n| !is_valid_role_name(n)).collect();
    if !invalid.is_empty() {
        return Err(format!(
            "This scene declares {} that cannot be a role name: {}. Role names are lower-case words joined by underscores.",
            if invalid.len() == 1 { "a role" } else { "roles" },
            list(&invalid),
        ));
    }

    let undeclared: Vec<&String> = used.difference(&declared).collect();
    if !undeclared.is_empty() {
        return Err(format!(
            "This scene reads {} without declaring {}. Add a line such as `//! roles: {}` at the top of the script, so the scene can be matched to a bundle before it runs.",
            roles_phrase(&undeclared),
            if undeclared.len() == 1 { "it" } else { "them" },
            undeclared.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "),
        ));
    }

    let missing: Vec<&String> = declared.iter().filter(|n| !available.contains_key(*n)).collect();
    if !missing.is_empty() {
        let provided = if available.is_empty() {
            "It provides no roles at all".to_string()
        } else {
            format!(
                "It provides: {}",
                available.keys().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            )
        };
        return Err(format!(
            "This scene needs {}, which this analysis bundle does not provide. {}.",
            roles_phrase(&missing),
            provided,
        ));
    }
    Ok(())
}

fn list(names: &[&String]) -> String {
    names.iter().map(|n| format!("`{n}`")).collect::<Vec<_>>().join(", ")
}

fn roles_phrase(names: &[&String]) -> String {
    format!("the {} {}", if names.len() == 1 { "role" } else { "roles" }, list(names))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings(json: &str) -> RoleBindings {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn parses_every_binding_shape() {
        let roles = bindings(
            r#"{
                "kick": {"events": "kick"},
                "section": {"authoredEvents": "sections"},
                "bass": {"stem": "Bass", "feature": "energy"},
                "low": {"band": "Bass", "feature": "energy"},
                "energy": {"signal": "energy"},
                "swell": {"custom": "Swell"},
                "arc": {"composed": "arc"}
            }"#,
        );
        assert_eq!(roles["kick"], RoleBinding::Events { events: "kick".into() });
        assert_eq!(
            roles["section"],
            RoleBinding::AuthoredEvents { authored_events: "sections".into() }
        );
        assert!(roles["kick"].is_events() && roles["section"].is_events());
        assert!(!roles["energy"].is_events());
        assert_eq!(roles["bass"].rhai_expr(), r#"inputs.stems["Bass"]["energy"]"#);
        assert_eq!(roles["low"].rhai_expr(), r#"inputs.mix.bands["Bass"]["energy"]"#);
        assert_eq!(roles["energy"].rhai_expr(), r#"inputs.mix["energy"]"#);
        assert_eq!(roles["swell"].rhai_expr(), r#"inputs.customSignals["Swell"]"#);
        assert_eq!(roles["arc"].rhai_expr(), r#"inputs.composedSignals["arc"]"#);
    }

    #[test]
    fn rejects_a_binding_that_is_two_things_at_once() {
        let result: Result<RoleBindings, _> =
            serde_json::from_str(r#"{"kick": {"events": "kick", "signal": "energy"}}"#);
        assert!(result.is_err());
    }

    #[test]
    fn names_are_quoted_safely() {
        let binding = RoleBinding::Events { events: "a \"b\" \\ c".into() };
        assert_eq!(binding.rhai_expr(), r#"__event_stream_get("a \"b\" \\ c")"#);
    }

    #[test]
    fn namespace_lists_roles_in_name_order() {
        let roles = bindings(r#"{"kick": {"events": "kick"}, "energy": {"signal": "energy"}}"#);
        let code = generate_roles_namespace(&roles);
        let energy = code.find("roles.energy = ").unwrap();
        let kick = code.find("roles.kick = ").unwrap();
        assert!(code.starts_with("let roles = #{};"));
        assert!(energy < kick);
    }

    #[test]
    fn finds_declared_and_used_roles() {
        let script = "//! roles: kick, energy\n//! roles: section\n// roles.ignored in a comment\nfn init(ctx) {\n  let a = roles.kick; let b = roles . energy; // roles.also_ignored\n}\n";
        let declared: Vec<String> = declared_roles(script).into_iter().collect();
        let used: Vec<String> = used_roles(script).into_iter().collect();
        assert_eq!(declared, ["energy", "kick", "section"]);
        assert_eq!(used, ["energy", "kick"]);
    }

    #[test]
    fn a_scene_with_everything_it_needs_passes() {
        let roles = bindings(r#"{"kick": {"events": "kick"}, "energy": {"signal": "energy"}}"#);
        assert_eq!(check_scene("//! roles: kick\nlet k = roles.kick;", &roles), Ok(()));
        // A script that predates roles declares none and is left alone.
        assert_eq!(check_scene("let e = inputs.mix.energy;", &roles), Ok(()));
    }

    #[test]
    fn a_missing_role_is_named_along_with_what_is_provided() {
        let roles = bindings(r#"{"kick": {"events": "kick"}, "energy": {"signal": "energy"}}"#);
        let error = check_scene("//! roles: kick, hat\nlet h = roles.hat;", &roles).unwrap_err();
        assert!(error.contains("needs the role `hat`"), "{error}");
        assert!(error.contains("It provides: energy, kick"), "{error}");
        let none = check_scene("//! roles: hat", &RoleBindings::new()).unwrap_err();
        assert!(none.contains("provides no roles at all"), "{none}");
    }

    #[test]
    fn an_undeclared_role_is_an_error_even_if_the_bundle_has_it() {
        let roles = bindings(r#"{"kick": {"events": "kick"}}"#);
        let error = check_scene("let k = roles.kick;", &roles).unwrap_err();
        assert!(error.contains("reads the role `kick` without declaring it"), "{error}");
    }

    #[test]
    fn a_bad_role_name_is_an_error() {
        let error = check_scene("//! roles: Kick Drum", &RoleBindings::new()).unwrap_err();
        assert!(error.contains("cannot be a role name"), "{error}");
        assert!(is_valid_role_name("section_progress") && !is_valid_role_name("2nd"));
    }
}
