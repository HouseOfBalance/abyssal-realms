import * as THREE from 'three';
import type {
  ActiveStatusEffect,
  EliteAffix,
  EnemyAnimState,
  EnemyEntity,
  IEnemyMeshHandle,
  IMaterialLibrary,
  MaterialKey,
  TrainingDummyMetrics,
  Vec3,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';

export const TRAINING_DUMMY_ID = 'sanctuary_training_dummy';
export const TRAINING_DUMMY_MAX_HP = 10_000_000;
export const DUMMY_ROLLING_WINDOW_SEC = 5.0;

export interface SharedHubResourceTracker {
  getGeometry(key: string, factory: () => THREE.BufferGeometry): THREE.BufferGeometry;
  cloneMaterial(materials: IMaterialLibrary, key: MaterialKey): THREE.MeshStandardMaterial;
  trackMaterial<T extends THREE.Material>(mat: T): T;
}

interface DummyHitSample {
  amount: number;
  isCrit: boolean;
  timestampSec: number;
}

export class TrainingDummyDpsTracker {
  private simTimeSec = 0;
  private recentHits: DummyHitSample[] = [];
  private lastHitTimeSec: number | null = null;
  private peakHit = 0;
  private totalDamage = 0;
  private hitsCount = 0;

  recordHit(amount: number, isCrit: boolean): boolean {
    if (!Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    const cleanAmount = Math.round(amount * 100) / 100;
    this.recentHits.push({
      amount: cleanAmount,
      isCrit: Boolean(isCrit),
      timestampSec: this.simTimeSec,
    });
    this.lastHitTimeSec = this.simTimeSec;
    this.hitsCount += 1;
    this.totalDamage = Math.round((this.totalDamage + cleanAmount) * 100) / 100;
    if (cleanAmount > this.peakHit) {
      this.peakHit = cleanAmount;
    }
    this.pruneExpiredHits();
    return true;
  }

  advanceTime(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.simTimeSec += dt;
    this.pruneExpiredHits();
  }

  private pruneExpiredHits(): void {
    const cutoff = this.simTimeSec - DUMMY_ROLLING_WINDOW_SEC;
    // Hits strictly older than or equal to 5.0s idle drop out of the 5s rolling window
    while (
      this.recentHits.length > 0 &&
      this.simTimeSec - this.recentHits[0].timestampSec >= DUMMY_ROLLING_WINDOW_SEC
    ) {
      if (this.simTimeSec === this.recentHits[0].timestampSec) {
        break;
      }
      this.recentHits.shift();
    }
    void cutoff;
  }

  getMetrics(): TrainingDummyMetrics {
    this.pruneExpiredHits();
    const isIdleExpired =
      this.lastHitTimeSec === null ||
      (this.simTimeSec > this.lastHitTimeSec &&
        this.simTimeSec - this.lastHitTimeSec >= DUMMY_ROLLING_WINDOW_SEC);

    if (isIdleExpired || this.recentHits.length === 0) {
      return {
        active: false,
        rollingDps: 0,
        peakHit: this.peakHit,
        totalDamage: this.totalDamage,
        hitsCount: this.hitsCount,
      };
    }

    let windowSum = 0;
    for (let i = 0; i < this.recentHits.length; i++) {
      windowSum += this.recentHits[i].amount;
    }
    const rollingDps = Math.round((windowSum / DUMMY_ROLLING_WINDOW_SEC) * 10) / 10;

    return {
      active: true,
      rollingDps,
      peakHit: this.peakHit,
      totalDamage: this.totalDamage,
      hitsCount: this.hitsCount,
    };
  }

  reset(): void {
    this.recentHits.length = 0;
    this.lastHitTimeSec = null;
    this.peakHit = 0;
    this.totalDamage = 0;
    this.hitsCount = 0;
  }
}

export class TrainingDummyRig implements IEnemyMeshHandle {
  public readonly root: THREE.Group;
  public readonly tiltPivot: THREE.Group;
  public readonly spinPivot: THREE.Group;
  private readonly springCoils: THREE.Mesh[] = [];
  private readonly leftArmPivot: THREE.Group;
  private readonly rightArmPivot: THREE.Group;
  private readonly helmPivot: THREE.Group;
  private readonly flashMaterials: Array<{
    mat: THREE.MeshStandardMaterial;
    baseEmissiveHex: number;
    baseIntensity: number;
  }> = [];

  private tiltX = 0;
  private tiltZ = 0;
  private velTiltX = 0;
  private velTiltZ = 0;
  private spinYaw = 0;
  private spinVel = 0;
  private helmRecoilX = 0;
  private helmRecoilVel = 0;
  private armRattleAmp = 0;
  private armRattlePhase = 0;
  private flashTimerSec = 0;
  private flashDurationSec = 0.2;
  private flashColor = new THREE.Color(0xfff3bf);
  private strikeCounter = 0;
  private lastImpulseStampSec = -10;
  private internalClockSec = 0;

  constructor(
    position: Vec3,
    materials: IMaterialLibrary,
    tracker: SharedHubResourceTracker,
  ) {
    this.root = new THREE.Group();
    this.root.name = 'SanctuaryTrainingDummyRig';
    this.root.position.set(position.x, position.y, position.z);

    const woodMat = materials.get('wood_oak');
    const darkIronMat = materials.get('metal_dark_iron');
    const goldMat = materials.get('metal_gold');
    const brassMat = materials.get('brass_clockwork');

    const armorSteelMat = tracker.cloneMaterial(materials, 'metal_steel');
    const armorTrimMat = tracker.cloneMaterial(materials, 'metal_gold');
    const bullseyeMat = tracker.cloneMaterial(materials, 'rune_glow_crimson');
    bullseyeMat.emissive = new THREE.Color(0xff2038);
    bullseyeMat.emissiveIntensity = 1.15;

    const burlapMat = tracker.cloneMaterial(materials, 'wood_oak');
    burlapMat.color.offsetHSL(0.02, -0.08, 0.08);

    this.registerFlashMat(armorSteelMat, 0x000000, 0.0);
    this.registerFlashMat(armorTrimMat, 0x332000, 0.12);
    this.registerFlashMat(bullseyeMat, 0xff2038, 1.15);
    this.registerFlashMat(burlapMat, 0x000000, 0.0);

    // 1. Bolted Iron & Cross-Timber Ground Anchor Baseplate
    const stonePlinth = new THREE.Mesh(
      tracker.getGeometry('dummy_plinth', () => new THREE.CylinderGeometry(0.76, 0.88, 0.10, 12)),
      darkIronMat,
    );
    stonePlinth.position.set(0, 0.05, 0);
    stonePlinth.receiveShadow = true;
    stonePlinth.castShadow = true;
    this.root.add(stonePlinth);

    const crossBeamGeom = tracker.getGeometry(
      'dummy_crossbeam',
      () => new THREE.BoxGeometry(1.32, 0.10, 0.22),
    );
    for (const rotY of [0, Math.PI * 0.5]) {
      const beam = new THREE.Mesh(crossBeamGeom, woodMat);
      beam.position.set(0, 0.12, 0);
      beam.rotation.y = rotY;
      beam.castShadow = true;
      beam.receiveShadow = true;
      this.root.add(beam);
    }

    const boltGeom = tracker.getGeometry(
      'dummy_bolt',
      () => new THREE.CylinderGeometry(0.045, 0.045, 0.08, 6),
    );
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5;
      const bolt = new THREE.Mesh(boltGeom, brassMat);
      bolt.position.set(Math.cos(a) * 0.54, 0.18, Math.sin(a) * 0.54);
      this.root.add(bolt);
    }

    // 2. Visible Heavy Helical Iron Coil-Spring Base (y = 0.16 .. 0.42)
    const coilGeom = tracker.getGeometry(
      'dummy_spring_coil',
      () => new THREE.TorusGeometry(0.17, 0.036, 8, 18),
    );
    for (let c = 0; c < 4; c++) {
      const coil = new THREE.Mesh(coilGeom, darkIronMat);
      coil.rotation.x = Math.PI * 0.5 + 0.12;
      coil.position.set(0, 0.19 + c * 0.062, 0);
      coil.castShadow = true;
      this.root.add(coil);
      this.springCoils.push(coil);
    }

    // 3. Spring-Post Tilt Pivot (tilts violently on X/Z when struck!)
    this.tiltPivot = new THREE.Group();
    this.tiltPivot.name = 'DummySpringTiltPivot';
    this.tiltPivot.position.set(0, 0.40, 0);
    this.root.add(this.tiltPivot);

    // Central wooden spring-post rising through torso
    const oakPost = new THREE.Mesh(
      tracker.getGeometry('dummy_oak_post', () => new THREE.CylinderGeometry(0.11, 0.13, 1.55, 10)),
      woodMat,
    );
    oakPost.position.set(0, 0.66, 0);
    oakPost.castShadow = true;
    this.tiltPivot.add(oakPost);

    // Forged brass & iron bearing collar where torso spins around the post
    const bearingCollar = new THREE.Mesh(
      tracker.getGeometry('dummy_bearing', () => new THREE.CylinderGeometry(0.17, 0.19, 0.14, 12)),
      brassMat,
    );
    bearingCollar.position.set(0, 0.48, 0);
    this.tiltPivot.add(bearingCollar);

    // 4. Free-Spinning Armored Upper Body Pivot
    this.spinPivot = new THREE.Group();
    this.spinPivot.name = 'DummySpinTorsoPivot';
    this.spinPivot.position.set(0, 0.54, 0);
    this.tiltPivot.add(this.spinPivot);

    // Padded straw/burlap inner dummy barrel
    const burlapCore = new THREE.Mesh(
      tracker.getGeometry('dummy_burlap_core', () => new THREE.CylinderGeometry(0.30, 0.25, 0.72, 12)),
      burlapMat,
    );
    burlapCore.position.set(0, 0.36, 0);
    burlapCore.castShadow = true;
    burlapCore.receiveShadow = true;
    this.spinPivot.add(burlapCore);

    // Battered Steel Vanguard Cuirass & Tassets
    const cuirass = new THREE.Mesh(
      tracker.getGeometry('dummy_cuirass', () => new THREE.CylinderGeometry(0.35, 0.29, 0.54, 10)),
      armorSteelMat,
    );
    cuirass.position.set(0, 0.40, 0);
    cuirass.scale.set(1.08, 1.0, 0.88);
    cuirass.castShadow = true;
    this.spinPivot.add(cuirass);

    const chestGorget = new THREE.Mesh(
      tracker.getGeometry('dummy_gorget', () => new THREE.TorusGeometry(0.24, 0.045, 8, 14)),
      armorTrimMat,
    );
    chestGorget.rotation.x = Math.PI * 0.5;
    chestGorget.position.set(0, 0.67, 0);
    this.spinPivot.add(chestGorget);

    // Glowing Crimson Bullseye Target Crest on front chestplate (+Z)
    const targetOuterRing = new THREE.Mesh(
      tracker.getGeometry('dummy_target_ring', () => new THREE.TorusGeometry(0.14, 0.022, 6, 18)),
      bullseyeMat,
    );
    targetOuterRing.position.set(0, 0.43, 0.305);
    this.spinPivot.add(targetOuterRing);

    const targetCenter = new THREE.Mesh(
      tracker.getGeometry('dummy_target_dot', () => new THREE.CylinderGeometry(0.065, 0.065, 0.03, 12)),
      bullseyeMat,
    );
    targetCenter.rotation.x = Math.PI * 0.5;
    targetCenter.position.set(0, 0.43, 0.31);
    this.spinPivot.add(targetCenter);

    // Layered Steel Pauldrons
    const pauldronGeom = tracker.getGeometry(
      'dummy_pauldron',
      () => new THREE.SphereGeometry(0.20, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
    );
    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(pauldronGeom, armorSteelMat);
      pauldron.position.set(side * 0.40, 0.62, 0);
      pauldron.rotation.z = -side * 0.42;
      pauldron.castShadow = true;
      this.spinPivot.add(pauldron);
    }

    // 5. Articulated Wooden Spar Cross-Arms (Left = Iron Buckler, Right = Practice Cudgel)
    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.36, 0.56, 0);
    this.spinPivot.add(this.leftArmPivot);

    const sparArmGeom = tracker.getGeometry(
      'dummy_spar_arm',
      () => {
        const g = new THREE.CylinderGeometry(0.05, 0.055, 0.54, 8);
        g.rotateZ(Math.PI * 0.5);
        return g;
      },
    );

    const leftSpar = new THREE.Mesh(sparArmGeom, woodMat);
    leftSpar.position.set(-0.24, 0, 0);
    leftSpar.castShadow = true;
    this.leftArmPivot.add(leftSpar);

    const buckler = new THREE.Mesh(
      tracker.getGeometry('dummy_buckler', () => new THREE.CylinderGeometry(0.27, 0.24, 0.06, 12)),
      armorSteelMat,
    );
    buckler.rotation.z = Math.PI * 0.5;
    buckler.position.set(-0.50, 0, 0.06);
    buckler.castShadow = true;
    this.leftArmPivot.add(buckler);

    const bucklerBoss = new THREE.Mesh(
      tracker.getGeometry('dummy_buckler_boss', () => new THREE.SphereGeometry(0.09, 8, 6)),
      armorTrimMat,
    );
    bucklerBoss.position.set(-0.53, 0, 0.06);
    this.leftArmPivot.add(bucklerBoss);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.36, 0.56, 0);
    this.spinPivot.add(this.rightArmPivot);

    const rightSpar = new THREE.Mesh(sparArmGeom, woodMat);
    rightSpar.position.set(0.24, 0, 0);
    rightSpar.castShadow = true;
    this.rightArmPivot.add(rightSpar);

    const cudgelShaft = new THREE.Mesh(
      tracker.getGeometry('dummy_cudgel', () => new THREE.CylinderGeometry(0.055, 0.04, 0.58, 8)),
      woodMat,
    );
    cudgelShaft.position.set(0.48, 0.20, 0.08);
    cudgelShaft.rotation.x = 0.35;
    cudgelShaft.castShadow = true;
    this.rightArmPivot.add(cudgelShaft);

    const cudgelHead = new THREE.Mesh(
      tracker.getGeometry('dummy_cudgel_head', () => new THREE.DodecahedronGeometry(0.12, 0)),
      darkIronMat,
    );
    cudgelHead.position.set(0.48, 0.45, 0.17);
    cudgelHead.castShadow = true;
    this.rightArmPivot.add(cudgelHead);

    // 6. Articulated Visored Knight Greathelm with Plume
    this.helmPivot = new THREE.Group();
    this.helmPivot.position.set(0, 0.78, 0);
    this.spinPivot.add(this.helmPivot);

    const helmBucket = new THREE.Mesh(
      tracker.getGeometry('dummy_helm', () => new THREE.CylinderGeometry(0.20, 0.22, 0.34, 10)),
      armorSteelMat,
    );
    helmBucket.position.set(0, 0.17, 0);
    helmBucket.castShadow = true;
    this.helmPivot.add(helmBucket);

    const helmCrown = new THREE.Mesh(
      tracker.getGeometry(
        'dummy_helm_crown',
        () => new THREE.SphereGeometry(0.20, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      ),
      armorTrimMat,
    );
    helmCrown.position.set(0, 0.33, 0);
    this.helmPivot.add(helmCrown);

    const visorSlit = new THREE.Mesh(
      tracker.getGeometry('dummy_visor', () => new THREE.BoxGeometry(0.24, 0.045, 0.08)),
      bullseyeMat,
    );
    visorSlit.position.set(0, 0.20, 0.19);
    this.helmPivot.add(visorSlit);

    const crestPlume = new THREE.Mesh(
      tracker.getGeometry('dummy_plume', () => new THREE.BoxGeometry(0.06, 0.18, 0.28)),
      bullseyeMat,
    );
    crestPlume.position.set(0, 0.45, -0.04);
    crestPlume.rotation.x = -0.22;
    this.helmPivot.add(crestPlume);

    void goldMat;
  }

  private registerFlashMat(
    mat: THREE.MeshStandardMaterial,
    baseEmissiveHex: number,
    baseIntensity: number,
  ): void {
    this.flashMaterials.push({ mat, baseEmissiveHex, baseIntensity });
  }

  public triggerStrikeImpulse(
    amount: number,
    isCrit: boolean,
    attackerPos?: Vec3 | null,
    colorHex?: number,
  ): void {
    // Coalesce duplicate impulse triggers occurring in the exact same simulation tick
    if (this.internalClockSec - this.lastImpulseStampSec < 0.004 && amount <= 0) {
      return;
    }
    this.lastImpulseStampSec = this.internalClockSec;
    this.strikeCounter += 1;

    let dirX = 0;
    let dirZ = -1;
    if (
      attackerPos &&
      Number.isFinite(attackerPos.x) &&
      Number.isFinite(attackerPos.z)
    ) {
      const dx = this.root.position.x - attackerPos.x;
      const dz = this.root.position.z - attackerPos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        dirX = dx / len;
        dirZ = dz / len;
      }
    } else {
      const altAngle = this.strikeCounter * 2.15;
      dirX = Math.sin(altAngle);
      dirZ = -Math.cos(altAngle);
    }

    const normalizedPower = clamp(Math.log10(Math.max(10, amount + 10)) / 3.2, 0.45, 1.65);
    const critBoost = isCrit ? 1.55 : 1.0;
    const tiltImpulse = 6.8 * normalizedPower * critBoost;

    // Rotation around X tilts along +Z/-Z; rotation around Z tilts along -X/+X
    this.velTiltX += dirZ * tiltImpulse;
    this.velTiltZ += -dirX * tiltImpulse;

    // Immediate initial snap deflection so frame-0 / low-dt tests immediately observe tilt & spin
    this.tiltX = clamp(this.tiltX + dirZ * 0.16 * critBoost, -0.82, 0.82);
    this.tiltZ = clamp(this.tiltZ - dirX * 0.16 * critBoost, -0.82, 0.82);

    const spinSign = this.strikeCounter % 2 === 0 ? 1 : -1;
    const spinImpulse = (isCrit ? 16.5 : 9.2) * normalizedPower * spinSign;
    this.spinVel = clamp(this.spinVel + spinImpulse, -28, 28);
    this.spinYaw += spinSign * (isCrit ? 0.35 : 0.18);

    this.helmRecoilVel -= isCrit ? 9.5 : 4.5;
    this.armRattleAmp = Math.min(0.85, this.armRattleAmp + (isCrit ? 0.65 : 0.38));

    this.flashDurationSec = isCrit ? 0.24 : 0.16;
    this.flashTimerSec = this.flashDurationSec;
    this.flashColor.setHex(
      colorHex !== undefined ? colorHex : isCrit ? 0xfff3a1 : 0xff5a36,
    );

    this.applyRigTransforms();
    this.applyFlashVisuals();
  }

  public getMotionSnapshot(): {
    tiltMagnitudeRad: number;
    spinYawRad: number;
    spinVelocityRadSec: number;
    flashing: boolean;
  } {
    return {
      tiltMagnitudeRad: Math.hypot(this.tiltX, this.tiltZ),
      spinYawRad: this.spinYaw,
      spinVelocityRadSec: this.spinVel,
      flashing: this.flashTimerSec > 0,
    };
  }

  playAnim(state: EnemyAnimState, _speed?: number): void {
    if (state === 'hit' || state === 'death') {
      this.triggerStrikeImpulse(120, state === 'death');
    }
  }

  flashHit(colorHex?: number): void {
    this.triggerStrikeImpulse(100, colorHex === 0xffd43b, null, colorHex);
  }

  setEliteVisuals(_affixes: EliteAffix[]): void {
    // Training dummy never spawns elite affixes
  }

  update(dt: number): void {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (safeDt <= 0) return;

    this.internalClockSec += safeDt;

    // Sub-stepped 2D underdamped harmonic spring-post physics for crisp violent whip & wobble
    const subSteps = safeDt > 0.025 ? 2 : 1;
    const stepDt = safeDt / subSteps;
    const stiffness = 185.0;
    const damping = 5.8;

    for (let s = 0; s < subSteps; s++) {
      const accX = -stiffness * this.tiltX - damping * this.velTiltX;
      const accZ = -stiffness * this.tiltZ - damping * this.velTiltZ;
      this.velTiltX += accX * stepDt;
      this.velTiltZ += accZ * stepDt;
      this.tiltX = clamp(this.tiltX + this.velTiltX * stepDt, -0.85, 0.85);
      this.tiltZ = clamp(this.tiltZ + this.velTiltZ * stepDt, -0.85, 0.85);

      // Helm spring snap-back
      const accHelm = -210.0 * this.helmRecoilX - 9.5 * this.helmRecoilVel;
      this.helmRecoilVel += accHelm * stepDt;
      this.helmRecoilX = clamp(this.helmRecoilX + this.helmRecoilVel * stepDt, -0.65, 0.35);
    }

    // Rotational collar spin with bearing friction
    this.spinYaw += this.spinVel * safeDt;
    this.spinVel *= Math.exp(-3.2 * safeDt);
    if (Math.abs(this.spinVel) < 0.01) {
      this.spinVel = 0;
    }

    // Cross-arm clatter decay
    if (this.armRattleAmp > 0.002) {
      this.armRattlePhase += safeDt * 28.0;
      this.armRattleAmp *= Math.exp(-5.0 * safeDt);
    } else {
      this.armRattleAmp = 0;
    }

    // Hit flash decay
    if (this.flashTimerSec > 0) {
      this.flashTimerSec = Math.max(0, this.flashTimerSec - safeDt);
      this.applyFlashVisuals();
    }

    this.applyRigTransforms();
  }

  private applyRigTransforms(): void {
    this.tiltPivot.rotation.x = this.tiltX;
    this.tiltPivot.rotation.z = this.tiltZ;
    this.spinPivot.rotation.y = this.spinYaw;

    // Deform base coil-spring rings progressively from ground up toward the tilted post
    for (let i = 0; i < this.springCoils.length; i++) {
      const t = (i + 1) / this.springCoils.length;
      const coil = this.springCoils[i];
      coil.position.x = -Math.sin(this.tiltZ) * 0.22 * t;
      coil.position.z = Math.sin(this.tiltX) * 0.22 * t;
      coil.rotation.x = Math.PI * 0.5 + 0.12 + this.tiltX * 0.55 * t;
      coil.rotation.y = -this.tiltZ * 0.55 * t;
    }

    const rattle = Math.sin(this.armRattlePhase) * this.armRattleAmp;
    const centrifugalLift = Math.min(0.45, Math.abs(this.spinVel) * 0.022);
    this.leftArmPivot.rotation.z = -centrifugalLift + rattle * 0.45;
    this.leftArmPivot.rotation.y = rattle * 0.6;
    this.rightArmPivot.rotation.z = centrifugalLift - rattle * 0.45;
    this.rightArmPivot.rotation.y = -rattle * 0.6;

    this.helmPivot.rotation.x = this.helmRecoilX;
    this.helmPivot.rotation.z = rattle * 0.25;
  }

  private applyFlashVisuals(): void {
    const ratio =
      this.flashDurationSec > 0 ? clamp(this.flashTimerSec / this.flashDurationSec, 0, 1) : 0;
    for (let i = 0; i < this.flashMaterials.length; i++) {
      const entry = this.flashMaterials[i];
      if (ratio > 0) {
        entry.mat.emissive.setHex(entry.baseEmissiveHex).lerp(this.flashColor, ratio * 0.9);
        entry.mat.emissiveIntensity = entry.baseIntensity + ratio * 2.6;
      } else {
        entry.mat.emissive.setHex(entry.baseEmissiveHex);
        entry.mat.emissiveIntensity = entry.baseIntensity;
      }
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.root.clear();
  }
}

export function createImmortalTrainingDummyEntity(anchorPos: Vec3): EnemyEntity {
  let internalHp = TRAINING_DUMMY_MAX_HP;
  const fixedAnchor: Vec3 = { x: anchorPos.x, y: anchorPos.y, z: anchorPos.z };
  const livePosition: Vec3 = { x: anchorPos.x, y: anchorPos.y, z: anchorPos.z };
  const liveVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  const statuses: ActiveStatusEffect[] = [];

  const entity: EnemyEntity = {
    id: TRAINING_DUMMY_ID,
    name: 'Armored Training Dummy',
    archetype: 'clockwork_automaton',
    isBoss: false,
    isElite: false,
    affixes: [],
    position: livePosition,
    velocity: liveVelocity,
    rotationY: 0,
    radius: 0.75,
    hp: TRAINING_DUMMY_MAX_HP,
    maxHp: TRAINING_DUMMY_MAX_HP,
    armor: 0,
    moveSpeed: 0,
    attackDamage: 0,
    damageType: 'physical',
    attackRange: 0,
    attackCooldownSec: 999,
    xpReward: 0,
    lootTierBonus: 0,
    statuses,
    alive: true,
    roomId: 'sanctuary_south_courtyard',
    meshHandle: undefined,
  };

  // Enforce immortality so even massive single-hit bursts in CombatEngine never kill the dummy
  Object.defineProperties(entity, {
    hp: {
      get(): number {
        return internalHp;
      },
      set(nextHp: number): void {
        if (!Number.isFinite(nextHp) || nextHp <= 1) {
          internalHp = TRAINING_DUMMY_MAX_HP;
        } else {
          internalHp = Math.min(TRAINING_DUMMY_MAX_HP, nextHp);
        }
      },
      enumerable: true,
      configurable: true,
    },
    alive: {
      get(): boolean {
        return true;
      },
      set(_val: boolean): void {
        // Immortal training dummy never dies
      },
      enumerable: true,
      configurable: true,
    },
  });

  // Attach hidden anchor helper via symbol-free closure sync helper
  (entity as EnemyEntity & { __syncDummyAnchor?: (nextAnchor?: Vec3) => void }).__syncDummyAnchor = (
    nextAnchor?: Vec3,
  ) => {
    if (nextAnchor) {
      fixedAnchor.x = nextAnchor.x;
      fixedAnchor.y = nextAnchor.y;
      fixedAnchor.z = nextAnchor.z;
    }
    livePosition.x = fixedAnchor.x;
    livePosition.y = fixedAnchor.y;
    livePosition.z = fixedAnchor.z;
    liveVelocity.x = 0;
    liveVelocity.y = 0;
    liveVelocity.z = 0;
    internalHp = TRAINING_DUMMY_MAX_HP;
  };

  return entity;
}
