//! Keeps the keyboard's lights in sync with what Keylight is asked for.
//!
//! Layers, bottom to top: the theme (base), the user's shapes, a preview (unsaved), and while
//! Hyper is held, only the keys with Hyper shortcuts. Only LEDs that changed are written, side
//! light writes are rate-limited, and there is no software animation, because the keyboard saves
//! its lights to flash (docs/PROTOCOL.md, "Flash wear"). The Air75 V3 saves per-key colours a
//! second after the last change, so a Hyper highlight would cost a save each time: `Save` keeps
//! the board from making saves that would be wasted.
//!
//! Boards other than the Air75 V3 are experimental (boards.rs): Keylight reads them, and writes only
//! lighting, only once the user turns that on and the board answered as expected at connect.

use crate::boards::{self, Board, Checks, Matrix, Status, MAX_KEY_LEDS};
use crate::hid::{self, Keyboard};
use hidapi::HidApi;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

const SHAPE_MODE: u8 = 22;
const OFF: Rgb = [0, 0, 0];
const STRIPES: [Rgb; 6] = [[255, 0, 0], [255, 90, 0], [255, 200, 0], [0, 220, 60], [0, 90, 255], [150, 0, 255]];
/// The firmware heart (shape 0) by key, for the frame shown in the app; JIS has KANA where ANSI has Right ⌘.
const HEART: [&str; 20] = ["8", "9", "-", "=", "u", "i", "o", "p", "[", "]", "j", "k", "l", ";", "'", ",", ".", "/", "rcmd", "kana"];
const HYPER_MODS: i64 = 6912; // Carbon ⌃⌥⇧⌘
const PREVIEW_TTL: Duration = Duration::from_secs(20);
const SIDE_MIN_INTERVAL: Duration = Duration::from_millis(750);
/// The Air75 V3 saves its per-key colours once no 0xD8 has changed one for a second (firmware
/// 1.0.23.6). After this long, Keylight takes it that the board has.
/// The one board and firmware whose save was traced; `Save` holds saves on it only.
const TRACED: (u16, &str) = (0x1028, "1.0.23.6");
const BOARD_SAVES_AFTER: Duration = Duration::from_millis(1500);
/// While a save would be wasted, the hidden LED is poked this often, well inside the board's second.
const NUDGE_EVERY: Duration = Duration::from_millis(500);
/// Pokes need the board's OS mode to be the bank Keylight writes, read no longer ago than this.
const MODE_FRESH: Duration = Duration::from_secs(10);
/// The board is held from saving for at most this long after the colours last really changed.
const HOLD_FOR: Duration = Duration::from_secs(600);

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

/// `Engine::may_open`, on the sets themselves, so `connect` can use it while it holds the HID API.
fn may_open(allowed: &BTreeSet<String>, halted: &BTreeSet<String>, b: &Board) -> bool {
    b.status == Status::Supported || (allowed.contains(&b.id) && !halted.contains(&b.id))
}

/// What one flush sends, and what it records as sent once it has.
#[derive(Default)]
struct Plan {
    /// (command, offset, data), in order.
    packets: Vec<(u8, usize, Vec<u8>)>,
    main: Option<Main>,
    repaint: bool,
    leds: Vec<(u8, Rgb)>,
    side: Option<[u8; 6]>,
    /// The colour written to the hidden LED in this flush (`Save`).
    poke: Option<(u8, Rgb)>,
}

/// What Keylight knows of the Air75 V3's per-key save (firmware 1.0.23.6, docs/PROTOCOL.md "Flash
/// wear"): a 0xD8 that changes a colour marks them all unsaved, and once no 0xD8 has changed one for
/// a second the board writes all 104 to flash. Showing Hyper and taking it away again would cost
/// one such write each time, of colours the flash already has.
///
/// So while the save the board is waiting to make would be wasted (a highlight is up, or the
/// colours are back to what the flash holds), Keylight keeps it waiting: every `NUDGE_EVERY` it
/// writes a new colour to the first side LED, and each change restarts the board's second. 0xD8
/// keeps and saves that LED like a key (it takes 0..103, FW 0x157fe), but per-key mode never shows
/// it: the custom renderer paints LEDs 0..83 only (FW 0x9bc8) and the side renderer draws the bars
/// itself. Once the colours settle on something new, or `HOLD_FOR` after they last changed, the
/// poking stops and the board saves once. 0xD8 doesn't restart the board's sleep timers, which only
/// keys and power changes do, so the poking doesn't keep it awake.
#[derive(Default)]
struct Save {
    /// The colours in the board's flash, once Keylight has seen it save them.
    flash: Option<Leds>,
    /// When a 0xD8 last changed a colour, while the board hasn't saved since.
    changed: Option<Instant>,
    /// When a 0xD8 last changed a colour other than by a nudge: Hyper, a theme, a shape.
    real: Option<Instant>,
    /// The last colour poked (its red), so each poke differs from the one before.
    pokes: u8,
    /// When the board's OS mode (0xA0 byte 0) was last read, and whether it was Keylight's bank. A
    /// 0xD8 to the other OS mode's bank goes to that mode's colours, and saves at once when they
    /// aren't the ones loaded and the loaded ones are unsaved (FW 0x15844-0x1590a).
    mode_seen: Option<(Instant, bool)>,
}

/// The LED poked to hold a save: the first side LED, inside the board's own range.
fn hidden_led(board: &Board) -> Option<u8> {
    (board.side_leds > 0).then_some(board.key_leds)
}

/// Where a flush sends its packets: the keyboard, or a model of one in tests.
pub(crate) trait Wire {
    fn set(&self, cmd: u8, offset: usize, data: &[u8], bank: u8) -> Result<(), hid::Error>;
    fn get(&self, cmd: u8, offset: usize, total: usize, bank: u8) -> Result<Vec<u8>, hid::Error>;
}

impl Wire for Keyboard {
    fn set(&self, cmd: u8, offset: usize, data: &[u8], bank: u8) -> Result<(), hid::Error> {
        Keyboard::set(self, cmd, offset, data, bank)
    }

    fn get(&self, cmd: u8, offset: usize, total: usize, bank: u8) -> Result<Vec<u8>, hid::Error> {
        Keyboard::get(self, cmd, offset, total, bank)
    }
}

/// The side-light block of the light state (offset 9, 8 bytes) for this board. Keylight keeps the
/// Air75 V3's mode numbers. Off (4) on any board but the Air75 V3 becomes Static at
/// brightness 0, which is how NuPhy IO turns a zone off; any other mode the board lacks (Neon on
/// Node) becomes Static.
fn side_bytes(board: &Board, [mode, bright, speed, r, g, b]: [u8; 6]) -> [u8; 8] {
    let fallback = board.side_mode(2).unwrap_or(0);
    let (wire, bright) = match board.side_mode(mode) {
        Some(w) => (w, bright),
        None if mode == 4 => (fallback, 0),
        None => (fallback, bright),
    };
    [wire, bright, board.side_speed(speed), board.side_rainbow(wire) as u8, 0, r, g, b]
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
    /// Set from the Device page when the PID doesn't say the right layout: a board id, such as "iso".
    layout_override: Option<String>,
    /// The last board that was plugged in, kept for when none is.
    last_layout: Option<String>,
    /// The PID of the board plugged in now. Kept while a flush has `kb` taken out.
    pid: Option<u16>,
    /// What an experimental board said at connect (boards::Checks).
    checks: Option<Checks>,
    /// Experimental boards (by id) the user let Keylight write lighting to.
    experimental: BTreeSet<String>,
    /// Experimental boards (by id) the user let Keylight connect to. Until then they're only seen in
    /// the device list: no handshake, nothing sent.
    allowed: BTreeSet<String>,
    /// Experimental boards that failed while connected. Keylight doesn't reconnect them by itself;
    /// the user clicks Connect again. Not saved.
    halted: BTreeSet<String>,
    /// Each experimental board's light state as Keylight first found it, read at a connect while
    /// experimental lighting was off, so switching it off can put the board back.
    original_light: BTreeMap<String, Vec<u8>>,
    /// Off in tests, so nothing ever opens a real keyboard.
    hid: bool,
    tinycast_mtime: Option<SystemTime>,
    writes: u64,
    save: Save,
    path: PathBuf,
}

pub type Shared = Arc<Mutex<Engine>>;

fn tinycast_plist() -> PathBuf {
    crate::home().join("Library/Preferences/com.tinycast.app.plist")
}

impl Engine {
    pub fn new(path: PathBuf) -> Engine {
        Engine::with_hid(path, true)
    }

    fn with_hid(path: PathBuf, hid: bool) -> Engine {
        let mut e = Engine {
            api: if hid { HidApi::new().ok() } else { None },
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
            pid: None,
            checks: None,
            experimental: BTreeSet::new(),
            allowed: BTreeSet::new(),
            halted: BTreeSet::new(),
            original_light: BTreeMap::new(),
            hid,
            tinycast_mtime: None,
            writes: 0,
            save: Save::default(),
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
        let board = |k: &str| d.get(k).and_then(Value::as_str).filter(|id| boards::by_id(id).is_some()).map(String::from);
        self.layout_override = board("layout_override");
        self.last_layout = board("last_layout");
        let ids = |k: &str| d.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
        self.experimental = ids("experimental");
        self.allowed = ids("connect");
        if let Some(o) = d.get("original_light").and_then(Value::as_object) {
            self.original_light = o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_array()?.iter().map(|b| b.as_u64().unwrap_or(0) as u8).collect()))).collect();
        }
        self.fit_side_speed(); // for the last board seen
    }

    /// A side speed the board can't be sent (4 on the Air75 V3) becomes the slowest it can.
    fn fit_side_speed(&mut self) {
        let speed = int(self.side.get("speed"), 2).clamp(0, 4) as u8;
        let fit = self.board().side_speed(speed);
        if fit != speed {
            self.side.insert("speed".into(), json!(fit));
        }
    }

    /// The board to map keys and LEDs for: the override, else the keyboard's, else the last one seen,
    /// else the ANSI Air75 V3. An override only picks another layout of the same keyboard.
    fn board(&self) -> &'static Board {
        let detected = self.device.get("board").and_then(Value::as_str).and_then(boards::by_id);
        let seen = detected.or_else(|| self.last_layout.as_deref().and_then(boards::by_id));
        let chosen = self.layout_override.as_deref().and_then(boards::by_id).filter(|o| seen.is_none_or(|s| s.model == o.model));
        chosen.or(seen).unwrap_or_else(boards::ansi)
    }

    /// The board plugged in now.
    fn connected(&self) -> Option<&'static Board> {
        self.pid.and_then(boards::by_pid)
    }

    fn firmware(&self) -> Option<&str> {
        self.device.get("firmware").and_then(Value::as_str)
    }

    /// Why Keylight won't write lighting to the board plugged in, or None if it may.
    fn read_only(&self) -> Option<String> {
        let board = self.connected()?;
        if board.status == Status::Supported {
            return None;
        }
        let Some(checks) = &self.checks else { return Some("Keylight only reads this keyboard: it hasn't answered yet".into()) };
        if let Some(p) = checks.problem(board) {
            return Some(format!("Keylight only reads this keyboard: {p}"));
        }
        if !self.experimental.contains(&board.id) {
            return Some("Experimental lighting is off".into());
        }
        None
    }

    /// Whether Keylight may open this board (handshake and reads). The Air75 V3 always; an
    /// experimental board once the user clicked Connect, and not again after an error until they do.
    #[cfg(test)]
    fn may_open(&self, b: &Board) -> bool {
        may_open(&self.allowed, &self.halted, b)
    }

    /// Keymaps, macros, advanced keys and keyboard settings: the Air75 V3 only, for now.
    fn require_supported(&mut self, what: &str) -> Result<(), String> {
        if !self.connect() {
            return Err(self.last_error.clone().unwrap_or_else(|| "keyboard not connected".into()));
        }
        match self.connected() {
            Some(b) if b.status == Status::Supported => Ok(()),
            Some(b) => Err(format!("{what} on the {} aren't supported yet", b.name())),
            None => Err("unknown keyboard".into()),
        }
    }

    fn save(&self) {
        let d = json!({
            "base": self.base,
            "layers": self.layers.iter().map(|l| json!({ "name": l.name, "leds": leds_json(&l.leds) })).collect::<Vec<_>>(),
            "hidden": self.layers.iter().filter(|l| !l.visible).map(|l| l.name.clone()).collect::<Vec<_>>(),
            "side": self.side,
            "hyper_style": self.hyper_style,
            "extra_hyper": self.extra_hyper,
            "layout_override": self.layout_override,
            "last_layout": self.last_layout,
            "experimental": self.experimental,
            "connect": self.allowed,
            "original_light": self.original_light,
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
        let layout = self.board();
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
    /// ignores the shape bytes, and no other board has them, so there Keylight draws the heart itself
    /// (BOARDS-2026-11.md §2.3). Goes by `pid`, not `kb`, which a flush takes out while it writes.
    fn firmware_shapes(&self) -> bool {
        match self.connected() {
            Some(b) => b.has_firmware_shapes(self.firmware()),
            None => true, // unplugged: leave the theme as it is
        }
    }

    fn base_frame(&self) -> Leds {
        let b = &self.base;
        let level = int(b.get("level"), 100).clamp(0, 100) as f64 / 100.0;
        let layout = self.board();
        let heart: Vec<u8> = HEART.iter().filter_map(|k| layout.led(k)).collect();
        let mut frame = Leds::new();
        for (r, (start, end)) in layout.row_ranges().iter().enumerate() {
            for l in *start..*end {
                let t = (l - start) as f64 / ((end - start - 1).max(1)) as f64;
                let c = match self.base_name() {
                    "solid" => rgb(b.get("color"), [255, 255, 255]),
                    "stripes" => match b.get("colors").and_then(Value::as_array) {
                        Some(cs) if !cs.is_empty() => rgb(cs.get(r % cs.len()), [255, 255, 255]),
                        _ => STRIPES[r % STRIPES.len()],
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
        self.frame(true)
    }

    /// The frame, with or without what doesn't last: Hyper and a preview.
    fn frame(&self, passing: bool) -> Leds {
        let layout = self.board();
        let n = layout.key_leds;
        let mut frame: Leds = (0..n).map(|l| (l, OFF)).collect();
        if self.hyper && passing {
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
        if let Some((p, _)) = self.preview.as_ref().filter(|_| passing) {
            frame.extend(p.iter().map(|(l, c)| (*l, *c)));
        }
        frame.retain(|l, _| *l < n); // a shape drawn on a bigger layout
        frame
    }

    /// The light-state main bytes the keyboard should have: per-key, or its own effect/shape.
    /// Effect numbers are the Air75 V3's; `board` maps them to its own.
    fn main_target(&self, board: &Board) -> Main {
        if self.hyper || !self.owns_keys() {
            return Main::Custom;
        }
        let b = &self.base;
        let level = int(b.get("level"), 100).clamp(0, 100) as u8;
        let speed = int(b.get("speed"), 2).clamp(0, 4) as u8;
        if self.base_name() == "effect" {
            let mut mode = int(b.get("mode"), 6).clamp(0, 255) as u8;
            if board.effect_mode(mode).is_none() {
                mode = 6;
            }
            let [r, g, bl] = rgb(b.get("color"), [255, 170, 110]);
            let rainbow = b.get("rgb").and_then(Value::as_bool).unwrap_or(true) || (16..=20).contains(&mode);
            let dir = (int(b.get("direction"), 0) & 1) as u8;
            let wire = board.effect_mode(mode).unwrap_or(6);
            return Main::Firmware(vec![wire, level, speed, dir, rainbow as u8, 0, r, g, bl], None);
        }
        let [r, g, bl] = rgb(b.get("color2"), OFF);
        let [sr, sg, sb] = rgb(b.get("color"), [255, 0, 0]);
        let shape = (int(b.get("shape"), 0) & 7) as u8;
        Main::Firmware(vec![SHAPE_MODE, level, speed, 0, 0, 0, r, g, bl], Some(vec![shape, sr, sg, sb, speed]))
    }

    /// Side lights as Keylight keeps them: `[mode, brightness, speed, r, g, b]`, mode in Air75 V3 numbers.
    fn side_target(&self) -> [u8; 6] {
        let s = &self.side;
        let [r, g, b] = rgb(s.get("color"), [255, 255, 255]);
        [int(s.get("mode"), 2).clamp(0, 255) as u8, int(s.get("brightness"), 25).clamp(0, 100) as u8, int(s.get("speed"), 2).clamp(0, 4) as u8, r, g, b]
    }

    // ---- device ---------------------------------------------------------------------

    fn connect(&mut self) -> bool {
        if self.kb.is_some() {
            return true;
        }
        if !self.hid {
            return false;
        }
        if self.api.is_none() {
            self.api = HidApi::new().ok();
        }
        let Some(api) = self.api.as_mut() else { return false };
        let (allowed, halted) = (&self.allowed, &self.halted);
        let mut opened = None;
        let result = (|| -> Result<(Keyboard, Vec<u8>), hid::Error> {
            let kb = Keyboard::open(api, |b| may_open(allowed, halted, b))?;
            opened = Some(kb.pid);
            let base = kb.get(hid::GET_BASE, 0, 8, 0)?;
            if base[0] > 1 {
                return Err(hid::Error::Other(format!("unexpected OS mode {}", base[0])));
            }
            self.mode = base[0];
            Ok((kb, base))
        })();
        match result {
            Ok((kb, base)) => {
                let board = boards::by_pid(kb.pid).expect("hid opens only boards in the table");
                let fw = kb.get(hid::GET_FW, 0, 8, 0).ok();
                let firmware = fw.as_deref().and_then(hid::firmware_version);
                // An experimental board is read before anything is written, to check it's the board
                // its PID says (boards::Checks). Reads only; a failed read just leaves it read-only.
                self.checks = (board.status != Status::Supported).then(|| Checks {
                    firmware: firmware.clone(),
                    lights: kb.get(hid::GET_LIGHT_COUNT, 0, 1, 0).ok().map(|b| b[0]),
                    matrix: Matrix::read(&base, board),
                    light_state: kb.get(hid::GET_LIGHT, 0, board.light_state_len(firmware.as_deref()), self.mode).ok(),
                });
                self.device = json!({
                    "name": kb.name, "link": kb.link, "layout": board.id, "board": board.id,
                    "model": board.model, "variant": board.variant, "board_name": board.name(),
                    "status": if board.status == Status::Supported { "supported" } else { "experimental" },
                    "pid": format!("{:#06x}", kb.pid),
                    "firmware": firmware,
                    "os": if self.mode == 0 { "mac" } else { "windows" },
                })
                .as_object()
                .unwrap()
                .clone();
                // Keylight hasn't been setting this board's lights, so this is the user's own state.
                if let Some(state) = self.checks.as_ref().filter(|c| c.problem(board).is_none()).and_then(|c| c.light_state.clone()) {
                    if !self.experimental.contains(&board.id) {
                        self.original_light.insert(board.id.clone(), state);
                        self.save();
                    }
                }
                if let Some(c) = &self.checks {
                    self.device.insert("lights".into(), json!(c.lights));
                    self.device.insert("matrix".into(), json!(c.matrix.map(|m| [m.rows, m.cols, m.extra])));
                    self.device.insert("light_state".into(), json!(c.light_state));
                }
                self.pid = Some(kb.pid);
                self.kb = Some(kb);
                self.sent.clear();
                self.side_sent = None;
                self.main_sent = None;
                self.save = Save::default();
                self.last_error = None;
                self.read_sleep();
                if self.last_layout.as_deref() != Some(board.id.as_str()) {
                    self.last_layout = Some(board.id.clone());
                    self.save();
                }
                self.load_hyper_keys(true); // which shortcut keys exist depends on the layout
                self.fit_side_speed();
                true
            }
            Err(hid::Error::Waiting(pid)) => {
                let board = boards::by_pid(pid).expect("hid reports only boards in the table");
                // Seen, not opened: enough to name and draw it, and to offer Connect.
                self.device = json!({
                    "link": "cable", "layout": board.id, "board": board.id, "model": board.model, "variant": board.variant,
                    "board_name": board.name(), "status": "experimental", "pid": format!("{:#06x}", board.pid),
                })
                .as_object()
                .unwrap()
                .clone();
                let why = if self.halted.contains(&board.id) { "disconnected" } else { "waiting" };
                self.last_error = Some(format!("{why}: {}", board.id));
                false
            }
            Err(e) => {
                // An experimental board that failed right after opening isn't tried again by itself.
                if let Some(b) = opened.and_then(boards::by_pid).filter(|b| b.status != Status::Supported) {
                    self.halted.insert(b.id.clone());
                }
                self.last_error = Some(e.to_string());
                false
            }
        }
    }

    fn drop_kb(&mut self, e: hid::Error) {
        eprintln!("keylight: keyboard connection lost: {e}");
        if let Some(b) = self.connected().filter(|b| b.status != Status::Supported) {
            self.halted.insert(b.id.clone());
        }
        self.kb = None;
        self.pid = None;
        self.checks = None;
        self.sent.clear();
        self.side_sent = None;
        self.main_sent = None;
        self.save = Save::default();
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
        self.require_supported("Sleep settings")?;
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
        let result = self.flush_with(&kb, Instant::now());
        self.kb = Some(kb);
        if let Err(e) = result {
            self.drop_kb(e);
        }
    }

    fn flush_with(&mut self, kb: &impl Wire, now: Instant) -> Result<(), hid::Error> {
        if self.save.changed.is_some_and(|t| now.saturating_duration_since(t) >= BOARD_SAVES_AFTER) {
            self.save.flash = Some(self.sent.iter().map(|(l, c)| (*l, *c)).collect());
            self.save.changed = None;
        }
        let stale = self.save.mode_seen.is_none_or(|(t, _)| now.saturating_duration_since(t) >= MODE_FRESH);
        if stale && self.connected().is_some_and(|b| self.pokes(b, now)) {
            let base = kb.get(hid::GET_BASE, 0, 8, 0)?;
            self.save.mode_seen = Some((now, base[0] == self.mode));
        }
        let plan = self.plan(now);
        for (cmd, offset, data) in &plan.packets {
            kb.set(*cmd, *offset, data, self.mode)?;
            if !(*cmd == hid::SET_SIGNAL && plan.leds.is_empty()) {
                self.writes += 1; // a poke alone changes nothing the user sees
            }
        }
        if let Some(main) = plan.main {
            self.main_sent = Some(main);
        }
        if plan.repaint {
            self.sent.clear();
        }
        if !plan.leds.is_empty() || plan.poke.is_some() {
            self.save.changed = Some(now);
        }
        if !plan.leds.is_empty() {
            self.save.real = Some(now);
        }
        if let Some((_, c)) = plan.poke {
            self.save.pokes = c[0];
        }
        self.sent.extend(plan.leds);
        if let Some(side) = plan.side {
            self.side_sent = Some(side);
            self.side_last = Some(now);
        }
        Ok(())
    }

    /// Whether this flush pokes the hidden LED (`Save`): only on the ANSI Air75 V3 with firmware
    /// 1.0.23.6, the one traced (`TRACED`), while the board holds a change it hasn't saved, saving it
    /// would be wasted, and the last change is `NUDGE_EVERY` old.
    fn pokes(&self, board: &Board, now: Instant) -> bool {
        let Some(changed) = self.save.changed else { return false };
        let passing = self.hyper || self.preview.is_some();
        let wasted = passing || self.save.flash.as_ref().is_some_and(|f| *f == self.frame(false));
        let held_long = self.save.real.is_some_and(|t| now.saturating_duration_since(t) >= HOLD_FOR);
        // An effect or shape theme only paints keys for Hyper, the same each time, so the board saves
        // the highlight once and never again; a poke would make every Hyper cost a save.
        let traced = (board.pid, self.firmware()) == (TRACED.0, Some(TRACED.1));
        traced && !self.owns_keys() && wasted && !held_long && now.saturating_duration_since(changed) >= NUDGE_EVERY
    }

    /// The packets that bring the keyboard in line: light state (0xD6) and per-key colours (0xD8),
    /// nothing else. Empty when the board plugged in is read-only.
    fn plan(&self, now: Instant) -> Plan {
        let mut plan = Plan::default();
        let Some(board) = self.connected() else { return plan };
        if self.read_only().is_some() {
            return plan;
        }
        let state_len = board.light_state_len(self.firmware());
        // Never past the board's light state (17 bytes on all but new Air75 ANSI firmware).
        let light = |packets: &mut Vec<(u8, usize, Vec<u8>)>, offset: usize, data: &[u8]| {
            if offset + data.len() <= state_len {
                packets.push((hid::SET_LIGHT, offset, data.to_vec()));
            }
        };
        let main = self.main_target(board);
        let main_changed = self.main_sent.as_ref() != Some(&main);
        if main_changed {
            match &main {
                Main::Custom => light(&mut plan.packets, 0, &[board.custom_mode()]),
                Main::Firmware(a, b) => {
                    light(&mut plan.packets, 0, a);
                    if let Some(b) = b {
                        light(&mut plan.packets, 17, b);
                    }
                }
            }
            plan.main = Some(main.clone());
        }
        if main == Main::Custom {
            plan.repaint = main_changed; // repaint every key after an effect
            // A layout picked by hand can have more keys than the board; experimental boards never
            // get an LED past their own keys (the old 0xD8 handler doesn't bound it well).
            let limit = if board.status == Status::Supported { u8::MAX } else { board.key_leds };
            plan.leds = self.compose().into_iter().filter(|(l, c)| *l < limit && (plan.repaint || self.sent.get(l) != Some(c))).collect();
            let same_bank = self.save.mode_seen.is_some_and(|(t, ok)| ok && now.saturating_duration_since(t) < MODE_FRESH);
            if same_bank && self.pokes(board, now) {
                plan.poke = hidden_led(board).map(|l| (l, [self.save.pokes.wrapping_add(1), 0, 0]));
            }
            let mut payload: Vec<u8> = plan.leds.iter().flat_map(|(l, c)| [*l, c[0], c[1], c[2]]).collect();
            if let Some((l, c)) = plan.poke {
                payload.extend([l, c[0], c[1], c[2]]);
            }
            if !payload.is_empty() {
                plan.packets.push((hid::SET_SIGNAL, 0, payload));
            }
        }
        let side = self.side_target();
        let due = self.side_last.map_or(true, |t| now.saturating_duration_since(t) >= SIDE_MIN_INTERVAL);
        if self.side_sent != Some(side) && due {
            plan.packets.push((hid::SET_LIGHT, 9, side_bytes(board, side).to_vec()));
            plan.side = Some(side);
        }
        plan
    }

    /// The 0xD6 writes that put an experimental board's lights back as Keylight found them: main
    /// (offset 0, 9 bytes) and side (offset 9, 8 bytes), inside its 17-byte light state.
    fn restore_packets(&self, board: &Board) -> Vec<(u8, usize, Vec<u8>)> {
        match self.original_light.get(&board.id) {
            Some(s) if s.len() >= 17 && board.light_state_len(self.firmware()) == 17 && s[0] <= board.custom_mode() => {
                vec![(hid::SET_LIGHT, 0, s[0..9].to_vec()), (hid::SET_LIGHT, 9, s[9..17].to_vec())]
            }
            _ => vec![],
        }
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
        if self.wants_flush(n) {
            self.flush();
        }
    }

    /// Whether tick `n` flushes: every 5 s to retry connecting; for side lights that were rate-limited;
    /// every tick while the board has a change it hasn't saved (`Save`); and every 10 s anyway.
    fn wants_flush(&self, n: u64) -> bool {
        if self.pid.is_none() {
            return n % 20 == 0;
        }
        (n % 4 == 0 && self.side_sent != Some(self.side_target())) || n % 40 == 0 || self.save.changed.is_some()
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
                self.fit_side_speed();
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
                self.extra_hyper = msg.get("keys").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|k| boards::all().iter().any(|b| b.led(k).is_some())).collect()).unwrap_or_default();
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
            "diagnostics" => return self.diagnostics(),
            "connect" => {
                // The user lets Keylight open an experimental board (or open it again after an error).
                let id = msg.get("board").and_then(Value::as_str).or_else(|| self.device.get("board").and_then(Value::as_str)).unwrap_or("").to_string();
                match boards::by_id(&id) {
                    Some(b) if b.status == Status::Experimental => {
                        self.allowed.insert(id.clone());
                        self.halted.remove(&id);
                        self.save();
                    }
                    _ => return Err(format!("{id:?} isn't an experimental board")),
                }
            }
            "experimental" => {
                // Lets Keylight write lighting to the experimental board plugged in. It still won't
                // if the board didn't answer as expected (read_only).
                let Some(board) = self.connected().filter(|b| b.status == Status::Experimental) else {
                    return Err("no experimental keyboard plugged in".into());
                };
                if msg.get("on").and_then(Value::as_bool).unwrap_or(false) {
                    self.experimental.insert(board.id.clone());
                } else if self.experimental.remove(&board.id) {
                    // Put back the light state Keylight found, with the same 0xD6 writes it uses.
                    let packets = self.restore_packets(board);
                    if !packets.is_empty() {
                        self.with_kb(|kb, mode| packets.iter().try_for_each(|(cmd, off, data)| kb.set(*cmd, *off, data, mode)))?;
                        self.writes += packets.len() as u64;
                    }
                }
                self.sent.clear();
                self.side_sent = None;
                self.side_last = None;
                self.main_sent = None;
                self.save();
            }
            "reload" => self.load_hyper_keys(true),
            "layout" => {
                self.layout_override = msg.get("layout").and_then(Value::as_str).filter(|id| boards::by_id(id).is_some()).map(String::from);
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
        self.require_supported("Keymaps")?;
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
        self.require_supported("Keymap backups")?;
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
        self.require_supported("Keymaps")?;
        let addr = layer as usize * hid::LAYER_BYTES + 2 * index as usize;
        self.with_kb(|kb, _| kb.set(hid::SET_KEYS, addr, &[(word >> 8) as u8, word as u8], 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// The raw 2048-byte macro block for one OS mode (decoded by the app).
    fn macros(&mut self, msg: &Value) -> Result<Value, String> {
        self.require_supported("Macros")?;
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
        self.require_supported("Macros")?;
        self.with_kb(|kb, _| kb.set(hid::SET_MACRO, os * hid::MACRO_BYTES, &bytes, 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// The advanced-key tables, whole (decoded by the app). `table` picks one; without it, all three.
    fn advanced(&mut self, msg: &Value) -> Result<Value, String> {
        self.require_supported("Advanced keys")?;
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
        self.require_supported("Advanced keys")?;
        self.with_kb(|kb, _| kb.set(t.set, offset, &bytes, 0))?;
        self.writes += 1;
        Ok(Value::Null)
    }

    /// Keyboard settings for the current OS mode: anti-chatter level and the Windows-key locks.
    /// With fields in the message, writes those first.
    fn func(&mut self, msg: &Value) -> Result<Value, String> {
        let fields = ["stabilization", "disable_win", "disable_alt_f4", "disable_alt_tab"];
        let patch: Vec<(usize, u8)> = fields.iter().enumerate().filter_map(|(i, k)| msg.get(*k).and_then(|v| v.as_f64().or(v.as_bool().map(|b| b as u8 as f64))).map(|v| (i, v as u8))).collect();
        // Read or write, only on the Air75 V3 for now.
        self.require_supported("Typing settings")?;
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

    /// Everything a tester needs to send us, read fresh from the keyboard: device info, LED count,
    /// key matrix, light state and the stock keymap's base layers. Reads only.
    fn diagnostics(&mut self) -> Result<Value, String> {
        if !self.connect() {
            return Err(self.last_error.clone().unwrap_or_else(|| "keyboard not connected".into()));
        }
        let board = self.connected().ok_or("unknown keyboard")?;
        let state_len = board.light_state_len(self.firmware());
        let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        let words = |b: &[u8]| b.chunks(2).map(|w| format!("{:04x}", (w[0] as u16) << 8 | w[1] as u16)).collect::<Vec<_>>().join(" ");
        let read = self.with_kb(|kb, mode| {
            let base = kb.get(hid::GET_BASE, 0, 8, 0)?;
            let fw = kb.get(hid::GET_FW, 0, 8, 0)?;
            let lights = kb.get(hid::GET_LIGHT_COUNT, 0, 1, 0).ok().map(|b| b[0]);
            let state = kb.get(hid::GET_LIGHT, 0, state_len, mode).ok();
            let sleep = kb.get(hid::GET_SLEEP, 0, 4, 0).ok();
            // The stock keymap's two base layers (Mac, Windows), sized from 0xA0 as NuPhy IO does.
            let matrix = Matrix::read(&base, board).filter(|m| (1..=8).contains(&m.rows) && (1..=24).contains(&m.cols));
            let mut defaults = Vec::new();
            if let Some(m) = matrix {
                let n = m.layer_bytes();
                for layer in [0, 4] {
                    defaults.push(kb.get(hid::GET_DEFAULT_KEYS, layer * n, n, 0).ok());
                }
            }
            Ok((base, fw, lights, state, sleep, matrix, defaults))
        })?;
        let (base, fw, lights, state, sleep, matrix, defaults) = read;
        let checks = Checks { firmware: hid::firmware_version(&fw), lights, matrix, light_state: state.clone() };
        Ok(json!({
            "keylight": env!("CARGO_PKG_VERSION"),
            "board": board.id,
            "name": board.name(),
            "status": if board.status == Status::Supported { "supported" } else { "experimental" },
            "pid": format!("{:#06x}", board.pid),
            "product": self.device.get("name"),
            "firmware": hid::firmware_version(&fw),
            "os_mode": self.mode,
            "led_count": lights,
            "expected_led_count": board.lights,
            "key_leds": board.key_leds,
            "side_leds": board.side_leds,
            "matrix": matrix.map(|m| json!({ "rows": m.rows, "cols": m.cols, "extra": m.extra, "layer_bytes": m.layer_bytes() })),
            "check": checks.problem(board).unwrap_or_else(|| "ok".into()),
            "raw": {
                "base_a0": hex(&base),
                "firmware_a1": hex(&fw),
                "light_state_d5": state.as_deref().map(hex),
                "sleep_f3": sleep.as_deref().map(hex),
                "default_keys_b1": { "layer0": defaults.first().cloned().flatten().as_deref().map(words), "layer4": defaults.get(1).cloned().flatten().as_deref().map(words) },
            },
        }))
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
            let layout = self.board();
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
            "layout": self.board().id,
            "layout_override": self.layout_override,
            "read_only": self.read_only(),
            // Why an experimental board didn't pass its checks at connect, if it didn't.
            "check_problem": self.connected().zip(self.checks.as_ref()).and_then(|(b, c)| c.problem(b)),
            "experimental": self.connected().is_some_and(|b| self.experimental.contains(&b.id)),
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
            "frame": (0..self.board().key_leds).map(|l| frame.get(&l).copied().unwrap_or(OFF)).collect::<Vec<_>>(),
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
    use std::sync::atomic::{AtomicU32, Ordering};

    /// An engine that can't open a keyboard, with a board "plugged in" by hand: plans are built,
    /// never sent.
    fn engine() -> Engine {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("keylight-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        Engine::with_hid(dir.join("state.json"), false)
    }

    fn plug(e: &mut Engine, pid: u16, firmware: &str) {
        let b = boards::by_pid(pid).unwrap();
        e.pid = Some(pid);
        e.device = json!({ "board": b.id, "firmware": firmware }).as_object().unwrap().clone();
        e.checks = (b.status == Status::Experimental).then(|| Checks {
            firmware: Some(firmware.to_string()),
            lights: Some(b.lights.unwrap_or(b.key_leds + b.side_leds)),
            matrix: Some(b.matrix),
            light_state: Some(vec![b.custom_mode(); 17]),
        });
    }

    fn base(e: &mut Engine, v: Value) {
        e.base = v.as_object().unwrap().clone();
    }

    /// The light-state writes in a plan, as (offset, bytes).
    fn lights(p: &Plan) -> Vec<(usize, Vec<u8>)> {
        p.packets.iter().filter(|(c, _, _)| *c == hid::SET_LIGHT).map(|(_, o, d)| (*o, d.clone())).collect()
    }

    fn signal(p: &Plan) -> Option<&Vec<u8>> {
        p.packets.iter().find(|(c, _, _)| *c == hid::SET_SIGNAL).map(|(_, _, d)| d)
    }

    #[test]
    fn never_opens_a_keyboard_in_tests() {
        let mut e = engine();
        assert!(e.handle(&json!({ "op": "base", "name": "rainbow" })).is_ok());
        assert!(e.kb.is_none() && e.writes == 0);
        assert!(e.plan(Instant::now()).packets.is_empty(), "nothing plugged in");
    }

    #[test]
    fn the_air75_is_written_as_before() {
        let mut e = engine();
        plug(&mut e, 0x1028, "1.0.23.6");
        let p = e.plan(Instant::now());
        let l = lights(&p);
        assert_eq!(l[0], (0, vec![21]));
        assert_eq!(l[1], (9, vec![2, 25, 2, 0, 0, 255, 255, 255]), "side: static, as before");
        assert_eq!(signal(&p).unwrap().len(), 84 * 4, "every key LED, the spare one too");
    }

    #[test]
    fn experimental_boards_stay_read_only() {
        let mut e = engine();
        plug(&mut e, 0x102B, "1.0.5.6"); // Air65 V3
        assert!(e.read_only().is_some());
        assert!(e.plan(Instant::now()).packets.is_empty(), "nothing until experimental lighting is on");
        e.experimental.insert("air65-v3".into());
        assert_eq!(e.read_only(), None);
        let p = e.plan(Instant::now());
        assert_eq!(lights(&p)[0], (0, vec![21]));
        let leds: Vec<u8> = signal(&p).unwrap().chunks(4).map(|c| c[0]).collect();
        assert_eq!(leds.len(), 68);
        assert!(leds.iter().all(|l| *l < 68));
        // A board that answers differently stays read-only, whatever the user picked.
        e.checks.as_mut().unwrap().lights = Some(104);
        assert!(e.read_only().is_some());
        assert!(e.plan(Instant::now()).packets.is_empty());
        e.checks = None; // no answers at all
        assert!(e.plan(Instant::now()).packets.is_empty());
        // Firmware older than the research traced stays read-only, with the reason.
        let mut old = engine();
        plug(&mut old, 0x102B, "1.0.4.6");
        old.experimental.insert("air65-v3".into());
        assert!(old.read_only().unwrap().contains("1.0.5.6 or later"));
        assert!(old.plan(Instant::now()).packets.is_empty());
    }

    #[test]
    fn never_past_an_experimental_boards_keys() {
        let mut e = engine();
        plug(&mut e, 0x102B, "1.0.5.6");
        e.experimental.insert("air65-v3".into());
        e.layout_override = Some("air65-v3-jis".into()); // 72 key LEDs
        assert_eq!(e.board().key_leds, 72);
        let leds: Vec<u8> = signal(&e.plan(Instant::now())).unwrap().chunks(4).map(|c| c[0]).collect();
        assert!(leds.iter().all(|l| *l < 68), "{leds:?}");
        // An override for another keyboard is ignored.
        e.layout_override = Some("jis".into());
        assert_eq!(e.board().id, "air65-v3");
    }

    #[test]
    fn experimental_boards_are_opened_only_after_connect() {
        let mut e = engine();
        let air65 = boards::by_id("air65-v3").unwrap();
        assert!(e.may_open(boards::ansi()), "the Air75 V3 always");
        assert!(!e.may_open(air65), "not before the user clicks Connect");
        assert!(e.handle(&json!({ "op": "connect", "board": "air65-v3" })).is_ok());
        assert!(e.may_open(air65));
        assert!(!e.may_open(boards::by_id("node75").unwrap()), "per board");
        // After an error, not by itself; Connect again opens it.
        e.halted.insert("air65-v3".into());
        assert!(!e.may_open(air65));
        assert!(e.handle(&json!({ "op": "connect" , "board": "air65-v3" })).is_ok());
        assert!(e.may_open(air65));
        assert!(e.handle(&json!({ "op": "connect", "board": "ansi" })).is_err());
        // Saved across restarts.
        let again = Engine::with_hid(e.path.clone(), false);
        assert!(again.may_open(air65));
    }

    #[test]
    fn switching_experimental_lighting_off_restores_the_lights() {
        let mut e = engine();
        plug(&mut e, 0x102B, "1.0.5.6");
        let board = boards::by_id("air65-v3").unwrap();
        assert!(e.restore_packets(board).is_empty(), "nothing saved yet");
        let found = vec![6, 80, 2, 0, 1, 0, 255, 170, 110, 3, 40, 2, 0, 0, 0, 120, 255];
        e.original_light.insert("air65-v3".into(), found.clone());
        assert_eq!(e.restore_packets(board), vec![(hid::SET_LIGHT, 0, found[0..9].to_vec()), (hid::SET_LIGHT, 9, found[9..17].to_vec())]);
        e.original_light.insert("air65-v3".into(), vec![30; 17]);
        assert!(e.restore_packets(board).is_empty(), "a mode the board doesn't have isn't written back");
    }

    #[test]
    fn halo_custom_mode_and_effects() {
        let mut e = engine();
        plug(&mut e, 0x102C, "1.0.7.6"); // Halo75 V2
        e.experimental.insert("halo75-v2".into());
        assert_eq!(lights(&e.plan(Instant::now()))[0], (0, vec![20]));
        base(&mut e, json!({ "name": "effect", "mode": 19, "speed": 1 })); // Windmill
        assert_eq!(lights(&e.plan(Instant::now()))[0].1[0], 18);
        base(&mut e, json!({ "name": "effect", "mode": 18 })); // Identify: not on Halo
        assert_eq!(lights(&e.plan(Instant::now()))[0].1[0], 6);
    }

    #[test]
    fn no_shape_mode_without_firmware_shapes() {
        let shape = json!({ "name": "shape", "shape": 0, "color": [255, 0, 0] });
        for (pid, fw) in [(0x102A, "1.0.16.6"), (0x1029, "1.0.16.6"), (0x1028, "1.0.16.6")] {
            let mut e = engine();
            plug(&mut e, pid, fw);
            base(&mut e, shape.clone());
            let p = e.plan(Instant::now());
            assert!(lights(&p).iter().all(|(o, d)| *o + d.len() <= 17 && d[0] != SHAPE_MODE), "{pid:#x}");
            assert!(signal(&p).is_some(), "Keylight draws the heart itself");
        }
        let mut e = engine();
        plug(&mut e, 0x1028, "1.0.23.6");
        base(&mut e, shape);
        let l = lights(&e.plan(Instant::now()));
        assert_eq!(l[0].1[0], SHAPE_MODE);
        assert_eq!(l[1].0, 17);
    }

    #[test]
    fn side_modes_per_family() {
        let node = boards::by_pid(0x1030).unwrap();
        let kick = boards::by_pid(0x1026).unwrap();
        let air = boards::ansi();
        assert_eq!(side_bytes(node, [3, 50, 2, 1, 2, 3]), [2, 50, 2, 0, 0, 1, 2, 3], "Breathe is 2 on Node");
        assert_eq!(side_bytes(node, [2, 50, 2, 1, 2, 3]), [1, 50, 2, 0, 0, 1, 2, 3], "Static is 1");
        assert_eq!(side_bytes(node, [4, 50, 2, 1, 2, 3]), [1, 0, 2, 0, 0, 1, 2, 3], "Off: static at 0");
        assert_eq!(side_bytes(node, [1, 50, 2, 1, 2, 3]), [1, 50, 2, 0, 0, 1, 2, 3], "no Neon on Node: Static");
        assert_eq!(side_bytes(kick, [4, 50, 2, 1, 2, 3]), [2, 0, 2, 0, 0, 1, 2, 3]);
        assert_eq!(side_bytes(kick, [1, 50, 2, 1, 2, 3]), [1, 50, 2, 1, 0, 1, 2, 3], "Neon cycles colours");
        assert_eq!(side_bytes(air, [4, 50, 2, 1, 2, 3]), [4, 50, 2, 0, 0, 1, 2, 3], "the Air75 keeps mode 4");
        assert_eq!(side_bytes(air, [1, 50, 2, 1, 2, 3]), [1, 50, 2, 1, 0, 1, 2, 3]);
    }

    #[test]
    fn never_side_mode_5_or_more_on_an_air75() {
        // Above 4, the Air75 V3's side-mode setter stops taking new modes (FW 0xe2f8).
        for board in boards::all().iter().filter(|b| b.family == boards::Family::Air75) {
            for mode in 0..=255u8 {
                assert!(side_bytes(board, [mode, 50, 2, 1, 2, 3])[0] <= 4, "{} mode {mode}", board.id);
            }
            let mut e = engine();
            plug(&mut e, board.pid, "1.0.23.6");
            e.side.insert("mode".into(), json!(7));
            let side: Vec<_> = lights(&e.plan(Instant::now())).into_iter().filter(|(o, _)| *o == 9).collect();
            assert_eq!(side[0].1[0], 2, "{}: an unknown mode is sent as Static", board.id);
        }
    }

    #[test]
    fn never_side_speed_4_on_an_air75() {
        // At 4, the Air75 V3's side-speed setter stops taking new speeds (FW 0xe3f0).
        for board in boards::all().iter().filter(|b| b.family == boards::Family::Air75) {
            for speed in 0..=255u8 {
                assert!(side_bytes(board, [2, 50, speed, 1, 2, 3])[2] <= 3, "{} speed {speed}", board.id);
            }
        }
        assert_eq!(side_bytes(boards::by_pid(0x1030).unwrap(), [2, 50, 4, 1, 2, 3])[2], 4, "Node keeps its slowest");
        // A saved 4 becomes 3, and so does one the app asks for.
        let mut e = engine();
        e.side.insert("speed".into(), json!(4));
        e.save();
        let mut e = Engine::with_hid(e.path.clone(), false);
        assert_eq!(e.side["speed"], json!(3));
        e.handle(&json!({ "op": "side", "speed": 4 })).unwrap();
        assert_eq!(e.side["speed"], json!(3));
    }

    use crate::mockboard::MockBoard;

    /// An engine and a stand-in Air75 V3 run through time as the app runs them: the board's idle
    /// task every 50 ms, a tick every 250 ms, and each op flushed at once, as `handle` does.
    struct Sim {
        e: Engine,
        kb: MockBoard,
        t0: Instant,
        ms: u64,
        n: u64,
    }

    impl Sim {
        fn new(pid: u16, firmware: &str) -> Sim {
            let mut e = engine();
            plug(&mut e, pid, firmware);
            let t0 = Instant::now();
            let mut sim = Sim { e, kb: MockBoard::new(t0), t0, ms: 0, n: 0 };
            sim.flush();
            sim
        }

        fn air75() -> Sim {
            let mut sim = Sim::new(0x1028, "1.0.23.6");
            sim.e.hyper_keys = ["t", "s", "f"].map(String::from).into_iter().collect();
            sim.wait(3000); // the first frame is new to the board: saved once
            assert_eq!(sim.kb.records(), 1);
            sim
        }

        fn now(&self) -> Instant {
            self.t0 + Duration::from_millis(self.ms)
        }

        fn flush(&mut self) {
            let now = self.now();
            self.e.flush_with(&self.kb, now).unwrap();
        }

        fn wait(&mut self, ms: u64) {
            for _ in 0..ms / 50 {
                self.ms += 50;
                self.kb.run(self.now());
                if self.ms % 250 == 0 {
                    self.n += 1;
                    if self.e.wants_flush(self.n) {
                        self.flush();
                    }
                }
                self.check_frame();
            }
        }

        fn op(&mut self, msg: Value) {
            self.e.handle(&msg).unwrap();
            self.flush();
        }

        /// Hyper down for `ms`, then up, as Karabiner calls it.
        fn hyper(&mut self, ms: u64) {
            self.op(json!({ "op": "hyper", "on": true }));
            self.wait(ms);
            self.op(json!({ "op": "hyper", "on": false }));
        }

        /// The keys show exactly the frame: pokes go to a side LED, which per-key mode doesn't show.
        fn check_frame(&self) {
            if self.e.main_target(self.e.connected().unwrap()) != Main::Custom {
                return; // an effect: the board draws the keys itself
            }
            let shown = self.kb.shown();
            let off: Vec<_> = self.e.compose().into_iter().filter(|(l, c)| shown.get(*l as usize) != Some(c)).collect();
            assert!(off.is_empty(), "{off:?}");
        }
    }

    #[test]
    fn hyper_costs_the_flash_nothing_once_the_colours_are_saved() {
        let mut sim = Sim::air75();
        for i in 0..200 {
            sim.hyper(if i % 10 == 0 { 4000 } else { 300 }); // some long holds too
            sim.wait(if i % 3 == 0 { 400 } else { 6000 });
        }
        assert_eq!(sim.kb.records(), 1, "nothing new to save");
        // Keylight quits: the board saves the waiting colours once, as they are.
        sim.kb.run(sim.now() + Duration::from_secs(2));
        assert_eq!(sim.kb.records(), 2);
        assert!(sim.e.compose().iter().all(|(l, c)| sim.kb.flash()[*l as usize] == *c), "the keys as shown");
    }

    #[test]
    fn a_new_theme_is_saved_once_and_not_the_highlight() {
        let mut sim = Sim::air75();
        sim.op(json!({ "op": "base", "name": "rainbow" }));
        sim.wait(200);
        sim.hyper(2500); // Hyper while the board still waits to save the theme
        sim.wait(3000);
        assert_eq!(sim.kb.records(), 2, "the theme, once");
        let frame = sim.e.compose();
        assert!(frame.iter().all(|(l, c)| sim.kb.flash()[*l as usize] == *c), "the theme, exactly");
        for _ in 0..20 {
            sim.hyper(300);
            sim.wait(5000);
        }
        assert_eq!(sim.kb.records(), 2);
    }

    #[test]
    fn previews_and_shapes_save_only_what_stays() {
        let mut sim = Sim::air75();
        // Hovering over presets, then leaving them.
        for k in ["q", "w", "e"] {
            let mut leds = Map::new();
            leds.insert(boards::ansi().led(k).unwrap().to_string(), json!([255, 0, 0]));
            sim.op(json!({ "op": "preview", "leds": leds }));
            sim.wait(1500);
        }
        sim.op(json!({ "op": "preview", "leds": null }));
        sim.wait(3000);
        assert_eq!(sim.kb.records(), 1, "nothing stayed");
        // Painting a shape: saved once it's done.
        for k in ["a", "s", "d", "f"] {
            sim.op(json!({ "op": "layer", "name": "mine", "keys": [k], "color": [0, 255, 0] }));
            sim.wait(300);
        }
        sim.wait(3000);
        assert_eq!(sim.kb.records(), 2);
    }

    #[test]
    fn dim_and_dark_frames_are_held_too() {
        for level in [30, 0] {
            let mut sim = Sim::new(0x1028, "1.0.23.6");
            base(&mut sim.e, json!({ "name": "solid", "color": [255, 170, 110], "level": level }));
            sim.flush();
            sim.wait(3000);
            let records = sim.kb.records();
            sim.hyper(300);
            sim.wait(3000);
            sim.hyper(4000);
            sim.wait(3000);
            assert_eq!(sim.kb.records(), records, "level {level}");
        }
    }

    #[test]
    fn pokes_go_to_the_first_side_led_only() {
        let mut sim = Sim::air75();
        let before = sim.kb.ram();
        sim.hyper(300);
        sim.wait(5000);
        let after = sim.kb.ram();
        let changed: Vec<usize> = (84..104).filter(|l| before[*l] != after[*l]).collect();
        assert_eq!(changed, [84]);
    }

    #[test]
    fn the_board_is_held_ten_minutes_at_most() {
        let mut sim = Sim::air75();
        sim.hyper(300);
        sim.wait(9 * 60_000);
        assert_eq!(sim.kb.records(), 1, "held");
        sim.wait(2 * 60_000);
        assert_eq!(sim.kb.records(), 2, "saved once, ten minutes after Hyper");
        let packets = sim.kb.packets();
        sim.wait(60_000);
        assert_eq!(sim.kb.packets(), packets, "no more nudging");
        assert!(sim.e.compose().iter().all(|(l, c)| sim.kb.flash()[*l as usize] == *c), "saved as shown");
        sim.hyper(300); // Hyper again: held again
        sim.wait(60_000);
        assert_eq!(sim.kb.records(), 2);
    }

    #[test]
    fn effect_themes_save_the_highlight_once() {
        for theme in [json!({ "op": "base", "name": "effect", "mode": 6 }), json!({ "op": "base", "name": "shape", "shape": 0 })] {
            let mut sim = Sim::air75();
            sim.op(theme);
            sim.hyper(2000); // the first highlight is new to the board
            sim.wait(3000);
            let records = sim.kb.records();
            for _ in 0..30 {
                sim.hyper(2000);
                sim.wait(3000);
            }
            assert_eq!(sim.kb.records(), records);
        }
    }

    #[test]
    fn nudges_are_not_counted_as_changes() {
        let mut sim = Sim::air75();
        sim.hyper(300);
        let writes = sim.e.writes;
        let packets = sim.kb.packets();
        sim.wait(60_000);
        assert_eq!(sim.e.writes, writes);
        let nudges = sim.kb.packets() - packets;
        assert!((80..=120).contains(&nudges), "about two a second, got {nudges}");
    }

    #[test]
    fn only_the_traced_board_and_firmware_are_poked() {
        let idle_packets = |pid: u16, fw: &str| {
            let mut sim = Sim::new(pid, fw);
            sim.e.hyper_keys = ["t"].map(String::from).into_iter().collect();
            sim.wait(3000);
            sim.hyper(300);
            let packets = sim.kb.packets();
            sim.wait(10_000);
            sim.kb.packets() - packets
        };
        assert!(idle_packets(0x1028, "1.0.23.6") > 10, "ANSI 1.0.23.6 is held");
        for (pid, fw) in [(0x102A, "1.0.23.6"), (0x1029, "1.0.23.6"), (0x1028, "1.0.22.6"), (0x1028, "1.0.17.6"), (0x1028, "1.0.24.6")] {
            assert_eq!(idle_packets(pid, fw), 0, "{pid:#x} {fw}");
        }
    }

    #[test]
    fn no_pokes_while_the_board_is_in_the_other_os_mode() {
        let mut sim = Sim::air75();
        sim.kb.set_os(1); // switched to Windows on the keyboard; Keylight writes the Mac bank
        sim.hyper(300);
        let packets = sim.kb.packets();
        sim.wait(5000);
        assert_eq!(sim.kb.packets(), packets, "no pokes");
        // Back to Mac mid-hold, then away again: pokes start, and stop within the 10 s it's trusted.
        sim.kb.set_os(0);
        sim.hyper(300);
        sim.wait(11_000);
        let records = sim.kb.records();
        let packets = sim.kb.packets();
        sim.kb.set_os(1);
        sim.wait(12_000);
        assert_eq!(sim.kb.records(), records + 1, "one save once the switch is seen");
        let after = sim.kb.packets();
        sim.wait(5000);
        assert_eq!(sim.kb.packets(), after, "and no more pokes");
        assert!(after > packets);
    }

    #[test]
    fn experimental_boards_are_not_nudged() {
        let mut sim = Sim::new(0x102B, "1.0.5.6"); // Air65 V3
        sim.e.experimental.insert("air65-v3".into());
        sim.flush();
        sim.wait(3000);
        let packets = sim.kb.packets();
        sim.op(json!({ "op": "preview", "leds": { "1": [255, 0, 0] } }));
        sim.wait(10_000);
        assert_eq!(sim.kb.packets(), packets + 1, "the preview, nothing more");
    }

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
