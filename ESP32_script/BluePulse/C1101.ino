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
constexpr uint16_t RAW_MAX_PULSES = 512;
constexpr uint16_t RAW_MIN_PULSES = 8;
constexpr uint16_t RAW_MIN_PULSE_US = 20;
constexpr uint32_t RAW_FRAME_GAP_US = 25000;
constexpr uint16_t RAW_MAX_PULSE_US = 65535;

constexpr uint8_t RAW_PACKET_MAGIC = 0x52; // "R"
constexpr uint8_t RAW_PACKET_META = 1;
constexpr uint8_t RAW_PACKET_DATA = 2;
constexpr uint8_t RAW_PACKET_END = 3;
constexpr uint8_t RAW_PACKET_STATUS = 4;

constexpr uint8_t RAW_STATUS_ARMED = 1;
constexpr uint8_t RAW_STATUS_STOPPED = 2;
constexpr uint8_t RAW_STATUS_REPLAYING = 3;
constexpr uint8_t RAW_STATUS_REPLAYED = 4;
constexpr uint8_t RAW_STATUS_ERROR = 5;
constexpr uint8_t RAW_STATUS_LOADED = 6;

// One CC1101 is shared by both bands. The BLE protocol still uses
// 1 = 315 MHz and 2 = 433 MHz, exactly as the original firmware did.
RCSwitch rf = RCSwitch();
SemaphoreHandle_t radioMutex = nullptr;
int listeningFrequencyFlag = 2;
unsigned long nextFrequencySwitchAt = 0;

enum RadioMode : uint8_t {
  RADIO_MODE_SCANNING,
  RADIO_MODE_RAW_CAPTURE,
  RADIO_MODE_RAW_READY,
};

RadioMode radioMode = RADIO_MODE_SCANNING;
portMUX_TYPE rawCaptureMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool rawCaptureArmed = false;
volatile bool rawFrameReady = false;
volatile bool rawSawFirstEdge = false;
volatile uint8_t rawLastLevel = LOW;
volatile uint16_t rawPulseCount = 0;
volatile uint32_t rawLastEdgeAt = 0;
volatile uint16_t rawPulseDurations[RAW_MAX_PULSES];
volatile uint8_t rawPulseLevels[RAW_MAX_PULSES];
int rawFrequencyFlag = 2;
uint16_t rawLastCaptureId = 0;
uint16_t rawNextCaptureId = 1;
bool rawUploadInProgress = false;
uint16_t rawUploadExpectedCount = 0;
uint16_t rawUploadReceivedCount = 0;

// BLE UUIDs -- unchanged, so the existing BluePulse app keeps working.
#define SERVICE_UUID           "12345678-1234-1234-1234-1234567890ab"
#define CHARACTERISTIC_UUID_TX "12345678-1234-1234-1234-1234567890ac"
#define CHARACTERISTIC_UUID_RX "12345678-1234-1234-1234-1234567890ad"
#define CHARACTERISTIC_UUID_RAW "12345678-1234-1234-1234-1234567890ae"

BLECharacteristic *pCharacteristicTX = nullptr;
BLECharacteristic *pCharacteristicRX = nullptr;
BLECharacteristic *pCharacteristicRaw = nullptr;

bool deviceConnected = false;
bool isAdvertising = false;
volatile bool resumeNormalScanAfterDisconnect = false;

float frequencyForFlag(int frequencyFlag) {
  return frequencyFlag == 1 ? RF_315_MHZ : RF_433_MHZ;
}

void IRAM_ATTR rawEdgeISR() {
  if (!rawCaptureArmed) return;

  const uint32_t now = micros();
  const uint8_t level = digitalRead(CC1101_GDO0_PIN) == HIGH ? HIGH : LOW;

  portENTER_CRITICAL_ISR(&rawCaptureMux);

  if (!rawCaptureArmed) {
    portEXIT_CRITICAL_ISR(&rawCaptureMux);
    return;
  }

  if (!rawSawFirstEdge) {
    rawSawFirstEdge = true;
    rawLastLevel = level;
    rawLastEdgeAt = now;
    portEXIT_CRITICAL_ISR(&rawCaptureMux);
    return;
  }

  const uint32_t duration = now - rawLastEdgeAt;
  if (duration >= RAW_FRAME_GAP_US && rawPulseCount >= RAW_MIN_PULSES) {
    // A long quiet gap marks the end of a raw RF frame. The main loop will
    // detach this ISR and stream the completed capture over BLE.
    rawCaptureArmed = false;
    rawFrameReady = true;
  } else if (duration >= RAW_MIN_PULSE_US) {
    if (rawPulseCount < RAW_MAX_PULSES) {
      rawPulseDurations[rawPulseCount] = duration > RAW_MAX_PULSE_US ? RAW_MAX_PULSE_US : duration;
      rawPulseLevels[rawPulseCount] = rawLastLevel;
      rawPulseCount += 1;
    } else {
      rawCaptureArmed = false;
      rawFrameReady = true;
    }
  }

  rawLastLevel = level;
  rawLastEdgeAt = now;
  portEXIT_CRITICAL_ISR(&rawCaptureMux);
}

// Caller must hold radioMutex.
void startScanningReceiveLocked(int frequencyFlag) {
  detachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN));
  portENTER_CRITICAL(&rawCaptureMux);
  rawCaptureArmed = false;
  rawFrameReady = false;
  rawSawFirstEdge = false;
  rawPulseCount = 0;
  portEXIT_CRITICAL(&rawCaptureMux);

  rawLastCaptureId = 0;
  rawUploadInProgress = false;
  rawUploadExpectedCount = 0;
  rawUploadReceivedCount = 0;

  rf.disableTransmit();
  rf.disableReceive();
  rf.resetAvailable();

  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(frequencyFlag));
  rf.enableReceive(digitalPinToInterrupt(CC1101_GDO0_PIN));

  listeningFrequencyFlag = frequencyFlag;
  nextFrequencySwitchAt = millis() + RECEIVE_DWELL_MS;
  radioMode = RADIO_MODE_SCANNING;
}

// Caller must hold radioMutex.
void startRawCaptureLocked(int frequencyFlag) {
  detachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN));
  rf.disableTransmit();
  rf.disableReceive();
  rf.resetAvailable();

  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(frequencyFlag));

  portENTER_CRITICAL(&rawCaptureMux);
  rawCaptureArmed = true;
  rawFrameReady = false;
  rawSawFirstEdge = false;
  rawPulseCount = 0;
  rawLastEdgeAt = 0;
  portEXIT_CRITICAL(&rawCaptureMux);

  rawFrequencyFlag = frequencyFlag;
  rawLastCaptureId = 0;
  rawUploadInProgress = false;
  rawUploadExpectedCount = 0;
  rawUploadReceivedCount = 0;
  radioMode = RADIO_MODE_RAW_CAPTURE;
  attachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN), rawEdgeISR, CHANGE);
}

// Caller must hold radioMutex.
void stopRawCaptureLocked(bool keepCapture) {
  detachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN));
  portENTER_CRITICAL(&rawCaptureMux);
  rawCaptureArmed = false;
  rawFrameReady = false;
  rawSawFirstEdge = false;
  if (!keepCapture) rawPulseCount = 0;
  portEXIT_CRITICAL(&rawCaptureMux);

  if (!keepCapture) {
    rawLastCaptureId = 0;
    rawUploadInProgress = false;
    rawUploadExpectedCount = 0;
    rawUploadReceivedCount = 0;
  }

  rf.disableTransmit();
  rf.disableReceive();
  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(rawFrequencyFlag));
  radioMode = RADIO_MODE_RAW_READY;
}

// Caller must hold radioMutex. Saved waveforms are uploaded in small BLE
// writes so they remain compatible with the default 20-byte MTU.
bool startRawUploadLocked(int frequencyFlag, uint16_t expectedCount) {
  if ((frequencyFlag != 1 && frequencyFlag != 2) || expectedCount == 0 ||
      expectedCount > RAW_MAX_PULSES) {
    return false;
  }

  detachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN));
  rf.disableTransmit();
  rf.disableReceive();
  rf.resetAvailable();

  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(frequencyFlag));

  portENTER_CRITICAL(&rawCaptureMux);
  rawCaptureArmed = false;
  rawFrameReady = false;
  rawSawFirstEdge = false;
  rawPulseCount = 0;
  portEXIT_CRITICAL(&rawCaptureMux);

  rawFrequencyFlag = frequencyFlag;
  rawLastCaptureId = 0;
  rawUploadInProgress = true;
  rawUploadExpectedCount = expectedCount;
  rawUploadReceivedCount = 0;
  radioMode = RADIO_MODE_RAW_READY;
  return true;
}

// Caller must hold radioMutex.
bool appendRawUploadPulseLocked(uint16_t index, uint8_t level, uint16_t duration) {
  if (!rawUploadInProgress || index != rawUploadReceivedCount ||
      index >= rawUploadExpectedCount || index >= RAW_MAX_PULSES ||
      level > 1 || duration == 0) {
    return false;
  }

  rawPulseLevels[index] = level == 0 ? LOW : HIGH;
  rawPulseDurations[index] = duration;
  rawUploadReceivedCount += 1;
  rawPulseCount = rawUploadReceivedCount;
  return true;
}

// Caller must hold radioMutex. Returns a new capture ID only after every
// expected segment has arrived, so replay can never use a partial waveform.
uint16_t finishRawUploadLocked() {
  if (!rawUploadInProgress || rawUploadExpectedCount == 0 ||
      rawUploadReceivedCount != rawUploadExpectedCount) {
    return 0;
  }

  rawUploadInProgress = false;
  rawUploadExpectedCount = 0;
  rawUploadReceivedCount = 0;
  rawLastCaptureId = rawNextCaptureId++;
  if (rawNextCaptureId == 0) rawNextCaptureId = 1;
  radioMode = RADIO_MODE_RAW_READY;
  return rawLastCaptureId;
}

// Caller must hold radioMutex. A burst stays on the ESP32 so its gap timing
// is not affected by BLE write latency or phone scheduling.
void sendBurstCodeLocked(unsigned long code, int frequencyFlag, int protocol,
                         int iterations, unsigned long gapMs, int repeatSeconds) {
  rf.disableReceive();
  rf.resetAvailable();

  ELECHOUSE_cc1101.SetTx(frequencyForFlag(frequencyFlag));
  rf.enableTransmit(CC1101_GDO0_PIN);
  rf.setProtocol(protocol);

  for (int iteration = 0; iteration < iterations; iteration += 1) {
    if (repeatSeconds <= 1) {
      rf.send(code, 24);  // Preserves the original app/firmware behaviour.
    } else {
      unsigned long startedAt = millis();
      while (millis() - startedAt < static_cast<unsigned long>(repeatSeconds) * 1000UL) {
        rf.send(code, 24);
        delay(350);
      }
    }

    if (iteration + 1 < iterations && gapMs > 0) delay(gapMs);
  }

  rf.disableTransmit();
  startScanningReceiveLocked(frequencyFlag);
}

// Caller must hold radioMutex.
void sendFixedCodeLocked(unsigned long code, int frequencyFlag, int protocol,
                         int repeatSeconds) {
  sendBurstCodeLocked(code, frequencyFlag, protocol, 1, 0, repeatSeconds);
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

void sendRawPacket(uint8_t *packet, size_t length) {
  if (!deviceConnected || pCharacteristicRaw == nullptr) return;
  pCharacteristicRaw->setValue(packet, length);
  pCharacteristicRaw->notify();
}

void sendRawStatus(uint8_t status, uint16_t captureId = 0) {
  uint8_t packet[] = {
      RAW_PACKET_MAGIC,
      RAW_PACKET_STATUS,
      status,
      static_cast<uint8_t>(captureId >> 8),
      static_cast<uint8_t>(captureId & 0xFF),
  };
  sendRawPacket(packet, sizeof(packet));
}

// Caller must hold radioMutex. Each data packet fits within the default
// 20-byte BLE notification payload, so it works before MTU negotiation too.
void sendRawCapturePacketsLocked(uint16_t captureId, int frequencyFlag, uint16_t pulseCount) {
  uint8_t metadata[] = {
      RAW_PACKET_MAGIC,
      RAW_PACKET_META,
      static_cast<uint8_t>(captureId >> 8),
      static_cast<uint8_t>(captureId & 0xFF),
      static_cast<uint8_t>(frequencyFlag),
      static_cast<uint8_t>(pulseCount >> 8),
      static_cast<uint8_t>(pulseCount & 0xFF),
  };
  sendRawPacket(metadata, sizeof(metadata));
  delay(8);

  for (uint16_t startIndex = 0; startIndex < pulseCount; startIndex += 4) {
    const uint8_t packetPulseCount = min(static_cast<uint16_t>(4), static_cast<uint16_t>(pulseCount - startIndex));
    uint8_t packet[19] = {
        RAW_PACKET_MAGIC,
        RAW_PACKET_DATA,
        static_cast<uint8_t>(captureId >> 8),
        static_cast<uint8_t>(captureId & 0xFF),
        static_cast<uint8_t>(startIndex >> 8),
        static_cast<uint8_t>(startIndex & 0xFF),
        packetPulseCount,
    };

    for (uint8_t index = 0; index < packetPulseCount; index += 1) {
      const uint16_t duration = rawPulseDurations[startIndex + index];
      const uint8_t offset = 7 + index * 3;
      packet[offset] = rawPulseLevels[startIndex + index];
      packet[offset + 1] = static_cast<uint8_t>(duration >> 8);
      packet[offset + 2] = static_cast<uint8_t>(duration & 0xFF);
    }

    sendRawPacket(packet, 7 + packetPulseCount * 3);
    delay(8);
  }

  uint8_t complete[] = {
      RAW_PACKET_MAGIC,
      RAW_PACKET_END,
      static_cast<uint8_t>(captureId >> 8),
      static_cast<uint8_t>(captureId & 0xFF),
  };
  sendRawPacket(complete, sizeof(complete));
}

void finishRawCaptureIfReady() {
  if (radioMode != RADIO_MODE_RAW_CAPTURE) return;

  portENTER_CRITICAL(&rawCaptureMux);
  if (rawCaptureArmed && rawSawFirstEdge && rawPulseCount >= RAW_MIN_PULSES &&
      static_cast<uint32_t>(micros() - rawLastEdgeAt) >= RAW_FRAME_GAP_US) {
    rawCaptureArmed = false;
    rawFrameReady = true;
  }
  const bool frameReady = rawFrameReady;
  portEXIT_CRITICAL(&rawCaptureMux);

  if (!frameReady || xSemaphoreTake(radioMutex, 0) != pdTRUE) return;

  detachInterrupt(digitalPinToInterrupt(CC1101_GDO0_PIN));

  portENTER_CRITICAL(&rawCaptureMux);
  const uint16_t pulseCount = rawPulseCount;
  rawCaptureArmed = false;
  rawFrameReady = false;
  rawSawFirstEdge = false;
  portEXIT_CRITICAL(&rawCaptureMux);

  if (pulseCount >= RAW_MIN_PULSES) {
    rawLastCaptureId = rawNextCaptureId++;
    if (rawNextCaptureId == 0) rawNextCaptureId = 1;
    radioMode = RADIO_MODE_RAW_READY;
    sendRawCapturePacketsLocked(rawLastCaptureId, rawFrequencyFlag, pulseCount);
    Serial.printf("Captured raw RF frame %u: %u pulses at %.2f MHz\n", rawLastCaptureId, pulseCount,
                  frequencyForFlag(rawFrequencyFlag));
  } else {
    radioMode = RADIO_MODE_RAW_READY;
    sendRawStatus(RAW_STATUS_ERROR);
  }

  xSemaphoreGive(radioMutex);
}

// Caller must hold radioMutex.
bool replayRawSelectionLocked(uint16_t captureId, uint16_t startIndex, uint16_t endIndex) {
  if (captureId == 0 || captureId != rawLastCaptureId || startIndex > endIndex || endIndex >= rawPulseCount) {
    return false;
  }

  stopRawCaptureLocked(true);
  ELECHOUSE_cc1101.SetTx(frequencyForFlag(rawFrequencyFlag));
  rf.enableTransmit(CC1101_GDO0_PIN);
  pinMode(CC1101_GDO0_PIN, OUTPUT);

  for (uint16_t index = startIndex; index <= endIndex; index += 1) {
    digitalWrite(CC1101_GDO0_PIN, rawPulseLevels[index] == HIGH ? HIGH : LOW);
    delayMicroseconds(rawPulseDurations[index]);
  }

  digitalWrite(CC1101_GDO0_PIN, LOW);
  rf.disableTransmit();
  pinMode(CC1101_GDO0_PIN, INPUT);
  ELECHOUSE_cc1101.SetRx(frequencyForFlag(rawFrequencyFlag));
  radioMode = RADIO_MODE_RAW_READY;
  return true;
}

void handleRawCommand(const String &value) {
  if (value.startsWith("raw,capture,")) {
    const int frequencyFlag = value.substring(12).toInt();
    if (frequencyFlag != 1 && frequencyFlag != 2) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      startRawCaptureLocked(frequencyFlag);
      xSemaphoreGive(radioMutex);
      sendRawStatus(RAW_STATUS_ARMED);
    }
    return;
  }

  if (value == "raw,stop") {
    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      stopRawCaptureLocked(false);
      xSemaphoreGive(radioMutex);
      sendRawStatus(RAW_STATUS_STOPPED);
    }
    return;
  }

  if (value == "raw,exit") {
    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      stopRawCaptureLocked(false);
      startScanningReceiveLocked(2);
      xSemaphoreGive(radioMutex);
      sendRawStatus(RAW_STATUS_STOPPED);
    }
    return;
  }

  // Upload protocol used by the app's saved-waveform library:
  // raw,u,s,<FREQ_FLAG>,<PULSE_COUNT>
  // raw,u,<INDEX>,<LEVEL>,<DURATION_US>
  // raw,u,e
  // Each segment is sent separately to fit inside the default BLE MTU.
  if (value.startsWith("raw,u,s,")) {
    const String arguments = value.substring(8);
    const int comma = arguments.indexOf(',');
    if (comma == -1) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    const int frequencyFlag = arguments.substring(0, comma).toInt();
    const int pulseCount = arguments.substring(comma + 1).toInt();
    if ((frequencyFlag != 1 && frequencyFlag != 2) || pulseCount <= 0 ||
        pulseCount > RAW_MAX_PULSES) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    bool started = false;
    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      started = startRawUploadLocked(frequencyFlag, static_cast<uint16_t>(pulseCount));
      xSemaphoreGive(radioMutex);
    }
    if (!started) sendRawStatus(RAW_STATUS_ERROR);
    return;
  }

  if (value == "raw,u,e") {
    uint16_t captureId = 0;
    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      captureId = finishRawUploadLocked();
      xSemaphoreGive(radioMutex);
    }
    sendRawStatus(captureId == 0 ? RAW_STATUS_ERROR : RAW_STATUS_LOADED, captureId);
    return;
  }

  if (value.startsWith("raw,u,")) {
    const String arguments = value.substring(6);
    const int firstComma = arguments.indexOf(',');
    const int secondComma = arguments.indexOf(',', firstComma + 1);
    if (firstComma == -1 || secondComma == -1) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    const int index = arguments.substring(0, firstComma).toInt();
    const int level = arguments.substring(firstComma + 1, secondComma).toInt();
    const int duration = arguments.substring(secondComma + 1).toInt();
    if (index < 0 || index >= RAW_MAX_PULSES || level < 0 || level > 1 ||
        duration <= 0 || duration > RAW_MAX_PULSE_US) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    bool appended = false;
    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      appended = appendRawUploadPulseLocked(static_cast<uint16_t>(index),
                                             static_cast<uint8_t>(level),
                                             static_cast<uint16_t>(duration));
      xSemaphoreGive(radioMutex);
    }
    if (!appended) sendRawStatus(RAW_STATUS_ERROR);
    return;
  }

  if (value.startsWith("raw,replay,")) {
    const String arguments = value.substring(11);
    const int firstComma = arguments.indexOf(',');
    const int secondComma = arguments.indexOf(',', firstComma + 1);
    if (firstComma == -1 || secondComma == -1) {
      sendRawStatus(RAW_STATUS_ERROR);
      return;
    }

    const uint16_t captureId = static_cast<uint16_t>(arguments.substring(0, firstComma).toInt());
    const uint16_t startIndex = static_cast<uint16_t>(arguments.substring(firstComma + 1, secondComma).toInt());
    const uint16_t endIndex = static_cast<uint16_t>(arguments.substring(secondComma + 1).toInt());

    if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
      sendRawStatus(RAW_STATUS_REPLAYING, captureId);
      const bool replayed = replayRawSelectionLocked(captureId, startIndex, endIndex);
      xSemaphoreGive(radioMutex);
      sendRawStatus(replayed ? RAW_STATUS_REPLAYED : RAW_STATUS_ERROR, captureId);
    }
    return;
  }

  sendRawStatus(RAW_STATUS_ERROR);
}

// b,<CODE>,<FREQ_FLAG>,<PROTOCOL>,<ITERATIONS>,<GAP_MS>,<REPEAT_SECONDS>
void handleBurstCommand(const String &value) {
  const int first = value.indexOf(',');
  const int second = value.indexOf(',', first + 1);
  const int third = value.indexOf(',', second + 1);
  const int fourth = value.indexOf(',', third + 1);
  const int fifth = value.indexOf(',', fourth + 1);
  const int sixth = value.indexOf(',', fifth + 1);

  if (first != 1 || second == -1 || third == -1 || fourth == -1 ||
      fifth == -1 || sixth == -1) {
    Serial.println("Invalid burst format");
    return;
  }

  const String codeString = value.substring(first + 1, second);
  const int frequencyFlag = value.substring(second + 1, third).toInt();
  const int protocol = value.substring(third + 1, fourth).toInt();
  const int iterations = value.substring(fourth + 1, fifth).toInt();
  const int gapMs = value.substring(fifth + 1, sixth).toInt();
  const int repeatSeconds = value.substring(sixth + 1).toInt();

  if (codeString.isEmpty() || frequencyFlag < 1 || frequencyFlag > 2 ||
      protocol < 1 || iterations < 1 || iterations > 99 ||
      gapMs < 0 || gapMs > 60000 || repeatSeconds < 1 || repeatSeconds > 99) {
    Serial.println("Invalid burst values");
    return;
  }

  const unsigned long code = strtoul(codeString.c_str(), nullptr, 10);
  Serial.printf("Bursting code %lu on %.2f MHz: %d times, %d ms gap, %d s hold\n",
                code, frequencyForFlag(frequencyFlag), iterations, gapMs, repeatSeconds);

  if (xSemaphoreTake(radioMutex, portMAX_DELAY) == pdTRUE) {
    sendBurstCodeLocked(code, frequencyFlag, protocol, iterations,
                        static_cast<unsigned long>(gapMs), repeatSeconds);
    xSemaphoreGive(radioMutex);
  }
}

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("BLE device connected");
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    // Raw mode is intentionally fixed-band while the app owns the session.
    // A disconnected phone should not leave the radio fixed indefinitely.
    resumeNormalScanAfterDisconnect = true;
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

    if (value.startsWith("raw,")) {
      handleRawCommand(value);
      return;
    }

    if (value.startsWith("b,")) {
      handleBurstCommand(value);
      return;
    }

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
  startScanningReceiveLocked(2);  // Start at 433.92 MHz, then alternate with 315 MHz.
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

  pCharacteristicRaw = pService->createCharacteristic(
      CHARACTERISTIC_UUID_RAW,
      BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristicRaw->addDescriptor(new BLE2902());

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
  if (radioMode != RADIO_MODE_SCANNING) return;

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
  if (radioMode != RADIO_MODE_SCANNING) return;
  if (millis() < nextFrequencySwitchAt) return;
  if (xSemaphoreTake(radioMutex, 0) != pdTRUE) return;

  // Let an already-decoded frame be delivered before changing bands.
  if (!rf.available()) {
    startScanningReceiveLocked(listeningFrequencyFlag == 1 ? 2 : 1);
  }
  xSemaphoreGive(radioMutex);
}

void resumeNormalScanAfterDisconnectIfNeeded() {
  if (!resumeNormalScanAfterDisconnect || xSemaphoreTake(radioMutex, 0) != pdTRUE) return;

  startScanningReceiveLocked(2);
  resumeNormalScanAfterDisconnect = false;
  xSemaphoreGive(radioMutex);
}

void loop() {
  if (!deviceConnected && !isAdvertising) {
    BLEDevice::startAdvertising();
    isAdvertising = true;
  } else if (deviceConnected && isAdvertising) {
    isAdvertising = false;
  }

  resumeNormalScanAfterDisconnectIfNeeded();
  notifyReceivedCode();
  finishRawCaptureIfReady();
  scanOtherFrequency();
  delay(1);
}
