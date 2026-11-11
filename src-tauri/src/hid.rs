//! The vendor protocol of NuPhy's NuPhy IO keyboards, the Air75 V3 first (recovered from NuPhy IO;
//! see docs/PROTOCOL.md). Every board in `boards.rs` speaks it.
//!
//! 64-byte reports on the vendor interface (usage page 1, usage 0): `55 cmd 00 sum | len off_lo
//! off_hi bank | data`, everything from byte 4 XOR'd with a session key agreed by SetSecretKey.
//! Replies start `AA cmd status`. Only the commands in `ALLOWED` can ever be sent: never the
//! bootloader, factory reset, or keymap-wiping ones.

use crate::boards;
use hidapi::{HidApi, HidDevice};
use std::io::Read;
use std::time::{Duration, Instant};

pub const VID: u16 = 0x19F5;
/// The 2.4G dongle. It answers the handshake and its own firmware query, but doesn't pass
/// settings through to the Air75 V3 (NuPhy IO only lists it as a dongle, not a keyboard), so
/// it's only used to tell people to plug in the cable.
pub const DONGLE_PID: u16 = 0x2620;
const CHUNK: usize = 56;

pub const GET_BASE: u8 = 0xA0;
pub const GET_FW: u8 = 0xA1;
/// One byte: how many LEDs the board has, keys and side lights. A constant in every firmware.
pub const GET_LIGHT_COUNT: u8 = 0xD1;
pub const GET_LIGHT: u8 = 0xD5;
pub const SET_LIGHT: u8 = 0xD6;
pub const SET_SIGNAL: u8 = 0xD8;
pub const SET_KEY: u8 = 0xEE;
pub const GET_SLEEP: u8 = 0xF3;
pub const SET_SLEEP: u8 = 0xF5;
pub const GET_DEFAULT_KEYS: u8 = 0xB1;
pub const GET_KEYS: u8 = 0xB2;
pub const SET_KEYS: u8 = 0xB3;
pub const GET_MACRO: u8 = 0xC2;
pub const SET_MACRO: u8 = 0xC3;
pub const GET_FUNC: u8 = 0xE1;
pub const SET_FUNC: u8 = 0xE2;
pub const GET_SOCD: u8 = 0xB5;
pub const SET_SOCD: u8 = 0xB6;
pub const GET_TAP_DANCE: u8 = 0xB8;
pub const SET_TAP_DANCE: u8 = 0xB9;
pub const GET_TGL: u8 = 0xBB;
pub const SET_TGL: u8 = 0xBC;
/// Everything Keylight may send. Not here, on purpose: 0xEF (bootloader), 0xF1 (factory reset),
/// 0xB4/0xB7/0xBA/0xBD (wipe keymaps and advanced keys), 0xFC, 0xFE and the firmware-only handlers.
/// Nor 0xD2 GetKeyLightColor: NuPhy IO reads it, but its firmware handler calls through a pointer
/// we couldn't trace, so it isn't proven to be only a read.
/// The advanced-key tables are read and written one entry at a time (see `engine::Table`); their
/// reset commands are left out, and an unused entry is cleared by writing zeros.
const ALLOWED: [u8; 22] = [
    GET_BASE, GET_FW, GET_LIGHT_COUNT, GET_LIGHT, SET_LIGHT, SET_SIGNAL, SET_KEY, GET_SLEEP, SET_SLEEP, GET_DEFAULT_KEYS, GET_KEYS, SET_KEYS, GET_MACRO, SET_MACRO, GET_FUNC, SET_FUNC,
    GET_SOCD, SET_SOCD, GET_TAP_DANCE, SET_TAP_DANCE, GET_TGL, SET_TGL,
];
/// Bytes per keymap layer on the Air75 V3: 6 x 16 matrix plus 2 knob positions, 2 bytes each.
/// Other boards say theirs in 0xA0 (`boards::Matrix`).
pub const LAYER_BYTES: usize = 196;
pub const MACRO_BYTES: usize = 2048;

#[derive(Debug)]
pub enum Error {
    /// No keyboard or dongle plugged in.
    Unplugged,
    /// The keyboard said no to a command (status 0xFF).
    NotLinked,
    /// Only the 2.4G dongle is plugged in; settings need the USB cable.
    DongleOnly,
    /// A NuPhy keyboard that doesn't speak this protocol (the QMK boards). Never opened.
    Unsupported(&'static str),
    Other(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Error::Unplugged => write!(f, "unplugged"),
            Error::NotLinked => write!(f, "refused"),
            Error::DongleOnly => write!(f, "dongle"),
            Error::Unsupported(name) => write!(f, "unsupported: {name}"),
            Error::Other(e) => write!(f, "{e}"),
        }
    }
}

impl From<hidapi::HidError> for Error {
    fn from(e: hidapi::HidError) -> Self {
        Error::Other(e.to_string())
    }
}

pub struct Keyboard {
    dev: HidDevice,
    key: u8,
    pub name: String,
    pub link: &'static str,
    pub pid: u16,
}

impl Keyboard {
    pub fn open(api: &mut HidApi) -> Result<Keyboard, Error> {
        api.refresh_devices()?;
        // Only PIDs in the board table are opened; the Air75 V3 first, as before.
        let mut boards: Vec<&boards::Board> = boards::all().iter().collect();
        boards.sort_by_key(|b| b.status != boards::Status::Supported);
        for board in boards {
            let pid = board.pid;
            let found = api.device_list().find(|d| d.vendor_id() == VID && d.product_id() == pid && d.usage_page() == 1 && d.usage() == 0);
            if let Some(info) = found {
                let dev = info.open_device(api)?;
                let name = info.product_string().map(str::to_string).unwrap_or_else(|| board.name());
                let mut kb = Keyboard { dev, key: 0, name, link: "cable", pid };
                kb.handshake()?;
                return Ok(kb);
            }
        }
        if api.device_list().any(|d| d.vendor_id() == VID && d.product_id() == DONGLE_PID) {
            return Err(Error::DongleOnly);
        }
        // Seen in the device list only: nothing is opened or sent.
        if let Some((_, name)) = boards::QMK_BOARDS.iter().find(|(pid, _)| api.device_list().any(|d| d.vendor_id() == VID && d.product_id() == *pid)) {
            return Err(Error::Unsupported(name));
        }
        Err(Error::Unplugged)
    }

    fn send(&self, pkt: &[u8; 64], cmd: u8) -> Result<[u8; 64], Error> {
        assert!(ALLOWED.contains(&pkt[1]), "command not allowed");
        let mut out = [0u8; 65];
        out[1..].copy_from_slice(pkt);
        self.dev.write(&out)?;
        let end = Instant::now() + Duration::from_secs(1);
        let mut buf = [0u8; 64];
        while Instant::now() < end {
            let n = self.dev.read_timeout(&mut buf, 200)?;
            if n >= 3 && buf[0] == 0xAA && buf[1] == cmd {
                if buf[2] != 0 {
                    return Err(if buf[2] == 0xFF { Error::NotLinked } else { Error::Other(format!("command {cmd:#04x} failed ({:#04x})", buf[2])) });
                }
                return Ok(buf);
            }
        }
        Err(Error::Other(format!("no reply to command {cmd:#04x}")))
    }

    /// Agrees a session key. NuPhy IO falls back to 0xAA when the key byte is 0 but the keyboard
    /// doesn't, so 0 is never used.
    fn handshake(&mut self) -> Result<(), Error> {
        let mut rnd = [0u8; 56];
        let mut urandom = std::fs::File::open("/dev/urandom").map_err(|e| Error::Other(e.to_string()))?;
        loop {
            urandom.read_exact(&mut rnd).map_err(|e| Error::Other(e.to_string()))?;
            if rnd[20] != 0 {
                break;
            }
        }
        let mut pkt = [0u8; 64];
        pkt[0] = 0x55;
        pkt[1] = SET_KEY;
        pkt[8..].copy_from_slice(&rnd);
        pkt[3] = checksum(&pkt);
        self.send(&pkt, SET_KEY)?;
        self.key = rnd[20];
        Ok(())
    }

    fn cmd(&self, cmd: u8, len: usize, offset: usize, data: &[u8], bank: u8) -> Result<[u8; 64], Error> {
        let k = self.key;
        let mut pkt = [0u8; 64];
        pkt[0] = 0x55;
        pkt[1] = cmd;
        pkt[4] = len as u8 ^ k;
        pkt[5] = (offset & 0xFF) as u8 ^ k;
        pkt[6] = ((offset >> 8) & 0xFF) as u8 ^ k;
        pkt[7] = bank ^ k;
        for (i, b) in data.iter().enumerate() {
            pkt[8 + i] = b ^ k;
        }
        pkt[3] = checksum(&pkt);
        self.send(&pkt, cmd)
    }

    pub fn get(&self, cmd: u8, offset: usize, total: usize, bank: u8) -> Result<Vec<u8>, Error> {
        let mut out = Vec::with_capacity(total);
        while out.len() < total {
            let n = CHUNK.min(total - out.len());
            let r = self.cmd(cmd, n, offset + out.len(), &[], bank)?;
            out.extend(r[8..8 + n].iter().map(|b| b ^ self.key));
        }
        Ok(out)
    }

    pub fn set(&self, cmd: u8, offset: usize, data: &[u8], bank: u8) -> Result<(), Error> {
        for (i, part) in data.chunks(CHUNK).enumerate() {
            self.cmd(cmd, part.len(), offset + i * CHUNK, part, bank)?;
        }
        Ok(())
    }
}

fn checksum(pkt: &[u8; 64]) -> u8 {
    pkt[4..].iter().fold(0u8, |a, b| a.wrapping_add(*b))
}

/// "1.0.23.6" from the 0xA1 reply.
pub fn firmware_version(b: &[u8]) -> Option<String> {
    if b.len() < 6 {
        return None;
    }
    let mut v = format!("{}.{}.{}", b[2], b[1], b[0]);
    if b[3] == 0xAA {
        v.push_str(&format!(".{}", b[4] as u16 | (b[5] as u16) << 8));
    }
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_the_bootloader_resets_or_wipes() {
        // Plus the firmware-only handlers nobody knows the effect of.
        // 0xD2 too, until its firmware handler is traced.
        for cmd in [0xEF, 0xF1, 0xB4, 0xB7, 0xBA, 0xBD, 0xFC, 0xFE, 0xC4, 0xE4, 0xF4, 0xF8, 0xF9, 0x2F, 0xE3, 0xE5, 0xD2] {
            assert!(!ALLOWED.contains(&cmd), "{cmd:#04x} must not be sendable");
        }
    }

    /// The only commands that change anything on the keyboard. Everything else allowed is a read.
    #[test]
    fn allowed_writes() {
        let writes = [SET_LIGHT, SET_SIGNAL, SET_KEY, SET_SLEEP, SET_KEYS, SET_MACRO, SET_FUNC, SET_SOCD, SET_TAP_DANCE, SET_TGL];
        let reads = [GET_BASE, GET_FW, GET_LIGHT_COUNT, GET_LIGHT, GET_SLEEP, GET_DEFAULT_KEYS, GET_KEYS, GET_MACRO, GET_FUNC, GET_SOCD, GET_TAP_DANCE, GET_TGL];
        assert_eq!(writes.len() + reads.len(), ALLOWED.len());
        for cmd in ALLOWED {
            assert!(writes.contains(&cmd) || reads.contains(&cmd), "{cmd:#04x}");
        }
    }
}
