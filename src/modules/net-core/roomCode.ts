import type { MultiplayerTransportMode } from '../../contracts/types';

export const PEER_ID_HOST_PREFIX = 'abyssal-realms-coop-';
export const PEER_ID_GUEST_PREFIX = 'abyssal-realms-guest-';
export const LOCAL_TAB_CHANNEL_PREFIX = 'abyssal-realms-room-';
export const DEFAULT_RELAY_URL = 'ws://localhost:8787';
export const MAX_PARTY_PEERS = 4;
export const MAX_REMOTE_PEERS = MAX_PARTY_PEERS - 1;

export const PUBLIC_STUN_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const PUBLIC_RTC_CONFIG: RTCConfiguration = {
  iceServers: PUBLIC_STUN_ICE_SERVERS,
  iceCandidatePoolSize: 4,
};

// Unambiguous uppercase alphanumeric characters (excludes 0/O and 1/I)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 6): string {
  const safeLen = Math.max(4, Math.min(12, Math.floor(length)));
  let out = '';
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(safeLen);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < safeLen; i++) {
      out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return out;
  }
  for (let i = 0; i < safeLen; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

export function generateRandomToken(length = 6): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Normalizes a user-supplied room code or pasted invite link into an uppercase
 * alphanumeric room code (e.g. "k7x-9q2" or "https://.../?room=k7x9q2" -> "K7X9Q2").
 */
export function normalizeRoomCode(rawInput: string): string {
  if (!rawInput || typeof rawInput !== 'string') return '';
  const trimmed = rawInput.trim();
  if (!trimmed) return '';

  // Support pasting a full invite URL or query string directly into the Room Code field
  if (trimmed.includes('room=') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const fromUrl = getRoomCodeFromUrl(trimmed);
    if (fromUrl) return fromUrl;
  }

  const cleaned = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4) return '';
  return cleaned.slice(0, 12);
}

export function roomCodeToHostPeerId(roomCode: string): string {
  const code = normalizeRoomCode(roomCode) || roomCode.trim().toUpperCase();
  return `${PEER_ID_HOST_PREFIX}${code}`;
}

export function createGuestPeerId(roomCode: string): string {
  const code = normalizeRoomCode(roomCode) || 'ROOM00';
  return `${PEER_ID_GUEST_PREFIX}${code}-${generateRandomToken(6)}`;
}

function extractQueryParams(urlOrSearch?: string): URLSearchParams | null {
  let raw = urlOrSearch;
  if (raw === undefined) {
    if (typeof window === 'undefined' || !window.location) {
      return null;
    }
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    if (search.includes('room=')) {
      raw = search;
    } else if (hash.includes('room=')) {
      raw = hash;
    } else {
      raw = search;
    }
  }

  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      if (parsed.search && parsed.search.length > 1) {
        return parsed.searchParams;
      }
      if (parsed.hash && parsed.hash.includes('=')) {
        const hashQuery = parsed.hash.replace(/^#\/?\??/, '');
        return new URLSearchParams(hashQuery);
      }
      return parsed.searchParams;
    }
  } catch {
    // Fall through to manual query extraction
  }

  const qIndex = trimmed.indexOf('?');
  if (qIndex >= 0) {
    const afterQ = trimmed.slice(qIndex + 1).split('#')[0];
    return new URLSearchParams(afterQ);
  }

  const cleanedHash = trimmed.replace(/^#\/?\??/, '');
  if (cleanedHash.includes('=')) {
    return new URLSearchParams(cleanedHash);
  }

  return null;
}

/**
 * Parses `?room=XXXXXX` from a URL, query string, hash, or `window.location` in browsers.
 * Headless-safe in Node/Vitest (returns `null` when no URL is present).
 */
export function getRoomCodeFromUrl(urlOrSearch?: string): string | null {
  const params = extractQueryParams(urlOrSearch);
  if (!params) return null;
  const rawRoom = params.get('room') ?? params.get('ROOM') ?? params.get('code');
  if (!rawRoom) return null;
  const cleaned = rawRoom.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < 4 || cleaned.length > 12) {
    return null;
  }
  return cleaned;
}

export function getTransportModeFromUrl(urlOrSearch?: string): MultiplayerTransportMode | null {
  const params = extractQueryParams(urlOrSearch);
  if (!params) return null;
  const mode = params.get('mode')?.trim();
  if (mode === 'webrtc_cloud' || mode === 'websocket_relay' || mode === 'local_tabs') {
    return mode;
  }
  return null;
}

export function getRelayUrlFromUrl(urlOrSearch?: string): string | null {
  const params = extractQueryParams(urlOrSearch);
  if (!params) return null;
  const relay = params.get('relay')?.trim();
  return relay ? normalizeRelayUrl(relay) : null;
}

export function normalizeRelayUrl(rawUrl?: string): string {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return DEFAULT_RELAY_URL;
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }
  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }
  return `ws://${trimmed}`;
}

export function buildRoomInviteUrl(
  roomCode: string,
  mode?: MultiplayerTransportMode,
  relayUrl?: string,
  baseHref?: string,
): string {
  const code = normalizeRoomCode(roomCode);
  const originBase =
    baseHref ??
    (typeof window !== 'undefined' && window.location
      ? `${window.location.origin}${window.location.pathname}`
      : 'http://localhost:5173/');

  try {
    const url = new URL(originBase);
    url.searchParams.set('room', code);
    if (mode && mode !== 'webrtc_cloud') {
      url.searchParams.set('mode', mode);
    }
    if (mode === 'websocket_relay' && relayUrl) {
      url.searchParams.set('relay', normalizeRelayUrl(relayUrl));
    }
    return url.toString();
  } catch {
    return `${originBase}?room=${encodeURIComponent(code)}`;
  }
}
