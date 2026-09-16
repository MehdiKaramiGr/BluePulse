import AsyncStorage from "@react-native-async-storage/async-storage";

import { QuickAccessBurst, RfCode } from "./types";

export const STORAGE_KEY = "@rf_codes";
export const RF_LIBRARY_SETTINGS_KEY = "@rf_library_settings_v1";

export interface RfLibrarySettings {
  defaultRepeat: number;
}

export const DEFAULT_RF_LIBRARY_SETTINGS: RfLibrarySettings = {
  defaultRepeat: 1,
};

interface CodeBackup {
  codes: RfCode[];
  exportedAt: string;
  schema: "bluepulse-rf-codes";
  version: 1;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBurst(value: unknown): QuickAccessBurst | undefined {
  const burst = asRecord(value);
  if (!burst) return undefined;

  const iterations = positiveInteger(burst.iterations, 0);
  const gapMs = typeof burst.gapMs === "number" ? Math.round(burst.gapMs) : Number(burst.gapMs);
  if (!iterations || !Number.isInteger(gapMs) || gapMs < 0 || gapMs > 60_000) return undefined;

  return {
    iterations: Math.min(99, iterations),
    gapMs,
  };
}

export function createCodeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export function normalizeRfCode(value: unknown, index = 0): RfCode | null {
  const code = asRecord(value);
  if (!code || typeof code.Code !== "string" || !code.Code.trim()) return null;

  const frequency = Number(code.Freq);
  const protocol = positiveInteger(code.Protocol, 1);
  if (frequency !== 315 && frequency !== 433) return null;

  const now = new Date().toISOString();
  return {
    id: typeof code.id === "string" && code.id ? code.id : createCodeId(),
    Alias:
      typeof code.Alias === "string" && code.Alias.trim()
        ? code.Alias.trim()
        : "Code " + code.Code.trim().slice(-6),
    Code: code.Code.trim(),
    Freq: frequency,
    Protocol: protocol,
    SortId: Number.isInteger(code.SortId) ? Number(code.SortId) : index,
    Repeat: Math.min(99, positiveInteger(code.Repeat, 1)),
    Favorite: code.Favorite === true,
    Burst: normalizeBurst(code.Burst),
    Notes: typeof code.Notes === "string" ? code.Notes.trim() : undefined,
    createdAt: typeof code.createdAt === "string" ? code.createdAt : now,
    lastUsedAt: typeof code.lastUsedAt === "string" ? code.lastUsedAt : undefined,
    updatedAt: typeof code.updatedAt === "string" ? code.updatedAt : now,
  };
}

export function sortCodesByCustomOrder(codes: RfCode[]) {
  return [...codes].sort((first, second) => first.SortId - second.SortId);
}

export function reindexCodes(codes: RfCode[]) {
  const usedIds = new Set<string>();
  return codes.map((code, index) => {
    const id = code.id && !usedIds.has(code.id) ? code.id : createCodeId();
    usedIds.add(id);
    return { ...code, id, SortId: index };
  });
}

export function codeSignature(code: Pick<RfCode, "Alias" | "Code" | "Freq" | "Protocol">) {
  return [code.Code, code.Freq, code.Protocol, code.Alias.trim().toLowerCase()].join("|");
}

export function buildTransmitCommand(code: Pick<RfCode, "Code" | "Freq" | "Protocol" | "Repeat">) {
  return "c," + code.Code + "," + (code.Freq === 315 ? 1 : 2) + "," + code.Protocol + "," + code.Repeat;
}

export function buildQuickAccessCommand(
  code: Pick<RfCode, "Burst" | "Code" | "Freq" | "Protocol" | "Repeat">
) {
  if (!code.Burst) return buildTransmitCommand(code);

  return (
    "b," +
    code.Code +
    "," +
    (code.Freq === 315 ? 1 : 2) +
    "," +
    code.Protocol +
    "," +
    code.Burst.iterations +
    "," +
    code.Burst.gapMs +
    "," +
    code.Repeat
  );
}

export async function loadRfCodes() {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return reindexCodes(parsed.map(normalizeRfCode).filter((code): code is RfCode => code !== null));
  } catch {
    return [];
  }
}

export async function saveRfCodes(codes: RfCode[]) {
  const normalized = reindexCodes(codes);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function loadRfLibrarySettings() {
  const stored = await AsyncStorage.getItem(RF_LIBRARY_SETTINGS_KEY);
  if (!stored) return DEFAULT_RF_LIBRARY_SETTINGS;

  try {
    const parsed = asRecord(JSON.parse(stored));
    return {
      defaultRepeat: Math.min(99, positiveInteger(parsed?.defaultRepeat, DEFAULT_RF_LIBRARY_SETTINGS.defaultRepeat)),
    };
  } catch {
    return DEFAULT_RF_LIBRARY_SETTINGS;
  }
}

export async function saveRfLibrarySettings(settings: RfLibrarySettings) {
  const normalized = {
    defaultRepeat: Math.min(99, positiveInteger(settings.defaultRepeat, DEFAULT_RF_LIBRARY_SETTINGS.defaultRepeat)),
  };
  await AsyncStorage.setItem(RF_LIBRARY_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createCodeBackup(codes: RfCode[]): CodeBackup {
  return {
    schema: "bluepulse-rf-codes",
    version: 1,
    exportedAt: new Date().toISOString(),
    codes: reindexCodes(codes),
  };
}

export function parseImportedCodes(payload: string) {
  const parsed: unknown = JSON.parse(payload);
  const source = Array.isArray(parsed) ? parsed : asRecord(parsed)?.codes;
  if (!Array.isArray(source)) {
    throw new Error("Paste a BluePulse code backup or a JSON array of codes.");
  }

  const codes = source.map(normalizeRfCode).filter((code): code is RfCode => code !== null);
  if (codes.length === 0) {
    throw new Error("No valid RF codes were found in that import.");
  }
  return codes;
}

export function mergeImportedCodes(existing: RfCode[], incoming: RfCode[]) {
  const signatures = new Set(existing.map(codeSignature));
  const additions: RfCode[] = [];

  incoming.forEach((code) => {
    const signature = codeSignature(code);
    if (!signatures.has(signature)) {
      signatures.add(signature);
      additions.push({ ...code, id: createCodeId() });
    }
  });

  return reindexCodes([...existing, ...additions]);
}
