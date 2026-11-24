import type {
  BiomeId,
  DungeonFloorData,
  DungeonRoom,
  HudSnapshot,
  TileType,
  Vec3,
} from '../../contracts/types';
import { MYTHIC_COLOR, RARITY_COLORS, distXZ } from '../../core/Constants';

interface FloorGridCalibration {
  floorNumber: number;
  seed: number;
  cols: number;
  rows: number;
  rowMajor: boolean;
  originX: number;
  originZ: number;
  stepX: number;
  stepZ: number;
}

const BIOME_FLOOR_COLORS: Record<BiomeId, { floor: string; corridor: string; wall: string }> = {
  sanctuary: { floor: '#28324a', corridor: '#212a3f', wall: '#a3b3d4' },
  crypt: { floor: '#1d2436', corridor: '#171d2c', wall: '#636e85' },
  caverns: { floor: '#162b22', corridor: '#12231b', wall: '#527a66' },
  forge: { floor: '#2e1a16', corridor: '#241411', wall: '#8c5845' },
  void: { floor: '#221638', corridor: '#1a112c', wall: '#7c5ca8' },
  cathedral: { floor: '#152b40', corridor: '#102132', wall: '#7cc0e8' },
  observatory: { floor: '#1f1c3b', corridor: '#18152e', wall: '#d4a84f' },
  colosseum: { floor: '#38161b', corridor: '#2b1014', wall: '#b8725c' },
};

export class MinimapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private logicalW = 206;
  private logicalH = 196;
  private dpr = 1;
  private calibration: FloorGridCalibration | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    this.syncCanvasResolution();
  }

  private syncCanvasResolution(): void {
    const ratio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? Math.min(2, Math.max(1, window.devicePixelRatio))
        : 1;
    if (
      this.dpr !== ratio ||
      this.canvas.width !== Math.round(this.logicalW * ratio) ||
      this.canvas.height !== Math.round(this.logicalH * ratio)
    ) {
      this.dpr = ratio;
      this.canvas.width = Math.round(this.logicalW * ratio);
      this.canvas.height = Math.round(this.logicalH * ratio);
    }
  }

  private calibrateFloor(floor: DungeonFloorData): FloorGridCalibration {
    if (
      this.calibration &&
      this.calibration.floorNumber === floor.floorNumber &&
      this.calibration.seed === floor.seed &&
      this.calibration.cols === floor.cols &&
      this.calibration.rows === floor.rows
    ) {
      return this.calibration;
    }

    let rowMajor = true;
    const outerLen = floor.tiles.length;
    const innerLen = floor.tiles[0]?.length ?? 0;

    if (outerLen === floor.rows && innerLen === floor.cols && floor.rows !== floor.cols) {
      rowMajor = true;
    } else if (outerLen === floor.cols && innerLen === floor.rows && floor.rows !== floor.cols) {
      rowMajor = false;
    } else {
      // Square grid: check room centers where col !== row
      let rowMajorHits = 0;
      let colMajorHits = 0;
      for (const room of floor.rooms) {
        const { col, row } = room.centerGrid;
        if (col === row) continue;
        const rm = floor.tiles[row]?.[col];
        const cm = floor.tiles[col]?.[row];
        if (rm && rm !== 'void' && rm !== 'wall') rowMajorHits++;
        if (cm && cm !== 'void' && cm !== 'wall') colMajorHits++;
      }
      if (colMajorHits > rowMajorHits) {
        rowMajor = false;
      }
    }

    const p00 = floor.gridToWorld(0, 0);
    const p10 = floor.gridToWorld(1, 0);
    const p01 = floor.gridToWorld(0, 1);
    const stepX = Math.abs(p10.x - p00.x) > 1e-4 ? p10.x - p00.x : floor.tileSize || 2;
    const stepZ = Math.abs(p01.z - p00.z) > 1e-4 ? p01.z - p00.z : floor.tileSize || 2;

    this.calibration = {
      floorNumber: floor.floorNumber,
      seed: floor.seed,
      cols: floor.cols,
      rows: floor.rows,
      rowMajor,
      originX: p00.x,
      originZ: p00.z,
      stepX,
      stepZ,
    };
    return this.calibration;
  }

  private worldToFracGrid(
    pos: Vec3,
    floor: DungeonFloorData,
    cal: FloorGridCalibration,
  ): { col: number; row: number } {
    if (Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
      return {
        col: (pos.x - cal.originX) / cal.stepX,
        row: (pos.z - cal.originZ) / cal.stepZ,
      };
    }
    const g = floor.worldToGrid(pos);
    return { col: g.col, row: g.row };
  }

  private getTile(
    floor: DungeonFloorData,
    cal: FloorGridCalibration,
    col: number,
    row: number,
  ): TileType {
    if (col < 0 || row < 0 || col >= floor.cols || row >= floor.rows) return 'void';
    return cal.rowMajor
      ? (floor.tiles[row]?.[col] ?? 'void')
      : (floor.tiles[col]?.[row] ?? 'void');
  }

  private isExplored(
    floor: DungeonFloorData,
    cal: FloorGridCalibration,
    col: number,
    row: number,
  ): boolean {
    if (col < 0 || row < 0 || col >= floor.cols || row >= floor.rows) return false;
    return cal.rowMajor
      ? Boolean(floor.explored[row]?.[col])
      : Boolean(floor.explored[col]?.[row]);
  }

  private isWalkableTile(t: TileType): boolean {
    return (
      t === 'floor' ||
      t === 'corridor' ||
      t === 'door' ||
      t === 'hazard_lava' ||
      t === 'hazard_poison' ||
      t === 'hazard_ice' ||
      t === 'teleporter_pad'
    );
  }

  private hasAdjacentExploredWalkable(
    floor: DungeonFloorData,
    cal: FloorGridCalibration,
    col: number,
    row: number,
  ): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (this.isExplored(floor, cal, nc, nr)) {
          const nt = this.getTile(floor, cal, nc, nr);
          if (this.isWalkableTile(nt)) return true;
        }
      }
    }
    return false;
  }

  public render(snapshot: HudSnapshot, elapsedSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    this.syncCanvasResolution();
    const { floor, player, enemies, groundDrops, boss } = snapshot;
    const cal = this.calibrateFloor(floor);

    const w = this.logicalW;
    const h = this.logicalH;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const tilePx = 3.6;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Background & subtle radar ring
    ctx.fillStyle = '#060509';
    ctx.fillRect(0, 0, w, h);

    const palette = BIOME_FLOOR_COLORS[floor.biome] ?? BIOME_FLOOR_COLORS.crypt;
    const bgGrad = ctx.createRadialGradient(cx, cy, 8, cx, cy, w * 0.6);
    bgGrad.addColorStop(0, 'rgba(200, 155, 60, 0.06)');
    bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const pGrid = this.worldToFracGrid(player.position, floor, cal);
    const halfCols = Math.ceil(cx / tilePx) + 2;
    const halfRows = Math.ceil(cy / tilePx) + 2;

    const minCol = Math.max(0, Math.floor(pGrid.col - halfCols));
    const maxCol = Math.min(floor.cols - 1, Math.ceil(pGrid.col + halfCols));
    const minRow = Math.max(0, Math.floor(pGrid.row - halfRows));
    const maxRow = Math.min(floor.rows - 1, Math.ceil(pGrid.row + halfRows));

    // 2. Explored Tiles & Perimeter Walls
    for (let r = minRow; r <= maxRow; r++) {
      const sy = cy + (r - pGrid.row) * tilePx - tilePx * 0.5;
      for (let c = minCol; c <= maxCol; c++) {
        const tile = this.getTile(floor, cal, c, r);
        const explored = this.isExplored(floor, cal, c, r);
        const sx = cx + (c - pGrid.col) * tilePx - tilePx * 0.5;

        if (explored && this.isWalkableTile(tile)) {
          if (tile === 'door') {
            ctx.fillStyle = '#c89b3c';
          } else if (tile === 'hazard_lava') {
            ctx.fillStyle = '#d9480f';
          } else if (tile === 'hazard_poison') {
            ctx.fillStyle = '#2b8a3e';
          } else if (tile === 'hazard_ice') {
            ctx.fillStyle = '#339af0';
          } else if (tile === 'teleporter_pad') {
            ctx.fillStyle = '#be4bdb';
          } else if (tile === 'corridor') {
            ctx.fillStyle = palette.corridor;
          } else {
            ctx.fillStyle = palette.floor;
          }
          ctx.fillRect(sx, sy, tilePx + 0.45, tilePx + 0.45);
        } else if (
          (tile === 'wall' && (explored || this.hasAdjacentExploredWalkable(floor, cal, c, r))) ||
          (tile === 'void' && this.hasAdjacentExploredWalkable(floor, cal, c, r))
        ) {
          ctx.fillStyle = palette.wall;
          ctx.fillRect(sx, sy, tilePx + 0.25, tilePx + 0.25);
        }
      }
    }

    // 3. Room Icons (for discovered rooms)
    for (const room of floor.rooms) {
      if (room.type === 'combat') continue;
      if (!this.isRoomDiscovered(room, floor, cal)) continue;

      const sx = cx + (room.centerGrid.col - pGrid.col) * tilePx;
      const sy = cy + (room.centerGrid.row - pGrid.row) * tilePx;
      if (sx < -12 || sx > w + 12 || sy < -12 || sy > h + 12) continue;

      ctx.save();
      if (room.cleared && room.type !== 'spawn' && room.type !== 'boss') {
        ctx.globalAlpha = 0.45;
      }
      this.drawRoomMarker(ctx, room.type, sx, sy, elapsedSec);
      ctx.restore();
    }

    // 4. Interactables (Chests, Shrines, Hub Stations, Obelisks, Rifts, Portal)
    for (const prop of floor.interactables) {
      const isPersistentStation =
        prop.type === 'blacksmith_anvil' ||
        prop.type === 'portal_next_floor' ||
        prop.type === 'stash_chest' ||
        prop.type === 'gambler_npc' ||
        prop.type === 'companion_shrine' ||
        prop.type === 'waypoint_map' ||
        prop.type === 'training_dummy';
      if (prop.used && !isPersistentStation) {
        continue;
      }
      const g = this.worldToFracGrid(prop.position, floor, cal);
      const gc = Math.round(g.col);
      const gr = Math.round(g.row);
      if (!this.isExplored(floor, cal, gc, gr) && !this.hasAdjacentExploredWalkable(floor, cal, gc, gr)) {
        continue;
      }

      const sx = cx + (g.col - pGrid.col) * tilePx;
      const sy = cy + (g.row - pGrid.row) * tilePx;
      if (sx < 4 || sx > w - 4 || sy < 4 || sy > h - 4) continue;

      this.drawInteractableMarker(ctx, prop.type, sx, sy, elapsedSec);
    }

    // 5. High-value Ground Loot Drops (Rare+, Mythic, & Runes)
    for (const drop of groundDrops) {
      if (drop.pickedUp) continue;
      if (drop.kind === 'rune') {
        const g = this.worldToFracGrid(drop.position, floor, cal);
        const sx = cx + (g.col - pGrid.col) * tilePx;
        const sy = cy + (g.row - pGrid.row) * tilePx;
        if (sx >= 4 && sx <= w - 4 && sy >= 4 && sy <= h - 4) {
          this.drawDiamond(ctx, sx, sy, 3.8, '#ffe066', '#ffffff');
        }
        continue;
      }
      if (drop.kind !== 'item' || !drop.item) continue;
      const rarity = drop.item.rarity;
      if (!drop.item.isMythic && (rarity === 'common' || rarity === 'uncommon')) continue;

      const g = this.worldToFracGrid(drop.position, floor, cal);
      const sx = cx + (g.col - pGrid.col) * tilePx;
      const sy = cy + (g.row - pGrid.row) * tilePx;
      if (sx < 4 || sx > w - 4 || sy < 4 || sy > h - 4) continue;

      const color = drop.item.isMythic
        ? MYTHIC_COLOR.css
        : (RARITY_COLORS[rarity]?.css ?? '#ff922b');
      this.drawStar(ctx, sx, sy, drop.item.isMythic ? 5.2 : 4, color);
    }

    // 6. Living Enemies (Red Dots & Elite Diamonds)
    for (const enemy of enemies) {
      if (!enemy.alive || enemy.hp <= 0) continue;
      if (boss && boss.entity.id === enemy.id) continue;

      const g = this.worldToFracGrid(enemy.position, floor, cal);
      const gc = Math.round(g.col);
      const gr = Math.round(g.row);
      const nearPlayer = distXZ(enemy.position, player.position) <= 22;
      if (!nearPlayer && !this.isExplored(floor, cal, gc, gr)) continue;

      const sx = cx + (g.col - pGrid.col) * tilePx;
      const sy = cy + (g.row - pGrid.row) * tilePx;
      if (sx < 3 || sx > w - 3 || sy < 3 || sy > h - 3) continue;

      if (enemy.isBoss || enemy.archetype === 'the_butcher') {
        this.drawBossSkull(ctx, sx, sy, elapsedSec);
      } else if (enemy.archetype === 'treasure_goblin') {
        this.drawDiamond(ctx, sx, sy, 4.2, '#ffd43b', '#ffffff');
      } else if (enemy.id === 'training_dummy') {
        this.drawDiamond(ctx, sx, sy, 3.4, '#adb5bd', '#ffd43b');
      } else if (enemy.isElite) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#e599f7';
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = 1.2;
        ctx.fillRect(-3.1, -3.1, 6.2, 6.2);
        ctx.strokeRect(-3.1, -3.1, 6.2, 6.2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, 2.35, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4d4f';
        ctx.fill();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = '#2b0508';
        ctx.stroke();
      }
    }

    // 7. Active Boss Skull Marker
    if (boss && boss.entity.alive && boss.entity.hp > 0) {
      const bg = this.worldToFracGrid(boss.entity.position, floor, cal);
      const bsx = Math.max(9, Math.min(w - 9, cx + (bg.col - pGrid.col) * tilePx));
      const bsy = Math.max(9, Math.min(h - 9, cy + (bg.row - pGrid.row) * tilePx));
      this.drawBossSkull(ctx, bsx, bsy, elapsedSec);
    }

    // 8. Player Directional Arrow at Center
    const fx = Number.isFinite(player.facingDir.x) ? player.facingDir.x : 0;
    const fz = Number.isFinite(player.facingDir.z) ? player.facingDir.z : 0;
    const angle =
      Math.hypot(fx, fz) > 1e-3
        ? Math.atan2(fx, -fz)
        : Math.atan2(Math.sin(player.rotationY), -Math.cos(player.rotationY));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Subtle view cone
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 18, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 224, 138, 0.14)';
    ctx.fill();

    // Crisp player chevron arrow
    ctx.beginPath();
    ctx.moveTo(0, -6.8);
    ctx.lineTo(5.2, 5.4);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-5.2, 5.4);
    ctx.closePath();
    ctx.fillStyle = '#fff3bf';
    ctx.strokeStyle = '#140f07';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 9. Vignette rim
    ctx.strokeStyle = 'rgba(200, 155, 60, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    ctx.restore();
  }

  private isRoomDiscovered(
    room: DungeonRoom,
    floor: DungeonFloorData,
    cal: FloorGridCalibration,
  ): boolean {
    if (this.isExplored(floor, cal, room.centerGrid.col, room.centerGrid.row)) {
      return true;
    }
    const stepX = Math.max(1, Math.floor(room.width / 3));
    const stepY = Math.max(1, Math.floor(room.height / 3));
    for (let r = room.y; r < room.y + room.height; r += stepY) {
      for (let c = room.x; c < room.x + room.width; c += stepX) {
        if (this.isExplored(floor, cal, c, r)) return true;
      }
    }
    return false;
  }

  private drawRoomMarker(
    ctx: CanvasRenderingContext2D,
    type: DungeonRoom['type'],
    x: number,
    y: number,
    elapsedSec: number,
  ): void {
    switch (type) {
      case 'boss':
        this.drawBossSkull(ctx, x, y, elapsedSec);
        break;
      case 'spawn':
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(64, 192, 87, 0.28)';
        ctx.fill();
        ctx.strokeStyle = '#69db7c';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        break;
      case 'treasure':
        ctx.fillStyle = '#ffd43b';
        ctx.strokeStyle = '#1f1605';
        ctx.lineWidth = 1;
        ctx.fillRect(x - 3.5, y - 2.8, 7, 5.6);
        ctx.strokeRect(x - 3.5, y - 2.8, 7, 5.6);
        break;
      case 'shrine':
        this.drawDiamond(ctx, x, y, 4.2, '#4dabf7', '#e7f5ff');
        break;
      case 'cursed_event':
        this.drawDiamond(ctx, x, y, 4.5, '#e03131', '#ffd43b');
        break;
      case 'elite':
        this.drawStar(ctx, x, y, 4.5, '#da77f2');
        break;
      case 'trap':
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 4, y + 3.5);
        ctx.lineTo(x - 4, y + 3.5);
        ctx.closePath();
        ctx.fillStyle = '#ff922b';
        ctx.fill();
        break;
      default:
        break;
    }
  }

  private drawInteractableMarker(
    ctx: CanvasRenderingContext2D,
    type: DungeonFloorData['interactables'][number]['type'],
    x: number,
    y: number,
    elapsedSec: number,
  ): void {
    switch (type) {
      case 'chest':
        ctx.fillStyle = '#fcc419';
        ctx.strokeStyle = '#120d04';
        ctx.lineWidth = 1;
        ctx.fillRect(x - 3, y - 2.5, 6, 5);
        ctx.strokeRect(x - 3, y - 2.5, 6, 5);
        break;
      case 'cursed_chest': {
        const pulse = 0.85 + 0.2 * Math.sin(elapsedSec * 5);
        ctx.fillStyle = '#ff4d4f';
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = 1.1;
        ctx.fillRect(x - 3.2 * pulse, y - 2.6 * pulse, 6.4 * pulse, 5.2 * pulse);
        ctx.strokeRect(x - 3.2 * pulse, y - 2.6 * pulse, 6.4 * pulse, 5.2 * pulse);
        break;
      }
      case 'shrine_heal':
        this.drawDiamond(ctx, x, y, 3.6, '#51cf66', '#ffffff');
        break;
      case 'shrine_power':
        this.drawDiamond(ctx, x, y, 3.6, '#ffd43b', '#ffffff');
        break;
      case 'shrine_frenzy':
        this.drawDiamond(ctx, x, y, 3.6, '#cc5de8', '#ffffff');
        break;
      case 'portal_next_floor': {
        const r = 4.2 + 0.8 * Math.sin(elapsedSec * 4);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#e599f7';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#74c0fc';
        ctx.fill();
        break;
      }
      case 'blacksmith_anvil':
        ctx.fillStyle = '#dee2e6';
        ctx.strokeStyle = '#212529';
        ctx.lineWidth = 1;
        ctx.fillRect(x - 3, y - 2, 6, 4);
        ctx.strokeRect(x - 3, y - 2, 6, 4);
        break;
      case 'lore_tome':
        this.drawDiamond(ctx, x, y, 3.1, '#b197fc', '#1a1228');
        break;
      case 'stash_chest':
        ctx.fillStyle = '#74c0fc';
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = 1.1;
        ctx.fillRect(x - 3.2, y - 2.6, 6.4, 5.2);
        ctx.strokeRect(x - 3.2, y - 2.6, 6.4, 5.2);
        break;
      case 'gambler_npc':
        this.drawDiamond(ctx, x, y, 3.8, '#e599f7', '#ffd43b');
        break;
      case 'companion_shrine':
        this.drawDiamond(ctx, x, y, 3.8, '#63e6be', '#ffffff');
        break;
      case 'waypoint_map':
        this.drawStar(ctx, x, y, 4.8, '#74c0fc');
        break;
      case 'training_dummy':
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#d8b068';
        ctx.fill();
        ctx.strokeStyle = '#fff3bf';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'corrupted_obelisk':
        this.drawDiamond(ctx, x, y, 4.2, '#ff1e42', '#ffd43b');
        break;
      case 'soul_lantern':
        this.drawDiamond(ctx, x, y, 3.8, '#66d9e8', '#ffffff');
        break;
      case 'rift_breach': {
        const r = 4.0 + 0.9 * Math.sin(elapsedSec * 5);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#be4bdb';
        ctx.lineWidth = 1.7;
        ctx.stroke();
        break;
      }
    }
  }

  private drawBossSkull(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    elapsedSec: number,
  ): void {
    const pulse = 1 + 0.08 * Math.sin(elapsedSec * 4.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);

    // Glow halo
    ctx.beginPath();
    ctx.arc(0, 0, 6.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(201, 42, 42, 0.36)';
    ctx.fill();

    // Skull cranium + jaw
    ctx.beginPath();
    ctx.arc(0, -1, 4.4, Math.PI, 0, false);
    ctx.lineTo(3.2, 3.2);
    ctx.lineTo(2, 4.8);
    ctx.lineTo(-2, 4.8);
    ctx.lineTo(-3.2, 3.2);
    ctx.closePath();
    ctx.fillStyle = '#fff3d6';
    ctx.strokeStyle = '#3b090e';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();

    // Glowing red eyes
    ctx.fillStyle = '#e03131';
    ctx.fillRect(-2.3, -1.2, 1.6, 1.6);
    ctx.fillRect(0.7, -1.2, 1.6, 1.6);

    ctx.restore();
  }

  private drawDiamond(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    fill: string,
    stroke: string,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    fill: string,
  ): void {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.42;
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
