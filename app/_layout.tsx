import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts } from "expo-font";
import React, { useEffect, useState } from "react";
import {
  Appbar,
  BottomNavigation,
  MD3DarkTheme,
  MD3LightTheme,
  MD3Theme,
  PaperProvider,
  Text,
} from "react-native-paper";

import ConnectionSettingsPanel from "@/components/ConnectionSettingsPanel";
import RfPanel from "@/components/RfPanel";
import SniffedCodesPanel, { SniffedCode } from "@/components/SniffedCodesPanel";
import "react-native-reanimated";

// ConnectionSettingsPanel.tsx

import { Buffer } from "buffer";
import { useRef } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import { BleManager, Device, Subscription } from "react-native-ble-plx";

export const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const WRITE_CHAR_UUID = "12345678-1234-1234-1234-1234567890ad";
export const NOTIFY_CHAR_UUID = "12345678-1234-1234-1234-1234567890ac";

const STORAGE_KEY_LAST_DEVICE_ID = "@last_connected_device_id";

// Define your routes and their components
const IrMenu = () => <Text>Comming soon...</Text>;
const Settings = () => <Text>settings</Text>;

type ThemeMode = "light" | "dark";

interface CustomTheme extends MD3Theme {
  myOwnProperty: boolean;
  colors: MD3Theme["colors"] & {
    myOwnColor: string;
  };
}

const THEME_KEY = "APP_THEME_MODE";

export default function RootLayout() {
  const [index, setIndex] = useState(0);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");

  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  const [routes] = useState([
    { key: "rf", title: "RF-TX", focusedIcon: "radio-tower" },
    { key: "ir", title: "IR-TX", focusedIcon: "remote" },
    { key: "rfrx", title: "RF-RX", focusedIcon: "radar" },
    { key: "settings", title: "Settings", focusedIcon: "cog" },
  ]);

  const managerRef = useRef(new BleManager());
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connected, setConnected] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sniffedCodes, setSniffedCodes] = useState<SniffedCode[]>([]);

  useEffect(() => {
    requestPermissions();
    restoreConnection();

    const manager = managerRef.current;
    return () => {
      manager.destroy();
    };
  }, []);

  useEffect(() => {
    if (connectedDevice) {
      const subscription = monitorDisconnection(connectedDevice);
      return () => subscription?.remove();
    }
  }, [connectedDevice]);

  const requestPermissions = async () => {
    if (Platform.OS === "android" && Platform.Version >= 23) {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  };

  const scanForDevices = async () => {
    setScanning(true);
    setDevices([]);

    managerRef.current.startDeviceScan(null, null, (error, device) => {
      if (error) {
        console.error("Scan error:", error);
        setScanning(false);
        return;
      }
      if (device?.name) {
        setDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, device]));
      }
    });

    setTimeout(() => {
      managerRef.current.stopDeviceScan();
      setScanning(false);
    }, 5000);
  };

  const restoreConnection = async () => {
    const lastId = await AsyncStorage.getItem(STORAGE_KEY_LAST_DEVICE_ID);
    if (!lastId || !autoConnect) return;

    try {
      const device = await managerRef.current.connectToDevice(lastId, {
        autoConnect: true,
      });
      await device.discoverAllServicesAndCharacteristics();
      setConnectedDevice(device);
      setConnected(true);
      setSelectedDevice(device);
      console.log("Restored connection to", device.name);
    } catch (err) {
      console.warn("Failed to auto-reconnect:", err);
    }
  };

  const connect = async () => {
    if (!selectedDevice) return;
    try {
      const device = await managerRef.current.connectToDevice(selectedDevice.id);
      await device.discoverAllServicesAndCharacteristics();
      setConnectedDevice(device);
      setConnected(true);
      await AsyncStorage.setItem(STORAGE_KEY_LAST_DEVICE_ID, selectedDevice.id);
      console.log("Connected to", device.name);
    } catch (err: any) {
      console.error("Connection failed:", err);
      Alert.alert("Connection Failed", err.message);
    }
  };

  const disconnect = async () => {
    if (connectedDevice) {
      try {
        await connectedDevice.cancelConnection();
      } catch (e) {}
      setConnectedDevice(null);
      setConnected(false);
      await AsyncStorage.removeItem(STORAGE_KEY_LAST_DEVICE_ID);
      console.log("Disconnected");
    }
  };

  const monitorDisconnection = (device: Device): Subscription => {
    return managerRef.current.onDeviceDisconnected(device.id, (error) => {
      if (error) {
        console.warn("Unexpected disconnection:", error.message);
      }
      setConnected(false);
      setConnectedDevice(null);
      if (autoConnect) {
        console.log("Attempting to reconnect...");
        restoreConnection();
      }
    });
  };

  const sendDataToDevice = async (data: string) => {
    if (!connectedDevice) return;

    try {
      const base64Data = Buffer.from(data).toString("base64");

      await managerRef.current.writeCharacteristicWithResponseForDevice(
        connectedDevice.id,
        SERVICE_UUID,
        WRITE_CHAR_UUID,
        base64Data
      );

      console.log("Sent:", data);
    } catch (err) {
      console.error("Failed to send data:", err);
    }
  };

  const theme: CustomTheme = {
    ...(themeMode === "light" ? MD3LightTheme : MD3DarkTheme),
    myOwnProperty: true,
    colors: {
      ...(themeMode === "light" ? MD3LightTheme.colors : MD3DarkTheme.colors),
      myOwnColor: "#BADA55",
    },
  };

  const renderScene = BottomNavigation.SceneMap({
    rf: () => <RfPanel isOpen={index == 0} sendDataToDevice={sendDataToDevice} />,
    ir: IrMenu,
    rfrx: () => (
      <SniffedCodesPanel
        device={connectedDevice}
        serviceUUID={SERVICE_UUID}
        characteristicUUID={NOTIFY_CHAR_UUID}
        sniffedCodes={sniffedCodes}
        setSniffedCodes={setSniffedCodes}
        sendDataToDevice={sendDataToDevice}
      />
    ),

    settings: () => (
      <ConnectionSettingsPanel
        connected={connected}
        menuVisible={menuVisible}
        setMenuVisible={setMenuVisible}
        selectedDevice={selectedDevice}
        scanning={scanning}
        devices={devices}
        scanForDevices={scanForDevices}
        setSelectedDevice={setSelectedDevice}
        setAutoConnect={setAutoConnect}
        autoConnect={autoConnect}
        restoreConnection={restoreConnection}
        disconnect={disconnect}
        connect={connect}
      />
    ),
  });

  // Load saved theme mode from AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_KEY);
        if (savedTheme === "light" || savedTheme === "dark") {
          setThemeMode(savedTheme);
        }
      } catch (e) {
        console.warn("Failed to load theme mode", e);
      }
    })();
  }, []);

  const toggleTheme = async () => {
    const newMode: ThemeMode = themeMode === "light" ? "dark" : "light";
    setThemeMode(newMode);
    try {
      await AsyncStorage.setItem(THEME_KEY, newMode);
    } catch (e) {
      console.warn("Failed to save theme mode", e);
    }
  };

  if (!loaded) return null;

  return (
    <PaperProvider theme={theme}>
      <>
        <Appbar.Header>
          <Appbar.Content title="Flip" />
          <Appbar.Action icon={themeMode === "light" ? "weather-sunny" : "weather-night"} onPress={toggleTheme} />
        </Appbar.Header>

        <BottomNavigation navigationState={{ index, routes }} onIndexChange={setIndex} renderScene={renderScene} />
      </>
    </PaperProvider>
  );
}
