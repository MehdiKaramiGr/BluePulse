import { Buffer } from "buffer";
import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { Device } from "react-native-ble-plx";
import { Card, Text, Title } from "react-native-paper";

interface BleDataListenerProps {
  device: Device | null;
  serviceUUID: string;
  characteristicUUID: string;
}

export default function BleDataListener({ device, serviceUUID, characteristicUUID }: BleDataListenerProps) {
  const [dataList, setDataList] = useState<string[]>([]);
  const [subscription, setSubscription] = useState<any>(null);

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
              const decoded = Buffer.from(characteristic.value, "base64").toString("utf8");
              console.log("decoded :>> ", decoded);
              setDataList((prev) => [decoded, ...prev]);
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

  return (
    <View style={styles.container}>
      <Title>Received Data</Title>
      {dataList.length === 0 ? (
        <Text>No data received yet.</Text>
      ) : (
        <FlatList
          data={dataList}
          keyExtractor={(_, index) => index.toString()}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <Card.Content>
                <Text>{item}</Text>
              </Card.Content>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  card: { marginVertical: 6 },
});
