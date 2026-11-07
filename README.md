# Keylight

A Mac app for the NuPhy Air75 V3: lighting, keymaps and Hyper-key shortcuts, set over the USB cable.

![Keylight's Lighting page](docs/screenshots/lighting.png)

Website: [nuphy.kelvinamoaba.com](https://nuphy.kelvinamoaba.com)

## Features

- **Lighting.** Solid colour, gradient, rainbow or one colour per row, plus the keyboard's 19 built-in effects and 8 built-in shapes, with speed, direction and brightness.
- **Shapes.** Paint keys by hand, with a mirror mode, or start from a preset. Shapes are layers drawn on top of the theme, and each one can be hidden.
- **Side lights.** Static, breathe, neon or off, in any colour.
- **Keymap.** Remap any key on any of the eight layers, four for Mac mode and four for Windows. The knob's left turn, right turn and press are keys too. Keylight backs up your whole keymap before the first change.
- **Macros.** Record a macro by typing it, or build it key by key, for each of the 32 slots in Mac and Windows mode. Name them, see which keys play them, and put one on a key in two clicks. Keylight backs up your keymap and macros before the first change.
- **Hyper highlighting.** Hold Right ⌘ and only the keys you've bound to Hyper shortcuts light up. Click keys to mark them. If you use Tinycast, Keylight reads its Hyper shortcuts for you.
- **Karabiner setup.** One click adds three Karabiner-Elements rules: Right ⌘ as Hyper, Caps Lock as Control with a double-tap for Caps Lock, and both Shifts together for Caps Lock.
- **Device settings.** Auto-sleep timers, the typing filter against key chatter, and open at login. It also shows the firmware version and whether the keyboard is in Mac or Windows mode.
- **Menu bar.** Closing the window leaves Keylight in the menu bar with a few quick themes.
- **Command line.** A `keylight` command and a local socket, for scripts and Karabiner.

| | |
|---|---|
| ![Shapes](docs/screenshots/shapes.png) | ![Keymap](docs/screenshots/keymap.png) |
| ![Hyper](docs/screenshots/hyper.png) | ![Side lights](docs/screenshots/side.png) |
| ![Device](docs/screenshots/device.png) | ![Karabiner](docs/screenshots/karabiner.png) |

## Requirements

- macOS 13 or later.
- A NuPhy Air75 V3 connected with the **USB cable**. The 2.4G dongle and Bluetooth only carry keystrokes, so Keylight can't change settings through them. You can keep typing over either one; Keylight saves your settings and applies them the next time the cable is plugged in.
- [Karabiner-Elements](https://karabiner-elements.pqrs.org), only for the Hyper key and the Caps Lock rules.

I have tested Keylight on the ANSI Air75 V3 with firmware 1.0.23.6. It detects ISO and JIS boards, but draws them as ANSI.

## Install

### Download

Get `Keylight.app` from [Releases](https://github.com/AmoabaKelvin/keylight/releases/latest) and move it to Applications. The download is for Apple silicon Macs; on an Intel Mac, build from source.

Releases aren't signed yet, so macOS blocks the first launch. Right-click the app and choose **Open**. On macOS 15 and later that no longer works; open the app once, then click **Open Anyway** in System Settings → Privacy & Security. Or clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine /Applications/Keylight.app
```

### Build from source

You need Node.js, pnpm, a recent stable Rust toolchain and the Xcode Command Line Tools.

```sh
pnpm i
pnpm app:build
```

The app is written to `src-tauri/target/release/bundle/macos/Keylight.app`. For development, `pnpm app` runs it with hot reload.

## Command line

The app's executable is also a command. Most commands talk to the running app, so open Keylight first.

```sh
alias keylight=/Applications/Keylight.app/Contents/MacOS/keylight

keylight hyper on              # light only the Hyper keys (Karabiner sends this while Right ⌘ is held)
keylight hyper off
keylight caps-toggle           # flip Caps Lock through macOS, so the keyboard's caps light follows
keylight setup-karabiner       # add Keylight's Karabiner rules
keylight send '{"op":"base","name":"rainbow"}'
keylight send '{"op":"state"}' # print the full state as JSON
```

`keylight send` passes one JSON message to the app, in the same format the app's own window uses. Some examples:

```sh
keylight send '{"op":"base","name":"solid","color":[255,170,110],"level":60}'
keylight send '{"op":"base","name":"effect","mode":6,"speed":2}'
keylight send '{"op":"side","mode":3,"color":[0,120,255]}'
keylight send '{"op":"layer","name":"todo","keys":["t","o","d"],"color":[255,0,0]}'
```

The full list of operations is in `Engine::handle` in [`src-tauri/src/engine.rs`](src-tauri/src/engine.rs).

The app listens on a Unix socket at `~/Library/Application Support/Keylight/keylight.sock`. Each connection takes one JSON message and gets one line back: `ok`, a JSON value, or `error: ...`.

```sh
echo '{"op":"state"}' | nc -U ~/Library/Application\ Support/Keylight/keylight.sock
```

## Safety

Keylight writes to your keyboard's memory, so it limits what it can send:

- **An allowlist of 15 commands.** Every packet goes through one function, and it refuses any command not on the list. The list covers device info, lighting, per-key colour, keymap, macros, typing and sleep settings, and the session handshake. See `ALLOWED` in [`src-tauri/src/hid.rs`](src-tauri/src/hid.rs).
- **Never bootloader, reset or wipe.** Firmware update mode `0xEF`, factory reset `0xF1`, and the keymap and advanced-key wipes `0xB4`, `0xB7`, `0xBA` and `0xBD` are not on the list, so Keylight can't send them.
- **Keymap backup before the first write.** Before it changes a key, Keylight saves all eight layers and both macro banks to `~/Library/Application Support/Keylight/backups/`.
- **Karabiner backup.** The first time Keylight edits `karabiner.json`, it copies the original to `karabiner.json.keylight-backup` next to it.
- **Few writes.** Lighting changes send only the keys that changed. Keylight doesn't animate anything in software, because I don't know whether the keyboard saves every write to flash.

## How it works

Keylight is a [Tauri 2](https://tauri.app) app. The Rust side talks to the keyboard's vendor HID interface over USB with [hidapi](https://github.com/ruabmbua/hidapi-rs), and runs a socket for the command line. The window is React. The app keeps a stack of layers: the theme, your shapes, an unsaved preview, and your Hyper keys while Right ⌘ is held. It works out what each key should show and writes only the difference.

NuPhy doesn't publish the protocol. I worked it out from NuPhy IO, NuPhy's web configurator, and from the keyboard's firmware, and wrote it up here:

- [docs/PROTOCOL.md](docs/PROTOCOL.md): packet format, the command table, lighting, sleep and typing settings, and which commands are dangerous.
- [docs/KEYMAP.md](docs/KEYMAP.md): the key matrix, stock keymaps, keycodes, macros, advanced keys and how restoring defaults works.

## Roadmap

- An in-app firmware updater
- Research into custom firmware
- Editors for the advanced keys: SOCD, Tap Dance and Toggle
- Support for more NuPhy boards
- Signed and notarized releases

## Contributing

Issues and pull requests are welcome. The most useful help comes from people who own:

- **An ISO or JIS Air75 V3.** I've only checked the LED and key-matrix maps on ANSI. An issue saying which keys light up wrong, or a screenshot of the Keymap page, is enough to start.
- **Another NuPhy keyboard.** Other boards that NuPhy IO configures may use the same commands. Send the USB product ID, the firmware version NuPhy IO shows, and whether Keylight connects at all.

When you change the protocol code, keep to commands already documented in `docs/PROTOCOL.md`, and never add one to the allowlist without knowing what it does.

## Disclaimer

Keylight is unofficial and not affiliated with or endorsed by NuPhy. NuPhy and Air75 are trademarks of their owners. Use it at your own risk.

## License

[MIT](LICENSE) © 2026 Kelvin Amoaba
