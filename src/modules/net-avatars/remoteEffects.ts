import * as THREE from 'three';
import type { DamageType, TacticalPingType, Vec3 } from '../../contracts/types';
import { clamp, DAMAGE_TYPE_COLORS } from '../../core/Constants';
import { sanitizeVec3 } from './interpolation';

export interface TacticalPingTheme {
  label: string;
  shortTag: string;
  hex: number;
  accentHex: number;
  cssColor: string;
  cssGlow: string;
}

export const TACTICAL_PING_THEMES: Record<TacticalPingType, TacticalPingTheme> = {
  attack: {
    label: 'ATTACK',
    shortTag: 'ATK',
    hex: 0xff3b3b,
    accentHex: 0xff922b,
    cssColor: '#ff4d4d',
    cssGlow: 'rgba(255, 59, 59, 0.72)',
  },
  loot: {
    label: 'LOOT',
    shortTag: 'LOOT',
    hex: 0xffb830,
    accentHex: 0xfff3bf,
    cssColor: '#ffd43b',
    cssGlow: 'rgba(255, 184, 48, 0.75)',
  },
  danger: {
    label: 'DANGER',
    shortTag: 'WARN',
    hex: 0xff6b1a,
    accentHex: 0xffec99,
    cssColor: '#ff7b29',
    cssGlow: 'rgba(255, 107, 26, 0.78)',
  },
  group: {
    label: 'GROUP UP',
    shortTag: 'RALLY',
    hex: 0x3bc9db,
    accentHex: 0x63e6be,
    cssColor: '#38d9a9',
    cssGlow: 'rgba(59, 201, 219, 0.72)',
  },
};

export interface ActiveTacticalPing {
  id: string;
  peerId: string;
  senderName: string;
  pingType: TacticalPingType;
  position: Vec3;
  elapsedSec: number;
  durationSec: number;
  group: THREE.Group;
  pillarMat: THREE.MeshBasicMaterial;
  corePillarMat: THREE.MeshBasicMaterial;
  crestMesh: THREE.Object3D;
  crestMat: THREE.MeshStandardMaterial;
  baseDiscMat: THREE.MeshBasicMaterial;
  radarRings: Array<{
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    phaseOffset: number;
  }>;
}

interface TransientSkillBurst {
  group: THREE.Group;
  elapsedSec: number;
  durationSec: number;
  slashMesh: THREE.Mesh;
  slashMat: THREE.MeshBasicMaterial;
  novaRingMesh: THREE.Mesh;
  novaRingMat: THREE.MeshBasicMaterial;
  novaSphereMesh: THREE.Mesh;
  novaSphereMat: THREE.MeshBasicMaterial;
  projectileGroup: THREE.Group | null;
  projectileMat: THREE.MeshBasicMaterial | null;
  startPos: Vec3;
  endPos: Vec3;
  hasTravel: boolean;
}

const MAX_ACTIVE_PINGS = 16;
const MAX_SKILL_BURSTS = 32;
export const TACTICAL_PING_DURATION_SEC = 5.5;

/**
 * Manages procedural 3D Remote Skill Slash Ribbons, Projectile/Nova Bursts,
 * Paired Clash Shockwaves, and 3D Tactical Ground Ping Pillars in THREE.Scene.
 */
export class RemoteEffectsController {
  private scene: THREE.Scene | null = null;
  private readonly effectsRoot: THREE.Group;

  private readonly activePings: ActiveTacticalPing[] = [];
  private readonly skillBursts: TransientSkillBurst[] = [];
  private pingSeq = 0;

  // Shared immutable geometries for low GC overhead at 120Hz
  private readonly slashArcGeo: THREE.RingGeometry;
  private readonly novaRingGeo: THREE.RingGeometry;
  private readonly novaSphereGeo: THREE.SphereGeometry;
  private readonly projCoreGeo: THREE.OctahedronGeometry;
  private readonly projTailGeo: THREE.ConeGeometry;

  private readonly pillarOuterGeo: THREE.CylinderGeometry;
  private readonly pillarInnerGeo: THREE.CylinderGeometry;
  private readonly radarRingGeo: THREE.RingGeometry;
  private readonly baseDiscGeo: THREE.CircleGeometry;
  private readonly attackCrestGeo: THREE.ConeGeometry;
  private readonly lootCrestGeo: THREE.OctahedronGeometry;
  private readonly dangerCrestGeo: THREE.OctahedronGeometry;
  private readonly groupCrestGeo: THREE.TorusGeometry;

  private disposed = false;

  constructor() {
    this.effectsRoot = new THREE.Group();
    this.effectsRoot.name = 'RemoteMultiplayerEffectsRoot';

    // Crescent weapon slash ribbon geometry (horizontal arc sweep)
    this.slashArcGeo = new THREE.RingGeometry(0.75, 1.48, 22, 1, -Math.PI * 0.42, Math.PI * 0.84);
    this.slashArcGeo.rotateX(-Math.PI / 2);

    this.novaRingGeo = new THREE.RingGeometry(0.42, 0.64, 28);
    this.novaRingGeo.rotateX(-Math.PI / 2);

    this.novaSphereGeo = new THREE.SphereGeometry(0.45, 14, 10);
    this.projCoreGeo = new THREE.OctahedronGeometry(0.2, 1);
    this.projTailGeo = new THREE.ConeGeometry(0.14, 0.72, 8);
    this.projTailGeo.rotateX(-Math.PI / 2);

    // Tactical ground ping beacon geometries
    this.pillarOuterGeo = new THREE.CylinderGeometry(0.22, 0.38, 5.2, 16, 1, true);
    this.pillarOuterGeo.translate(0, 2.6, 0);

    this.pillarInnerGeo = new THREE.CylinderGeometry(0.06, 0.11, 5.6, 12, 1, true);
    this.pillarInnerGeo.translate(0, 2.8, 0);

    this.radarRingGeo = new THREE.RingGeometry(0.46, 0.62, 32);
    this.radarRingGeo.rotateX(-Math.PI / 2);

    this.baseDiscGeo = new THREE.CircleGeometry(0.52, 24);
    this.baseDiscGeo.rotateX(-Math.PI / 2);

    this.attackCrestGeo = new THREE.ConeGeometry(0.28, 0.72, 4);
    this.attackCrestGeo.rotateX(Math.PI); // Downward-striking blade spearhead

    this.lootCrestGeo = new THREE.OctahedronGeometry(0.32, 0);
    this.dangerCrestGeo = new THREE.OctahedronGeometry(0.3, 1);
    this.groupCrestGeo = new THREE.TorusGeometry(0.3, 0.065, 10, 24);
  }

  public init(scene: THREE.Scene): void {
    if (this.disposed) return;
    if (this.scene && this.effectsRoot.parent === this.scene) {
      return;
    }
    if (this.effectsRoot.parent) {
      this.effectsRoot.parent.remove(this.effectsRoot);
    }
    this.scene = scene;
    scene.add(this.effectsRoot);
  }

  public getRootGroup(): THREE.Group {
    return this.effectsRoot;
  }

  public getActivePings(): readonly ActiveTacticalPing[] {
    return this.activePings;
  }

  public spawnSkillVisual(
    damageType: DamageType,
    origin: Vec3,
    facingDir: Vec3,
    targetPos?: Vec3,
  ): void {
    if (this.disposed || !this.scene) return;

    while (this.skillBursts.length >= MAX_SKILL_BURSTS) {
      const oldest = this.skillBursts.shift();
      if (oldest) this.disposeSkillBurst(oldest);
    }

    const safeOrigin = sanitizeVec3(origin);
    const rawFacing = sanitizeVec3(facingDir, { x: 0, y: 0, z: 1 });
    const fLen = Math.hypot(rawFacing.x, rawFacing.z);
    const normFacing: Vec3 =
      fLen > 1e-4
        ? { x: rawFacing.x / fLen, y: 0, z: rawFacing.z / fLen }
        : { x: 0, y: 0, z: 1 };

    const safeTarget: Vec3 = targetPos
      ? sanitizeVec3(targetPos, {
          x: safeOrigin.x + normFacing.x * 3.2,
          y: safeOrigin.y,
          z: safeOrigin.z + normFacing.z * 3.2,
        })
      : {
          x: safeOrigin.x + normFacing.x * 2.8,
          y: safeOrigin.y,
          z: safeOrigin.z + normFacing.z * 2.8,
        };

    const travelDist = Math.hypot(safeTarget.x - safeOrigin.x, safeTarget.z - safeOrigin.z);
    const hasTravel = Boolean(targetPos) || travelDist > 0.6;

    const colorHex = DAMAGE_TYPE_COLORS[damageType]?.hex ?? 0xf1e9d2;
    const yaw = Math.atan2(normFacing.x, normFacing.z);

    const group = new THREE.Group();
    group.name = `RemoteSkillVisual_${damageType}`;

    // 1. Curved Weapon Slash Ribbon at caster origin
    const slashMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const slashMesh = new THREE.Mesh(this.slashArcGeo, slashMat);
    slashMesh.position.set(safeOrigin.x, safeOrigin.y + 1.02, safeOrigin.z);
    slashMesh.rotation.y = yaw;
    slashMesh.rotation.z = 0.18;
    group.add(slashMesh);

    // 2. Elemental Nova Ring + Burst Sphere (at targetPos if ranged/targeted, else origin)
    const burstAnchor = targetPos ? safeTarget : safeOrigin;
    const novaRingMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const novaRingMesh = new THREE.Mesh(this.novaRingGeo, novaRingMat);
    novaRingMesh.position.set(burstAnchor.x, burstAnchor.y + 0.1, burstAnchor.z);
    group.add(novaRingMesh);

    const novaSphereMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const novaSphereMesh = new THREE.Mesh(this.novaSphereGeo, novaSphereMat);
    novaSphereMesh.position.set(burstAnchor.x, burstAnchor.y + 0.85, burstAnchor.z);
    group.add(novaSphereMesh);

    // 3. Streaking Elemental Projectile Bolt
    let projectileGroup: THREE.Group | null = null;
    let projectileMat: THREE.MeshBasicMaterial | null = null;
    if (hasTravel) {
      projectileMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      projectileGroup = new THREE.Group();
      const core = new THREE.Mesh(this.projCoreGeo, projectileMat);
      const tail = new THREE.Mesh(this.projTailGeo, projectileMat);
      tail.position.z = -0.38;
      projectileGroup.add(core, tail);
      projectileGroup.position.set(safeOrigin.x, safeOrigin.y + 1.05, safeOrigin.z);
      const projYaw = Math.atan2(safeTarget.x - safeOrigin.x, safeTarget.z - safeOrigin.z);
      projectileGroup.rotation.y = projYaw;
      group.add(projectileGroup);
    }

    this.effectsRoot.add(group);
    this.skillBursts.push({
      group,
      elapsedSec: 0,
      durationSec: 0.48,
      slashMesh,
      slashMat,
      novaRingMesh,
      novaRingMat,
      novaSphereMesh,
      novaSphereMat,
      projectileGroup,
      projectileMat,
      startPos: { x: safeOrigin.x, y: safeOrigin.y + 1.05, z: safeOrigin.z },
      endPos: { x: safeTarget.x, y: safeTarget.y + 0.95, z: safeTarget.z },
      hasTravel,
    });
  }

  public spawnPairedClashBurst(midpoint: Vec3): void {
    if (this.disposed || !this.scene) return;
    const safeMid = sanitizeVec3(midpoint);
    this.spawnSkillVisual('lightning', safeMid, { x: 0, y: 0, z: 1 }, safeMid);
  }

  public spawnEmojiSparkles3D(worldPos: Vec3, colorHex = 0xffd43b): void {
    if (this.disposed || !this.scene) return;
    const safePos = sanitizeVec3(worldPos);
    while (this.skillBursts.length >= MAX_SKILL_BURSTS) {
      const oldest = this.skillBursts.shift();
      if (oldest) this.disposeSkillBurst(oldest);
    }

    const group = new THREE.Group();
    group.name = 'RemoteEmojiSparkBurst';

    const slashMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const slashMesh = new THREE.Mesh(this.slashArcGeo, slashMat);
    slashMesh.position.set(safePos.x, safePos.y + 1.9, safePos.z);
    slashMesh.scale.setScalar(0.55);
    group.add(slashMesh);

    const novaRingMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const novaRingMesh = new THREE.Mesh(this.novaRingGeo, novaRingMat);
    novaRingMesh.position.set(safePos.x, safePos.y + 0.12, safePos.z);
    group.add(novaRingMesh);

    const novaSphereMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const novaSphereMesh = new THREE.Mesh(this.novaSphereGeo, novaSphereMat);
    novaSphereMesh.position.set(safePos.x, safePos.y + 2.0, safePos.z);
    novaSphereMesh.scale.setScalar(0.5);
    group.add(novaSphereMesh);

    this.effectsRoot.add(group);
    this.skillBursts.push({
      group,
      elapsedSec: 0,
      durationSec: 0.42,
      slashMesh,
      slashMat,
      novaRingMesh,
      novaRingMat,
      novaSphereMesh,
      novaSphereMat,
      projectileGroup: null,
      projectileMat: null,
      startPos: safePos,
      endPos: safePos,
      hasTravel: false,
    });
  }

  public spawnTacticalPing(
    peerId: string,
    senderName: string,
    pingType: TacticalPingType,
    position: Vec3,
  ): ActiveTacticalPing | null {
    if (this.disposed || !this.scene) return null;

    const validType: TacticalPingType =
      pingType === 'attack' || pingType === 'loot' || pingType === 'danger' || pingType === 'group'
        ? pingType
        : 'group';

    while (this.activePings.length >= MAX_ACTIVE_PINGS) {
      const oldest = this.activePings.shift();
      if (oldest) this.disposePing(oldest);
    }

    const theme = TACTICAL_PING_THEMES[validType];
    const safePos = sanitizeVec3(position);
    const id = `ping_${++this.pingSeq}_${peerId}`;

    const group = new THREE.Group();
    group.name = `TacticalPingPillar_${validType}`;
    group.position.set(safePos.x, safePos.y, safePos.z);

    // Outer translucent light pillar
    const pillarMat = new THREE.MeshBasicMaterial({
      color: theme.hex,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outerPillar = new THREE.Mesh(this.pillarOuterGeo, pillarMat);
    group.add(outerPillar);

    // Bright inner laser core beam
    const corePillarMat = new THREE.MeshBasicMaterial({
      color: theme.accentHex,
      transparent: true,
      opacity: 0.86,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const innerPillar = new THREE.Mesh(this.pillarInnerGeo, corePillarMat);
    group.add(innerPillar);

    // Ground anchor rune disc
    const baseDiscMat = new THREE.MeshBasicMaterial({
      color: theme.hex,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const baseDisc = new THREE.Mesh(this.baseDiscGeo, baseDiscMat);
    baseDisc.position.y = 0.04;
    group.add(baseDisc);

    // Floating 3D silhouette crest tailored to pingType
    const crestMat = new THREE.MeshStandardMaterial({
      color: theme.accentHex,
      emissive: theme.hex,
      emissiveIntensity: 1.35,
      roughness: 0.22,
      metalness: 0.55,
    });
    const crestGeo =
      validType === 'attack'
        ? this.attackCrestGeo
        : validType === 'loot'
          ? this.lootCrestGeo
          : validType === 'danger'
            ? this.dangerCrestGeo
            : this.groupCrestGeo;
    const crestMesh = new THREE.Mesh(crestGeo, crestMat);
    crestMesh.position.y = 2.65;
    group.add(crestMesh);

    // Dual staggered expanding ground radar rings
    const radarRings: ActiveTacticalPing['radarRings'] = [];
    for (let i = 0; i < 2; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: i === 0 ? theme.hex : theme.accentHex,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(this.radarRingGeo, ringMat);
      ringMesh.position.y = 0.05 + i * 0.01;
      group.add(ringMesh);
      radarRings.push({
        mesh: ringMesh,
        mat: ringMat,
        phaseOffset: i * 0.5,
      });
    }

    this.effectsRoot.add(group);

    const pingEntry: ActiveTacticalPing = {
      id,
      peerId,
      senderName: senderName || 'Ally',
      pingType: validType,
      position: safePos,
      elapsedSec: 0,
      durationSec: TACTICAL_PING_DURATION_SEC,
      group,
      pillarMat,
      corePillarMat,
      crestMesh,
      crestMat,
      baseDiscMat,
      radarRings,
    };

    this.activePings.push(pingEntry);
    return pingEntry;
  }

  public update(dt: number): void {
    if (this.disposed) return;
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;

    // 1. Update transient remote skill slash ribbons & projectile/nova bursts
    for (let i = this.skillBursts.length - 1; i >= 0; i--) {
      const b = this.skillBursts[i];
      b.elapsedSec += safeDt;
      const u = clamp(b.elapsedSec / b.durationSec, 0, 1);

      if (u >= 1) {
        this.disposeSkillBurst(b);
        this.skillBursts.splice(i, 1);
        continue;
      }

      const fade = 1 - u * u;
      const slashScale = 0.72 + u * 0.95;
      b.slashMesh.scale.setScalar(slashScale);
      b.slashMesh.rotation.y += safeDt * 5.2;
      b.slashMat.opacity = 0.92 * (1 - u);

      const novaScale = 0.45 + u * 2.85;
      b.novaRingMesh.scale.set(novaScale, 1, novaScale);
      b.novaRingMat.opacity = 0.85 * fade;

      const sphereScale = 0.4 + Math.sin(u * Math.PI) * 1.35;
      b.novaSphereMesh.scale.setScalar(sphereScale);
      b.novaSphereMat.opacity = 0.52 * (1 - u);

      if (b.projectileGroup && b.projectileMat && b.hasTravel) {
        const travelU = clamp(u * 1.45, 0, 1);
        b.projectileGroup.position.set(
          b.startPos.x + (b.endPos.x - b.startPos.x) * travelU,
          b.startPos.y + (b.endPos.y - b.startPos.y) * travelU,
          b.startPos.z + (b.endPos.z - b.startPos.z) * travelU,
        );
        b.projectileGroup.rotation.z += safeDt * 14.0;
        b.projectileMat.opacity = travelU < 1 ? 0.95 : 0.95 * (1 - u);
      }
    }

    // 2. Update 3D Tactical Ground Ping Pillars & expanding radar rings
    for (let i = this.activePings.length - 1; i >= 0; i--) {
      const p = this.activePings[i];
      p.elapsedSec += safeDt;
      const u = clamp(p.elapsedSec / p.durationSec, 0, 1);

      if (u >= 1) {
        this.disposePing(p);
        this.activePings.splice(i, 1);
        continue;
      }

      // Pop-in over first 0.14s, fade-out over final 0.75s
      const popIn = clamp(p.elapsedSec / 0.14, 0, 1);
      const fadeOut = p.durationSec - p.elapsedSec < 0.75
        ? clamp((p.durationSec - p.elapsedSec) / 0.75, 0, 1)
        : 1;
      const envelope = popIn * fadeOut;

      const strobeSpeed = p.pingType === 'danger' ? 11.0 : 5.5;
      const pulse = 0.85 + 0.15 * Math.sin(p.elapsedSec * strobeSpeed);

      p.pillarMat.opacity = 0.34 * envelope * pulse;
      p.corePillarMat.opacity = 0.88 * envelope * pulse;
      p.baseDiscMat.opacity = 0.52 * envelope * pulse;

      // Bob & spin floating 3D tactical crest
      p.crestMesh.position.y = 2.55 + Math.sin(p.elapsedSec * 4.2) * 0.2;
      p.crestMesh.rotation.y = p.elapsedSec * (p.pingType === 'danger' ? 3.8 : 2.2);
      if (p.pingType === 'group') {
        p.crestMesh.rotation.x = Math.sin(p.elapsedSec * 2.4) * 0.45;
      }
      p.crestMesh.scale.setScalar(envelope);

      // Dual expanding radar rings (1.35Hz sonar sweep)
      const radarRate = p.pingType === 'danger' ? 1.65 : 1.15;
      for (const ring of p.radarRings) {
        const cycle = (p.elapsedSec * radarRate + ring.phaseOffset) % 1;
        const ringRadiusScale = 0.55 + cycle * 3.15;
        ring.mesh.scale.set(ringRadiusScale, 1, ringRadiusScale);
        ring.mat.opacity = (1 - cycle) * 0.85 * envelope;
      }
    }
  }

  private disposeSkillBurst(burst: TransientSkillBurst): void {
    if (burst.group.parent) {
      burst.group.parent.remove(burst.group);
    }
    burst.group.clear();
    burst.slashMat.dispose();
    burst.novaRingMat.dispose();
    burst.novaSphereMat.dispose();
    burst.projectileMat?.dispose();
  }

  private disposePing(ping: ActiveTacticalPing): void {
    if (ping.group.parent) {
      ping.group.parent.remove(ping.group);
    }
    ping.group.clear();
    ping.pillarMat.dispose();
    ping.corePillarMat.dispose();
    ping.crestMat.dispose();
    ping.baseDiscMat.dispose();
    for (const r of ping.radarRings) {
      r.mat.dispose();
    }
  }

  public clearAll(): void {
    for (const burst of this.skillBursts) {
      this.disposeSkillBurst(burst);
    }
    this.skillBursts.length = 0;

    for (const ping of this.activePings) {
      this.disposePing(ping);
    }
    this.activePings.length = 0;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.clearAll();

    this.slashArcGeo.dispose();
    this.novaRingGeo.dispose();
    this.novaSphereGeo.dispose();
    this.projCoreGeo.dispose();
    this.projTailGeo.dispose();

    this.pillarOuterGeo.dispose();
    this.pillarInnerGeo.dispose();
    this.radarRingGeo.dispose();
    this.baseDiscGeo.dispose();
    this.attackCrestGeo.dispose();
    this.lootCrestGeo.dispose();
    this.dangerCrestGeo.dispose();
    this.groupCrestGeo.dispose();

    if (this.effectsRoot.parent) {
      this.effectsRoot.parent.remove(this.effectsRoot);
    }
    this.effectsRoot.clear();
    this.scene = null;
  }
}
