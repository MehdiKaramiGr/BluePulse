#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <RCSwitch.h>
#include <RCSwitch2.h>

// RF Pins
#define tx315PIN 27
#define tx443PIN 26
#define rx315PIN 13
#define rx443PIN 14

RCSwitch rx433 = RCSwitch();
RCSwitch2 rx315 = RCSwitch2();


#define RX_PIN 27

// BLE UUIDs
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID_TX "12345678-1234-1234-1234-1234567890ac"
#define CHARACTERISTIC_UUID_RX "12345678-1234-1234-1234-1234567890ad"

BLECharacteristic *pCharacteristicTX;
BLECharacteristic *pCharacteristicRX;

bool deviceConnected = false;
bool receiverEnabled = false;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("BLE device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("BLE device disconnected");
    BLEDevice::getAdvertising()->start();
    Serial.println("BLE advertising restarted");
  }
};

class MyWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue();
    Serial.print("Received from BLE: ");
    Serial.println(value);

    // Expected format: c,<CODE>,<FREQ_FLAG>,<PROTOCOL>
    if (!value.startsWith("c,")) return;

    int first = value.indexOf(',');
    int second = value.indexOf(',', first + 1);
    int third = value.indexOf(',', second + 1);

    if (first == -1 || second == -1 || third == -1) {
      Serial.println("Invalid format");
      return;
    }

    String codeStr = value.substring(first + 1, second);
    int freq = value.substring(second + 1, third).toInt();
    String protocol = value.substring(third + 1);

    // Convert code from hex string to unsigned long
    // unsigned long code = codeStr;

    Serial.printf("Parsed code: %lu, freq: %d, protocol: %s\n", codeStr, freq, protocol.c_str());

    // RCSwitch* tx = (freq == 315) ? &tx315 : &tx433;
    // int txPin = (freq == 315) ? tx315PIN : tx443PIN;



    if (protocol == "raw") {
      Serial.println("Raw protocol currently not implemented.");
      // Implement raw sending if needed
    } else {
      // int proto =  .toInt();
      // tx->setProtocol(proto);
      // tx->send(code, 24);  // Adjust bit length if needed
      Serial.println("Signal sent");
      Serial.println(codeStr);
       if (freq == 1) {
          rx315.setProtocol(protocol.toInt());
          // Optional set number of transmission repetitions.
          // rx315.setRepeatTransmit(15);
          rx315.send(codeStr.toInt(), 24);
        } else {
          rx433.setProtocol(protocol.toInt());
          rx433.
          rx433.send(codeStr.toInt(), 24);
      }
    }


  }
};

void setup() {
  Serial.begin(115200);

  rx433.enableReceive(rx443PIN);
  rx315.enableReceive(rx315PIN);
  rx433.enableTransmit(tx443PIN);   // e.g., pin 4 for 433 MHz TX
  rx315.enableTransmit(tx315PIN);
  receiverEnabled = true;
  Serial.println("RC-Switch receivers enabled");

  BLEDevice::init("ESP32_RF_Sniffer");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristicTX = pService->createCharacteristic(
      CHARACTERISTIC_UUID_TX,
      BLECharacteristic::PROPERTY_NOTIFY);
  pCharacteristicTX->addDescriptor(new BLE2902());

  pCharacteristicRX = pService->createCharacteristic(
      CHARACTERISTIC_UUID_RX,
      BLECharacteristic::PROPERTY_WRITE);
  pCharacteristicRX->setCallbacks(new MyWriteCallbacks());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE advertising started");
}
c:\Users\Mehdi\Desktop\sketch_jul27a\sketch_jul27a.ino
bool isAdvertising = false;

void loop() {
  if (!deviceConnected && !isAdvertising) {
    BLEDevice::startAdvertising();
    isAdvertising = true;
  }

  if (deviceConnected && isAdvertising) {
    isAdvertising = false;
  }
    notify();
}
void notify() {
  bool updated = false;
  String message = "";
  // Serial.println("start");
  if (rx433.available()) {
    unsigned long code = rx433.getReceivedValue();
    int protocol = rx433.getReceivedProtocol();
    message = String(code) + ",2," + String(protocol);
    rx433.resetAvailable();
    updated = true;
  }

  if (rx315.available()) {
    unsigned long code = rx315.getReceivedValue();
    int protocol = rx315.getReceivedProtocol();
    message = String(code) + ",1," + String(protocol);
    rx315.resetAvailable();
    updated = true;
  }

  if (updated && pCharacteristicTX != nullptr) {
    pCharacteristicTX->setValue(message.c_str());
    pCharacteristicTX->notify();
    Serial.print("Sent via BLE: ");
    Serial.println(message);
  }
}
