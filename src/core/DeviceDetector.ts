// DeviceDetector.ts — Detect device class, performance tier, and input type

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type PerformanceTier = 'low' | 'medium' | 'high' | 'ultra';

export interface PerformanceSettings {
  shadowMapSize: number;         // 0 = disabled
  maxParticles: number;
  drawDistance: number;          // meters
  targetFps: number;
  renderScale: number;           // 0.5 to 1.0
  maxEnemies: number;
  enablePostFX: boolean;
  antiAlias: boolean;
  aiUpdateInterval: number;      // seconds between AI ticks
  hudRefreshRate: number;        // fps for DOM updates
  geometryLOD: boolean;
  frustumCull: boolean;
  instancedMesh: boolean;
}

export interface DeviceProfile {
  deviceClass: DeviceClass;
  tier: PerformanceTier;
  isTouchPrimary: boolean;
  pixelRatio: number;
  maxTextureSize: number;
  screenWidth: number;
  screenHeight: number;
  recommendedSettings: PerformanceSettings;
}

const TIER_SETTINGS: Record<PerformanceTier, PerformanceSettings> = {
  low: {
    shadowMapSize: 0,
    maxParticles: 50,
    drawDistance: 20,
    targetFps: 30,
    renderScale: 0.6,
    maxEnemies: 8,
    enablePostFX: false,
    antiAlias: false,
    aiUpdateInterval: 0.5,
    hudRefreshRate: 20,
    geometryLOD: true,
    frustumCull: true,
    instancedMesh: true,
  },
  medium: {
    shadowMapSize: 512,
    maxParticles: 150,
    drawDistance: 35,
    targetFps: 60,
    renderScale: 0.8,
    maxEnemies: 16,
    enablePostFX: false,
    antiAlias: false,
    aiUpdateInterval: 0.3,
    hudRefreshRate: 30,
    geometryLOD: true,
    frustumCull: true,
    instancedMesh: true,
  },
  high: {
    shadowMapSize: 1024,
    maxParticles: 400,
    drawDistance: 60,
    targetFps: 60,
    renderScale: 1.0,
    maxEnemies: 30,
    enablePostFX: true,
    antiAlias: true,
    aiUpdateInterval: 0.2,
    hudRefreshRate: 60,
    geometryLOD: true,
    frustumCull: true,
    instancedMesh: true,
  },
  ultra: {
    shadowMapSize: 2048,
    maxParticles: 1000,
    drawDistance: 100,
    targetFps: 120,
    renderScale: 1.0,
    maxEnemies: 50,
    enablePostFX: true,
    antiAlias: true,
    aiUpdateInterval: 0.1,
    hudRefreshRate: 60,
    geometryLOD: false,
    frustumCull: true,
    instancedMesh: true,
  },
};

function getDeviceClass(width: number, height: number, hasTouch: boolean): DeviceClass {
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  if (!hasTouch) return 'desktop';
  if (maxDim <= 900 || minDim <= 450) return 'mobile';
  if (maxDim <= 1366 || minDim <= 1024) return 'tablet';
  return 'desktop';
}

function estimatePerformanceTier(deviceClass: DeviceClass, cores: number, memory: number): PerformanceTier {
  if (deviceClass === 'mobile') {
    if (cores >= 8 && memory >= 4) return 'medium';
    return 'low';
  }
  if (deviceClass === 'tablet') {
    if (cores >= 8 && memory >= 6) return 'medium';
    return 'low';
  }
  // Desktop
  if (cores >= 16 && memory >= 16) return 'ultra';
  if (cores >= 8 && memory >= 8) return 'high';
  if (cores >= 4 && memory >= 4) return 'medium';
  return 'low';
}

export function detectDevice(): DeviceProfile {
  const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  if (!isBrowser) {
    // SSR / Node.js fallback
    return {
      deviceClass: 'desktop',
      tier: 'medium',
      isTouchPrimary: false,
      pixelRatio: 1,
      maxTextureSize: 4096,
      screenWidth: 1920,
      screenHeight: 1080,
      recommendedSettings: TIER_SETTINGS.medium,
    };
  }

  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const width = window.screen.width;
  const height = window.screen.height;
  const deviceClass = getDeviceClass(width, height, hasTouch);
  const isTouchPrimary = hasTouch && deviceClass !== 'desktop';

  const cores = navigator.hardwareConcurrency ?? 2;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 2;

  let tier = estimatePerformanceTier(deviceClass, cores, memory);

  // Check for saved user preference
  try {
    const saved = localStorage.getItem('ar_quality_tier') as PerformanceTier | null;
    if (saved && TIER_SETTINGS[saved]) tier = saved;
  } catch {
    // ignore
  }

  const pixelRatio = Math.min(
    window.devicePixelRatio ?? 1,
    tier === 'low' ? 1 : tier === 'medium' ? 1.5 : 2
  );

  return {
    deviceClass,
    tier,
    isTouchPrimary,
    pixelRatio,
    maxTextureSize: 4096,
    screenWidth: width,
    screenHeight: height,
    recommendedSettings: TIER_SETTINGS[tier],
  };
}

export function saveQualityTier(tier: PerformanceTier): void {
  try { localStorage.setItem('ar_quality_tier', tier); } catch { /* ignore */ }
}

export function watchDeviceChanges(cb: (p: DeviceProfile) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb(detectDevice());
  window.addEventListener('resize', handler, { passive: true });
  window.addEventListener('orientationchange', handler, { passive: true });
  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
  };
}

export { TIER_SETTINGS };
