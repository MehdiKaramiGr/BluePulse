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

// BLE UUIDs
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID_TX "12345678-1234-1234-1234-1234567890ac"
#define CHARACTERISTIC_UUID_RX "12345678-1234-1234-1234-1234567890ad"

BLECharacteristic *pCharacteristicTX = nullptr;
BLECharacteristic *pCharacteristicRX = nullptr;

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
    String s = pCharacteristic->getValue(); // get as std::string
    if (s.isEmpty()) return;

    String value = String(s.c_str()); // convert to Arduino String for convenience
    Serial.print("Received from BLE: ");
    Serial.println(value);

    // Expected format: c,<CODE>,<FREQ_FLAG>,<PROTOCOL>
    if (!value.startsWith("c,")) {
      Serial.println("BLE command not starting with 'c,' -> ignored");
      return;
    }

    int first = value.indexOf(','); // should be 1
    int second = value.indexOf(',', first + 1);
    int third = value.indexOf(',', second + 1);

    if (first == -1 || second == -1 || third == -1) {
      Serial.println("Invalid format (need c,<CODE>,<FREQ_FLAG>,<PROTOCOL>)");
      return;
    }

    String codeStr = value.substring(first + 1, second);
    int freqFlag = value.substring(second + 1, third).toInt(); // 1 => 315, 2 => 433 (per your code)
    String protocolStr = value.substring(third + 1);

    unsigned long codeNum = (unsigned long) strtoul(codeStr.c_str(), nullptr, 10); // decimal
    int protocolNum = protocolStr.toInt();

    Serial.printf("Parsed code: %lu, freqFlag: %d, protocol: %d\n", codeNum, freqFlag, protocolNum);

    if (protocolStr == "raw") {
      Serial.println("Raw protocol currently not implemented.");
      return;
    }

    if (freqFlag == 1) {
      // 315 handler
      rx315.setProtocol(protocolNum);
      rx315.send(codeNum, 24); // adjust bits if needed
      Serial.println("Sent on 315 MHz");
    } else {
      // default to 433
      rx433.setProtocol(protocolNum);
      rx433.send(codeNum, 24); // adjust bits if needed
      Serial.println("Sent on 433 MHz");
    }
  }
};

void setup() {
  Serial.begin(115200);
  // For Some board this GPIO14 is registered as JTAG port TMS input signal causes to reboot the board on reciving data
  pinMode(14,INPUT);
  delay(50);

  // RC-Switch setup (pins for ESP32 variants of the libs)
  rx433.enableReceive(rx443PIN);
  rx315.enableReceive(rx315PIN);
  rx433.enableTransmit(tx443PIN);
  rx315.enableTransmit(tx315PIN);
  receiverEnabled = true;
  Serial.println("RC-Switch receivers enabled");

  // BLE init
  BLEDevice::init("ESP32_RF_Sniffer");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristicTX = pService->createCharacteristic(
      CHARACTERISTIC_UUID_TX,
      BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristicTX->addDescriptor(new BLE2902());

  pCharacteristicRX = pService->createCharacteristic(
      CHARACTERISTIC_UUID_RX,
      BLECharacteristic::PROPERTY_WRITE
  );
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

  // Give RTOS some time; keeps watchdog happy
  delay(1);
}

void notify() {
  bool updated = false;
  String message = "";

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
