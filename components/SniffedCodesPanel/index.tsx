import { Buffer } from "buffer";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { Device, Subscription } from "react-native-ble-plx";
import {
  Button,
  Card,
  Chip,
  Dialog,
  Portal,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import {
  buildTransmitCommand,
  createCodeId,
  DEFAULT_RF_LIBRARY_SETTINGS,
  loadRfCodes,
  loadRfLibrarySettings,
  saveRfCodes,
} from "../RfPanel/codeLibrary";
import { RfCode } from "../RfPanel/types";

export interface SniffedCode {
  Freq: number;
  Protocol: number;
  id: string;
  raw: string;
}

interface SniffedCodesPanelProps {
  characteristicUUID: string;
  device: Device | null;
  isOpen: boolean;
  sendDataToDevice: (data: string) => Promise<void>;
  serviceUUID: string;
  setSniffedCodes: React.Dispatch<React.SetStateAction<SniffedCode[]>>;
  sniffedCodes: SniffedCode[];
}

function capturedCodeSignature(code: Pick<SniffedCode, "raw" | "Freq" | "Protocol">) {
  return [code.raw, code.Freq, code.Protocol].join("|");
}

export default function SniffedCodesPanel({
  characteristicUUID,
  device,
  isOpen,
  sendDataToDevice,
  serviceUUID,
  setSniffedCodes,
  sniffedCodes,
}: SniffedCodesPanelProps) {
  const theme = useTheme();
  const [savedCodes, setSavedCodes] = useState<RfCode[]>([]);
  const [defaultRepeat, setDefaultRepeat] = useState(DEFAULT_RF_LIBRARY_SETTINGS.defaultRepeat);
  const [selectedCode, setSelectedCode] = useState<SniffedCode | null>(null);
  const [alias, setAlias] = useState("");
  const [repeat, setRepeat] = useState(String(DEFAULT_RF_LIBRARY_SETTINGS.defaultRepeat));
  const [favorite, setFavorite] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;

    void Promise.all([loadRfCodes(), loadRfLibrarySettings()]).then(([codes, settings]) => {
      if (!mounted) return;
      setSavedCodes(codes);
      setDefaultRepeat(settings.defaultRepeat);
      setRepeat(String(settings.defaultRepeat));
    });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !device) return;

    let subscription: Subscription | undefined;
    try {
      subscription = device.monitorCharacteristicForService(
        serviceUUID,
        characteristicUUID,
        (error, characteristic) => {
          if (error) {
            setNotice("Capture listener error: " + error.message);
            return;
          }
          if (!characteristic?.value) return;

          const decoded = Buffer.from(characteristic.value, "base64").toString("utf8").trim().split(",");
          const raw = decoded[0]?.trim();
          const frequencyFlag = decoded[1]?.trim();
          const protocol = Number(decoded[2]);
          const frequency = frequencyFlag === "1" ? 315 : frequencyFlag === "2" ? 433 : 0;

          if (!raw || !/^[0-9]+$/.test(raw) || !frequency || !Number.isInteger(protocol) || protocol < 1) {
            return;
          }

          const captured: SniffedCode = {
            id: [raw, frequency, protocol].join("-"),
            raw,
            Freq: frequency,
            Protocol: protocol,
          };
          setSniffedCodes((current) => {
            const signature = capturedCodeSignature(captured);
            if (current.some((code) => capturedCodeSignature(code) === signature)) return current;
            return [captured, ...current].slice(0, 200);
          });
        }
      );
    } catch (error) {
      setNotice("Could not start capture: " + (error instanceof Error ? error.message : "unknown error"));
    }

    return () => subscription?.remove();
  }, [characteristicUUID, device, isOpen, serviceUUID, setSniffedCodes]);

  const openSaveDialog = useCallback(
    (code: SniffedCode) => {
      setSelectedCode(code);
      setAlias("Code " + code.raw.slice(-6));
      setRepeat(String(defaultRepeat));
      setFavorite(true);
    },
    [defaultRepeat]
  );

  const saveCapturedCode = useCallback(async () => {
    if (!selectedCode) return;
    const name = alias.trim();
    const repeatValue = Number(repeat);

    if (!name) {
      setNotice("Give the captured code a name before saving.");
      return;
    }
    if (!Number.isInteger(repeatValue) || repeatValue < 1 || repeatValue > 99) {
      setNotice("Repeat must be a whole number from 1 to 99.");
      return;
    }

    const existing = savedCodes.find(
      (code) =>
        code.Code === selectedCode.raw &&
        code.Freq === selectedCode.Freq &&
        code.Protocol === selectedCode.Protocol
    );
    if (existing) {
      setNotice("This signal is already saved as " + existing.Alias + ".");
      return;
    }

    const now = new Date().toISOString();
    const codeToSave: RfCode = {
      id: createCodeId(),
      Alias: name,
      Code: selectedCode.raw,
      Freq: selectedCode.Freq,
      Protocol: selectedCode.Protocol,
      Repeat: repeatValue,
      Favorite: favorite,
      SortId: savedCodes.length,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const nextSavedCodes = await saveRfCodes([...savedCodes, codeToSave]);
      setSavedCodes(nextSavedCodes);
      setSniffedCodes((current) => current.filter((code) => code.id !== selectedCode.id));
      setSelectedCode(null);
      setNotice("Saved " + name + ".");
    } catch {
      setNotice("Could not save the captured code.");
    }
  }, [alias, favorite, repeat, savedCodes, selectedCode, setSniffedCodes]);

  const sendCapturedCode = useCallback(
    async (code: SniffedCode) => {
      await sendDataToDevice(
        buildTransmitCommand({
          Code: code.raw,
          Freq: code.Freq,
          Protocol: code.Protocol,
          Repeat: defaultRepeat,
        })
      );
    },
    [defaultRepeat, sendDataToDevice]
  );

  const clearCapturedCodes = useCallback(() => {
    Alert.alert("Clear captured codes?", "This only clears the temporary capture list. Saved codes are unchanged.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => setSniffedCodes([]) },
    ]);
  }, [setSniffedCodes]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        contentContainerStyle={styles.listContent}
        data={sniffedCodes}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text variant="titleMedium">{device ? "Listening for RF codes" : "No bridge connected"}</Text>
            <Text style={styles.muted} variant="bodyMedium">
              {device
                ? "Press a compatible remote near the receiver. Each unique code will appear here."
                : "Connect your BluePulse bridge in Settings to start receiving codes."}
            </Text>
          </View>
        }
        ListHeaderComponent={
          <Card mode="contained" style={styles.headerCard}>
            <Card.Title
              title="Code capture"
              subtitle={device ? "Listening on 315 and 433 MHz" : "Connect a bridge to start listening"}
            />
            <Card.Content style={styles.headerContent}>
              <View style={styles.statsRow}>
                <Chip icon="radar">{sniffedCodes.length} captured</Chip>
                <Chip icon="repeat">{defaultRepeat} default repeats</Chip>
              </View>
              {sniffedCodes.length > 0 ? (
                <Button icon="delete-sweep-outline" mode="outlined" onPress={clearCapturedCodes}>
                  Clear captures
                </Button>
              ) : null}
            </Card.Content>
          </Card>
        }
        renderItem={({ item }) => (
          <Card mode="contained" style={styles.codeCard}>
            <Card.Title
              title="Received RF code"
              subtitle={item.Freq + " MHz · protocol " + item.Protocol}
            />
            <Card.Content style={styles.codeContent}>
              <Text selectable style={styles.codeValue} variant="titleLarge">
                {item.raw}
              </Text>
              <Text style={styles.muted} variant="bodySmall">
                Send now uses your default repeat setting ({defaultRepeat}).
              </Text>
            </Card.Content>
            <Card.Actions>
              <Button disabled={!device} icon="send" mode="contained-tonal" onPress={() => void sendCapturedCode(item)}>
                Send now
              </Button>
              <Button icon="content-save-outline" mode="contained" onPress={() => openSaveDialog(item)}>
                Save code
              </Button>
            </Card.Actions>
          </Card>
        )}
      />

      <Portal>
        <Dialog visible={selectedCode !== null} onDismiss={() => setSelectedCode(null)}>
          <Dialog.Title>Save captured code</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            {selectedCode ? (
              <Text variant="bodyMedium">
                {selectedCode.raw} · {selectedCode.Freq} MHz · protocol {selectedCode.Protocol}
              </Text>
            ) : null}
            <TextInput
              autoFocus
              label="Name"
              mode="outlined"
              onChangeText={setAlias}
              value={alias}
            />
            <TextInput
              keyboardType="number-pad"
              label="Repeat count"
              mode="outlined"
              onChangeText={setRepeat}
              value={repeat}
            />
            <View style={styles.switchRow}>
              <View>
                <Text variant="labelLarge">Quick Access</Text>
                <Text style={styles.muted} variant="bodySmall">
                  Show this code in Favorites for one-tap sending.
                </Text>
              </View>
              <Switch onValueChange={setFavorite} value={favorite} />
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSelectedCode(null)}>Cancel</Button>
            <Button mode="contained" onPress={() => void saveCapturedCode()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar duration={3_500} onDismiss={() => setNotice("")} visible={Boolean(notice)}>
        {notice}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    marginTop: 8,
  },
  codeContent: {
    gap: 6,
  },
  codeValue: {
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  container: {
    flex: 1,
  },
  dialogContent: {
    gap: 12,
  },
  emptyState: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingTop: 72,
  },
  headerCard: {
    marginBottom: 4,
  },
  headerContent: {
    gap: 12,
  },
  listContent: {
    padding: 12,
    paddingBottom: 104,
  },
  muted: {
    opacity: 0.72,
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
});
