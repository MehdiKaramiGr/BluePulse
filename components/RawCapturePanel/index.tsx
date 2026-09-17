import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Device, Subscription } from "react-native-ble-plx";
import {
  Button,
  Card,
  Dialog,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

type FrequencyFlag = 1 | 2;
type CaptureStatus =
  | "idle"
  | "armed"
  | "receiving"
  | "ready"
  | "loaded"
  | "uploading"
  | "replaying"
  | "error";
type TimeUnit = "us" | "ms" | "s";
type ZoomScale = 10 | 50 | 200;

interface RawPulse {
  duration: number;
  level: 0 | 1;
}

interface Selection {
  start: number;
  end: number;
}

interface PendingCapture {
  captureId: number;
  frequencyFlag: FrequencyFlag;
  pulses: (RawPulse | undefined)[];
  receivedCount: number;
}

interface PulseLayout extends RawPulse {
  endPx: number;
  endUs: number;
  index: number;
  startPx: number;
  startUs: number;
  width: number;
}

interface WaveformLayout {
  chartWidth: number;
  pulses: PulseLayout[];
  totalUs: number;
}

interface SavedWaveform {
  createdAt: string;
  frequencyFlag: FrequencyFlag;
  id: string;
  name: string;
  pulses: RawPulse[];
  selection: Selection | null;
}

interface RawCapturePanelProps {
  device: Device | null;
  isOpen: boolean;
  rawCharacteristicUUID: string;
  sendDataToDevice: (data: string) => Promise<void>;
  serviceUUID: string;
}

const SAVED_WAVEFORMS_KEY = "@bluepulse_saved_raw_waveforms_v1";
const MAX_SAVED_WAVEFORMS = 25;

const RAW_PACKET_MAGIC = 0x52;
const RAW_PACKET_META = 1;
const RAW_PACKET_DATA = 2;
const RAW_PACKET_END = 3;
const RAW_PACKET_STATUS = 4;

const RAW_STATUS_ARMED = 1;
const RAW_STATUS_STOPPED = 2;
const RAW_STATUS_REPLAYING = 3;
const RAW_STATUS_REPLAYED = 4;
const RAW_STATUS_ERROR = 5;
const RAW_STATUS_LOADED = 6;

const TIME_UNITS: Record<TimeUnit, { factor: number; label: string }> = {
  us: { factor: 1, label: "µs" },
  ms: { factor: 1_000, label: "ms" },
  s: { factor: 1_000_000, label: "s" },
};

const TIMELINE_STEPS_US = [
  10,
  20,
  50,
  100,
  200,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  20_000,
  50_000,
  100_000,
  200_000,
  500_000,
  1_000_000,
  2_000_000,
  5_000_000,
  10_000_000,
];

function frequencyLabel(frequencyFlag: FrequencyFlag) {
  return frequencyFlag === 1 ? "315 MHz" : "433 MHz";
}

function readUint16(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function formatNumber(value: number, decimals = 3) {
  return Number(value.toFixed(decimals)).toString();
}

function formatDuration(microseconds: number) {
  if (microseconds < 1_000) return Math.round(microseconds) + " µs";
  if (microseconds < 1_000_000) return formatNumber(microseconds / 1_000) + " ms";
  return formatNumber(microseconds / 1_000_000, 4) + " s";
}

function decimalsForTimeUnit(unit: TimeUnit) {
  if (unit === "s") return 6;
  if (unit === "ms") return 4;
  return 0;
}

function formatTimeInUnit(microseconds: number, unit: TimeUnit) {
  const timeUnit = TIME_UNITS[unit];
  return formatNumber(microseconds / timeUnit.factor, decimalsForTimeUnit(unit)) + " " + timeUnit.label;
}

function inputValueForTime(microseconds: number, unit: TimeUnit) {
  return formatNumber(microseconds / TIME_UNITS[unit].factor, decimalsForTimeUnit(unit));
}

function totalDuration(pulses: RawPulse[]) {
  return pulses.reduce((total, pulse) => total + pulse.duration, 0);
}

function normalizeSelection(selection: Selection | null, pulseCount: number): Selection | null {
  if (!selection || pulseCount === 0) return null;

  const start = Math.max(0, Math.min(pulseCount - 1, Math.round(selection.start)));
  const end = Math.max(0, Math.min(pulseCount - 1, Math.round(selection.end)));
  return start <= end ? { start, end } : { start: end, end: start };
}

function buildWaveformLayout(pulses: RawPulse[], microsecondsPerPixel: ZoomScale): WaveformLayout {
  if (pulses.length === 0) {
    return { chartWidth: 320, pulses: [], totalUs: 0 };
  }

  const rawWidths = pulses.map((pulse) => Math.max(2, pulse.duration / microsecondsPerPixel));
  const rawWidth = rawWidths.reduce((total, width) => total + width, 0);
  const scaleToMinimumWidth = rawWidth < 320 ? 320 / rawWidth : 1;

  let elapsedUs = 0;
  let elapsedPx = 0;
  const layoutPulses = pulses.map((pulse, index) => {
    const width = rawWidths[index] * scaleToMinimumWidth;
    const layoutPulse: PulseLayout = {
      ...pulse,
      endPx: elapsedPx + width,
      endUs: elapsedUs + pulse.duration,
      index,
      startPx: elapsedPx,
      startUs: elapsedUs,
      width,
    };
    elapsedUs += pulse.duration;
    elapsedPx += width;
    return layoutPulse;
  });

  return {
    chartWidth: Math.max(320, elapsedPx),
    pulses: layoutPulses,
    totalUs: elapsedUs,
  };
}

function timeToPixel(microseconds: number, waveform: WaveformLayout) {
  if (waveform.pulses.length === 0 || microseconds <= 0) return 0;
  if (microseconds >= waveform.totalUs) return waveform.chartWidth;

  const pulse = waveform.pulses.find((segment) => microseconds <= segment.endUs);
  if (!pulse) return waveform.chartWidth;

  const progress = (microseconds - pulse.startUs) / pulse.duration;
  return pulse.startPx + pulse.width * progress;
}

function selectionTimeRange(selection: Selection | null, waveform: WaveformLayout) {
  if (!selection || waveform.pulses.length === 0) return null;

  const startPulse = waveform.pulses[selection.start];
  const endPulse = waveform.pulses[selection.end];
  if (!startPulse || !endPulse) return null;

  return { start: startPulse.startUs, end: endPulse.endUs };
}

function chooseTimelineStep(totalUs: number) {
  const targetStep = Math.max(1, totalUs / 5);
  return TIMELINE_STEPS_US.find((step) => step >= targetStep) ?? TIMELINE_STEPS_US[TIMELINE_STEPS_US.length - 1];
}

function buildTimelineTicks(totalUs: number) {
  if (totalUs <= 0) return [];

  const step = chooseTimelineStep(totalUs);
  const ticks = [0];
  for (let tick = step; tick < totalUs; tick += step) {
    ticks.push(tick);
  }
  if (ticks[ticks.length - 1] !== totalUs) ticks.push(totalUs);
  return ticks;
}

function isRawPulse(value: unknown): value is RawPulse {
  if (typeof value !== "object" || value === null) return false;
  const pulse = value as Record<string, unknown>;
  return (
    (pulse.level === 0 || pulse.level === 1) &&
    typeof pulse.duration === "number" &&
    Number.isFinite(pulse.duration) &&
    pulse.duration > 0 &&
    pulse.duration <= 65_535
  );
}

function isSelection(value: unknown): value is Selection {
  if (typeof value !== "object" || value === null) return false;
  const selection = value as Record<string, unknown>;
  return (
    typeof selection.start === "number" &&
    Number.isFinite(selection.start) &&
    typeof selection.end === "number" &&
    Number.isFinite(selection.end)
  );
}

function isSavedWaveform(value: unknown): value is SavedWaveform {
  if (typeof value !== "object" || value === null) return false;
  const waveform = value as Record<string, unknown>;
  return (
    typeof waveform.id === "string" &&
    typeof waveform.name === "string" &&
    typeof waveform.createdAt === "string" &&
    (waveform.frequencyFlag === 1 || waveform.frequencyFlag === 2) &&
    Array.isArray(waveform.pulses) &&
    waveform.pulses.length > 0 &&
    waveform.pulses.every(isRawPulse) &&
    (waveform.selection === null || isSelection(waveform.selection))
  );
}

function savedDateLabel(createdAt: string) {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime()) ? createdAt : parsed.toLocaleString();
}

interface WaveformSegmentProps {
  isSelected: boolean;
  onPress: (index: number) => void;
  segment: PulseLayout;
}

const WaveformSegment = memo(function WaveformSegment({
  isSelected,
  onPress,
  segment,
}: WaveformSegmentProps) {
  const levelName = segment.level === 1 ? "high" : "low";
  return (
    <Pressable
      accessibilityHint="Tap once to start a range, then tap another segment to finish it."
      accessibilityLabel={
        "Pulse " +
        (segment.index + 1) +
        ", " +
        levelName +
        ", " +
        formatDuration(segment.duration)
      }
      accessibilityRole="button"
      onPress={() => onPress(segment.index)}
      style={[
        styles.pulseSegment,
        {
          left: segment.startPx,
          top: segment.level === 1 ? 11 : 49,
          width: segment.width,
        },
        segment.level === 1 ? styles.pulseHigh : styles.pulseLow,
        isSelected && styles.pulseSelected,
      ]}
    />
  );
});

export default function RawCapturePanel({
  device,
  isOpen,
  rawCharacteristicUUID,
  sendDataToDevice,
  serviceUUID,
}: RawCapturePanelProps) {
  const theme = useTheme();
  const [frequencyFlag, setFrequencyFlag] = useState<FrequencyFlag>(2);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<number | null>(null);
  const [pulses, setPulses] = useState<RawPulse[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [zoomScale, setZoomScale] = useState<ZoomScale>(50);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>("ms");
  const [rangeStartInput, setRangeStartInput] = useState("");
  const [rangeEndInput, setRangeEndInput] = useState("");
  const [savedWaveforms, setSavedWaveforms] = useState<SavedWaveform[]>([]);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadedWaveformId, setLoadedWaveformId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const pendingCaptureRef = useRef<PendingCapture | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const rawModeActiveRef = useRef(false);
  const sendDataRef = useRef(sendDataToDevice);
  const uploadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const waveform = useMemo(() => buildWaveformLayout(pulses, zoomScale), [pulses, zoomScale]);
  const normalizedSelection = useMemo(
    () => normalizeSelection(selection, waveform.pulses.length),
    [selection, waveform.pulses.length]
  );
  const selectedTimeRange = useMemo(
    () => selectionTimeRange(normalizedSelection, waveform),
    [normalizedSelection, waveform]
  );
  const timelineTicks = useMemo(() => buildTimelineTicks(waveform.totalUs), [waveform.totalUs]);
  const activeRangeStartUs = selectedTimeRange?.start ?? 0;
  const activeRangeEndUs = selectedTimeRange?.end ?? waveform.totalUs;

  const clearUploadTimeout = useCallback(() => {
    if (uploadTimeoutRef.current !== null) {
      clearTimeout(uploadTimeoutRef.current);
      uploadTimeoutRef.current = null;
    }
  }, []);

  const resetSelectionAnchor = useCallback(() => {
    selectionAnchorRef.current = null;
    setSelectionAnchor(null);
  }, []);

  useEffect(() => {
    sendDataRef.current = sendDataToDevice;
  }, [sendDataToDevice]);

  useEffect(() => {
    let stillMounted = true;

    const loadSavedWaveforms = async () => {
      try {
        const stored = await AsyncStorage.getItem(SAVED_WAVEFORMS_KEY);
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (stillMounted && Array.isArray(parsed)) {
          setSavedWaveforms(parsed.filter(isSavedWaveform).slice(0, MAX_SAVED_WAVEFORMS));
        }
      } catch (error) {
        console.warn("Unable to load saved raw waveforms", error);
      }
    };

    void loadSavedWaveforms();
    return () => {
      stillMounted = false;
    };
  }, []);

  useEffect(() => {
    if (waveform.pulses.length === 0) {
      setRangeStartInput("");
      setRangeEndInput("");
      return;
    }

    setRangeStartInput(inputValueForTime(activeRangeStartUs, timeUnit));
    setRangeEndInput(inputValueForTime(activeRangeEndUs, timeUnit));
  }, [activeRangeEndUs, activeRangeStartUs, timeUnit, waveform.pulses.length]);

  useEffect(() => {
    return () => {
      clearUploadTimeout();
      if (rawModeActiveRef.current) {
        void sendDataRef.current("raw,exit");
      }
    };
  }, [clearUploadTimeout]);

  useEffect(() => {
    if (!isOpen || !rawModeActiveRef.current) return;

    rawModeActiveRef.current = false;
    pendingCaptureRef.current = null;
    clearUploadTimeout();
    setCaptureId(null);
    setStatus("idle");
    void sendDataRef.current("raw,exit");
  }, [clearUploadTimeout, isOpen]);

  const handleRawNotification = useCallback(
    (error: Error | null, characteristic: { value: string | null } | null) => {
      if (error) {
        setStatus("error");
        setErrorMessage("Raw data connection lost: " + error.message);
        return;
      }
      if (!characteristic?.value) return;

      let bytes: Uint8Array;
      try {
        bytes = Buffer.from(characteristic.value, "base64");
      } catch {
        setStatus("error");
        setErrorMessage("The bridge sent an unreadable raw-data packet.");
        return;
      }

      if (bytes.length < 2 || bytes[0] !== RAW_PACKET_MAGIC) return;

      const packetType = bytes[1];
      if (packetType === RAW_PACKET_STATUS && bytes.length >= 3) {
        const packetStatus = bytes[2];
        const packetCaptureId = bytes.length >= 5 ? readUint16(bytes, 3) : 0;

        if (packetStatus === RAW_STATUS_ARMED) {
          setStatus("armed");
          setErrorMessage(null);
        } else if (packetStatus === RAW_STATUS_STOPPED) {
          setStatus("idle");
          setCaptureId(null);
        } else if (packetStatus === RAW_STATUS_REPLAYING) {
          setStatus("replaying");
        } else if (packetStatus === RAW_STATUS_REPLAYED) {
          setStatus("ready");
          setErrorMessage(null);
        } else if (packetStatus === RAW_STATUS_LOADED) {
          clearUploadTimeout();
          if (packetCaptureId === 0) {
            setStatus("error");
            setErrorMessage("The bridge could not verify the saved waveform.");
          } else {
            setCaptureId(packetCaptureId);
            setStatus("ready");
            setErrorMessage(null);
            setUploadProgress(null);
          }
        } else if (packetStatus === RAW_STATUS_ERROR) {
          clearUploadTimeout();
          setStatus("error");
          setErrorMessage(
            "The bridge rejected that raw command. Check that it has the matching raw-capture firmware."
          );
          setUploadProgress(null);
        }
        return;
      }

      if (packetType === RAW_PACKET_META && bytes.length >= 7) {
        const nextCaptureId = readUint16(bytes, 2);
        const nextFrequency = bytes[4];
        const expectedPulseCount = readUint16(bytes, 5);
        if (
          nextCaptureId === 0 ||
          (nextFrequency !== 1 && nextFrequency !== 2) ||
          expectedPulseCount === 0 ||
          expectedPulseCount > 512
        ) {
          setStatus("error");
          setErrorMessage("The bridge sent invalid raw-capture metadata.");
          return;
        }

        pendingCaptureRef.current = {
          captureId: nextCaptureId,
          frequencyFlag: nextFrequency,
          pulses: new Array<RawPulse | undefined>(expectedPulseCount),
          receivedCount: 0,
        };
        resetSelectionAnchor();
        setCaptureId(nextCaptureId);
        setFrequencyFlag(nextFrequency);
        setPulses([]);
        setSelection(null);
        setStatus("receiving");
        setErrorMessage(null);
        return;
      }

      if (packetType === RAW_PACKET_DATA && bytes.length >= 7) {
        const packetCaptureId = readUint16(bytes, 2);
        const startIndex = readUint16(bytes, 4);
        const packetPulseCount = bytes[6];
        const pending = pendingCaptureRef.current;
        if (
          !pending ||
          pending.captureId !== packetCaptureId ||
          packetPulseCount === 0 ||
          bytes.length < 7 + packetPulseCount * 3
        ) {
          return;
        }

        for (let offset = 0; offset < packetPulseCount; offset += 1) {
          const index = startIndex + offset;
          const level = bytes[7 + offset * 3];
          const duration = readUint16(bytes, 8 + offset * 3);
          if (index >= pending.pulses.length || (level !== 0 && level !== 1) || duration === 0) {
            continue;
          }
          if (!pending.pulses[index]) pending.receivedCount += 1;
          pending.pulses[index] = { duration, level };
        }
        setStatus("receiving");
        return;
      }

      if (packetType === RAW_PACKET_END && bytes.length >= 4) {
        const packetCaptureId = readUint16(bytes, 2);
        const pending = pendingCaptureRef.current;
        if (!pending || pending.captureId !== packetCaptureId) return;

        pendingCaptureRef.current = null;
        if (pending.receivedCount !== pending.pulses.length) {
          setCaptureId(null);
          setPulses([]);
          setSelection(null);
          setStatus("error");
          setErrorMessage("The capture was incomplete. Please capture the burst again.");
          return;
        }

        const capturedPulses = pending.pulses as RawPulse[];
        resetSelectionAnchor();
        setPulses(capturedPulses);
        setSelection({ start: 0, end: capturedPulses.length - 1 });
        setFrequencyFlag(pending.frequencyFlag);
        setCaptureId(packetCaptureId);
        setStatus("ready");
        setErrorMessage(null);
      }
    },
    [clearUploadTimeout, resetSelectionAnchor]
  );

  useEffect(() => {
    if (!isOpen || !device) return;

    let subscription: Subscription | undefined;
    try {
      subscription = device.monitorCharacteristicForService(
        serviceUUID,
        rawCharacteristicUUID,
        handleRawNotification
      );
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        "Unable to listen for raw data: " + (error instanceof Error ? error.message : "unknown error")
      );
    }

    return () => subscription?.remove();
  }, [device, handleRawNotification, isOpen, rawCharacteristicUUID, serviceUUID]);

  const persistSavedWaveforms = useCallback(async (nextWaveforms: SavedWaveform[]) => {
    setSavedWaveforms(nextWaveforms);
    try {
      await AsyncStorage.setItem(SAVED_WAVEFORMS_KEY, JSON.stringify(nextWaveforms));
    } catch (error) {
      console.warn("Unable to save raw waveform library", error);
      setErrorMessage("The waveform is loaded, but its library entry could not be saved.");
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (!device) {
      setStatus("error");
      setErrorMessage("Connect to the BluePulse bridge before capturing.");
      return;
    }

    clearUploadTimeout();
    pendingCaptureRef.current = null;
    rawModeActiveRef.current = true;
    resetSelectionAnchor();
    setCaptureId(null);
    setPulses([]);
    setSelection(null);
    setLoadedWaveformId(null);
    setUploadProgress(null);
    setStatus("armed");
    setErrorMessage(null);
    await sendDataToDevice("raw,capture," + frequencyFlag);
  }, [clearUploadTimeout, device, frequencyFlag, resetSelectionAnchor, sendDataToDevice]);

  const stopCapture = useCallback(async () => {
    if (!device) return;

    pendingCaptureRef.current = null;
    resetSelectionAnchor();
    setCaptureId(null);
    setStatus("idle");
    await sendDataToDevice("raw,stop");
  }, [device, resetSelectionAnchor, sendDataToDevice]);

  const clearCurrentWaveform = useCallback(() => {
    clearUploadTimeout();
    pendingCaptureRef.current = null;
    resetSelectionAnchor();
    setCaptureId(null);
    setPulses([]);
    setSelection(null);
    setLoadedWaveformId(null);
    setUploadProgress(null);
    setStatus("idle");
    setErrorMessage(null);
  }, [clearUploadTimeout, resetSelectionAnchor]);

  const selectPulse = useCallback((index: number) => {
    const anchor = selectionAnchorRef.current;
    if (anchor === null) {
      selectionAnchorRef.current = index;
      setSelectionAnchor(index);
      setSelection({ start: index, end: index });
      return;
    }

    selectionAnchorRef.current = null;
    setSelectionAnchor(null);
    setSelection({ start: Math.min(anchor, index), end: Math.max(anchor, index) });
  }, []);

  const applyTimelineRange = useCallback(() => {
    if (waveform.pulses.length === 0) return;

    const startValue = Number(rangeStartInput.trim().replace(",", "."));
    const endValue = Number(rangeEndInput.trim().replace(",", "."));
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
      setErrorMessage("Enter numeric start and end times before applying a range.");
      return;
    }

    const factor = TIME_UNITS[timeUnit].factor;
    const startUs = Math.max(0, Math.min(waveform.totalUs, startValue * factor));
    const endUs = Math.max(0, Math.min(waveform.totalUs, endValue * factor));
    if (endUs <= startUs) {
      setErrorMessage("The range end must be later than its start.");
      return;
    }

    const startIndex = waveform.pulses.findIndex((pulse) => pulse.endUs > startUs);
    const endIndex = waveform.pulses.findIndex((pulse) => pulse.endUs >= endUs);
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      setErrorMessage("That time range does not contain a complete pulse.");
      return;
    }

    resetSelectionAnchor();
    setSelection({ start: startIndex, end: endIndex });
    setErrorMessage(null);
  }, [
    rangeEndInput,
    rangeStartInput,
    resetSelectionAnchor,
    timeUnit,
    waveform.pulses,
    waveform.totalUs,
  ]);

  const useWholeSignal = useCallback(() => {
    resetSelectionAnchor();
    setSelection(null);
    setErrorMessage(null);
  }, [resetSelectionAnchor]);

  const replaySelection = useCallback(async () => {
    if (!device || captureId === null || waveform.pulses.length === 0) {
      setStatus("error");
      setErrorMessage("Sync or capture this waveform on the bridge before replaying it.");
      return;
    }

    const range = normalizedSelection ?? { start: 0, end: waveform.pulses.length - 1 };
    setStatus("replaying");
    setErrorMessage(null);
    await sendDataToDevice(
      "raw,replay," + captureId + "," + range.start + "," + range.end
    );
  }, [captureId, device, normalizedSelection, sendDataToDevice, waveform.pulses.length]);

  const uploadWaveform = useCallback(async () => {
    if (!device || pulses.length === 0) {
      setStatus("error");
      setErrorMessage("Choose a saved waveform and connect to the bridge first.");
      return;
    }

    clearUploadTimeout();
    rawModeActiveRef.current = true;
    setCaptureId(null);
    setStatus("uploading");
    setUploadProgress(0);
    setErrorMessage(null);

    try {
      await sendDataToDevice("raw,u,s," + frequencyFlag + "," + pulses.length);
      for (let index = 0; index < pulses.length; index += 1) {
        const pulse = pulses[index];
        await sendDataToDevice(
          "raw,u," + index + "," + pulse.level + "," + Math.round(pulse.duration)
        );
        setUploadProgress(index + 1);
      }
      await sendDataToDevice("raw,u,e");

      uploadTimeoutRef.current = setTimeout(() => {
        setStatus((currentStatus) => {
          if (currentStatus === "uploading") {
            setErrorMessage(
              "The bridge did not confirm the waveform upload. Flash the matching firmware and try again."
            );
            return "error";
          }
          return currentStatus;
        });
      }, 8_000);
    } catch (error) {
      setStatus("error");
      setUploadProgress(null);
      setErrorMessage("Could not upload this waveform: " + (error instanceof Error ? error.message : "unknown error"));
    }
  }, [clearUploadTimeout, device, frequencyFlag, pulses, sendDataToDevice]);

  const openSaveDialog = useCallback(() => {
    if (pulses.length === 0) return;
    setSaveName("Waveform " + frequencyLabel(frequencyFlag));
    setSaveDialogVisible(true);
  }, [frequencyFlag, pulses.length]);

  const saveWaveform = useCallback(async () => {
    if (pulses.length === 0) return;

    const name = saveName.trim() || "Waveform " + frequencyLabel(frequencyFlag);
    const nextWaveform: SavedWaveform = {
      createdAt: new Date().toISOString(),
      frequencyFlag,
      id: Date.now().toString() + "-" + Math.random().toString(36).slice(2, 8),
      name,
      pulses,
      selection: normalizedSelection,
    };

    await persistSavedWaveforms([nextWaveform, ...savedWaveforms].slice(0, MAX_SAVED_WAVEFORMS));
    setSaveDialogVisible(false);
    setSaveName("");
  }, [frequencyFlag, normalizedSelection, persistSavedWaveforms, pulses, saveName, savedWaveforms]);

  const loadWaveform = useCallback(
    (savedWaveform: SavedWaveform) => {
      clearUploadTimeout();
      pendingCaptureRef.current = null;
      resetSelectionAnchor();
      setFrequencyFlag(savedWaveform.frequencyFlag);
      setPulses(savedWaveform.pulses);
      setSelection(normalizeSelection(savedWaveform.selection, savedWaveform.pulses.length));
      setCaptureId(null);
      setLoadedWaveformId(savedWaveform.id);
      setUploadProgress(null);
      setStatus("loaded");
      setErrorMessage(null);
    },
    [clearUploadTimeout, resetSelectionAnchor]
  );

  const deleteWaveform = useCallback(
    (waveformToDelete: SavedWaveform) => {
      Alert.alert(
        "Delete saved waveform?",
        "Delete " + waveformToDelete.name + " from this phone?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void persistSavedWaveforms(
                savedWaveforms.filter((savedWaveform) => savedWaveform.id !== waveformToDelete.id)
              );
              if (loadedWaveformId === waveformToDelete.id) {
                setLoadedWaveformId(null);
              }
            },
          },
        ]
      );
    },
    [loadedWaveformId, persistSavedWaveforms, savedWaveforms]
  );

  const captureInProgress = status === "armed" || status === "receiving";
  const bridgeBusy = captureInProgress || status === "uploading" || status === "replaying";
  const canReplay = Boolean(device && captureId !== null && waveform.pulses.length > 0 && !bridgeBusy);
  const canUpload = Boolean(device && captureId === null && waveform.pulses.length > 0 && !bridgeBusy);
  const statusLabel =
    status === "armed"
      ? "Listening for one burst on " + frequencyLabel(frequencyFlag) + "…"
      : status === "receiving"
        ? "Receiving pulse timings…"
        : status === "uploading"
          ? "Syncing the waveform to the bridge…"
          : status === "replaying"
            ? "Replaying the selected timing range…"
            : status === "loaded"
              ? "Loaded locally. Sync it to the bridge before replaying."
              : status === "ready"
                ? "Ready to replay on " + frequencyLabel(frequencyFlag) + "."
                : device
                  ? "Choose a fixed carrier and capture one RF burst."
                  : "Connect to a BluePulse bridge to capture or replay.";

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <Card mode="contained">
          <Card.Title
            title="Raw signal lab"
            subtitle="Fixed-band capture, timing scope, and replay"
          />
          <Card.Content style={styles.cardContent}>
            <Text variant="bodySmall" style={styles.muted}>
              Raw mode locks the receiver to one carrier. It does not alternate between 315 and 433 MHz.
            </Text>

            <Text variant="labelLarge">Carrier frequency</Text>
            <SegmentedButtons
              value={String(frequencyFlag)}
              onValueChange={(value) => setFrequencyFlag(Number(value) as FrequencyFlag)}
              buttons={[
                { value: "1", label: "315 MHz", disabled: bridgeBusy || waveform.pulses.length > 0 },
                { value: "2", label: "433 MHz", disabled: bridgeBusy || waveform.pulses.length > 0 },
              ]}
            />

            <View style={styles.actionRow}>
              <Button
                disabled={!device || bridgeBusy}
                icon="radar"
                mode="contained"
                onPress={() => void startCapture()}
                style={styles.actionButton}
              >
                Capture burst
              </Button>
              {captureInProgress && (
                <Button
                  icon="stop"
                  mode="outlined"
                  onPress={() => void stopCapture()}
                  style={styles.actionButton}
                >
                  Stop
                </Button>
              )}
              {waveform.pulses.length > 0 && !captureInProgress && (
                <Button
                  disabled={bridgeBusy}
                  mode="text"
                  onPress={clearCurrentWaveform}
                  style={styles.actionButton}
                >
                  Clear waveform
                </Button>
              )}
            </View>

            {waveform.pulses.length > 0 && (
              <Text variant="bodySmall" style={styles.muted}>
                Save or clear the current waveform to change carrier frequency.
              </Text>
            )}

            <View
              style={[
                styles.statusNotice,
                {
                  backgroundColor:
                    status === "error" ? theme.colors.errorContainer : theme.colors.secondaryContainer,
                },
              ]}
            >
              <Text
                style={{
                  color: status === "error" ? theme.colors.onErrorContainer : theme.colors.onSecondaryContainer,
                }}
                variant="bodySmall"
              >
                {statusLabel}
              </Text>
              {status === "uploading" && uploadProgress !== null && (
                <Text
                  style={{ color: theme.colors.onSecondaryContainer }}
                  variant="labelSmall"
                >
                  {uploadProgress} / {pulses.length} pulse segments sent
                </Text>
              )}
            </View>

            {errorMessage && (
              <Text style={{ color: theme.colors.error }} variant="bodySmall">
                {errorMessage}
              </Text>
            )}
          </Card.Content>
        </Card>

        <Card mode="contained">
          <Card.Title
            title="Timeline and scope"
            subtitle={
              waveform.pulses.length === 0
                ? "Capture or load a waveform to inspect it."
                : formatDuration(waveform.totalUs) + " total · " + waveform.pulses.length + " pulse segments"
            }
          />
          <Card.Content style={styles.cardContent}>
            <View style={styles.graphHeading}>
              <View style={styles.graphHeadingText}>
                <Text variant="labelLarge">Pulse timeline</Text>
                {waveform.pulses.length > 0 && (
                  <Text variant="bodySmall" style={styles.muted}>
                    {normalizedSelection
                      ? "Scope: " +
                        formatTimeInUnit(activeRangeStartUs, timeUnit) +
                        " – " +
                        formatTimeInUnit(activeRangeEndUs, timeUnit) +
                        " · " +
                        formatDuration(activeRangeEndUs - activeRangeStartUs)
                      : "Whole signal is selected for replay."}
                  </Text>
                )}
              </View>
              <Button compact disabled={waveform.pulses.length === 0} icon="content-save-outline" onPress={openSaveDialog}>
                Save waveform
              </Button>
            </View>

            {waveform.pulses.length === 0 ? (
              <View
                style={[
                  styles.emptyGraph,
                  {
                    backgroundColor: theme.colors.surfaceVariant,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              >
                <Text style={{ color: theme.colors.onSurfaceVariant }} variant="bodySmall">
                  A captured burst will appear here as high and low pulse timings.
                </Text>
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={styles.timelineScrollContent}
                  style={[
                    styles.chartShell,
                    {
                      backgroundColor: theme.colors.surfaceVariant,
                      borderColor: theme.colors.outlineVariant,
                    },
                  ]}
                >
                  <View style={[styles.chartContent, { width: waveform.chartWidth }]}>
                    <View style={[styles.timelineRuler, { borderBottomColor: theme.colors.outlineVariant }]}>
                      {timelineTicks.map((tick) => {
                        const left = timeToPixel(tick, waveform);
                        return (
                          <View
                            key={tick}
                            pointerEvents="none"
                            style={[styles.timelineTick, { left }]}
                          >
                            <View style={[styles.tickLine, { backgroundColor: theme.colors.outline }]} />
                            <Text
                              numberOfLines={1}
                              style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}
                            >
                              {formatTimeInUnit(tick, timeUnit)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    <View style={styles.waveformArea}>
                      <View
                        pointerEvents="none"
                        style={[styles.waveformGuide, { top: 24, backgroundColor: theme.colors.outlineVariant }]}
                      />
                      <View
                        pointerEvents="none"
                        style={[styles.waveformGuide, { top: 62, backgroundColor: theme.colors.outlineVariant }]}
                      />
                      {waveform.pulses.map((segment) => (
                        <WaveformSegment
                          isSelected={
                            normalizedSelection !== null &&
                            segment.index >= normalizedSelection.start &&
                            segment.index <= normalizedSelection.end
                          }
                          key={segment.index}
                          onPress={selectPulse}
                          segment={segment}
                        />
                      ))}
                      {normalizedSelection && (
                        <>
                          <View
                            pointerEvents="none"
                            style={[
                              styles.selectionBoundary,
                              {
                                backgroundColor: theme.colors.primary,
                                left: timeToPixel(activeRangeStartUs, waveform),
                              },
                            ]}
                          />
                          <View
                            pointerEvents="none"
                            style={[
                              styles.selectionBoundary,
                              {
                                backgroundColor: theme.colors.primary,
                                left: timeToPixel(activeRangeEndUs, waveform),
                              },
                            ]}
                          />
                        </>
                      )}
                    </View>
                  </View>
                </ScrollView>

                <Text variant="bodySmall" style={styles.muted}>
                  High and low bars are individual edge-to-edge pulse segments. Tap a pulse once to set the scope
                  start, then tap another pulse to set its end.
                </Text>
                {selectionAnchor !== null && (
                  <Text style={{ color: theme.colors.primary }} variant="bodySmall">
                    Start pulse {selectionAnchor + 1} selected. Tap the final pulse, or apply a time range below.
                  </Text>
                )}

                <Text variant="labelLarge">Detail level</Text>
                <SegmentedButtons
                  value={String(zoomScale)}
                  onValueChange={(value) => setZoomScale(Number(value) as ZoomScale)}
                  buttons={[
                    { value: "200", label: "Overview" },
                    { value: "50", label: "Detail" },
                    { value: "10", label: "Fine" },
                  ]}
                />
              </>
            )}

            <Text variant="labelLarge">Scope by time</Text>
            <SegmentedButtons
              value={timeUnit}
              onValueChange={(value) => setTimeUnit(value as TimeUnit)}
              buttons={[
                { value: "us", label: "µs" },
                { value: "ms", label: "ms" },
                { value: "s", label: "seconds" },
              ]}
            />
            <View style={styles.rangeInputs}>
              <TextInput
                disabled={waveform.pulses.length === 0}
                keyboardType="decimal-pad"
                label={"Start (" + TIME_UNITS[timeUnit].label + ")"}
                mode="outlined"
                onChangeText={setRangeStartInput}
                style={styles.rangeField}
                value={rangeStartInput}
              />
              <TextInput
                disabled={waveform.pulses.length === 0}
                keyboardType="decimal-pad"
                label={"End (" + TIME_UNITS[timeUnit].label + ")"}
                mode="outlined"
                onChangeText={setRangeEndInput}
                style={styles.rangeField}
                value={rangeEndInput}
              />
            </View>
            <Text variant="bodySmall" style={styles.muted}>
              The range snaps outward to complete pulse segments, preserving the timing of the recorded signal.
            </Text>
            <View style={styles.actionRow}>
              <Button
                disabled={waveform.pulses.length === 0}
                icon="timeline-check-outline"
                mode="contained-tonal"
                onPress={applyTimelineRange}
                style={styles.actionButton}
              >
                Apply range
              </Button>
              <Button
                disabled={waveform.pulses.length === 0}
                mode="text"
                onPress={useWholeSignal}
                style={styles.actionButton}
              >
                Use whole signal
              </Button>
            </View>

            {waveform.pulses.length > 0 && (
              <>
                {captureId === null && (
                  <Text variant="bodySmall" style={styles.muted}>
                    This waveform is stored locally. Sync it to the bridge before replaying.
                  </Text>
                )}
                <View style={styles.actionRow}>
                  {captureId === null ? (
                    <Button
                      disabled={!canUpload}
                      icon="upload"
                      mode="contained"
                      onPress={() => void uploadWaveform()}
                      style={styles.actionButton}
                    >
                      Sync to bridge
                    </Button>
                  ) : (
                    <Button
                      disabled={!canReplay}
                      icon="play"
                      mode="contained"
                      onPress={() => void replaySelection()}
                      style={styles.actionButton}
                    >
                      Replay {normalizedSelection ? "scope" : "signal"}
                    </Button>
                  )}
                  <Button
                    icon="content-save-outline"
                    mode="outlined"
                    onPress={openSaveDialog}
                    style={styles.actionButton}
                  >
                    Save
                  </Button>
                </View>
              </>
            )}
          </Card.Content>
        </Card>

        <Card mode="contained">
          <Card.Title
            title="Saved waveforms"
            subtitle="Stored on this phone. Load one, then sync it to replay."
          />
          <Card.Content style={styles.cardContent}>
            {savedWaveforms.length === 0 ? (
              <Text variant="bodySmall" style={styles.muted}>
                Save a captured waveform to build a reusable local library.
              </Text>
            ) : (
              savedWaveforms.map((savedWaveform) => {
                const savedSelection = normalizeSelection(
                  savedWaveform.selection,
                  savedWaveform.pulses.length
                );
                const isLoaded = loadedWaveformId === savedWaveform.id;
                return (
                  <View
                    key={savedWaveform.id}
                    style={[
                      styles.savedWaveform,
                      {
                        backgroundColor: isLoaded ? theme.colors.secondaryContainer : theme.colors.surfaceVariant,
                        borderColor: isLoaded ? theme.colors.secondary : theme.colors.outlineVariant,
                      },
                    ]}
                  >
                    <View style={styles.savedWaveformInfo}>
                      <Text numberOfLines={1} variant="titleSmall">
                        {savedWaveform.name}
                      </Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        {frequencyLabel(savedWaveform.frequencyFlag)} · {savedWaveform.pulses.length} segments ·{" "}
                        {formatDuration(totalDuration(savedWaveform.pulses))}
                      </Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        {savedSelection
                          ? "Saved scope: " + (savedSelection.end - savedSelection.start + 1) + " segments"
                          : "Saved scope: whole waveform"}{" "}
                        · {savedDateLabel(savedWaveform.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.savedWaveformActions}>
                      <Button compact mode={isLoaded ? "contained-tonal" : "outlined"} onPress={() => loadWaveform(savedWaveform)}>
                        Load
                      </Button>
                      <Button
                        compact
                        onPress={() => deleteWaveform(savedWaveform)}
                        textColor={theme.colors.error}
                      >
                        Delete
                      </Button>
                    </View>
                  </View>
                );
              })
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      <Portal>
        <Dialog visible={saveDialogVisible} onDismiss={() => setSaveDialogVisible(false)}>
          <Dialog.Title>Save waveform</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Save the full pulse timing, selected scope, and {frequencyLabel(frequencyFlag)} carrier.
            </Text>
            <TextInput
              autoFocus
              label="Waveform name"
              mode="outlined"
              onChangeText={setSaveName}
              style={styles.saveNameInput}
              value={saveName}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSaveDialogVisible(false)}>Cancel</Button>
            <Button mode="contained" onPress={() => void saveWaveform()}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    flex: 1,
    minWidth: 140,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cardContent: {
    gap: 12,
  },
  chartContent: {
    height: 128,
  },
  chartShell: {
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 128,
    minHeight: 128,
  },
  container: {
    gap: 12,
    padding: 12,
    paddingBottom: 112,
  },
  emptyGraph: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 128,
    padding: 20,
  },
  graphHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  graphHeadingText: {
    flex: 1,
    gap: 2,
  },
  muted: {
    opacity: 0.72,
  },
  pulseHigh: {
    backgroundColor: "#2e7d32",
    borderColor: "#1b5e20",
  },
  pulseLow: {
    backgroundColor: "#1565c0",
    borderColor: "#0d47a1",
  },
  pulseSegment: {
    borderRadius: 2,
    borderWidth: 1,
    height: 26,
    position: "absolute",
  },
  pulseSelected: {
    borderColor: "#ffb300",
    borderWidth: 2,
    opacity: 1,
  },
  rangeField: {
    flex: 1,
    minWidth: 132,
  },
  rangeInputs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  saveNameInput: {
    marginTop: 12,
  },
  savedWaveform: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  savedWaveformActions: {
    flexDirection: "row",
    gap: 4,
  },
  savedWaveformInfo: {
    gap: 2,
  },
  selectionBoundary: {
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 2,
    zIndex: 2,
  },
  statusNotice: {
    borderRadius: 10,
    gap: 2,
    padding: 10,
  },
  tickLine: {
    height: 8,
    width: 1,
  },
  timelineRuler: {
    borderBottomWidth: 1,
    height: 38,
    position: "relative",
  },
  timelineScrollContent: {
    minWidth: "100%",
  },
  timelineTick: {
    alignItems: "center",
    marginLeft: -30,
    top: 4,
    width: 60,
    position: "absolute",
  },
  waveformArea: {
    height: 90,
    position: "relative",
  },
  waveformGuide: {
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
