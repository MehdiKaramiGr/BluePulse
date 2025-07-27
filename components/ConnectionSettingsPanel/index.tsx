// ConnectionSettingsPanel.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import React, { useEffect, useRef, useState } from "react";
import {
	Alert,
	PermissionsAndroid,
	Platform,
	StyleSheet,
	View,
} from "react-native";
import { BleManager, Device, Subscription } from "react-native-ble-plx";
import {
	ActivityIndicator,
	Button,
	Card,
	Menu,
	Switch,
	Text,
} from "react-native-paper";
import BleDataListener from "./BleDataListener";

export const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const WRITE_CHAR_UUID = "12345678-1234-1234-1234-1234567890ad";
export const NOTIFY_CHAR_UUID = "12345678-1234-1234-1234-1234567890ac";

const STORAGE_KEY_LAST_DEVICE_ID = "@last_connected_device_id";

const ConnectionSettingsPanel = () => {
	const managerRef = useRef(new BleManager());
	const [devices, setDevices] = useState<Device[]>([]);
	const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
	const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
	const [connected, setConnected] = useState(false);
	const [autoConnect, setAutoConnect] = useState(true);
	const [menuVisible, setMenuVisible] = useState(false);
	const [scanning, setScanning] = useState(false);

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
				setDevices((prev) =>
					prev.find((d) => d.id === device.id) ? prev : [...prev, device]
				);
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
			const device = await managerRef.current.connectToDevice(
				selectedDevice.id
			);
			await device.discoverAllServicesAndCharacteristics();
			setConnectedDevice(device);
			setConnected(true);
			await AsyncStorage.setItem(STORAGE_KEY_LAST_DEVICE_ID, selectedDevice.id);
			console.log("Connected to", device.name);
		} catch (err) {
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
									{selectedDevice
										? selectedDevice.name
										: scanning
										? "Scanning..."
										: "Select Device"}
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

			<Button
				mode="contained"
				disabled={!connected}
				onPress={() => sendDataToDevice("Hello ESP32")}
			>
				Send Hello
			</Button>
			<BleDataListener
				device={connectedDevice}
				serviceUUID={SERVICE_UUID}
				characteristicUUID={NOTIFY_CHAR_UUID}
			/>
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
