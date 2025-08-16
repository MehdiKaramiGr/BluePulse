import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { FlatList, NativeEventSubscription, StyleSheet, View } from "react-native";
import { Device } from "react-native-ble-plx";
import {
  Button,
  Card,
  Dialog,
  IconButton,
  MD3Theme,
  Portal,
  Text,
  TextInput,
  Tooltip,
  useTheme,
} from "react-native-paper";

export interface SniffedCode {
  id: string;
  raw: string;
  Freq: number;
  Protocol: number;
}

interface SavedCode extends SniffedCode {
  Alias: string;
  SortId: number;
  Code: string;
  Favorite: boolean;
  Repeat: number;
}

const STORAGE_KEY = "@rf_codes";
interface BleDataListenerProps {
  device: Device | null;
  serviceUUID: string;
  characteristicUUID: string;
  sniffedCodes: SniffedCode[];
  setSniffedCodes: React.Dispatch<React.SetStateAction<SniffedCode[]>>;
  sendDataToDevice: (data: string) => void;
}

export default function SniffedCodesPanel({
  device,
  serviceUUID,
  characteristicUUID,
  sniffedCodes,
  setSniffedCodes,
  sendDataToDevice,
}: BleDataListenerProps) {
  const theme = useTheme();
  const styles = useThemedStyles(theme);

  const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
  const [selectedCode, setSelectedCode] = useState<SniffedCode | null>(null);
  const [Alias, setAlias] = useState("");

  const [subscription, setSubscription] = useState<NativeEventSubscription | null>(null);
  const [dataList, setDataList] = useState<string[]>([]);

  useEffect(() => {
    if (!device) return;

    // Subscribe to notifications on characteristic
    const subscribe = async () => {
      try {
        const subscription = device.monitorCharacteristicForService(
          serviceUUID,
          characteristicUUID,
          (error, characteristic) => {
            if (error) {
              console.error("Monitor error:", error);
              return;
            }
            if (characteristic?.value) {
              // Decode base64 data to string
              const decoded = atob(characteristic.value)?.split(",");

              let res = {
                id: decoded?.[0],
                raw: decoded?.[0],
                Freq: decoded?.[1] == "1" ? 315 : 443,
                Protocol: Number(decoded?.[2]),
              };
              if (!!res?.raw && !!res?.Freq && !!res?.Protocol) {
                setSniffedCodes((prev) => {
                  if (!prev?.map(({ id }) => id).includes(decoded?.[0])) {
                    return [res, ...prev];
                  } else {
                    return prev;
                  }
                });
              }
            }
          }
        );
        setSubscription(subscription);
      } catch (e) {
        console.error("Subscribe failed", e);
      }
    };

    subscribe();

    // Cleanup on unmount or device change
    return () => {
      subscription?.remove();
      setSubscription(null);
    };
  }, [device, serviceUUID, characteristicUUID]);

  // Load saved codes from AsyncStorage
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
      Code: selectedCode?.raw,
      Favorite: false,
      Repeat: 1,
    };

    const updatedSavedCodes = [...savedCodes, newCode];

    persistSavedCodes(updatedSavedCodes);

    setSniffedCodes((prev) => prev.filter((c) => c.id !== selectedCode.id));
    setSelectedCode(null);
    setAlias("");
  };

  const clearAllCodes = () => {
    // Clear in-memory lists
    setSniffedCodes([]);
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
                    <Tooltip title="Send the code">
                      <IconButton
                        icon="transmission-tower-export"
                        onPress={() => {
                          sendDataToDevice(`c,${item?.raw},${item?.Freq == 315 ? 1 : 2},${item?.Protocol}`);
                        }}
                        {...props}
                      />
                    </Tooltip>
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
              placeholderTextColor={theme.colors.onSurfaceVariant}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSelectedCode(null)}>Cancel</Button>
            <Button onPress={saveCode}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {sniffedCodes?.length > 0 ? (
        <Button
          mode="contained"
          onPress={clearAllCodes}
          style={{ marginVertical: 8, position: "absolute", bottom: 0, zIndex: 5 }}
        >
          Clear All Codes
        </Button>
      ) : null}
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
