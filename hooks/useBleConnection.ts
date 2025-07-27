import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import { useEffect, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

export const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const WRITE_CHAR_UUID = "12345678-1234-1234-1234-1234567890ad";
export const NOTIFY_CHAR_UUID = "12345678-1234-1234-1234-1234567890ac";
const STORAGE_KEY_LAST_DEVICE_ID = "@last_connected_device_id";

export default function useBleConnection(autoConnectEnabled: boolean = true) {
  const managerRef = useRef(new BleManager());
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  useEffect(() => {
    const requestPermissions = async () => {
      if (Platform.OS === "android" && Platform.Version >= 23) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
      }
    };

    requestPermissions();
    restoreConnection();

    return () => {
      managerRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (connectedDevice) {
      const sub = managerRef.current.onDeviceDisconnected(connectedDevice.id, () => {
        setConnected(false);
        setConnectedDevice(null);
        if (autoConnectEnabled) {
          restoreConnection();
        }
      });
      return () => sub.remove();
    }
  }, [connectedDevice]);

  const scanForDevices = async () => {
    setDevices([]);
    setScanning(true);

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

  const connect = async () => {
    if (!selectedDevice) return;
    try {
      const device = await managerRef.current.connectToDevice(selectedDevice.id);
      await device.discoverAllServicesAndCharacteristics();
      setConnectedDevice(device);
      setConnected(true);
      await AsyncStorage.setItem(STORAGE_KEY_LAST_DEVICE_ID, device.id);
    } catch (err: any) {
      Alert.alert("Connection Failed", err.message);
    }
  };

  const disconnect = async () => {
    if (connectedDevice) {
      await connectedDevice.cancelConnection().catch(() => {});
      setConnected(false);
      setConnectedDevice(null);
      await AsyncStorage.removeItem(STORAGE_KEY_LAST_DEVICE_ID);
    }
  };

  const restoreConnection = async () => {
    if (!autoConnectEnabled) return;
    const lastId = await AsyncStorage.getItem(STORAGE_KEY_LAST_DEVICE_ID);
    if (!lastId) return;

    try {
      const device = await managerRef.current.connectToDevice(lastId, { autoConnect: true });
      await device.discoverAllServicesAndCharacteristics();
      setConnectedDevice(device);
      setConnected(true);
      setSelectedDevice(device);
    } catch (err) {
      console.warn("Auto-connect failed", err);
    }
  };

  const sendData = async (data: string) => {
    if (!connectedDevice) return;
    const base64Data = Buffer.from(data).toString("base64");

    await managerRef.current.writeCharacteristicWithResponseForDevice(
      connectedDevice.id,
      SERVICE_UUID,
      WRITE_CHAR_UUID,
      base64Data
    );

    console.log("Sent:", data);
  };

  return {
    connected,
    connectedDevice,
    scanning,
    devices,
    selectedDevice,
    setSelectedDevice,
    scanForDevices,
    connect,
    disconnect,
    sendData,
  };
}
