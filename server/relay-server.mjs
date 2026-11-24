#!/usr/bin/env node
/**
 * Abyssal Realms — Optional Cross-Network WebSocket Room Relay Server
 * Supports up to 4 players per room across ANY internet networks when exposed via
 * public IP, VPS, Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8787`), or ngrok.
 * Note: Default Online Co-op already works serverlessly across different networks via WebRTC/PeerJS + STUN!
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const wss = new WebSocketServer({ port: PORT });

/** @type {Map<string, Map<string, import('ws').WebSocket>>} */
const rooms = new Map();

wss.on('connection', (ws) => {
  let joinedRoom = null;
  let peerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join_room' && typeof msg.roomCode === 'string' && typeof msg.peerId === 'string') {
      const code = msg.roomCode.trim().toUpperCase();
      peerId = msg.peerId;
      joinedRoom = code;

      if (!rooms.has(code)) {
        rooms.set(code, new Map());
      }
      const roomMap = rooms.get(code);
      if (roomMap.size >= 4 && !roomMap.has(peerId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Party is full (4/4).' }));
        return;
      }

      const existingPeers = Array.from(roomMap.keys()).filter((id) => id !== peerId);
      roomMap.set(peerId, ws);

      ws.send(JSON.stringify({ type: 'room_joined', roomCode: code, peerId, peers: existingPeers }));
      for (const [otherId, otherWs] of roomMap.entries()) {
        if (otherId !== peerId && otherWs.readyState === 1) {
          otherWs.send(JSON.stringify({ type: 'peer_joined', peerId }));
        }
      }
      return;
    }

    if (!joinedRoom || !peerId) return;
    const roomMap = rooms.get(joinedRoom);
    if (!roomMap) return;

    // Relay targeted or broadcast packet across all room peers
    if (msg.targetPeerId) {
      const targetWs = roomMap.get(msg.targetPeerId);
      if (targetWs && targetWs.readyState === 1) {
        targetWs.send(JSON.stringify({ ...msg, fromPeerId: peerId }));
      }
    } else {
      const serialized = JSON.stringify({ ...msg, fromPeerId: peerId });
      for (const [otherId, otherWs] of roomMap.entries()) {
        if (otherId !== peerId && otherWs.readyState === 1) {
          otherWs.send(serialized);
        }
      }
    }
  });

  ws.on('close', () => {
    if (joinedRoom && peerId && rooms.has(joinedRoom)) {
      const roomMap = rooms.get(joinedRoom);
      roomMap.delete(peerId);
      for (const [, otherWs] of roomMap.entries()) {
        if (otherWs.readyState === 1) {
          otherWs.send(JSON.stringify({ type: 'peer_left', peerId }));
        }
      }
      if (roomMap.size === 0) {
        rooms.delete(joinedRoom);
      }
    }
  });
});

console.log(`[Abyssal Realms Relay] Listening on ws://0.0.0.0:${PORT}`);
