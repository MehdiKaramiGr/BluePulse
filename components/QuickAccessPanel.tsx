import { MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Alert, Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type CodeItem = {
  id: string;
  name: string;
  code: number;
  freq: number;
  protocol: number;
  favorite: boolean;
};

type QuickAccessPanelProps = {
  favorites: CodeItem[];
  onSendCode: (code: CodeItem) => void;
  onRemoveFavorite: (id: string) => void;
  deviceName?: string | null; // Bluetooth device name
};

const screenWidth = Dimensions.get("window").width;
const numColumns = 2;
const itemWidth = screenWidth / numColumns - 28; // smaller than before

export default function QuickAccessPanel({
  favorites,
  onSendCode,
  onRemoveFavorite,
  deviceName,
}: QuickAccessPanelProps) {
  const handleLongPress = (item: CodeItem) => {
    Alert.alert(
      item.name,
      "Options",
      [
        { text: "Remove from favorites", onPress: () => onRemoveFavorite(item.id), style: "destructive" },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true }
    );
  };

  const renderItem = ({ item }: { item: CodeItem }) => (
    <TouchableOpacity
      style={[styles.card, { width: itemWidth }]}
      onPress={() => onSendCode(item)}
      onLongPress={() => handleLongPress(item)}
    >
      <MaterialCommunityIcons name="remote" size={44} color="#fff" style={styles.icon} />
      <Text style={styles.name} numberOfLines={1}>
        {item.name}
      </Text>
      <Text style={styles.subtext}>{`${item.freq} MHz`}</Text>
    </TouchableOpacity>
  );

  if (!favorites.length) return null;

  return (
    <View style={styles.container}>
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

      <Text style={styles.title}>Quick Access</Text>

      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={numColumns}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#111",
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
    color: "#fff",
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
    backgroundColor: "#1c1c1e",
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
    color: "#fff",
    marginBottom: 4,
  },
  subtext: {
    fontSize: 12,
    color: "#a1a1a1",
  },
});
