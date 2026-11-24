import * as THREE from 'three';
import type { PetId, Vec3 } from '../../contracts/types';

interface PetVisualSpec {
  primaryHex: number;
  accentHex: number;
  orbitRadius: number;
  orbitSpeedRad: number;
  hoverHeight: number;
}

const PET_VISUAL_SPECS: Record<PetId, PetVisualSpec> = {
  celestial_owl: {
    primaryHex: 0x4dabf7,
    accentHex: 0xffd43b,
    orbitRadius: 1.38,
    orbitSpeedRad: 1.65,
    hoverHeight: 1.5,
  },
  ember_wyrmling: {
    primaryHex: 0xff6b35,
    accentHex: 0xffd43b,
    orbitRadius: 1.44,
    orbitSpeedRad: 1.85,
    hoverHeight: 1.38,
  },
  void_kitsune: {
    primaryHex: 0xae3ec9,
    accentHex: 0x66d9e8,
    orbitRadius: 1.34,
    orbitSpeedRad: 1.48,
    hoverHeight: 1.26,
  },
};

/**
 * Procedural 3D Companion Spirit Orb & Downed Distress Aura for Remote Avatars.
 * Orbits around teammates in THREE.Scene when `peer.activePet` is set.
 */
export class RemoteCompanionOrb {
  public readonly root: THREE.Group;

  private activePet: PetId | null = null;
  private readonly orbCluster: THREE.Group;
  private readonly coreMesh: THREE.Mesh;
  private readonly innerHaloMesh: THREE.Mesh;
  private readonly outerRingMesh: THREE.Mesh;
  private readonly wingLeftMesh: THREE.Mesh;
  private readonly wingRightMesh: THREE.Mesh;
  private readonly wispMeshes: THREE.Mesh[] = [];

  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly wingMat: THREE.MeshStandardMaterial;
  private readonly wispMat: THREE.MeshBasicMaterial;

  // Downed ground distress beacon ring
  private readonly downedGroup: THREE.Group;
  private readonly downedOuterRing: THREE.Mesh;
  private readonly downedInnerRing: THREE.Mesh;
  private readonly downedMat: THREE.MeshBasicMaterial;
  private isDowned = false;

  private readonly phaseOffset: number;
  private disposed = false;

  constructor(seedPhase = 0) {
    this.phaseOffset = Number.isFinite(seedPhase) ? seedPhase : 0;
    this.root = new THREE.Group();
    this.root.name = 'RemoteAvatarAttachments';

    // Companion spirit orb assembly
    this.orbCluster = new THREE.Group();
    this.orbCluster.name = 'RemoteCompanionSpiritOrb';
    this.orbCluster.visible = false;

    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x4dabf7,
      emissive: 0x4dabf7,
      emissiveIntensity: 1.15,
      roughness: 0.2,
      metalness: 0.35,
    });
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0xffd43b,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wingMat = new THREE.MeshStandardMaterial({
      color: 0xffd43b,
      emissive: 0xffd43b,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    this.wispMat = new THREE.MeshBasicMaterial({
      color: 0x4dabf7,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const coreGeo = new THREE.OctahedronGeometry(0.18, 1);
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.orbCluster.add(this.coreMesh);

    const innerHaloGeo = new THREE.SphereGeometry(0.24, 12, 10);
    this.innerHaloMesh = new THREE.Mesh(innerHaloGeo, this.wispMat);
    this.orbCluster.add(this.innerHaloMesh);

    const ringGeo = new THREE.TorusGeometry(0.29, 0.022, 8, 24);
    this.outerRingMesh = new THREE.Mesh(ringGeo, this.haloMat);
    this.outerRingMesh.rotation.x = Math.PI * 0.38;
    this.orbCluster.add(this.outerRingMesh);

    const wingGeo = new THREE.ConeGeometry(0.075, 0.26, 4);
    this.wingLeftMesh = new THREE.Mesh(wingGeo, this.wingMat);
    this.wingLeftMesh.position.set(-0.22, 0.04, -0.04);
    this.wingLeftMesh.rotation.z = Math.PI * 0.42;
    this.orbCluster.add(this.wingLeftMesh);

    this.wingRightMesh = new THREE.Mesh(wingGeo, this.wingMat);
    this.wingRightMesh.position.set(0.22, 0.04, -0.04);
    this.wingRightMesh.rotation.z = -Math.PI * 0.42;
    this.orbCluster.add(this.wingRightMesh);

    const wispGeo = new THREE.OctahedronGeometry(0.055, 0);
    for (let i = 0; i < 3; i++) {
      const wisp = new THREE.Mesh(wispGeo, this.haloMat);
      this.wispMeshes.push(wisp);
      this.orbCluster.add(wisp);
    }

    this.root.add(this.orbCluster);

    // Downed bleedout SOS ground circle
    this.downedGroup = new THREE.Group();
    this.downedGroup.name = 'RemoteDownedBleedoutRing';
    this.downedGroup.visible = false;

    this.downedMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const downedOuterGeo = new THREE.RingGeometry(0.92, 1.12, 32);
    downedOuterGeo.rotateX(-Math.PI / 2);
    this.downedOuterRing = new THREE.Mesh(downedOuterGeo, this.downedMat);
    this.downedOuterRing.position.y = 0.05;
    this.downedGroup.add(this.downedOuterRing);

    const downedInnerGeo = new THREE.RingGeometry(0.45, 0.56, 24);
    downedInnerGeo.rotateX(-Math.PI / 2);
    this.downedInnerRing = new THREE.Mesh(downedInnerGeo, this.downedMat);
    this.downedInnerRing.position.y = 0.06;
    this.downedGroup.add(this.downedInnerRing);

    this.root.add(this.downedGroup);
  }

  public setPet(petId: PetId | undefined | null): void {
    if (this.disposed) return;

    const validPet: PetId | null =
      petId === 'celestial_owl' || petId === 'ember_wyrmling' || petId === 'void_kitsune'
        ? petId
        : null;

    if (this.activePet === validPet) return;
    this.activePet = validPet;

    if (!validPet) {
      this.orbCluster.visible = false;
      return;
    }

    const spec = PET_VISUAL_SPECS[validPet];
    this.coreMat.color.setHex(spec.primaryHex);
    this.coreMat.emissive.setHex(spec.primaryHex);
    this.wispMat.color.setHex(spec.primaryHex);
    this.haloMat.color.setHex(spec.accentHex);
    this.wingMat.color.setHex(spec.accentHex);
    this.wingMat.emissive.setHex(spec.accentHex);

    this.orbCluster.visible = true;
  }

  public getActivePet(): PetId | null {
    return this.activePet;
  }

  public isOrbVisible(): boolean {
    return this.orbCluster.visible;
  }

  public setDowned(downed: boolean): void {
    if (this.disposed) return;
    this.isDowned = Boolean(downed);
    this.downedGroup.visible = this.isDowned;
  }

  public update(elapsedSec: number, ownerPos: Vec3): void {
    if (this.disposed) return;
    const t = Number.isFinite(elapsedSec) ? elapsedSec : 0;

    this.root.position.set(ownerPos.x, ownerPos.y, ownerPos.z);

    if (this.activePet && this.orbCluster.visible) {
      const spec = PET_VISUAL_SPECS[this.activePet];
      const orbitAngle = t * spec.orbitSpeedRad + this.phaseOffset;
      const bobY = Math.sin(t * 3.2 + this.phaseOffset) * 0.13;

      this.orbCluster.position.set(
        Math.cos(orbitAngle) * spec.orbitRadius,
        spec.hoverHeight + bobY,
        Math.sin(orbitAngle) * spec.orbitRadius,
      );

      // Face tangent direction of orbit + gentle spin on core & astral ring
      this.orbCluster.rotation.y = -orbitAngle + Math.PI * 0.5;
      this.coreMesh.rotation.y = t * 2.4;
      this.coreMesh.rotation.x = Math.sin(t * 1.9) * 0.35;
      this.outerRingMesh.rotation.z = t * 2.8;
      this.outerRingMesh.rotation.x = Math.PI * 0.38 + Math.sin(t * 2.1) * 0.22;

      const flap = Math.sin(t * 8.5 + this.phaseOffset) * 0.28;
      this.wingLeftMesh.rotation.z = Math.PI * 0.42 + flap;
      this.wingRightMesh.rotation.z = -Math.PI * 0.42 - flap;

      const pulse = 1 + Math.sin(t * 4.6 + this.phaseOffset) * 0.09;
      this.innerHaloMesh.scale.setScalar(pulse);

      for (let i = 0; i < this.wispMeshes.length; i++) {
        const wAngle = t * 3.6 + (i * Math.PI * 2) / this.wispMeshes.length;
        const wisp = this.wispMeshes[i];
        wisp.position.set(
          Math.cos(wAngle) * 0.34,
          Math.sin(wAngle * 1.5) * 0.08,
          Math.sin(wAngle) * 0.34,
        );
      }
    }

    if (this.isDowned && this.downedGroup.visible) {
      const pulse = 1 + Math.sin(t * 5.2) * 0.08;
      this.downedOuterRing.scale.set(pulse, 1, pulse);
      this.downedInnerRing.rotation.y = -t * 1.8;
      this.downedMat.opacity = 0.52 + 0.28 * (0.5 + 0.5 * Math.sin(t * 6.4));
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        geometries.add(mesh.geometry);
      }
    });
    for (const geo of geometries) {
      geo.dispose();
    }

    this.coreMat.dispose();
    this.haloMat.dispose();
    this.wingMat.dispose();
    this.wispMat.dispose();
    this.downedMat.dispose();

    if (this.root.parent) {
      this.root.parent.remove(this.root);
    }
    this.root.clear();
  }
}
