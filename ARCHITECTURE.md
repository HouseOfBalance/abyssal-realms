# ABYSSAL REALMS: Shattered Crown — 25-Agent Expansion Architecture Guide

Project Root: `C:\Users\TRAN VAN HUNG\.gemini\antigravity\scratch\abyssal-realms`

## Golden Rules for Every Swarm Worker
1. **Strict Directory Isolation**: You MUST ONLY create or modify files inside your assigned `src/modules/<your-module>/` directory. NEVER edit `package.json`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/contracts/types.ts`, `src/core/EventBus.ts`, `src/core/Constants.ts`, or another worker's directory.
2. **Contract Compliance**: Import shared types from `../../contracts/types` (with `import type`), events from `../../core/EventBus`, and constants/helpers from `../../core/Constants`.
3. **Zero External Assets / Zero Network**: All 3D meshes, PBR CanvasTextures, GLSL shaders, particles, UI icons/SVGs, and Web Audio SFX/music MUST be generated procedurally in code (with headless-safe fallbacks for Vitest). Do NOT run `npm install`.
4. **Windows PowerShell CLI & Targeted Testing**: Always invoke `npx.cmd` or `npm.cmd`. Because 25 agents are editing sibling folders concurrently, test your own module quickly via `npx.cmd vitest run src/modules/<your-module>` and ignore temporary `tsc --noEmit` errors outside your own `src/modules/<your-module>/` directory while ensuring **zero TypeScript errors in your own folder**.

## 25-Module Export Registry
| Worker | Folder | Required Exports (`index.ts`) | Contract Interface |
|---|---|---|---|
| `engine-core` | `src/modules/engine` | `EngineCore`, `createEngineCore(): IEngineCore` | `IEngineCore` |
| `camera-rig` | `src/modules/camera` | `CameraRig`, `createCameraRig(): ICameraRig` | `ICameraRig` |
| `proc-materials` | `src/modules/materials` | `MaterialLibrary`, `createMaterialLibrary(): IMaterialLibrary` | `IMaterialLibrary` |
| `lighting-env` | `src/modules/lighting` | `LightingDirector`, `createLightingDirector(): ILightingDirector` | `ILightingDirector` |
| `hero-rig` | `src/modules/hero-model` | `HeroRig`, `createHeroRig(heroClass?: HeroClassId): IHeroRig` | `IHeroRig` |
| `player-ctrl` | `src/modules/player` | `PlayerController`, `createPlayerController(): IPlayerController` | `IPlayerController` |
| `skill-tree` | `src/modules/skills` | `SkillSystem`, `createSkillSystem(): ISkillSystem` | `ISkillSystem` |
| `dungeon-gen` | `src/modules/dungeon` | `DungeonGenerator`, `createDungeonGenerator(): IDungeonGenerator` | `IDungeonGenerator` |
| `dungeon-mesh` | `src/modules/world-mesh` | `DungeonMeshBuilder`, `createDungeonMeshBuilder(): IDungeonMeshBuilder` | `IDungeonMeshBuilder` |
| `traps-hazards` | `src/modules/hazards` | `HazardSystem`, `createHazardSystem(): IHazardSystem` | `IHazardSystem` |
| `combat-engine` | `src/modules/combat` | `CombatEngine`, `createCombatEngine(): ICombatEngine` | `ICombatEngine` |
| `enemy-models` | `src/modules/enemy-meshes` | `EnemyMeshFactory`, `createEnemyMeshFactory(): IEnemyMeshFactory` | `IEnemyMeshFactory` |
| `enemy-ai` | `src/modules/ai` | `EnemyAISystem`, `createEnemyAISystem(): IEnemyAISystem` | `IEnemyAISystem` |
| `boss-encounters` | `src/modules/bosses` | `BossDirector`, `createBossDirector(): IBossDirector` | `IBossDirector` |
| `loot-items` | `src/modules/loot` | `LootSystem`, `createLootSystem(): ILootSystem` | `ILootSystem` |
| `quests-lore` | `src/modules/quests` | `QuestSystem`, `createQuestSystem(): IQuestSystem` | `IQuestSystem` |
| `vfx-audio` | `src/modules/vfx-audio` | `VfxAudioSystem`, `createVfxAudioSystem(): IVfxAudioSystem` | `IVfxAudioSystem` |
| `hud-ui` | `src/modules/ui-hud` | `HudUI`, `createHudUI(): IHudUI` | `IHudUI` |
| `menus-panels` | `src/modules/ui-menus` | `MenusUI`, `createMenusUI(): IMenusUI` | `IMenusUI` |
| `qa-integrator` | `src/modules/integration` | `BalanceValidator`, `DebugOverlay`, `createDebugOverlay()` | Telemetry & Balance |
| `sanctuary-hub` | `src/modules/hub` | `SanctuaryHub`, `createSanctuaryHub(): ISanctuaryHub` | `ISanctuaryHub` |
| `runes-sets` | `src/modules/runewords` | `RunewordSystem`, `createRunewordSystem(): IRunewordSystem` | `IRunewordSystem` |
| `companions` | `src/modules/companions` | `CompanionSystem`, `createCompanionSystem(): ICompanionSystem` | `ICompanionSystem` |
| `world-events` | `src/modules/events` | `WorldEventSystem`, `createWorldEventSystem(): IWorldEventSystem` | `IWorldEventSystem` |
| `combat-mastery` | `src/modules/mastery` | `CombatMasterySystem`, `createCombatMasterySystem(): ICombatMasterySystem` | `ICombatMasterySystem` |
| `net-transport` | `src/modules/net-core` | `MultiplayerTransport`, `createMultiplayerTransport(): IMultiplayerTransport` | `IMultiplayerTransport` |
| `voice-comms` | `src/modules/net-voice` | `VoiceChatSystem`, `createVoiceChatSystem(): IVoiceChatSystem` | `IVoiceChatSystem` |
| `mp-lobby-chat` | `src/modules/ui-multiplayer` | `MultiplayerUI`, `createMultiplayerUI(): IMultiplayerUI` | `IMultiplayerUI` |
| `social-emotes` | `src/modules/emotes` | `SocialInteractionSystem`, `createSocialInteractionSystem(): ISocialInteractionSystem` | `ISocialInteractionSystem` |
| `remote-avatars` | `src/modules/net-avatars` | `RemoteAvatarManager`, `createRemoteAvatarManager(): IRemoteAvatarManager` | `IRemoteAvatarManager` |
