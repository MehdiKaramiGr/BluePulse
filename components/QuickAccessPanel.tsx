import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Alert, Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme } from "react-native-paper";
import { STORAGE_KEY } from "./RfPanel";
import { RfCode } from "./RfPanel/types";

type QuickAccessPanelProps = {
  onSendCode: (code: string) => Promise<void>;
  onRemoveFavorite: (id: string) => void;
  deviceName?: string | null; // Bluetooth device name
  open: boolean;
};

const screenWidth = Dimensions.get("window").width;
const numColumns = 2;
const itemWidth = screenWidth / numColumns - 28; // smaller than before

export default function QuickAccessPanel({ onSendCode, onRemoveFavorite, deviceName, open }: QuickAccessPanelProps) {
  const { colors } = useTheme();
  const [codes, setCodes] = useState<RfCode[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) setCodes(JSON.parse(data)?.filter((c: RfCode) => c.Favorite));
    });
  }, [open]);

  const handleLongPress = (item: RfCode) => {
    Alert.alert(
      item.Alias,
      "Options",
      [
        { text: "Remove from Favorites", onPress: () => onRemoveFavorite(item.Code), style: "destructive" },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true }
    );
  };

  const renderItem = ({ item }: { item: RfCode }) => (
    <TouchableOpacity
      style={[styles.card, { width: itemWidth, backgroundColor: colors.elevation.level3 }]}
      onPress={() => onSendCode(`c,${item?.Code},${item?.Freq == 315 ? 1 : 2},${item?.Protocol},${item?.Repeat}`)}
      onLongPress={() => handleLongPress(item)}
    >
      <MaterialCommunityIcons name="remote" size={44} color={colors.onSurface} style={styles.icon} />
      <Text style={[styles.name, { color: colors.onSurface }]} numberOfLines={1}>
        {item.Alias}
      </Text>
      <Text style={[styles.subtext, { color: colors.onSurfaceDisabled || colors.onSurface }]}>
        {`${item.Freq} MHz`}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Device connection status */}
      <View style={styles.connectionBar}>
        <MaterialCommunityIcons
          name={deviceName ? "bluetooth-connect" : "bluetooth-off"}
          size={18}
          color={deviceName ? "#4cd964" : "#ff3b30"}
        />
        <Text style={[styles.connectionText, { color: deviceName ? "#4cd964" : "#ff3b30" }]}>
          {deviceName ? `Connected to ${deviceName}` : "No device connected"}
        </Text>
      </View>

      {!codes.length ? (
        <Text style={[styles.title, { color: colors.onBackground }]}>There are no Codes bookmarked in the app</Text>
      ) : (
        <>
          <Text style={[styles.title, { color: colors.onBackground }]}>Quick Access</Text>

          <FlatList
            data={codes}
            keyExtractor={(item) => item.Code}
            renderItem={renderItem}
            numColumns={numColumns}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.listContent}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 12,
  },
  connectionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  connectionText: {
    fontSize: 14,
    marginLeft: 6,
    fontWeight: "500",
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginLeft: 16,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 12,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: 16,
  },
  card: {
    borderRadius: 18,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 4,
  },
  icon: {
    marginBottom: 10,
  },
  name: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  subtext: {
    fontSize: 12,
  },
});
