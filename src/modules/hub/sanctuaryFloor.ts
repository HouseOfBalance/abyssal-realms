import type {
  DungeonFloorData,
  DungeonRoom,
  InteractableProp,
  TileType,
  Vec3,
} from '../../contracts/types';
import { clamp } from '../../core/Constants';
import { isSanctuaryTileWalkable, SanctuaryNavigator } from './sanctuaryPathfinder';

export const SANCTUARY_COLS = 44;
export const SANCTUARY_ROWS = 44;
export const SANCTUARY_TILE_SIZE = 2.0;
export const SANCTUARY_SEED = 777000;

export const SANCTUARY_LANDMARK_POSITIONS = {
  waypointPlaza: { x: 0, y: 0, z: 0 } as Vec3,
  playerSpawn: { x: 0, y: 0, z: 5.5 } as Vec3,
  stashVault: { x: -6.5, y: 0, z: -5.5 } as Vec3,
  loreLectern: { x: 6.5, y: 0, z: -5.5 } as Vec3,
  blacksmithAnvil: { x: -28, y: 0, z: 0 } as Vec3,
  gamblerTent: { x: 28, y: 0, z: -5.5 } as Vec3,
  companionShrine: { x: 28, y: 0, z: 5.5 } as Vec3,
  trainingDummy: { x: 0, y: 0, z: 28 } as Vec3,
  descentPortal: { x: 0, y: 0, z: -30 } as Vec3,
} as const;

function fillGridRect(
  tiles: TileType[][],
  col0: number,
  row0: number,
  col1Inclusive: number,
  row1Inclusive: number,
  tile: TileType,
): void {
  for (let r = row0; r <= row1Inclusive; r++) {
    for (let c = col0; c <= col1Inclusive; c++) {
      if (r >= 0 && r < tiles.length && c >= 0 && c < tiles[r].length) {
        tiles[r][c] = tile;
      }
    }
  }
}

export function generateSanctuaryFloorData(): DungeonFloorData {
  const cols = SANCTUARY_COLS;
  const rows = SANCTUARY_ROWS;
  const tileSize = SANCTUARY_TILE_SIZE;

  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    new Array<TileType>(cols).fill('void'),
  );

  // 1. Central Sanctuary Courtyard — Astral Sun-Dial Plaza (cols 15..28, rows 15..28 => 28m x 28m)
  fillGridRect(tiles, 15, 15, 28, 28, 'floor');
  // Octagonal Gothic corner bevels for sculpted cathedral corner pillars
  tiles[15][15] = 'void';
  tiles[15][28] = 'void';
  tiles[28][15] = 'void';
  tiles[28][28] = 'void';

  // 2. North Sanctum — Abyssal Rift Gatehouse (cols 17..26, rows 4..11 => 20m x 16m)
  fillGridRect(tiles, 17, 4, 26, 11, 'floor');
  tiles[4][17] = 'void';
  tiles[4][26] = 'void';
  // Vaulted Northern Nave Bridge (cols 20..23, rows 12..14)
  fillGridRect(tiles, 20, 12, 23, 14, 'corridor');
  fillGridRect(tiles, 20, 13, 23, 13, 'door');

  // 3. South Cliffside Courtyard — Valor Training Grounds (cols 16..27, rows 32..39 => 24m x 16m)
  fillGridRect(tiles, 16, 32, 27, 39, 'floor');
  tiles[39][16] = 'void';
  tiles[39][27] = 'void';
  // Vaulted Southern Courtyard Bridge (cols 20..23, rows 29..31)
  fillGridRect(tiles, 20, 29, 23, 31, 'corridor');
  fillGridRect(tiles, 20, 30, 23, 30, 'door');

  // 4. West Wing — Titan's Hearth & Blacksmith Pavilion (cols 4..11, rows 16..27 => 16m x 24m)
  fillGridRect(tiles, 4, 16, 11, 27, 'floor');
  tiles[16][4] = 'void';
  tiles[27][4] = 'void';
  // Western Forge Colonnade (cols 12..14, rows 20..23)
  fillGridRect(tiles, 12, 20, 14, 23, 'corridor');
  fillGridRect(tiles, 13, 20, 13, 23, 'door');

  // 5. East Wing — Mystic Bazaar, Blood Altar & Menagerie (cols 32..39, rows 16..27 => 16m x 24m)
  fillGridRect(tiles, 32, 16, 39, 27, 'floor');
  tiles[16][39] = 'void';
  tiles[27][39] = 'void';
  // Eastern Bazaar Colonnade (cols 29..31, rows 20..23)
  fillGridRect(tiles, 29, 20, 31, 23, 'corridor');
  fillGridRect(tiles, 30, 20, 30, 23, 'door');

  // 6. Wrap every walkable stronghold tile with 1-tile thick Gothic masonry ramparts ('wall'),
  //    leaving the outer cliff perimeter as sheer Abyssal drop-off ('void').
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (tiles[r][c] !== 'void') continue;
      let touchesWalkable = false;
      for (let dr = -1; dr <= 1 && !touchesWalkable; dr++) {
        for (let dc = -1; dc <= 1 && !touchesWalkable; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            if (isSanctuaryTileWalkable(tiles[nr][nc])) {
              touchesWalkable = true;
            }
          }
        }
      }
      if (touchesWalkable) {
        tiles[r][c] = 'wall';
      }
    }
  }

  // Pre-reveal the Sanctuary stronghold interior & walls while allowing outer void reveal checks
  const explored: boolean[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => tiles[r][c] !== 'void'),
  );

  const navigator = new SanctuaryNavigator(cols, rows, tileSize, tiles);

  const rooms: DungeonRoom[] = [
    {
      id: 'sanctuary_plaza',
      type: 'spawn',
      x: 15,
      y: 15,
      width: 14,
      height: 14,
      centerGrid: { col: 21, row: 21 },
      centerWorld: { x: 0, y: 0, z: 0 },
      connectedRoomIds: [
        'sanctuary_north_gate',
        'sanctuary_west_forge',
        'sanctuary_east_bazaar',
        'sanctuary_south_courtyard',
      ],
      cleared: true,
    },
    {
      id: 'sanctuary_north_gate',
      type: 'shrine',
      x: 17,
      y: 4,
      width: 10,
      height: 8,
      centerGrid: { col: 21, row: 7 },
      centerWorld: { x: 0, y: 0, z: -28 },
      connectedRoomIds: ['sanctuary_plaza'],
      cleared: true,
    },
    {
      id: 'sanctuary_west_forge',
      type: 'treasure',
      x: 4,
      y: 16,
      width: 8,
      height: 12,
      centerGrid: { col: 7, row: 21 },
      centerWorld: { x: -28, y: 0, z: 0 },
      connectedRoomIds: ['sanctuary_plaza'],
      cleared: true,
    },
    {
      id: 'sanctuary_east_bazaar',
      type: 'shrine',
      x: 32,
      y: 16,
      width: 8,
      height: 12,
      centerGrid: { col: 35, row: 21 },
      centerWorld: { x: 28, y: 0, z: 0 },
      connectedRoomIds: ['sanctuary_plaza'],
      cleared: true,
    },
    {
      id: 'sanctuary_south_courtyard',
      type: 'combat',
      x: 16,
      y: 32,
      width: 12,
      height: 8,
      centerGrid: { col: 21, row: 35 },
      centerWorld: { x: 0, y: 0, z: 28 },
      connectedRoomIds: ['sanctuary_plaza'],
      cleared: true,
    },
  ];

  const interactables: InteractableProp[] = [
    {
      id: 'hub_waypoint_map',
      type: 'waypoint_map',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.waypointPlaza },
      roomId: 'sanctuary_plaza',
      used: false,
      label: 'Astral Waypoint Sun-Dial',
    },
    {
      id: 'hub_blacksmith_anvil',
      type: 'blacksmith_anvil',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.blacksmithAnvil },
      roomId: 'sanctuary_west_forge',
      used: false,
      label: "Master Blacksmith's Runeforge & Anvil",
    },
    {
      id: 'hub_stash_chest',
      type: 'stash_chest',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.stashVault },
      roomId: 'sanctuary_plaza',
      used: false,
      label: 'Gilded Shared Stash Vault',
    },
    {
      id: 'hub_gambler_npc',
      type: 'gambler_npc',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.gamblerTent },
      roomId: 'sanctuary_east_bazaar',
      used: false,
      label: 'Mystic Gambler & Crimson Blood Altar',
    },
    {
      id: 'hub_companion_shrine',
      type: 'companion_shrine',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.companionShrine },
      roomId: 'sanctuary_east_bazaar',
      used: false,
      label: 'Companion Menagerie Shrine',
    },
    {
      id: 'hub_lore_tome',
      type: 'lore_tome',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.loreLectern },
      roomId: 'sanctuary_plaza',
      used: false,
      label: 'Chronicle of the Bastion of the Fallen',
      loreId: 'lore_crypt_01',
    },
    {
      id: 'hub_training_dummy',
      type: 'training_dummy',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.trainingDummy },
      roomId: 'sanctuary_south_courtyard',
      used: false,
      label: 'Armored Training Dummy',
    },
    {
      id: 'hub_portal_floor_1',
      type: 'portal_next_floor',
      position: { ...SANCTUARY_LANDMARK_POSITIONS.descentPortal },
      roomId: 'sanctuary_north_gate',
      used: false,
      label: 'Abyssal Rift Gate — Forgotten Crypt (Floor I)',
    },
  ];

  // Symmetric wall sconces & standing iron braziers illuminating all 5 wings
  const torchPositions: Vec3[] = [
    // Central Sun-Dial Plaza standing braziers
    { x: -10, y: 0, z: -10 },
    { x: 10, y: 0, z: -10 },
    { x: -10, y: 0, z: 10 },
    { x: 10, y: 0, z: 10 },
    // Cardinal archway sconces
    { x: -5, y: 2.2, z: -13.2 },
    { x: 5, y: 2.2, z: -13.2 },
    { x: -5, y: 2.2, z: 13.2 },
    { x: 5, y: 2.2, z: 13.2 },
    { x: -13.2, y: 2.2, z: -5 },
    { x: -13.2, y: 2.2, z: 5 },
    { x: 13.2, y: 2.2, z: -5 },
    { x: 13.2, y: 2.2, z: 5 },
    // North Abyssal Rift Gatehouse braziers
    { x: -6, y: 0, z: -26 },
    { x: 6, y: 0, z: -26 },
    { x: -5.5, y: 2.2, z: -35.2 },
    { x: 5.5, y: 2.2, z: -35.2 },
    // West Forge Pavilion braziers
    { x: -24, y: 0, z: -7 },
    { x: -24, y: 0, z: 7 },
    // East Mystic Bazaar & Menagerie braziers
    { x: 24, y: 0, z: -7 },
    { x: 24, y: 0, z: 7 },
    // South Valor Training Courtyard braziers
    { x: -7, y: 0, z: 24 },
    { x: 7, y: 0, z: 24 },
    { x: -7, y: 0, z: 33 },
    { x: 7, y: 0, z: 33 },
  ];

  const offsetX = -cols * tileSize * 0.5;
  const offsetZ = -rows * tileSize * 0.5;

  const revealRadius = (worldPos: Vec3, radiusWorld: number): void => {
    if (!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.z)) return;
    const safeR = Math.max(0, Number.isFinite(radiusWorld) ? radiusWorld : 0);
    const minCol = clamp(Math.floor((worldPos.x - safeR - offsetX) / tileSize), 0, cols - 1);
    const maxCol = clamp(Math.floor((worldPos.x + safeR - offsetX) / tileSize), 0, cols - 1);
    const minRow = clamp(Math.floor((worldPos.z - safeR - offsetZ) / tileSize), 0, rows - 1);
    const maxRow = clamp(Math.floor((worldPos.z + safeR - offsetZ) / tileSize), 0, rows - 1);
    const rSq = safeR * safeR;

    for (let r = minRow; r <= maxRow; r++) {
      const cz = offsetZ + (r + 0.5) * tileSize;
      for (let c = minCol; c <= maxCol; c++) {
        const cx = offsetX + (c + 0.5) * tileSize;
        const dx = cx - worldPos.x;
        const dz = cz - worldPos.z;
        if (dx * dx + dz * dz <= rSq) {
          explored[r][c] = true;
        }
      }
    }
  };

  return {
    floorNumber: 0,
    biome: 'sanctuary',
    seed: SANCTUARY_SEED,
    cols,
    rows,
    tileSize,
    tiles,
    explored,
    rooms,
    playerSpawn: { ...SANCTUARY_LANDMARK_POSITIONS.playerSpawn },
    bossSpawn: { ...SANCTUARY_LANDMARK_POSITIONS.descentPortal },
    portalPosition: { ...SANCTUARY_LANDMARK_POSITIONS.descentPortal },
    interactables,
    torchPositions,
    worldToGrid: (worldPos: Vec3) => navigator.worldToGrid(worldPos),
    gridToWorld: (col: number, row: number) => navigator.gridToWorld(col, row),
    isWalkableWorld: (x: number, z: number, radius?: number) =>
      navigator.isWalkableWorld(x, z, radius),
    findPath: (fromWorld: Vec3, toWorld: Vec3, maxSteps?: number) =>
      navigator.findPath(fromWorld, toWorld, maxSteps),
    revealRadius,
  };
}
