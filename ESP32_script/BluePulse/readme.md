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
- **315 MHz RF transmitter/receiver**
- **433 MHz RF transmitter/receiver**

### Pin Mapping

| RF Function | GPIO Pin |
| ----------- | -------- |
| TX 315 MHz  | 27       |
| TX 433 MHz  | 26       |
| RX 315 MHz  | 13       |
| RX 433 MHz  | 14       |

⚠️ Note: GPIO14 is also a JTAG pin; some boards may reset if used incorrectly. In this project it is explicitly set as input to avoid reboots.

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
   - [rc-switch](https://github.com/sui77/rc-switch)
   - Modified `RCSwitch2` (for 315 MHz handling)
   - ESP32 BLE libraries (built-in with Arduino ESP32)
4. Flash this code to your ESP32.

---

## ⚙️ Modified RC-Switch2 Library

This project uses a modified version of [RC-Switch](https://github.com/sui77/rc-switch) called **RC-Switch2**.

### Why RC-Switch2?

- The standard RC-Switch library only allows one instance at a time per frequency.
- RC-Switch2 is modified to:
  - Sniff **both 315 MHz and 433 MHz simultaneously**
  - Avoid conflicts when using multiple transmitter/receiver instances
  - Support custom repeat and protocol handling

### Usage

- Include `RCSwitch2.h` and `RCSwitch2.cpp` from this repo in your project
- Use separate instances for 315 MHz and 433 MHz:
  ```cpp
  RCSwitch2 rx315;
  RCSwitch rx433;
  ```

Call `enableReceive(pin)` and `enableTransmit(pin)` per instance

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
