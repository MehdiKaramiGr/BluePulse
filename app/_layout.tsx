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
import SniffedCodesPanel from "@/components/SniffedCodesPanel";
import "react-native-reanimated";

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

	const theme: CustomTheme = {
		...(themeMode === "light" ? MD3LightTheme : MD3DarkTheme),
		myOwnProperty: true,
		colors: {
			...(themeMode === "light" ? MD3LightTheme.colors : MD3DarkTheme.colors),
			myOwnColor: "#BADA55",
		},
	};

	const renderScene = BottomNavigation.SceneMap({
		rf: () => <RfPanel isOpen={index == 0} />,
		ir: IrMenu,
		rfrx: () => <SniffedCodesPanel />,
		settings: ConnectionSettingsPanel,
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
					<Appbar.Action
						icon={themeMode === "light" ? "weather-sunny" : "weather-night"}
						onPress={toggleTheme}
					/>
				</Appbar.Header>

				<BottomNavigation
					navigationState={{ index, routes }}
					onIndexChange={setIndex}
					renderScene={renderScene}
				/>
			</>
		</PaperProvider>
	);
}
