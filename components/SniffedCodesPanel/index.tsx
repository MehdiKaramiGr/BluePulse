import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Button, Card, Dialog, IconButton, MD3Theme, Portal, Text, TextInput, useTheme } from "react-native-paper";

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

export default function SniffedCodesPanel() {
  const theme = useTheme();
  const styles = useThemedStyles(theme);

  const [sniffedCodes, setSniffedCodes] = useState<SniffedCode[]>([]);
  const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
  const [selectedCode, setSelectedCode] = useState<SniffedCode | null>(null);
  const [Alias, setAlias] = useState("");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) setSavedCodes(JSON.parse(data));
    });
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

    const updatedSavedCodes = [...savedCodes, { Code: selectedCode.raw, ...newCode }];
    persistSavedCodes(updatedSavedCodes);

    setSniffedCodes((prev) => prev.filter((c) => c.id !== selectedCode.id));
    setSelectedCode(null);
    setAlias("");
  };

  // Dummy sniffed codes for testing
  useEffect(() => {
    setSniffedCodes([
      { id: "1", raw: "21654", Freq: 443, Protocol: 2 },
      { id: "2", raw: "98765", Freq: 315, Protocol: 1 },
    ]);
  }, []);

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
                    <IconButton {...props} icon="transmission-tower-export" onPress={() => setSelectedCode(item)} />
                    <IconButton {...props} icon="content-save-outline" onPress={() => setSelectedCode(item)} />
                  </View>
                )}
              />
            </Card>
          )}
        />
      )}

      <Portal>
        <Dialog visible={!!selectedCode} onDismiss={() => setSelectedCode(null)}>
          <Dialog.Title>Save Code</Dialog.Title>
          <Dialog.Content>
            <TextInput
              placeholder="Enter Alias"
              value={Alias}
              onChangeText={setAlias}
              style={styles.input}
              mode="outlined"
              placeholderTextColor={theme.colors.onSurfaceVariant} // or another suitable color
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
      color: theme.colors.onSurface, // Text color to match the theme's onSurface
      marginVertical: 8,
      borderRadius: 8,
    },
    emptyText: {
      textAlign: "center",
      marginTop: 50,
      color: theme.colors.onSurfaceVariant,
    },
    cardActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  });
