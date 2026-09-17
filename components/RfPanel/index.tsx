import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, ScrollView, Share, StyleSheet, View } from "react-native";
import {
  Button,
  Card,
  Chip,
  Dialog,
  IconButton,
  Menu,
  Portal,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import {
  buildTransmitCommand,
  createCodeBackup,
  createCodeId,
  DEFAULT_RF_LIBRARY_SETTINGS,
  loadRfCodes,
  loadRfLibrarySettings,
  mergeImportedCodes,
  parseImportedCodes,
  reindexCodes,
  saveRfCodes,
  saveRfLibrarySettings,
  sortCodesByCustomOrder,
  type RfLibrarySettings,
} from "./codeLibrary";
import { RfCode } from "./types";

type FilterValue = "all" | "favorites" | "315" | "433";
type SortValue = "custom" | "name" | "recent";

function emptyCode(defaultRepeat: number, sortId: number): RfCode {
  const now = new Date().toISOString();
  return {
    id: createCodeId(),
    Alias: "",
    Code: "",
    Freq: 433,
    Protocol: 1,
    Repeat: defaultRepeat,
    Favorite: false,
    SortId: sortId,
    createdAt: now,
    updatedAt: now,
  };
}

function formatLastUsed(value?: string) {
  if (!value) return "Never sent";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never sent" : "Last sent " + date.toLocaleDateString();
}

export default function RfPanel({
  isOpen,
  sendDataToDevice,
}: {
  isOpen: boolean;
  sendDataToDevice: (data: string) => Promise<void>;
}) {
  const theme = useTheme();
  const [codes, setCodes] = useState<RfCode[]>([]);
  const [settings, setSettings] = useState<RfLibrarySettings>(DEFAULT_RF_LIBRARY_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [sort, setSort] = useState<SortValue>("custom");
  const [editorVisible, setEditorVisible] = useState(false);
  const [form, setForm] = useState<RfCode>(() => emptyCode(1, 0));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [defaultRepeatInput, setDefaultRepeatInput] = useState("1");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setIsLoading(true);

    void Promise.all([loadRfCodes(), loadRfLibrarySettings()]).then(([loadedCodes, loadedSettings]) => {
      if (!mounted) return;
      setCodes(loadedCodes);
      setSettings(loadedSettings);
      setDefaultRepeatInput(String(loadedSettings.defaultRepeat));
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  const persistCodes = useCallback(async (nextCodes: RfCode[]) => {
    const saved = await saveRfCodes(nextCodes);
    setCodes(saved);
    return saved;
  }, []);

  const visibleCodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = codes.filter((code) => {
      const matchesQuery =
        !normalizedQuery ||
        [code.Alias, code.Code, code.Notes ?? ""].some((value) =>
          value.toLowerCase().includes(normalizedQuery)
        );
      const matchesFilter =
        filter === "all" ||
        (filter === "favorites" && code.Favorite) ||
        (filter === "315" && code.Freq === 315) ||
        (filter === "433" && code.Freq === 433);
      return matchesQuery && matchesFilter;
    });

    if (sort === "name") {
      return [...filtered].sort((first, second) => first.Alias.localeCompare(second.Alias));
    }
    if (sort === "recent") {
      return [...filtered].sort((first, second) =>
        (second.lastUsedAt ?? second.updatedAt ?? "").localeCompare(first.lastUsedAt ?? first.updatedAt ?? "")
      );
    }
    return sortCodesByCustomOrder(filtered);
  }, [codes, filter, query, sort]);

  const openEditor = useCallback(
    (code?: RfCode) => {
      if (code) {
        setForm({ ...code });
        setEditingId(code.id);
      } else {
        setForm(emptyCode(settings.defaultRepeat, codes.length));
        setEditingId(null);
      }
      setEditorVisible(true);
    },
    [codes.length, settings.defaultRepeat]
  );

  const saveCode = useCallback(async () => {
    const alias = form.Alias.trim();
    const codeValue = form.Code.trim();
    const repeat = Number(form.Repeat);
    const protocol = Number(form.Protocol);
    const burst = form.Burst;

    if (!alias || !codeValue || !/^[0-9]+$/.test(codeValue)) {
      setNotice("Add a name and a numeric RF code before saving.");
      return;
    }
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 99) {
      setNotice("Repeat must be a whole number from 1 to 99.");
      return;
    }
    if (!Number.isInteger(protocol) || protocol < 1 || protocol > 255) {
      setNotice("Protocol must be a whole number from 1 to 255.");
      return;
    }
    if (
      burst &&
      (!Number.isInteger(burst.iterations) ||
        burst.iterations < 1 ||
        burst.iterations > 99 ||
        !Number.isInteger(burst.gapMs) ||
        burst.gapMs < 0 ||
        burst.gapMs > 60_000)
    ) {
      setNotice("Burst iterations must be 1–99 and the gap must be 0–60000 ms.");
      return;
    }

    const now = new Date().toISOString();
    const nextCode: RfCode = {
      ...form,
      Alias: alias,
      Code: codeValue,
      Notes: form.Notes?.trim() || undefined,
      Protocol: protocol,
      Repeat: repeat,
      Burst: form.Favorite ? burst : undefined,
      updatedAt: now,
      createdAt: form.createdAt ?? now,
    };
    const nextCodes =
      editingId === null
        ? [...codes, nextCode]
        : codes.map((code) => (code.id === editingId ? nextCode : code));

    try {
      await persistCodes(nextCodes);
      setEditorVisible(false);
      setNotice(editingId === null ? "Code saved." : "Code updated.");
    } catch {
      setNotice("The code could not be saved on this device.");
    }
  }, [codes, editingId, form, persistCodes]);

  const sendCode = useCallback(
    async (code: RfCode) => {
      await sendDataToDevice(buildTransmitCommand(code));
      const usedAt = new Date().toISOString();
      try {
        await persistCodes(codes.map((item) => (item.id === code.id ? { ...item, lastUsedAt: usedAt } : item)));
      } catch {
        // Sending still happened; only the local "last sent" indicator could not update.
      }
    },
    [codes, persistCodes, sendDataToDevice]
  );

  const toggleFavorite = useCallback(
    async (code: RfCode) => {
      try {
        await persistCodes(
          codes.map((item) =>
            item.id === code.id ? { ...item, Favorite: !item.Favorite, updatedAt: new Date().toISOString() } : item
          )
        );
      } catch {
        setNotice("Could not update the favorite.");
      }
    },
    [codes, persistCodes]
  );

  const deleteCode = useCallback(
    (code: RfCode) => {
      Alert.alert("Delete saved code?", "Delete " + code.Alias + " from this phone?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void persistCodes(codes.filter((item) => item.id !== code.id)).catch(() => {
              setNotice("Could not delete the saved code.");
            });
          },
        },
      ]);
    },
    [codes, persistCodes]
  );

  const shareLibrary = useCallback(async () => {
    if (codes.length === 0) {
      setNotice("Add a code before sharing the library.");
      return;
    }

    try {
      await Share.share({
        title: "BluePulse saved RF codes",
        message: JSON.stringify(createCodeBackup(codes), null, 2),
      });
    } catch {
      setNotice("The share sheet could not be opened.");
    }
  }, [codes]);

  const shareCode = useCallback(async (code: RfCode) => {
    try {
      await Share.share({
        title: "BluePulse RF code: " + code.Alias,
        message: JSON.stringify(createCodeBackup([code]), null, 2),
      });
    } catch {
      setNotice("The share sheet could not be opened.");
    }
  }, []);

  const applyImportedCodes = useCallback(
    async (imported: RfCode[]) => {
      try {
        const nextCodes = importMode === "replace" ? reindexCodes(imported) : mergeImportedCodes(codes, imported);
        await persistCodes(nextCodes);
        setImportVisible(false);
        setImportText("");
        setNotice(
          importMode === "replace"
            ? imported.length + " codes imported."
            : Math.max(0, nextCodes.length - codes.length) + " new codes imported."
        );
      } catch {
        setNotice("The imported codes could not be saved.");
      }
    },
    [codes, importMode, persistCodes]
  );

  const importLibrary = useCallback(async () => {
    try {
      const imported = parseImportedCodes(importText);
      if (importMode === "replace" && codes.length > 0) {
        Alert.alert(
          "Replace saved code library?",
          "This removes your " + codes.length + " current saved codes and replaces them with the import.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Replace", style: "destructive", onPress: () => void applyImportedCodes(imported) },
          ]
        );
        return;
      }
      await applyImportedCodes(imported);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The import could not be read.");
    }
  }, [applyImportedCodes, codes.length, importMode, importText]);

  const saveSettings = useCallback(async () => {
    const nextRepeat = Number(defaultRepeatInput);
    if (!Number.isInteger(nextRepeat) || nextRepeat < 1 || nextRepeat > 99) {
      setNotice("Default repeat must be a whole number from 1 to 99.");
      return;
    }
    try {
      const saved = await saveRfLibrarySettings({ defaultRepeat: nextRepeat });
      setSettings(saved);
      setSettingsVisible(false);
      setNotice("Transmit defaults saved.");
    } catch {
      setNotice("Could not save transmit defaults.");
    }
  }, [defaultRepeatInput]);

  const favoriteCount = codes.filter((code) => code.Favorite).length;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={visibleCodes}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <Text variant="titleMedium">No saved codes here yet</Text>
              <Text style={styles.muted} variant="bodyMedium">
                Add a code manually, or save one from the RF capture tab.
              </Text>
              <Button icon="plus" mode="contained" onPress={() => openEditor()}>
                Add your first code
              </Button>
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <Card mode="contained">
              <Card.Title title="Saved RF codes" subtitle="Search, send, share, and reuse your remotes" />
              <Card.Content style={styles.cardContent}>
                <View style={styles.statsRow}>
                  <Chip icon="format-list-numbered">{codes.length} total</Chip>
                  <Chip icon="star">{favoriteCount} favorites</Chip>
                </View>
                <View style={styles.toolbar}>
                  <Button icon="plus" mode="contained" onPress={() => openEditor()} style={styles.primaryToolbarButton}>
                    Add code
                  </Button>
                  <Button icon="import" mode="outlined" onPress={() => setImportVisible(true)}>
                    Import
                  </Button>
                  <Button icon="share-variant-outline" mode="outlined" onPress={() => void shareLibrary()}>
                    Share
                  </Button>
                  <IconButton
                    accessibilityLabel="Code library settings"
                    icon="cog-outline"
                    onPress={() => setSettingsVisible(true)}
                  />
                </View>
              </Card.Content>
            </Card>

            <TextInput
              clearButtonMode="while-editing"
              left={<TextInput.Icon icon="magnify" />}
              mode="outlined"
              onChangeText={setQuery}
              placeholder="Search name, code, or note"
              value={query}
            />

            <SegmentedButtons
              value={filter}
              onValueChange={(value) => setFilter(value as FilterValue)}
              buttons={[
                { value: "all", label: "All" },
                { value: "favorites", label: "Favorites" },
                { value: "315", label: "315" },
                { value: "433", label: "433" },
              ]}
            />
            <SegmentedButtons
              value={sort}
              onValueChange={(value) => setSort(value as SortValue)}
              buttons={[
                { value: "custom", label: "Saved order" },
                { value: "name", label: "Name" },
                { value: "recent", label: "Recent" },
              ]}
            />
          </View>
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        renderItem={({ item }) => (
          <Card mode="contained">
            <Card.Title
              title={item.Alias}
              subtitle={item.Freq + " MHz · protocol " + item.Protocol + " · repeats " + item.Repeat}
              right={() => (
                <View style={styles.titleActions}>
                  <IconButton
                    accessibilityLabel={item.Favorite ? "Remove from favorites" : "Add to favorites"}
                    icon={item.Favorite ? "star" : "star-outline"}
                    iconColor={item.Favorite ? theme.colors.primary : theme.colors.onSurfaceVariant}
                    onPress={() => void toggleFavorite(item)}
                  />
                  <Menu
                    anchor={
                      <IconButton
                        accessibilityLabel={"Options for " + item.Alias}
                        icon="dots-vertical"
                        onPress={() => setActiveMenuId(item.id)}
                      />
                    }
                    onDismiss={() => setActiveMenuId(null)}
                    visible={activeMenuId === item.id}
                  >
                    <Menu.Item
                      leadingIcon="pencil-outline"
                      onPress={() => {
                        setActiveMenuId(null);
                        openEditor(item);
                      }}
                      title="Edit code"
                    />
                    <Menu.Item
                      leadingIcon="share-variant-outline"
                      onPress={() => {
                        setActiveMenuId(null);
                        void shareCode(item);
                      }}
                      title="Share code"
                    />
                    <Menu.Item
                      leadingIcon="delete-outline"
                      onPress={() => {
                        setActiveMenuId(null);
                        deleteCode(item);
                      }}
                      title="Delete"
                    />
                  </Menu>
                </View>
              )}
            />
            <Card.Content style={styles.cardContent}>
              <Text selectable style={styles.codeValue} variant="titleMedium">
                {item.Code}
              </Text>
              {item.Notes ? (
                <Text style={styles.muted} variant="bodySmall">
                  {item.Notes}
                </Text>
              ) : null}
              <Text style={styles.muted} variant="bodySmall">
                {formatLastUsed(item.lastUsedAt)}
              </Text>
            </Card.Content>
            <Card.Actions>
              <Button icon="send" mode="contained-tonal" onPress={() => void sendCode(item)}>
                Send
              </Button>
              <Button icon="pencil-outline" onPress={() => openEditor(item)}>
                Edit
              </Button>
            </Card.Actions>
          </Card>
        )}
      />

      <Portal>
        <Dialog visible={editorVisible} onDismiss={() => setEditorVisible(false)}>
          <Dialog.Title>{editingId === null ? "Add saved code" : "Edit saved code"}</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScrollArea}>
            <ScrollView contentContainerStyle={styles.dialogScrollContent}>
              <TextInput
                autoFocus
                label="Name"
                mode="outlined"
                onChangeText={(Alias) => setForm((current) => ({ ...current, Alias }))}
                value={form.Alias}
              />
              <TextInput
                keyboardType="number-pad"
                label="RF code"
                mode="outlined"
                onChangeText={(Code) => setForm((current) => ({ ...current, Code }))}
                value={form.Code}
              />
              <TextInput
                keyboardType="number-pad"
                label="Transmit window (1 = one frame)"
                mode="outlined"
                onChangeText={(value) => setForm((current) => ({ ...current, Repeat: Number(value) || 0 }))}
                value={form.Repeat === 0 ? "" : String(form.Repeat)}
              />
              <Text style={styles.muted} variant="bodySmall">
                Values above 1 repeatedly transmit for approximately that many seconds.
              </Text>
              <TextInput
                keyboardType="number-pad"
                label="Protocol"
                mode="outlined"
                onChangeText={(value) => setForm((current) => ({ ...current, Protocol: Number(value) || 0 }))}
                value={form.Protocol === 0 ? "" : String(form.Protocol)}
              />
              <TextInput
                label="Notes (optional)"
                mode="outlined"
                multiline
                numberOfLines={2}
                onChangeText={(Notes) => setForm((current) => ({ ...current, Notes }))}
                value={form.Notes ?? ""}
              />
              <Text variant="labelLarge">Carrier frequency</Text>
              <SegmentedButtons
                value={String(form.Freq)}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, Freq: Number(value) === 315 ? 315 : 433 }))
                }
                buttons={[
                  { value: "315", label: "315 MHz" },
                  { value: "433", label: "433 MHz" },
                ]}
              />
              <View style={styles.switchRow}>
                <View>
                  <Text variant="labelLarge">Quick Access</Text>
                  <Text style={styles.muted} variant="bodySmall">
                    Show this code on the Favorites tab.
                  </Text>
                </View>
                <Switch
                  onValueChange={(Favorite) => setForm((current) => ({ ...current, Favorite }))}
                  value={form.Favorite}
                />
              </View>
              {form.Favorite ? (
                <>
                  <View style={styles.switchRow}>
                    <View>
                      <Text variant="labelLarge">Burst mode</Text>
                      <Text style={styles.muted} variant="bodySmall">
                        Repeat this Quick Access action with a fixed gap.
                      </Text>
                    </View>
                    <Switch
                      onValueChange={(enabled) =>
                        setForm((current) => ({
                          ...current,
                          Burst: enabled ? current.Burst ?? { iterations: 3, gapMs: 250 } : undefined,
                        }))
                      }
                      value={Boolean(form.Burst)}
                    />
                  </View>
                  {form.Burst ? (
                    <>
                      <TextInput
                        keyboardType="number-pad"
                        label="Times to play"
                        mode="outlined"
                        onChangeText={(value) =>
                          setForm((current) => ({
                            ...current,
                            Burst: { iterations: Number(value) || 0, gapMs: current.Burst?.gapMs ?? 250 },
                          }))
                        }
                        value={form.Burst.iterations === 0 ? "" : String(form.Burst.iterations)}
                      />
                      <TextInput
                        keyboardType="number-pad"
                        label="Gap after each play (ms)"
                        mode="outlined"
                        onChangeText={(value) =>
                          setForm((current) => ({
                            ...current,
                            Burst: { iterations: current.Burst?.iterations ?? 3, gapMs: Number(value) || 0 },
                          }))
                        }
                        value={form.Burst.gapMs === 0 ? "0" : String(form.Burst.gapMs)}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={styles.muted} variant="bodySmall">
                  Enable Quick Access to configure a burst action.
                </Text>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditorVisible(false)}>Cancel</Button>
            <Button mode="contained" onPress={() => void saveCode()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={importVisible} onDismiss={() => setImportVisible(false)}>
          <Dialog.Title>Import saved codes</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodyMedium">
              Paste a shared BluePulse backup. Importing keeps your current library unless you choose Replace.
            </Text>
            <SegmentedButtons
              value={importMode}
              onValueChange={(value) => setImportMode(value as "merge" | "replace")}
              buttons={[
                { value: "merge", label: "Merge" },
                { value: "replace", label: "Replace" },
              ]}
            />
            <TextInput
              label="Backup JSON"
              mode="outlined"
              multiline
              numberOfLines={8}
              onChangeText={setImportText}
              placeholder='{"schema":"bluepulse-rf-codes", ...}'
              value={importText}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setImportVisible(false)}>Cancel</Button>
            <Button disabled={!importText.trim()} mode="contained" onPress={() => void importLibrary()}>
              Import
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={settingsVisible} onDismiss={() => setSettingsVisible(false)}>
          <Dialog.Title>Library & transmit defaults</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <Text variant="bodyMedium">
              New manually added or captured codes start with this repeat count. Saved codes keep their own values.
            </Text>
            <TextInput
              keyboardType="number-pad"
              label="Default repeat count"
              mode="outlined"
              onChangeText={setDefaultRepeatInput}
              value={defaultRepeatInput}
            />
            <Text style={styles.muted} variant="bodySmall">
              The CC1101 output level is already at the module default maximum; this setting changes repeat count,
              not transmit power.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSettingsVisible(false)}>Cancel</Button>
            <Button mode="contained" onPress={() => void saveSettings()}>
              Save defaults
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
  cardContent: {
    gap: 6,
  },
  codeValue: {
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
  },
  container: {
    flex: 1,
  },
  dialogContent: {
    gap: 12,
  },
  dialogScrollArea: {
    maxHeight: 520,
  },
  dialogScrollContent: {
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyState: {
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 28,
    paddingTop: 80,
  },
  headerContent: {
    gap: 12,
    paddingBottom: 12,
  },
  itemSeparator: {
    height: 8,
  },
  listContent: {
    padding: 12,
    paddingBottom: 104,
  },
  muted: {
    opacity: 0.72,
  },
  primaryToolbarButton: {
    flexGrow: 1,
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
  titleActions: {
    alignItems: "center",
    flexDirection: "row",
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
