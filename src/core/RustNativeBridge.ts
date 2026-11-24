// RustNativeBridge.ts — TypeScript bridge to the compiled Android Rust Native Library (`libabyssal_realms.so`)

export interface AbyssalRustJniInterface {
  isRustNativeActive(): boolean;
  getEngineBanner(): string;
  getComputeDungeonHashHex(seed: number, floor: number): string;
  solveAStarHeuristic(
    cols: number,
    rows: number,
    startCol: number,
    startRow: number,
    goalCol: number,
    goalRow: number,
  ): number;
  compressPositionPacketHex(xMilli: number, yMilli: number, zMilli: number, yawMilli: number): string;
  getJniCallCount(): number;
  vibrate(durationMs: number): void;
  saveProfileNative(json: string): boolean;
  loadProfileNative(): string;
}

declare global {
  interface Window {
    AbyssalRust?: AbyssalRustJniInterface;
  }
}

export function getRustBridge(): AbyssalRustJniInterface | null {
  if (typeof window === 'undefined' || !window.AbyssalRust) {
    return null;
  }
  return window.AbyssalRust;
}

export function isRunningInRustApk(): boolean {
  const bridge = getRustBridge();
  if (!bridge) return false;
  try {
    return Boolean(bridge.isRustNativeActive());
  } catch {
    return false;
  }
}

export function getRustEngineBanner(): string | null {
  const bridge = getRustBridge();
  if (!bridge) return null;
  try {
    return bridge.getEngineBanner();
  } catch {
    return null;
  }
}

export function computeRustDungeonHash(seed: number, floor: number): string | null {
  const bridge = getRustBridge();
  if (!bridge) return null;
  try {
    return bridge.getComputeDungeonHashHex(seed | 0, floor | 0);
  } catch {
    return null;
  }
}

export function triggerRustHaptic(durationMs = 25): void {
  const bridge = getRustBridge();
  if (!bridge) return;
  try {
    bridge.vibrate(durationMs);
  } catch {
    // ignore
  }
}

export function syncSaveToRustNative(localStorageKey: string): void {
  const bridge = getRustBridge();
  if (!bridge || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(localStorageKey);
    if (raw) {
      bridge.saveProfileNative(raw);
    }
  } catch {
    // ignore
  }
}

export function restoreSaveFromRustNativeIfNeeded(localStorageKey: string): void {
  const bridge = getRustBridge();
  if (!bridge || typeof localStorage === 'undefined') return;
  try {
    if (!localStorage.getItem(localStorageKey)) {
      const nativeJson = bridge.loadProfileNative();
      if (nativeJson && nativeJson.trim().startsWith('{')) {
        localStorage.setItem(localStorageKey, nativeJson);
      }
    }
  } catch {
    // ignore
  }
}
