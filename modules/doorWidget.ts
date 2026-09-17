import { NativeModules, Platform } from "react-native";

export type DoorWidgetPreset = {
  backgroundPath: string | null;
  bridgeId: string;
  codeId: string;
  cornerRadius: number;
  frequency: string;
  id: string;
  label: string;
  mode: "single" | "burst";
};

type DoorWidgetNativeModule = {
  deletePreset(presetId: string): Promise<void>;
  getPresets(): Promise<DoorWidgetPreset[]>;
  requestPin(presetId: string): Promise<boolean>;
  savePreset(
    presetId: string,
    bridgeDeviceId: string,
    actionCodeId: string,
    actionLabel: string,
    actionCommand: string,
    actionFrequency: string,
    actionMode: "single" | "burst",
    backgroundUri: string | null,
    cornerRadius: number
  ): Promise<void>;
};

const nativeModule = NativeModules.BluePulseWidget as DoorWidgetNativeModule | undefined;

function requireNativeModule() {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("Home-screen widgets are available in the Android development build.");
  }
  return nativeModule;
}

export function isDoorWidgetAvailable() {
  return Platform.OS === "android" && Boolean(nativeModule);
}

export async function getDoorWidgetPresets(): Promise<DoorWidgetPreset[]> {
  if (!isDoorWidgetAvailable()) {
    return [];
  }
  return requireNativeModule().getPresets();
}

export async function saveDoorWidgetPreset(configuration: {
  action: { id: string; label: string; command: string; frequency: string; mode: "single" | "burst" };
  backgroundUri: string | null;
  bridgeDeviceId: string;
  cornerRadius: number;
  id: string;
}) {
  return requireNativeModule().savePreset(
    configuration.id,
    configuration.bridgeDeviceId,
    configuration.action.id,
    configuration.action.label,
    configuration.action.command,
    configuration.action.frequency,
    configuration.action.mode,
    configuration.backgroundUri,
    configuration.cornerRadius
  );
}

export async function deleteDoorWidgetPreset(presetId: string) {
  if (!isDoorWidgetAvailable()) return;
  return requireNativeModule().deletePreset(presetId);
}

export async function requestDoorWidgetPin(presetId: string) {
  return requireNativeModule().requestPin(presetId);
}
