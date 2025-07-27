import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
	FlatList,
	NativeEventSubscription,
	StyleSheet,
	View,
} from "react-native";
import { BleManager } from "react-native-ble-plx";
import {
	Button,
	Card,
	Dialog,
	IconButton,
	MD3Theme,
	Portal,
	Text,
	TextInput,
	useTheme,
} from "react-native-paper";
import { v4 as uuidv4 } from "uuid";

interface SniffedCode {
	id: string;
	raw: string;
	Freq: number;
	Protocol: number;
}

interface SavedCode extends SniffedCode {
	Alias: string;
	SortId: number;
}

const STORAGE_KEY = "@rf_codes";
const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";

export default function SniffedCodesPanel({
	manager,
}: {
	manager: BleManager;
}) {
	const theme = useTheme();
	const styles = useThemedStyles(theme);

	const [sniffedCodes, setSniffedCodes] = useState<SniffedCode[]>([]);
	const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
	const [selectedCode, setSelectedCode] = useState<SniffedCode | null>(null);
	const [Alias, setAlias] = useState("");

	const [subscription, setSubscription] =
		useState<NativeEventSubscription | null>(null);

	// Load saved codes from AsyncStorage
	useEffect(() => {
		AsyncStorage.getItem(STORAGE_KEY).then((data) => {
			if (data) setSavedCodes(JSON.parse(data));
		});
	}, []);

	// Connect BLE and listen for data
	useEffect(() => {
		const connectAndSubscribe = async () => {
			const devices = await manager.devices([]);
			const device = devices.find((d) => d.name?.includes("ESP32")); // Adjust name if needed
			console.log("devices", devices);
			if (!device) return;

			await device.connect();
			await device.discoverAllServicesAndCharacteristics();
			const characteristic = await device.readCharacteristicForService(
				SERVICE_UUID,
				CHARACTERISTIC_UUID
			);

			const sub = device.monitorCharacteristicForService(
				SERVICE_UUID,
				CHARACTERISTIC_UUID,
				(error, characteristic) => {
					if (error || !characteristic?.value) return;

					const base64 = characteristic.value;
					const decoded = Buffer.from(base64, "base64").toString("utf8");

					try {
						const code = JSON.parse(decoded);
						if (!code.raw || !code.Freq || !code.Protocol) return;

						setSniffedCodes((prev) => {
							if (prev.find((c) => c.raw === code.raw)) return prev;
							return [...prev, { ...code, id: uuidv4() }];
						});
					} catch (e) {
						console.warn("Invalid JSON received:", decoded);
					}
				}
			);

			setSubscription(sub);
		};

		connectAndSubscribe();

		return () => {
			subscription?.remove();
			manager.destroy();
		};
	}, []);

	const persistSavedCodes = async (codes: SavedCode[]) => {
		setSavedCodes(codes);
		await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
	};

	const saveCode = () => {
		if (!selectedCode || !Alias.trim()) return;

		const newCode: SavedCode = {
			...selectedCode,
			Alias: Alias.trim(),
			SortId: savedCodes.length,
		};

		const updatedSavedCodes = [...savedCodes, newCode];
		persistSavedCodes(updatedSavedCodes);

		setSniffedCodes((prev) => prev.filter((c) => c.id !== selectedCode.id));
		setSelectedCode(null);
		setAlias("");
	};

	return (
		<View style={styles.container}>
			{sniffedCodes.length === 0 ? (
				<Text style={styles.emptyText}>No codes received yet.</Text>
			) : (
				<FlatList
					data={sniffedCodes}
					keyExtractor={(item) => item.id}
					renderItem={({ item }) => (
						<Card style={styles.card}>
							<Card.Title
								title={`Code: ${item.raw}`}
								subtitle={`Freq: ${item.Freq} MHz, Protocol: ${item.Protocol}`}
								right={(props) => (
									<View style={styles.cardActions}>
										<IconButton
											{...props}
											icon="content-save-outline"
											onPress={() => setSelectedCode(item)}
										/>
									</View>
								)}
							/>
						</Card>
					)}
				/>
			)}

			<Portal>
				<Dialog
					visible={!!selectedCode}
					onDismiss={() => setSelectedCode(null)}
				>
					<Dialog.Title>Save Code</Dialog.Title>
					<Dialog.Content>
						<TextInput
							placeholder="Enter Alias"
							value={Alias}
							onChangeText={setAlias}
							style={styles.input}
							mode="outlined"
							placeholderTextColor={theme.colors.onSurfaceVariant}
						/>
					</Dialog.Content>
					<Dialog.Actions>
						<Button onPress={() => setSelectedCode(null)}>Cancel</Button>
						<Button onPress={saveCode}>Save</Button>
					</Dialog.Actions>
				</Dialog>
			</Portal>
		</View>
	);
}

const useThemedStyles = (theme: MD3Theme) =>
	StyleSheet.create({
		container: {
			padding: 12,
			flex: 1,
			backgroundColor: theme.colors.background,
		},
		card: {
			marginVertical: 6,
			backgroundColor: theme.colors.surfaceVariant,
		},
		input: {
			backgroundColor: theme.colors.surface,
			color: theme.colors.onSurface,
			marginVertical: 8,
			borderRadius: 8,
		},
		emptyText: {
			textAlign: "center",
			marginTop: 50,
			color: theme.colors.onSurfaceVariant,
		},
		cardActions: {
			flexDirection: "row",
			justifyContent: "flex-end",
			alignItems: "center",
		},
	});
