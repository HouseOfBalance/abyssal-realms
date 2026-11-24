import type {
  EmojiReactionId,
  HeroClassId,
  MultiplayerTransportMode,
  SocialEmoteId,
  TacticalPingType,
} from '../../contracts/types';

export interface TransportTabSpec {
  mode: MultiplayerTransportMode;
  label: string;
  badge: string;
  desc: string;
}

export const TRANSPORT_TABS: readonly TransportTabSpec[] = [
  {
    mode: 'webrtc_cloud',
    label: '🌍 Khác Mạng / Internet P2P (WebRTC)',
    badge: 'STUN Cloud P2P',
    desc: 'Kết nối trực tiếp xuyên Wi-Fi / ISP / 4G bằng Mã Phòng 6 ký tự (Google & Cloudflare STUN).',
  },
  {
    mode: 'websocket_relay',
    label: '⚡ Relay Server (wss://)',
    badge: 'NAT Fallback',
    desc: 'Chuyển tiếp qua WebSocket Relay Server (ws:// hoặc wss://) khi mạng chặn UDP Symmetric NAT.',
  },
  {
    mode: 'local_tabs',
    label: '🖥️ Nhiều Tab Cùng Máy',
    badge: '0ms Local',
    desc: 'Đồng bộ tức thì giữa 2–4 tab trình duyệt trên cùng một máy tính qua BroadcastChannel.',
  },
];

export interface QuickEmojiBarItem {
  id: string;
  display: string;
  title: string;
  kind: 'emoji' | 'emote' | 'ping' | 'highfive';
  emojiId?: EmojiReactionId;
  emoteId?: SocialEmoteId;
  pingType?: TacticalPingType;
}

/**
 * 12-Emoji Quick-Reaction Bar inside Translucent Party Chat Box.
 * Covers all 8 EmojiReactionIds + requested quick symbols (👑 GG, 🔥, 💀, 😂, ❤️, ⚔️, 🛡️, 🎉, etc.).
 */
export const QUICK_EMOJI_BAR_ITEMS: readonly QuickEmojiBarItem[] = [
  { id: 'crown_gg', display: '👑 GG', title: 'GG! Xuất Sắc!', kind: 'emoji', emojiId: 'crown_gg' },
  { id: 'fire_hype', display: '🔥', title: 'Cháy Quá!', kind: 'emoji', emojiId: 'fire_hype' },
  { id: 'skull_danger', display: '💀', title: 'Nguy Hiểm', kind: 'emoji', emojiId: 'skull_danger' },
  { id: 'laugh_imp', display: '😂', title: 'Haha!', kind: 'emoji', emojiId: 'laugh_imp' },
  { id: 'heart_thanks', display: '❤️', title: 'Cảm Ơn', kind: 'emoji', emojiId: 'heart_thanks' },
  { id: 'swords_boss', display: '⚔️', title: 'Đánh Boss!', kind: 'emoji', emojiId: 'swords_boss' },
  { id: 'shield_group', display: '🛡️', title: 'Ping Tập Hợp Khiên', kind: 'ping', pingType: 'group' },
  { id: 'party_cheer', display: '🎉', title: 'Hoan Hô Chiến Thắng', kind: 'emote', emoteId: 'cheer' },
  { id: 'chest_loot', display: '💎', title: 'Đồ Ngon Hiếm!', kind: 'emoji', emojiId: 'chest_loot' },
  { id: 'sos_help', display: '🆘', title: 'Cần Hồi Sinh / Giúp Đỡ!', kind: 'emoji', emojiId: 'sos_help' },
  { id: 'quick_dance', display: '💃', title: 'Nhảy Quán Rượu (/dance)', kind: 'emote', emoteId: 'dance' },
  { id: 'quick_highfive', display: '🤝', title: 'Đập Tay / Đập Kiếm [H]', kind: 'highfive' },
];

export interface RadialEmoteSlice {
  emoteId: SocialEmoteId;
  icon: string;
  label: string;
  slash: string;
}

export const RADIAL_EMOTE_SLICES: readonly RadialEmoteSlice[] = [
  { emoteId: 'wave', icon: '👋', label: 'Vẫy Tay', slash: '/wave' },
  { emoteId: 'cheer', icon: '🎉', label: 'Hoan Hô', slash: '/cheer' },
  { emoteId: 'dance', icon: '💃', label: 'Khiêu Vũ', slash: '/dance' },
  { emoteId: 'taunt', icon: '😤', label: 'Khiêu Khích', slash: '/taunt' },
  { emoteId: 'kneel_pray', icon: '🧎', label: 'Cầu Nguyện', slash: '/pray' },
  { emoteId: 'sit_rest', icon: '🏕️', label: 'Ngồi Nghỉ', slash: '/sit' },
  { emoteId: 'laugh', icon: '😂', label: 'Cười Lớn', slash: '/laugh' },
  { emoteId: 'point', icon: '👉', label: 'Chỉ Hướng', slash: '/point' },
];

export interface RadialEmojiSlice {
  emojiId: EmojiReactionId;
  icon: string;
  label: string;
}

export const RADIAL_EMOJI_SLICES: readonly RadialEmojiSlice[] = [
  { emojiId: 'crown_gg', icon: '👑', label: 'GG!' },
  { emojiId: 'fire_hype', icon: '🔥', label: 'Cháy Quá!' },
  { emojiId: 'skull_danger', icon: '💀', label: 'Nguy Hiểm' },
  { emojiId: 'laugh_imp', icon: '😂', label: 'Haha!' },
  { emojiId: 'heart_thanks', icon: '❤️', label: 'Cảm Ơn' },
  { emojiId: 'chest_loot', icon: '🧰', label: 'Đồ Ngon!' },
  { emojiId: 'sos_help', icon: '🆘', label: 'Cứu Với!' },
  { emojiId: 'swords_boss', icon: '⚔️', label: 'Đánh Boss' },
];

export interface TacticalPingSpec {
  type: TacticalPingType;
  icon: string;
  label: string;
  colorCss: string;
}

export const TACTICAL_PING_SPECS: readonly TacticalPingSpec[] = [
  { type: 'attack', icon: '⚔️', label: 'Tấn Công', colorCss: '#ff6b35' },
  { type: 'loot', icon: '💎', label: 'Nhặt Đồ', colorCss: '#ffd43b' },
  { type: 'danger', icon: '⚠️', label: 'Nguy Hiểm!', colorCss: '#ff4d4f' },
  { type: 'group', icon: '🛡️', label: 'Tập Hợp', colorCss: '#63e6be' },
];

export const CLASS_DISPLAY_META: Record<
  HeroClassId,
  { label: string; colorCss: string }
> = {
  vanguard: { label: 'Tiên Phong', colorCss: '#ff8787' },
  shadowblade: { label: 'Ảnh Kiếm', colorCss: '#69db7c' },
  arcanist: { label: 'Pháp Sư Tinh Thông', colorCss: '#74c0fc' },
};

export type ParsedSlashAction =
  | { kind: 'emote'; emoteId: SocialEmoteId }
  | { kind: 'highfive' }
  | { kind: 'emoji'; emojiId: EmojiReactionId }
  | { kind: 'chat'; text: string };

export function parseChatSlashCommand(rawInput: string): ParsedSlashAction | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('/')) {
    return { kind: 'chat', text: trimmed };
  }

  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  switch (cmd) {
    case '/wave':
    case '/hi':
    case '/hello':
      return { kind: 'emote', emoteId: 'wave' };
    case '/dance':
      return { kind: 'emote', emoteId: 'dance' };
    case '/cheer':
      return { kind: 'emote', emoteId: 'cheer' };
    case '/taunt':
      return { kind: 'emote', emoteId: 'taunt' };
    case '/sit':
    case '/rest':
      return { kind: 'emote', emoteId: 'sit_rest' };
    case '/pray':
    case '/kneel':
      return { kind: 'emote', emoteId: 'kneel_pray' };
    case '/laugh':
    case '/lol':
      return { kind: 'emote', emoteId: 'laugh' };
    case '/point':
      return { kind: 'emote', emoteId: 'point' };
    case '/highfive':
    case '/clash':
    case '/h5':
      return { kind: 'highfive' };
    case '/gg':
      return { kind: 'emoji', emojiId: 'crown_gg' };
    default:
      return { kind: 'chat', text: trimmed };
  }
}

export function computeRadialOctantIndex(dx: number, dy: number, deadzonePx = 30): number {
  const dist = Math.hypot(dx, dy);
  if (dist < deadzonePx) return -1;
  // 0 rad at North (0, -1), increasing clockwise across 8 slices of 45 deg (PI/4)
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  const shifted = (angle + Math.PI / 8) % (Math.PI * 2);
  return Math.floor(shifted / (Math.PI / 4)) % 8;
}

export function computeCardinalPingType(dx: number, dy: number, deadzonePx = 20): TacticalPingType {
  const dist = Math.hypot(dx, dy);
  if (dist < deadzonePx) return 'attack';
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy < 0 ? 'attack' : 'danger';
  }
  return dx > 0 ? 'loot' : 'group';
}
