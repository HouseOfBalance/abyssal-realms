import * as THREE from 'three';
import type {
  DamagePacket,
  DungeonFloorData,
  EnemyEntity,
  ICombatEngine,
  MercenaryId,
  PlayerRuntimeState,
  Vec3,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  ALL_MERCENARY_IDS,
  COMPANION_LEASH_TELEPORT_DIST,
  computeMercenaryAttackDamage,
  computeMercenaryMaxHp,
  MERCENARY_AUTO_REVIVE_SEC,
  MERCENARY_DEFINITIONS,
  MERCENARY_OUT_OF_COMBAT_RADIUS,
  MERCENARY_SPLASH_TICK_SEC,
} from './companionData';
import type { CompanionResourcePool } from './CompanionResourcePool';
import {
  type MercenaryAnimMode,
  MercenaryRigBuilder,
  type MercenaryRigHandle,
} from './MercenaryRigBuilder';

const MERC_COLLISION_RADIUS = 0.38;

function lerpAngle(current: number, target: number, factor: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * clamp(factor, 0, 1);
}

export class MercenaryController {
  public readonly container = new THREE.Group();

  private readonly rigBuilder: MercenaryRigBuilder;
  private readonly rigs = new Map<MercenaryId, MercenaryRigHandle>();

  private activeMercenary: MercenaryId = 'iron_templar';
  private level = 1;
  private maxHp: number = computeMercenaryMaxHp('iron_templar', 1);
  private hp: number = this.maxHp;
  private alive = true;

  private position: Vec3 = { x: 0, y: 0, z: 0 };
  private rotationY = 0;
  private initializedPosition = false;

  private attackTimerSec = 0;
  private specialTimerSec = 1.5;
  private splashTimerSec = 0;
  private reviveTimerSec = 0;
  private arcanistBoltParity = 0;

  constructor(resources: CompanionResourcePool) {
    this.container.name = 'CompanionMercenariesContainer';
    this.rigBuilder = new MercenaryRigBuilder(resources);
  }

  public rebuildRigs(): void {
    this.container.clear();
    this.rigs.clear();

    for (const id of ALL_MERCENARY_IDS) {
      const rig = this.rigBuilder.buildMercenaryRig(id);
      rig.root.visible = id === this.activeMercenary;
      this.container.add(rig.root);
      this.rigs.set(id, rig);
    }

    this.syncActiveRigTransform();
  }

  public getActiveMercenary(): MercenaryId {
    return this.activeMercenary;
  }

  public getMercenaryName(): string {
    return MERCENARY_DEFINITIONS[this.activeMercenary].name;
  }

  public getHp(): number {
    return Math.max(0, Math.round(this.hp));
  }

  public getMaxHp(): number {
    return this.maxHp;
  }

  public isAlive(): boolean {
    return this.alive;
  }

  public getLevel(): number {
    return this.level;
  }

  public getPosition(): Vec3 {
    return { ...this.position };
  }

  public setActiveMercenary(mercId: MercenaryId): void {
    if (!ALL_MERCENARY_IDS.includes(mercId)) return;
    const prevMax = Math.max(1, this.maxHp);
    const hpRatio = this.alive ? clamp(this.hp / prevMax, 0.05, 1) : 0;

    this.activeMercenary = mercId;
    this.maxHp = computeMercenaryMaxHp(mercId, this.level);
    if (this.alive) {
      this.hp = Math.max(1, Math.round(this.maxHp * hpRatio));
    } else {
      this.hp = 0;
    }

    this.attackTimerSec = 0;
    this.specialTimerSec = 1.2;

    for (const [id, rig] of this.rigs.entries()) {
      rig.root.visible = id === mercId;
    }
    this.syncActiveRigTransform();
  }

  public respawnAt(pos: Vec3, playerLevel: number, floor?: DungeonFloorData): void {
    this.level = Math.max(1, Math.floor(Number.isFinite(playerLevel) ? playerLevel : 1));
    this.maxHp = computeMercenaryMaxHp(this.activeMercenary, this.level);
    this.hp = this.maxHp;
    this.alive = true;
    this.attackTimerSec = 0;
    this.specialTimerSec = 1.2;
    this.splashTimerSec = 0;
    this.reviveTimerSec = 0;

    const flank = this.computeFollowTarget(pos, 0, floor);
    this.position.x = flank.x;
    this.position.y = pos.y;
    this.position.z = flank.z;
    this.initializedPosition = true;
    this.syncActiveRigTransform();
  }

  /**
   * Allows external callers or tests to apply direct splash damage to the mercenary.
   */
  public applySplashDamage(rawAmount: number): void {
    if (!this.alive || rawAmount <= 0) return;
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const mitigated = Math.max(1, Math.round(rawAmount * (1 - def.armorMitigation)));
    this.hp = Math.max(0, this.hp - mitigated);
    this.rigs.get(this.activeMercenary)?.flashHit(0xff3b3b);

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.reviveTimerSec = MERCENARY_AUTO_REVIVE_SEC;
    }
  }

  public update(
    dt: number,
    elapsedSec: number,
    player: PlayerRuntimeState,
    floor: DungeonFloorData,
    enemies: EnemyEntity[],
    combat: ICombatEngine,
    inSanctuary = false,
  ): void {
    if (!Number.isFinite(dt) || dt < 0) return;

    // Sync mercenary level dynamically if player leveled up
    const safePlayerLevel = Math.max(1, Math.floor(player.level || 1));
    if (safePlayerLevel !== this.level) {
      const ratio = this.alive ? clamp(this.hp / Math.max(1, this.maxHp), 0.1, 1) : 1;
      this.level = safePlayerLevel;
      this.maxHp = computeMercenaryMaxHp(this.activeMercenary, this.level);
      if (this.alive) {
        this.hp = Math.max(1, Math.round(this.maxHp * ratio));
      }
    }

    if (!this.initializedPosition) {
      this.respawnAt(player.position, safePlayerLevel, floor);
    }

    const peaceful = Boolean(inSanctuary) || floor?.biome === 'sanctuary';

    // Teleport-leash if >18m away from the hero
    if (distXZ(this.position, player.position) > COMPANION_LEASH_TELEPORT_DIST) {
      this.teleportBesideHero(player, floor);
    }

    // Peaceful Sanctuary Hub behavior: full heal/revive, zero combat, calm follow/idle
    if (peaceful) {
      if (!this.alive || this.hp < this.maxHp) {
        this.alive = true;
        this.hp = this.maxHp;
        this.reviveTimerSec = 0;
      }
      const movedDist = this.followHero(dt, player, floor);
      const def = MERCENARY_DEFINITIONS[this.activeMercenary];
      const speedNorm = dt > 1e-5 ? clamp(movedDist / dt / def.moveSpeed, 0, 1) : 0;
      const mode: MercenaryAnimMode = speedNorm > 0.12 ? 'run' : 'peaceful_idle';
      this.updateActiveRig(dt, elapsedSec, mode, speedNorm, 1);
      return;
    }

    const hostileEnemies = this.collectHostileEnemies(enemies);
    const inCombat = this.isAreaInCombat(player.position, hostileEnemies);

    // Handle Downed + Out-of-Combat Auto-Revive Cooldown
    if (!this.alive) {
      if (!inCombat) {
        this.reviveTimerSec = Math.max(0, this.reviveTimerSec - dt);
        if (this.reviveTimerSec <= 0) {
          this.alive = true;
          this.hp = this.maxHp;
          this.splashTimerSec = 0;
          eventBus.emit('vfx:request', {
            type: 'heal_aura',
            position: { x: this.position.x, y: this.position.y + 0.1, z: this.position.z },
            colorHex: 0xffd43b,
            scale: 1.2,
          });
        }
      }
      const reviveProgress01 = clamp(1 - this.reviveTimerSec / MERCENARY_AUTO_REVIVE_SEC, 0, 1);
      this.updateActiveRig(dt, elapsedSec, 'downed', 0, reviveProgress01);
      return;
    }

    // Tick cooldowns
    if (this.attackTimerSec > 0) this.attackTimerSec = Math.max(0, this.attackTimerSec - dt);
    if (this.specialTimerSec > 0) this.specialTimerSec = Math.max(0, this.specialTimerSec - dt);

    // Occasional monster splash damage when enemies surround/engage the mercenary
    this.tickMonsterSplashDamage(dt, hostileEnemies);
    if (!this.alive) {
      this.updateActiveRig(dt, elapsedSec, 'downed', 0, 0);
      return;
    }

    // Out-of-combat passive health recovery
    if (!inCombat && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.08 * dt);
    }

    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const target = this.selectCombatTarget(player.position, hostileEnemies);

    // Storm Arcanist periodic player heal/mana pulse can trigger both in and right after combat
    if (
      this.activeMercenary === 'storm_arcanist' &&
      this.specialTimerSec <= 0 &&
      player.alive &&
      (target !== null ||
        player.hp < player.stats.maxHp - 1 ||
        player.mana < player.stats.maxMana - 1)
    ) {
      this.executeStormArcanistSupportPulse(player);
      this.specialTimerSec = def.specialCooldownSec;
    }

    let movedDist = 0;
    let animMode: MercenaryAnimMode = 'combat_idle';

    if (target) {
      movedDist = this.executeTacticalPositioning(dt, player, target, floor);
      this.faceTowards(target.position.x - this.position.x, target.position.z - this.position.z, dt);
      this.executeCombatAbilities(player, target, hostileEnemies, combat);
      const speedNorm = dt > 1e-5 ? clamp(movedDist / dt / def.moveSpeed, 0, 1) : 0;
      animMode = speedNorm > 0.14 ? 'run' : 'combat_idle';
      this.updateActiveRig(dt, elapsedSec, animMode, speedNorm, 1);
    } else {
      movedDist = this.followHero(dt, player, floor);
      const speedNorm = dt > 1e-5 ? clamp(movedDist / dt / def.moveSpeed, 0, 1) : 0;
      animMode = speedNorm > 0.12 ? 'run' : 'combat_idle';
      this.updateActiveRig(dt, elapsedSec, animMode, speedNorm, 1);
    }
  }

  private collectHostileEnemies(enemies: EnemyEntity[]): EnemyEntity[] {
    if (!enemies || enemies.length === 0) return [];
    const out: EnemyEntity[] = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !e.alive || e.hp <= 0) continue;
      out.push(e);
    }
    return out;
  }

  private isAreaInCombat(heroPos: Vec3, hostiles: EnemyEntity[]): boolean {
    for (let i = 0; i < hostiles.length; i++) {
      const e = hostiles[i];
      if (
        distXZ(e.position, heroPos) <= MERCENARY_OUT_OF_COMBAT_RADIUS ||
        distXZ(e.position, this.position) <= MERCENARY_OUT_OF_COMBAT_RADIUS
      ) {
        return true;
      }
    }
    return false;
  }

  private selectCombatTarget(heroPos: Vec3, hostiles: EnemyEntity[]): EnemyEntity | null {
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    let best: EnemyEntity | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < hostiles.length; i++) {
      const e = hostiles[i];
      const distHero = distXZ(e.position, heroPos);
      const distMerc = distXZ(e.position, this.position);

      if (distHero > COMPANION_LEASH_TELEPORT_DIST - 1.0) continue;
      if (distHero > def.aggroRadius && distMerc > def.aggroRadius) continue;

      // Templar prioritizes threats closest to the hero; Ranger/Arcanist pick nearest exposed target
      const score =
        def.role === 'tank' ? distHero * 0.65 + distMerc * 0.35 : distMerc * 0.75 + distHero * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }

    return best;
  }

  private executeTacticalPositioning(
    dt: number,
    player: PlayerRuntimeState,
    target: EnemyEntity,
    floor: DungeonFloorData,
  ): number {
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (def.role === 'tank') {
      // Iron Templar closes directly into melee cleave range
      const desiredStop = Math.max(1.25, def.preferredRange + (target.radius || 0.4) * 0.4);
      if (dist > desiredStop) {
        return this.stepTowards(target.position.x, target.position.z, def.moveSpeed, dt, floor);
      }
      return 0;
    }

    // Sylvan Ranger & Storm Arcanist kite away when foes close within kiteMinRange
    if (dist < def.kiteMinRange) {
      const awayX = dist > 1e-4 ? -dx / dist : -player.facingDir.x;
      const awayZ = dist > 1e-4 ? -dz / dist : -player.facingDir.z;
      // Blend slight pull toward hero so kiting stays safely inside 18m leash
      const toHeroX = player.position.x - this.position.x;
      const toHeroZ = player.position.z - this.position.z;
      const heroDist = Math.hypot(toHeroX, toHeroZ);
      const leashBias = heroDist > 10 ? 0.45 : 0.15;
      const goalX =
        this.position.x + awayX * 4.0 + (heroDist > 1e-4 ? (toHeroX / heroDist) * leashBias * 4.0 : 0);
      const goalZ =
        this.position.z + awayZ * 4.0 + (heroDist > 1e-4 ? (toHeroZ / heroDist) * leashBias * 4.0 : 0);
      return this.stepTowards(goalX, goalZ, def.moveSpeed, dt, floor);
    }

    if (dist > def.preferredRange + 1.8) {
      return this.stepTowards(target.position.x, target.position.z, def.moveSpeed * 0.92, dt, floor);
    }

    return 0;
  }

  private executeCombatAbilities(
    player: PlayerRuntimeState,
    target: EnemyEntity,
    hostiles: EnemyEntity[],
    combat: ICombatEngine,
  ): void {
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const rig = this.rigs.get(this.activeMercenary);
    const baseDmg = computeMercenaryAttackDamage(this.activeMercenary, this.level);

    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const dirX = dist > 1e-4 ? dx / dist : Math.sin(this.rotationY);
    const dirZ = dist > 1e-4 ? dz / dist : Math.cos(this.rotationY);

    if (this.activeMercenary === 'iron_templar') {
      // Special: 360° Taunting Aegis Slam & Warcry applying Vulnerable + aggro pull
      if (this.specialTimerSec <= 0 && dist <= 3.6 + (target.radius || 0.4)) {
        this.specialTimerSec = def.specialCooldownSec;
        this.attackTimerSec = Math.max(this.attackTimerSec, 0.45);
        rig?.triggerActionAnim('special', 0.48);

        const tauntPacket: Omit<DamagePacket, 'targetId'> = {
          sourceId: 'merc_iron_templar',
          baseAmount: Math.round(baseDmg * 1.35),
          damageType: 'physical',
          critChance: 0.12,
          critMultiplier: 1.6,
          appliesStatus: {
            type: 'vulnerable',
            chance: 1.0,
            durationSec: 4.0,
            potency: 0.2,
          },
        };
        combat.performMeleeArc(this.position, { x: dirX, y: 0, z: dirZ }, 3.6, Math.PI * 2, tauntPacket, hostiles);

        // Taunt pull: redirect nearby non-boss monsters slightly toward Sir Garrick
        for (let i = 0; i < hostiles.length; i++) {
          const h = hostiles[i];
          if (h.isBoss) continue;
          const tdx = this.position.x - h.position.x;
          const tdz = this.position.z - h.position.z;
          const td = Math.hypot(tdx, tdz);
          if (td > 0.6 && td <= 5.5) {
            h.velocity.x = (tdx / td) * Math.max(2.0, h.moveSpeed * 0.65);
            h.velocity.z = (tdz / td) * Math.max(2.0, h.moveSpeed * 0.65);
          }
        }

        eventBus.emit('vfx:request', {
          type: 'hit_sparks',
          position: { x: this.position.x, y: this.position.y + 0.8, z: this.position.z },
          colorHex: 0xffd43b,
          scale: 1.25,
        });
        return;
      }

      // Basic: Wide Sanctified Broadsword Cleave
      if (this.attackTimerSec <= 0 && dist <= def.attackRange + (target.radius || 0.45)) {
        this.attackTimerSec = def.attackCooldownSec;
        rig?.triggerActionAnim('attack', 0.42);

        const cleavePacket: Omit<DamagePacket, 'targetId'> = {
          sourceId: 'merc_iron_templar',
          baseAmount: baseDmg,
          damageType: 'physical',
          critChance: 0.1,
          critMultiplier: 1.55,
          knockback: { x: dirX * 1.6, y: 0, z: dirZ * 1.6 },
        };
        combat.performMeleeArc(
          this.position,
          { x: dirX, y: 0, z: dirZ },
          def.attackRange,
          Math.PI * 0.78,
          cleavePacket,
          hostiles,
        );
      }
      return;
    }

    if (this.activeMercenary === 'sylvan_ranger') {
      if (dist > def.attackRange) return;

      const origin: Vec3 = {
        x: this.position.x + dirX * 0.45,
        y: this.position.y + 1.15,
        z: this.position.z + dirZ * 0.45,
      };

      // Special: 3-Arrow Piercing Emerald Multishot Volley
      if (this.specialTimerSec <= 0) {
        this.specialTimerSec = def.specialCooldownSec;
        this.attackTimerSec = def.attackCooldownSec;
        rig?.triggerActionAnim('special', 0.36);

        const baseAngle = Math.atan2(dirX, dirZ);
        const spreads = [-0.22, 0, 0.22];
        for (let s = 0; s < spreads.length; s++) {
          const ang = baseAngle + spreads[s];
          combat.spawnProjectile({
            ownerIsPlayer: true,
            ownerId: 'merc_sylvan_ranger',
            origin,
            direction: { x: Math.sin(ang), y: 0, z: Math.cos(ang) },
            speed: 23.0,
            maxDistance: 16.0,
            radius: 0.28,
            piercing: true,
            damagePacket: {
              sourceId: 'merc_sylvan_ranger',
              baseAmount: Math.round(baseDmg * 0.92),
              damageType: 'poison',
              critChance: 0.18,
              critMultiplier: 1.65,
              appliesStatus: {
                type: 'poison',
                chance: 0.65,
                durationSec: 3.5,
                potency: Math.max(5, Math.round(baseDmg * 0.28)),
              },
            },
            visualColorHex: 0x40c057,
          });
        }
        return;
      }

      // Rapid-Fire Emerald Bow Shot
      if (this.attackTimerSec <= 0) {
        this.attackTimerSec = def.attackCooldownSec;
        rig?.triggerActionAnim('attack', 0.3);

        combat.spawnProjectile({
          ownerIsPlayer: true,
          ownerId: 'merc_sylvan_ranger',
          origin,
          direction: { x: dirX, y: 0, z: dirZ },
          speed: 22.0,
          maxDistance: 15.5,
          radius: 0.26,
          piercing: false,
          damagePacket: {
            sourceId: 'merc_sylvan_ranger',
            baseAmount: baseDmg,
            damageType: 'poison',
            critChance: 0.16,
            critMultiplier: 1.6,
            appliesStatus: {
              type: 'poison',
              chance: 0.35,
              durationSec: 3.0,
              potency: Math.max(4, Math.round(baseDmg * 0.22)),
            },
          },
          visualColorHex: 0x51cf66,
        });
      }
      return;
    }

    // Storm Arcanist: Alternating Lightning & Frost Bolts
    if (this.activeMercenary === 'storm_arcanist' && dist <= def.attackRange && this.attackTimerSec <= 0) {
      this.attackTimerSec = def.attackCooldownSec;
      rig?.triggerActionAnim('attack', 0.38);

      const isFrost = this.arcanistBoltParity % 2 === 1;
      this.arcanistBoltParity++;

      const origin: Vec3 = {
        x: this.position.x + dirX * 0.45,
        y: this.position.y + 1.2,
        z: this.position.z + dirZ * 0.45,
      };

      if (isFrost) {
        combat.spawnProjectile({
          ownerIsPlayer: true,
          ownerId: 'merc_storm_arcanist',
          origin,
          direction: { x: dirX, y: 0, z: dirZ },
          speed: 17.5,
          maxDistance: 15.0,
          radius: 0.32,
          piercing: false,
          aoeExplosionRadius: 1.75,
          damagePacket: {
            sourceId: 'merc_storm_arcanist',
            baseAmount: Math.round(baseDmg * 1.05),
            damageType: 'ice',
            critChance: 0.14,
            critMultiplier: 1.6,
            appliesStatus: {
              type: 'chill',
              chance: 0.78,
              durationSec: 3.0,
              potency: 0.35,
            },
          },
          visualColorHex: 0x4dabf7,
        });
      } else {
        combat.spawnProjectile({
          ownerIsPlayer: true,
          ownerId: 'merc_storm_arcanist',
          origin,
          direction: { x: dirX, y: 0, z: dirZ },
          speed: 20.0,
          maxDistance: 15.5,
          radius: 0.3,
          piercing: false,
          homing: true,
          damagePacket: {
            sourceId: 'merc_storm_arcanist',
            baseAmount: baseDmg,
            damageType: 'lightning',
            critChance: 0.16,
            critMultiplier: 1.65,
            appliesStatus: {
              type: 'vulnerable',
              chance: 0.35,
              durationSec: 3.0,
              potency: 0.15,
            },
          },
          visualColorHex: 0xffd43b,
        });
      }
      // Unused parameter guard
      void player;
    }
  }

  private executeStormArcanistSupportPulse(player: PlayerRuntimeState): void {
    const rig = this.rigs.get('storm_arcanist');
    rig?.triggerActionAnim('special', 0.55);

    const maxHp = Math.max(1, player.stats?.maxHp || 100);
    const maxMana = Math.max(1, player.stats?.maxMana || 60);
    const healAmt = Math.max(14, Math.round(maxHp * 0.12));
    const manaAmt = Math.max(12, Math.round(maxMana * 0.18));

    player.hp = Math.min(maxHp, (player.hp || 0) + healAmt);
    player.mana = Math.min(maxMana, (player.mana || 0) + manaAmt);

    // Also lightly mend Vaelen himself
    this.hp = Math.min(this.maxHp, this.hp + Math.round(this.maxHp * 0.1));

    eventBus.emit('vfx:request', {
      type: 'heal_aura',
      position: { x: player.position.x, y: player.position.y + 0.05, z: player.position.z },
      colorHex: 0x4dabf7,
      scale: 1.15,
    });
  }

  private tickMonsterSplashDamage(dt: number, hostiles: EnemyEntity[]): void {
    let strongestThreat = 0;
    let threatCount = 0;

    for (let i = 0; i < hostiles.length; i++) {
      const e = hostiles[i];
      const splashReach = Math.max(3.1, (e.attackRange || 2.0) + 0.9);
      if (distXZ(e.position, this.position) <= splashReach + (e.radius || 0.4)) {
        threatCount++;
        const atk = Number.isFinite(e.attackDamage) && e.attackDamage > 0 ? e.attackDamage : 18;
        if (atk > strongestThreat) strongestThreat = atk;
      }
    }

    if (threatCount === 0) {
      this.splashTimerSec = Math.min(this.splashTimerSec, MERCENARY_SPLASH_TICK_SEC * 0.5);
      return;
    }

    this.splashTimerSec += dt;
    let ticks = 0;
    while (this.splashTimerSec >= MERCENARY_SPLASH_TICK_SEC && this.alive && ticks < 8) {
      this.splashTimerSec -= MERCENARY_SPLASH_TICK_SEC;
      ticks++;
      const packMultiplier = 1 + Math.min(4, threatCount - 1) * 0.18;
      const rawSplash = Math.max(10, strongestThreat * 0.58 * packMultiplier);
      this.applySplashDamage(rawSplash);
    }
  }

  private followHero(dt: number, player: PlayerRuntimeState, floor: DungeonFloorData): number {
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const heroHeading = Math.atan2(player.facingDir.x, player.facingDir.z);
    const goal = this.computeFollowTarget(player.position, heroHeading, floor);

    const dx = goal.x - this.position.x;
    const dz = goal.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= 0.22) {
      this.faceTowards(player.facingDir.x, player.facingDir.z, dt * 0.6);
      return 0;
    }

    const catchupMult = dist > 5.0 ? 1.32 : 1.0;
    return this.stepTowards(goal.x, goal.z, def.moveSpeed * catchupMult, dt, floor);
  }

  private computeFollowTarget(
    heroPos: Vec3,
    heroHeadingRad: number,
    floor?: DungeonFloorData,
  ): { x: number; z: number } {
    const def = MERCENARY_DEFINITIONS[this.activeMercenary];
    const angle = heroHeadingRad + def.followAngleOffsetRad;
    const fx = heroPos.x + Math.sin(angle) * def.followDist;
    const fz = heroPos.z + Math.cos(angle) * def.followDist;

    if (!floor || typeof floor.isWalkableWorld !== 'function') {
      return { x: fx, z: fz };
    }
    if (floor.isWalkableWorld(fx, fz, MERC_COLLISION_RADIUS)) {
      return { x: fx, z: fz };
    }

    // Probe alternate angles around the hero so the mercenary never attempts to stand inside a wall
    for (let k = 1; k <= 7; k++) {
      const testAngle = angle + (k * Math.PI) / 4;
      const tx = heroPos.x + Math.sin(testAngle) * (def.followDist * 0.85);
      const tz = heroPos.z + Math.cos(testAngle) * (def.followDist * 0.85);
      if (floor.isWalkableWorld(tx, tz, MERC_COLLISION_RADIUS)) {
        return { x: tx, z: tz };
      }
    }

    return { x: heroPos.x, z: heroPos.z };
  }

  private teleportBesideHero(player: PlayerRuntimeState, floor: DungeonFloorData): void {
    const heroHeading = Math.atan2(player.facingDir.x, player.facingDir.z);
    const spot = this.computeFollowTarget(player.position, heroHeading, floor);
    this.position.x = spot.x;
    this.position.y = player.position.y;
    this.position.z = spot.z;
    this.syncActiveRigTransform();

    eventBus.emit('vfx:request', {
      type: 'dodge_afterimage',
      position: { x: this.position.x, y: this.position.y + 0.8, z: this.position.z },
      colorHex: MERCENARY_DEFINITIONS[this.activeMercenary].accentColorHex,
      scale: 1.0,
    });
  }

  private stepTowards(
    goalX: number,
    goalZ: number,
    speed: number,
    dt: number,
    floor: DungeonFloorData,
  ): number {
    const dx = goalX - this.position.x;
    const dz = goalZ - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 1e-4 || dt <= 0) return 0;

    let dirX = dx / dist;
    let dirZ = dz / dist;
    const step = Math.min(dist, speed * dt);

    const canWalk = (x: number, z: number): boolean =>
      !floor || typeof floor.isWalkableWorld !== 'function'
        ? true
        : floor.isWalkableWorld(x, z, MERC_COLLISION_RADIUS);

    const prevX = this.position.x;
    const prevZ = this.position.z;
    const nextX = prevX + dirX * step;
    const nextZ = prevZ + dirZ * step;

    if (canWalk(nextX, nextZ)) {
      this.position.x = nextX;
      this.position.z = nextZ;
    } else if (canWalk(nextX, prevZ)) {
      this.position.x = nextX;
    } else if (canWalk(prevX, nextZ)) {
      this.position.z = nextZ;
    } else if (floor && typeof floor.findPath === 'function') {
      const path = floor.findPath(this.position, { x: goalX, y: this.position.y, z: goalZ }, 32);
      if (path && path.length > 1) {
        const wp = path[1];
        const wdx = wp.x - prevX;
        const wdz = wp.z - prevZ;
        const wlen = Math.hypot(wdx, wdz);
        if (wlen > 1e-4) {
          dirX = wdx / wlen;
          dirZ = wdz / wlen;
          const wx = prevX + dirX * Math.min(wlen, step);
          const wz = prevZ + dirZ * Math.min(wlen, step);
          if (canWalk(wx, wz)) {
            this.position.x = wx;
            this.position.z = wz;
          }
        }
      }
    }

    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    if (moved > 1e-4) {
      this.faceTowards(this.position.x - prevX, this.position.z - prevZ, dt);
    }
    return moved;
  }

  private faceTowards(dx: number, dz: number, dt: number): void {
    if (Math.hypot(dx, dz) < 1e-4) return;
    const targetYaw = Math.atan2(dx, dz);
    this.rotationY = lerpAngle(this.rotationY, targetYaw, clamp(dt * 14, 0, 1));
  }

  private updateActiveRig(
    dt: number,
    elapsedSec: number,
    mode: MercenaryAnimMode,
    moveSpeedNorm: number,
    reviveProgress01: number,
  ): void {
    const rig = this.rigs.get(this.activeMercenary);
    if (!rig) return;
    this.syncActiveRigTransform();
    rig.updateAnimation(dt, elapsedSec, mode, moveSpeedNorm, reviveProgress01);
  }

  private syncActiveRigTransform(): void {
    const rig = this.rigs.get(this.activeMercenary);
    if (!rig) return;
    rig.root.position.set(this.position.x, this.position.y, this.position.z);
    rig.root.rotation.y = this.rotationY;
  }
}
