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

---

## 📤 BLE Notifications

When an RF code is received, it is pushed via BLE in the format:
`<CODE>,<FREQ_FLAG>,<PROTOCOL>`

Example:
654321,1,3
➡️ Received code `654321` at **315 MHz**, protocol **3**.

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

👉 [BluePulse App Repo](#) _(link to your RN repo when public)_

---

## 📝 Roadmap

- [ ] Add raw protocol support
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
