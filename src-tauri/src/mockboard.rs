//! A stand-in Air75 V3 on firmware 1.0.23.6 for tests, modelling only what lighting writes do to its
//! flash. File offsets in the official 1.0.23.6 image:
//!
//! - 0xD8 (handler 0x157ee) keeps 104 colours in RAM. A packet that changes one sets the unsaved
//!   flag and stamps the time (0x158de-0x158ec); one that changes nothing does neither.
//! - In per-key mode (21) the custom renderer (0x9bc4) paints LEDs 0..83 only (it stops at 0x54,
//!   0x9bc8-0x9bea); LEDs 84..103 are drawn by the side renderer, never from these colours.
//! - The idle task (0x149c6) saves once the flag is set and more than 999 ms have passed: a 512-byte
//!   "NRGB" record (0x1468a), erasing one of the two 512-byte slots it alternates between.
//! - 0xD6 side mode (offset 9) above 4 latches the setter (0xe2f8 only stores while the current mode
//!   is 4 or less) and the side renderer skips its switch (0xf870). Keylight must never send it.
//! - 0xD6 side speed (offset 11) 4 latches its setter the same way (0xe3f0 only stores while the
//!   current speed is 3 or less).

use crate::engine::Wire;
use crate::hid;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct MockBoard {
    s: Mutex<State>,
}

struct State {
    now: Instant,
    ram: [[u8; 3]; 104],
    unsaved: bool,
    stamp: Instant,
    records: u32,
    flash: [[u8; 3]; 104],
    packets: u32,
    os: u8,
}

impl MockBoard {
    pub fn new(now: Instant) -> MockBoard {
        MockBoard { s: Mutex::new(State { now, ram: [[0; 3]; 104], unsaved: false, stamp: now, records: 0, flash: [[0; 3]; 104], packets: 0, os: 0 }) }
    }

    /// Runs the board's idle task up to `now`.
    pub fn run(&self, now: Instant) {
        let mut s = self.s.lock().unwrap();
        s.now = now;
        if s.unsaved && now.saturating_duration_since(s.stamp) > Duration::from_millis(999) {
            s.records += 1;
            s.flash = s.ram;
            s.unsaved = false;
        }
    }

    /// NRGB records written so far.
    pub fn records(&self) -> u32 {
        self.s.lock().unwrap().records
    }

    pub fn ram(&self) -> [[u8; 3]; 104] {
        self.s.lock().unwrap().ram
    }

    /// What the keys show in per-key mode: LEDs 0..83.
    pub fn shown(&self) -> Vec<[u8; 3]> {
        self.s.lock().unwrap().ram[..84].to_vec()
    }

    /// The colours in the last record.
    pub fn flash(&self) -> [[u8; 3]; 104] {
        self.s.lock().unwrap().flash
    }

    /// Switches the OS mode, as Fn does on the keyboard.
    pub fn set_os(&self, os: u8) {
        self.s.lock().unwrap().os = os;
    }

    /// 0xD8 packets received.
    pub fn packets(&self) -> u32 {
        self.s.lock().unwrap().packets
    }
}

impl Wire for MockBoard {
    fn set(&self, cmd: u8, offset: usize, data: &[u8], _bank: u8) -> Result<(), hid::Error> {
        let mut s = self.s.lock().unwrap();
        match cmd {
            hid::SET_SIGNAL => {
                assert_eq!(offset, 0);
                assert!(!data.is_empty() && data.len() % 4 == 0, "0xD8 takes [led, r, g, b] groups");
                // Keyboard::set sends 56 bytes a packet; the firmware stamps each one that changes a colour.
                for part in data.chunks(56) {
                    s.packets += 1;
                    let mut changed = false;
                    for g in part.chunks(4) {
                        assert!(g[0] < 104, "LED {} past the board", g[0]);
                        let c = [g[1], g[2], g[3]];
                        changed |= s.ram[g[0] as usize] != c;
                        s.ram[g[0] as usize] = c;
                    }
                    if changed {
                        s.unsaved = true;
                        s.stamp = s.now;
                    }
                }
            }
            hid::SET_LIGHT => {
                if offset <= 9 && 9 < offset + data.len() {
                    assert!(data[9 - offset] <= 4, "side mode {} sent to an Air75 V3", data[9 - offset]);
                }
                if offset <= 11 && 11 < offset + data.len() {
                    assert!(data[11 - offset] <= 3, "side speed {} sent to an Air75 V3", data[11 - offset]);
                }
            }
            _ => panic!("lighting sends only 0xD6 and 0xD8, not {cmd:#04x}"),
        }
        Ok(())
    }

    fn get(&self, cmd: u8, _offset: usize, total: usize, _bank: u8) -> Result<Vec<u8>, hid::Error> {
        assert_eq!(cmd, hid::GET_BASE, "lighting reads only 0xA0");
        let mut b = vec![0; total];
        b[0] = self.s.lock().unwrap().os;
        Ok(b)
    }
}
