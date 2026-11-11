//! The Air75 V3's three layouts as the engine needs them: which LED sits under each key, and the
//! LED range of each row. boards.rs uses these for the Air75 V3 and generated data for the rest. Mirrors `src/lib/layout.ts` (where the sources are); a key's LED index is
//! its place in reading order, row by row, skipping the knob.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layout {
    Ansi,
    Iso,
    Jis,
}

const FN_ROW: &[&str] = &["esc", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "screenshot", "ins"];

const ANSI: [&[&str]; 6] = [
    FN_ROW,
    &["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "bksp", "pgup"],
    &["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\", "pgdn"],
    &["caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter", "home"],
    &["lshift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "rshift", "up", "end"],
    &["lctrl", "lopt", "lcmd", "space", "rcmd", "fn", "rctrl", "left", "down", "right"],
];

/// ISO: Enter is two rows tall and lit from the Tab row; the key left of it sends Backslash; `nubs`
/// is the extra key by left Shift.
const ISO: [&[&str]; 6] = [
    FN_ROW,
    ANSI[1],
    &["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "enter", "pgdn"],
    &["caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "\\", "home"],
    &["lshift", "nubs", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "rshift", "up", "end"],
    ANSI[5],
];

/// JIS: ¥ before a 1u Backspace, ISO-style Enter, `]` sends 0x32 (`nuhs`), ろ, and no Right ⌘.
const JIS: [&[&str]; 6] = [
    FN_ROW,
    &["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "yen", "bksp", "pgup"],
    ISO[2],
    &["caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "nuhs", "home"],
    &["lshift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "ro", "rshift", "up", "end"],
    &["lctrl", "lopt", "lcmd", "mhen", "space", "henk", "kana", "fn", "rctrl", "left", "down", "right"],
];

impl Layout {
    pub const ALL: [Layout; 3] = [Layout::Ansi, Layout::Iso, Layout::Jis];

    pub fn from_name(name: &str) -> Option<Layout> {
        Layout::ALL.into_iter().find(|l| l.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Layout::Ansi => "ansi",
            Layout::Iso => "iso",
            Layout::Jis => "jis",
        }
    }

    fn rows(self) -> &'static [&'static [&'static str]; 6] {
        match self {
            Layout::Ansi => &ANSI,
            Layout::Iso => &ISO,
            Layout::Jis => &JIS,
        }
    }

    /// Key LEDs in the frame. ANSI keeps the spare LED after its last key that it has always painted;
    /// ISO and JIS stop at their last key.
    pub fn key_leds(self) -> u8 {
        match self {
            Layout::Ansi => 84,
            Layout::Iso => 84,
            Layout::Jis => 87,
        }
    }

    /// LED range [start, end) of each row, for themes that paint by row. The last row runs to `key_leds`.
    pub fn row_ranges(self) -> [(u8, u8); 6] {
        let mut out = [(0, 0); 6];
        let mut start = 0u8;
        for (r, row) in self.rows().iter().enumerate() {
            let end = if r == 5 { self.key_leds() } else { start + row.len() as u8 };
            out[r] = (start, end);
            start += row.len() as u8;
        }
        out
    }

    /// Every key id -> its LED.
    pub fn leds(self) -> std::collections::HashMap<String, u8> {
        self.rows().iter().flat_map(|r| r.iter()).enumerate().map(|(i, k)| (k.to_string(), i as u8)).collect()
    }

    /// Key id (as the app names keys) -> LED index.
    #[cfg(test)]
    pub fn led(self, name: &str) -> Option<u8> {
        self.rows().iter().flat_map(|r| r.iter()).position(|k| *k == name).map(|i| i as u8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ANSI map as engine.rs had it before ISO/JIS, so ANSI boards light exactly as before.
    fn old_ansi_led(name: &str) -> Option<u8> {
        let fixed: &[(&str, u8)] = &[
            ("esc", 0), ("screenshot", 13), ("ins", 14), ("`", 15), ("-", 26), ("=", 27), ("bksp", 28), ("pgup", 29),
            ("tab", 30), ("[", 41), ("]", 42), ("\\", 43), ("pgdn", 44), ("caps", 45), (";", 55), ("'", 56), ("enter", 57),
            ("home", 58), ("lshift", 59), (",", 67), (".", 68), ("/", 69), ("rshift", 70), ("up", 71), ("end", 72),
            ("lctrl", 73), ("lopt", 74), ("lcmd", 75), ("space", 76), ("rcmd", 77), ("fn", 78), ("rctrl", 79),
            ("left", 80), ("down", 81), ("right", 82),
        ];
        if let Some((_, l)) = fixed.iter().find(|(n, _)| *n == name) {
            return Some(*l);
        }
        if let Some(n) = name.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).filter(|n| (1..=12).contains(n)) {
            return Some(n);
        }
        for (row, start) in [("1234567890", 16u8), ("qwertyuiop", 31), ("asdfghjkl", 46), ("zxcvbnm", 60)] {
            if name.len() == 1 {
                if let Some(i) = row.find(name) {
                    return Some(start + i as u8);
                }
            }
        }
        None
    }

    #[test]
    fn ansi_is_unchanged() {
        for name in ANSI.iter().flat_map(|r| r.iter()) {
            assert_eq!(Layout::Ansi.led(name), old_ansi_led(name), "{name}");
        }
        assert_eq!(ANSI.iter().map(|r| r.len()).sum::<usize>(), 83);
        assert_eq!(Layout::Ansi.row_ranges(), [(0, 15), (15, 30), (30, 45), (45, 59), (59, 73), (73, 84)]);
    }

    /// Same key order as `src/lib/layout.ts` (printed from BOARDS there), so the app and engine agree.
    #[test]
    fn matches_the_app() {
        let app: [(Layout, &[&str]); 2] = [
            (Layout::Iso, &["esc", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "screenshot", "ins", "`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "bksp", "pgup", "tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "enter", "pgdn", "caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "\\", "home", "lshift", "nubs", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "rshift", "up", "end", "lctrl", "lopt", "lcmd", "space", "rcmd", "fn", "rctrl", "left", "down", "right"]),
            (Layout::Jis, &["esc", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "screenshot", "ins", "`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "yen", "bksp", "pgup", "tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "enter", "pgdn", "caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "nuhs", "home", "lshift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "ro", "rshift", "up", "end", "lctrl", "lopt", "lcmd", "mhen", "space", "henk", "kana", "fn", "rctrl", "left", "down", "right"]),
        ];
        for (layout, keys) in app {
            for (i, k) in keys.iter().enumerate() {
                assert_eq!(layout.led(k), Some(i as u8), "{layout:?} {k}");
            }
            assert_eq!(keys.len() as u8, layout.key_leds());
        }
        assert_eq!(Layout::Iso.row_ranges(), [(0, 15), (15, 30), (30, 45), (45, 59), (59, 74), (74, 84)]);
        assert_eq!(Layout::Jis.row_ranges(), [(0, 15), (15, 31), (31, 46), (46, 60), (60, 75), (75, 87)]);
        assert_eq!(Layout::Jis.led("rcmd"), None);
    }
}
