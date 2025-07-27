import { Buffer } from "buffer";
import { useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, Device } from "react-native-ble-plx";

type UseBLEOptions = {
	serviceUUID: string;
	writeCharacteristicUUID: string;
	notifyCharacteristicUUID: string;
	autoConnect?: boolean;
};

const useBLE = ({
	serviceUUID,
	writeCharacteristicUUID,
	notifyCharacteristicUUID,
	autoConnect = true,
}: UseBLEOptions) => {
	const managerRef = useRef(new BleManager());
	const [connected, setConnected] = useState(false);
	const [devices, setDevices] = useState<Device[]>([]);
	const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
	const [scanning, setScanning] = useState(false);
	const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
	const [dataList, setDataList] = useState<string[]>([]);
	const subscriptionRef = useRef<any>(null);

	// Request necessary permissions on mount
	useEffect(() => {
		requestPermissions();
		return () => {
			managerRef.current.destroy();
			subscriptionRef.current?.remove();
		};
	}, []);

	// Handle auto-connect when device is selected
	useEffect(() => {
		if (autoConnect && selectedDevice && !connected) {
			connect();
		}
	}, [selectedDevice, autoConnect]);

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

			if (device?.name && !devices.some((d) => d.id === device.id)) {
				setDevices((prev) => [...prev, device]);
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
			const device = await managerRef.current.connectToDevice(
				selectedDevice.id
			);
			await device.discoverAllServicesAndCharacteristics();

			// Set up notifications
			const subscription = device.monitorCharacteristicForService(
				serviceUUID,
				notifyCharacteristicUUID,
				(error, characteristic) => {
					if (error) {
						console.error("Monitor error:", error);
						return;
					}
					if (characteristic?.value) {
						const decoded = Buffer.from(
							characteristic.value,
							"base64"
						).toString("utf8");
						setDataList((prev) => [decoded, ...prev]);
					}
				}
			);

			subscriptionRef.current = subscription;
			setConnectedDevice(device);
			setConnected(true);
			console.log("Connected to:", device.name);
		} catch (err) {
			console.error("Connection error:", err);
		}
	};

	const disconnect = async () => {
		if (connectedDevice) {
			try {
				subscriptionRef.current?.remove();
				subscriptionRef.current = null;
				await connectedDevice.cancelConnection();
				setConnected(false);
				setConnectedDevice(null);
				console.log("Disconnected");
			} catch (err) {
				console.error("Disconnection error:", err);
			}
		}
	};

	const sendData = async (data: string) => {
		if (!connectedDevice) {
			console.warn("No device connected");
			return;
		}
		try {
			const base64Data = Buffer.from(data).toString("base64");
			await managerRef.current.writeCharacteristicWithResponseForDevice(
				connectedDevice.id,
				serviceUUID,
				writeCharacteristicUUID,
				base64Data
			);
			console.log("Data sent:", data);
			return true;
		} catch (error) {
			console.error("Failed to send data:", error);
			return false;
		}
	};

	return {
		// State
		connected,
		devices,
		selectedDevice,
		scanning,
		dataList,

		// Actions
		scanForDevices,
		setSelectedDevice,
		connect,
		disconnect,
		sendData,

		// Helpers
		isConnected: connected,
		isScanning: scanning,
		hasDevices: devices.length > 0,
		hasData: dataList.length > 0,
	};
};

export default useBLE;
