# ABYSSAL REALMS: Shattered Crown — 30-Agent Online Co-op Ultimate Edition

A massive 3D Dark-Fantasy Online Co-op Action RPG Dungeon Crawler built concurrently by a **30-Agent Antigravity Swarm** using **Three.js + TypeScript + Custom GLSL Shaders + WebRTC (PeerJS) + Web Audio API + Vite** with zero external asset dependencies.

## Quick Start

```powershell
cd "C:\Users\TRAN VAN HUNG\.gemini\antigravity\scratch\abyssal-realms"
npm.cmd run dev
```

Open `http://localhost:5173` in your browser.

### Playing Online Across Different Networks (Khác Mạng Internet)
1. **Zero-Server Internet Room Code (Default — WebRTC P2P + Google/Cloudflare STUN)**:
   - Press **`P`** (or click **`🌐 ONLINE CO-OP`** on the Title Screen / Top Bar).
   - Select **`🌍 Khác Mạng / Internet P2P (WebRTC)`** and click **Create Online Party** to get a 6-character Room Code (e.g. `K7X9Q2`) or copy the `?room=K7X9Q2` invite link.
   - Friends on **any different Wi-Fi, Fiber, or 4G network** open the game, enter `K7X9Q2`, and join with synced procedural dungeon seeds, 120Hz interpolated 3D avatars, and **real-time WebRTC 3D Spatial Voice Chat**!
2. **Optional Custom Relay Server (For Strict Corporate Symmetric NATs)**:
   - Run `npm.cmd run relay` (starts `server/relay-server.mjs` on port `8787`; expose publicly via `cloudflared tunnel --url http://localhost:8787` or VPS) and paste the `wss://...` URL in the **`⚡ Relay Server`** tab!
3. **Instant Solo / Multi-Tab Testing**:
   - Open 2 browser tabs with **`🖥️ Nhiều Tab Cùng Máy`**, OR click **`🤖 Thêm Đồng Đội AI Test Co-op`** to immediately test Chat, 3D Speech Bubbles, Emoji/Emote Wheels, Blade-Clash High-Fives `[H]`, and Co-op Resurrection `[F]`!

## Controls

| Input | Action |
|---|---|
| `W A S D` / Arrow Keys | Isometric hero movement (with glacial skating momentum on Cathedral ice) |
| `Left Click` / `Right Click` | Primary Combo / Stagger Execution (`LMB`) & Core Skill (`RMB`) |
| `1` `2` `3` `4` | Active Class Abilities & Ultimate |
| `V` / `Middle Click` | **Perfect Parry Ward** (`0.28s` deflect -> 360° golden riposte & +50 Boss Stagger) |
| `R` | **Abyssal Awakening (`100` Fury)** — 4-Wing Archon Transformation (`15s` overdrive) |
| `Space` / `Shift` | Stamina Dodge Roll (with invulnerability frames) |
| `Q` | Drink Crimson Health Potion |
| `F` / `E` | Interact, Execute Staggered Boss, or **Hold `[F]` to Revive Downed Co-op Teammate** |
| `P` | **Online Co-op Party Lobby** (Room Codes, Voice Controls, Teleport to Ally, Gift Gold/Potion) |
| `Enter` | **Party Chat Box** (`[Party]`, `[Loot]`, quick emojis, `/dance`, `/wave`, `/cheer`, `/taunt`, `/sit`, `/pray`, `/highfive`) |
| `Hold T` | **Push-to-Talk (`PTT`)** for Live WebRTC 3D Spatial Voice Chat (or switch to Open Mic!) |
| `Hold G` | **8-Slice Character Emote Radial Wheel** (Wave, Cheer, Dance, Taunt, Pray, Sit, Laugh, Point) |
| `Hold B` | **8-Slice 3D Bouncy Emoji Radial Wheel** (`👑 GG`, `🔥`, `💀`, `😂`, `❤️`, `⚔️`, `🛡️`, `🎉`) |
| `H` | **Paired 2-Player Blade-Clash / High-Five** (+20% Power, +15% Speed, +25% XP/Gold *Sworn Brethren* buff!) |
| `Alt + Left Click` | **3D Tactical Ground Ping Beacon** (*Attack*, *Loot*, *Danger*, *Group*) |
| `M` | **Astral Waypoint Atlas** (Sanctuary Hub, Floors I–VI, Crimson Colosseum) |
| `I` / `K` / `J` / `Esc` | Armory & Runewords (`I`), Constellation Tree (`K`), Lore Codex (`J`), DLSS 120Hz Settings (`Esc`) |
| `F3` | **Developer Telemetry & Expansion Cheats** |
