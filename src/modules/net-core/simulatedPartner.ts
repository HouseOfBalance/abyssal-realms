import type {
  DamageType,
  EmojiReactionId,
  HeroAnimState,
  HeroClassId,
  NetChatMessage,
  NetPacket,
  PairedInteractionKind,
  PetId,
  RemotePeerSnapshot,
  SkillSlotIndex,
  SocialEmoteId,
  Vec3,
  WeaponVisualType,
} from '../../contracts/types';
import { clamp, distXZ } from '../../core/Constants';
import { clonePeerSnapshot } from './wireProtocol';

interface PartnerPersona {
  nickname: string;
  defaultClass: HeroClassId;
  pet: PetId;
  preferredKind: PairedInteractionKind;
  greetings: string[];
  combatBarks: string[];
  reviveStartLines: string[];
  reviveDoneLines: string[];
  clashInviteLines: string[];
  clashAcceptLines: string[];
}

const PARTNER_PERSONAS: readonly PartnerPersona[] = [
  {
    nickname: 'Seraphina',
    defaultClass: 'arcanist',
    pet: 'celestial_owl',
    preferredKind: 'high_five',
    greetings: [
      'Seraphina reporting in! Astral wards aligned — let us shatter the Abyss together!',
      'Starlight guide our blades! Ready whenever you are, partner!',
    ],
    combatBarks: [
      'Arcane convergence primed — keep pressing them!',
      'Clean combo! Their defenses are crumbling!',
      'Astral lances locked on target — watch the flank!',
    ],
    reviveStartLines: [
      'Hold fast! Weaving a Celestial Revival seal on you right now!',
      'Stay with me, champion — I have got your back!',
    ],
    reviveDoneLines: [
      'Rise again! The Shattered Crown cannot claim us today!',
      'Back on your feet! Drink up and let us turn the tide!',
    ],
    clashInviteLines: [
      'Over here! Press [H] to clash blades for the Sworn Brethren blessing!',
      'Raise steel with me ([H]) — let us empower the party!',
    ],
    clashAcceptLines: [
      'SWORN BRETHREN! Feel that astral surge?!',
      'Glorious clash! +25% XP & Gold — nothing can stop us now!',
    ],
  },
  {
    nickname: 'Kaelen',
    defaultClass: 'shadowblade',
    pet: 'void_kitsune',
    preferredKind: 'blade_clash',
    greetings: [
      'Kaelen in the shadows! Twin daggers sharpened — point me at the nearest boss!',
      'Good to run with you! Leave the blindside crits to me.',
    ],
    combatBarks: [
      'Carving through their backline — nice rhythm!',
      'Crit after crit! Keep that momentum rolling!',
      'Nothing survives our crossfire!',
    ],
    reviveStartLines: [
      'On my way! Smoke screen down — channeling revive!',
      'Hang tight, friend! Pulling you out of the brink!',
    ],
    reviveDoneLines: [
      'Up and fighting! Let us pay them back tenfold!',
      'Still breathing! Now let us finish this!',
    ],
    clashInviteLines: [
      'Blade Clash ready! Hit [H] beside me for the Sworn Brethren buff!',
      'Up top, partner! Press [H] to lock blades!',
    ],
    clashAcceptLines: [
      'STEEL ON STEEL! Sworn Brethren awakened!',
      'Haha, what a strike! Let us tear through this floor!',
    ],
  },
  {
    nickname: 'Vaelora',
    defaultClass: 'vanguard',
    pet: 'ember_wyrmling',
    preferredKind: 'blade_clash',
    greetings: [
      'Vaelora standing vanguard! My greatsword is yours, comrade!',
      'Shield wall formed! Lead the charge into the depths!',
    ],
    combatBarks: [
      'Stand firm and cleave them down!',
      'Glorious fury! Press the assault!',
    ],
    reviveStartLines: [
      'Charging in to shield you — hold on!',
    ],
    reviveDoneLines: [
      'Stand tall, warrior! Our oath holds unbroken!',
    ],
    clashInviteLines: [
      'Cross greatswords with me ([H]) for the Sworn Brethren oath!',
    ],
    clashAcceptLines: [
      'BY CROWN AND FLAME! Sworn Brethren united!',
    ],
  },
];

function weaponForClass(heroClass: HeroClassId): WeaponVisualType {
  switch (heroClass) {
    case 'vanguard':
      return 'greatsword';
    case 'shadowblade':
      return 'daggers';
    case 'arcanist':
      return 'staff';
  }
}

function skillsForClass(
  heroClass: HeroClassId,
): Array<{ id: string; slot: SkillSlotIndex; damageType: DamageType; anim: HeroAnimState }> {
  switch (heroClass) {
    case 'vanguard':
      return [
        { id: 'cleave_strike', slot: 0, damageType: 'physical', anim: 'attack_1' },
        { id: 'infernal_whirlwind', slot: 2, damageType: 'fire', anim: 'whirlwind' },
        { id: 'titan_leap', slot: 3, damageType: 'physical', anim: 'leap_slam' },
      ];
    case 'shadowblade':
      return [
        { id: 'phantom_flurry', slot: 0, damageType: 'poison', anim: 'attack_2' },
        { id: 'void_shuriken', slot: 1, damageType: 'void', anim: 'attack_3' },
        { id: 'umbral_cascade', slot: 2, damageType: 'void', anim: 'whirlwind' },
      ];
    case 'arcanist':
      return [
        { id: 'astral_bolt', slot: 0, damageType: 'lightning', anim: 'cast' },
        { id: 'glacial_nova', slot: 1, damageType: 'ice', anim: 'cast' },
        { id: 'cataclysm_meteor', slot: 2, damageType: 'fire', anim: 'cast' },
      ];
  }
}

interface QueuedReply {
  remainingSec: number;
  text: string;
  emoji?: EmojiReactionId;
  emote?: SocialEmoteId;
  initiateHighFive?: boolean;
}

interface PendingIncomingHighFive {
  fromPeerId: string;
  fromName: string;
  kind: PairedInteractionKind;
  position: Vec3;
  delaySec: number;
}

export class SimulatedPartnerAgent {
  public readonly peerId: string;
  public readonly persona: PartnerPersona;
  public snapshot: RemotePeerSnapshot;

  private orbitAngleRad: number;
  private readonly orbitSpeedRad: number;
  private readonly basePingMs: number;
  private elapsedSec = 0;
  private combatRemainSec = 0;
  private skillCooldownSec = 0.25;
  private emoteRemainSec = 0;
  private animLockRemainSec = 0;
  private banterTimerSec: number;
  private proactiveInviteTimerSec: number;
  private outgoingInviteRemainSec = 0;

  // Revive state
  private wasLocalDowned = false;
  private reviveChannelSec = 0;
  private reviveCooldownSec = 0;

  // Paired clash state
  private pendingHighFive: PendingIncomingHighFive | null = null;
  private clashStepTarget: Vec3 | null = null;
  private clashHoldSec = 0;

  // Chat queue
  private readonly replyQueue: QueuedReply[] = [];
  private msgCounter = 0;
  private skillCycleIdx = 0;

  constructor(
    peerId: string,
    personaIndex: number,
    spawnOrigin: Vec3,
    forcedClass?: HeroClassId,
  ) {
    this.peerId = peerId;
    this.persona = PARTNER_PERSONAS[personaIndex % PARTNER_PERSONAS.length];
    const heroClass = forcedClass ?? this.persona.defaultClass;
    this.orbitAngleRad = (personaIndex * Math.PI * 2) / 3 + 0.65;
    this.orbitSpeedRad = 0.72 + (personaIndex % 3) * 0.16;
    this.basePingMs = 16 + personaIndex * 5;
    this.banterTimerSec = 18 + personaIndex * 7;
    this.proactiveInviteTimerSec = 10 + personaIndex * 9;

    const startX = spawnOrigin.x + Math.cos(this.orbitAngleRad) * 2.6;
    const startZ = spawnOrigin.z + Math.sin(this.orbitAngleRad) * 2.6;

    this.snapshot = {
      peerId,
      nickname: this.persona.nickname,
      isHost: false,
      isSimulated: true,
      heroClass,
      level: 1,
      hp: 260,
      maxHp: 260,
      position: { x: startX, y: spawnOrigin.y, z: startZ },
      velocity: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      animState: 'idle',
      socialEmote: 'wave',
      weaponVisual: weaponForClass(heroClass),
      weaponRarity: 'legendary',
      awakened: false,
      downed: false,
      activePet: this.persona.pet,
      pingMs: this.basePingMs,
    };
    this.emoteRemainSec = 2.0;
  }

  public buildJoinGreetingPackets(): NetPacket[] {
    const greeting = this.persona.greetings[0];
    return [
      this.makeChatPacket(greeting),
      { type: 'social_emote', peerId: this.peerId, emoteId: 'wave' },
      {
        type: 'emoji_burst',
        peerId: this.peerId,
        emojiId: 'fire_hype',
        position: { ...this.snapshot.position },
      },
    ];
  }

  public onLocalOutboundPacket(localPeerId: string, packet: NetPacket): NetPacket[] {
    const immediateOut: NetPacket[] = [];

    switch (packet.type) {
      case 'skill_cast': {
        this.combatRemainSec = Math.max(this.combatRemainSec, 3.2);
        break;
      }
      case 'combat_hit': {
        this.combatRemainSec = Math.max(this.combatRemainSec, 3.5);
        if (packet.killed && this.replyQueue.length === 0 && Math.sin(this.elapsedSec * 7.3) > 0.35) {
          const emojiId: EmojiReactionId = packet.isCrit ? 'fire_hype' : 'crown_gg';
          immediateOut.push({
            type: 'emoji_burst',
            peerId: this.peerId,
            emojiId,
            position: { ...this.snapshot.position },
          });
        }
        break;
      }
      case 'paired_request': {
        if (packet.fromPeerId !== this.peerId) {
          this.pendingHighFive = {
            fromPeerId: packet.fromPeerId || localPeerId,
            fromName: packet.fromName || 'Ally',
            kind: packet.kind,
            position: { ...packet.position },
            delaySec: 0.22,
          };
          this.outgoingInviteRemainSec = 0;
        }
        break;
      }
      case 'paired_accept': {
        if (packet.targetPeerId === this.peerId || this.outgoingInviteRemainSec > 0) {
          this.outgoingInviteRemainSec = 0;
          this.clashStepTarget = { ...packet.midpoint };
          this.clashHoldSec = 1.1;
          this.setEmote('high_five_strike', 1.2);
          immediateOut.push({
            type: 'emoji_burst',
            peerId: this.peerId,
            emojiId: 'crown_gg',
            position: { ...this.snapshot.position },
          });
          immediateOut.push(this.makeChatPacket(this.pickLine(this.persona.clashAcceptLines)));
        }
        break;
      }
      case 'chat_message': {
        if (
          packet.message.senderId !== this.peerId &&
          packet.message.channel === 'party' &&
          this.replyQueue.length < 2
        ) {
          this.enqueueContextualChatReply(packet.message.text, packet.message.senderName);
        }
        break;
      }
      case 'loot_gift': {
        if (packet.fromPeerId !== this.peerId) {
          this.replyQueue.push({
            remainingSec: 0.35,
            text: `Thank you for the gift, ${packet.fromName}! May fortune bless our run!`,
            emoji: 'heart_thanks',
            emote: 'cheer',
          });
        }
        break;
      }
      case 'tactical_ping': {
        if (packet.peerId !== this.peerId && this.replyQueue.length === 0) {
          const emojiMap: Record<typeof packet.pingType, EmojiReactionId> = {
            attack: 'swords_boss',
            loot: 'chest_loot',
            danger: 'skull_danger',
            group: 'fire_hype',
          };
          immediateOut.push({
            type: 'emoji_burst',
            peerId: this.peerId,
            emojiId: emojiMap[packet.pingType],
            position: { ...this.snapshot.position },
          });
        }
        break;
      }
      case 'emoji_burst': {
        if (
          packet.peerId !== this.peerId &&
          (packet.emojiId === 'crown_gg' || packet.emojiId === 'fire_hype') &&
          this.emoteRemainSec <= 0
        ) {
          this.setEmote('cheer', 1.5);
        }
        break;
      }
      default:
        break;
    }

    return immediateOut;
  }

  public update(dt: number, localSnapshot: RemotePeerSnapshot): NetPacket[] {
    const safeDt = clamp(dt, 0, 0.25);
    if (safeDt <= 0) return [];

    this.elapsedSec += safeDt;
    const emitted: NetPacket[] = [];

    // Sync level & health scaling with host player
    const targetLevel = Math.max(1, localSnapshot.level || 1);
    if (this.snapshot.level !== targetLevel) {
      this.snapshot.level = targetLevel;
      this.snapshot.maxHp = 220 + targetLevel * 42;
      this.snapshot.hp = this.snapshot.maxHp;
    } else if (this.snapshot.hp < this.snapshot.maxHp) {
      this.snapshot.hp = Math.min(this.snapshot.maxHp, this.snapshot.hp + safeDt * 14);
    }

    // Gentle realistic ping jitter (e.g., 15..24ms)
    this.snapshot.pingMs =
      this.basePingMs + Math.round(Math.sin(this.elapsedSec * 1.9) * 2 + 1);

    // Mirror awakening hype briefly
    this.snapshot.awakened = Boolean(localSnapshot.awakened);

    // Tick timers
    if (this.reviveCooldownSec > 0) this.reviveCooldownSec = Math.max(0, this.reviveCooldownSec - safeDt);
    if (this.combatRemainSec > 0) this.combatRemainSec = Math.max(0, this.combatRemainSec - safeDt);
    if (this.skillCooldownSec > 0) this.skillCooldownSec = Math.max(0, this.skillCooldownSec - safeDt);
    if (this.animLockRemainSec > 0) this.animLockRemainSec = Math.max(0, this.animLockRemainSec - safeDt);
    if (this.clashHoldSec > 0) this.clashHoldSec = Math.max(0, this.clashHoldSec - safeDt);

    if (this.emoteRemainSec > 0) {
      this.emoteRemainSec -= safeDt;
      if (this.emoteRemainSec <= 0) {
        this.emoteRemainSec = 0;
        if (this.snapshot.socialEmote !== 'revive_channel' && this.outgoingInviteRemainSec <= 0) {
          this.snapshot.socialEmote = null;
        }
      }
    }

    if (this.outgoingInviteRemainSec > 0) {
      this.outgoingInviteRemainSec -= safeDt;
      if (this.outgoingInviteRemainSec <= 0) {
        this.outgoingInviteRemainSec = 0;
        if (this.snapshot.socialEmote === 'high_five_ready') {
          this.snapshot.socialEmote = null;
        }
      }
    }

    // Detect if host entered combat via animState
    if (
      localSnapshot.animState === 'attack_1' ||
      localSnapshot.animState === 'attack_2' ||
      localSnapshot.animState === 'attack_3' ||
      localSnapshot.animState === 'whirlwind' ||
      localSnapshot.animState === 'leap_slam' ||
      localSnapshot.animState === 'cast'
    ) {
      this.combatRemainSec = Math.max(this.combatRemainSec, 2.6);
    }

    // Also detect host High-Five pose directly on snapshot if paired_request wasn't sent yet
    if (
      localSnapshot.socialEmote === 'high_five_ready' &&
      !this.pendingHighFive &&
      !localSnapshot.downed &&
      this.clashHoldSec <= 0
    ) {
      this.pendingHighFive = {
        fromPeerId: localSnapshot.peerId,
        fromName: localSnapshot.nickname || 'Ally',
        kind: this.persona.preferredKind,
        position: { ...localSnapshot.position },
        delaySec: 0.2,
      };
    }

    // Teleport snap if player changed floors or warped far away (> 20m)
    const distToPlayer = distXZ(this.snapshot.position, localSnapshot.position);
    if (distToPlayer > 20) {
      this.snapshot.position.x = localSnapshot.position.x + Math.cos(this.orbitAngleRad) * 2.5;
      this.snapshot.position.y = localSnapshot.position.y;
      this.snapshot.position.z = localSnapshot.position.z + Math.sin(this.orbitAngleRad) * 2.5;
      this.snapshot.velocity = { x: 0, y: 0, z: 0 };
    }

    // -------------------------------------------------------------------------
    // PRIORITY 1: Emergency Downed Teammate Rescue -> `revive_complete`
    // -------------------------------------------------------------------------
    if (localSnapshot.downed && this.reviveCooldownSec <= 0) {
      if (!this.wasLocalDowned) {
        this.wasLocalDowned = true;
        this.reviveChannelSec = 0;
        this.pendingHighFive = null;
        this.outgoingInviteRemainSec = 0;
        this.snapshot.socialEmote = null;
        emitted.push(this.makeChatPacket(this.pickLine(this.persona.reviveStartLines)));
        emitted.push({
          type: 'emoji_burst',
          peerId: this.peerId,
          emojiId: 'sos_help',
          position: { ...this.snapshot.position },
        });
      }

      const rescueDist = distXZ(this.snapshot.position, localSnapshot.position);
      if (rescueDist > 2.1) {
        // Sprint urgently to downed ally
        this.snapshot.socialEmote = null;
        this.moveToward(localSnapshot.position, 10.5, safeDt, 1.5);
        this.snapshot.animState = 'run';
      } else {
        // Channel golden celestial revive
        this.snapshot.velocity = { x: 0, y: 0, z: 0 };
        this.faceToward(localSnapshot.position);
        this.snapshot.animState = 'cast';
        this.snapshot.socialEmote = 'revive_channel';
        this.reviveChannelSec += safeDt;

        const requiredChannel =
          localSnapshot.downedBleedoutSec !== undefined && localSnapshot.downedBleedoutSec < 2.2
            ? 0.4
            : 0.9;

        if (this.reviveChannelSec >= requiredChannel) {
          this.reviveChannelSec = 0;
          this.reviveCooldownSec = 2.0;
          this.setEmote('cheer', 1.4);
          this.snapshot.animState = 'idle';

          emitted.push({
            type: 'revive_complete',
            saviorPeerId: this.peerId,
            revivedPeerId: localSnapshot.peerId,
          });
          emitted.push({
            type: 'emoji_burst',
            peerId: this.peerId,
            emojiId: 'crown_gg',
            position: { ...this.snapshot.position },
          });
          emitted.push(this.makeChatPacket(this.pickLine(this.persona.reviveDoneLines)));
        }
      }

      this.flushReplyQueue(safeDt, localSnapshot, emitted);
      return emitted;
    }

    if (!localSnapshot.downed && this.wasLocalDowned) {
      this.wasLocalDowned = false;
      this.reviveChannelSec = 0;
      if (this.snapshot.socialEmote === 'revive_channel') {
        this.snapshot.socialEmote = null;
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 2: Accept Pending High-Five / Blade Clash (`paired_request`)
    // -------------------------------------------------------------------------
    if (this.pendingHighFive) {
      const req = this.pendingHighFive;
      // Keep tracking fresh player pos if nearby
      const anchorPos =
        distXZ(req.position, localSnapshot.position) < 6 ? localSnapshot.position : req.position;
      const dist = distXZ(this.snapshot.position, anchorPos);

      if (dist > 3.2) {
        this.moveToward(anchorPos, 9.2, safeDt, 1.8);
        this.snapshot.animState = 'run';
      } else {
        this.faceToward(anchorPos);
        this.snapshot.velocity = { x: 0, y: 0, z: 0 };
        req.delaySec -= safeDt;
        if (req.delaySec <= 0) {
          const midpoint: Vec3 = {
            x: (anchorPos.x + this.snapshot.position.x) * 0.5,
            y: anchorPos.y,
            z: (anchorPos.z + this.snapshot.position.z) * 0.5,
          };
          this.pendingHighFive = null;
          this.clashStepTarget = midpoint;
          this.clashHoldSec = 1.0;
          this.setEmote('high_five_strike', 1.2);
          this.snapshot.animState = 'leap_slam';
          this.animLockRemainSec = 0.7;

          emitted.push({
            type: 'paired_accept',
            fromPeerId: this.peerId,
            targetPeerId: req.fromPeerId,
            kind: req.kind,
            midpoint,
          });
          emitted.push({
            type: 'emoji_burst',
            peerId: this.peerId,
            emojiId: 'crown_gg',
            position: { ...midpoint },
          });
          emitted.push(this.makeChatPacket(this.pickLine(this.persona.clashAcceptLines)));
        }
      }

      this.flushReplyQueue(safeDt, localSnapshot, emitted);
      return emitted;
    }

    // Hold position briefly during clash strike celebration
    if (this.clashHoldSec > 0 && this.clashStepTarget) {
      this.moveToward(this.clashStepTarget, 7.5, safeDt, 0.5);
      this.faceToward(localSnapshot.position);
      this.flushReplyQueue(safeDt, localSnapshot, emitted);
      return emitted;
    }

    // -------------------------------------------------------------------------
    // PRIORITY 3: Orbit, Flank & Fight Alongside Host
    // -------------------------------------------------------------------------
    const angularRate = this.combatRemainSec > 0 ? this.orbitSpeedRad * 1.85 : this.orbitSpeedRad * 0.55;
    this.orbitAngleRad = (this.orbitAngleRad + safeDt * angularRate) % (Math.PI * 2);

    const desiredRadius = this.outgoingInviteRemainSec > 0 ? 2.3 : this.combatRemainSec > 0 ? 3.1 : 2.85;
    const targetPos: Vec3 = {
      x: localSnapshot.position.x + Math.cos(this.orbitAngleRad) * desiredRadius,
      y: localSnapshot.position.y,
      z: localSnapshot.position.z + Math.sin(this.orbitAngleRad) * desiredRadius,
    };

    const moveSpeed = this.combatRemainSec > 0 ? 7.4 : 6.2;
    const movedSpeed = this.moveToward(targetPos, moveSpeed, safeDt, 0.25);

    if (this.combatRemainSec > 0) {
      // Cast skills & swing weapons alongside player
      const combatForwardAngle = localSnapshot.rotationY;
      const aimTarget: Vec3 = {
        x: localSnapshot.position.x + Math.sin(combatForwardAngle) * 5.0,
        y: localSnapshot.position.y,
        z: localSnapshot.position.z + Math.cos(combatForwardAngle) * 5.0,
      };
      this.faceToward(aimTarget);

      if (this.skillCooldownSec <= 0) {
        const kit = skillsForClass(this.snapshot.heroClass);
        const chosen = kit[this.skillCycleIdx % kit.length];
        this.skillCycleIdx++;
        this.skillCooldownSec = 1.05;
        this.animLockRemainSec = 0.45;
        this.snapshot.animState = chosen.anim;
        this.snapshot.socialEmote = null;

        const dx = aimTarget.x - this.snapshot.position.x;
        const dz = aimTarget.z - this.snapshot.position.z;
        const len = Math.hypot(dx, dz) || 1;
        const facingDir: Vec3 = { x: dx / len, y: 0, z: dz / len };

        emitted.push({
          type: 'skill_cast',
          peerId: this.peerId,
          slot: chosen.slot,
          skillId: chosen.id,
          damageType: chosen.damageType,
          origin: { ...this.snapshot.position },
          facingDir,
          targetPos: aimTarget,
        });
      } else if (this.animLockRemainSec <= 0) {
        this.snapshot.animState = movedSpeed > 0.6 ? 'run' : 'idle';
      }
    } else {
      if (this.outgoingInviteRemainSec > 0) {
        this.faceToward(localSnapshot.position);
        this.snapshot.animState = 'idle';
      } else if (movedSpeed > 0.55) {
        if (this.animLockRemainSec <= 0) {
          this.snapshot.animState = 'run';
        }
      } else {
        this.faceToward(localSnapshot.position);
        if (this.animLockRemainSec <= 0) {
          this.snapshot.animState = 'idle';
        }
      }
    }

    // -------------------------------------------------------------------------
    // PRIORITY 4: Proactive High-Five Invite & Ambient Co-op Banter
    // -------------------------------------------------------------------------
    this.proactiveInviteTimerSec -= safeDt;
    if (
      this.proactiveInviteTimerSec <= 0 &&
      this.combatRemainSec <= 0 &&
      this.outgoingInviteRemainSec <= 0 &&
      distToPlayer <= 4.0
    ) {
      this.proactiveInviteTimerSec = 34;
      this.initiateProactiveHighFive(emitted);
    }

    this.banterTimerSec -= safeDt;
    if (this.banterTimerSec <= 0) {
      this.banterTimerSec = 26;
      const emoji: EmojiReactionId = this.combatRemainSec > 0 ? 'fire_hype' : 'crown_gg';
      emitted.push({
        type: 'emoji_burst',
        peerId: this.peerId,
        emojiId: emoji,
        position: { ...this.snapshot.position },
      });
      if (this.combatRemainSec > 0) {
        emitted.push(this.makeChatPacket(this.pickLine(this.persona.combatBarks)));
      }
    }

    this.flushReplyQueue(safeDt, localSnapshot, emitted);
    return emitted;
  }

  public getSnapshot(): RemotePeerSnapshot {
    return clonePeerSnapshot(this.snapshot);
  }

  private initiateProactiveHighFive(emitted: NetPacket[]): void {
    this.outgoingInviteRemainSec = 6.0;
    this.setEmote('high_five_ready', 6.0);
    emitted.push({
      type: 'paired_request',
      fromPeerId: this.peerId,
      fromName: this.snapshot.nickname,
      kind: this.persona.preferredKind,
      position: { ...this.snapshot.position },
    });
    emitted.push({
      type: 'emoji_burst',
      peerId: this.peerId,
      emojiId: 'fire_hype',
      position: { ...this.snapshot.position },
    });
    emitted.push(this.makeChatPacket(this.pickLine(this.persona.clashInviteLines)));
  }

  private enqueueContextualChatReply(rawText: string, senderName: string): void {
    const lower = rawText.trim().toLowerCase();
    const ally = senderName || 'friend';

    let replyText = `Right behind you, ${ally}! Our party stands unbroken!`;
    let emoji: EmojiReactionId | undefined = 'fire_hype';
    let emote: SocialEmoteId | undefined;
    let initiateHighFive = false;

    if (/\b(hi|hello|hey|yo|chao|chào|alo)\b/.test(lower)) {
      replyText = `Well met, ${ally}! ${this.snapshot.nickname} is ready to conquer the Abyss with you!`;
      emoji = 'crown_gg';
      emote = 'wave';
    } else if (/\b(gg|nice|ez|win|hay|đỉnh|dinh|great|awesome)\b/.test(lower)) {
      replyText = `GG ${ally}! Flawless execution — the Shattered Crown trembles!`;
      emoji = 'crown_gg';
      emote = 'cheer';
    } else if (/\b(high|five|clash|dap kiem|đập kiếm|sworn|buff)\b/.test(lower)) {
      replyText = `Let us clash steel right now, ${ally}! Press [H]!`;
      emoji = 'fire_hype';
      initiateHighFive = true;
    } else if (/\b(help|cuu|cứu|heal|low|sos|danger)\b/.test(lower)) {
      replyText = `On your flank, ${ally}! Stay close — I will cover you!`;
      emoji = 'swords_boss';
    } else if (/\b(loot|drop|mythic|legendary|gold|item|chest|đồ|vàng)\b/.test(lower)) {
      replyText = `May the RNG gods bless us with Primal Mythics on this floor!`;
      emoji = 'chest_loot';
      emote = 'cheer';
    } else if (/\b(dance|party|chill|nhảy|vibe)\b/.test(lower)) {
      replyText = `Haha, Sanctuary tavern vibes! Watch these steps!`;
      emoji = 'laugh_imp';
      emote = 'dance';
    } else if (/\b(boss|butcher|malakor|valkyria|chronos)\b/.test(lower)) {
      replyText = `Save your parry and Awakening for the boss phase shift — we have got this!`;
      emoji = 'swords_boss';
    }

    this.replyQueue.push({
      remainingSec: 0.35,
      text: replyText,
      emoji,
      emote,
      initiateHighFive,
    });
  }

  private flushReplyQueue(
    dt: number,
    localSnapshot: RemotePeerSnapshot,
    emitted: NetPacket[],
  ): void {
    if (this.replyQueue.length === 0) return;
    const head = this.replyQueue[0];
    head.remainingSec -= dt;
    if (head.remainingSec > 0) return;

    this.replyQueue.shift();
    emitted.push(this.makeChatPacket(head.text));
    if (head.emoji) {
      emitted.push({
        type: 'emoji_burst',
        peerId: this.peerId,
        emojiId: head.emoji,
        position: { ...this.snapshot.position },
      });
    }
    if (head.emote) {
      this.setEmote(head.emote, 2.4);
      emitted.push({
        type: 'social_emote',
        peerId: this.peerId,
        emoteId: head.emote,
      });
    }
    if (head.initiateHighFive && !localSnapshot.downed) {
      this.initiateProactiveHighFive(emitted);
    }
  }

  private moveToward(target: Vec3, maxSpeed: number, dt: number, stopRadius: number): number {
    const dx = target.x - this.snapshot.position.x;
    const dz = target.z - this.snapshot.position.z;
    const dist = Math.hypot(dx, dz);
    this.snapshot.position.y = target.y;

    if (dist <= stopRadius || dist < 1e-4) {
      this.snapshot.velocity = { x: 0, y: 0, z: 0 };
      return 0;
    }

    const step = Math.min(dist - stopRadius * 0.5, maxSpeed * dt);
    const nx = dx / dist;
    const nz = dz / dist;
    this.snapshot.position.x += nx * step;
    this.snapshot.position.z += nz * step;
    const actualSpeed = step / Math.max(dt, 1e-4);
    this.snapshot.velocity = { x: nx * actualSpeed, y: 0, z: nz * actualSpeed };
    this.snapshot.rotationY = Math.atan2(nx, nz);
    return actualSpeed;
  }

  private faceToward(target: Vec3): void {
    const dx = target.x - this.snapshot.position.x;
    const dz = target.z - this.snapshot.position.z;
    if (Math.hypot(dx, dz) > 0.01) {
      this.snapshot.rotationY = Math.atan2(dx, dz);
    }
  }

  private setEmote(emote: SocialEmoteId, durationSec: number): void {
    this.snapshot.socialEmote = emote;
    this.emoteRemainSec = durationSec;
  }

  private makeChatPacket(text: string): NetPacket {
    this.msgCounter++;
    const message: NetChatMessage = {
      id: `${this.peerId}-msg-${Date.now()}-${this.msgCounter}`,
      senderId: this.peerId,
      senderName: this.snapshot.nickname,
      heroClass: this.snapshot.heroClass,
      channel: 'party',
      text,
      timestamp: Date.now(),
    };
    return { type: 'chat_message', message };
  }

  private pickLine(lines: readonly string[]): string {
    const idx = Math.floor(this.elapsedSec * 3.7 + this.msgCounter) % lines.length;
    return lines[Math.max(0, idx)];
  }
}
