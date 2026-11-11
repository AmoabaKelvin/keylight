//! Every NuPhy IO (S4) keyboard Keylight knows: PID, family, LED counts, key matrix, and which LED
//! sits under each key. The data is `src/lib/boards.gen.json` (written by scripts/gen-boards.mjs from
//! NuPhy IO's layouts), shared with the app. The Air75 V3 keeps its hand-written layouts (layout.rs).
//!
//! Only the Air75 V3 is `Supported`. Every other board is `Experimental`: Keylight reads it, and
//! writes nothing until the user turns on experimental lighting and the board answers as its entry
//! says it should (see `Checks`).

use crate::layout::Layout;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Boards that behave alike: the same light-mode numbers, side-light modes and custom mode.
/// BOARDS-2026-11.md §3.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Family {
    Air75,
    /// Air65 V3 and Air100 V3: like the Air75 V3, but no built-in shapes.
    Air,
    Kick,
    Node,
    Halo,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Supported,
    Experimental,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Matrix {
    pub rows: u8,
    pub cols: u8,
    /// Extra key words after the matrix: 2 knob turns, or 5 touch-bar actions on Node.
    pub extra: u8,
}

impl Matrix {
    /// Bytes per keymap layer: 2 per matrix position and per extra key.
    pub fn layer_bytes(self) -> usize {
        2 * (self.rows as usize * self.cols as usize + self.extra as usize)
    }

    /// As NuPhy IO reads 0xA0 GetBase: `[mode, layers, per mode, rows, cols, extra]`; extra is
    /// `b5 & 0x7F` if bit 7 is set, else 2 (PROTOCOL.md).
    pub fn from_base(b: &[u8]) -> Option<Matrix> {
        if b.len() < 6 {
            return None;
        }
        let extra = if b[5] & 0x80 != 0 { b[5] & 0x7F } else { 2 };
        Some(Matrix { rows: b[3], cols: b[4], extra })
    }

    /// `from_base` for a board we know. Where the board has the usual 2 extra keys, b5 counts only if
    /// it's exactly 0x82: Halo96 V2's firmware never writes it, so it's whatever was in the buffer.
    pub fn read(b: &[u8], board: &Board) -> Option<Matrix> {
        let m = Matrix::from_base(b)?;
        if board.matrix.extra == 2 && b[5] != 0x82 { Some(Matrix { extra: 2, ..m }) } else { Some(m) }
    }
}

pub struct Board {
    pub id: String,
    pub pid: u16,
    pub model: String,
    pub variant: String,
    pub family: Family,
    pub status: Status,
    pub key_leds: u8,
    pub side_leds: u8,
    /// What 0xD1 GetLightCount returns in NuPhy's current firmware, where we have it.
    pub lights: Option<u8>,
    /// The oldest firmware Keylight writes to: the version the research traced (experimental boards).
    pub min_fw: Option<String>,
    pub matrix: Matrix,
    leds: HashMap<String, u8>,
    rows: Vec<(u8, u8)>,
}

/// The most key LEDs any board has, for reading saved shapes before the board is known.
pub const MAX_KEY_LEDS: u8 = 128;

/// NuPhy keyboards on QMK, which use VIA instead of NuPhy IO. Keylight recognises them by PID but
/// never opens them (BOARDS-2026-11.md §5).
pub const QMK_BOARDS: [(u16, &str); 8] = [
    (0x3255, "Air60 V2"),
    (0x3246, "Air75 V2"),
    (0x3266, "Air96 V2"),
    (0x3275, "Gem80"),
    (0x3315, "Halo65 V2 (QMK)"),
    (0x32F5, "Halo75 V2 (QMK)"),
    (0x3302, "Halo96 V2 (QMK)"),
    (0x32D5, "Kick75 (QMK)"),
];

const DATA: &str = include_str!("../../src/lib/boards.gen.json");

pub fn all() -> &'static [Board] {
    static BOARDS: OnceLock<Vec<Board>> = OnceLock::new();
    BOARDS.get_or_init(|| {
        let data: Value = serde_json::from_str(DATA).expect("boards.gen.json");
        data["boards"].as_array().expect("boards").iter().map(parse).collect()
    })
}

pub fn by_pid(pid: u16) -> Option<&'static Board> {
    all().iter().find(|b| b.pid == pid)
}

pub fn by_id(id: &str) -> Option<&'static Board> {
    all().iter().find(|b| b.id == id)
}

pub fn ansi() -> &'static Board {
    by_id("ansi").expect("the ANSI Air75 V3")
}

fn parse(b: &Value) -> Board {
    let s = |k: &str| b[k].as_str().unwrap_or_else(|| panic!("board {k}")).to_string();
    let n = |k: &str| b[k].as_u64().unwrap_or_else(|| panic!("board {k}"));
    let id = s("id");
    let family = match b["family"].as_str() {
        Some("air75") => Family::Air75,
        Some("air") => Family::Air,
        Some("kick") => Family::Kick,
        Some("node") => Family::Node,
        Some("halo") => Family::Halo,
        f => panic!("board {id}: family {f:?}"),
    };
    let status = if b["status"] == "supported" { Status::Supported } else { Status::Experimental };
    let m = &b["matrix"];
    let matrix = Matrix { rows: m["rows"].as_u64().unwrap() as u8, cols: m["cols"].as_u64().unwrap() as u8, extra: m["extra"].as_u64().unwrap() as u8 };
    let key_leds = n("keyLeds") as u8;
    let (leds, rows) = match Layout::from_name(&id) {
        // The Air75 V3: hand-written in layout.rs.
        Some(l) => (l.leds(), l.row_ranges().to_vec()),
        None => {
            let keys = b["keys"].as_array().unwrap_or_else(|| panic!("board {id}: keys"));
            let leds = keys.iter().map(|k| (k[0].as_str().unwrap().to_string(), k[1].as_u64().unwrap() as u8)).collect();
            let rows = b["rows"].as_array().unwrap().iter().map(|r| (r[0].as_u64().unwrap() as u8, r[1].as_u64().unwrap() as u8)).collect();
            (leds, rows)
        }
    };
    Board {
        pid: n("pid") as u16,
        model: s("model"),
        variant: s("variant"),
        family,
        status,
        key_leds,
        side_leds: n("sideLeds") as u8,
        lights: b["lights"].as_u64().map(|v| v as u8),
        min_fw: b["minFw"].as_str().map(String::from),
        matrix,
        leds,
        rows,
        id,
    }
}

impl Board {
    /// "Air65 V3", or "Air65 V3 ISO" for the boards that come in several layouts.
    pub fn name(&self) -> String {
        if self.variant == "ANSI" { self.model.clone() } else { format!("{} {}", self.model, self.variant) }
    }

    /// Key id (as the app names keys) -> LED index.
    pub fn led(&self, key: &str) -> Option<u8> {
        self.leds.get(key).copied()
    }

    /// LED range [start, end) of each row, for themes that paint by row. The last row runs to `key_leds`.
    pub fn row_ranges(&self) -> &[(u8, u8)] {
        &self.rows
    }

    /// The light mode that shows the colours set with 0xD8: 21, but 20 on Halo, whose firmware has
    /// one effect fewer (BOARDS-2026-11.md §2.1).
    pub fn custom_mode(&self) -> u8 {
        if self.family == Family::Halo { 20 } else { 21 }
    }

    /// Keylight's effect numbers are the Air75 V3's (1-20). Halo has no Identify (18), so Windmill and
    /// Diagonal move down one. None if this board doesn't have the effect.
    pub fn effect_mode(&self, mode: u8) -> Option<u8> {
        match (self.family, mode) {
            (_, m) if !(1..=20).contains(&m) => None,
            (Family::Halo, 18) => None,
            (Family::Halo, m) if m > 18 => Some(m - 1),
            (_, m) => Some(m),
        }
    }

    /// Keylight's side-light modes are the Air75 V3's numbers: 0 Time (flowing), 1 Neon, 2 Static,
    /// 3 Breathe, and 4, which the Air75 shows as off. Returns the board's own mode, or None where
    /// it has no such mode; "off" is then brightness 0 (BOARDS-2026-11.md §3).
    pub fn side_mode(&self, mode: u8) -> Option<u8> {
        match self.family {
            // Mode 4 (Rhythm) looks dark on the Air75 V3, which Keylight has always used as Off.
            Family::Air75 => (mode <= 4).then_some(mode),
            // Same numbers on the Air65/Air100 V3, but Off is brightness 0 there, as NuPhy IO does it.
            // Kick75 has no Rhythm at all.
            Family::Air | Family::Kick => (mode <= 3).then_some(mode),
            // Flowing 0, Static 1, Breathe 2, Rhythm 3; no Neon.
            Family::Node => match mode {
                0 => Some(0),
                2 => Some(1),
                3 => Some(2),
                _ => None,
            },
            // Flowing 0, Neon 1, TwoColorCircle 2, Breathe 3, Static 4.
            Family::Halo => match mode {
                0 => Some(0),
                1 => Some(1),
                2 => Some(4),
                3 => Some(3),
                _ => None,
            },
        }
    }

    /// The side mode that cycles colours by itself, which gets the rainbow flag.
    pub fn side_rainbow(&self, wire: u8) -> bool {
        match self.family {
            Family::Node => wire == 0,
            _ => wire == 1,
        }
    }

    /// Light state bytes: 22 on firmware with built-in shapes, else 17 (BOARDS-2026-11.md §2.3).
    pub fn light_state_len(&self, firmware: Option<&str>) -> usize {
        if self.has_firmware_shapes(firmware) { 22 } else { 17 }
    }

    /// Built-in shapes (light mode 22) exist only on the ANSI Air75 V3 from 1.0.17.6, which is NuPhy
    /// IO's `presetShapeLightMode` gate. ISO/JIS firmware 1.0.16.6 turns 22 into 21, and no other board
    /// has the mode (BOARDS-2026-11.md §2.3).
    pub fn has_firmware_shapes(&self, firmware: Option<&str>) -> bool {
        self.pid == 0x1028 && firmware.is_some_and(|v| version(v) >= vec![1, 0, 17, 6])
    }
}

/// "1.0.23.6" -> [1, 0, 23, 6]. Kick75's "4.0.18.6" compares the same way.
pub fn version(v: &str) -> Vec<u32> {
    v.split('.').map(|n| n.parse::<u32>().unwrap_or(0)).collect()
}

/// What the board said at connect, against what its entry expects. A board that doesn't match
/// stays read-only.
#[derive(Clone, Debug, PartialEq)]
pub struct Checks {
    /// From 0xA1, as "1.0.5.6".
    pub firmware: Option<String>,
    /// 0xD1 GetLightCount, if it answered.
    pub lights: Option<u8>,
    /// From 0xA0 GetBase.
    pub matrix: Option<Matrix>,
    /// 0xD5 at the board's light-state length, if it answered.
    pub light_state: Option<Vec<u8>>,
}

impl Checks {
    /// Why per-key writes would be unsafe or wrong on this board, or None if it all matches.
    /// - 0xD1 must answer, cover every key and side LED Keylight would use, and equal the firmware's
    ///   count where we know it (the old 0xD8 handler writes past its buffer at `led == count`).
    /// - 0xA0 must give the board's matrix, so it's the board we think it is.
    /// - 0xD5 must answer at the expected length, with modes in range.
    pub fn problem(&self, board: &Board) -> Option<String> {
        if let Some(min) = &board.min_fw {
            match &self.firmware {
                None => return Some("it didn't say which firmware it runs (0xA1)".into()),
                Some(v) if version(v) < version(min) => return Some(format!("its firmware is {v}, and Keylight needs {min} or later; update it with NuPhy IO")),
                _ => {}
            }
        }
        let Some(lights) = self.lights else { return Some("it didn't say how many LEDs it has (0xD1)".into()) };
        if (lights as u16) < board.key_leds as u16 + board.side_leds as u16 || board.lights.is_some_and(|l| l != lights) {
            return Some(format!("it says it has {lights} LEDs, but a {} has {}", board.name(), board.lights.unwrap_or(board.key_leds + board.side_leds)));
        }
        match self.matrix {
            Some(m) if m == board.matrix => {}
            Some(m) => return Some(format!("its key matrix is {}x{}+{}, not {}x{}+{}", m.rows, m.cols, m.extra, board.matrix.rows, board.matrix.cols, board.matrix.extra)),
            None => return Some("it didn't send its key matrix (0xA0)".into()),
        }
        let Some(state) = &self.light_state else { return Some("it didn't send its light state (0xD5)".into()) };
        if state.len() < 17 || state[0] > board.custom_mode() {
            return Some(format!("its light state looks wrong ({state:?})"));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_board_parses() {
        let boards = all();
        assert!(boards.len() >= 28);
        let mut pids: Vec<u16> = boards.iter().map(|b| b.pid).collect();
        pids.sort();
        pids.dedup();
        assert_eq!(pids.len(), boards.len(), "one board per PID");
        for b in boards {
            assert!(b.key_leds <= MAX_KEY_LEDS, "{}", b.id);
            let rows = b.row_ranges();
            assert_eq!(rows[0].0, 0, "{}", b.id);
            assert_eq!(rows.last().unwrap().1, b.key_leds, "{}", b.id);
            assert!(rows.windows(2).all(|w| w[0].1 == w[1].0), "{} rows run on", b.id);
            assert!(b.leds.values().all(|l| *l < b.key_leds), "{}", b.id);
            if let Some(l) = b.lights {
                assert!(l >= b.key_leds + b.side_leds, "{}", b.id);
            }
            assert!(!QMK_BOARDS.iter().any(|(p, _)| *p == b.pid));
        }
    }

    #[test]
    fn only_the_air75_is_supported() {
        let supported: Vec<&str> = all().iter().filter(|b| b.status == Status::Supported).map(|b| b.id.as_str()).collect();
        assert_eq!(supported, ["ansi", "iso", "jis"]);
        assert_eq!(by_pid(0x1028).unwrap().id, "ansi");
        assert_eq!(by_pid(0x102A).unwrap().id, "iso");
        assert_eq!(by_pid(0x1029).unwrap().id, "jis");
        // The Air75 V3 data in the JSON agrees with layout.rs.
        for l in Layout::ALL {
            assert_eq!(by_id(l.name()).unwrap().key_leds, l.key_leds());
        }
    }

    #[test]
    fn generated_boards_light_their_keys() {
        let air65 = by_pid(0x102B).unwrap();
        assert_eq!((air65.family, air65.key_leds, air65.side_leds, air65.lights), (Family::Air, 68, 20, Some(88)));
        assert_eq!(air65.led("esc"), Some(0));
        assert_eq!(air65.led("bksp"), Some(13));
        // NuPhy's skip of 2 gives the knob's third slot LED 14, so Tab is 15 (BOARDS §3.1).
        assert_eq!(air65.led("tab"), Some(15));
        assert_eq!(air65.led("right"), Some(67));
        let node = by_pid(0x1030).unwrap();
        assert_eq!(node.led("del"), Some(15));
        assert_eq!(node.led("`"), Some(16));
        let halo = by_pid(0x102C).unwrap();
        assert_eq!(halo.custom_mode(), 20);
        assert_eq!(halo.matrix.layer_bytes(), 196);
        assert_eq!(by_pid(0x1037).unwrap().matrix.layer_bytes(), 238);
    }

    #[test]
    fn family_numbers() {
        let ansi = ansi();
        let halo = by_pid(0x102F).unwrap();
        let node = by_pid(0x1031).unwrap();
        let kick = by_pid(0x1026).unwrap();
        assert_eq!(ansi.custom_mode(), 21);
        assert_eq!((ansi.effect_mode(18), ansi.effect_mode(20), ansi.effect_mode(21)), (Some(18), Some(20), None));
        assert_eq!((halo.effect_mode(17), halo.effect_mode(18), halo.effect_mode(19), halo.effect_mode(20)), (Some(17), None, Some(18), Some(19)));
        assert_eq!((0..=4).map(|m| ansi.side_mode(m)).collect::<Vec<_>>(), [Some(0), Some(1), Some(2), Some(3), Some(4)]);
        assert_eq!((0..=4).map(|m| kick.side_mode(m)).collect::<Vec<_>>(), [Some(0), Some(1), Some(2), Some(3), None]);
        assert_eq!(by_pid(0x102B).unwrap().side_mode(4), None, "Air65: Off is brightness 0");
        assert_eq!((0..=4).map(|m| node.side_mode(m)).collect::<Vec<_>>(), [Some(0), None, Some(1), Some(2), None]);
        assert_eq!((0..=4).map(|m| halo.side_mode(m)).collect::<Vec<_>>(), [Some(0), Some(1), Some(4), Some(3), None]);
        assert!(node.side_rainbow(0) && !node.side_rainbow(1) && ansi.side_rainbow(1));
    }

    #[test]
    fn light_state_length() {
        let ansi = ansi();
        assert_eq!(ansi.light_state_len(Some("1.0.23.6")), 22);
        assert_eq!(ansi.light_state_len(Some("1.0.16.6")), 17);
        assert_eq!(ansi.light_state_len(None), 17);
        assert_eq!(by_id("iso").unwrap().light_state_len(Some("1.0.23.6")), 17);
        assert_eq!(by_pid(0x1026).unwrap().light_state_len(Some("4.0.18.6")), 17);
        assert!(!by_pid(0x1026).unwrap().has_firmware_shapes(Some("4.0.18.6")));
    }

    #[test]
    fn checks() {
        let air65 = by_pid(0x102B).unwrap();
        let state = Some(vec![21, 100, 2, 0, 1, 0, 255, 255, 255, 2, 25, 2, 0, 0, 255, 255, 255]);
        let fw = Some("1.0.5.6".to_string());
        let good = Checks { firmware: fw.clone(), lights: Some(88), matrix: Some(Matrix { rows: 5, cols: 15, extra: 2 }), light_state: state.clone() };
        assert_eq!(good.problem(air65), None);
        assert!(Checks { lights: Some(89), ..good.clone() }.problem(air65).is_some(), "wrong LED count");
        assert!(Checks { lights: None, ..good.clone() }.problem(air65).is_some());
        assert!(Checks { matrix: Some(Matrix { rows: 6, cols: 16, extra: 2 }), ..good.clone() }.problem(air65).is_some(), "an Air75's matrix");
        assert!(Checks { light_state: None, ..good.clone() }.problem(air65).is_some());
        assert!(Checks { firmware: Some("1.0.4.6".into()), ..good.clone() }.problem(air65).unwrap().contains("1.0.5.6 or later"));
        assert!(Checks { firmware: None, ..good.clone() }.problem(air65).is_some());
        assert_eq!(Checks { firmware: Some("1.0.10.6".into()), ..good.clone() }.problem(air65), None, "1.0.10 is newer than 1.0.5");
        // Unknown firmware count: anything that covers our LEDs.
        let iso = by_id("air100-v3-iso").unwrap();
        let ok = Checks { firmware: Some("1.0.6.6".into()), lights: Some(120), matrix: Some(iso.matrix), light_state: state.clone() };
        assert_eq!(ok.problem(iso), None);
        assert!(Checks { lights: Some(119), ..ok }.problem(iso).is_some(), "fewer LEDs than we'd write");
        assert_eq!(Matrix::from_base(&[0, 8, 4, 6, 16, 0x85, 0, 0]), Some(Matrix { rows: 6, cols: 16, extra: 5 }));
        assert_eq!(Matrix::from_base(&[0, 8, 4, 6, 18, 0, 0, 0]), Some(Matrix { rows: 6, cols: 18, extra: 2 }));
        // Halo96 V2 leaves b5 unwritten: garbage with bit 7 set still means 2 extra keys there.
        let halo96 = by_pid(0x102E).unwrap();
        assert_eq!(Matrix::read(&[0, 8, 4, 6, 18, 0x9F, 0, 0], halo96), Some(Matrix { rows: 6, cols: 18, extra: 2 }));
        assert_eq!(Matrix::read(&[0, 8, 4, 6, 18, 0x82, 0, 0], halo96), Some(halo96.matrix));
        // Node's 5 touch-bar words are read as sent.
        let node = by_pid(0x1030).unwrap();
        assert_eq!(Matrix::read(&[0, 8, 4, 6, 16, 0x85, 0, 0], node), Some(node.matrix));
        assert_eq!(Matrix::read(&[0, 8, 4, 6, 16, 0x82, 0, 0], node).map(|m| m.extra), Some(2));
    }
}
