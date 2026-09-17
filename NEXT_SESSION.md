# Next session: NFC triggers and power management

## Goal

Make it possible to trigger a saved BluePulse RF action by scanning an NFC tag with the **phone**, then reduce unnecessary battery use on both the Android phone and the ESP32/CC1101 bridge.

Do this in two stages. Do not change RF behaviour, BLE UUIDs, or the existing widget protocol until the current app and firmware are backed up and tested.

## Current architecture

- Android app: Expo / React Native, with native Android code under `android/`.
- BLE transport: `react-native-ble-plx` in `app/index.tsx`.
- ESP32 firmware in active use: `ESP32_script/BluePulse/C1101.ino`.
- Bridge is a BLE GATT server named `ESP32 KeyWave V2`.
- BLE command write characteristic: `12345678-1234-1234-1234-1234567890ad`.
- Standard RF command syntax remains `c,<code>,<band>,<protocol>,<repeat>`; burst behaviour is encoded by the existing app/firmware workflow.
- One CC1101 is shared between 315 MHz and 433.92 MHz. It continuously retunes while normal scanning is active (`RECEIVE_DWELL_MS = 150`). This is not battery-friendly.
- Android home widgets currently make a short BLE connection per send. Native widget code lives in `android/app/src/main/java/com/mehdi/grant/BluePulse/`.

## 1. NFC trigger feature

### Product behaviour

1. A user selects a saved Quick Access code and creates an NFC trigger for it.
2. The app writes an NDEF record to a compatible NFC tag, or binds an existing tag.
3. Scanning the tag with the phone opens BluePulse and resolves the tag to the saved local action.
4. Show a clear confirmation screen first: action name, frequency, Single/Burst mode, bridge state, and a **Send** button. Do not transmit automatically in the first release.
5. Add an explicit opt-in setting named **Send immediately after NFC scan** later, only after the confirmation flow is proven reliable.

### Tag format and security

- Store an opaque BluePulse trigger ID on the tag, **not the raw RF command**. Suggested payload: an NDEF URI such as `bluepulse://nfc/<trigger-id>`.
- Store the mapping from `trigger-id` to saved-code ID in local app storage. The tag should never contain the RF code, BLE device ID, or a secret.
- Treat tags as untrusted and clonable. NFC is a convenience trigger, not access control.
- Require the device to be unlocked and keep the confirmation step by default. Do not claim NFC makes a door or vehicle system secure.
- A deleted action, deleted trigger, malformed record, or unavailable bridge must fail safely and show an explanation without transmitting.

### Android implementation plan

1. Add a small native Android NFC module/package (Expo Go cannot provide this custom native behaviour; rebuild the Android app after adding it).
2. Use `NfcAdapter`/NDEF APIs to:
   - detect NFC availability and enabled state;
   - read and write NDEF URI records;
   - expose read/write methods to React Native;
   - pass a scanned `bluepulse://nfc/...` URI into the app when it is launched from a tag.
3. Update `android/app/src/main/AndroidManifest.xml` with the required NFC permission and intent/deep-link handling. Keep the existing `BluePulse` deep-link scheme consistent.
4. Add an **NFC triggers** section near Quick Access or Saved RF codes:
   - list trigger name, linked saved code, and last scan;
   - create/write, test, edit, delete, and rebind an existing tag;
   - clear wording when the phone has no NFC hardware or NFC is disabled.
5. Resolve the scan to the saved code, establish/verify the BLE connection, then reuse the existing `buildQuickAccessCommand()` + send flow. Do not create a second RF command formatter.
6. Test with at least two NDEF tags, one malformed/unrelated tag, NFC disabled, bridge out of range, and a deleted saved code.

### Important limitation

Because the NFC tag is scanned by the phone—not by the ESP32—the bridge must already be awake enough to advertise/connect over BLE. Phone-only NFC cannot wake an ESP32 that is in deep sleep. This constraint determines the battery strategy below.

## 2. ESP32 and CC1101 power/battery plan

### Measure before optimizing

Use a USB power meter or an INA219/INA226-style current monitor. Record average and peak current for:

| Scenario | What to measure |
| --- | --- |
| BLE advertising, normal RF scan | Current baseline with the current 150 ms band flip |
| Connected and idle | BLE connection interval effect |
| RF receiving | CC1101 RX current |
| RF transmit | Peak current during single and burst actions |
| Raw capture | Capture-session current |
| Sleep mode | Wake source and measured sleep current |

Document battery chemistry, capacity, regulator type, charger/protection board, and acceptable wake latency before selecting a sleep strategy. CC1101 and ESP32 must remain at safe 3.3 V levels.

### Recommended modes

Implement explicit user-selectable bridge modes instead of one hidden compromise:

1. **Always ready** — BLE advertising and RF scan enabled. Best for NFC/widget convenience; highest power draw.
2. **Connected ready** — advertise at a slower interval when idle; use a relaxed BLE connection interval when connected; RF receiver disabled except while using RF-RX/raw capture. Best first battery optimization for NFC use.
3. **Low-power standby** — RF receiver off, slow BLE advertising. NFC scan can still connect but may take longer.
4. **Deep sleep** — lowest power, but no phone-NFC or widget trigger until an external wake source is used. Suitable only with a physical button, RTC schedule, or separate low-power wake hardware.

### Firmware work order

1. Add a bridge power-mode enum and persist it safely (NVS/Preferences) rather than scattering sleep flags.
2. Stop the CC1101 receive/retune loop when the app is not actively receiving or raw capturing. Return it to the desired state after a transmit completes.
3. Tune BLE advertising and connection parameters per mode. Keep the bridge discoverable enough for Android NFC/widget sends in Always ready/Connected ready/Low-power standby.
4. Add a simple status command/notification containing mode, radio state, and (if hardware supports it) battery voltage/percentage.
5. Only after those are tested, add modem/light sleep. Deep sleep must have a documented wake source and must not be presented as compatible with instant NFC triggering.
6. Add brownout-safe transmit handling. RF bursts can create current peaks; verify the regulator and battery can supply them.

### Battery reporting hardware decision

Battery percentage is not reliable from ESP32 software alone. Decide the hardware first:

- Minimum: protected Li-ion/LiPo cell, appropriate charger, and a resistor-divider ADC input calibrated against the actual board.
- Better: a fuel-gauge IC such as MAX17048/MAX17043 or an INA219/INA226 if current measurements are also needed.
- Add low-battery cutoff/alert behaviour and never transmit repeatedly below the safe cell voltage.

## 3. Android phone battery plan

- Do not keep BLE scanning active outside the device-selection screen.
- Do not keep a permanent BLE connection solely for NFC. For a scan, connect, send, receive a result/timeout, then disconnect unless the user explicitly keeps the bridge connected.
- Reuse the existing widget sender's short-connection pattern where possible.
- NFC dispatch should only be active when necessary; use the NDEF deep-link/intents for scanned tags rather than a continuous background polling loop.
- Do not use periodic background workers for immediate NFC/RF actions. Android background limits make this less reliable and waste battery.
- Add an in-app connection/power diagnostic screen: BLE state, last RSSI, bridge power mode, last send duration, and battery data when available.

## Acceptance checklist

- [ ] A valid tag resolves to the correct saved action and opens a confirmation screen.
- [ ] The default NFC scan does not transmit until **Send** is pressed.
- [ ] An optional immediate-send mode is clearly warned and works only after explicit enablement.
- [ ] Invalid/unbound tag, disabled NFC, disconnected bridge, and missing saved action do not transmit.
- [ ] Multiple tags can point to different saved actions.
- [ ] NFC flow works from a cold app launch and when the app is already open.
- [ ] BLE/RF current is measured and documented before and after each ESP32 power-mode change.
- [ ] Always-ready mode reliably supports NFC and home-widget sends.
- [ ] Deep sleep clearly documents its external wake requirement.
- [ ] Android build passes `npx tsc --noEmit`, `npm run lint`, and `./android/gradlew -p android :app:compileDebugKotlin` with the configured Java 21 path.

## Build reminder

- Native NFC changes require a new Android build; Expo Go is insufficient.
- Local Android Studio release APK: **Build → Generate Signed Bundle / APK → APK → release**.
- Keep the release keystore outside the repository and use the same key for all future updates.
