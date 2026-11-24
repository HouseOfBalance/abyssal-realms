import * as THREE from 'three';
import type { BiomeId, ILightingDirector, Vec3 } from '../../contracts/types';
import { BIOME_CONFIG, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  type BiomeLightingProfile,
  type EventAtmosphereMode,
  getBiomeLightingProfile,
  type ResolvedAtmosphereTarget,
  resolveEventAtmosphereTarget,
} from './biomeProfiles';
import { TorchPool } from './TorchPool';

const SHADOW_FRUSTUM_HALF_EXTENT = 26;
const SHADOW_CAMERA_NEAR = 1.0;
const SHADOW_CAMERA_FAR = 92.0;
const DEFAULT_SHADOW_MAP_SIZE = 2048;
const ATMOSPHERE_LERP_RATE = 4.2;

const VALID_EVENT_MODES = new Set<EventAtmosphereMode>([
  'none',
  'blood_moon',
  'darkness_escort',
  'awakening',
]);

interface ActiveFlashState {
  color: THREE.Color;
  peakIntensity: number;
  durationSec: number;
  elapsedSec: number;
  active: boolean;
}

export class LightingDirector implements ILightingDirector {
  private scene: THREE.Scene | null = null;
  private readonly rigGroup: THREE.Group;

  private readonly ambientLight: THREE.AmbientLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly heroLantern: THREE.PointLight;
  private readonly flashLight: THREE.PointLight;
  private readonly torchPool: TorchPool;

  private currentBiome: BiomeId = 'crypt';
  private currentProfile: BiomeLightingProfile;
  private eventMode: EventAtmosphereMode = 'none';
  private targetAtmo: ResolvedAtmosphereTarget;
  private atmoTransitionSettled = true;
  private elapsedSec = 0;

  private readonly playerPos: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private hasPlayerPos = false;

  // Orthonormal basis of the directional light view space for shimmer-free texel snapping
  private readonly dirOffset = new THREE.Vector3(-18, 34, 20);
  private readonly lightBasisX = new THREE.Vector3(1, 0, 0);
  private readonly lightBasisY = new THREE.Vector3(0, 1, 0);
  private readonly lightBasisZ = new THREE.Vector3(0, 0, 1);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchTarget = new THREE.Vector3();
  private readonly snappedTarget = new THREE.Vector3();

  // Live blended atmosphere colors & scalars (smoothly interpolated on event atmosphere changes)
  private readonly liveFogColor = new THREE.Color();
  private liveFogDensity = 0.022;
  private readonly liveAmbientColor = new THREE.Color();
  private liveAmbientIntensity = 3.1;
  private readonly baseHemiSky = new THREE.Color();
  private readonly baseHemiGround = new THREE.Color();
  private liveHemiIntensity = 1.4;
  private readonly baseDirColor = new THREE.Color();
  private liveDirIntensity = 2.45;
  private readonly heroWarmColor = new THREE.Color();
  private readonly heroHotColor = new THREE.Color();
  private liveHeroIntensity = 5.5;
  private liveHeroDistance = 15.5;

  // Target colors for allocation-free smoothing
  private readonly targetFogColor = new THREE.Color();
  private readonly targetAmbientColor = new THREE.Color();
  private readonly targetHemiSky = new THREE.Color();
  private readonly targetHemiGround = new THREE.Color();
  private readonly targetDirColor = new THREE.Color();
  private readonly targetHeroWarm = new THREE.Color();
  private readonly targetHeroHot = new THREE.Color();
  private readonly scratchColor = new THREE.Color();

  private readonly flashState: ActiveFlashState = {
    color: new THREE.Color(0xffffff),
    peakIntensity: 0,
    durationSec: 0.3,
    elapsedSec: 0,
    active: false,
  };

  private unsubscribers: Array<() => void> = [];

  constructor() {
    this.currentProfile = getBiomeLightingProfile('crypt');
    this.targetAtmo = resolveEventAtmosphereTarget(this.currentProfile, 'none');

    this.rigGroup = new THREE.Group();
    this.rigGroup.name = 'LightingDirectorRig';

    this.ambientLight = new THREE.AmbientLight(
      this.currentProfile.ambientColorHex,
      this.currentProfile.ambientIntensity,
    );
    this.ambientLight.name = 'BiomeAmbientLight';

    this.hemiLight = new THREE.HemisphereLight(
      this.currentProfile.hemiSkyHex,
      this.currentProfile.hemiGroundHex,
      this.currentProfile.hemiIntensity,
    );
    this.hemiLight.name = 'AtmosphereHemisphereLight';
    this.hemiLight.position.set(0, 40, 0);

    this.dirLight = new THREE.DirectionalLight(
      this.currentProfile.dirColorHex,
      this.currentProfile.dirIntensity,
    );
    this.dirLight.name = 'MoonSkylightDirectional';
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(DEFAULT_SHADOW_MAP_SIZE, DEFAULT_SHADOW_MAP_SIZE);
    this.dirLight.shadow.camera.left = -SHADOW_FRUSTUM_HALF_EXTENT;
    this.dirLight.shadow.camera.right = SHADOW_FRUSTUM_HALF_EXTENT;
    this.dirLight.shadow.camera.top = SHADOW_FRUSTUM_HALF_EXTENT;
    this.dirLight.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF_EXTENT;
    this.dirLight.shadow.camera.near = SHADOW_CAMERA_NEAR;
    this.dirLight.shadow.camera.far = SHADOW_CAMERA_FAR;
    this.dirLight.shadow.bias = -0.00045;
    this.dirLight.shadow.normalBias = 0.022;
    this.dirLight.shadow.radius = 2.0;
    this.dirLight.shadow.camera.updateProjectionMatrix();

    this.heroLantern = new THREE.PointLight(
      this.currentProfile.heroLanternHex,
      this.currentProfile.heroLanternIntensity,
      this.currentProfile.heroLanternDistance,
      this.currentProfile.heroLanternDecay,
    );
    this.heroLantern.name = 'HeroLanternPointLight';
    this.heroLantern.castShadow = false;
    this.heroLantern.visible = true;
    this.heroLantern.position.set(0, 2.35, 0);

    // Kept permanently visible at intensity 0 when idle so Three.js NUM_POINT_LIGHTS stays constant
    this.flashLight = new THREE.PointLight(0xffffff, 0, 48, 1.15);
    this.flashLight.name = 'EventFlashPointLight';
    this.flashLight.castShadow = false;
    this.flashLight.visible = true;
    this.flashLight.position.set(0, 7.5, 0);

    this.rigGroup.add(
      this.ambientLight,
      this.hemiLight,
      this.dirLight,
      this.dirLight.target,
      this.heroLantern,
      this.flashLight,
    );

    this.torchPool = new TorchPool(this.rigGroup);

    this.snapProfileImmediately(this.currentProfile);
    this.snapDirectionalLightToPlayer(this.playerPos);
    this.ensureSubscriptions();
  }

  init(scene: THREE.Scene): void {
    if (this.scene && this.scene !== scene) {
      this.scene.remove(this.rigGroup);
    }
    this.scene = scene;
    if (this.rigGroup.parent !== scene) {
      scene.add(this.rigGroup);
    }

    this.ensureSubscriptions();
    this.syncLiveFogToScene();
    this.snapDirectionalLightToPlayer(this.playerPos);
  }

  applyBiome(biome: BiomeId, torchPositions: Vec3[]): void {
    const safeBiome: BiomeId = BIOME_CONFIG[biome] ? biome : 'crypt';
    this.currentBiome = safeBiome;
    this.currentProfile = getBiomeLightingProfile(safeBiome);
    this.eventMode = 'none';

    this.snapProfileImmediately(this.currentProfile);
    this.syncLiveFogToScene();

    const safeTorches = Array.isArray(torchPositions) ? torchPositions : [];
    this.torchPool.configureBiome(this.currentProfile, safeTorches);

    // If playerPos hasn't been supplied via update() yet, seed around the first torch
    // so immediate post-applyBiome inspections already activate the closest torch pool slots.
    const refPos: Vec3 = this.hasPlayerPos
      ? this.playerPos
      : safeTorches.length > 0 &&
          Number.isFinite(safeTorches[0].x) &&
          Number.isFinite(safeTorches[0].z)
        ? safeTorches[0]
        : this.playerPos;

    this.snapDirectionalLightToPlayer(refPos);
    this.torchPool.update(0, this.elapsedSec, refPos);
  }

  setEventAtmosphere(mode: EventAtmosphereMode): void {
    const safeMode: EventAtmosphereMode = VALID_EVENT_MODES.has(mode) ? mode : 'none';
    if (safeMode === this.eventMode) return;

    this.eventMode = safeMode;
    this.refreshTargetAtmosphere();
    this.atmoTransitionSettled = false;

    // Apply an immediate responsive onset step (22%) so callers & visuals feel instant,
    // then glide smoothly across remaining frames in update(dt, playerPos).
    this.stepAtmosphereBlend(0.22);
  }

  getEventAtmosphere(): EventAtmosphereMode {
    return this.eventMode;
  }

  triggerFlash(colorHex: number, intensity: number, durationSec: number): void {
    if (!Number.isFinite(intensity) || !Number.isFinite(durationSec)) return;
    if (intensity <= 0 || durationSec <= 0) return;

    const safeHex = Number.isFinite(colorHex) ? Math.floor(colorHex) & 0xffffff : 0xffffff;
    const clampedIntensity = clamp(intensity, 0.05, 25);
    const clampedDuration = clamp(durationSec, 0.02, 10);

    this.flashState.color.setHex(safeHex);
    this.flashState.peakIntensity = clampedIntensity;
    this.flashState.durationSec = clampedDuration;
    this.flashState.elapsedSec = 0;
    this.flashState.active = true;

    this.applyFlashEnvelope(1);
  }

  update(dt: number, playerPos: Vec3): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    this.elapsedSec += safeDt;

    if (
      playerPos &&
      Number.isFinite(playerPos.x) &&
      Number.isFinite(playerPos.y) &&
      Number.isFinite(playerPos.z)
    ) {
      this.playerPos.set(playerPos.x, playerPos.y, playerPos.z);
      this.hasPlayerPos = true;
    }

    // 1. Smoothly blend event atmosphere overrides (blood_moon, darkness_escort, awakening, none)
    if (!this.atmoTransitionSettled && safeDt > 0) {
      const alpha = 1 - Math.exp(-ATMOSPHERE_LERP_RATE * safeDt);
      this.stepAtmosphereBlend(alpha);
    } else if (this.eventMode !== 'none') {
      this.applyEventAtmospherePulse();
    }

    // 2. Update texel-snapped directional skylight shadow rig
    this.snapDirectionalLightToPlayer(this.playerPos);

    // 3. Update warm flickering hero lantern
    this.updateHeroLantern();

    // 4. Update pooled wall torches closest to the hero
    this.torchPool.update(safeDt, this.elapsedSec, this.playerPos);

    // 5. Advance & decay active lightning / boss / level-up / combat flash
    this.updateFlash(safeDt);
  }

  dispose(): void {
    for (let i = 0; i < this.unsubscribers.length; i++) {
      this.unsubscribers[i]();
    }
    this.unsubscribers = [];

    this.flashState.active = false;
    this.flashLight.intensity = 0;

    this.torchPool.dispose();

    this.dirLight.shadow.map?.dispose();
    this.dirLight.shadow.map = null;
    this.dirLight.dispose();
    this.hemiLight.dispose();
    this.ambientLight.dispose();
    this.heroLantern.dispose();
    this.flashLight.dispose();

    if (this.scene) {
      this.scene.remove(this.rigGroup);
      this.scene = null;
    }
  }

  private ensureSubscriptions(): void {
    if (this.unsubscribers.length > 0) return;

    this.unsubscribers.push(
      eventBus.on('lighting:flash', ({ colorHex, intensity, durationSec }) => {
        this.triggerFlash(colorHex, intensity, durationSec);
      }),
      eventBus.on('player:levelUp', () => {
        if (this.getCurrentFlashEnvelopeIntensity() < 3.0) {
          this.triggerFlash(0xffd466, 3.0, 0.55);
        }
      }),
      eventBus.on('boss:phaseChanged', ({ phase }) => {
        const phaseHex = phase === 3 ? 0xd05ce3 : 0xff3b3b;
        const phaseIntensity = phase === 3 ? 3.8 : 3.2;
        if (this.getCurrentFlashEnvelopeIntensity() < phaseIntensity) {
          this.triggerFlash(phaseHex, phaseIntensity, 0.65);
        }
      }),
      eventBus.on('boss:defeated', () => {
        if (this.getCurrentFlashEnvelopeIntensity() < 4.2) {
          this.triggerFlash(0xffe8a3, 4.2, 0.85);
        }
      }),
      eventBus.on('combat:parryTriggered', ({ counterSuccess }) => {
        const intensity = counterSuccess ? 2.6 : 1.3;
        if (this.getCurrentFlashEnvelopeIntensity() < intensity) {
          this.triggerFlash(0xffe066, intensity, 0.24);
        }
      }),
      eventBus.on('combat:executionStrike', () => {
        if (this.getCurrentFlashEnvelopeIntensity() < 3.5) {
          this.triggerFlash(0xffa94d, 3.5, 0.42);
        }
      }),
      eventBus.on('combat:elementalReaction', ({ reaction }) => {
        const colorMap: Record<typeof reaction, number> = {
          shatter: 0x74c0fc,
          volatile_blast: 0xff7b3b,
          superconduct: 0xffec99,
          abyssal_singularity: 0xda77f2,
        };
        const hex = colorMap[reaction] ?? 0xffffff;
        if (this.getCurrentFlashEnvelopeIntensity() < 2.4) {
          this.triggerFlash(hex, 2.4, 0.28);
        }
      }),
      eventBus.on('player:awakeningChanged', ({ active }) => {
        if (active && this.getCurrentFlashEnvelopeIntensity() < 3.6) {
          this.triggerFlash(0xffd97d, 3.6, 0.6);
        }
      }),
      eventBus.on('event:butcherInvasion', () => {
        if (this.getCurrentFlashEnvelopeIntensity() < 3.5) {
          this.triggerFlash(0xff1e2d, 3.5, 0.7);
        }
      }),
      eventBus.on('event:runewordForged', () => {
        if (this.getCurrentFlashEnvelopeIntensity() < 3.0) {
          this.triggerFlash(0xffc048, 3.0, 0.55);
        }
      }),
    );
  }

  private getCurrentFlashEnvelopeIntensity(): number {
    if (!this.flashState.active || this.flashState.durationSec <= 0) return 0;
    const progress = clamp(this.flashState.elapsedSec / this.flashState.durationSec, 0, 1);
    const envelope = (1 - progress) * (1 - progress);
    return this.flashState.peakIntensity * envelope;
  }

  private refreshTargetAtmosphere(): void {
    this.targetAtmo = resolveEventAtmosphereTarget(this.currentProfile, this.eventMode);
    this.targetFogColor.setHex(this.targetAtmo.fogColorHex);
    this.targetAmbientColor.setHex(this.targetAtmo.ambientColorHex);
    this.targetHemiSky.setHex(this.targetAtmo.hemiSkyHex);
    this.targetHemiGround.setHex(this.targetAtmo.hemiGroundHex);
    this.targetDirColor.setHex(this.targetAtmo.dirColorHex);
    this.targetHeroWarm.setHex(this.targetAtmo.heroLanternHex);
    this.targetHeroHot.setHex(this.targetAtmo.heroLanternHotHex);
  }

  private snapProfileImmediately(profile: BiomeLightingProfile): void {
    this.refreshTargetAtmosphere();

    this.liveFogColor.copy(this.targetFogColor);
    this.liveFogDensity = this.targetAtmo.fogDensity;

    this.liveAmbientColor.copy(this.targetAmbientColor);
    this.liveAmbientIntensity = this.targetAtmo.ambientIntensity;
    this.ambientLight.color.copy(this.liveAmbientColor);
    this.ambientLight.intensity = this.liveAmbientIntensity;

    this.baseHemiSky.copy(this.targetHemiSky);
    this.baseHemiGround.copy(this.targetHemiGround);
    this.liveHemiIntensity = this.targetAtmo.hemiIntensity;
    this.hemiLight.color.copy(this.baseHemiSky);
    this.hemiLight.groundColor.copy(this.baseHemiGround);
    this.hemiLight.intensity = this.liveHemiIntensity;

    this.baseDirColor.copy(this.targetDirColor);
    this.liveDirIntensity = this.targetAtmo.dirIntensity;
    this.dirLight.color.copy(this.baseDirColor);
    this.dirLight.intensity = this.liveDirIntensity;

    this.dirOffset.set(profile.dirOffset.x, profile.dirOffset.y, profile.dirOffset.z);
    this.recomputeLightBasis();

    this.heroWarmColor.copy(this.targetHeroWarm);
    this.heroHotColor.copy(this.targetHeroHot);
    this.liveHeroIntensity = this.targetAtmo.heroLanternIntensity;
    this.liveHeroDistance = this.targetAtmo.heroLanternDistance;
    this.heroLantern.color.copy(this.heroWarmColor);
    this.heroLantern.intensity = this.liveHeroIntensity;
    this.heroLantern.distance = this.liveHeroDistance;
    this.heroLantern.decay = profile.heroLanternDecay;

    this.atmoTransitionSettled = true;

    if (this.flashState.active) {
      const progress = clamp(this.flashState.elapsedSec / this.flashState.durationSec, 0, 1);
      this.applyFlashEnvelope((1 - progress) * (1 - progress));
    }
  }

  private stepAtmosphereBlend(alpha: number): void {
    const t = clamp(alpha, 0, 1);

    this.liveFogColor.lerp(this.targetFogColor, t);
    this.liveFogDensity += (this.targetAtmo.fogDensity - this.liveFogDensity) * t;

    this.liveAmbientColor.lerp(this.targetAmbientColor, t);
    this.liveAmbientIntensity += (this.targetAtmo.ambientIntensity - this.liveAmbientIntensity) * t;

    this.baseHemiSky.lerp(this.targetHemiSky, t);
    this.baseHemiGround.lerp(this.targetHemiGround, t);
    this.liveHemiIntensity += (this.targetAtmo.hemiIntensity - this.liveHemiIntensity) * t;

    this.baseDirColor.lerp(this.targetDirColor, t);
    this.liveDirIntensity += (this.targetAtmo.dirIntensity - this.liveDirIntensity) * t;

    this.heroWarmColor.lerp(this.targetHeroWarm, t);
    this.heroHotColor.lerp(this.targetHeroHot, t);
    this.liveHeroIntensity += (this.targetAtmo.heroLanternIntensity - this.liveHeroIntensity) * t;
    this.liveHeroDistance += (this.targetAtmo.heroLanternDistance - this.liveHeroDistance) * t;

    // Snap cleanly once converged so 'none' hits exact BIOME_CONFIG numbers
    const densityDiff = Math.abs(this.targetAtmo.fogDensity - this.liveFogDensity);
    const dirDiff = Math.abs(this.targetAtmo.dirIntensity - this.liveDirIntensity);
    const fogColorDiff =
      Math.abs(this.targetFogColor.r - this.liveFogColor.r) +
      Math.abs(this.targetFogColor.g - this.liveFogColor.g) +
      Math.abs(this.targetFogColor.b - this.liveFogColor.b);

    if (densityDiff < 1e-5 && dirDiff < 1e-4 && fogColorDiff < 1e-4) {
      this.liveFogColor.copy(this.targetFogColor);
      this.liveFogDensity = this.targetAtmo.fogDensity;
      this.liveAmbientColor.copy(this.targetAmbientColor);
      this.liveAmbientIntensity = this.targetAtmo.ambientIntensity;
      this.baseHemiSky.copy(this.targetHemiSky);
      this.baseHemiGround.copy(this.targetHemiGround);
      this.liveHemiIntensity = this.targetAtmo.hemiIntensity;
      this.baseDirColor.copy(this.targetDirColor);
      this.liveDirIntensity = this.targetAtmo.dirIntensity;
      this.heroWarmColor.copy(this.targetHeroWarm);
      this.heroHotColor.copy(this.targetHeroHot);
      this.liveHeroIntensity = this.targetAtmo.heroLanternIntensity;
      this.liveHeroDistance = this.targetAtmo.heroLanternDistance;
      this.atmoTransitionSettled = true;
    }

    this.ambientLight.color.copy(this.liveAmbientColor);
    this.ambientLight.intensity = this.liveAmbientIntensity;
    this.hemiLight.groundColor.copy(this.baseHemiGround);
    this.heroLantern.distance = this.liveHeroDistance;

    this.syncLiveFogToScene();

    if (this.flashState.active) {
      const progress = clamp(this.flashState.elapsedSec / this.flashState.durationSec, 0, 1);
      this.applyFlashEnvelope((1 - progress) * (1 - progress));
    } else {
      this.hemiLight.color.copy(this.baseHemiSky);
      this.hemiLight.intensity = this.liveHemiIntensity;
      this.dirLight.color.copy(this.baseDirColor);
      this.dirLight.intensity = this.liveDirIntensity;
    }

    if (this.eventMode !== 'none' && this.atmoTransitionSettled) {
      this.applyEventAtmospherePulse();
    }
  }

  private applyEventAtmospherePulse(): void {
    if (this.flashState.active) return;

    if (this.eventMode === 'blood_moon') {
      const pulse = 1 + Math.sin(this.elapsedSec * 2.2) * 0.08;
      this.dirLight.intensity = this.liveDirIntensity * pulse;
      this.hemiLight.intensity = this.liveHemiIntensity * (1 + Math.sin(this.elapsedSec * 1.6) * 0.06);
    } else if (this.eventMode === 'awakening') {
      const radiance = 1 + Math.sin(this.elapsedSec * 3.8) * 0.07;
      this.hemiLight.intensity = this.liveHemiIntensity * radiance;
      this.dirLight.intensity = this.liveDirIntensity * radiance;
    } else if (this.eventMode === 'darkness_escort') {
      const whisper = 1 + Math.sin(this.elapsedSec * 1.4) * 0.06;
      this.hemiLight.intensity = this.liveHemiIntensity * whisper;
    }
  }

  private syncLiveFogToScene(): void {
    if (!this.scene) return;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.liveFogColor);
      this.scene.fog.density = this.liveFogDensity;
    } else {
      const fog = new THREE.FogExp2(0x000000, this.liveFogDensity);
      fog.color.copy(this.liveFogColor);
      this.scene.fog = fog;
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.liveFogColor);
    } else if (this.scene.background === null) {
      this.scene.background = this.liveFogColor.clone();
    }
  }

  private recomputeLightBasis(): void {
    // Matches Three.js OrthographicCamera.lookAt(target) basis where eye - target === dirOffset
    this.lightBasisZ.copy(this.dirOffset).normalize();
    if (Math.abs(this.lightBasisZ.y) > 0.999) {
      this.lightBasisX.set(1, 0, 0);
    } else {
      this.lightBasisX.crossVectors(this.worldUp, this.lightBasisZ).normalize();
    }
    this.lightBasisY.crossVectors(this.lightBasisZ, this.lightBasisX).normalize();
  }

  private snapDirectionalLightToPlayer(pos: Vec3): void {
    const cam = this.dirLight.shadow.camera;
    const frustumWidth = cam.right - cam.left;
    const frustumHeight = cam.top - cam.bottom;

    const mapWidth = Math.max(1, this.dirLight.shadow.mapSize.x || DEFAULT_SHADOW_MAP_SIZE);
    const mapHeight = Math.max(1, this.dirLight.shadow.mapSize.y || DEFAULT_SHADOW_MAP_SIZE);

    const texelSizeX = frustumWidth / mapWidth;
    const texelSizeY = frustumHeight / mapHeight;

    // Anchor Y to ground plane so vertical hero motion doesn't swim shadow depth
    this.scratchTarget.set(pos.x, 0, pos.z);

    const projX = this.scratchTarget.dot(this.lightBasisX);
    const projY = this.scratchTarget.dot(this.lightBasisY);
    const projZ = this.scratchTarget.dot(this.lightBasisZ);

    const snappedX = Math.round(projX / texelSizeX) * texelSizeX;
    const snappedY = Math.round(projY / texelSizeY) * texelSizeY;
    const snappedZ = Math.round(projZ / texelSizeX) * texelSizeX;

    this.snappedTarget
      .set(0, 0, 0)
      .addScaledVector(this.lightBasisX, snappedX)
      .addScaledVector(this.lightBasisY, snappedY)
      .addScaledVector(this.lightBasisZ, snappedZ);

    this.dirLight.target.position.copy(this.snappedTarget);
    this.dirLight.position.copy(this.snappedTarget).add(this.dirOffset);
    this.dirLight.updateMatrixWorld();
    this.dirLight.target.updateMatrixWorld();
  }

  private updateHeroLantern(): void {
    const t = this.elapsedSec;
    const breath = Math.sin(t * 2.9) * 0.045;
    const flutter = Math.sin(t * 8.3 + 1.1) * Math.cos(t * 5.7 + 0.4) * 0.045;
    const microCrackle = Math.sin(t * 16.7 + 2.3) * 0.02;
    const delta = breath + flutter + microCrackle;

    const flickerFactor = clamp(1 + delta, 0.88, 1.14);
    this.heroLantern.intensity = this.liveHeroIntensity * flickerFactor;
    this.heroLantern.distance = this.liveHeroDistance;

    const warmthMix = clamp(0.45 + delta * 3.2, 0, 1);
    this.scratchColor.copy(this.heroWarmColor).lerp(this.heroHotColor, warmthMix);
    this.heroLantern.color.copy(this.scratchColor);

    const swayX = Math.sin(t * 3.4) * 0.05;
    const swayY = Math.sin(t * 5.1 + 0.8) * 0.035;
    const swayZ = Math.cos(t * 3.1 + 0.5) * 0.05;

    this.heroLantern.position.set(
      this.playerPos.x + swayX,
      this.playerPos.y + 2.35 + swayY,
      this.playerPos.z + swayZ,
    );
  }

  private updateFlash(dt: number): void {
    this.flashLight.position.set(
      this.playerPos.x,
      this.playerPos.y + 7.5,
      this.playerPos.z,
    );

    if (!this.flashState.active) return;

    this.flashState.elapsedSec += dt;
    if (this.flashState.elapsedSec >= this.flashState.durationSec) {
      this.flashState.active = false;
      this.flashState.elapsedSec = this.flashState.durationSec;
      this.applyFlashEnvelope(0);
      return;
    }

    const progress = clamp(this.flashState.elapsedSec / this.flashState.durationSec, 0, 1);
    // Sharp lightning attack with quadratic ease-out decay
    const envelope = (1 - progress) * (1 - progress);
    this.applyFlashEnvelope(envelope);
  }

  private applyFlashEnvelope(envelope: number): void {
    if (envelope <= 0.0001) {
      this.flashLight.intensity = 0;
      this.hemiLight.color.copy(this.baseHemiSky);
      this.hemiLight.intensity = this.liveHemiIntensity;
      this.dirLight.color.copy(this.baseDirColor);
      this.dirLight.intensity = this.liveDirIntensity;
      return;
    }

    const strength = this.flashState.peakIntensity * envelope;

    // Overhead burst PointLight scaled comfortably for PBR attenuation + ACES bloom
    this.flashLight.color.copy(this.flashState.color);
    this.flashLight.intensity = strength * 4.5;
    this.flashLight.position.set(
      this.playerPos.x,
      this.playerPos.y + 7.5,
      this.playerPos.z,
    );

    // Subtle global skylight & hemisphere surge so distant room pillars catch the flash
    const colorBlend = clamp(strength * 0.14, 0, 0.65);
    this.hemiLight.color.copy(this.baseHemiSky).lerp(this.flashState.color, colorBlend);
    this.hemiLight.intensity = this.liveHemiIntensity + strength * 0.45;

    this.dirLight.color.copy(this.baseDirColor).lerp(this.flashState.color, colorBlend * 0.85);
    this.dirLight.intensity = this.liveDirIntensity + strength * 0.7;
  }
}
