// types.ts (create this file if you don't have it)
export interface QuickAccessBurst {
  gapMs: number;
  iterations: number;
}

export interface RfCode {
  id: string;
  Code: string;
  Alias: string;
  Freq: number;
  Protocol: number;
  SortId: number;
  Repeat: number;
  Favorite: boolean;
  Burst?: QuickAccessBurst;
  Notes?: string;
  createdAt?: string;
  lastUsedAt?: string;
  updatedAt?: string;
}
