import * as THREE from 'three';
import type { IMaterialLibrary, Vec3 } from '../../contracts/types';
import { clamp } from '../../core/Constants';

const SOUL_RING_VERT = /* glsl */ `
  varying vec2 vLocalUv;
  void main() {
    vLocalUv = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SOUL_RING_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSafe;
  uniform float uRadius;
  varying vec2 vLocalUv;

  void main() {
    float r = length(vLocalUv) / max(0.001, uRadius);
    float angle = atan(vLocalUv.y, vLocalUv.x);

    // Outer 6.5m sanctuary boundary band + inner harmonic rune circle
    float outerBand = smoothstep(0.935, 0.978, r) * (1.0 - smoothstep(0.992, 1.002, r));
    float innerBand = smoothstep(0.835, 0.855, r) * (1.0 - smoothstep(0.865, 0.882, r));

    // Rotating 8-spoke celestial rune ticks
    float runeTicks = pow(max(0.0, cos(angle * 8.0 - uTime * 1.4)), 14.0)
      * smoothstep(0.82, 0.96, r) * (1.0 - smoothstep(0.985, 1.0, r));
    float counterTicks = pow(max(0.0, cos(angle * 16.0 + uTime * 2.1)), 18.0)
      * outerBand;

    // Gentle radial sanctuary floor warmth
    float domeGlow = (1.0 - smoothstep(0.0, 0.98, r)) * 0.13;
    float pulse = 0.85 + 0.15 * sin(uTime * 4.2 - r * 7.0);

    vec3 goldSafe = vec3(1.0, 0.82, 0.24);
    vec3 warnDanger = vec3(1.0, 0.22, 0.18);
    vec3 tint = mix(warnDanger, goldSafe, clamp(uSafe, 0.0, 1.0));

    float dangerFlash = mix(0.75 + 0.35 * sin(uTime * 10.0), 1.0, clamp(uSafe, 0.0, 1.0));
    float alpha = clamp(
      (outerBand * 0.88 + innerBand * 0.42 + runeTicks * 0.52 + counterTicks * 0.35 + domeGlow) * pulse * dangerFlash,
      0.0,
      0.95
    );

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(tint * (1.15 + outerBand * 0.65), alpha);
  }
`;

const RIFT_CORE_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormalDir;
  void main() {
    vPos = position;
    vNormalDir = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RIFT_CORE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vPos;
  varying vec3 vNormalDir;

  void main() {
    float swirl = sin(vPos.y * 5.5 - uTime * 5.2 + atan(vPos.z, vPos.x) * 3.0);
    float rim = pow(1.0 - abs(vNormalDir.z), 1.6);
    vec3 core = mix(vec3(0.06, 0.02, 0.12), uColor * 1.65, 0.55 + 0.45 * swirl + rim * 0.45);
    gl_FragColor = vec4(core, 0.92);
  }
`;

function disposeObjectSubtree(
  root: THREE.Object3D,
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
): void {
  if (root.parent) {
    root.parent.remove(root);
  }
  for (const geo of ownedGeometries) {
    geo.dispose();
  }
  ownedGeometries.clear();
  for (const mat of ownedMaterials) {
    mat.dispose();
  }
  ownedMaterials.clear();
}

/**
 * 3D Glowing Soul Lantern Reliquary Cart + 6.5m Protective Golden Sanctuary Ring.
 */
export class SoulLanternVisualRig {
  public readonly root = new THREE.Group();
  private readonly cartBody = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly lanternPivot = new THREE.Group();
  private readonly flameCore: THREE.Mesh;
  private readonly pointLight: THREE.PointLight;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly motes: THREE.Mesh[] = [];
  private readonly waypointBeacon: THREE.Mesh;

  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly safeRadius: number;

  constructor(materials: IMaterialLibrary | null, safeRadius = 6.5) {
    this.safeRadius = safeRadius;
    this.root.name = 'SoulLanternEscortRig';

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.ownedGeometries.add(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.ownedMaterials.add(m);
      return m;
    };

    const ironMat = materials
      ? trackMat(materials.clone('metal_dark_iron'))
      : trackMat(
          new THREE.MeshStandardMaterial({
            color: 0x252830,
            metalness: 0.82,
            roughness: 0.36,
          }),
        );
    const goldMat = materials
      ? trackMat(materials.clone('metal_gold'))
      : trackMat(
          new THREE.MeshStandardMaterial({
            color: 0xe6b84c,
            metalness: 0.88,
            roughness: 0.25,
          }),
        );
    const woodMat = materials
      ? trackMat(materials.clone('wood_oak'))
      : trackMat(
          new THREE.MeshStandardMaterial({
            color: 0x5c3c24,
            roughness: 0.78,
          }),
        );
    const soulGlowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xffe066,
        transparent: true,
        opacity: 0.95,
      }),
    );

    // 1. Gothic Reliquary Cart Chassis
    const deck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.35, 0.22, 1.85)), woodMat);
    deck.position.set(0, 0.48, 0);
    this.cartBody.add(deck);

    const ironTrim = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.45, 0.12, 1.95)), ironMat);
    ironTrim.position.set(0, 0.44, 0);
    this.cartBody.add(ironTrim);

    // 4 Rotating Spoked Brass Wheels
    const rimGeo = trackGeo(new THREE.TorusGeometry(0.36, 0.055, 8, 20));
    const spokeGeo = trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 0.68, 6));
    const wheelOffsets: Array<[number, number]> = [
      [-0.76, -0.62],
      [0.76, -0.62],
      [-0.76, 0.62],
      [0.76, 0.62],
    ];
    for (const [wx, wz] of wheelOffsets) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, 0.38, wz);

      const rim = new THREE.Mesh(rimGeo, goldMat);
      rim.rotation.y = Math.PI * 0.5;
      wheelGroup.add(rim);

      const spokeA = new THREE.Mesh(spokeGeo, ironMat);
      wheelGroup.add(spokeA);
      const spokeB = new THREE.Mesh(spokeGeo, ironMat);
      spokeB.rotation.z = Math.PI * 0.5;
      wheelGroup.add(spokeB);

      this.wheels.push(wheelGroup);
      this.cartBody.add(wheelGroup);
    }

    // 4 Corner Gothic Spire Posts + Overhead Gilded Arch
    const postGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.06, 1.45, 8));
    const finialGeo = trackGeo(new THREE.OctahedronGeometry(0.09, 0));
    const postOffsets: Array<[number, number]> = [
      [-0.58, -0.76],
      [0.58, -0.76],
      [-0.58, 0.76],
      [0.58, 0.76],
    ];
    for (const [px, pz] of postOffsets) {
      const post = new THREE.Mesh(postGeo, ironMat);
      post.position.set(px, 1.25, pz);
      this.cartBody.add(post);

      const finial = new THREE.Mesh(finialGeo, goldMat);
      finial.position.set(px, 2.02, pz);
      this.cartBody.add(finial);
    }

    const archBeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(1.26, 0.08, 0.12)), goldMat);
    archBeam.position.set(0, 2.02, 0);
    this.cartBody.add(archBeam);

    // 2. Swinging Suspended Astral Soul Lantern
    this.lanternPivot.position.set(0, 1.98, 0);
    const chain = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 6)),
      goldMat,
    );
    chain.position.set(0, -0.16, 0);
    this.lanternPivot.add(chain);

    const cage = new THREE.Mesh(
      trackGeo(new THREE.OctahedronGeometry(0.34, 0)),
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xffd43b,
          emissive: new THREE.Color(0xd97706),
          emissiveIntensity: 0.6,
          metalness: 0.9,
          roughness: 0.2,
          wireframe: true,
        }),
      ),
    );
    cage.position.set(0, -0.46, 0);
    this.lanternPivot.add(cage);

    this.flameCore = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.2, 1)), soulGlowMat);
    this.flameCore.position.set(0, -0.46, 0);
    this.lanternPivot.add(this.flameCore);

    this.cartBody.add(this.lanternPivot);
    this.root.add(this.cartBody);

    // 3. Warm Sanctuary PointLight
    this.pointLight = new THREE.PointLight(0xffd43b, 3.0, safeRadius * 2.1, 1.6);
    this.pointLight.position.set(0, 1.85, 0);
    this.root.add(this.pointLight);

    // 4. 6.5m Protective Golden GLSL Ring
    this.ringMaterial = trackMat(
      new THREE.ShaderMaterial({
        vertexShader: SOUL_RING_VERT,
        fragmentShader: SOUL_RING_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSafe: { value: 1 },
          uRadius: { value: safeRadius },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );

    const ringMesh = new THREE.Mesh(
      trackGeo(new THREE.RingGeometry(0.15, safeRadius, 64, 1)),
      this.ringMaterial,
    );
    ringMesh.rotation.x = -Math.PI * 0.5;
    ringMesh.position.y = 0.06;
    this.root.add(ringMesh);

    // 5. 8 Orbiting Golden Perimeter Soul-Motes
    const moteGeo = trackGeo(new THREE.OctahedronGeometry(0.11, 0));
    for (let i = 0; i < 8; i++) {
      const mote = new THREE.Mesh(moteGeo, soulGlowMat);
      this.motes.push(mote);
      this.root.add(mote);
    }

    // 6. Ahead-of-Cart Waypoint Breadcrumb Beacon
    this.waypointBeacon = new THREE.Mesh(
      trackGeo(new THREE.OctahedronGeometry(0.18, 0)),
      trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x74c0fc,
          transparent: true,
          opacity: 0.72,
        }),
      ),
    );
    this.waypointBeacon.visible = false;
  }

  public attachTo(parent: THREE.Group): void {
    parent.add(this.root);
    parent.add(this.waypointBeacon);
  }

  public update(
    elapsedSec: number,
    position: Vec3,
    headingY: number,
    speedNormalized: number,
    insideLight: boolean,
    nextWaypoint: Vec3 | null,
  ): void {
    this.root.position.set(position.x, position.y, position.z);
    this.cartBody.rotation.y = headingY;

    // Spin wheels proportionally to cart motion
    const wheelSpin = elapsedSec * (1.8 + speedNormalized * 3.2);
    for (const w of this.wheels) {
      w.rotation.x = wheelSpin;
    }

    // Gentle pendulum sway on suspended Soul Lantern
    this.lanternPivot.rotation.z = Math.sin(elapsedSec * 3.4) * (0.06 + speedNormalized * 0.08);
    this.lanternPivot.rotation.x = Math.cos(elapsedSec * 2.7) * 0.05;
    const flamePulse = 0.92 + 0.16 * Math.sin(elapsedSec * 7.5);
    this.flameCore.scale.setScalar(flamePulse);
    this.flameCore.rotation.y = elapsedSec * 2.4;

    // Shader uniform transition between gold safe zone & crimson-amber danger warning
    const currentSafe = this.ringMaterial.uniforms.uSafe.value as number;
    const targetSafe = insideLight ? 1.0 : 0.0;
    this.ringMaterial.uniforms.uSafe.value = currentSafe + (targetSafe - currentSafe) * 0.22;
    this.ringMaterial.uniforms.uTime.value = elapsedSec;

    this.pointLight.color.setHex(insideLight ? 0xffd43b : 0xff5c39);
    this.pointLight.intensity = (insideLight ? 3.1 : 2.3) + 0.35 * Math.sin(elapsedSec * 6.0);

    // Orbit perimeter soul-motes at r = safeRadius - 0.15
    const orbitR = Math.max(1, this.safeRadius - 0.15);
    for (let i = 0; i < this.motes.length; i++) {
      const a = elapsedSec * 0.85 + (i / this.motes.length) * Math.PI * 2;
      const bobY = 0.38 + 0.18 * Math.sin(elapsedSec * 3.2 + i * 1.1);
      this.motes[i].position.set(Math.cos(a) * orbitR, bobY, Math.sin(a) * orbitR);
      this.motes[i].rotation.y = a * 2;
    }

    if (nextWaypoint) {
      this.waypointBeacon.visible = true;
      this.waypointBeacon.position.set(
        nextWaypoint.x,
        0.55 + 0.18 * Math.sin(elapsedSec * 4.5),
        nextWaypoint.z,
      );
      this.waypointBeacon.rotation.y = elapsedSec * 3.0;
    } else {
      this.waypointBeacon.visible = false;
    }
  }

  public dispose(): void {
    if (this.waypointBeacon.parent) {
      this.waypointBeacon.parent.remove(this.waypointBeacon);
    }
    disposeObjectSubtree(this.root, this.ownedGeometries, this.ownedMaterials);
  }
}

/**
 * 3D Dimensional Void Rift Tear + Escalating Tier Rings (Bronze -> Silver -> Gold -> Mythic).
 */
export class RiftBreachVisualRig {
  public readonly root = new THREE.Group();
  private readonly tearCore: THREE.Mesh;
  private readonly coreShader: THREE.ShaderMaterial;
  private readonly outerRing: THREE.Mesh;
  private readonly innerRing: THREE.Mesh;
  private readonly groundSigil: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly pointLight: THREE.PointLight;

  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor(position: Vec3) {
    this.root.name = 'VoidRiftBreachRig';
    this.root.position.set(position.x, position.y, position.z);

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.ownedGeometries.add(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.ownedMaterials.add(m);
      return m;
    };

    this.coreShader = trackMat(
      new THREE.ShaderMaterial({
        vertexShader: RIFT_CORE_VERT,
        fragmentShader: RIFT_CORE_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(0xbe4bdb) },
        },
        transparent: true,
      }),
    );

    this.tearCore = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.95, 2)), this.coreShader);
    this.tearCore.scale.set(0.72, 2.35, 0.36);
    this.tearCore.position.set(0, 1.95, 0);
    this.root.add(this.tearCore);

    this.ringMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xcd77f2,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    this.outerRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(1.65, 0.065, 10, 40)),
      this.ringMat,
    );
    this.outerRing.position.set(0, 1.95, 0);
    this.root.add(this.outerRing);

    this.innerRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(1.18, 0.05, 10, 32)),
      this.ringMat,
    );
    this.innerRing.position.set(0, 1.95, 0);
    this.root.add(this.innerRing);

    this.groundSigil = new THREE.Mesh(
      trackGeo(new THREE.RingGeometry(2.85, 3.35, 48)),
      this.ringMat,
    );
    this.groundSigil.rotation.x = -Math.PI * 0.5;
    this.groundSigil.position.y = 0.06;
    this.root.add(this.groundSigil);

    this.pointLight = new THREE.PointLight(0xbe4bdb, 3.0, 13, 1.5);
    this.pointLight.position.set(0, 2.1, 0);
    this.root.add(this.pointLight);
  }

  public update(elapsedSec: number, tierLabel: string, remainingSec: number): void {
    const tierHex =
      tierLabel === 'Mythic'
        ? 0xff1e42
        : tierLabel === 'Gold'
          ? 0xffd43b
          : tierLabel === 'Silver'
            ? 0x74c0fc
            : 0xbe4bdb;

    (this.coreShader.uniforms.uTime as { value: number }).value = elapsedSec;
    (this.coreShader.uniforms.uColor.value as THREE.Color).setHex(tierHex);
    this.ringMat.color.setHex(tierHex);
    this.pointLight.color.setHex(tierHex);

    const urgency = remainingSec < 5 ? 1.8 : 1.0;
    this.tearCore.rotation.y = elapsedSec * 1.4 * urgency;
    this.outerRing.rotation.x = elapsedSec * 1.7 * urgency;
    this.outerRing.rotation.y = elapsedSec * 1.1;
    this.innerRing.rotation.y = -elapsedSec * 2.3 * urgency;
    this.innerRing.rotation.z = elapsedSec * 1.5;

    const scalePulse = 1.0 + 0.08 * Math.sin(elapsedSec * 6.0 * urgency);
    this.groundSigil.scale.setScalar(scalePulse);
    this.pointLight.intensity = 2.8 + 0.7 * Math.sin(elapsedSec * 7.0 * urgency);
  }

  public dispose(): void {
    disposeObjectSubtree(this.root, this.ownedGeometries, this.ownedMaterials);
  }
}

/**
 * Crimson Dread Aura & Meat-Hook Chain Telegraph for The Butcher Invasion.
 */
export class ButcherVisualRig {
  public readonly root = new THREE.Group();
  private readonly bloodRing: THREE.Mesh;
  private readonly hookChainBeam: THREE.Mesh;
  private readonly pointLight: THREE.PointLight;
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor() {
    this.root.name = 'ButcherDreadAura';

    const ringGeo = new THREE.RingGeometry(0.95, 1.48, 32);
    this.ownedGeometries.add(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff1e42,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedMaterials.add(ringMat);

    this.bloodRing = new THREE.Mesh(ringGeo, ringMat);
    this.bloodRing.rotation.x = -Math.PI * 0.5;
    this.bloodRing.position.y = 0.05;
    this.root.add(this.bloodRing);

    const beamGeo = new THREE.BoxGeometry(0.18, 0.08, 1.0);
    this.ownedGeometries.add(beamGeo);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedMaterials.add(beamMat);

    this.hookChainBeam = new THREE.Mesh(beamGeo, beamMat);
    this.hookChainBeam.visible = false;
    this.root.add(this.hookChainBeam);

    this.pointLight = new THREE.PointLight(0xff1e42, 2.4, 9.5, 1.6);
    this.pointLight.position.set(0, 1.7, 0);
    this.root.add(this.pointLight);
  }

  public update(
    elapsedSec: number,
    butcherPos: Vec3,
    hookTargetPos: Vec3 | null,
  ): void {
    this.root.position.set(butcherPos.x, butcherPos.y, butcherPos.z);
    this.bloodRing.rotation.z = elapsedSec * 2.4;
    const pulse = 1.0 + 0.1 * Math.sin(elapsedSec * 7.5);
    this.bloodRing.scale.setScalar(pulse);
    this.pointLight.intensity = 2.2 + 0.5 * Math.sin(elapsedSec * 8.0);

    if (hookTargetPos) {
      const dx = hookTargetPos.x - butcherPos.x;
      const dz = hookTargetPos.z - butcherPos.z;
      const len = Math.max(0.5, Math.hypot(dx, dz));
      this.hookChainBeam.visible = true;
      this.hookChainBeam.scale.set(1, 1, len);
      this.hookChainBeam.rotation.y = Math.atan2(dx, dz);
      this.hookChainBeam.position.set(dx * 0.5, 0.95, dz * 0.5);
    } else {
      this.hookChainBeam.visible = false;
    }
  }

  public dispose(): void {
    disposeObjectSubtree(this.root, this.ownedGeometries, this.ownedMaterials);
  }
}

/**
 * Sparkling Gold Aura & 18s Escape Portal for Treasure Goblin.
 */
export class GoblinVisualRig {
  public readonly root = new THREE.Group();
  private readonly goldRing: THREE.Mesh;
  private readonly portalGroup = new THREE.Group();
  private readonly portalRim: THREE.Mesh;
  private readonly portalDisc: THREE.Mesh;
  private readonly portalDiscMat: THREE.MeshBasicMaterial;
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor() {
    this.root.name = 'TreasureGoblinPortalRig';

    const ringGeo = new THREE.RingGeometry(0.45, 0.78, 24);
    this.ownedGeometries.add(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd43b,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedMaterials.add(ringMat);

    this.goldRing = new THREE.Mesh(ringGeo, ringMat);
    this.goldRing.rotation.x = -Math.PI * 0.5;
    this.goldRing.position.y = 0.05;
    this.root.add(this.goldRing);

    const portalRimGeo = new THREE.TorusGeometry(0.88, 0.08, 10, 32);
    this.ownedGeometries.add(portalRimGeo);
    this.portalRim = new THREE.Mesh(portalRimGeo, ringMat);
    this.portalGroup.add(this.portalRim);

    const discGeo = new THREE.CircleGeometry(0.82, 28);
    this.ownedGeometries.add(discGeo);
    this.portalDiscMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedMaterials.add(this.portalDiscMat);

    this.portalDisc = new THREE.Mesh(discGeo, this.portalDiscMat);
    this.portalGroup.add(this.portalDisc);
    this.portalGroup.position.set(0.85, 1.1, 0);
    this.root.add(this.portalGroup);
  }

  public update(elapsedSec: number, pos: Vec3, escapeRemainingSec: number): void {
    this.root.position.set(pos.x, pos.y, pos.z);
    this.goldRing.rotation.z = -elapsedSec * 3.2;

    // Escape portal grows larger and spins faster as the 18s timer ticks down
    const urgency01 = clamp(1 - escapeRemainingSec / 18, 0.18, 1.0);
    this.portalGroup.scale.setScalar(urgency01);
    this.portalGroup.rotation.y = elapsedSec * (1.5 + urgency01 * 4.0);
    this.portalRim.rotation.z = elapsedSec * 3.5;
    this.portalDiscMat.opacity = 0.25 + urgency01 * 0.55;
  }

  public dispose(): void {
    disposeObjectSubtree(this.root, this.ownedGeometries, this.ownedMaterials);
  }
}

/**
 * Gladiatorial Arena Crest & Milestone Wave Braziers for Crimson Colosseum.
 */
export class ColosseumVisualRig {
  public readonly root = new THREE.Group();
  private readonly crestRing: THREE.Mesh;
  private readonly crestMat: THREE.MeshBasicMaterial;
  private readonly orbs: THREE.Mesh[] = [];
  private readonly pointLight: THREE.PointLight;
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();

  constructor(center: Vec3) {
    this.root.name = 'ColosseumArenaCrest';
    this.root.position.set(center.x, center.y, center.z);

    const ringGeo = new THREE.RingGeometry(4.1, 4.65, 64);
    this.ownedGeometries.add(ringGeo);
    this.crestMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ownedMaterials.add(this.crestMat);

    this.crestRing = new THREE.Mesh(ringGeo, this.crestMat);
    this.crestRing.rotation.x = -Math.PI * 0.5;
    this.crestRing.position.y = 0.05;
    this.root.add(this.crestRing);

    const orbGeo = new THREE.OctahedronGeometry(0.24, 0);
    this.ownedGeometries.add(orbGeo);
    for (let i = 0; i < 4; i++) {
      const orb = new THREE.Mesh(orbGeo, this.crestMat);
      this.orbs.push(orb);
      this.root.add(orb);
    }

    this.pointLight = new THREE.PointLight(0xff3b30, 2.2, 16, 1.5);
    this.pointLight.position.set(0, 2.4, 0);
    this.root.add(this.pointLight);
  }

  public update(elapsedSec: number, wave: number): void {
    const isBossWave = wave % 5 === 0;
    const hex = isBossWave ? 0xffd43b : 0xff2a3c;
    this.crestMat.color.setHex(hex);
    this.pointLight.color.setHex(hex);

    this.crestRing.rotation.z = elapsedSec * (isBossWave ? 1.6 : 0.7);
    for (let i = 0; i < this.orbs.length; i++) {
      const a = elapsedSec * 1.1 + (i * Math.PI) / 2;
      this.orbs[i].position.set(
        Math.cos(a) * 4.38,
        0.85 + 0.22 * Math.sin(elapsedSec * 3.5 + i),
        Math.sin(a) * 4.38,
      );
      this.orbs[i].rotation.y = a * 2;
    }
    this.pointLight.intensity = (isBossWave ? 3.2 : 2.1) + 0.4 * Math.sin(elapsedSec * 5.0);
  }

  public dispose(): void {
    disposeObjectSubtree(this.root, this.ownedGeometries, this.ownedMaterials);
  }
}
