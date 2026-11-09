//! Keeps the keyboard's lights in sync with what Keylight is asked for.
//!
//! Layers, bottom to top: the theme (base), the user's shapes, a preview (unsaved), and while
//! Hyper is held, only the keys with Hyper shortcuts. Only LEDs that changed are written, side
//! light writes are rate-limited, and there is no software animation, because we don't know
//! whether the keyboard writes every change to flash.

use crate::hid::{self, Keyboard};
use crate::layout::{Layout, MAX_KEY_LEDS};
use hidapi::HidApi;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

const CUSTOM_MODE: u8 = 21;
const SHAPE_MODE: u8 = 22;
const OFF: Rgb = [0, 0, 0];
const STRIPES: [Rgb; 6] = [[255, 0, 0], [255, 90, 0], [255, 200, 0], [0, 220, 60], [0, 90, 255], [150, 0, 255]];
/// The firmware heart (shape 0) by key, for the frame shown in the app; JIS has KANA where ANSI has Right ⌘.
const HEART: [&str; 20] = ["8", "9", "-", "=", "u", "i", "o", "p", "[", "]", "j", "k", "l", ";", "'", ",", ".", "/", "rcmd", "kana"];
const HYPER_MODS: i64 = 6912; // Carbon ⌃⌥⇧⌘
const PREVIEW_TTL: Duration = Duration::from_secs(20);
const SIDE_MIN_INTERVAL: Duration = Duration::from_millis(750);

type Rgb = [u8; 3];
type Leds = BTreeMap<u8, Rgb>;

/// macOS (Carbon) virtual key code -> key name, for reading app hotkeys.
fn carbon_key(code: i64) -> Option<&'static str> {
    Some(match code {
        0 => "a", 1 => "s", 2 => "d", 3 => "f", 4 => "h", 5 => "g", 6 => "z", 7 => "x", 8 => "c", 9 => "v", 11 => "b",
        12 => "q", 13 => "w", 14 => "e", 15 => "r", 16 => "y", 17 => "t", 18 => "1", 19 => "2", 20 => "3", 21 => "4",
        22 => "6", 23 => "5", 24 => "=", 25 => "9", 26 => "7", 27 => "-", 28 => "8", 29 => "0", 30 => "]", 31 => "o",
        32 => "u", 33 => "[", 34 => "i", 35 => "p", 36 => "enter", 37 => "l", 38 => "j", 39 => "'", 40 => "k",
        41 => ";", 42 => "\\", 43 => ",", 44 => "/", 45 => "n", 46 => "m", 47 => ".", 48 => "tab", 49 => "space",
        50 => "`", 51 => "bksp", 53 => "esc", 115 => "home", 116 => "pgup", 119 => "end", 121 => "pgdn",
        122 => "f1", 120 => "f2", 99 => "f3", 118 => "f4", 96 => "f5", 97 => "f6", 98 => "f7", 100 => "f8",
        101 => "f9", 109 => "f10", 103 => "f11", 111 => "f12", 123 => "left", 124 => "right", 125 => "down", 126 => "up",
        _ => return None,
    })
}

fn rgb(v: Option<&Value>, default: Rgb) -> Rgb {
    match v.and_then(Value::as_array) {
        Some(a) if a.len() >= 3 => [0, 1, 2].map(|i| a[i].as_f64().unwrap_or(0.0).clamp(0.0, 255.0) as u8),
        _ => default,
    }
}

fn int(v: Option<&Value>, default: i64) -> i64 {
    v.and_then(|v| v.as_f64()).map(|f| f as i64).unwrap_or(default)
}

/// Fully saturated colour around the wheel, t in 0..1 (as Python's colorsys does it).
fn hue(t: f64) -> Rgb {
    let h = t * 0.83;
    let i = (h * 6.0).floor();
    let f = h * 6.0 - i;
    let q = 1.0 - f;
    let c = match (i as i64).rem_euclid(6) {
        0 => [1.0, f, 0.0],
        1 => [q, 1.0, 0.0],
        2 => [0.0, 1.0, f],
        3 => [0.0, q, 1.0],
        4 => [f, 0.0, 1.0],
        _ => [1.0, 0.0, q],
    };
    c.map(|v| (v * 255.0) as u8)
}

#[derive(Clone, PartialEq)]
enum Main {
    Custom,
    Firmware(Vec<u8>, Option<Vec<u8>>),
}

struct Layer {
    name: String,
    leds: Leds,
    visible: bool,
}

pub struct Engine {
    api: Option<HidApi>,
    kb: Option<Keyboard>,
    mode: u8,
    sent: HashMap<u8, Rgb>,
    side_sent: Option<[u8; 6]>,
    side_last: Option<Instant>,
    main_sent: Option<Main>,
    last_error: Option<String>,
    device: Map<String, Value>,
    pub hyper: bool,
    base: Map<String, Value>,
    layers: Vec<Layer>,
    side: Map<String, Value>,
    hyper_style: Map<String, Value>,
    /// Keys the user marked as Hyper keys themselves (for people without Tinycast).
    extra_hyper: BTreeSet<String>,
    preview: Option<(Leds, Instant)>,
    hyper_keys: BTreeSet<String>,
    hyper_map: BTreeMap<String, String>,
    /// Set from the Device page when the PID doesn't say the right layout.
    layout_override: Option<Layout>,
    /// The last layout a connected keyboard reported, kept for when none is plugged in.
    last_layout: Option<Layout>,
    tinycast_mtime: Option<SystemTime>,
    writes: u64,
    path: PathBuf,
}

pub type Shared = Arc<Mutex<Engine>>;

fn tinycast_plist() -> PathBuf {
    crate::home().join("Library/Preferences/com.tinycast.app.plist")
}

impl Engine {
    pub fn new(path: PathBuf) -> Engine {
        let mut e = Engine {
            api: HidApi::new().ok(),
            kb: None,
            mode: 0,
            sent: HashMap::new(),
            side_sent: None,
            side_last: None,
            main_sent: None,
            last_error: None,
            device: Map::new(),
            hyper: false,
            base: json!({ "name": "solid", "color": [255, 170, 110], "level": 100 }).as_object().unwrap().clone(),
            layers: Vec::new(),
            side: json!({ "mode": 2, "brightness": 25, "speed": 2, "color": [255, 255, 255] }).as_object().unwrap().clone(),
            hyper_style: json!({ "bound": [0, 230, 255], "key": [180, 0, 255] }).as_object().unwrap().clone(),
            extra_hyper: BTreeSet::new(),
            preview: None,
            hyper_keys: BTreeSet::new(),
            hyper_map: BTreeMap::new(),
            layout_override: None,
            last_layout: None,
            tinycast_mtime: None,
            writes: 0,
            path,
        };
        e.load();
        e.load_hyper_keys(true);
        e
    }

    // ---- persistence ----------------------------------------------------------------

    fn load(&mut self) {
        let Ok(text) = std::fs::read_to_string(&self.path) else { return };
        let Ok(d) = serde_json::from_str::<Value>(&text) else { return };
        if let Some(b) = d.get("base").and_then(Value::as_object) {
            self.base = b.clone();
        }
        let hidden: BTreeSet<String> = d.get("hidden").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
        // Layers are saved as an ordered list; older files (nuphyd) used an object.
        let layers: Vec<(String, &Value)> = match d.get("layers").or(d.get("status")) {
            Some(Value::Array(a)) => a.iter().filter_map(|l| Some((l.get("name")?.as_str()?.to_string(), l.get("leds")?))).collect(),
            Some(Value::Object(o)) => o.iter().map(|(k, v)| (k.clone(), v)).collect(),
            _ => vec![],
        };
        self.layers = layers
            .into_iter()
            .map(|(name, leds)| Layer { visible: !hidden.contains(&name), leds: parse_leds(leds), name })
            .collect();
        for (key, target) in [("side", &mut self.side), ("hyper_style", &mut self.hyper_style)] {
            if let Some(o) = d.get(key).and_then(Value::as_object) {
                target.extend(o.clone());
            }
        }
        if let Some(a) = d.get("extra_hyper").and_then(Value::as_array) {
            self.extra_hyper = a.iter().filter_map(|v| v.as_str().map(String::from)).collect();
        }
        self.layout_override = d.get("layout_override").and_then(Value::as_str).and_then(Layout::from_name);
        self.last_layout = d.get("last_layout").and_then(Value::as_str).and_then(Layout::from_name);
    }

    /// The layout to map keys and LEDs for: the override, else the keyboard's, else the last one seen, else ANSI.
    fn layout(&self) -> Layout {
        let detected = self.device.get("layout").and_then(Value::as_str).and_then(Layout::from_name);
        self.layout_override.or(detected).or(self.last_layout).unwrap_or(Layout::Ansi)
    }

    fn save(&self) {
        let d = json!({
            "base": self.base,
            "layers": self.layers.iter().map(|l| json!({ "name": l.name, "leds": leds_json(&l.leds) })).collect::<Vec<_>>(),
            "hidden": self.layers.iter().filter(|l| !l.visible).map(|l| l.name.clone()).collect::<Vec<_>>(),
            "side": self.side,
            "hyper_style": self.hyper_style,
            "extra_hyper": self.extra_hyper,
            "layout_override": self.layout_override.map(Layout::name),
            "last_layout": self.last_layout.map(Layout::name),
        });
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, d.to_string()).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }

    // ---- Hyper keys -----------------------------------------------------------------

    /// Hyper shortcuts from Tinycast (if it's installed), plus any the user picked.
    pub fn load_hyper_keys(&mut self, force: bool) {
        let path = tinycast_plist();
        let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if !force && mtime == self.tinycast_mtime {
            return;
        }
        self.tinycast_mtime = mtime;
        let layout = self.layout();
        let mut map = BTreeMap::new();
        if let Ok(plist::Value::Dictionary(prefs)) = plist::Value::from_file(&path) {
            for (k, v) in prefs.iter() {
                let (Some(action), Some(s)) = (k.strip_prefix("hotkey."), v.as_string()) else { continue };
                let Ok(j) = serde_json::from_str::<Value>(s) else { continue };
                let combo = &j["combo"]["_0"];
                if combo["carbonModifiers"].as_i64() != Some(HYPER_MODS) {
                    continue;
                }
                if let Some(key) = combo["carbonKeyCode"].as_i64().and_then(carbon_key).filter(|k| layout.led(k).is_some()) {
                    let action = action.trim_start_matches("command:").trim_start_matches("systemAction.");
                    map.insert(key.to_string(), action.to_string());
                }
            }
        }
        for k in &self.extra_hyper {
            map.entry(k.clone()).or_insert_with(|| "custom".to_string());
        }
        self.hyper_keys = map.keys().cloned().collect();
        self.hyper_map = map;
    }

    // ---- frames ---------------------------------------------------------------------

    fn base_name(&self) -> &str {
        self.base.get("name").and_then(Value::as_str).unwrap_or("off")
    }

    fn owns_keys(&self) -> bool {
        match self.base_name() {
            "effect" => true,
            "shape" => self.firmware_shapes(),
            _ => false,
        }
    }

    /// Built-in shapes (light mode 22) exist only on the ANSI board's firmware from 1.0.17.6, which
    /// is NuPhy IO's `presetShapeLightMode` gate. ISO/JIS firmware 1.0.16.6 turns 22 into 21 and
    /// ignores the shape bytes, so there Keylight draws the heart itself (BOARDS-2026-11.md §2.3).
    fn firmware_shapes(&self) -> bool {
        let Some(kb) = &self.kb else { return true }; // unplugged: leave the theme as it is
        let version = self.device.get("firmware").and_then(Value::as_str).map(|v| v.split('.').map(|n| n.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>());
        kb.pid == 0x1028 && version.is_some_and(|v| v >= vec![1, 0, 17, 6])
    }

    fn base_frame(&self) -> Leds {
        let b = &self.base;
        let level = int(b.get("level"), 100).clamp(0, 100) as f64 / 100.0;
        let layout = self.layout();
        let heart: Vec<u8> = HEART.iter().filter_map(|k| layout.led(k)).collect();
        let mut frame = Leds::new();
        for (r, (start, end)) in layout.row_ranges().iter().enumerate() {
            for l in *start..*end {
                let t = (l - start) as f64 / ((end - start - 1).max(1)) as f64;
                let c = match self.base_name() {
                    "solid" => rgb(b.get("color"), [255, 255, 255]),
                    "stripes" => match b.get("colors").and_then(Value::as_array) {
                        Some(cs) if !cs.is_empty() => rgb(cs.get(r % cs.len()), [255, 255, 255]),
                        _ => STRIPES[r],
                    },
                    "rainbow" => hue(t),
                    "effect" => {
                        if b.get("rgb").and_then(Value::as_bool).unwrap_or(true) {
                            hue(t)
                        } else {
                            rgb(b.get("color"), [255, 170, 110])
                        }
                    }
                    "shape" => {
                        if int(b.get("shape"), 0) == 0 && heart.contains(&l) {
                            rgb(b.get("color"), [255, 0, 0])
                        } else {
                            rgb(b.get("color2"), OFF)
                        }
                    }
                    "gradient" => {
                        let a = rgb(b.get("color"), [255, 170, 110]);
                        let z = rgb(b.get("color2"), [150, 0, 255]);
                        [0, 1, 2].map(|i| (a[i] as f64 + (z[i] as f64 - a[i] as f64) * t) as u8)
                    }
                    _ => continue,
                };
                frame.insert(l, c.map(|v| (v as f64 * level) as u8));
            }
        }
        frame
    }

    pub fn compose(&self) -> Leds {
        let layout = self.layout();
        let n = layout.key_leds();
        let mut frame: Leds = (0..n).map(|l| (l, OFF)).collect();
        if self.hyper {
            let bound = rgb(self.hyper_style.get("bound"), [0, 230, 255]);
            for k in &self.hyper_keys {
                if let Some(l) = layout.led(k) {
                    frame.insert(l, bound);
                }
            }
            if let Some(l) = layout.led("rcmd") {
                frame.insert(l, rgb(self.hyper_style.get("key"), [180, 0, 255]));
            }
            return frame;
        }
        frame.extend(self.base_frame());
        if !self.owns_keys() {
            for layer in self.layers.iter().filter(|l| l.visible) {
                frame.extend(layer.leds.iter().map(|(l, c)| (*l, *c)));
            }
        }
        if let Some((p, _)) = &self.preview {
            frame.extend(p.iter().map(|(l, c)| (*l, *c)));
        }
        frame.retain(|l, _| *l < n); // a shape drawn on a bigger layout
        frame
    }

    /// The light-state main bytes the keyboard should have: per-key, or its own effect/shape.
    fn main_target(&self) -> Main {
        if self.hyper || !self.owns_keys() {
            return Main::Custom;
        }
        let b = &self.base;
        let level = int(b.get("level"), 100).clamp(0, 100) as u8;
        let speed = int(b.get("speed"), 2).clamp(0, 4) as u8;
        if self.base_name() == "effect" {
            let mut mode = int(b.get("mode"), 6) as u8;
            if !(1..=20).contains(&mode) {
                mode = 6;
            }
            let [r, g, bl] = rgb(b.get("color"), [255, 170, 110]);
            let rainbow = b.get("rgb").and_then(Value::as_bool).unwrap_or(true) || (16..=20).contains(&mode);
            let dir = (int(b.get("direction"), 0) & 1) as u8;
            return Main::Firmware(vec![mode, level, speed, dir, rainbow as u8, 0, r, g, bl], None);
        }
        let [r, g, bl] = rgb(b.get("color2"), OFF);
        let [sr, sg, sb] = rgb(b.get("color"), [255, 0, 0]);
        let shape = (int(b.get("shape"), 0) & 7) as u8;
        Main::Firmware(vec![SHAPE_MODE, level, speed, 0, 0, 0, r, g, bl], Some(vec![shape, sr, sg, sb, speed]))
    }

    fn side_target(&self) -> [u8; 6] {
        let s = &self.side;
        let [r, g, b] = rgb(s.get("color"), [255, 255, 255]);
        [int(s.get("mode"), 2) as u8, int(s.get("brightness"), 25).clamp(0, 100) as u8, int(s.get("speed"), 2).clamp(0, 4) as u8, r, g, b]
    }

    // ---- device ---------------------------------------------------------------------

    fn connect(&mut self) -> bool {
        if self.kb.is_some() {
            return true;
        }
        if self.api.is_none() {
            self.api = HidApi::new().ok();
        }
        let Some(api) = self.api.as_mut() else { return false };
        let result = (|| -> Result<Keyboard, hid::Error> {
            let kb = Keyboard::open(api)?;
            let base = kb.get(hid::GET_BASE, 0, 8, 0)?;
            if base[0] > 1 {
                return Err(hid::Error::Other(format!("unexpected OS mode {}", base[0])));
            }
            self.mode = base[0];
            Ok(kb)
        })();
        match result {
            Ok(kb) => {
                let fw = kb.get(hid::GET_FW, 0, 8, 0).ok();
                let detected = Layout::from_pid(kb.pid);
                let layout = detected.map_or("unknown", Layout::name);
                self.device = json!({
                    "name": kb.name, "link": kb.link, "layout": layout,
                    "firmware": fw.as_deref().and_then(hid::firmware_version),
                    "os": if self.mode == 0 { "mac" } else { "windows" },
                })
                .as_object()
                .unwrap()
                .clone();
                self.kb = Some(kb);
                self.sent.clear();
                self.side_sent = None;
                self.main_sent = None;
                self.last_error = None;
                self.read_sleep();
                if detected.is_some() && detected != self.last_layout {
                    self.last_layout = detected;
                    self.save();
                }
                self.load_hyper_keys(true); // which shortcut keys exist depends on the layout
                true
            }
            Err(e) => {
                self.last_error = Some(e.to_string());
                false
            }
        }
    }

    fn drop_kb(&mut self, e: hid::Error) {
        eprintln!("keylight: keyboard connection lost: {e}");
        self.kb = None;
        self.sent.clear();
        self.side_sent = None;
        self.main_sent = None;
        self.last_error = Some(e.to_string());
    }

    fn read_sleep(&mut self) {
        if let Some(kb) = &self.kb {
            if let Ok(b) = kb.get(hid::GET_SLEEP, 0, 4, 0) {
                self.device.insert("sleep".into(), json!({ "enabled": b[0] != 0, "minutes": b[1], "deep_minutes": b[2] }));
            }
        }
    }

    fn set_sleep(&mut self, msg: &Value) -> Result<(), String> {
        if !self.connect() {
            return Err("keyboard not connected".into());
        }
        let kb = self.kb.as_ref().unwrap();
        let r = (|| -> Result<(), hid::Error> {
            let mut b = kb.get(hid::GET_SLEEP, 0, 4, 0)?;
            if let Some(en) = msg.get("enabled").and_then(Value::as_bool) {
                b[0] = en as u8;
            }
            for (i, k) in [(1, "minutes"), (2, "deep_minutes")] {
                if let Some(v) = msg.get(k).and_then(Value::as_f64) {
                    b[i] = (v as i64).clamp(5, 127) as u8;
                }
            }
            kb.set(hid::SET_SLEEP, 0, &b, 0)
        })();
        match r {
            Ok(()) => {
                self.writes += 1;
                self.read_sleep();
                Ok(())
            }
            Err(e) => Err(e.to_string()),
        }
    }

    /// Writes whatever differs between what the keyboard shows and what it should.
    pub fn flush(&mut self) {
        if !self.connect() {
            return;
        }
        let kb = self.kb.take().unwrap();
        let result = self.flush_with(&kb);
        self.kb = Some(kb);
        if let Err(e) = result {
            self.drop_kb(e);
        }
    }

    fn flush_with(&mut self, kb: &Keyboard) -> Result<(), hid::Error> {
        let main = self.main_target();
        if self.main_sent.as_ref() != Some(&main) {
            match &main {
                Main::Custom => {
                    kb.set(hid::SET_LIGHT, 0, &[CUSTOM_MODE], self.mode)?;
                    self.sent.clear(); // repaint every key after an effect
                }
                Main::Firmware(a, b) => {
                    kb.set(hid::SET_LIGHT, 0, a, self.mode)?;
                    if let Some(b) = b {
                        kb.set(hid::SET_LIGHT, 17, b, self.mode)?;
                    }
                }
            }
            self.main_sent = Some(main.clone());
            self.writes += 1;
        }
        if main == Main::Custom {
            let frame = self.compose();
            let changed: Vec<(u8, Rgb)> = frame.into_iter().filter(|(l, c)| self.sent.get(l) != Some(c)).collect();
            if !changed.is_empty() {
                let payload: Vec<u8> = changed.iter().flat_map(|(l, c)| [*l, c[0], c[1], c[2]]).collect();
                kb.set(hid::SET_SIGNAL, 0, &payload, self.mode)?;
                self.sent.extend(changed);
                self.writes += 1;
            }
        }
        let side = self.side_target();
        let due = self.side_last.map_or(true, |t| t.elapsed() >= SIDE_MIN_INTERVAL);
        if self.side_sent != Some(side) && due {
            let [mode, bright, speed, r, g, b] = side;
            let rainbow = (mode == 1) as u8; // neon cycles colours by itself
            kb.set(hid::SET_LIGHT, 9, &[mode, bright, speed, rainbow, 0, r, g, b], self.mode)?;
            self.side_sent = Some(side);
            self.side_last = Some(Instant::now());
            self.writes += 1;
        }
        Ok(())
    }

    /// Called four times a second.
    pub fn tick(&mut self, n: u64) {
        if self.preview.as_ref().is_some_and(|(_, t)| t.elapsed() > PREVIEW_TTL) {
            self.preview = None;
            self.flush();
        }
        if n % 120 == 0 {
            self.load_hyper_keys(false);
        }
        if self.kb.is_none() {
            if n % 20 == 0 {
                self.flush(); // retry connecting every 5 s
            }
        } else if (n % 4 == 0 && self.side_sent != Some(self.side_target())) || n % 40 == 0 {
            self.flush();
        }
    }

    // ---- messages (the socket, the CLI and the app all send these) --------------------

    pub fn handle(&mut self, msg: &Value) -> Result<Value, String> {
        let op = msg.get("op").and_then(Value::as_str).unwrap_or("");
        match op {
            "hyper" => self.hyper = msg.get("on").and_then(Value::as_bool).unwrap_or(false),
            "state" | "dump" => return Ok(self.state()),
            "base" => {
                let mut new: Map<String, Value> = msg.as_object().cloned().unwrap_or_default();
                new.remove("op");
                new.retain(|_, v| !v.is_null());
                if new.get("name").is_some_and(|n| Some(n) != self.base.get("name")) {
                    self.base = new; // a new theme starts fresh
                } else {
                    self.base.extend(new);
                }
                self.save();
            }
            "layer" | "status" => {
                self.op_layer(msg)?;
                self.save();
            }
            "preview" => {
                self.preview = match msg.get("leds") {
                    Some(v) if !v.is_null() => Some((parse_leds(v), Instant::now())),
                    _ => None,
                };
            }
            "side" => {
                for k in ["mode", "brightness", "speed"] {
                    if let Some(v) = msg.get(k).filter(|v| v.is_number()) {
                        self.side.insert(k.into(), v.clone());
                    }
                }
                if let Some(c) = msg.get("color").filter(|v| v.is_array()) {
                    self.side.insert("color".into(), c.clone());
                }
                self.side_last = None; // the user asked: write now
                self.save();
            }
            "hyper_style" => {
                for k in ["bound", "key"] {
                    if let Some(c) = msg.get(k).filter(|v| v.is_array()) {
                        self.hyper_style.insert(k.into(), c.clone());
                    }
                }
                self.save();
            }
            "hyper_extra" => {
                self.extra_hyper = msg.get("keys").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|k| Layout::ALL.iter().any(|l| l.led(k).is_some())).collect()).unwrap_or_default();
                self.load_hyper_keys(true);
                self.save();
            }
            "sleep" => {
                self.set_sleep(msg)?;
                return Ok(self.device.get("sleep").cloned().unwrap_or(Value::Null));
            }
            "keymap" => return self.keymap(msg),
            "backup" => return self.backup(),
            "key_set" => return self.key_set(msg),
            "macros" => return self.macros(msg),
            "macro_write" => return self.macro_write(msg),
            "advanced" => return self.advanced(msg),
            "advanced_write" => return self.advanced_write(msg),
            "func" => return self.func(msg),
            "reload" => self.load_hyper_keys(true),
            "layout" => {
                self.layout_override = msg.get("layout").and_then(Value::as_str).and_then(Layout::from_name);
                self.sent.clear(); // LEDs mean different keys now: repaint them all
                self.load_hyper_keys(true);
                self.save();
            }
            "refresh" => {
                self.sent.clear();
                self.side_sent = None;
                self.side_last = None;
                self.main_sent = None;
            }
            _ => return Err(format!("unknown op {op:?}")),
        }
        self.flush();
        Ok(Value::Null)
    }

    // ---- keymap, macros, keyboard settings (see docs/KEYMAP.md) -------------------------

    fn with_kb<T>(&mut self, f: impl FnOnce(&Keyboard, u8) -> Result<T, hid::Error>) -> Result<T, String> {
        if !self.connect() {
            return Err(self.last_error.clone().unwrap_or_else(|| "keyboard not connected".into()));
        }
        let kb = self.kb.take().unwrap();
        let r = f(&kb, self.mode);
        self.kb = Some(kb);
        r.map_err(|e| {
            let s = e.to_string();
            self.drop_kb(e);
            s
        })
    }

    /// One layer's 98 key words (big-endian u16), and the defaults for the same layer.
    /// Layers 0-3 belong to Mac mode, 4-7 to Windows; 0 and 4 are the base layers.
    fn keymap(&mut self, msg: &Value) -> Result<Value, String> {
        let layer = int(msg.get("layer"), 0).clamp(0, 7) as usize;
        let (keys, defaults) = self.with_kb(|kb, _| {
            let keys = kb.get(hid::GET_KEYS, layer * hid::LAYER_BYTES, hid::LAYER_BYTES, 0)?;
            let defaults = kb.get(hid::GET_DEFAULT_KEYS, layer * hid::LAYER_BYTES, hid::LAYER_BYTES, 0).ok();
            Ok((keys, defaults))
        })?;
        let words = |b: &[u8]| b.chunks(2).map(|w| (w[0] as u16) << 8 | w[1] as u16).collect::<Vec<_>>();
        Ok(json!({ "layer": layer, "os_mode": self.mode, "keys": words(&keys), "defaults": defaults.as_deref().map(words) }))
    }

    /// Saves all 8 keymap layers, both macro areas and the three advanced-key tables to a file
    /// before anything is changed.
    fn backup(&mut self) -> Result<Value, String> {
        let (layers, macros, advanced) = self.with_kb(|kb, _| {
            let mut layers = Vec::new();
            for l in 0..8 {
                layers.push(kb.get(hid::GET_KEYS, l * hid::LAYER_BYTES, hid::LAYER_BYTES, 0)?);
            }
            let mut macros = Vec::new();
            for os in 0..2 {
                macros.push(kb.get(hid::GET_MACRO, os * hid::MACRO_BYTES, hid::MACRO_BYTES, 0)?);
            }
            let mut advanced = Map::new();
            for t in TABLES {
                advanced.insert(t.name.into(), json!(kb.get(t.get, 0, t.total, 0)?));
            }
            Ok((layers, macros, advanced))
        })?;
        let secs = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let dir = crate::data_dir().join("backups");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("keymap-{secs}.json"));
        let d = json!({ "saved": secs, "device": self.device, "layers": layers, "macros": macros, "advanced": advanced });
        std::fs::write(&path, d.to_string()).map_err(|e| e.to_string())?;
        Ok(json!({ "path": path.display().to_string(), "saved": secs }))
    }

    /// Assigns one key: `word` is the 2-byte key word (big-endian) for matrix position `index`.
    fn key_set(&mut self, msg: &Value) -> Result<Value, String> {
        let layer = int(msg.get("layer"), -1);
        let index = int(msg.get("index"), -1);
        let word = int(msg.get("word"), -1);
        if !(0..8).contains(&layer) || !(0..(hid::LAYER_BYTES as i64 / 2)).contains(&index) || !(0..=0xFFFF).contains(&word) {
            return Err("key_set needs layer 0-7, index 0-97 and a 16-bit word".into());
        }
        check_key_word(index as usize, word as u16)?;
        let addr = layer as usize * hid::LAYER_BYTES + 2 * index as usize;
        self.with_kb(|kb, _| kb.set(hid::SET_KEYS, addr, &[(word >> 8) as u8, word as u8], 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// The raw 2048-byte macro block for one OS mode (decoded by the app).
    fn macros(&mut self, msg: &Value) -> Result<Value, String> {
        let os = int(msg.get("os"), self.mode as i64).clamp(0, 1) as usize;
        let bytes = self.with_kb(|kb, _| kb.get(hid::GET_MACRO, os * hid::MACRO_BYTES, hid::MACRO_BYTES, 0))?;
        Ok(json!({ "os": os, "bytes": bytes }))
    }

    /// Writes a whole macro block (the app lays it out; see docs/KEYMAP.md).
    fn macro_write(&mut self, msg: &Value) -> Result<Value, String> {
        let os = int(msg.get("os"), self.mode as i64).clamp(0, 1) as usize;
        let bytes: Vec<u8> = msg.get("bytes").and_then(Value::as_array).map(|a| a.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect()).unwrap_or_default();
        if bytes.len() != hid::MACRO_BYTES {
            return Err(format!("macro block must be {} bytes", hid::MACRO_BYTES));
        }
        self.with_kb(|kb, _| kb.set(hid::SET_MACRO, os * hid::MACRO_BYTES, &bytes, 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// The advanced-key tables, whole (decoded by the app). `table` picks one; without it, all three.
    fn advanced(&mut self, msg: &Value) -> Result<Value, String> {
        let wanted: Vec<Table> = match msg.get("table").and_then(Value::as_str) {
            Some(name) => vec![Table::named(name).ok_or(format!("no advanced table {name:?}"))?],
            None => TABLES.to_vec(),
        };
        let out = self.with_kb(|kb, _| {
            let mut out = Map::new();
            for t in &wanted {
                out.insert(t.name.into(), json!(kb.get(t.get, 0, t.total, 0)?));
            }
            Ok(out)
        })?;
        Ok(Value::Object(out))
    }

    /// Writes one advanced-key entry: `bytes` at `offset` in `table`. Never more than one entry,
    /// and never across the Mac/Windows halves. (NuPhy IO writes an SOCD pair as one 8-byte packet,
    /// which lands in someone else's slot when the pair's slots aren't next to each other.)
    fn advanced_write(&mut self, msg: &Value) -> Result<Value, String> {
        let name = msg.get("table").and_then(Value::as_str).unwrap_or("");
        let t = Table::named(name).ok_or(format!("no advanced table {name:?}"))?;
        let offset = msg.get("offset").and_then(Value::as_u64).ok_or("advanced_write needs an offset")?;
        let bytes = msg
            .get("bytes")
            .and_then(Value::as_array)
            .ok_or("advanced_write needs bytes")?
            .iter()
            .map(|v| v.as_u64().filter(|b| *b <= 0xFF).map(|b| b as u8))
            .collect::<Option<Vec<u8>>>()
            .ok_or("advanced_write bytes must be 0-255")?;
        let offset = usize::try_from(offset).map_err(|_| "offset out of range")?;
        t.check(offset, &bytes)?;
        self.with_kb(|kb, _| kb.set(t.set, offset, &bytes, 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// Keyboard settings for the current OS mode: anti-chatter level and the Windows-key locks.
    /// With fields in the message, writes those first.
    fn func(&mut self, msg: &Value) -> Result<Value, String> {
        let fields = ["stabilization", "disable_win", "disable_alt_f4", "disable_alt_tab"];
        let patch: Vec<(usize, u8)> = fields.iter().enumerate().filter_map(|(i, k)| msg.get(*k).and_then(|v| v.as_f64().or(v.as_bool().map(|b| b as u8 as f64))).map(|v| (i, v as u8))).collect();
        let b = self.with_kb(|kb, mode| {
            for (i, v) in &patch {
                let v = if *i == 0 { (*v).clamp(1, 3) } else { (*v).min(1) };
                kb.set(hid::SET_FUNC, *i, &[v], mode)?;
            }
            kb.get(hid::GET_FUNC, 0, 4, mode)
        })?;
        if !patch.is_empty() {
            self.writes += 1;
        }
        Ok(json!({ "stabilization": b[0].max(1), "disable_win": b[1] != 0, "disable_alt_f4": b[2] != 0, "disable_alt_tab": b[3] != 0 }))
    }

    fn op_layer(&mut self, msg: &Value) -> Result<(), String> {
        let name = msg.get("name").and_then(Value::as_str).ok_or("layer needs a name")?.to_string();
        // nuphyctl's `status NAME clear` sends a null colour.
        let delete = msg.get("delete").and_then(Value::as_bool).unwrap_or(false) || (msg.get("op").and_then(Value::as_str) == Some("status") && msg.get("color").is_some_and(Value::is_null));
        if delete {
            self.layers.retain(|l| l.name != name);
            return Ok(());
        }
        let leds = if let Some(v) = msg.get("leds") {
            Some(parse_leds(v))
        } else if let (Some(keys), Some(c)) = (msg.get("keys").and_then(Value::as_array), msg.get("color").filter(|c| c.is_array())) {
            let c = rgb(Some(c), OFF);
            let layout = self.layout();
            Some(keys.iter().filter_map(|k| layout.led(k.as_str()?)).map(|l| (l, c)).collect())
        } else {
            None
        };
        if let Some(leds) = leds {
            match self.layers.iter_mut().find(|l| l.name == name) {
                Some(l) => l.leds = leds, // keeps its place in the stack
                None => self.layers.push(Layer { name: name.clone(), leds, visible: true }),
            }
        }
        let layer = self.layers.iter_mut().find(|l| l.name == name).ok_or(format!("no layer {name:?}"))?;
        if let Some(v) = msg.get("visible").and_then(Value::as_bool) {
            layer.visible = v;
        }
        if let Some(new) = msg.get("rename").and_then(Value::as_str).filter(|n| !n.is_empty()) {
            layer.name = new.to_string();
        }
        Ok(())
    }

    pub fn state(&self) -> Value {
        let frame = self.compose();
        json!({
            "connected": self.kb.is_some(),
            "device": self.device,
            "layout": self.layout().name(),
            "layout_override": self.layout_override.map(Layout::name),
            "error": if self.kb.is_some() { None } else { self.last_error.clone() },
            "os_mode": self.mode,
            "hyper": self.hyper,
            "hyper_keys": self.hyper_keys,
            "hyper_map": self.hyper_map,
            "extra_hyper": self.extra_hyper,
            "hyper_style": self.hyper_style,
            "base": self.base,
            "layers": self.layers.iter().map(|l| json!({ "name": l.name, "visible": l.visible, "leds": leds_json(&l.leds) })).collect::<Vec<_>>(),
            "side": self.side,
            "frame": (0..self.layout().key_leds()).map(|l| frame.get(&l).copied().unwrap_or(OFF)).collect::<Vec<_>>(),
            "preview": self.preview.is_some(),
            "firmware_shapes": self.firmware_shapes(),
            "writes": self.writes,
        })
    }
}

/// One of the three advanced-key tables (docs/KEYMAP.md §5). Each is a Mac half then a Windows
/// half of 32 entries; the key word `[0x7F, id]` names the slot and the OS mode picks the half.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Table {
    pub name: &'static str,
    get: u8,
    set: u8,
    /// Bytes in the whole table. The firmware doesn't bound reads, so never read past it.
    pub total: usize,
    pub entry: usize,
}

pub const TABLES: [Table; 3] = [
    // [codeHi, codeLo, partnerSlot, priority]
    Table { name: "socd", get: hid::GET_SOCD, set: hid::SET_SOCD, total: 256, entry: 4 },
    // [tap, double tap, hold, delay in ms], each a big-endian u16
    Table { name: "tapdance", get: hid::GET_TAP_DANCE, set: hid::SET_TAP_DANCE, total: 512, entry: 8 },
    // [codeHi, codeLo]
    Table { name: "tgl", get: hid::GET_TGL, set: hid::SET_TGL, total: 128, entry: 2 },
];

/// Slots per OS mode in each table.
pub const SLOTS: usize = 32;

impl Table {
    pub fn named(name: &str) -> Option<Table> {
        TABLES.into_iter().find(|t| t.name == name)
    }

    /// A write must be exactly one entry, start on an entry, and stay inside one OS mode's half.
    pub fn check(&self, offset: usize, bytes: &[u8]) -> Result<(), String> {
        let half = self.total / 2;
        if bytes.len() != self.entry {
            return Err(format!("a {} entry is {} bytes, got {}", self.name, self.entry, bytes.len()));
        }
        let inside = offset % self.entry == 0 && offset.checked_add(bytes.len()).is_some_and(|end| end <= self.total && offset / half == (end - 1) / half);
        if !inside {
            return Err(format!("offset {offset} isn't an entry inside one half of the {}-byte {} table", self.total, self.name));
        }
        // A partner past slot 31 would have the firmware read beyond the half.
        if self.name == "socd" && (bytes[2] as usize >= SLOTS || bytes[3] > 1) {
            return Err("an SOCD entry needs a partner slot 0-31 and a priority of 0 or 1".into());
        }
        Ok(())
    }
}

/// Matrix positions of the knob: pressed (row 3, col 12), turned left, turned right.
const KNOB_INDICES: [usize; 3] = [60, 96, 97];

/// Refuses advanced-key words the keyboard can't use: slots past 31 (the firmware's bounds check
/// is off by one), ids NuPhy never assigns, and any advanced key on the knob.
fn check_key_word(index: usize, word: u16) -> Result<(), String> {
    if word >> 8 != 0x7F {
        return Ok(());
    }
    let id = (word & 0xFF) as usize;
    if id >= 0xC0 || id % 64 >= SLOTS {
        return Err(format!("{word:#06x} isn't an advanced key in slot 0-31"));
    }
    if KNOB_INDICES.contains(&index) {
        return Err("the knob can't hold an advanced key".into());
    }
    Ok(())
}

fn parse_leds(v: &Value) -> Leds {
    v.as_object()
        .map(|o| o.iter().filter_map(|(k, c)| Some((k.parse::<u8>().ok().filter(|l| *l < MAX_KEY_LEDS)?, rgb(Some(c), OFF)))).collect())
        .unwrap_or_default()
}

fn leds_json(leds: &Leds) -> Value {
    Value::Object(leds.iter().map(|(l, c)| (l.to_string(), json!(c))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(name: &str) -> Table {
        Table::named(name).unwrap()
    }

    #[test]
    fn one_entry_per_write() {
        let socd = table("socd");
        assert!(socd.check(0, &[0, 4, 1, 1]).is_ok());
        assert!(socd.check(124, &[0, 7, 0, 1]).is_ok(), "Mac slot 31");
        assert!(socd.check(128, &[0, 7, 0, 1]).is_ok(), "Windows slot 0");
        assert!(socd.check(252, &[0, 7, 0, 1]).is_ok(), "Windows slot 31");
        // NuPhy IO's two-entry SOCD write is refused.
        assert!(socd.check(0, &[0, 4, 1, 1, 0, 7, 0, 1]).is_err());
        assert!(socd.check(0, &[0, 4]).is_err());
        assert!(socd.check(0, &[]).is_err());
    }

    #[test]
    fn offsets_stay_on_entries_inside_one_half() {
        let td = table("tapdance");
        assert!(td.check(0, &[0; 8]).is_ok());
        assert!(td.check(248, &[0; 8]).is_ok());
        assert!(td.check(256, &[0; 8]).is_ok());
        assert!(td.check(504, &[0; 8]).is_ok());
        assert!(td.check(512, &[0; 8]).is_err(), "past the end");
        assert!(td.check(4, &[0; 8]).is_err(), "not on an entry");
        let tgl = table("tgl");
        assert!(tgl.check(62, &[0, 4]).is_ok());
        assert!(tgl.check(64, &[0x52, 0x21]).is_ok());
        assert!(tgl.check(126, &[0, 4]).is_ok());
        assert!(tgl.check(128, &[0, 4]).is_err());
        assert!(tgl.check(1, &[0, 4]).is_err());
        assert!(tgl.check(usize::MAX - 1, &[0, 4]).is_err(), "no overflow");
    }

    #[test]
    fn socd_partner_and_priority() {
        let socd = table("socd");
        assert!(socd.check(0, &[0, 4, 31, 0]).is_ok());
        assert!(socd.check(0, &[0, 4, 32, 0]).is_err(), "partner slot 32 reads past the half");
        assert!(socd.check(0, &[0, 4, 1, 2]).is_err());
        assert!(socd.check(0, &[0, 0, 0, 0]).is_ok(), "clearing");
    }

    #[test]
    fn advanced_key_words() {
        assert!(check_key_word(1, 0x7F00).is_ok());
        assert!(check_key_word(1, 0x7F1F).is_ok());
        assert!(check_key_word(1, 0x7F20).is_err(), "SOCD slot 32");
        assert!(check_key_word(1, 0x7F40).is_ok());
        assert!(check_key_word(1, 0x7F60).is_err(), "Tap Dance slot 32");
        assert!(check_key_word(1, 0x7F9F).is_ok());
        assert!(check_key_word(1, 0x7FC0).is_err());
        for knob in KNOB_INDICES {
            assert!(check_key_word(knob, 0x7F41).is_err());
            assert!(check_key_word(knob, 0x00A9).is_ok());
        }
        assert!(check_key_word(1, 0x7704).is_ok(), "macros are fine");
    }
}
