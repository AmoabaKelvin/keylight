# Air75 V3 remapping and customisation spec (from NuPhy IO + firmware 1.0.23.6)

Companion to [PROTOCOL.md](PROTOCOL.md) (transport, command table, light, settings). Data for the app lives in
[`src/lib/keycodes.ts`](../src/lib/keycodes.ts) (`KEYCODES`, `decode`, `encode`, `MATRIX`, `DEFAULT_LAYERS`).

Written from reading NuPhy IO (https://drive.nuphy.io) and the firmware 1.0.23.6 image. No NuPhy code or firmware is included in
this repository. References: `D ~n` = approximate line in a pretty-printed copy of NuPhy IO's `main.js`; chunk references (`C686:2129`)
are lines in pretty-printed copies of its webpack chunks; `FW 0x...` = offsets in the firmware `.bin` (US layout, 1.0.23.6). Most tables
here were checked by loading NuPhy IO's own modules in Node and calling its functions for product `Air75V3` (enum value 10, D ~76356) and
firmware "1.0.23.6", so they match what NuPhy IO itself produces.
Confidence: **[code]** read or executed from NuPhy IO · **[fw]** firmware disassembly or data · **[guess]**.

---

## 1. Feature inventory for Air75 V3

Product config: D ~9388 (`O`, base for V3 boards) merged with the Air75V3 override at D ~10222; key capability set `I` D ~9433.
Feature checks go through `o.C.check(type, name, fwVersion)` (D ~75800-75861). [code]

| Feature | Air75 V3 | Gate | Notes |
|---|---|---|---|
| Key Bindings (`/pressKey`) | yes | - | 4 layers per OS mode; picker tabs below |
| Advanced Functions (`/advancedKey`) | Toggle Key, SOCD, Tap Dance | TD: fw <= 0.0.10.6 or >= 1.0.1.5; TGL: fw >= 1.0.2.5 | list from `hightFunOperation` (module 61390, `l.k(10, fw)`). No DKS, Mod-Tap, Rapid Shift, Hyper Tap (HE boards only) |
| Lighting (`/light`) | yes | per-key custom >= 1.0.16.6; shapes >= 1.0.17.6 | see PROTOCOL.md |
| Macro Recording (`/macro`) | yes | - | 32 macros per OS mode, no loop mode (`macroLoop.supported = false`) |
| Mode Settings (`/modeSetting`) | yes | - | anti-wobble, disable Win / Alt+F4 / Alt+Tab (0xE1/E2), rename mode, import/export, reset mode |
| Trigger Settings, Switch selection, Virtual Gamepad | no | `isMechanical = true` removes them (module 54567, D ~8180) | |
| Knob | yes | `hasSelectControl = true` | 3 bindable slots (left, press, right) on every layer; "Accessory Switch" Knob/Button in global settings (AppDefine byte 168) |
| Global settings | yes | sleep / sleepTime / deepSleep supported | auto-sleep, L1/L2 minutes (0xF3/F5), accessory type, reset keyboard, firmware update (USB only), language/theme |
| Key Test (sidebar) | yes | - | uses the 0xC1 key-event stream; report `[C1, row, col, pressed]`, index = `row*16+col` (D ~87860) |
| My Configuration | yes | - | onboard modes, recommended presets, JSON export/import of a whole mode (D ~86700 `exportModeConfig`) |
| App hot keys (Photoshop/Illustrator/Figma) | yes | `appHotKey = true` | shown in the Media tab |
| Connection keys (2.4G, BT1-3) | yes | `wireless = true` | shown in the Media tab |
| Battery display | no | | |

Picker tabs on the Key Bindings page (C167:90-110, data wired in C686:2129-2150): [code]
- **Basic**: the full ANSI layout (`zr`, 100 keys) + "Commonly used" (`Gi(type, mode)`: Ins, ScrLk, Pause, Menu, screenshot pair for the
  current OS, a few RGB/media keys, Mission Control/Launchpad/Siri/Search/DND, KC_NO) + the current mode's FN0-FN3 or FN4-FN7 + the first 6 macros.
- **Media**: `Vw(type, mode, fw)` (consumer + NuPhy system keys) + Mac-only keys (`aR`) + connection keys (`Fg`) + app hot keys (`fg`).
- **RGB**: backlight + side-light keys (`Kn(type, fw)`).
- **Special**: mouse, FN lock, caps light, JIS/ISO/Korean keys, RESET, BOOT, LOCK, WIN_LOCK, FN0-FN11 (filtered to the current mode), F13-F24.
- **Macro**: M1-M32 of the current mode.

Version-gated codes [code]: FN lock `0x7E3D` needs fw >= 1.0.5.6; `0x7E0C, 0x7E40-0x7E46` need >= 1.0.11.6;
`0x7E53-0x7E57` need >= 1.0.14.6. All are present on 1.0.23.6.

What the knob offers [code] (device data module 47501, D ~6099): `especialKeys` SquareKnob with UI slots 15 "LEFT" (`RemapPage.ReduceVolume`),
16 "CLICK" (`RemapPage.Mute`), 17 "RIGHT" (`RemapPage.AmplifyTheVolume`). Any normal keycode or macro can go on them; advanced keys
cannot (C686:2220-2235, Message6 "Knob cannot be set to advanced functions").

---

## 2. Matrix: keymap index -> physical key

Each layer is 98 words = 196 bytes: 96 matrix words (`index = row*16 + col`, 6 x 16) then 2 knob words. [code+fw]

```
        c0     c1   c2   c3  c4  c5  c6    c7  c8  c9  c10   c11  c12         c13         c14  c15
row 0   esc    f1   f2   f3  f4  f5  f6    f7  f8  f9  f10   f11  f12         screenshot  ins  -
row 1   `      1    2    3   4   5   6     7   8   9   0     -    =           bksp        -    pgup
row 2   tab    q    w    e   r   t   y     u   i   o   p     [    ]           \           -    pgdn
row 3   caps   a    s    d   f   g   h     j   k   l   ;     '    knob-press  enter       -    home
row 4   lshift -    z    x   c   v   b     n   m   ,   .     /    rshift      -           up   end
row 5   lctrl  lopt lcmd -   -   -   space -   -   -   rcmd  fn   rctrl       left        down right
96 = knob-left (turn counter-clockwise, stock Vol-)     97 = knob-right (turn clockwise, stock Vol+)
```
`-` = no switch (always 0x0000 in every stock layer). Ids are those in `layout.ts`; the knob uses `knob-left`, `knob-press`, `knob-right`.

How it was derived:
- **Firmware** [fw]: 0xB1 handler (FW 0x58C8, via jump table entry `0xB1-0x2F`) walks `addr % 196`: words 0..95 call the default-key getter
  at FW 0x7E2C = `table[((layer*6 + row)*16 + col)]` (u16 LE at **FW 0x42828**), words 96/97 call FW 0x7E68 = `knob[layer*2 + n]`
  (u16 LE at **FW 0x42808**), and send each word **high byte first**. Out-of-range reads return 0x0001.
- **Driver** [code]: NuPhy IO never hard-codes the matrix. At connect it reads 0xB1 for layer 4 (Windows base, `getDefaultKeyboardMatrixData`
  D ~88142) and, for each data index, puts the key on the first unused UI position whose default keyCode matches (`setDefaultMatrixLayoutPosMap`
  D ~78660, keyCode->positions map from `TZ`/`fe` D ~27331 over the Air75V3 layout array `m` D ~13914, export `dq`). Running that exact
  algorithm on the firmware's layer 4 gives UI positions; UI position -> LED is `pos` (pos <= 14) or `pos-3` (pos >= 18), and LED -> key id
  comes from `layout.ts`. Result: all 83 lit keys plus the 3 knob slots match `MATRIX` with **0 mismatches**.
- The LED rule in PROTOCOL.md is NuPhy's `createLightMapping` with `skipPos 14, skipSize 3` (D ~88160): UI positions 15-17 are the knob.
  Note the LED index is the UI position, **not** the matrix index (e.g. matrix 61 Enter = UI 60 = LED 57).
- Knob direction: word 96 holds Vol- and is shown as "LEFT", word 97 Vol+ as "RIGHT" [code]. Which physical rotation fires which word is
  inferred from those defaults [guess; verify with the key tester, which should report row 6 col 0/1 if the encoder is reported at all].
- Key-event reports (`C1 row col pressed`) use the same `row*16+col` index [code D ~87860].

---

## 3. Stock keymaps (firmware 1.0.23.6) [fw]

`DEFAULT_LAYERS` in keycodes.ts is the full 8 x 98 table, identical to what 0xB1 returns. Layers 0-3 = Mac (base, Fn1, Fn2, Fn3),
4-7 = Windows. `▽` = 0x0001 transparent, unlisted keys are ▽ in Fn layers. Knob (words 96/97) is Vol-/Vol+ on **all 8 layers**, and
knob-press (index 60) is Mute on all 8 layers.

| Layer | Contents |
|---|---|
| 0 Mac base | Esc, F1=F14 (bright-), F2=F15 (bright+), F3=Mission Control 0x7E06, F4=Search 0x7E07, F5=Dictation/Siri 0x7E08, F6=DND 0x7E16, F7-F9 = Prev/Play/Next, F10-F12 = Mute/Vol-/Vol+, screenshot=0x7E0B (area), Ins. Bottom: LCtrl, LAlt(opt), LGui(cmd), Space, RGui, **MO(1)**, RCtrl, arrows |
| 1 Mac Fn | F1-F12 = F1-F12, screenshot = 0x7E0A (full). 1/2/3 = BT1-3, 4 = 2.4G. Tab = backlight on/off 0x7E18. P = caps light 0x7E3B, `[` = RESET 0x7E13, `]` = auto-sleep 0x7E14, `\` = battery 0x7E15. H/J/K/L = 0x7E58-0x7E5B (unknown, see below). X = MO(3), C = light test 0x7E19, M = MO(2), `,`/`.` = speed -/+, Up = bright+, RCtrl = MO(1), Left = RGB mode, Down = bright-, Right = hue+ |
| 2 Mac Fn2 (side light) | D = DEBUG 0x7E27, `,`/`.` = side speed -/+, `/` = side light on/off 0x7E3C, Up = side bright+, RCtrl = MO(2), Left = side mode, Down = side bright-, Right = side hue |
| 3 Mac Fn3 | E = Emoji 0x7E44, F = FN lock 0x7E3D, H = Show desktop 0x7E53, Space = input source 0x7E54, Up = PgUp, Left/Down/Right = Home/PgDn/End |
| 4 Win base | Esc, F1-F12, screenshot 0x7E0B, Ins. Bottom: LCtrl, LGui(win), LAlt, Space, RAlt, **MO(5)**, RCtrl, arrows |
| 5 Win Fn | as layer 1 but F-row = Esc▽, BriDn 0xBE, BriUp 0xBD, F3-F6, Prev/Play/Next, Mute/Vol-/Vol+, 0x7E0A; X = MO(7), M = MO(6), N = 6KRO toggle 0x7E57, RCtrl = MO(5) |
| 6 Win Fn2 | identical to layer 2, **including RCtrl = MO(2)** (a Mac layer; looks like a stock-table bug) |
| 7 Win Fn3 | identical to layer 3 |

Notes:
- Layers are absolute: Win uses MO(5..7) (0x5225-0x5227). NuPhy IO shows MO(n) as `KC_FN<n>` and only offers the current mode's four (C686:2140).
- The Fn2/Fn3 layers are reached by holding Fn then X or M (MO inside a MO layer).
- Unknown stock codes: 0x7E58-0x7E5B (QMK QK_USER_24..27) on Fn+H/J/K/L are not in NuPhy IO's converter, so NuPhy IO shows them as an
  empty key. Treat them as opaque and never rewrite them unless the user changes that key.

---

## 4. Keycode vocabulary

### Wire format of a key word [code D ~91476-91506, fw]
| Word | Meaning |
|---|---|
| `0x0000` | KC_NO |
| `0x0001` | KC_TRNS (transparent). Used by every stock Fn layer. **NuPhy IO cannot show or write it**: it decodes to KC_NO and a full-layer write from NuPhy IO turns ▽ into 0x0000 |
| `0x0004-0x00A4` | HID usage (basic) |
| `0x00A8-0x00DC` | QMK consumer/system/mouse (Mute 0xA8, Vol+ 0xA9, Vol- 0xAA, Next 0xAB, Prev 0xAC, Stop 0xAD, Play 0xAE, MSel 0xAF, Eject 0xB0, Mail 0xB1, Calc 0xB2, MyComp 0xB3, WWW 0xB4-0xBA, Bri+ 0xBD, Bri- 0xBE, mouse buttons 0xD1-0xD5, wheel 0xD9-0xDC) |
| `0x00E0-0x00E7` | modifiers LCtrl, LShift, LAlt, LGui, RCtrl, RShift, RAlt, RGui |
| `0x5220 \| n` | MO(n), n = absolute layer 0-7 |
| `0x7700 \| id` (`[0x77, id]`) | macro id 0-31 of the current OS mode |
| `0x7821-0x782A` | QMK RGB codes (backlight) |
| `0x7C59` | QK_LOCK |
| `0x7E00-0x7E57` | NuPhy functions (QMK QK_KB_0.. / QK_USER_0..): enum `S` D ~91331 |
| `0x7F00 \| id` (`[0x7F, id]`) | advanced key: id 0-63 SOCD, 64-127 Tap Dance, 128-191 TGL (only slots 0-31 of each exist) |

NuPhy IO never writes other QMK ranges (mods 0x0100-0x1FFF, mod-tap, layer-tap, TO/TG/DF/OSL/TT). Firmware support for them is unverified
[guess]; `decode` labels them for display only and `encode` should not be offered for them.

### Complete list
`KEYCODES` in keycodes.ts has every code NuPhy IO offers for Air75 V3 on fw 1.0.23.6 (241 distinct wire codes, cross-checked automatically
against the picker lists dumped from NuPhy IO), plus a few `hidden` ones (transparent, USB, desktop/snap/task-view, side-light
toggle, debug, touch bar) that are in the converter but not offered. Each entry has a <= 6-character `label`, a `name` and a `category`
(letter, number, symbol, fkey, modifier, navigation, editing, keypad, international, media, system, app, lighting, sidelight, layer,
connection, mouse, special, none). Highlights of the NuPhy codes:

| Wire | NuPhy IO name | Meaning |
|---|---|---|
| 0x7E00 | KC_FN_BOOT (RF_DFU) | bootloader |
| 0x7E01-05 | CONNECT USB / RF24G / BLE1-3 | connection switch (USB not offered) |
| 0x7E06-09 | Mission Control, Search, Siri, Launchpad | |
| 0x7E0A / 0x7E0B | MAC/WIN_GLOBAL / AREA_SCREENSHOT | one code each; the firmware sends the Mac or Windows shortcut for the current OS mode. NuPhy IO relabels per mode with `Ce.r` (module 82206) |
| 0x7E0C | FN_KC_MAC_GLOBOL | Globe key |
| 0x7E0D-12 | SIDE_VAI/VAD/MOD/HUI/SPI/SPD | side light |
| 0x7E13 | KC_FN_RESET (DEV_RESET) | reset keyboard |
| 0x7E14 / 15 / 16 | SLEEP / BAT_SHOW / MAC_DND | |
| 0x7E18-21 | light off, test, colour/brightness/speed cycle, direction | |
| 0x7E1E | WIN_KEY_LOCK | |
| 0x7E28-3A | Photoshop / Illustrator / Figma | |
| 0x7E3B / 3D | caps light / FN lock | |
| 0x7E40-57 | lock screen, Finder search, force quit, emoji, desktop, task manager, ..., input source, dictate, `\`/Shift, 6KRO | |

### NuPhy IO's converter [code D ~91336-91400]
NuPhy IO's UI works on its own keycode enum (module 82206, e.g. Vol+ = 0x30E900, FN1 = 0xF0FF01) and converts at the edge:
- `deserializationKeyCode(word)`: basic (0x04-0xA4) and modifiers pass through; MO(n) -> `0xF0FF00 | n`; `[0x7F,id]` -> `0x94<<16 | id<<8`;
  everything else through `allMapArr` (150 distinct pairs, last pair wins); unmapped -> KC_NO. Macros are handled before this (`getKeyInfo` D ~88178).
- `serializeKeyCode(np)`: the inverse, with the reverse map (last pair wins).
- Keylight doesn't need this conversion (the keyboard only ever sees wire codes), so it isn't included. When it was checked, every
  `KEYCODES` entry round-tripped through it except 0x0001 (-> KC_NO).
- Quirks: 0x7821 is both "RGB mode +" and "RGB mode toggle"; 0x7E0A/0x7E0B each stand for a Mac and a Windows screenshot; Fast-forward,
  Rewind, Control Panel and Assistant (0xBB, 0xBC, 0xBF, 0xC0) map to KC_NO; NuPhy's internal value for some codes is off by one from the
  wire value (e.g. `FN_KC_MAC_GLOBOL` = 0x7E0B internally but 0x7E0C on the wire), so always convert, never reuse NuPhy's numbers.

### Dangerous or tricky codes
| Code | Risk | Recommendation |
|---|---|---|
| 0x7E00 BOOT | puts the keyboard in bootloader (stops typing; re-enumerates as the upgrader, see PROTOCOL.md) | confirm; never place on a key without a modifier layer |
| 0x7E13 RESET | NuPhy: "Reset the keyboard". Likely resets on-board settings [guess] | confirm |
| 0x7C59 LOCK | QMK Key Lock: the next key stays held until pressed again; looks like a stuck key | warn |
| 0x0000 on the Fn key (index 91 of layer 0/4) | Fn layers become unreachable (BT switching, lighting keys); still recoverable from the app | warn when no MO(n) remains on the base layer |
| MO(n) on a key | NuPhy Message8: the same index on layer n must stay ▽ (or MO(n)), otherwise releasing the key can leave layer n stuck | when binding MO(n) at index i, check / set `layer[n][i] = 0x0001` |
| MO(n) of the other OS mode | NuPhy never offers it | offer only `mode*4 .. mode*4+3` |
| 0x7E27 DEBUG | factory debug, unknown effect | hide |
| 0x7E1E WIN_LOCK, 0x7E57 6KRO, 0x7E3D FN lock, 0x7E18 light off | harmless but confusing toggles | fine |
| Advanced keys on knob slots | NuPhy blocks it | block |
| 0x7E58-0x7E5B | stock, unknown | preserve |

---

## 5. Macros, SOCD, Tap Dance, TGL

### Macros [code D ~89756-90100, ~80879; C541:370-440]
- Storage: 2048 B per OS mode, read with 0xC2 / written with 0xC3 at address `2048*mode + offset`, bank 0.
- Header: bytes 0-63 = 32 u16 **little-endian** pointers (macro id 0-31). A pointer <= 63 means empty.
- At the pointer: 4-byte actions `[delayLo, delayHi, flags, keycode]` until one has the end flag.
  - `delay` u16 LE, milliseconds, **the wait after this action** before the next one (the recorder writes the elapsed time into the
    previous action). UI minimum 1 ms; 0 is shown as empty and forced to 1. Max 65535.
  - `flags` bit 6 = key action: **1 = press, 0 = release** ("Lift Up"); bit 7 = last action. Other bits 0.
  - `keycode` = 1 byte wire code; NuPhy refuses anything with a non-zero high byte. Allowed types for this board: Keyboard, MouseKey,
    MouseWheel (`macroSupportedKeyTypes [16, 32, 33]`), i.e. basic keys, modifiers, mouse buttons and wheel.
- Capacity: (2048-64)/4 = **496 actions per mode**, shared by the 32 macros (`getFreeMacroCount`). No loop/repeat on Air75 V3.
- NuPhy's allocator keeps the area packed from offset 64. Each free block starts with an end marker `[0,0,0x80,0]`, and every empty pointer
  is set to the first free block (or 0xFFFF if none) before writing the header. Only modified blocks plus the 64-byte header are written.
- Reader quirk: a macro whose first action already has the end flag is treated as empty, so a 1-action macro does not survive a read.
  Always write press + release pairs.
- Binding: key word `[0x77, id]` via 0xB3. The macro list is per OS mode, so M1 on a Mac layer and M1 on a Windows layer are different macros.
- Recording in the UI uses the keyboard's own key events (0xC1 stream: press on a key, release when travel returns to 0), with
  "Real Interval" (1 ms timer) or a fixed "Default Interval". Actions can be reordered, edited, toggled press/release and inserted
  above/below. Delete = free the block, pointer 0, end marker at the freed address.

### Advanced key tables [code D ~86775-87190 (parsers), ~89335-89660 (writers), ~87988-88024 (reads)]
Read once at connect: 0xB5 SOCD (256 B), 0xB8 Tap Dance (512 B), 0xBB TGL (128 B), all at address 0, bank 0. Each table is two halves
(Mac, then Windows) with 32 slots each. The key word holds the slot plus the type base, **without** a mode offset: the OS mode picks the half.

| Type | Key word | Entry | Address of slot s in mode m | Write cmd |
|---|---|---|---|---|
| SOCD | `[0x7F, s]` | 4 B: `[keyHi, keyLo, partnerSlot, prio]` | `m*128 + 4*s` | 0xB6 |
| Tap Dance | `[0x7F, 64+s]` | 8 B: `[tapHi, tapLo, doubleHi, doubleLo, holdHi, holdLo, delayHi, delayLo]` (delay **big-endian**) | `m*256 + 8*s` | 0xB9 |
| TGL | `[0x7F, 128+s]` | 2 B: `[keyHi, keyLo]` | `m*64 + 2*s` | 0xBC |

- **SOCD** (a pair of keys, e.g. A/D): both keys get their own slot (allocated as the first two free slots), each slot stores the key's own
  output code, the partner's slot and a priority bit. Priority, decoded as `(myBit<<1) | partnerBit`: 0 = neutral ("No Priority": both
  pressed -> neither), 3 = last input wins, 2 = this key always wins, 1 = partner wins. Writing: bit = 1 for "OwnWin" or "LastWin". If one
  key is set to absolute priority the other is forced to "BondWin" (bit 0). Consecutive ascending slots are written in one 8-byte packet.
  The UI shows the trigger rules as "Finally, enter the priority" / "No Priority" / "Absolute priority (key)" [mapping of labels to enum
  values is a guess from the wording].
- **Tap Dance** (shown as "Tap Dance", icon ModTap): tap, double-tap and hold outputs, any wire keycode each, and a delay clamped to
  **10-1000 ms** (`limitValue(a, 10, 1e3)`).
- **TGL** (Toggle Key): tapping latches the key on/off, holding acts as a normal key. One keycode.
- Slot allocation: a slot is "used" if some key in that mode's four layers references it (scanned at load); a new one takes the first unused
  slot, or reuses the slot already on the key. Write order: table entry first, then the key word (`setKey(..., [0x7F, id])`).
- Deleting/replacing: NuPhy only rewrites the key word (and forgets the slot locally); the table entry stays on the device as garbage.
- Limits: 32 SOCD slots (16 pairs), 32 Tap Dance and 32 TGL per OS mode. Not allowed on knob slots.

---

## 6. Restoring defaults

What NuPhy IO does [code D ~88969-89330, firmware FW 0x5F7E]:
| Action | Commands |
|---|---|
| Reset one key (Key Bindings "Reset", also used when removing a macro/advanced key) | read the current word (0xB2); read the **default word with 0xB1 at `layer*196 + 2*index`**; write it with 0xB3 at the same address. Advanced-table entries are not cleared |
| Restore a layer | 0xB4 with address = layer number, length = number of layers (1), data = zeros; then re-read the layer. The firmware handler copies the flash defaults (same getter as 0xB1) over layers `[addr, addr+len)` [fw] |
| Reset a mode (Mode Settings "Reset") | 0xC3 zeros over that mode's 2048 B of macros; **0xB7 ResetSOCD and 0xBA ResetTapDance (whole tables, both modes [guess])**; TGL table untouched; 0xFC zeros over the 56-byte mode name; 0xB4(addr = 4*mode, len 4) |
| Reset keyboard (Global settings) | macros zeroed for both modes, 0xB7, 0xBA, mode names zeroed, then **0xF1 RestoreFactory** |

Recommended for Keylight:
- **Reset key**: exactly NuPhy's path: `0xB1` read of the one word at `layer*196 + 2*index`, then `0xB3` write of those 2 bytes. Never
  touches anything else. If the old word was SOCD, reset the partner key too (find it through the partner slot), otherwise the partner keeps
  pointing at a pair that no longer exists.
- **Reset layer**: read the whole default layer with 0xB1 (196 B at `layer*196`), diff it against 0xB2, and write only the differing words
  with 0xB3. Same result as 0xB4 but verifiable, needs no new command and cannot hit the wrong layer range. Keep a copy of the pre-reset
  0xB2 data so it can be undone. If 0xB4 is used, always send `len = 1`.
- **Reset everything for a mode**: compose from the above plus explicit table writes. Avoid 0xB7/0xBA/0xBD (whole-table resets that may
  also clear the other mode) and 0xF1.
- Before any keymap write session, back up all 8 layers (0xB2, 8 x 196 B), both macro areas (0xC2), and the three advanced tables.
- Writes are persistent and take effect immediately; NuPhy IO writes one key at a time and does not batch.
- `DEFAULT_LAYERS` (firmware 1.0.23.6) is good for an offline preview, but treat 0xB1 on the device as the source of truth, because other
  firmware versions can change the stock table.
