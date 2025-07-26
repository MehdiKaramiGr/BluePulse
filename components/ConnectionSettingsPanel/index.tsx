// ConnectionSettingsPanel.tsx
import React, { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, StyleSheet, View } from "react-native";
import { BleManager } from "react-native-ble-plx";
import { ActivityIndicator, Button, Card, Menu, Switch, Text } from "react-native-paper";

const ConnectionSettingsPanel = () => {
  const managerRef = useRef(new BleManager());
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);

  useEffect(() => {
    requestPermissions();
    return () => managerRef.current.destroy();
  }, []);

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

      if (device && device.name && !devices.find((d) => d.id === device.id)) {
        setDevices((prev) => [...prev, device]);
      }
    });

    // Stop after 5 seconds
    setTimeout(() => {
      managerRef.current.stopDeviceScan();
      setScanning(false);
    }, 5000);
  };

  const connect = async () => {
    if (!selectedDevice) return;

    try {
      const connected = await managerRef.current.connectToDevice(selectedDevice.id);
      await connected.discoverAllServicesAndCharacteristics();
      setConnected(true);
      setConnectedDevice(connected);
      console.log("Connected to:", connected.name);
    } catch (err) {
      console.error("Connection error:", err);
    }
  };

  const disconnect = async () => {
    if (connectedDevice) {
      await connectedDevice.cancelConnection();
      setConnected(false);
      setConnectedDevice(null);
      console.log("Disconnected");
    }
  };

  return (
    <Card style={styles.card}>
      <Card.Title title="Connection Settings" />
      <Card.Content>
        <Text>Status: {connected ? "✅ Connected" : "❌ Disconnected"}</Text>

        <View style={styles.row}>
          <Text>Device:</Text>
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                onPress={() => {
                  setMenuVisible(true);
                  scanForDevices();
                }}
              >
                {selectedDevice ? selectedDevice.name : scanning ? "Scanning..." : "Select Device"}
              </Button>
            }
          >
            {scanning && <ActivityIndicator size="small" />}
            {devices.map((device) => (
              <Menu.Item
                key={device.id}
                onPress={() => {
                  setSelectedDevice(device);
                  setMenuVisible(false);
                }}
                title={device.name}
              />
            ))}
          </Menu>
        </View>

        <View style={styles.row}>
          <Text>Auto-Connect</Text>
          <Switch value={autoConnect} onValueChange={setAutoConnect} />
        </View>

        <Button
          mode="contained"
          onPress={connected ? disconnect : connect}
          style={styles.connectBtn}
          disabled={!selectedDevice}
        >
          {connected ? "Disconnect" : "Connect"}
        </Button>
      </Card.Content>
    </Card>
  );
};

export default ConnectionSettingsPanel;

const styles = StyleSheet.create({
  card: {
    marginVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
  },
  connectBtn: {
    marginTop: 16,
  },
});
