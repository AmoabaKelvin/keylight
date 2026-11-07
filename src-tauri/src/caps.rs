//! Toggles Caps Lock through the macOS HID system (the lock state IOHIDSystem keeps), so every
//! keyboard's caps light follows, including a Bluetooth keyboard Karabiner has grabbed. Sending a
//! caps_lock key event does not reach the NuPhy's light over Bluetooth; this does.

use std::ffi::{c_char, c_int, c_void};

type KernReturn = c_int;
type MachPort = u32;
type IoObject = MachPort;
type IoConnect = MachPort;

const KERN_SUCCESS: KernReturn = 0;
/// kIOMainPortDefault is defined as MACH_PORT_NULL; passing 0 also works before macOS 12.
const MAIN_PORT_DEFAULT: MachPort = 0;
const HID_PARAM_CONNECT_TYPE: u32 = 1; // kIOHIDParamConnectType
const CAPS_LOCK_STATE: c_int = 1; // kIOHIDCapsLockState

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    /// Returns a CFMutableDictionaryRef, which IOServiceGetMatchingService consumes.
    fn IOServiceMatching(name: *const c_char) -> *mut c_void;
    fn IOServiceGetMatchingService(main_port: MachPort, matching: *mut c_void) -> IoObject;
    fn IOServiceOpen(service: IoObject, owning_task: MachPort, kind: u32, connect: *mut IoConnect) -> KernReturn;
    fn IOServiceClose(connect: IoConnect) -> KernReturn;
    fn IOObjectRelease(object: IoObject) -> KernReturn;
    fn IOHIDGetModifierLockState(handle: IoConnect, selector: c_int, state: *mut bool) -> KernReturn;
    fn IOHIDSetModifierLockState(handle: IoConnect, selector: c_int, state: bool) -> KernReturn;
}

unsafe extern "C" {
    /// What the mach_task_self() macro reads.
    static mach_task_self_: MachPort;
}

/// Flips Caps Lock and returns the new state (true = on).
pub fn toggle() -> Result<bool, String> {
    unsafe {
        let service = IOServiceGetMatchingService(MAIN_PORT_DEFAULT, IOServiceMatching(c"IOHIDSystem".as_ptr()));
        if service == 0 {
            return Err("IOHIDSystem not found".into());
        }
        let mut conn: IoConnect = 0;
        let kr = IOServiceOpen(service, mach_task_self_, HID_PARAM_CONNECT_TYPE, &mut conn);
        IOObjectRelease(service);
        if kr != KERN_SUCCESS {
            return Err(format!("IOServiceOpen failed: {kr:#x}"));
        }
        let mut state = false;
        let mut kr = IOHIDGetModifierLockState(conn, CAPS_LOCK_STATE, &mut state);
        if kr == KERN_SUCCESS {
            kr = IOHIDSetModifierLockState(conn, CAPS_LOCK_STATE, !state);
        }
        IOServiceClose(conn);
        if kr != KERN_SUCCESS {
            return Err(format!("setting the Caps Lock state failed: {kr:#x}"));
        }
        Ok(!state)
    }
}
