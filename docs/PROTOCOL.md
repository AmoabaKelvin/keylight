# NuPhy Air75 V3 vendor protocol (from NuPhy IO + firmware 1.0.23.6)

Written from reading NuPhy IO (the web configurator at https://drive.nuphy.io) and disassembling firmware 1.0.23.6. No NuPhy code or
firmware is included in this repository. References: `D ~n` = approximate line in a pretty-printed copy of NuPhy IO's `main.js`,
`C779/C715/C829` = its webpack chunks, `FW 0x...` = offsets in the firmware `.bin`. UI names come from NuPhy IO's English strings.
Confidence: **[code]** = read in driver/firmware code, **[fw]** = firmware disassembly, **[obs]** = matches a light-state read from a real keyboard, **[guess]**.

## Transport (implemented in [`src-tauri/src/hid.rs`](../src-tauri/src/hid.rs))
64-byte packets: `55 cmd 00 csum | len^k addrLo^k addrHi^k bank^k | data^k...`. Reply starts `AA cmd status`.
Byte 7 ("bank"/"handle") = OS mode (0 = Mac, 1 = Windows) for per-mode commands, else 0. Max 56 data bytes per packet
(driver uses 54 for 0xD2). D ~91440, ~87800 [code]. Any input report whose byte 0 is not `0xAA` is an unsolicited report
and is **not** XOR'd (D ~40329, ~87700) [code].

## Command table (enum `S4`, D ~90908) and firmware support (jump table at FW 0x15be2, table @0x44450) [code+fw]
| cmd | name | bank | used for |
|---|---|---|---|
| 0x2F | GetDongelName | - | not called for Air75V3; fw implements (info record) |
| 0xA0 | GetBase | 0 | 8 B, see below |
| 0xA1 | GetFirmwareInfo | 0 | 8 B, see below |
| 0xB1/B2/B3 | GetDefaultKeys / GetUseKeys / SetUseKeys | 0 | keymap |
| 0xB4 | RestoreUseLayers | 0 | **resets layers to default** |
| 0xB5/B6/B7 | Get/Set/Reset SOCD | 0 | 256 B table |
| 0xB8/B9/BA | Get/Set/Reset TapDance | 0 | 512 B table |
| 0xBB/BC/BD | Get/Set/Reset TGL | 0 | 128 B table |
| 0xC1 | SetKeyUpload | 0 | `[1]` = stream key-press reports (key tester) |
| 0xC2/C3 | GetMacro / SetMacro | 0 | macros |
| 0xD1 | GetLightCount | - | never called by driver |
| 0xD2 | GetKeyLightColor | 0 | 3 x 104 B RGB, LED order |
| 0xD5/D6 | Get/SetLightState | mode | 22 B (17 B if fw < 1.0.17.6) |
| 0xD8 | SetSignalColor | mode | per-key `[led,R,G,B]*` |
| 0xE1/E2 | Get/SetKeyboardFunc | mode | 4 B |
| 0xE3 | SetDebounceTime | - | **not used**; fw routes it to the same stub as E5/E6 (touch bar) = unsupported |
| 0xE4 | TestDelayTime | - | not used; fw handler exists, purpose unknown |
| 0xE5/E6 | Set/GetTouchBarConfig | - | not on this board |
| 0xEE | SetSecretKey | - | handshake (re-keys session) |
| 0xEF | SetIapMode | - | **bootloader** |
| 0xF1 | RestoreFactory | - | **factory reset** |
| 0xF3 | GetSleepInfo | 0 | 4 B |
| 0xF5 | SetSleepCfg | 0 | sleep (global, not per mode) |
| 0xFA/FB/FC | GetAppDefineSize / GetAppDefine / SetAppDefine | 0 | names, knob/key type |
| 0xFD/FE | GetDebugEnable / SetDebugLog | 0 | debug log stream |
| 0xC4, 0xF4, 0xF8, 0xF9 | *(none in driver)* | | **fw-only handlers, purpose unknown: never send** |

## 0xA0 GetBase (8 B) - D ~88242, FW 0x160b2 [code+fw+obs]
`[0] currentMode` (0 Mac, 1 Win) · `[1] layerCount = 8` · `[2] layersPerMode = 4` · `[3] matrixRows = 6` · `[4] matrixCols = 16` ·
`[5] 0x82`: if bit7 set, extraKeys = `b & 0x7F` (= 2, knob keys), else 2 · `[6..7]` not written by fw (garbage).
`keysDataSize = 2*rows*cols + 2*extraKeys = 196` bytes per layer.

## 0xA1 GetFirmwareInfo (8 B) - `parseFirmwareVersion` D ~91485, FW 0x1608a [code+fw]
`b = [0x17, 0x00, 0x01, 0xAA, 0x06, 0x00, ?, ?]` -> version `"{b2}.{b1}.{b0}"`, and if `b3 == 0xAA` append `".{b4 | b5<<8}"`
-> **"1.0.23.6"**. Bytes 6-7 unused. Feature gates (D ~10222): per-key custom mode 21 needs >= 1.0.16.6; preset shape mode 22
and the 22-byte light state need >= 1.0.17.6 (else read/write only 17 bytes). Caveat [code]: the driver's U1-dongle API
(D ~78280-78420) sends 0xA1 and 0xEF to the dongle itself, so over PID 0x2620 0xA1 may report the **dongle's** firmware and
0xEF would put the **dongle** into IAP [guess on which device answers].

## 0xD5/0xD6 light state (22 B, per OS mode) - parser D ~80082 + ~87309, encoders D ~87400 [code+obs]
| off | field | encoding |
|---|---|---|
| 0 | main mode | table below |
| 1 | main brightness | 0..100 (UI shows %, step 5). UI "off" switch = brightness 0; switching on restores the last value or 40 (C779) |
| 2 | main speed | wire = 4 - UI gear; UI 0..4, so wire 0 = fastest, 4 = slowest |
| 3 | main direction | 0/1 (see modes) |
| 4 | main isRGB | 1 = multicolour/rainbow, 0 = use RGB below. The UI switch "single colour" = !isRGB. Forced 1 for modes without colour |
| 5 | main colorIndex | preset palette index; UI never edits it (sends what it read) |
| 6-8 | main R,G,B | |
| 9 | side mode | side table |
| 10 | side brightness | 0..100 (same on/off rule) |
| 11 | side speed | wire = 4 - gear |
| 12 | side isRGB | as above |
| 13 | side colorIndex | |
| 14-16 | side R,G,B | |
| 17 | shape | `& 7`: 0 Heart, 1 Smiley, 2 Crying Face, 3 Butterfly, 4 Crescent Moon, 5 Right Arrow, 6 Left Arrow, 7 Four-leaf Clover (C779 list `y`) |
| 18-20 | shape R,G,B | "graphic colour"; bytes 6-8 become the "background colour" in mode 22 |
| 21 | shape speed | wire = 4 - gear |
Partial writes are fine: the driver writes only the changed bytes at their offset (`serializePartialLightData`, D ~88406).
Air75 V3 has only two zones, `Main` ("Back Light") and `Side` ("Side Light"). The third zone `Loop` ("Glow Edge", offset 35)
is HE-board only. No logo zone. Firmware clamps the shape byte to <= 7 on read (FW 0x15f0a).

**Main modes** (enum `CR`, D ~34141; Air75V3 list `_` + appended 21/22, D ~33700-34010, ~38707). Perms: C = colour, S = speed, D = direction.
1 Ray (S,C) · 2 Stair (C) · 3 Static (C) · 4 Breath (C,S) · 5 Flower (S,C) · 6 Wave (C,S,D: 1="←" 0="→") ·
7 Ripple [UpAndDownWave] (C,S,D: 1="↑" 0="↓") · 8 Spout (C,S,D ←/→) · 9 Galaxy (C,S) · 10 Rotation (C,S,D ↑/↓) · 11 Ripple (C,S) ·
12 Point (C,S) · 13 Grid (C,S) · 14 Time [flowing] (C,S) · 15 Rain (C,S) · 16 Ribbon (S) · 17 Gaming (C,S, always RGB) ·
18 Identify (C,S, always RGB) · 19 Windmill (C,S, always RGB) · 20 Diagonal (S) · **21 Custom (per-key, 0xD8)** · **22 Shape (C,S + shape fields)**.
Value 0 (`CUSTOM_MODE`) exists in the enum but is not offered for this board.
**Side modes** (enum `bh`, D ~34145; Air75V3 order D ~34000): 3 Breathe (C) · 4 Rhythm (C) · 0 Time (C,S) · 1 Neon (S) · 2 Static (C).
Enum also aliases `OFF_MODE = 4` with RHYTHM (matches the observation that 4 looks dark). The UI turns a zone off with brightness 0, not a mode.

## Per-key colours - D ~88497, ~88849, ~10240 [code]
104 LEDs: 84 key LEDs (0..83) + 20 side LEDs (84..103). 0xD2 reads `3*104` B RGB (chunk 54, bank 0). The key-position-to-LED map
skips key positions 15-17 (the knob/accessory keys have no LED): `led = pos` for pos <= 14, `pos - 3` for pos >= 18.
0xD8 payload is `[led,R,G,B]` repeated, bank = OS mode, and only takes effect in main mode 21.

## Keymap - D ~88133-88230, ~89153-89330, ~91475 [code]
8 layers: layer L sits at address `L*196` (0xB2 read / 0xB3 write, bank 0). OS mode = `L // 4` (0-3 Mac, 4-7 Win), so layer 0 of
each mode is the base layer and 1-3 are Fn layers. Each key is 2 bytes; position order is matrix order (row*16+col), then the
2 extra keys. Key word:
- `[0x77, id]` = macro id 0..31; `[0x7F, id]` = advanced key: SOCD id 0-63, TapDance 64-127, TGL 128-191.
- otherwise a big-endian 16-bit QMK-style keycode: 0x00-0xFF basic HID, the QMK MO(n) range = Fn layer, other ranges go through NuPhy IO's converter (see [KEYMAP.md](KEYMAP.md#nuphy-ios-converter-code-d-91336-91400)).
0xB1 GetDefaultKeys: the driver reads one layer at offset `4*196` to map default positions. 0xB4 RestoreUseLayers: addr = first layer,
data = `(end-start)` zero bytes, resets layers [start,end).
Single key write: 0xB3 at `L*196 + 2*keyIndex` with 2 bytes.

## Macros - D ~89844-90000 [code]
2048 B per OS mode at `0xC2/0xC3` address `2048*mode`. Bytes 0..63 = 32 little-endian u16 offsets (macro id 0..31; an offset <= 63
means empty). At each offset are 4-byte actions `[delayLo, delayHi, flags, keycode]`. flags bit6 = keyAction (1 = release?),
bit7 = last action. Keycode is 8-bit basic only.

## Settings [code]
- **0xE1/0xE2 KeyboardFunc** (4 B, bank = OS mode; D ~88300, ~88680-88840): `[0] stabilization` ("Anti-wobbliness", i.e. chatter
  filter): 1 = Low, 2 = Intermediate, 3 = High (0 reads as Low) · `[1] disable Win key` · `[2] disable Alt+F4` · `[3] disable Alt+Tab`.
  Single fields are written at offsets 0-3.
- **0xF3 GetSleepInfo / 0xF5 SetSleepCfg** (global; D ~88765-88810, C829): `[0] auto-sleep enable`, `[1] Level-1 sleep minutes`,
  `[2] Level-2 (deep) sleep minutes`, `[3] ?`. UI range 5..127 min. The driver writes `[enable]` alone or reads 4 B, patches one byte and writes it back.
- **AppDefine** (0xFA returns size as `b0<<8|b1`; 0xFB/0xFC read/write by address, D ~89660-89750, ~79424-79530):
  0..55 mode-0 name, 56..111 mode-1 name (UTF-8), 112..167 the driver's "update reminder" string `"<ms>,<ver>"`,
  **168 accessory type: 0 = Knob, 1 = Button** ("Accessory Switch", D ~76386).
- Not available on Air75 V3 (getKeyboardFunc hard-codes them to 0/false, D ~88300): polling/report rate, tick rate, game mode, debounce.
  Mac/Win mode is switched only on the keyboard; read it from GetBase[0] or the 0xA2 report.

## Unsolicited input reports (byte 0, not XOR'd) - enum `P3` D ~90909, parser D ~87700-87930 [code]
`A2 ?? fnLayer mode` mode/Fn-layer change · `D7 <22 B light state>` light changed on the keyboard · `F4 en l1 l2` sleep config changed ·
`F2` keyboard reset · `C1 row col pressed` key event (after 0xC1 `[1]`) · `FE ...` debug log.

## Battery / charging [code]
**Not exposed for Air75 V3.** Battery UI is limited to WH80 (`isSupportBatteryShow`, D ~38440 set `g`). WH80 uses a different
protocol (`EG.GetFunc` addr `mode*N+32`: bit7 = charging, bits 0-6 = percent, D ~86063; dongle report `[x, 0xFB, 7, ?, status, pct]`, D ~82783).
The S4 command set has no battery command, and the fw jump table has none apart from the unknown 0xF8/0xF9/0x2F.

## Never send (danger list)
0xEF SetIapMode (bootloader; device re-enumerates as upgrader PID 0x0722, the dongle as 0x1020) · 0xF1 RestoreFactory (wipes everything) ·
0xEE outside the opening handshake (re-keys and breaks any running session, such as Keylight's) · 0xB4 RestoreUseLayers, 0xB7/0xBA/0xBD Reset SOCD/TapDance/TGL (wipe user data) ·
0xFC at address 168 (wrong knob/button type) · 0xFE SetDebugLog · 0xC4, 0xE4, 0xF4, 0xF8, 0xF9, 0x2F (fw handlers with unknown effect).
Persistent but recoverable writes: 0xB3, 0xC3, 0xD6, 0xD8, 0xE2, 0xF5, 0xFC.

## Connection
Vendor HID = usagePage 1, usage 0. USB PID 0x1028 (ANSI; ISO 0x102A, JIS 0x1029), U1 2.4G dongle 0x2620 (D ~8575, ~8966).
Bluetooth exposes no vendor channel. The driver only offers firmware update over USB cable.
