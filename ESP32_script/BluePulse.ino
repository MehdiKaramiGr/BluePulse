#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <RCSwitch.h>
#include <RCSwitch2.h>

// RF Pins
#define tx315PIN 14
#define tx443PIN 26
#define rx443PIN 25
#define rx315PIN 27
RCSwitch rx433 = RCSwitch();
RCSwitch2 rx315 = RCSwitch2();
RCSwitch tx433 = RCSwitch();
RCSwitch tx315 = RCSwitch();

#define RX_PIN 27

// BLE UUIDs
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID_TX "12345678-1234-1234-1234-1234567890ac"  // Notify BLE client
#define CHARACTERISTIC_UUID_RX "12345678-1234-1234-1234-1234567890ad"  // Write BLE client

BLECharacteristic *pCharacteristicTX;
BLECharacteristic *pCharacteristicRX;

RCSwitch mySwitch = RCSwitch();

bool deviceConnected = false;
bool receiverMode = false;

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("BLE device connected");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("BLE device disconnected");
  }
};

class MyWriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue();

    Serial.print("Received from BLE: ");
    Serial.println(value);

    // You can parse this and send via RF transmitter if you add TX hardware
  }
};

void setup() {
  Serial.begin(115200);

  // Setup RC-Switch for RX
  mySwitch.enableReceive(RX_PIN);
  Serial.println("RC-Switch receiver enabled on pin 27");

  // Setup BLE
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
  pAdvertising->start();

  Serial.println("BLE advertising started");
}

void loop() {
    if(receiverMode){
        notify();
    }else{
        rx433.disableReceive();
        rx315.disableReceive();
    }
}


void notify() {
    if(!receiverMode){
        rx433.enableReceive(rx443PIN);
         rx315.enableReceive(rx315PIN);
    }
    
    bool updated = false;
    String code;



    if (rx433.available()) {
        unsigned long code = rx433.getReceivedValue();
        int protocol = rx433.getReceivedProtocol();
        String msg = String(code) + ",2," +  String(protocol);
        rx433.resetAvailable();
        updated = true;
    }
 
    if (rx315.available()) {
        unsigned long code = rx315.getReceivedValue();
        int protocol = rx315.getReceivedProtocol();
        int protocol = rx315.getReceivedProtocol();
        String msg = String(code) + ",2," +  String(protocol);
        rx315.resetAvailable();
        updated = true;
    }
  
    if (updated) {
        // Notify BLE client
        pCharacteristicTX->setValue(msg.c_str());
        pCharacteristicTX->notify();
    }

}
