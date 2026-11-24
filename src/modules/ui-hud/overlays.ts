import type {
  DamageType,
  ElementalReactionType,
  EliteAffix,
  EnemyEntity,
  GroundLootDrop,
  HudSnapshot,
  ICameraRig,
  InteractableProp,
  ItemRarity,
  StatusEffectType,
  Vec3,
} from '../../contracts/types';
import { DAMAGE_TYPE_COLORS, MYTHIC_COLOR, RARITY_COLORS, clamp, distXZ } from '../../core/Constants';
import { renderInteractableSvg } from './icons';

interface PooledDamageNumber {
  active: boolean;
  el: HTMLDivElement;
  worldPos: Vec3;
  amount: number;
  isCrit: boolean;
  damageType: DamageType;
  isPlayerHit: boolean;
  age: number;
  duration: number;
  velX: number;
  jitterX: number;
}

interface PooledEnemyOverhead {
  el: HTMLDivElement;
  nameEl: HTMLDivElement;
  affixEl: HTMLDivElement;
  fillEl: HTMLDivElement;
  statusWrapEl: HTMLDivElement;
  dots: HTMLSpanElement[];
  lastElite: boolean;
  lastName: string;
  lastAffix: string;
  lastHpPct: number;
}

interface PooledLootLabel {
  el: HTMLDivElement;
  gemEl: HTMLSpanElement;
  textEl: HTMLSpanElement;
  lastSignature: string;
}

interface ActiveToast {
  el: HTMLDivElement;
  remainingSec: number;
  leaving: boolean;
}

interface PooledFlyingLootOrb {
  active: boolean;
  el: HTMLDivElement;
  coreEl: HTMLDivElement;
  startX: number;
  startY: number;
  getTarget: () => { x: number; y: number };
  colorCss: string;
  age: number;
  duration: number;
  onArrive: ((colorCss: string) => void) | null;
}

interface PooledReactionCallout {
  active: boolean;
  el: HTMLDivElement;
  titleEl: HTMLSpanElement;
  dmgEl: HTMLSpanElement;
  worldPos: Vec3;
  age: number;
  duration: number;
}

const DAMAGE_POOL_SIZE = 64;
const ENEMY_BAR_POOL_SIZE = 28;
const LOOT_LABEL_POOL_SIZE = 24;
const FLYING_ORB_POOL_SIZE = 12;
const REACTION_POOL_SIZE = 16;

const REACTION_STYLES: Record<ElementalReactionType, { label: string; color: string }> = {
  shatter: { label: '\u2744 PHÁ BĂNG!', color: '#74c0fc' },
  volatile_blast: { label: '\u2739 BÙNG NỔ!', color: '#ff922b' },
  superconduct: { label: '\u26A1 SIÊU DẪN!', color: '#ffd43b' },
  abyssal_singularity: { label: '\u2726 DỊ ĐIỂM HƯ KHÔNG!', color: '#e599f7' },
};

const AFFIX_LABELS: Record<EliteAffix, string> = {
  vampiric: 'Hút Máu',
  molten: 'Nóng Chảy',
  frozen_pulse: 'Xung Băng',
  teleporter: 'Dịch Chuyển',
  berserker: 'Cuồng Bạo',
  arcane_enchanted: 'Ma Pháp',
};

const STATUS_DOT_COLORS: Record<StatusEffectType, string> = {
  burn: '#ff6b35',
  chill: '#74c0fc',
  freeze: '#3bc9db',
  poison: '#69db7c',
  bleed: '#e03131',
  stun: '#ffd43b',
  vulnerable: '#ff8787',
  shield: '#a5d8ff',
  haste: '#63e6be',
};

const BANNER_TONES: Record<
  'gold' | 'crimson' | 'arcane' | 'emerald',
  { accent: string; glow: string }
> = {
  gold: { accent: '#ffd97d', glow: 'rgba(200, 155, 60, 0.72)' },
  crimson: { accent: '#ff6b6b', glow: 'rgba(201, 42, 42, 0.78)' },
  arcane: { accent: '#e599f7', glow: 'rgba(156, 54, 181, 0.78)' },
  emerald: { accent: '#69db7c', glow: 'rgba(47, 158, 68, 0.75)' },
};

export class WorldOverlayManager {
  private worldLayer: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private bannerTitleEl: HTMLDivElement;
  private bannerSubEl: HTMLDivElement;
  private toastStackEl: HTMLDivElement;

  private interactEl: HTMLDivElement;
  private interactIconEl: HTMLSpanElement;
  private interactLabelEl: HTMLDivElement;
  private interactSubEl: HTMLDivElement;
  private lastInteractId = '';

  private dmgPool: PooledDamageNumber[] = [];
  private dmgCursor = 0;
  private jitterSeed = 1;

  private enemyBars: PooledEnemyOverhead[] = [];
  private lootLabels: PooledLootLabel[] = [];

  private bannerTimerSec = 0;
  private activeToasts: ActiveToast[] = [];

  private flyingOrbs: PooledFlyingLootOrb[] = [];
  private flyingOrbCursor = 0;

  private gearChipEl: HTMLDivElement;
  private gearTitleEl: HTMLDivElement;
  private gearMetaEl: HTMLDivElement;
  private gearTimerSec = 0;

  private reactionPool: PooledReactionCallout[] = [];
  private reactionCursor = 0;
  private executePromptEl: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.worldLayer = document.createElement('div');
    this.worldLayer.className = 'ar-world-layer';
    root.appendChild(this.worldLayer);

    // Pre-allocate Enemy Overhead HP Bars
    for (let i = 0; i < ENEMY_BAR_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ar-enemy-overhead';

      const nameEl = document.createElement('div');
      nameEl.className = 'ar-enemy-overhead-name';
      const affixEl = document.createElement('div');
      affixEl.className = 'ar-enemy-overhead-affixes';

      const trackEl = document.createElement('div');
      trackEl.className = 'ar-enemy-hp-track';
      const fillEl = document.createElement('div');
      fillEl.className = 'ar-enemy-hp-fill';
      trackEl.appendChild(fillEl);

      const statusWrapEl = document.createElement('div');
      statusWrapEl.className = 'ar-enemy-statuses';
      const dots: HTMLSpanElement[] = [];
      for (let d = 0; d < 4; d++) {
        const dot = document.createElement('span');
        dot.className = 'ar-enemy-status-dot';
        dot.style.display = 'none';
        statusWrapEl.appendChild(dot);
        dots.push(dot);
      }

      el.append(nameEl, affixEl, trackEl, statusWrapEl);
      this.worldLayer.appendChild(el);
      this.enemyBars.push({
        el,
        nameEl,
        affixEl,
        fillEl,
        statusWrapEl,
        dots,
        lastElite: false,
        lastName: '',
        lastAffix: '',
        lastHpPct: -1,
      });
    }

    // Pre-allocate Ground Loot Labels
    for (let i = 0; i < LOOT_LABEL_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ar-loot-pill';
      const gemEl = document.createElement('span');
      gemEl.className = 'ar-loot-gem';
      const textEl = document.createElement('span');
      el.append(gemEl, textEl);
      this.worldLayer.appendChild(el);
      this.lootLabels.push({ el, gemEl, textEl, lastSignature: '' });
    }

    // Pre-allocate Floating Damage Numbers
    for (let i = 0; i < DAMAGE_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ar-dmg-num';
      this.worldLayer.appendChild(el);
      this.dmgPool.push({
        active: false,
        el,
        worldPos: { x: 0, y: 0, z: 0 },
        amount: 0,
        isCrit: false,
        damageType: 'physical',
        isPlayerHit: false,
        age: 0,
        duration: 0.95,
        velX: 0,
        jitterX: 0,
      });
    }

    // [F] Interact Pill
    this.interactEl = document.createElement('div');
    this.interactEl.className = 'ar-interact-pill';
    const keyEl = document.createElement('span');
    keyEl.className = 'ar-interact-key';
    keyEl.textContent = 'F';
    this.interactIconEl = document.createElement('span');
    const textWrap = document.createElement('div');
    textWrap.className = 'ar-interact-text-wrap';
    this.interactLabelEl = document.createElement('div');
    this.interactLabelEl.className = 'ar-interact-label';
    this.interactSubEl = document.createElement('div');
    this.interactSubEl.className = 'ar-interact-sub';
    textWrap.append(this.interactLabelEl, this.interactSubEl);
    this.interactEl.append(keyEl, this.interactIconEl, textWrap);
    this.worldLayer.appendChild(this.interactEl);

    // Center Banner
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'ar-center-banner';
    const topRule = document.createElement('div');
    topRule.className = 'ar-banner-rule';
    this.bannerTitleEl = document.createElement('div');
    this.bannerTitleEl.className = 'ar-banner-title';
    this.bannerSubEl = document.createElement('div');
    this.bannerSubEl.className = 'ar-banner-sub';
    const botRule = document.createElement('div');
    botRule.className = 'ar-banner-rule';
    this.bannerEl.append(topRule, this.bannerTitleEl, this.bannerSubEl, botRule);
    root.appendChild(this.bannerEl);

    // Bottom-Left Toast Stack
    this.toastStackEl = document.createElement('div');
    this.toastStackEl.className = 'ar-toast-stack';
    root.appendChild(this.toastStackEl);

    // Pre-allocate Flying Loot-to-Bag Orbs
    for (let i = 0; i < FLYING_ORB_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ar-flying-loot-orb';
      const coreEl = document.createElement('div');
      coreEl.className = 'ar-flying-loot-core';
      el.appendChild(coreEl);
      root.appendChild(el);
      this.flyingOrbs.push({
        active: false,
        el,
        coreEl,
        startX: 0,
        startY: 0,
        getTarget: () => ({ x: 0, y: 0 }),
        colorCss: '#ffd43b',
        age: 0,
        duration: 0.48,
        onArrive: null,
      });
    }

    // Floating Weapon / Gear Swap Micro-Banner
    this.gearChipEl = document.createElement('div');
    this.gearChipEl.className = 'ar-gear-swap-chip';
    const gearDiamond = document.createElement('span');
    gearDiamond.className = 'ar-gear-swap-diamond';
    const gearTextCol = document.createElement('div');
    this.gearTitleEl = document.createElement('div');
    this.gearTitleEl.className = 'ar-gear-swap-title';
    this.gearMetaEl = document.createElement('div');
    this.gearMetaEl.className = 'ar-gear-swap-meta';
    gearTextCol.append(this.gearTitleEl, this.gearMetaEl);
    this.gearChipEl.append(gearDiamond, gearTextCol);
    root.appendChild(this.gearChipEl);

    // Pooled Elemental Reaction Callouts
    for (let i = 0; i < REACTION_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ar-reaction-callout';
      const titleEl = document.createElement('span');
      const dmgEl = document.createElement('span');
      dmgEl.className = 'ar-reaction-dmg';
      el.append(titleEl, dmgEl);
      this.worldLayer.appendChild(el);
      this.reactionPool.push({
        active: false,
        el,
        titleEl,
        dmgEl,
        worldPos: { x: 0, y: 0, z: 0 },
        age: 0,
        duration: 1.15,
      });
    }

    // World-Space Stagger Execute Prompt
    this.executePromptEl = document.createElement('div');
    this.executePromptEl.className = 'ar-execute-prompt';
    this.executePromptEl.textContent = '\u26A1 [F / LMB] KẾT LIỄU!';
    this.worldLayer.appendChild(this.executePromptEl);
  }

  private nextPseudoOffset(): number {
    this.jitterSeed = (this.jitterSeed * 1664525 + 1013904223) >>> 0;
    return (this.jitterSeed / 4294967296) * 2 - 1;
  }

  public spawnDamageNumber(
    worldPos: Vec3,
    amount: number,
    isCrit: boolean,
    damageType: DamageType,
    isPlayerHit = false,
  ): void {
    // Pick next inactive slot or recycle oldest slot via ring cursor
    let item: PooledDamageNumber | null = null;
    for (let i = 0; i < DAMAGE_POOL_SIZE; i++) {
      const idx = (this.dmgCursor + i) % DAMAGE_POOL_SIZE;
      if (!this.dmgPool[idx].active) {
        item = this.dmgPool[idx];
        this.dmgCursor = (idx + 1) % DAMAGE_POOL_SIZE;
        break;
      }
    }
    if (!item) {
      item = this.dmgPool[this.dmgCursor];
      this.dmgCursor = (this.dmgCursor + 1) % DAMAGE_POOL_SIZE;
    }

    item.active = true;
    item.worldPos.x = Number.isFinite(worldPos.x) ? worldPos.x : 0;
    item.worldPos.y = Number.isFinite(worldPos.y) ? worldPos.y : 0;
    item.worldPos.z = Number.isFinite(worldPos.z) ? worldPos.z : 0;
    item.amount = Number.isFinite(amount) ? Math.round(amount) : 0;
    item.isCrit = Boolean(isCrit);
    item.damageType = damageType;
    item.isPlayerHit = Boolean(isPlayerHit);
    item.age = 0;
    item.duration = isCrit ? 1.22 : 0.92;
    item.jitterX = this.nextPseudoOffset() * 18;
    item.velX = this.nextPseudoOffset() * 26;

    const el = item.el;
    el.classList.toggle('ar-crit', item.isCrit && item.amount > 0);
    el.classList.toggle('ar-player-hit', item.isPlayerHit && item.amount > 0);
    el.classList.toggle('ar-dodged', item.amount <= 0);

    if (item.amount <= 0) {
      el.textContent = 'DODGE';
    } else {
      const formatted = item.amount.toLocaleString();
      if (item.isCrit) {
        el.textContent = `\u2726 ${formatted}!`;
      } else if (item.isPlayerHit) {
        el.textContent = `-${formatted}`;
      } else {
        el.textContent = formatted;
      }
      el.style.color = DAMAGE_TYPE_COLORS[damageType]?.css ?? '#f1e9d2';
    }
    el.style.opacity = '0';
  }

  public showBanner(
    title: string,
    subtitle = '',
    tone: 'gold' | 'crimson' | 'arcane' | 'emerald' = 'gold',
  ): void {
    const palette = BANNER_TONES[tone] ?? BANNER_TONES.gold;
    this.bannerEl.style.setProperty('--banner-accent', palette.accent);
    this.bannerEl.style.setProperty('--banner-glow', palette.glow);
    this.bannerTitleEl.textContent = title;
    this.bannerSubEl.textContent = subtitle;
    this.bannerSubEl.style.display = subtitle ? 'block' : 'none';
    this.bannerEl.classList.add('ar-visible');
    this.bannerTimerSec = 3.4;
  }

  public showToast(message: string, rarity?: ItemRarity): void {
    const card = document.createElement('div');
    card.className = 'ar-toast-card';
    const color = rarity ? (RARITY_COLORS[rarity]?.css ?? '#c89b3c') : '#c89b3c';
    card.style.borderLeftColor = color;

    const gem = document.createElement('span');
    gem.className = 'ar-loot-gem';
    gem.style.background = color;
    gem.style.boxShadow = `0 0 8px ${color}`;

    const text = document.createElement('span');
    text.textContent = message;
    if (rarity === 'legendary' || rarity === 'epic') {
      text.style.color = color;
    }

    card.append(gem, text);
    this.toastStackEl.appendChild(card);
    this.activeToasts.push({ el: card, remainingSec: 3.8, leaving: false });

    // Cap visible stack to 5 cards
    while (this.activeToasts.length > 5) {
      const oldest = this.activeToasts.shift();
      oldest?.el.remove();
    }
  }

  public spawnFlyingLootToBag(
    startScreen: { x: number; y: number },
    getTarget: () => { x: number; y: number },
    rarity: ItemRarity,
    onArrive?: (colorCss: string) => void,
    overrideColorCss?: string,
  ): void {
    let orb: PooledFlyingLootOrb | null = null;
    for (let i = 0; i < FLYING_ORB_POOL_SIZE; i++) {
      const idx = (this.flyingOrbCursor + i) % FLYING_ORB_POOL_SIZE;
      if (!this.flyingOrbs[idx].active) {
        orb = this.flyingOrbs[idx];
        this.flyingOrbCursor = (idx + 1) % FLYING_ORB_POOL_SIZE;
        break;
      }
    }
    if (!orb) {
      orb = this.flyingOrbs[this.flyingOrbCursor];
      this.flyingOrbCursor = (this.flyingOrbCursor + 1) % FLYING_ORB_POOL_SIZE;
    }

    const colorCss = overrideColorCss ?? RARITY_COLORS[rarity]?.css ?? '#ffd43b';
    orb.active = true;
    orb.startX = Number.isFinite(startScreen.x) ? startScreen.x : 640;
    orb.startY = Number.isFinite(startScreen.y) ? startScreen.y : 380;
    orb.getTarget = getTarget;
    orb.colorCss = colorCss;
    orb.age = 0;
    orb.duration = 0.48;
    orb.onArrive = onArrive ?? null;

    orb.coreEl.style.background = colorCss;
    orb.el.style.background = `radial-gradient(circle, ${colorCss}aa 0%, transparent 72%)`;
    orb.el.style.boxShadow = `0 0 16px ${colorCss}`;
    orb.el.style.opacity = '1';
    orb.el.style.transform = `translate3d(${orb.startX.toFixed(1)}px, ${orb.startY.toFixed(1)}px, 0) translate(-50%, -50%) scale(0.75)`;
  }

  public showGearSwapBanner(
    title: string,
    meta: string,
    rarity: ItemRarity = 'common',
    overrideColorCss?: string,
  ): void {
    const colorCss = overrideColorCss ?? RARITY_COLORS[rarity]?.css ?? '#f1e9d2';
    this.gearChipEl.style.setProperty('--gear-accent', colorCss);
    this.gearChipEl.style.setProperty('--gear-glow', `${colorCss}66`);
    this.gearTitleEl.textContent = title;
    this.gearMetaEl.textContent = meta;
    this.gearChipEl.classList.add('ar-visible');
    this.gearTimerSec = 2.35;
  }

  public spawnReactionCallout(
    worldPos: Vec3,
    reaction: ElementalReactionType,
    damage: number,
  ): void {
    let slot: PooledReactionCallout | null = null;
    for (let i = 0; i < REACTION_POOL_SIZE; i++) {
      const idx = (this.reactionCursor + i) % REACTION_POOL_SIZE;
      if (!this.reactionPool[idx].active) {
        slot = this.reactionPool[idx];
        this.reactionCursor = (idx + 1) % REACTION_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.reactionPool[this.reactionCursor];
      this.reactionCursor = (this.reactionCursor + 1) % REACTION_POOL_SIZE;
    }

    const style = REACTION_STYLES[reaction] ?? REACTION_STYLES.shatter;
    slot.active = true;
    slot.worldPos.x = Number.isFinite(worldPos?.x) ? worldPos.x : 0;
    slot.worldPos.y = Number.isFinite(worldPos?.y) ? worldPos.y : 0;
    slot.worldPos.z = Number.isFinite(worldPos?.z) ? worldPos.z : 0;
    slot.age = 0;
    slot.duration = 1.2;

    slot.titleEl.textContent = style.label;
    slot.el.style.color = style.color;
    if (damage > 0 && Number.isFinite(damage)) {
      slot.dmgEl.textContent = `+${Math.round(damage).toLocaleString()}`;
      slot.dmgEl.style.display = 'block';
    } else {
      slot.dmgEl.style.display = 'none';
    }
    slot.el.style.opacity = '0';
  }

  public update(
    dt: number,
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    const safeDt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;

    this.updateBannerAndToasts(safeDt);
    this.updateFlyingLootOrbs(safeDt);
    this.updateDamageNumbers(safeDt, worldToScreen);
    this.updateReactionCallouts(safeDt, worldToScreen);
    this.updateEnemyOverheads(snapshot, worldToScreen);
    this.updateExecutePrompt(snapshot, worldToScreen);
    this.updateGroundLootLabels(snapshot, worldToScreen);
    this.updateInteractPrompt(snapshot.nearbyInteractable, worldToScreen);
  }

  private updateBannerAndToasts(dt: number): void {
    if (this.bannerTimerSec > 0) {
      this.bannerTimerSec -= dt;
      if (this.bannerTimerSec <= 0) {
        this.bannerEl.classList.remove('ar-visible');
      }
    }

    if (this.gearTimerSec > 0) {
      this.gearTimerSec -= dt;
      if (this.gearTimerSec <= 0) {
        this.gearChipEl.classList.remove('ar-visible');
      }
    }

    for (let i = this.activeToasts.length - 1; i >= 0; i--) {
      const t = this.activeToasts[i];
      t.remainingSec -= dt;
      if (t.remainingSec <= 0.26 && !t.leaving) {
        t.leaving = true;
        t.el.classList.add('ar-toast-leaving');
      }
      if (t.remainingSec <= 0) {
        t.el.remove();
        this.activeToasts.splice(i, 1);
      }
    }
  }

  private updateDamageNumbers(
    dt: number,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    for (let i = 0; i < DAMAGE_POOL_SIZE; i++) {
      const item = this.dmgPool[i];
      if (!item.active) continue;

      item.age += dt;
      if (item.age >= item.duration) {
        item.active = false;
        item.el.style.opacity = '0';
        continue;
      }

      const proj = worldToScreen({
        x: item.worldPos.x,
        y: item.worldPos.y + (item.isPlayerHit ? 1.85 : 1.55),
        z: item.worldPos.z,
      });

      if (!proj.visible || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) {
        item.el.style.opacity = '0';
        continue;
      }

      const t = clamp(item.age / item.duration, 0, 1);
      const easeOut = 1 - (1 - t) * (1 - t);
      const yDrift = item.isPlayerHit ? -28 * easeOut : -62 * easeOut;
      const xDrift = item.jitterX + item.velX * item.age;

      let scale = 1;
      if (item.isCrit && item.amount > 0) {
        if (t < 0.13) {
          scale = 0.55 + (t / 0.13) * 1.1; // pop to 1.65x
        } else if (t < 0.3) {
          scale = 1.65 - ((t - 0.13) / 0.17) * 0.45; // settle to 1.2x
        } else {
          scale = 1.2 - ((t - 0.3) / 0.7) * 0.2;
        }
      } else {
        scale = t < 0.1 ? 0.72 + (t / 0.1) * 0.36 : 1.08 - ((t - 0.1) / 0.9) * 0.16;
      }

      const opacity = t < 0.7 ? 1 : clamp(1 - (t - 0.7) / 0.3, 0, 1);
      const sx = proj.x + xDrift;
      const sy = proj.y + yDrift;

      item.el.style.opacity = opacity.toFixed(2);
      item.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }

  private updateEnemyOverheads(
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    const activeBossId = snapshot.boss?.entity.id ?? '';
    const playerPos = snapshot.player.position;

    // Collect candidates: living non-boss enemies that are elite or damaged
    const candidates: Array<{ enemy: EnemyEntity; dist: number }> = [];
    for (const enemy of snapshot.enemies) {
      if (!enemy.alive || enemy.hp <= 0 || enemy.maxHp <= 0) continue;
      if (enemy.id === activeBossId || enemy.isBoss) continue;
      if (!enemy.isElite && enemy.hp >= enemy.maxHp) continue;

      const d = distXZ(enemy.position, playerPos);
      if (d > 36) continue;
      candidates.push({ enemy, dist: d });
    }

    // Prioritize Elites first, then closest to player
    candidates.sort((a, b) => {
      if (a.enemy.isElite !== b.enemy.isElite) return a.enemy.isElite ? -1 : 1;
      return a.dist - b.dist;
    });

    let used = 0;
    for (let i = 0; i < candidates.length && used < ENEMY_BAR_POOL_SIZE; i++) {
      const { enemy } = candidates[i];
      const headHeight = Math.max(1.9, enemy.radius * 2.5 + (enemy.isElite ? 0.45 : 0.15));
      const proj = worldToScreen({
        x: enemy.position.x,
        y: enemy.position.y + headHeight,
        z: enemy.position.z,
      });

      if (!proj.visible || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) continue;

      const slot = this.enemyBars[used++];
      if (slot.lastElite !== enemy.isElite) {
        slot.lastElite = enemy.isElite;
        slot.el.classList.toggle('ar-is-elite', enemy.isElite);
      }

      if (enemy.isElite) {
        const displayName = `\u265B ${enemy.name}`;
        if (slot.lastName !== displayName) {
          slot.lastName = displayName;
          slot.nameEl.textContent = displayName;
          slot.nameEl.style.display = 'block';
        }
        const affixStr = enemy.affixes.map((a) => AFFIX_LABELS[a] ?? a).join(' \u2022 ');
        if (slot.lastAffix !== affixStr) {
          slot.lastAffix = affixStr;
          slot.affixEl.textContent = affixStr;
          slot.affixEl.style.display = affixStr ? 'block' : 'none';
        }
      } else {
        if (slot.lastName !== '') {
          slot.lastName = '';
          slot.nameEl.style.display = 'none';
        }
        if (slot.lastAffix !== '') {
          slot.lastAffix = '';
          slot.affixEl.style.display = 'none';
        }
      }

      const pct = clamp((enemy.hp / Math.max(1, enemy.maxHp)) * 100, 0, 100);
      const roundedPct = Math.round(pct * 2) / 2;
      if (slot.lastHpPct !== roundedPct) {
        slot.lastHpPct = roundedPct;
        slot.fillEl.style.width = `${roundedPct}%`;
      }

      // Status dots (up to 4)
      for (let d = 0; d < 4; d++) {
        const st = enemy.statuses[d];
        const dot = slot.dots[d];
        if (st && st.remainingSec > 0) {
          dot.style.display = 'inline-block';
          dot.style.background = STATUS_DOT_COLORS[st.type] ?? '#ffd43b';
        } else {
          dot.style.display = 'none';
        }
      }

      slot.el.style.opacity = '1';
      slot.el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }

    for (let i = used; i < ENEMY_BAR_POOL_SIZE; i++) {
      this.enemyBars[i].el.style.opacity = '0';
    }
  }

  private updateGroundLootLabels(
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    const playerPos = snapshot.player.position;
    const rarityOrder: Record<ItemRarity, number> = {
      legendary: 5,
      epic: 4,
      rare: 3,
      uncommon: 2,
      common: 1,
    };

    const visibleDrops: Array<{
      drop: GroundLootDrop;
      sx: number;
      sy: number;
      priority: number;
    }> = [];

    for (const drop of snapshot.groundDrops) {
      if (drop.pickedUp) continue;
      if (distXZ(drop.position, playerPos) > 26) continue;

      const proj = worldToScreen({
        x: drop.position.x,
        y: drop.position.y + 0.85,
        z: drop.position.z,
      });
      if (!proj.visible || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) continue;

      const priority =
        drop.kind === 'item' && drop.item
          ? (drop.item.isMythic ? 70 : rarityOrder[drop.item.rarity] * 10)
          : drop.kind === 'rune'
            ? 45
            : drop.kind === 'potion'
              ? 15
              : 5;
      visibleDrops.push({ drop, sx: proj.x, sy: proj.y, priority });
    }

    visibleDrops.sort((a, b) => b.priority - a.priority || b.sy - a.sy);
    const chosen = visibleDrops.slice(0, LOOT_LABEL_POOL_SIZE);

    // Sort bottom-to-top and nudge overlapping pills upward cleanly
    chosen.sort((a, b) => b.sy - a.sy);
    for (let i = 1; i < chosen.length; i++) {
      for (let j = 0; j < i; j++) {
        if (
          Math.abs(chosen[i].sx - chosen[j].sx) < 108 &&
          Math.abs(chosen[i].sy - chosen[j].sy) < 23
        ) {
          chosen[i].sy = chosen[j].sy - 24;
        }
      }
    }

    for (let i = 0; i < chosen.length; i++) {
      const { drop, sx, sy } = chosen[i];
      const slot = this.lootLabels[i];

      const sig = `${drop.id}:${drop.item?.upgradeLevel ?? 0}:${drop.item?.isMythic ? 1 : 0}:${drop.runeId ?? ''}:${drop.amount ?? 0}`;
      if (slot.lastSignature !== sig) {
        slot.lastSignature = sig;
        slot.el.classList.remove(
          'ar-rarity-mythic',
          'ar-rarity-legendary',
          'ar-rarity-epic',
          'ar-rarity-rune',
        );

        if (drop.kind === 'item' && drop.item) {
          const item = drop.item;
          const color = item.isMythic
            ? MYTHIC_COLOR.css
            : item.setName
              ? '#40c057'
              : (RARITY_COLORS[item.rarity]?.css ?? '#d0d0d0');
          const upg = item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : '';
          const star = item.isMythic
            ? '\u2726 [MYTHIC] '
            : item.rarity === 'legendary'
              ? '\u2605 '
              : item.rarity === 'epic'
                ? '\u25C6 '
                : '';
          slot.textEl.textContent = `${star}${item.runewordName ?? item.name}${upg}`;
          slot.textEl.style.color = color;
          slot.el.style.borderColor = `${color}99`;
          slot.el.style.borderLeftColor = color;
          slot.gemEl.style.background = color;
          if (item.isMythic) slot.el.classList.add('ar-rarity-mythic');
          else if (item.rarity === 'legendary') slot.el.classList.add('ar-rarity-legendary');
          else if (item.rarity === 'epic') slot.el.classList.add('ar-rarity-epic');
        } else if (drop.kind === 'rune') {
          const runeName = (drop.runeId ?? 'sol').toUpperCase();
          slot.textEl.textContent = `\u25C8 ${runeName} RUNE`;
          slot.textEl.style.color = '#ffe066';
          slot.el.style.borderColor = 'rgba(255, 224, 102, 0.65)';
          slot.el.style.borderLeftColor = '#ffe066';
          slot.gemEl.style.background = '#ffe066';
          slot.el.classList.add('ar-rarity-rune');
        } else if (drop.kind === 'gold') {
          slot.textEl.textContent = `${drop.amount ?? 1} Vàng`;
          slot.textEl.style.color = '#ffd43b';
          slot.el.style.borderColor = 'rgba(255, 212, 59, 0.45)';
          slot.el.style.borderLeftColor = '#ffd43b';
          slot.gemEl.style.background = '#ffd43b';
        } else if (drop.kind === 'potion') {
          slot.textEl.textContent = 'Bình Máu Đỏ';
          slot.textEl.style.color = '#ff8787';
          slot.el.style.borderColor = 'rgba(255, 107, 107, 0.5)';
          slot.el.style.borderLeftColor = '#ff6b6b';
          slot.gemEl.style.background = '#ff6b6b';
        } else {
          slot.textEl.textContent = 'Ngọc Huyết';
          slot.textEl.style.color = '#ffa8a8';
          slot.el.style.borderColor = 'rgba(224, 49, 49, 0.45)';
          slot.el.style.borderLeftColor = '#e03131';
          slot.gemEl.style.background = '#e03131';
        }
      }

      slot.el.style.opacity = '1';
      slot.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }

    for (let i = chosen.length; i < LOOT_LABEL_POOL_SIZE; i++) {
      this.lootLabels[i].el.style.opacity = '0';
    }
  }

  private updateReactionCallouts(
    dt: number,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    for (let i = 0; i < REACTION_POOL_SIZE; i++) {
      const slot = this.reactionPool[i];
      if (!slot.active) continue;

      slot.age += dt;
      if (slot.age >= slot.duration) {
        slot.active = false;
        slot.el.style.opacity = '0';
        continue;
      }

      const proj = worldToScreen({
        x: slot.worldPos.x,
        y: slot.worldPos.y + 2.25,
        z: slot.worldPos.z,
      });
      if (!proj.visible || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) {
        slot.el.style.opacity = '0';
        continue;
      }

      const t = clamp(slot.age / slot.duration, 0, 1);
      const scale = t < 0.14 ? 0.6 + (t / 0.14) * 0.72 : 1.32 - ((t - 0.14) / 0.86) * 0.28;
      const yLift = -48 * (1 - (1 - t) * (1 - t));
      const opacity = t < 0.72 ? 1 : clamp(1 - (t - 0.72) / 0.28, 0, 1);

      slot.el.style.opacity = opacity.toFixed(2);
      slot.el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${(proj.y + yLift).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }

  private updateExecutePrompt(
    snapshot: HudSnapshot,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    const targetId = snapshot.mastery?.canExecuteTargetId;
    if (!targetId) {
      this.executePromptEl.style.opacity = '0';
      return;
    }

    let target: EnemyEntity | undefined = snapshot.enemies.find(
      (e) => e.id === targetId && e.alive && e.hp > 0,
    );
    if (!target && snapshot.boss?.entity.id === targetId && snapshot.boss.entity.alive) {
      target = snapshot.boss.entity;
    }
    if (!target) {
      this.executePromptEl.style.opacity = '0';
      return;
    }

    const proj = worldToScreen({
      x: target.position.x,
      y: target.position.y + Math.max(2.4, target.radius * 2.8),
      z: target.position.z,
    });
    if (!proj.visible || !Number.isFinite(proj.x) || !Number.isFinite(proj.y)) {
      this.executePromptEl.style.opacity = '0';
      return;
    }

    this.executePromptEl.style.opacity = '1';
    this.executePromptEl.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  private updateInteractPrompt(
    prop: InteractableProp | null,
    worldToScreen: ICameraRig['worldToScreen'],
  ): void {
    const reusable =
      prop &&
      (prop.type === 'blacksmith_anvil' ||
        prop.type === 'portal_next_floor' ||
        prop.type === 'stash_chest' ||
        prop.type === 'gambler_npc' ||
        prop.type === 'companion_shrine' ||
        prop.type === 'waypoint_map' ||
        prop.type === 'training_dummy');
    if (!prop || (prop.used && !reusable)) {
      this.interactEl.style.opacity = '0';
      return;
    }

    if (this.lastInteractId !== `${prop.id}:${prop.label}`) {
      this.lastInteractId = `${prop.id}:${prop.label}`;
      this.interactIconEl.innerHTML = renderInteractableSvg(prop.type);
      this.interactLabelEl.textContent = prop.label || 'Interact';
      this.interactSubEl.textContent = this.getInteractHint(prop.type);
    }

    const proj = worldToScreen({
      x: prop.position.x,
      y: prop.position.y + 1.85,
      z: prop.position.z,
    });

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const sx = proj.visible && Number.isFinite(proj.x) ? clamp(proj.x, 120, vw - 120) : vw * 0.5;
    const sy =
      proj.visible && Number.isFinite(proj.y) ? clamp(proj.y, 80, vh - 175) : vh * 0.68;

    this.interactEl.style.opacity = '1';
    this.interactEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  private getInteractHint(type: InteractableProp['type']): string {
    switch (type) {
      case 'cursed_chest':
        return 'Kích Hoạt Thử Thách Nguyền Rủa';
      case 'chest':
        return 'Mở Kho Báu';
      case 'shrine_heal':
        return 'Hồi Phục Sinh Lực';
      case 'shrine_power':
        return 'Phước Lành Sức Mạnh';
      case 'shrine_frenzy':
        return 'Phước Lành Tốc Độ';
      case 'portal_next_floor':
        return 'Tiến Xuống Tầng Sâu';
      case 'lore_tome':
        return 'Đọc Biên Niên Sử Cổ';
      case 'stash_chest':
        return 'Mở Kho Đồ Chung';
      case 'gambler_npc':
        return 'Cược Vàng & Tế Đàn Máu';
      case 'companion_shrine':
        return 'Triệu Hồi Thú Cưng & Lính Đánh Thuê';
      case 'waypoint_map':
        return 'Mở Bản Đồ Thế Giới';
      case 'training_dummy':
        return 'Thử Nghiệm Sát Thương DPS';
      case 'corrupted_obelisk':
        return 'Chọn Hiệp Ước Obelisk';
      case 'soul_lantern':
        return 'Bắt Đầu Hộ Tống Linh Hồn';
      case 'rift_breach':
        return 'Xé Mở Khe Nứt Thời Gian';
      case 'blacksmith_anvil':
      default:
        return 'Rèn & Phân Giải';
    }
  }

  private updateFlyingLootOrbs(dt: number): void {
    for (let i = 0; i < FLYING_ORB_POOL_SIZE; i++) {
      const orb = this.flyingOrbs[i];
      if (!orb.active) continue;

      orb.age += dt;
      if (orb.age >= orb.duration) {
        orb.active = false;
        orb.el.style.opacity = '0';
        if (orb.onArrive) {
          const cb = orb.onArrive;
          orb.onArrive = null;
          cb(orb.colorCss);
        }
        continue;
      }

      const t = clamp(orb.age / orb.duration, 0, 1);
      const u = t < 0.3 ? (t / 0.3) * 0.22 : 0.22 + Math.pow((t - 0.3) / 0.7, 1.45) * 0.78;
      const target = orb.getTarget();
      const sx = orb.startX;
      const sy = orb.startY;
      const ex = target.x;
      const ey = target.y;

      const cx = (sx + ex) * 0.5 + (sx <= ex ? -42 : 42);
      const cy = Math.min(sy, ey) - 135;

      const inv = 1 - u;
      const bx = inv * inv * sx + 2 * inv * u * cx + u * u * ex;
      const by = inv * inv * sy + 2 * inv * u * cy + u * u * ey;

      const scale = t < 0.35 ? 0.75 + (t / 0.35) * 0.5 : 1.25 - ((t - 0.35) / 0.65) * 0.7;
      const rot = u * 540;
      orb.el.style.opacity = '1';
      orb.el.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(2)}) rotate(${rot.toFixed(0)}deg)`;
    }
  }

  public dispose(): void {
    this.activeToasts.length = 0;
    this.worldLayer.remove();
    this.bannerEl.remove();
    this.toastStackEl.remove();
    this.gearChipEl.remove();
    for (const orb of this.flyingOrbs) {
      orb.active = false;
      orb.el.remove();
    }
    for (const r of this.reactionPool) {
      r.active = false;
      r.el.remove();
    }
  }
}
