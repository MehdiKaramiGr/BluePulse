# BluePulse

**BluePulse** is a cross-platform React Native app (built with Expo) designed to communicate with ESP32-based RF control hardware via Bluetooth. The app allows users to manage, send, and organize RF codes over BLE with an intuitive UI.

---

## 🔧 Features

- 📡 Connects to ESP32 via Bluetooth Low Energy (BLE)
- 📁 View and manage a list of saved RF codes
- 🎯 Tap to send RF code (single or rapid fire)
- 🛠️ Edit code details (name, frequency, payload)
- ⚠️ Delete codes with confirmation modal
- 🆕 Add new RF codes via modal
- 🔁 Toggle between 315 MHz and 433 MHz

---

## 📸 Screenshots

### Quick Access Panel

![Quick Access](assets/screenshots/quick-access.jpg)

### Saved Codes

![Saved Codes](assets/screenshots/saved-codes.jpg)

### Edit RF Code

![Edit Code](assets/screenshots/save-rf.jpg)

### Sniffing Mode

![Sniffing Mode](assets/screenshots/sniffing-mode.jpg)

### Setting

![Setting](assets/screenshots/setting.jpg)

---

## 💡 Use Case

This app replaces the need for a physical screen/input on ESP32-based RF remote devices. It is designed as part of a DIY toolkit to interact with smart home RF devices and IR devieces in future developments (e.g. garage doors, lights, etc.).

---

## 📦 Tech Stack

- React Native + Expo
- React Navigation
- Bluetooth integration using Expo BLE
- TypeScript

---

## 🚀 How to Run

````bash
git clone https://github.com/mehdikaramigr/bluepulse
cd bluepulse
npm install
npx expo start




# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
````

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
