// ConnectionSettingsPanel.tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import { Device } from "react-native-ble-plx";
import { ActivityIndicator, Button, Card, Menu, Switch, Text } from "react-native-paper";
interface ConnectionSettingsPanelProps {
  connected: boolean;
  menuVisible: boolean;
  setMenuVisible: (visible: boolean) => void;
  selectedDevice: Device | null;
  scanning: boolean;
  devices: Device[];
  scanForDevices: () => void;
  setSelectedDevice: (device: Device) => void;
  setAutoConnect: (enabled: boolean) => void;
  autoConnect: boolean;
  restoreConnection: () => void;
  disconnect: () => void;
  connect: () => void;
}
const ConnectionSettingsPanel = ({
  connected,
  menuVisible,
  setMenuVisible,
  selectedDevice,
  scanning,
  devices,
  scanForDevices,
  setSelectedDevice,
  setAutoConnect,
  autoConnect,
  restoreConnection,
  disconnect,
  connect,
}: ConnectionSettingsPanelProps) => {
  return (
    <>
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
                  title={device.name}
                  onPress={() => {
                    setSelectedDevice(device);
                    setMenuVisible(false);
                  }}
                />
              ))}
            </Menu>
          </View>

          <View style={styles.row}>
            <Text>Auto-Connect</Text>
            <Switch
              value={autoConnect}
              onValueChange={(val) => {
                setAutoConnect(val);
                if (val) restoreConnection();
              }}
            />
          </View>

          <Button
            mode="contained"
            onPress={connected ? disconnect : connect}
            disabled={!selectedDevice}
            style={styles.connectBtn}
          >
            {connected ? "Disconnect" : "Connect"}
          </Button>
        </Card.Content>
      </Card>
    </>
  );
};

export default ConnectionSettingsPanel;

const styles = StyleSheet.create({
  card: { marginVertical: 8 },
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
