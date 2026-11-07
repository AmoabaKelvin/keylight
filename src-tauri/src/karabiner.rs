//! Reads and edits the Karabiner-Elements config (~/.config/karabiner/karabiner.json): lists the
//! selected profile's complex modification rules, turns them on and off, installs Keylight's three
//! rules, and points their shell commands at this app's executable. Karabiner reloads the file by
//! itself when it changes.
//!
//! Every pub fn works on the real file; the `*_at` fns take the path so they can run on a copy.

use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};

/// Keylight's rules, by description. A rule with one of these descriptions counts as Keylight's.
pub const HYPER_RULE: &str = "Right Command to Hyper (ctrl+opt+cmd+shift)";
pub const SHIFTS_RULE: &str = "Both shifts together toggle Caps Lock";
pub const CAPS_RULE: &str = "Caps Lock: hold = Control, double-tap = Caps Lock";
pub const KEYLIGHT_RULES: [&str; 3] = [HYPER_RULE, SHIFTS_RULE, CAPS_RULE];

/// Over Bluetooth the NuPhy reports vendor 2007 and no product id, as a keyboard that is also a
/// pointing device. Karabiner ignores pointing devices unless told otherwise, so without this
/// entry none of the rules apply in Bluetooth mode.
const BT_VENDOR_ID: u64 = 2007;

pub fn path() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/karabiner/karabiner.json")
}

/// `{profile, rules: [{description, enabled}], installed, missing, outdated}`.
/// `installed`: karabiner.json exists. `missing`: Keylight rules not in the profile.
/// `outdated`: a Keylight rule runs an older helper (nuphyctl, caps-toggle, another Keylight
/// path) instead of `bin`; `repoint(bin)` fixes it.
pub fn rules(bin: &str) -> Result<Value, String> {
    rules_at(&path(), bin)
}

/// Turns one rule on or off. Karabiner keeps a rule with `"enabled": false` but ignores it.
pub fn set_enabled(description: &str, enabled: bool) -> Result<(), String> {
    set_enabled_at(&path(), description, enabled)
}

/// Adds whichever Keylight rules the selected profile lacks (matched by description) and returns
/// the descriptions added. Rules already there are left alone, even if they differ.
pub fn install(bin: &str) -> Result<Vec<String>, String> {
    install_at(&path(), bin)
}

/// Rewrites the shell commands in Keylight's rules that call an older helper so they call `bin`.
/// Returns how many commands changed.
pub fn repoint(bin: &str) -> Result<usize, String> {
    repoint_at(&path(), bin)
}

pub(crate) fn rules_at(path: &Path, bin: &str) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({ "profile": null, "rules": [], "installed": false, "missing": KEYLIGHT_RULES, "outdated": false }));
    }
    let mut config = read(path)?;
    let profile = selected_profile(&mut config).ok_or("no Karabiner profile")?;
    let name = profile.get("name").cloned().unwrap_or(Value::Null);
    let list = rule_list(profile);
    let rules: Vec<Value> = list
        .iter()
        .map(|r| json!({ "description": r.get("description").cloned().unwrap_or(Value::Null), "enabled": r.get("enabled") != Some(&Value::Bool(false)) }))
        .collect();
    let missing: Vec<&str> = KEYLIGHT_RULES.iter().copied().filter(|d| !list.iter().any(|r| description(r) == Some(d))).collect();
    let mut outdated = false;
    for rule in list.iter().filter(|r| is_keylight(r)) {
        each_shell_command(rule, &mut |cmd| outdated |= repointed(cmd, bin).is_some_and(|new| new != cmd));
    }
    Ok(json!({ "profile": name, "rules": rules, "installed": true, "missing": missing, "outdated": outdated }))
}

pub(crate) fn set_enabled_at(path: &Path, description: &str, enabled: bool) -> Result<(), String> {
    let mut config = read(path)?;
    let profile = selected_profile(&mut config).ok_or("no Karabiner profile")?;
    let rule = profile
        .pointer_mut("/complex_modifications/rules")
        .and_then(Value::as_array_mut)
        .and_then(|rules| rules.iter_mut().find(|r| self::description(r) == Some(description)))
        .and_then(Value::as_object_mut)
        .ok_or("rule not found")?;
    if enabled {
        rule.remove("enabled");
    } else {
        rule.insert("enabled".into(), Value::Bool(false));
    }
    write(path, &config)
}

pub(crate) fn install_at(path: &Path, bin: &str) -> Result<Vec<String>, String> {
    let mut config = read(path)?;
    let profile = selected_profile(&mut config).ok_or("no Karabiner profile")?.as_object_mut().ok_or("profile is not an object")?;
    let mut changed = ensure_bt_device(profile)?;

    let mods = profile.entry("complex_modifications").or_insert_with(|| json!({})).as_object_mut().ok_or("complex_modifications is not an object")?;
    let rules = mods.entry("rules").or_insert_with(|| json!([])).as_array_mut().ok_or("complex_modifications.rules is not an array")?;
    let mut added = Vec::new();
    for rule in keylight_rules(bin) {
        let d = description(&rule).unwrap_or_default().to_string();
        if !rules.iter().any(|r| description(r) == Some(d.as_str())) {
            rules.push(rule);
            added.push(d);
        }
    }
    changed |= !added.is_empty();
    if changed {
        write(path, &config)?;
    }
    Ok(added)
}

pub(crate) fn repoint_at(path: &Path, bin: &str) -> Result<usize, String> {
    let mut config = read(path)?;
    let profile = selected_profile(&mut config).ok_or("no Karabiner profile")?;
    let mut count = 0;
    if let Some(rules) = profile.pointer_mut("/complex_modifications/rules").and_then(Value::as_array_mut) {
        for rule in rules.iter_mut().filter(|r| is_keylight(r)) {
            each_shell_command_mut(rule, &mut |cmd| {
                if let Some(new) = repointed(cmd, bin).filter(|new| new != cmd) {
                    *cmd = new;
                    count += 1;
                }
            });
        }
    }
    if count > 0 {
        write(path, &config)?;
    }
    Ok(count)
}

/// Keylight's three rules, calling `bin`. In a `to` array Karabiner holds only the LAST event
/// while the key is down, so the shell command must come before the held modifier.
fn keylight_rules(bin: &str) -> [Value; 3] {
    let q = quote(bin);
    let hyper_on = format!("{q} hyper on");
    let hyper_off = format!("{q} hyper off");
    let caps = format!("{q} caps-toggle");
    let both_shifts = |key: &str, other: &str| {
        json!({
            "type": "basic",
            "from": { "key_code": key, "modifiers": { "mandatory": [other], "optional": ["caps_lock"] } },
            "to": [{ "shell_command": caps }]
        })
    };
    [
        json!({
            "description": HYPER_RULE,
            "manipulators": [{
                "type": "basic",
                "from": { "key_code": "right_command", "modifiers": { "optional": ["any"] } },
                "to": [
                    { "shell_command": hyper_on },
                    { "key_code": "left_shift", "modifiers": ["left_command", "left_control", "left_option"] }
                ],
                "to_after_key_up": [{ "shell_command": hyper_off }]
            }]
        }),
        json!({
            "description": SHIFTS_RULE,
            "manipulators": [both_shifts("left_shift", "right_shift"), both_shifts("right_shift", "left_shift")]
        }),
        // Double tap: the first tap sets caps_lock_tapped for 400 ms; a second press inside that
        // window toggles Caps Lock. Held, it is Control. Caps Lock goes through `caps-toggle`
        // (the HID lock state) rather than key_code caps_lock, because over Bluetooth the
        // keyboard's caps light only follows the former.
        json!({
            "description": CAPS_RULE,
            "manipulators": [
                {
                    "type": "basic",
                    "conditions": [{ "type": "variable_if", "name": "caps_lock_tapped", "value": 1 }],
                    "from": { "key_code": "caps_lock", "modifiers": { "optional": ["any"] } },
                    "to": [
                        { "set_variable": { "name": "caps_lock_tapped", "value": 0 } },
                        { "shell_command": caps }
                    ]
                },
                {
                    "type": "basic",
                    "from": { "key_code": "caps_lock", "modifiers": { "optional": ["any"] } },
                    "parameters": {
                        "basic.to_delayed_action_delay_milliseconds": 400,
                        "basic.to_if_alone_timeout_milliseconds": 400
                    },
                    "to": [{ "key_code": "left_control", "lazy": true }],
                    "to_if_alone": [{ "set_variable": { "name": "caps_lock_tapped", "value": 1 } }],
                    "to_delayed_action": {
                        "to_if_invoked": [{ "set_variable": { "name": "caps_lock_tapped", "value": 0 } }],
                        "to_if_canceled": [{ "set_variable": { "name": "caps_lock_tapped", "value": 0 } }]
                    }
                }
            ]
        }),
    ]
}

/// Adds `{vendor 2007, keyboard + pointing device, ignore: false}` to the profile's devices unless
/// an entry for that device already exists (whatever it says). Returns whether it added one.
fn ensure_bt_device(profile: &mut serde_json::Map<String, Value>) -> Result<bool, String> {
    let devices = profile.entry("devices").or_insert_with(|| json!([])).as_array_mut().ok_or("devices is not an array")?;
    let present = devices.iter().any(|d| {
        let ids = d.get("identifiers");
        ids.and_then(|i| i.get("vendor_id")).and_then(Value::as_u64) == Some(BT_VENDOR_ID)
            && ids.and_then(|i| i.get("is_pointing_device")) == Some(&Value::Bool(true))
    });
    if !present {
        devices.push(json!({
            "identifiers": { "is_keyboard": true, "is_pointing_device": true, "vendor_id": BT_VENDOR_ID },
            "ignore": false
        }));
    }
    Ok(!present)
}

/// What an older Keylight-style shell command should become with `bin`, or None if it isn't one.
/// Recognises `<nuphyctl|keylight> hyper on|off|caps-toggle` and a bare `.../caps-toggle` helper.
fn repointed(cmd: &str, bin: &str) -> Option<String> {
    let (program, rest) = first_word(cmd.trim())?;
    let name = program.rsplit('/').next().unwrap_or(&program).to_ascii_lowercase();
    let args = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    let action = match (name.as_str(), args.as_str()) {
        ("caps-toggle", "") => "caps-toggle",
        ("nuphyctl" | "keylight", "hyper on" | "hyper off" | "caps-toggle") => &args,
        _ => return None,
    };
    Some(format!("{} {action}", quote(bin)))
}

/// Splits off the first shell word, undoing single quotes, double quotes and backslashes.
fn first_word(s: &str) -> Option<(String, &str)> {
    let mut word = String::new();
    let mut chars = s.char_indices();
    let mut end = s.len();
    while let Some((i, c)) = chars.next() {
        match c {
            c if c.is_whitespace() => {
                end = i;
                break;
            }
            '\'' => loop {
                match chars.next()? {
                    (_, '\'') => break,
                    (_, c) => word.push(c),
                }
            },
            '"' => loop {
                match chars.next()? {
                    (_, '"') => break,
                    (_, '\\') => word.push(chars.next()?.1),
                    (_, c) => word.push(c),
                }
            },
            '\\' => word.push(chars.next()?.1),
            c => word.push(c),
        }
    }
    (!word.is_empty()).then(|| (word, &s[end..]))
}

/// Single-quotes a path for the shell Karabiner runs shell_command in.
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn is_keylight(rule: &Value) -> bool {
    description(rule).is_some_and(|d| KEYLIGHT_RULES.contains(&d))
}

fn description(rule: &Value) -> Option<&str> {
    rule.get("description").and_then(Value::as_str)
}

fn each_shell_command(v: &Value, f: &mut impl FnMut(&str)) {
    match v {
        Value::Object(map) => {
            for (k, v) in map {
                match (k.as_str(), v) {
                    ("shell_command", Value::String(s)) => f(s),
                    _ => each_shell_command(v, f),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|v| each_shell_command(v, f)),
        _ => {}
    }
}

fn each_shell_command_mut(v: &mut Value, f: &mut impl FnMut(&mut String)) {
    match v {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                match (k.as_str(), v) {
                    ("shell_command", Value::String(s)) => f(s),
                    (_, v) => each_shell_command_mut(v, f),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| each_shell_command_mut(v, f)),
        _ => {}
    }
}

fn rule_list(profile: &Value) -> &[Value] {
    profile.pointer("/complex_modifications/rules").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn selected_profile(config: &mut Value) -> Option<&mut Value> {
    let profiles = config.get_mut("profiles")?.as_array_mut()?;
    let index = profiles.iter().position(|p| p.get("selected") == Some(&Value::Bool(true))).unwrap_or(0);
    profiles.get_mut(index)
}

fn read(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|_| "karabiner-missing".to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("karabiner.json is not valid JSON: {e}"))
}

/// Writes pretty JSON through a temp file and a rename, so Karabiner never reads half a file.
/// Follows a symlinked karabiner.json (dotfiles) to its target, and the first time copies the
/// original to `karabiner.json.keylight-backup`.
fn write(path: &Path, config: &Value) -> Result<(), String> {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("karabiner.json");
    let backup = path.with_file_name(format!("{name}.keylight-backup"));
    if !backup.exists() && path.exists() {
        fs::copy(&path, &backup).map_err(|e| format!("backing up karabiner.json: {e}"))?;
    }
    let mut text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    text.push('\n');
    let tmp = path.with_file_name(format!("{name}.keylight-tmp"));
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}
