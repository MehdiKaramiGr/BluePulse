#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <ELECHOUSE_CC1101_SRC_DRV.h>
#include <RCSwitch.h>

// CC1101 wiring (ESP32 VSPI + GDO0 data line)
#define CC1101_SCK_PIN  18
#define CC1101_MISO_PIN 19
#define CC1101_MOSI_PIN 23
#define CC1101_CSN_PIN  5
#define CC1101_GDO0_PIN 4

constexpr float RF_315_MHZ = 315.00f;
constexpr float RF_433_MHZ = 433.92f;
constexpr unsigned long RECEIVE_DWELL_MS = 150;

// One CC1101 is shared by both bands. The BLE protocol still uses
// 1 = 315 MHz and 2 = 433 MHz, exactly as the original firmware did.
RCSwitch rf = RCSwitch();
SemaphoreHandle_t radioMutex = nullptr;
int listeningFrequencyFlag = 2;
unsigned long nextFrequencySwitchAt = 0;

// BLE UUIDs -- unchanged, so the existing BluePulse app keeps working.
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID_TX "12345678-1234-1234-1234-1234567890ac"
#define CHARACTERISTIC_UUID_RX "12345678-1234-1234-1234-1234567890ad"

BLECharacteristic *pCharacteristicTX = nullptr;
BLECharacteristic *pCharacteristicRX = nullptr;

bool deviceConnected = false;
bool isAdvertising = false;

float frequencyForFlag(int frequencyFlag) {
  return frequencyFlag == 1 ? RF_315_MHZ : RF_433_MHZ;
}

// Caller must hold radioMutex.
void startReceiveLocked(int frequencyFlag) {
  rf.disableTransmit();
  rf.disableReceive();
  rf.resetAvailable();

  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(frequencyFlag));
  rf.enableReceive(digitalPinToInterrupt(CC1101_GDO0_PIN));

  listeningFrequencyFlag = frequencyFlag;
  nextFrequencySwitchAt = millis() + RECEIVE_DWELL_MS;
}

// Caller must hold radioMutex.
void sendFixedCodeLocked(unsigned long code, int frequencyFlag, int protocol,
                         int repeatSeconds) {
  rf.disableReceive();
  rf.resetAvailable();

  ELECHOUSE_cc1101.SetTx(frequencyForFlag(frequencyFlag));
  rf.enableTransmit(CC1101_GDO0_PIN);
  rf.setProtocol(protocol);

  if (repeatSeconds <= 1) {
    rf.send(code, 24);  // Preserves the original app/firmware behaviour.
  } else {
    unsigned long startedAt = millis();
    while (millis() - startedAt < static_cast<unsigned long>(repeatSeconds) * 1000UL) {
      rf.send(code, 24);
      delay(350);
    }
  }

  rf.disableTransmit();
  startReceiveLocked(frequencyFlag);
}

void sendBleNotification(unsigned long code, int frequencyFlag, int protocol) {
  if (pCharacteristicTX == nullptr) return;

  // Notification format remains: <CODE>,<FREQ_FLAG>,<PROTOCOL>
  String message = String(code) + "," + String(frequencyFlag) + "," + String(protocol);
  pCharacteristicTX->setValue(message.c_str());
  pCharacteristicTX->notify();
  Serial.print("Sent via BLE: ");
  Serial.println(message);
}

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("BLE device connected");
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    BLEDevice::getAdvertising()->start();
    Serial.println("BLE device disconnected; advertising restarted");
  }
};

class MyWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) override {
    String received = pCharacteristic->getValue();
    if (received.isEmpty()) return;

    String value = String(received.c_str());
    Serial.print("Received from BLE: ");
    Serial.println(value);

    // Compatible with both forms already sent by the app:
    // c,<CODE>,<FREQ_FLAG>,<PROTOCOL>
    // c,<CODE>,<FREQ_FLAG>,<PROTOCOL>,<REPEAT>
    if (!value.startsWith("c,")) {
      Serial.println("BLE command not starting with 'c,' -> ignored");
      return;
    }

    int first = value.indexOf(',');
    int second = value.indexOf(',', first + 1);
    int third = value.indexOf(',', second + 1);
    int fourth = value.indexOf(',', third + 1);

    if (first != 1 || second == -1 || third == -1) {
      Serial.println("Invalid format (need c,<CODE>,<FREQ_FLAG>,<PROTOCOL>[,<REPEAT>])");
      return;
    }

    String codeStr = value.substring(first + 1, second);
    int frequencyFlag = value.substring(second + 1, third).toInt();
    String protocolStr = value.substring(third + 1, fourth == -1 ? value.length() : fourth);
    int repeatSeconds = fourth == -1 ? 1 : value.substring(fourth + 1).toInt();

    if (protocolStr == "raw") {
      Serial.println("Raw protocol currently not implemented.");
      return;
    }

    if (frequencyFlag != 1 && frequencyFlag != 2) {
      Serial.println("Invalid frequency flag (use 1 for 315 MHz or 2 for 433 MHz)");
      return;
    }

    unsigned long code = strtoul(codeStr.c_str(), nullptr, 10);
    int protocol = protocolStr.toInt();
    if (protocol < 1) protocol = 1;
    if (repeatSeconds < 1) repeatSeconds = 1;

    Serial.printf("Sending code %lu on %.2f MHz, protocol %d\n",
                  code, frequencyForFlag(frequencyFlag), protocol);

    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      sendFixedCodeLocked(code, frequencyFlag, protocol, repeatSeconds);
      xSemaphoreGive(radioMutex);
    }
  }
};

void setup() {
  Serial.begin(115200);

  radioMutex = xSemaphoreCreateMutex();
  if (radioMutex == nullptr) {
    Serial.println("Unable to create radio mutex");
    while (true) delay(1000);
  }

  ELECHOUSE_cc1101.setSpiPin(CC1101_SCK_PIN, CC1101_MISO_PIN,
                              CC1101_MOSI_PIN, CC1101_CSN_PIN);
  ELECHOUSE_cc1101.setGDO0(CC1101_GDO0_PIN);
  ELECHOUSE_cc1101.Init();
  ELECHOUSE_cc1101.setModulation(2);  // ASK/OOK, used by RC-Switch protocols.

  if (!ELECHOUSE_cc1101.getCC1101()) {
    Serial.println("CC1101 SPI connection failed");
    while (true) delay(1000);
  }

  xSemaphoreTake(radioMutex, portMAX_DELAY);
  startReceiveLocked(2);  // Start at 433.92 MHz, then alternate with 315 MHz.
  xSemaphoreGive(radioMutex);
  Serial.println("CC1101 receiver started (315/433 MHz scan)");

  BLEDevice::init("ESP32 KeyWave V2");
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

void notifyReceivedCode() {
  unsigned long code = 0;
  int frequencyFlag = 0;
  int protocol = 0;
  bool received = false;

  if (xSemaphoreTake(radioMutex, 0) == pdTRUE) {
    if (rf.available()) {
      code = rf.getReceivedValue();
      protocol = rf.getReceivedProtocol();
      frequencyFlag = listeningFrequencyFlag;
      rf.resetAvailable();
      received = code != 0;

      Serial.printf("Received %lu at %.2f MHz, protocol %d\n",
                    code, frequencyForFlag(frequencyFlag), protocol);
    }
    xSemaphoreGive(radioMutex);
  }

  if (received) sendBleNotification(code, frequencyFlag, protocol);
}

void scanOtherFrequency() {
  if (millis() < nextFrequencySwitchAt) return;
  if (xSemaphoreTake(radioMutex, 0) != pdTRUE) return;

  // Let an already-decoded frame be delivered before changing bands.
  if (!rf.available()) {
    startReceiveLocked(listeningFrequencyFlag == 1 ? 2 : 1);
  }
  xSemaphoreGive(radioMutex);
}

void loop() {
  if (!deviceConnected && !isAdvertising) {
    BLEDevice::startAdvertising();
    isAdvertising = true;
  } else if (deviceConnected && isAdvertising) {
    isAdvertising = false;
  }

  notifyReceivedCode();
  scanOtherFrequency();
  delay(1);
}
