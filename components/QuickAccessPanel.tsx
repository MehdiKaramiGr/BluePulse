import React, { useState, useEffect } from "react";
import { View, Text, FlatList, TouchableOpacity, Alert, StyleSheet } from "react-native";

// Sample data type
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
};

export default function QuickAccessPanel({ favorites, onSendCode, onRemoveFavorite }: QuickAccessPanelProps) {
  // Long press handler for edit/delete options
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
    <TouchableOpacity style={styles.codeBox} onPress={() => onSendCode(item)} onLongPress={() => handleLongPress(item)}>
      <Text style={styles.codeName}>{item.name}</Text>
      <Text style={styles.codeDetails}>{`Code: ${item.code}`}</Text>
      <Text style={styles.codeDetails}>{`Freq: ${item.freq} MHz`}</Text>
    </TouchableOpacity>
  );

  if (favorites.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Quick Access</Text>
      <FlatList
        horizontal
        data={favorites}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 10 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    backgroundColor: "#222",
  },
  title: {
    color: "#eee",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 12,
    marginBottom: 6,
  },
  codeBox: {
    backgroundColor: "#444",
    borderRadius: 8,
    padding: 10,
    marginRight: 10,
    width: 140,
  },
  codeName: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 4,
  },
  codeDetails: {
    color: "#ccc",
    fontSize: 12,
  },
});
