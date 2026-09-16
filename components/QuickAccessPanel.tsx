import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Image, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  Button,
  Card,
  Dialog,
  IconButton,
  Portal,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import {
  buildQuickAccessCommand,
  createCodeId,
  loadRfCodes,
  saveRfCodes,
  sortCodesByCustomOrder,
} from "./RfPanel/codeLibrary";
import { RfCode } from "./RfPanel/types";
import {
  deleteDoorWidgetPreset,
  DoorWidgetPreset,
  getDoorWidgetPresets,
  isDoorWidgetAvailable,
  requestDoorWidgetPin,
  saveDoorWidgetPreset,
} from "@/modules/doorWidget";

type QuickAccessPanelProps = {
  deviceId?: string | null;
  deviceName?: string | null;
  onSendCode: (code: string) => Promise<void>;
  open: boolean;
};

function burstSummary(code: RfCode) {
  if (!code.Burst) return "Standard send";
  return code.Burst.iterations + " plays · " + code.Burst.gapMs + " ms after each";
}

function playDurationSummary(code: RfCode) {
  return code.Repeat > 1 ? "Hold about " + code.Repeat + " s per play" : "One RF frame per play";
}

export default function QuickAccessPanel({ deviceId, deviceName, onSendCode, open }: QuickAccessPanelProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [codes, setCodes] = useState<RfCode[]>([]);
  const [notice, setNotice] = useState("");
  const [editingCode, setEditingCode] = useState<RfCode | null>(null);
  const [burstEnabled, setBurstEnabled] = useState(false);
  const [iterationsInput, setIterationsInput] = useState("3");
  const [gapInput, setGapInput] = useState("250");
  const [widgetDialogVisible, setWidgetDialogVisible] = useState(false);
  const [widgetActionId, setWidgetActionId] = useState<string | null>(null);
  const [widgetPhotoUri, setWidgetPhotoUri] = useState<string | null>(null);
  const [widgetPhotoChanged, setWidgetPhotoChanged] = useState(false);
  const [widgetPresetId, setWidgetPresetId] = useState<string | null>(null);
  const [widgetPresets, setWidgetPresets] = useState<DoorWidgetPreset[]>([]);
  const [widgetPickerVisible, setWidgetPickerVisible] = useState(false);
  const [widgetSaving, setWidgetSaving] = useState(false);
  const cardWidth = (width - 36) / 2;

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    void loadRfCodes().then((loadedCodes) => {
      if (mounted) setCodes(loadedCodes);
    });
    return () => {
      mounted = false;
    };
  }, [open]);

  const favorites = useMemo(() => sortCodesByCustomOrder(codes.filter((code) => code.Favorite)), [codes]);
  const widgetActionCode = favorites.find((code) => code.id === widgetActionId) ?? null;

  useEffect(() => {
    if (!open || !isDoorWidgetAvailable()) return;
    let mounted = true;
    void getDoorWidgetPresets().then((presets) => {
      if (!mounted) return;
      setWidgetPresets(presets);
    });
    return () => {
      mounted = false;
    };
  }, [open]);

  const synchronizeWidget = useCallback(async (nextCodes: RfCode[]) => {
    if (!isDoorWidgetAvailable()) return;
    const presets = await getDoorWidgetPresets();
    await Promise.all(
      presets.map(async (preset) => {
        const actionCode = nextCodes.find((code) => code.id === preset.codeId && code.Favorite);
        if (!actionCode) return;
        await saveDoorWidgetPreset({
          id: preset.id,
          bridgeDeviceId: preset.bridgeId,
          action: {
            id: actionCode.id,
            label: actionCode.Alias,
            command: buildQuickAccessCommand(actionCode),
            frequency: actionCode.Freq + " MHz",
            mode: actionCode.Burst ? "burst" : "single",
          },
          backgroundUri: null,
          cornerRadius: 28,
        });
      })
    );
    setWidgetPresets(await getDoorWidgetPresets());
  }, []);

  const sendFavorite = useCallback(
    async (code: RfCode) => {
      await onSendCode(buildQuickAccessCommand(code));
      const usedAt = new Date().toISOString();
      const nextCodes = codes.map((item) => (item.id === code.id ? { ...item, lastUsedAt: usedAt } : item));
      try {
        const savedCodes = await saveRfCodes(nextCodes);
        setCodes(savedCodes);
      } catch {
        // The transmission may still succeed when local history persistence fails.
      }
    },
    [codes, onSendCode]
  );

  const removeFromQuickAccess = useCallback(
    (code: RfCode, confirm = true) => {
      const remove = () => {
        void saveRfCodes(
          codes.map((item) => (item.id === code.id ? { ...item, Favorite: false, Burst: undefined } : item))
        )
          .then(async (savedCodes) => {
            setCodes(savedCodes);
          })
          .catch(() => setNotice("Could not update Quick Access."));
      };

      if (!confirm) {
        remove();
        return;
      }

      Alert.alert("Remove from Quick Access?", code.Alias + " will remain in Saved RF codes.", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: remove },
      ]);
    },
    [codes]
  );

  const deleteSavedCode = useCallback(
    (code: RfCode) => {
      Alert.alert("Delete saved code?", "Delete " + code.Alias + " from this phone and Quick Access?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void saveRfCodes(codes.filter((item) => item.id !== code.id))
              .then(async (savedCodes) => {
                setCodes(savedCodes);
              })
              .catch(() => setNotice("Could not delete the saved code."));
          },
        },
      ]);
    },
    [codes]
  );

  const openBurstEditor = useCallback((code: RfCode) => {
    setEditingCode(code);
    setBurstEnabled(Boolean(code.Burst));
    setIterationsInput(String(code.Burst?.iterations ?? 3));
    setGapInput(String(code.Burst?.gapMs ?? 250));
  }, []);

  const saveQuickAccessBehavior = useCallback(async () => {
    if (!editingCode) return;

    const iterations = Number(iterationsInput);
    const gapMs = Number(gapInput);
    if (
      burstEnabled &&
      (!Number.isInteger(iterations) || iterations < 1 || iterations > 99 || !Number.isInteger(gapMs) || gapMs < 0 || gapMs > 60_000)
    ) {
      setNotice("Burst iterations must be 1–99 and the gap must be 0–60000 ms.");
      return;
    }

    try {
      const savedCodes = await saveRfCodes(
        codes.map((code) =>
          code.id === editingCode.id
            ? {
                ...code,
                Favorite: true,
                Burst: burstEnabled ? { iterations, gapMs } : undefined,
                updatedAt: new Date().toISOString(),
              }
            : code
        )
      );
      setCodes(savedCodes);
      await synchronizeWidget(savedCodes);
      setEditingCode(null);
      setNotice(burstEnabled ? "Burst behavior saved." : "Standard Quick Access behavior saved.");
    } catch {
      setNotice("Could not save the Quick Access behavior.");
    }
  }, [burstEnabled, codes, editingCode, gapInput, iterationsInput, synchronizeWidget]);

  const openWidgetSetup = useCallback(() => {
    if (!isDoorWidgetAvailable()) {
      setNotice("Install the Android development build to use the home-screen widget.");
      return;
    }
    if (!deviceId) {
      setNotice("Connect your BluePulse bridge before configuring the widget.");
      return;
    }
    if (favorites.length === 0) {
      setNotice("Add saved codes to Quick Access before configuring the widget.");
      return;
    }
    setWidgetPresetId(null);
    setWidgetActionId(null);
    setWidgetPhotoUri(null);
    setWidgetPhotoChanged(false);
    setWidgetPickerVisible(false);
    setWidgetDialogVisible(true);
  }, [deviceId, favorites.length]);

  const saveWidget = useCallback(async () => {
    if (!deviceId || !widgetActionCode) {
      setNotice("Choose an action while the bridge is connected.");
      return;
    }

    setWidgetSaving(true);
    try {
      await saveDoorWidgetPreset({
        id: widgetPresetId ?? createCodeId(),
        bridgeDeviceId: deviceId,
        action: {
          id: widgetActionCode.id,
          label: widgetActionCode.Alias,
          command: buildQuickAccessCommand(widgetActionCode),
          frequency: widgetActionCode.Freq + " MHz",
          mode: widgetActionCode.Burst ? "burst" : "single",
        },
        backgroundUri: widgetPhotoChanged ? widgetPhotoUri : null,
        cornerRadius: 28,
      });
      setWidgetPresets(await getDoorWidgetPresets());
      setWidgetDialogVisible(false);
      setNotice("Home-screen widget updated. Add BluePulse from Android's widget picker.");
    } catch {
      setNotice("Could not save the widget configuration.");
    } finally {
      setWidgetSaving(false);
    }
  }, [deviceId, widgetActionCode, widgetPhotoChanged, widgetPhotoUri, widgetPresetId]);

  const chooseWidgetPhoto = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.88,
    });
    if (!result.canceled) {
      setWidgetPhotoUri(result.assets[0]?.uri ?? null);
      setWidgetPhotoChanged(true);
    }
  }, []);

  const editWidgetPreset = useCallback((preset: DoorWidgetPreset) => {
    setWidgetPresetId(preset.id);
    setWidgetActionId(preset.codeId);
    setWidgetPhotoUri(preset.backgroundPath ? "file://" + preset.backgroundPath : null);
    setWidgetPhotoChanged(false);
    setWidgetPickerVisible(false);
  }, []);

  const deleteWidgetPreset = useCallback(() => {
    if (!widgetPresetId) return;
    Alert.alert("Delete widget tile?", "Any home-screen widget using this tile will need to be configured again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteDoorWidgetPreset(widgetPresetId)
            .then(async () => {
              setWidgetPresets(await getDoorWidgetPresets());
              setWidgetPresetId(null);
              setWidgetActionId(null);
              setWidgetPhotoUri(null);
              setWidgetPhotoChanged(false);
            })
            .catch(() => setNotice("Could not delete the widget tile."));
        },
      },
    ]);
  }, [widgetPresetId]);

  const addWidgetToHomeScreen = useCallback(async () => {
    if (!widgetPresetId) {
      setNotice("Save this tile first, then add it to your home screen.");
      return;
    }
    try {
      const requested = await requestDoorWidgetPin(widgetPresetId);
      setNotice(
        requested
          ? "Confirm Android's Add to Home screen prompt. This tile will be added as its own widget."
          : "Your launcher does not support direct adding. Drag BluePulse from the widget picker, then tap it to choose this tile."
      );
    } catch {
      setNotice("Could not ask Android to add this widget.");
    }
  }, [widgetPresetId]);

  const showQuickAccessOptions = useCallback(
    (code: RfCode) => {
      Alert.alert(code.Alias, "Quick Access action", [
        { text: "Edit burst settings", onPress: () => openBurstEditor(code) },
        {
          text: "Remove from Quick Access",
          style: "destructive",
          onPress: () => removeFromQuickAccess(code, false),
        },
        { text: "Delete saved code", style: "destructive", onPress: () => deleteSavedCode(code) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [deleteSavedCode, openBurstEditor, removeFromQuickAccess]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        columnWrapperStyle={favorites.length > 1 ? styles.row : undefined}
        contentContainerStyle={styles.listContent}
        data={favorites}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text variant="titleMedium">Quick Access is empty</Text>
            <Text style={styles.muted} variant="bodyMedium">
              Open Saved RF codes and enable Quick Access for a remote.
            </Text>
          </View>
        }
        ListHeaderComponent={
          <Card mode="contained" style={styles.headerCard}>
            <Card.Title
              left={(props) => (
                <IconButton
                  {...props}
                  icon={deviceName ? "bluetooth-connect" : "bluetooth-off"}
                  iconColor={deviceName ? theme.colors.primary : theme.colors.error}
                />
              )}
              title="Quick Access"
              subtitle={deviceName ? "Connected to " + deviceName : "Connect a bridge to transmit"}
            />
            <Card.Content>
              <Text variant="bodySmall">
                {favorites.length === 0
                  ? "Favorite saved codes appear here for one-tap sending."
                  : favorites.length + " quick action" + (favorites.length === 1 ? "" : "s") + " ready to send."}
              </Text>
              <Text style={styles.muted} variant="bodySmall">
                Long press an action to edit its burst, remove it, or delete the saved code.
              </Text>
            </Card.Content>
            <Card.Actions>
              <Button icon="view-dashboard-outline" onPress={openWidgetSetup}>
                Home widget
              </Button>
            </Card.Actions>
          </Card>
        }
        numColumns={2}
        renderItem={({ item }) => (
          <Card
            accessibilityHint="Tap to send. Long press to edit this Quick Access action."
            mode="contained"
            onLongPress={() => showQuickAccessOptions(item)}
            onPress={() => void sendFavorite(item)}
            style={[styles.favoriteCard, { width: cardWidth }]}
          >
            <Card.Title title={item.Alias} titleNumberOfLines={1} />
            <Card.Content style={styles.favoriteContent}>
              <Text selectable variant="titleSmall">
                {item.Code}
              </Text>
              <Text style={styles.muted} variant="bodySmall">
                {item.Freq} MHz · protocol {item.Protocol}
              </Text>
              <Text style={styles.burstLabel} variant="bodySmall">
                {burstSummary(item)}
              </Text>
              <Text style={styles.muted} variant="bodySmall">
                {playDurationSummary(item)}
              </Text>
            </Card.Content>
            <Card.Actions>
              <Button compact icon={item.Burst ? "play-speed" : "send"} onPress={() => void sendFavorite(item)}>
                {item.Burst ? "Burst" : "Send"}
              </Button>
            </Card.Actions>
          </Card>
        )}
      />

      <Portal>
        <Dialog visible={editingCode !== null} onDismiss={() => setEditingCode(null)}>
          <Dialog.Title>Quick Access behavior</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            {editingCode ? (
              <Text variant="bodyMedium">
                {editingCode.Alias} · {editingCode.Freq} MHz
              </Text>
            ) : null}
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text variant="labelLarge">Burst mode</Text>
                <Text style={styles.muted} variant="bodySmall">
                  Play this saved code several times with a fixed gap.
                </Text>
              </View>
              <Switch onValueChange={setBurstEnabled} value={burstEnabled} />
            </View>
            {burstEnabled ? (
              <>
                <TextInput
                  keyboardType="number-pad"
                  label="Times to play"
                  mode="outlined"
                  onChangeText={setIterationsInput}
                  value={iterationsInput}
                />
                <TextInput
                  keyboardType="number-pad"
                  label="Gap after each play (ms)"
                  mode="outlined"
                  onChangeText={setGapInput}
                  value={gapInput}
                />
                <Text style={styles.muted} variant="bodySmall">
                  The ESP32 controls the gap. Each play uses the saved code{"'"}s transmit window: 1 sends one RF frame;
                  2 or more repeats it for about that many seconds.
                </Text>
              </>
            ) : (
              <Text style={styles.muted} variant="bodySmall">
                Standard mode transmits this saved code once when tapped.
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditingCode(null)}>Cancel</Button>
            <Button mode="contained" onPress={() => void saveQuickAccessBehavior()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={widgetDialogVisible} onDismiss={() => setWidgetDialogVisible(false)}>
          <Dialog.Title>Widget tiles</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodyMedium">
              Build reusable tiles, then choose a tile whenever Android adds a BluePulse widget to your home screen.
            </Text>
            {widgetPresets.length > 0 ? (
              <View style={styles.presetRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetStrip}>
                  {widgetPresets.map((preset) => (
                    <Button key={preset.id} mode={widgetPresetId === preset.id ? "contained" : "outlined"} onPress={() => editWidgetPreset(preset)}>
                      {preset.label}
                    </Button>
                  ))}
                </ScrollView>
                <IconButton
                  accessibilityLabel="Create a new widget tile"
                  icon="plus"
                  onPress={() => {
                    setWidgetPresetId(null);
                    setWidgetActionId(null);
                    setWidgetPhotoUri(null);
                    setWidgetPhotoChanged(false);
                  }}
                />
                {widgetPresetId ? <IconButton accessibilityLabel="Delete this widget tile" icon="delete-outline" onPress={deleteWidgetPreset} /> : null}
              </View>
            ) : null}
            <Text variant="labelLarge">Action</Text>
            <Button icon="radio-tower" mode="outlined" onPress={() => setWidgetPickerVisible(true)}>
              {widgetActionCode?.Alias ?? "Choose an action"}
            </Button>
            <Button icon="image-outline" mode="outlined" onPress={() => void chooseWidgetPhoto()}>
              {widgetPhotoUri ? "Change widget photo" : "Choose widget photo"}
            </Button>
            {widgetPhotoUri ? <Image source={{ uri: widgetPhotoUri }} style={styles.widgetPhotoPreview} /> : null}
            {widgetPickerVisible ? (
              <View style={styles.widgetPicker}>
                <Text variant="labelMedium">Select the action to send</Text>
                <ScrollView style={styles.widgetChoices}>
                  {favorites.map((code) => {
                    const selected = widgetActionId === code.id;
                    return (
                      <Button
                        compact
                        icon={selected ? "check" : "radio-tower"}
                        key={code.id}
                        mode={selected ? "contained" : "text"}
                        onPress={() => {
                          setWidgetActionId(code.id);
                          setWidgetPickerVisible(false);
                        }}
                      >
                        {code.Alias}
                      </Button>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
            <Text style={styles.muted} variant="bodySmall">
              Your photo appears as the card&apos;s media panel. The information area below follows your phone&apos;s light or dark appearance.
            </Text>
            {widgetPresetId ? (
              <Button icon="plus-box-outline" mode="contained-tonal" onPress={() => void addWidgetToHomeScreen()}>
                Add this tile to home screen
              </Button>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWidgetDialogVisible(false)}>Cancel</Button>
            <Button disabled={!widgetActionCode || widgetSaving} mode="contained" onPress={() => void saveWidget()}>
              {widgetPresetId ? "Save changes" : "Save tile"}
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
  burstLabel: {
    fontWeight: "600",
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
    paddingTop: 64,
  },
  favoriteCard: {
    marginBottom: 8,
  },
  favoriteContent: {
    gap: 4,
  },
  headerCard: {
    marginBottom: 12,
  },
  listContent: {
    padding: 12,
    paddingBottom: 104,
  },
  muted: {
    opacity: 0.72,
  },
  row: {
    gap: 8,
    justifyContent: "space-between",
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  switchText: {
    flex: 1,
  },
  widgetChoices: {
    maxHeight: 180,
  },
  widgetPicker: {
    gap: 4,
  },
  widgetPhotoPreview: {
    borderRadius: 16,
    height: 132,
    width: "100%",
  },
  presetStrip: {
    flex: 1,
    maxHeight: 44,
  },
  presetRow: {
    alignItems: "center",
    flexDirection: "row",
  },
});
