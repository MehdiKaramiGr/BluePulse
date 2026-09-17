# 🔵 ESP32 KeyWave V2

An **ESP32-based Bluetooth Low Energy (BLE) to RF bridge** that allows you to send and receive 315/433 MHz RF codes wirelessly.  
It works together with a companion mobile app (React Native) to provide a clean UI for controlling and managing RF devices.

---

## ✨ Features

- 📡 **Transmit RF codes** at both 315 MHz and 433 MHz
- 📥 **Receive RF codes** and forward them via BLE
- 🔗 **BLE connectivity** for pairing with mobile apps
- ⚡ **Low latency** sending and receiving
- 🗂️ Support for multiple protocols (via [RC-Switch](https://github.com/sui77/rc-switch) & modified RCSwitch2)
- 🔄 Automatic BLE re-advertising when disconnected

---

## 🛠️ Hardware Setup

- **ESP32 DevKit** (tested on ESP32-WROOM)
- **One CC1101 SPI RF transceiver** with a suitable antenna

### Pin Mapping

| CC1101 pin | ESP32 GPIO |
| ---------- | ---------- |
| VCC        | 3V3        |
| GND        | GND        |
| SCK        | 18         |
| MISO/GDO1  | 19         |
| MOSI       | 23         |
| CSN        | 5          |
| GDO0       | 4          |

⚠️ Supply the CC1101 from **3.3 V only**, never 5 V. One CC1101 is time-shared: it switches between 315 MHz and 433.92 MHz every 150 ms while idle, then immediately selects the requested band for a BLE transmit command. This preserves the app protocol, but it cannot receive both bands literally at the same instant.

---

## 📡 BLE Service

- **Service UUID**: `12345678-1234-1234-1234-1234567890ab`
- **Characteristic (TX → Notify)**: `12345678-1234-1234-1234-1234567890ac`
- **Characteristic (RX → Write)**: `12345678-1234-1234-1234-1234567890ad`

### BLE Command Format

- `<CODE>` → RF code (decimal)
- `<FREQ_FLAG>` → `1` = 315 MHz, `2` = 433 MHz
- `<PROTOCOL>` → RC-Switch protocol number (e.g. 1, 2, 3...)
- `<REPEAT>` → number of times to transmit

Example:
`c,<CODE>,<FREQ_FLAG>,<PROTOCOL>,<REPEAT>`

- `<CODE>` → RF code (decimal)
- `<FREQ_FLAG>` → `1` = 315 MHz, `2` = 433 MHz
- `<PROTOCOL>` → RC-Switch protocol number (e.g. 1, 2, 3...)
- `<REPEAT>` → number of times to transmit

Example:
`c,123456,2,1,10`
➡️ Sends code `123456` at **433 MHz**, using **protocol 1**, repeated **10 times**.

### Quick Access burst command

Quick Access can optionally run a saved code as a timed burst. The app sends one command to the ESP32, which keeps the timing local to the radio:

`b,<CODE>,<FREQ_FLAG>,<PROTOCOL>,<ITERATIONS>,<GAP_MS>,<REPEAT_SECONDS>`

For example, `b,123456,2,1,3,300,1` transmits the saved 433 MHz code three times with a 300 ms gap between plays. Configure this from a saved code's Quick Access options or by long-pressing its Quick Access card.

---

## 📤 BLE Notifications

When an RF code is received, it is pushed via BLE in the format:
`<CODE>,<FREQ_FLAG>,<PROTOCOL>`

Example:
654321,1,3
➡️ Received code `654321` at **315 MHz**, protocol **3**.

### 🔬 Raw signal capture and replay

The **Raw** tab in the companion app locks the CC1101 to exactly one selected band—**315 MHz** or **433 MHz**—instead of alternating between them. It captures one RF burst as GPIO edge timings, renders those high/low pulse widths on a time ruler, and can replay a selected inclusive range of pulses. The scope can be entered in µs, ms, or seconds; the app rounds it outward to complete pulses so replay keeps the original timing intact.

This requires flashing `ESP32_script/BluePulse/C1101.ino`. The firmware adds a second notify characteristic for raw timing data:

- **Raw notify UUID**: `12345678-1234-1234-1234-1234567890ae`

The app issues these internal commands on the existing write characteristic:

- `raw,capture,<FREQ_FLAG>` — arm a single fixed-frequency capture
- `raw,stop` — stop the current raw capture while remaining on the selected band
- `raw,replay,<CAPTURE_ID>,<START_INDEX>,<END_INDEX>` — replay an inclusive pulse range
- `raw,exit` — leave raw mode and resume the normal 315/433 MHz scan
- `raw,u,s,<FREQ_FLAG>,<PULSE_COUNT>` — begin uploading a saved waveform
- `raw,u,<INDEX>,<LEVEL>,<DURATION_US>` — upload one high/low pulse segment
- `raw,u,e` — finish the upload and receive a replayable capture ID

The app can save up to 25 named waveforms locally, including their carrier frequency and selected scope. Loading one transfers its pulse timings back to the ESP32 before replay. Raw captures and uploaded waveforms are held in ESP32 memory, are limited to 512 pulse segments, and are intentionally not persisted after a board restart.

---

## 🔧 Installation

1. Install **Arduino IDE** or **PlatformIO**
2. Add the [ESP32 board package](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html)
3. Install required libraries:
   - [SmartRC-CC1101-Driver-Lib](https://github.com/LSatan/SmartRC-CC1101-Driver-Lib)
   - [rc-switch](https://github.com/sui77/rc-switch)
   - ESP32 BLE libraries (built-in with Arduino ESP32)
4. Flash this code to your ESP32.

---

## ⚙️ Modified RC-Switch2 Library

This project uses a modified version of [RC-Switch](https://github.com/sui77/rc-switch) called **RC-Switch2**.

### Why only one RC-Switch instance?

The CC1101 is a single, tunable radio rather than four separate fixed-frequency modules. The firmware uses one `RCSwitch` instance on GDO0 and retunes the CC1101 between the two bands. BLE messages, UUIDs, command syntax, and receive notifications remain unchanged.

---

### 2️⃣ How to include it in your repo

- Put the `RCSwitch2.h` and `RCSwitch2.cpp` **directly in your repo** (e.g., in a `lib/` folder) next to your main Arduino sketch.
- In your code:

```cpp
#include "lib/RCSwitch2.h"
```

---

## 📱 Companion App

This firmware pairs with the **BluePulse React Native app** for iOS/Android.

- Manage your saved RF codes
- Tap to send codes instantly
- Auto-detect received RF codes and bookmark them
- Search, favorite, share, and import saved RF-code libraries as JSON text
- Set a default transmit repeat count for newly saved or captured codes
- Create timed Quick Access bursts with editable iterations and millisecond gaps
- Create reusable Android home-screen tiles for any saved Quick Access action

### Android home-screen Quick Action widget

Create reusable widget tiles from **Quick Access → Home widget**. Each tile is an independent saved RF action. Choose an optional photo for the card's top media panel; the information surface below uses a Material 3-inspired design that follows your phone's light or dark appearance. It fills the size Android gives it and shows the saved-code name, frequency, bridge/send status, and Single or Burst mode.

Tiles default to a 1×1 cell and can be resized freely. Use **Add this tile to home screen** in a saved tile to add that exact tile as its own widget; confirm Android's prompt. You can add as many independent tiles as you need.

1. Connect the BluePulse bridge in the app, then make the desired saved codes available in **Quick Access**.
2. Open **Quick Access** and tap **Home widget**. Create one or more tiles by choosing a saved action and, optionally, a photo.
3. Select a saved tile and tap **Add this tile to home screen**, then confirm Android's prompt. As a fallback, you can also drag **BluePulse Quick Action** from the Android widget picker and tap the unconfigured tile to choose its action.

The widget requires the Android development or production build—**it cannot run inside Expo Go**. Bluetooth must be on, the bridge must be in range, and the app must already have Bluetooth permission. A widget action opens a short dedicated BLE connection to the bridge, so the main app does not need to be visible.

For safety, remember that tapping a tile transmits immediately. Reopen **Home widget** after changing the saved code or its burst behavior so its tile command stays in sync.

👉 [BluePulse App Repo](#) _(link to your RN repo when public)_

---

## 📝 Roadmap

- [x] Add raw timing capture and selected-range replay (CC1101 firmware)
- [ ] Add OTA updates
- [ ] Expand to support more RF frequencies
- [ ] iOS support improvements

---

## 📜 License

MIT License. Free to use, modify, and distribute.

---

## 🙌 Acknowledgments

- [RC-Switch](https://github.com/sui77/rc-switch)
- [ESP32 BLE Arduino](https://github.com/nkolban/ESP32_BLE_Arduino)
- Inspiration from open-source RF remote projects

```

```
