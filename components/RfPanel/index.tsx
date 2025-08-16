import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  Button,
  Card,
  IconButton,
  MD3Theme,
  Modal,
  Portal,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
  Tooltip,
  useTheme,
} from "react-native-paper";
import { RfCode } from "./types";
// interface RfCode {
//   Code: string;
//   Alias: string;
//   Freq: number;
//   Protocol: number;
//   SortId: number;
//   Repeat: number;
//   Favorite: boolean;
// }

export const STORAGE_KEY = "@rf_codes";

export default function RfPanel({
  isOpen,
  sendDataToDevice,
}: {
  isOpen: boolean;
  sendDataToDevice: (data: string) => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(theme);
  const [codes, setCodes] = useState<RfCode[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form, setForm] = useState<RfCode>({
    Code: "",
    Alias: "",
    Freq: 443,
    Protocol: 1,
    SortId: 0,
    Repeat: 1,
    Favorite: false,
  });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) setCodes(JSON.parse(data));
    });
  }, [isOpen]);

  const saveCodes = async (updated: RfCode[]) => {
    setCodes(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const openModal = (item?: RfCode, index?: number) => {
    if (item && typeof index === "number") {
      setForm(item);
      setEditIndex(index);
    } else {
      setForm({ Code: "", Alias: "", Freq: 443, Protocol: 1, SortId: codes.length, Repeat: 1, Favorite: false });
      setEditIndex(null);
    }
    setModalVisible(true);
  };

  const submit = () => {
    const updated = [...codes];
    if (editIndex !== null) {
      updated[editIndex] = form;
    } else {
      updated.push(form);
    }
    saveCodes(updated);
    setModalVisible(false);
  };

  const confirmDelete = (index: number) => {
    Alert.alert("Delete Code", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          const updated = [...codes];
          updated.splice(index, 1);
          saveCodes(updated);
        },
      },
    ]);
  };

  const renderItem = ({ item, getIndex, drag, isActive }: RenderItemParams<RfCode>) => (
    <Card
      style={[styles.card, { backgroundColor: isActive ? "#aaa" : theme.colors.surfaceVariant }]}
      key={getIndex()}
      onLongPress={drag} // enable dragging by long press
    >
      {/* <Card.Cover source={{ uri: "https://picsum.photos/700" }} /> */}
      <Card.Title
        title={item.Alias}
        right={(props) => (
          <View style={styles.cardActions}>
            <Tooltip title="Send the code">
              <IconButton
                icon="transmission-tower-export"
                onPress={() => {
                  sendDataToDevice(`c,${item?.Code},${item?.Freq == 315 ? 1 : 2},${item?.Protocol},${item?.Repeat}`);
                }}
                {...props}
              />
            </Tooltip>
            <Tooltip title="Rapid Send the code">
              <IconButton
                icon="flash"
                onPress={() => {
                  for (let i = 0; i < 10; i++) {
                    sendDataToDevice(`c,${item?.Code},${item?.Freq == 315 ? 1 : 2},${item?.Protocol},${item?.Repeat}`);
                  }
                }}
                {...props}
              />
            </Tooltip>
            <IconButton icon="pencil" onPress={() => openModal(item, getIndex())} {...props} />
            <IconButton icon="delete" onPress={() => confirmDelete(getIndex() ?? -1)} {...props} />
          </View>
        )}
      />
      <Card.Content>
        <View style={styles.infoRow}>
          <Text style={styles.infoText}>Code: {item.Code}</Text>
          <Text style={styles.infoText}>Freq: {item.Freq}</Text>
          <Text style={styles.infoText}>Rep: {item.Repeat}</Text>
        </View>
      </Card.Content>
    </Card>
  );

  return (
    <View style={styles.container}>
      <Button mode="contained" onPress={() => openModal()} style={styles.addButton}>
        Add New Code
      </Button>

      <GestureHandlerRootView>
        <DraggableFlatList
          data={codes.sort((a, b) => a.SortId - b.SortId)}
          keyExtractor={(item, index) => item.Code + index.toString()}
          renderItem={renderItem}
          onDragEnd={({ data }) => {
            // Update SortId based on new order
            const updated = data.map((item, index) => ({ ...item, SortId: index }));
            saveCodes(updated);
          }}
        />
      </GestureHandlerRootView>

      <Portal>
        <Modal visible={modalVisible} onDismiss={() => setModalVisible(false)} contentContainerStyle={styles.modal}>
          <Text variant="titleMedium">{editIndex !== null ? "Edit Code" : "New Code"}</Text>

          <TextInput
            label="Alias"
            value={form.Alias}
            onChangeText={(text) => setForm({ ...form, Alias: text })}
            style={styles.input}
          />
          <TextInput
            label="Code"
            value={form.Code}
            onChangeText={(text) => setForm({ ...form, Code: text })}
            style={styles.input}
          />
          <TextInput
            label="Repeat"
            value={`${form.Repeat}`}
            onChangeText={(text) => setForm({ ...form, Repeat: Number(text) })}
            style={styles.input}
          />
          <View style={styles.switchRow2}>
            <Text>Frequency</Text>
            <SegmentedButtons
              value={form.Freq.toString()}
              onValueChange={(value) => setForm({ ...form, Freq: Number(value) })}
              buttons={[
                { value: "315", label: "315 MHz" },
                { value: "443", label: "443 MHz" },
              ]}
              style={{ marginLeft: 8 }}
            />
          </View>

          <View style={styles.switchRow2}>
            <Text>Protocol</Text>
            {/* <ScrollView horizontal showsHorizontalScrollIndicator={false}> */}
            <SegmentedButtons
              style={styles.segmentedSmall}
              density="small"
              value={form.Protocol.toString()}
              onValueChange={(value) => setForm({ ...form, Protocol: Number(value) })}
              buttons={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
                { value: "5", label: "5" },
                { value: "6", label: "6" },
              ]}
            />
            {/* </ScrollView> */}
          </View>
          <View style={styles.switchRow}>
            <Text>Bookmark</Text>
            <Switch value={form.Favorite} onValueChange={(value) => setForm({ ...form, Favorite: value })} />
          </View>

          <Button mode="contained" onPress={submit} style={styles.submitButton}>
            {editIndex !== null ? "Update" : "Save"}
          </Button>
        </Modal>
      </Portal>
    </View>
  );
}

const useThemedStyles = (theme: MD3Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: 8,
      backgroundColor: theme.colors.background,
    },
    card: {
      marginVertical: 4,
      marginHorizontal: 10,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceVariant,
    },
    cardActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    addButton: {
      marginVertical: 8,
      position: "absolute",
      bottom: 0,
      zIndex: 5,
    },
    input: {
      marginVertical: 8,
      backgroundColor: theme.colors.surface,
    },
    modal: {
      backgroundColor: theme.colors.background,
      padding: 20,
      margin: 20,
      borderRadius: 12,
    },
    switchRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginVertical: 8,
    },
    switchRow2: {
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      marginVertical: 8,
      gap: 8,
    },
    segmentedSmall: {
      marginBottom: 8,
      transform: [{ scale: 0.7 }],
    },
    submitButton: {
      marginTop: 16,
    },
    infoRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 4,
    },
    infoText: {
      fontSize: 14,
      color: theme.colors.onSurface,
      marginRight: 8,
    },
  });
