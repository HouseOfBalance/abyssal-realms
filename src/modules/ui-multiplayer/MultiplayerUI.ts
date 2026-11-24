import type {
  IMultiplayerUI,
  LocalVoiceState,
  MultiplayerTransportMode,
  MultiplayerUICallbacks,
  MultiplayerUISnapshot,
  NetChatMessage,
  PeerVoiceState,
  RemotePeerSnapshot,
  TacticalPingType,
} from '../../contracts/types';
import { MYTHIC_COLOR, RARITY_COLORS, clamp } from '../../core/Constants';
import { eventBus } from '../../core/EventBus';
import {
  CLASS_DISPLAY_META,
  QUICK_EMOJI_BAR_ITEMS,
  RADIAL_EMOJI_SLICES,
  RADIAL_EMOTE_SLICES,
  TACTICAL_PING_SPECS,
  TRANSPORT_TABS,
  computeCardinalPingType,
  computeRadialOctantIndex,
  parseChatSlashCommand,
} from './constants';
import {
  renderClassEmblemSvg,
  renderCoopGlobeSvg,
  renderCrownSvg,
  renderHeadphonesSvg,
  renderMicSvg,
  renderSpatialRadarSvg,
  renderTwinBladesSvg,
} from './icons';
import { MP_UI_SCOPED_CSS, MP_UI_STYLE_ELEMENT_ID } from './styles';

const MAX_CHAT_LINES = 80;
const WAVEFORM_BAR_COUNT = 5;

let activeStyleMountCount = 0;

interface RosterPeerCardRefs {
  cardEl: HTMLDivElement;
  emblemEl: HTMLDivElement;
  nameTextEl: HTMLSpanElement;
  crownEl: HTMLSpanElement;
  subInfoEl: HTMLDivElement;
  pingEl: HTMLSpanElement;
  waveBars: HTMLDivElement[];
  muteBtnEl: HTMLButtonElement;
  volSliderEl: HTMLInputElement;
  volValueEl: HTMLSpanElement;
  isDraggingVolume: boolean;
  lastClass: string;
}

interface PartyHudFrameRefs {
  frameEl: HTMLDivElement;
  avatarEl: HTMLDivElement;
  nameEl: HTMLSpanElement;
  crownEl: HTMLSpanElement;
  lvlPingEl: HTMLSpanElement;
  hpTextEl: HTMLSpanElement;
  hpFillEl: HTMLDivElement;
  downedBadgeEl: HTMLDivElement;
  lastClass: string;
}

export class MultiplayerUI implements IMultiplayerUI {
  private container: HTMLElement | null = null;
  private rootEl: HTMLDivElement | null = null;
  private callbacks: MultiplayerUICallbacks | null = null;
  private ownsStyleRef = false;

  private lobbyOpen = false;
  private chatFocused = false;
  private lobbyInputFocused = false;
  private selectedMode: MultiplayerTransportMode = 'webrtc_cloud';
  private nicknameEditedByUser = false;
  private elapsedSec = 0;
  private copyCodeFeedbackSec = 0;
  private copyLinkFeedbackSec = 0;
  private pttEventActive = false;

  // Latest cached state for button handlers
  private lastRoomCode = '';
  private lastVoiceMode: 'ptt' | 'open_mic' = 'ptt';
  private lastPeerMutedMap = new Map<string, boolean>();

  // Top-bar refs
  private triggerPillEl: HTMLButtonElement | null = null;
  private triggerLabelEl: HTMLSpanElement | null = null;

  // Voice dock refs
  private voiceDockEl: HTMLDivElement | null = null;
  private micEnableBtnEl: HTMLButtonElement | null = null;
  private micMuteBtnEl: HTMLButtonElement | null = null;
  private micMuteIconEl: HTMLSpanElement | null = null;
  private voiceModeBtnEl: HTMLButtonElement | null = null;
  private deafenBtnEl: HTMLButtonElement | null = null;
  private deafenIconEl: HTMLSpanElement | null = null;
  private spatialBtnEl: HTMLButtonElement | null = null;
  private vuMeterEl: HTMLDivElement | null = null;
  private vuFillEl: HTMLDivElement | null = null;
  private vuStatusEl: HTMLSpanElement | null = null;

  // Sworn Brethren & Party HUD frames refs
  private swornBadgeEl: HTMLDivElement | null = null;
  private swornTimerEl: HTMLSpanElement | null = null;
  private swornSubEl: HTMLDivElement | null = null;
  private partyFramesContainerEl: HTMLDivElement | null = null;
  private partyFrameRefs = new Map<string, PartyHudFrameRefs>();

  // Local Downed overlay & High-Five prompt refs
  private downedOverlayEl: HTMLDivElement | null = null;
  private bleedoutTimerEl: HTMLDivElement | null = null;
  private bleedoutFillEl: HTMLDivElement | null = null;
  private reviveWrapEl: HTMLDivElement | null = null;
  private reviveLabelEl: HTMLDivElement | null = null;
  private reviveFillEl: HTMLDivElement | null = null;
  private highFiveBannerEl: HTMLDivElement | null = null;
  private highFiveTitleEl: HTMLDivElement | null = null;

  // Party Chat refs
  private chatBoxEl: HTMLDivElement | null = null;
  private chatFeedEl: HTMLDivElement | null = null;
  private chatInputEl: HTMLInputElement | null = null;
  private chatCollapseBtnEl: HTMLButtonElement | null = null;
  private chatCollapsed = false;
  private topBarEl: HTMLDivElement | null = null;
  private topLeftDockEl: HTMLDivElement | null = null;

  // Radial Wheel refs
  private wheelOpen = false;
  private wheelMode: 'emote' | 'emoji' = 'emote';
  private wheelHeldKey: 'g' | 'b' | null = null;
  private wheelSelectedSlice = -1;
  private wheelBackdropEl: HTMLDivElement | null = null;
  private wheelSliceEls: HTMLButtonElement[] = [];
  private wheelSliceIconEls: HTMLSpanElement[] = [];
  private wheelSliceLabelEls: HTMLSpanElement[] = [];
  private wheelModeBtnEl: HTMLButtonElement | null = null;

  // Alt+Click Tactical Ping Rose refs
  private pingRoseOpen = false;
  private pingAnchorX = 0;
  private pingAnchorY = 0;
  private pingSelectedType: TacticalPingType = 'attack';
  private lastAltPointerPingAt = 0;
  private pingRoseEl: HTMLDivElement | null = null;
  private pingRoseBtnMap = new Map<TacticalPingType, HTMLButtonElement>();

  // Lobby Modal refs
  private lobbyBackdropEl: HTMLDivElement | null = null;
  private connStatusBadgeEl: HTMLSpanElement | null = null;
  private nicknameInputEl: HTMLInputElement | null = null;
  private transportTabBtns = new Map<MultiplayerTransportMode, HTMLButtonElement>();
  private relayRowEl: HTMLDivElement | null = null;
  private relayInputEl: HTMLInputElement | null = null;
  private roomCodeBoxEl: HTMLDivElement | null = null;
  private roomCodeTextEl: HTMLSpanElement | null = null;
  private copyCodeBtnEl: HTMLButtonElement | null = null;
  private copyLinkBtnEl: HTMLButtonElement | null = null;
  private leaveRoomBtnEl: HTMLButtonElement | null = null;
  private joinCodeInputEl: HTMLInputElement | null = null;
  private errorBannerEl: HTMLDivElement | null = null;
  private rosterCountLabelEl: HTMLSpanElement | null = null;
  private rosterGridEl: HTMLDivElement | null = null;
  private localRosterNameEl: HTMLSpanElement | null = null;
  private localRosterCrownEl: HTMLSpanElement | null = null;
  private localRosterWaveBars: HTMLDivElement[] = [];
  private rosterPeerCards = new Map<string, RosterPeerCardRefs>();
  private rosterEmptyPlaceholders: HTMLDivElement[] = [];

  // Cleanup handles
  private windowCleanups: Array<() => void> = [];
  private busUnsubscribers: Array<() => void> = [];

  public mount(container: HTMLElement, callbacks: MultiplayerUICallbacks): void {
    if (this.rootEl) {
      this.teardownDomOnly();
    }

    this.container = container;
    this.callbacks = callbacks;
    this.ensureStylesInjected();

    const root = document.createElement('div');
    root.className = 'mp-ui-root';
    this.rootEl = root;

    this.buildTopBar(root);
    this.buildTopLeftDock(root);
    this.buildLocalDownedAndHighFiveBanners(root);
    this.buildPartyChatBox(root);
    this.buildRadialWheelAndPingRose(root);
    this.buildLobbyModal(root);

    container.appendChild(root);
    this.prefillRoomCodeFromUrl();
    this.bindGlobalListeners();
    this.bindEventBus();
  }

  public openLobby(): void {
    this.lobbyOpen = true;
    this.lobbyBackdropEl?.classList.add('is-open');
    eventBus.emit('sfx:request', { id: 'ui_click' });
  }

  public closeLobby(): void {
    if (!this.lobbyOpen) return;
    this.lobbyOpen = false;
    this.lobbyInputFocused = false;
    this.lobbyBackdropEl?.classList.remove('is-open');
    eventBus.emit('sfx:request', { id: 'ui_click' });
  }

  public toggleLobby(): void {
    if (this.lobbyOpen) this.closeLobby();
    else this.openLobby();
  }

  public isLobbyOpen(): boolean {
    return this.lobbyOpen;
  }

  public isChatFocused(): boolean {
    return this.chatFocused || this.lobbyInputFocused;
  }

  public setHudVisible(visible: boolean): void {
    const disp = visible ? '' : 'none';
    if (this.topBarEl) this.topBarEl.style.display = disp;
    if (this.topLeftDockEl) this.topLeftDockEl.style.display = disp;
    if (this.chatBoxEl) this.chatBoxEl.style.display = disp;
  }

  public setChatCollapsed(collapsed: boolean): void {
    this.chatCollapsed = collapsed;
    this.chatBoxEl?.classList.toggle('is-collapsed', collapsed);
    if (this.chatCollapseBtnEl) {
      this.chatCollapseBtnEl.textContent = collapsed ? '💬 Mở Chat ▴' : '− Thu Nhỏ';
    }
    if (collapsed && this.chatFocused) {
      this.blurChat();
    }
  }

  public appendChatMessage(msg: NetChatMessage): void {
    if (!this.chatFeedEl) return;

    const line = document.createElement('div');
    line.className = `mp-chat-line ch-${msg.channel}`;

    const tag = document.createElement('span');
    tag.className = 'mp-chat-tag';
    const channelLabel =
      msg.channel === 'party'
        ? '[Đội]'
        : msg.channel === 'emote'
          ? '[Biểu Cảm]'
          : msg.channel === 'loot'
            ? '[Chiến Lợi Phẩm]'
            : '[Hệ Thống]';
    tag.textContent = channelLabel;
    line.appendChild(tag);

    if (msg.channel !== 'system' && msg.senderName) {
      const sender = document.createElement('span');
      sender.className = 'mp-chat-sender';
      const classColor = CLASS_DISPLAY_META[msg.heroClass]?.colorCss ?? '#ffd8a8';
      sender.style.color = classColor;
      sender.textContent = msg.channel === 'emote' ? `${msg.senderName} ` : `${msg.senderName}: `;
      line.appendChild(sender);
    }

    const body = document.createElement('span');
    body.className = 'mp-chat-body';
    if (msg.channel === 'loot') {
      if (msg.isMythic) {
        body.style.color = MYTHIC_COLOR.css;
      } else if (msg.rarity && RARITY_COLORS[msg.rarity]) {
        body.style.color = RARITY_COLORS[msg.rarity].css;
      } else {
        body.style.color = '#ffd43b';
      }
    }
    body.textContent = msg.text;
    line.appendChild(body);

    this.chatFeedEl.appendChild(line);

    while (this.chatFeedEl.children.length > MAX_CHAT_LINES) {
      const oldest = this.chatFeedEl.children[0] as HTMLElement | undefined;
      oldest?.remove();
    }

    if (typeof (this.chatFeedEl as any).scrollHeight === 'number') {
      (this.chatFeedEl as any).scrollTop = (this.chatFeedEl as any).scrollHeight;
    }
  }

  public update(dt: number, snapshot: MultiplayerUISnapshot): void {
    if (!this.rootEl) return;
    const safeDt = Math.max(0, Math.min(dt, 0.25));
    this.elapsedSec += safeDt;

    if (this.copyCodeFeedbackSec > 0) {
      this.copyCodeFeedbackSec = Math.max(0, this.copyCodeFeedbackSec - safeDt);
      if (this.copyCodeFeedbackSec === 0 && this.copyCodeBtnEl) {
        this.copyCodeBtnEl.textContent = '📋 Sao Chép Mã';
      }
    }
    if (this.copyLinkFeedbackSec > 0) {
      this.copyLinkFeedbackSec = Math.max(0, this.copyLinkFeedbackSec - safeDt);
      if (this.copyLinkFeedbackSec === 0 && this.copyLinkBtnEl) {
        this.copyLinkBtnEl.textContent = '🔗 Sao Chép Link Mời';
      }
    }

    this.updateTopBarAndLobbyState(snapshot);
    this.updateVoiceDock(snapshot.localVoice);
    this.updateSwornBrethrenBadge(snapshot);
    this.updatePartyHudFrames(snapshot.peers, snapshot.peerVoice);
    this.updateLocalDownedAndHighFive(snapshot);
    this.updateLobbyRoster(snapshot);
  }

  public dispose(): void {
    this.teardownDomOnly();
    this.callbacks = null;
  }

  // =========================================================================
  // DOM BUILDERS
  // =========================================================================

  private ensureStylesInjected(): void {
    if (typeof document === 'undefined' || !document.head) return;
    let styleEl = document.getElementById(MP_UI_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = MP_UI_STYLE_ELEMENT_ID;
      styleEl.textContent = MP_UI_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
    if (!this.ownsStyleRef) {
      activeStyleMountCount++;
      this.ownsStyleRef = true;
    }
  }

  private stopWorldClickThrough(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  private buildTopBar(root: HTMLElement): void {
    const bar = document.createElement('div');
    bar.className = 'mp-top-bar';
    this.stopWorldClickThrough(bar);
    this.topBarEl = bar;

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mp-coop-trigger-pill';
    pill.title = 'Mở Sảnh Đồng Đội Online Co-op [Phím P]';

    const dot = document.createElement('span');
    dot.className = 'mp-status-dot';

    const globeWrap = document.createElement('span');
    globeWrap.className = 'mp-voice-btn-icon';
    globeWrap.innerHTML = renderCoopGlobeSvg();

    const label = document.createElement('span');
    label.className = 'mp-coop-trigger-label';
    label.textContent = '🌐 CO-OP [P]';

    pill.append(dot, globeWrap, label);
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleLobby();
    });

    this.triggerPillEl = pill;
    this.triggerLabelEl = label;

    // Quick Tactical Ping Strip (Attack, Loot, Danger, Group)
    const pingStrip = document.createElement('div');
    pingStrip.className = 'mp-quick-ping-strip';
    for (const spec of TACTICAL_PING_SPECS) {
      const pBtn = document.createElement('button');
      pBtn.type = 'button';
      pBtn.className = `mp-quick-ping-btn mp-ping-${spec.type}`;
      pBtn.title = `Ping ${spec.label} (Alt + Click)`;
      pBtn.textContent = spec.icon;
      pBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks?.onTriggerPing(spec.type);
      });
      pingStrip.appendChild(pBtn);
    }

    bar.append(pill, pingStrip);
    root.appendChild(bar);
  }

  private buildTopLeftDock(root: HTMLElement): void {
    const dockWrap = document.createElement('div');
    dockWrap.className = 'mp-top-left-dock';
    this.topLeftDockEl = dockWrap;

    // 1. Sleek Voice Control Dock
    const voiceDock = document.createElement('div');
    voiceDock.className = 'mp-voice-dock';
    this.stopWorldClickThrough(voiceDock);
    this.voiceDockEl = voiceDock;

    const topRow = document.createElement('div');
    topRow.className = 'mp-voice-row-top';

    const micEnableBtn = document.createElement('button');
    micEnableBtn.type = 'button';
    micEnableBtn.className = 'mp-voice-btn mp-mic-enable-btn';
    micEnableBtn.title = 'Bật / Tắt Microphone WebRTC';
    micEnableBtn.textContent = '🎙️ Mic Tắt';
    micEnableBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onToggleMicEnable();
    });
    this.micEnableBtnEl = micEnableBtn;

    const micMuteBtn = document.createElement('button');
    micMuteBtn.type = 'button';
    micMuteBtn.className = 'mp-voice-btn mp-mic-mute-btn';
    micMuteBtn.title = 'Tắt Tiếng Mic (Mute)';
    const muteIcon = document.createElement('span');
    muteIcon.className = 'mp-voice-btn-icon';
    muteIcon.innerHTML = renderMicSvg(false);
    micMuteBtn.appendChild(muteIcon);
    micMuteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onToggleMute();
    });
    this.micMuteBtnEl = micMuteBtn;
    this.micMuteIconEl = muteIcon;

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'mp-voice-btn mp-voice-mode-btn';
    modeBtn.title = 'Chuyển đổi Giữ [T] Để Nói (PTT) / Mở Mic Liên Tục (Open Mic)';
    modeBtn.textContent = '[T] PTT';
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextMode = this.lastVoiceMode === 'ptt' ? 'open_mic' : 'ptt';
      this.callbacks?.onSetVoiceMode(nextMode);
    });
    this.voiceModeBtnEl = modeBtn;

    const deafenBtn = document.createElement('button');
    deafenBtn.type = 'button';
    deafenBtn.className = 'mp-voice-btn mp-deafen-btn';
    deafenBtn.title = 'Tắt Nghe Toàn Đội (Deafen)';
    const deafenIcon = document.createElement('span');
    deafenIcon.className = 'mp-voice-btn-icon';
    deafenIcon.innerHTML = renderHeadphonesSvg(false);
    deafenBtn.appendChild(deafenIcon);
    deafenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onToggleDeafen();
    });
    this.deafenBtnEl = deafenBtn;
    this.deafenIconEl = deafenIcon;

    const spatialBtn = document.createElement('button');
    spatialBtn.type = 'button';
    spatialBtn.className = 'mp-voice-btn mp-spatial-btn is-active';
    spatialBtn.title = 'Âm Thanh Không Gian 3D Theo Khoảng Cách (3D Spatial Voice)';
    const spatialIcon = document.createElement('span');
    spatialIcon.className = 'mp-voice-btn-icon';
    spatialIcon.innerHTML = renderSpatialRadarSvg();
    const spatialLbl = document.createElement('span');
    spatialLbl.textContent = '3D';
    spatialBtn.append(spatialIcon, spatialLbl);
    spatialBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onToggleSpatialAudio();
    });
    this.spatialBtnEl = spatialBtn;

    topRow.append(micEnableBtn, micMuteBtn, modeBtn, deafenBtn, spatialBtn);

    const vuRow = document.createElement('div');
    vuRow.className = 'mp-vu-row';
    const vuMeter = document.createElement('div');
    vuMeter.className = 'mp-mic-vu-meter';
    const vuFill = document.createElement('div');
    vuFill.className = 'mp-mic-vu-fill';
    vuMeter.appendChild(vuFill);
    const vuStatus = document.createElement('span');
    vuStatus.className = 'mp-vu-status-label';
    vuStatus.textContent = 'Giữ [T]';
    vuRow.append(vuMeter, vuStatus);

    this.vuMeterEl = vuMeter;
    this.vuFillEl = vuFill;
    this.vuStatusEl = vuStatus;

    voiceDock.append(topRow, vuRow);

    // 2. Sworn Brethren Co-op Buff Badge
    const swornBadge = document.createElement('div');
    swornBadge.className = 'mp-sworn-buff-badge';
    const swornHdr = document.createElement('div');
    swornHdr.className = 'mp-sworn-buff-hdr';
    const swornName = document.createElement('span');
    swornName.textContent = '⚔️ HUYNH ĐỆ THỀ ƯỚC';
    const swornTimer = document.createElement('span');
    swornTimer.textContent = '60s';
    swornHdr.append(swornName, swornTimer);
    const swornSub = document.createElement('div');
    swornSub.className = 'mp-sworn-buff-sub';
    swornSub.textContent = '+25% XP/Gold • +20% DMG • +15% SPD';
    swornBadge.append(swornHdr, swornSub);

    this.swornBadgeEl = swornBadge;
    this.swornTimerEl = swornTimer;
    this.swornSubEl = swornSub;

    // 3. Party Member HUD Frames Stack
    const partyFrames = document.createElement('div');
    partyFrames.className = 'mp-party-frames';
    this.stopWorldClickThrough(partyFrames);
    this.partyFramesContainerEl = partyFrames;

    dockWrap.append(voiceDock, swornBadge, partyFrames);
    root.appendChild(dockWrap);
  }

  private buildLocalDownedAndHighFiveBanners(root: HTMLElement): void {
    // Local Player Downed Bleedout Overlay
    const downedOverlay = document.createElement('div');
    downedOverlay.className = 'mp-local-downed-overlay';

    const card = document.createElement('div');
    card.className = 'mp-bleedout-card';
    this.stopWorldClickThrough(card);

    const title = document.createElement('div');
    title.className = 'mp-bleedout-title';
    title.textContent = '🩸 BẠN ĐÃ GỤC NGÃ — CHỜ ĐỒNG ĐỘI CỨU!';

    const timerText = document.createElement('div');
    timerText.className = 'mp-bleedout-timer';
    timerText.textContent = 'Hấp hối còn: 15.0s';

    const bar = document.createElement('div');
    bar.className = 'mp-bleedout-bar';
    const fill = document.createElement('div');
    fill.className = 'mp-bleedout-fill';
    bar.appendChild(fill);

    const reviveWrap = document.createElement('div');
    reviveWrap.className = 'mp-revive-progress-wrap';
    const reviveLbl = document.createElement('div');
    reviveLbl.className = 'mp-sworn-buff-sub';
    reviveLbl.textContent = '✨ Đồng đội đang truyền sinh lực cứu bạn...';
    const reviveBar = document.createElement('div');
    reviveBar.className = 'mp-revive-bar';
    const reviveFill = document.createElement('div');
    reviveFill.className = 'mp-revive-fill';
    reviveBar.appendChild(reviveFill);
    reviveWrap.append(reviveLbl, reviveBar);

    const sosBtn = document.createElement('button');
    sosBtn.type = 'button';
    sosBtn.className = 'mp-sos-call-btn';
    sosBtn.textContent = '🆘 GỌI ĐỒNG ĐỘI CỨU VIỆN!';
    sosBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onTriggerEmoji('sos_help');
      this.callbacks?.onTriggerPing('danger');
    });

    card.append(title, timerText, bar, reviveWrap, sosBtn);
    downedOverlay.appendChild(card);

    this.downedOverlayEl = downedOverlay;
    this.bleedoutTimerEl = timerText;
    this.bleedoutFillEl = fill;
    this.reviveWrapEl = reviveWrap;
    this.reviveLabelEl = reviveLbl;
    this.reviveFillEl = reviveFill;

    // [H] High-Five / Đập Kiếm Prompt Banner
    const hfBanner = document.createElement('div');
    hfBanner.className = 'mp-highfive-banner';
    this.stopWorldClickThrough(hfBanner);

    const hfKey = document.createElement('span');
    hfKey.className = 'mp-highfive-key';
    hfKey.textContent = 'H';

    const hfIcon = document.createElement('span');
    hfIcon.className = 'mp-voice-btn-icon';
    hfIcon.style.width = '20px';
    hfIcon.style.height = '20px';
    hfIcon.style.color = '#ffd43b';
    hfIcon.innerHTML = renderTwinBladesSvg();

    const hfTextCol = document.createElement('div');
    hfTextCol.className = 'mp-highfive-text';
    const hfTitle = document.createElement('div');
    hfTitle.className = 'mp-highfive-title';
    hfTitle.textContent = '[H] Đập Tay / Chạm Kiếm!';
    const hfSub = document.createElement('div');
    hfSub.className = 'mp-highfive-sub';
    hfSub.textContent = 'Kích hoạt hào quang Huynh Đệ Thề Ước (+25% XP/Vàng, +20% Sát Thương)';
    hfTextCol.append(hfTitle, hfSub);

    hfBanner.append(hfKey, hfIcon, hfTextCol);
    hfBanner.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onTriggerHighFive();
    });

    this.highFiveBannerEl = hfBanner;
    this.highFiveTitleEl = hfTitle;

    root.append(downedOverlay, hfBanner);
  }

  private buildPartyChatBox(root: HTMLElement): void {
    const box = document.createElement('div');
    box.className = 'mp-chat-box';
    this.stopWorldClickThrough(box);
    this.chatBoxEl = box;

    // Header Row with Minimize / Expand button
    const headerRow = document.createElement('div');
    headerRow.className = 'mp-chat-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'mp-chat-header-title';
    titleSpan.textContent = '💬 Trò Chuyện Đội';

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'mp-chat-collapse-btn';
    collapseBtn.title = 'Thu nhỏ / Mở rộng khung chat';
    collapseBtn.textContent = '− Thu Nhỏ';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      eventBus.emit('sfx:request', { id: 'ui_click' });
      this.setChatCollapsed(!this.chatCollapsed);
    });
    this.chatCollapseBtnEl = collapseBtn;

    headerRow.append(titleSpan, collapseBtn);

    const feed = document.createElement('div');
    feed.className = 'mp-chat-feed';
    this.chatFeedEl = feed;

    // 12-Emoji Quick-Reaction Bar
    const emojiBar = document.createElement('div');
    emojiBar.className = 'mp-emoji-bar';
    for (const item of QUICK_EMOJI_BAR_ITEMS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mp-emoji-pill mp-emoji-${item.id}`;
      btn.title = item.title;
      btn.textContent = item.display;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.kind === 'emoji' && item.emojiId) {
          this.callbacks?.onTriggerEmoji(item.emojiId);
        } else if (item.kind === 'emote' && item.emoteId) {
          this.callbacks?.onTriggerEmote(item.emoteId);
        } else if (item.kind === 'ping' && item.pingType) {
          this.callbacks?.onTriggerPing(item.pingType);
        } else if (item.kind === 'highfive') {
          this.callbacks?.onTriggerHighFive();
        }
      });
      emojiBar.appendChild(btn);
    }

    // Chat Input + Send Button
    const inputRow = document.createElement('div');
    inputRow.className = 'mp-chat-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mp-chat-input';
    input.maxLength = 200;
    input.placeholder = '[Enter] Trò Chuyện • /wave /dance /cheer /taunt /sit /pray /highfive';

    input.addEventListener('focus', () => {
      this.chatFocused = true;
      this.chatBoxEl?.classList.add('is-focused');
    });
    input.addEventListener('blur', () => {
      this.chatFocused = false;
      this.chatBoxEl?.classList.remove('is-focused');
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitChatInput();
        this.blurChat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.blurChat();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'mp-chat-send-btn';
    sendBtn.textContent = 'Gửi';
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.submitChatInput();
      this.blurChat();
    });

    this.chatInputEl = input;
    inputRow.append(input, sendBtn);
    box.append(headerRow, feed, emojiBar, inputRow);
    root.appendChild(box);
  }

  private buildRadialWheelAndPingRose(root: HTMLElement): void {
    // 8-Slice Radial Emote & Emoji Wheel
    const backdrop = document.createElement('div');
    backdrop.className = 'mp-radial-wheel-backdrop';
    this.stopWorldClickThrough(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeRadialWheel(false);
      }
    });

    const wheel = document.createElement('div');
    wheel.className = 'mp-radial-wheel';

    this.wheelSliceEls = [];
    this.wheelSliceIconEls = [];
    this.wheelSliceLabelEls = [];

    const radiusPx = 116;
    const centerPx = 166;

    for (let i = 0; i < 8; i++) {
      const angleRad = (i * Math.PI) / 4; // 0 at top, clockwise
      const cx = centerPx + Math.sin(angleRad) * radiusPx;
      const cy = centerPx - Math.cos(angleRad) * radiusPx;

      const sliceBtn = document.createElement('button');
      sliceBtn.type = 'button';
      sliceBtn.className = `mp-wheel-slice mp-wheel-slice-${i}`;
      sliceBtn.style.left = `${Math.round(cx)}px`;
      sliceBtn.style.top = `${Math.round(cy)}px`;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'mp-wheel-slice-icon';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'mp-wheel-slice-label';

      sliceBtn.append(iconSpan, labelSpan);
      sliceBtn.addEventListener('pointerenter', () => {
        this.setWheelSelectedSlice(i);
      });
      sliceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setWheelSelectedSlice(i);
        this.closeRadialWheel(true);
      });

      this.wheelSliceEls.push(sliceBtn);
      this.wheelSliceIconEls.push(iconSpan);
      this.wheelSliceLabelEls.push(labelSpan);
      wheel.appendChild(sliceBtn);
    }

    const hub = document.createElement('div');
    hub.className = 'mp-wheel-center-hub';

    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'mp-wheel-mode-toggle';
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setWheelMode(this.wheelMode === 'emote' ? 'emoji' : 'emote');
    });
    this.wheelModeBtnEl = modeBtn;

    const hfBtn = document.createElement('button');
    hfBtn.type = 'button';
    hfBtn.className = 'mp-wheel-highfive-btn';
    hfBtn.textContent = '⚔️ [H] Đập Kiếm';
    hfBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRadialWheel(false);
      this.callbacks?.onTriggerHighFive();
    });

    hub.append(modeBtn, hfBtn);
    wheel.appendChild(hub);
    backdrop.appendChild(wheel);
    this.wheelBackdropEl = backdrop;
    this.refreshWheelLabels();

    // 4-Way Alt+Click Tactical Ping Rose
    const pingRose = document.createElement('div');
    pingRose.className = 'mp-ping-rose';
    this.stopWorldClickThrough(pingRose);

    const roseCoords: Record<TacticalPingType, { left: number; top: number }> = {
      attack: { left: 84, top: 20 },
      loot: { left: 146, top: 84 },
      danger: { left: 84, top: 148 },
      group: { left: 22, top: 84 },
    };

    for (const spec of TACTICAL_PING_SPECS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mp-ping-rose-btn mp-rose-${spec.type}`;
      btn.style.left = `${roseCoords[spec.type].left}px`;
      btn.style.top = `${roseCoords[spec.type].top}px`;
      btn.textContent = `${spec.icon} ${spec.label}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pingSelectedType = spec.type;
        this.commitPingRose();
      });
      this.pingRoseBtnMap.set(spec.type, btn);
      pingRose.appendChild(btn);
    }

    this.pingRoseEl = pingRose;
    root.append(backdrop, pingRose);
  }

  private buildLobbyModal(root: HTMLElement): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'mp-lobby-backdrop';
    this.stopWorldClickThrough(backdrop);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeLobby();
      }
    });
    this.lobbyBackdropEl = backdrop;

    const modal = document.createElement('div');
    modal.className = 'mp-lobby-modal';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'mp-lobby-header';
    const titleGroup = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'mp-lobby-title';
    title.textContent = '🌐 SẢNH ĐỒNG ĐỘI CO-OP ONLINE (CROSS-NETWORK P2P)';
    const sub = document.createElement('div');
    sub.className = 'mp-lobby-sub';
    sub.textContent = 'Tối đa 4 Chiến Binh • Chơi khác mạng Wi-Fi/4G • Đàm thoại 3D Spatial Voice';
    titleGroup.append(title, sub);

    const rightHdr = document.createElement('div');
    rightHdr.style.display = 'flex';
    rightHdr.style.alignItems = 'center';
    rightHdr.style.gap = '10px';

    const connBadge = document.createElement('span');
    connBadge.className = 'mp-ping-pill';
    connBadge.textContent = 'CHƠI ĐƠN NGOẠI TUYẾN';
    this.connStatusBadgeEl = connBadge;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mp-lobby-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.closeLobby());

    rightHdr.append(connBadge, closeBtn);
    hdr.append(titleGroup, rightHdr);

    // Top row: Nickname input + AI Test Co-op Bot CTA
    const topControls = document.createElement('div');
    topControls.className = 'mp-lobby-top-controls';

    const nickGroup = document.createElement('div');
    nickGroup.className = 'mp-field-group';
    const nickLabel = document.createElement('span');
    nickLabel.className = 'mp-field-label';
    nickLabel.textContent = 'Tên Nhân Vật (Biệt Danh):';
    const nickInput = document.createElement('input');
    nickInput.type = 'text';
    nickInput.className = 'mp-text-input mp-nickname-input';
    nickInput.maxLength = 20;
    nickInput.value = 'Chiến Binh';
    nickInput.placeholder = 'Nhập biệt danh...';
    this.bindLobbyTextInputGuard(nickInput, () => {
      this.nicknameEditedByUser = true;
    });
    this.nicknameInputEl = nickInput;
    nickGroup.append(nickLabel, nickInput);

    const botBtn = document.createElement('button');
    botBtn.type = 'button';
    botBtn.className = 'mp-cta-btn mp-bot-cta mp-spawn-bot-btn';
    botBtn.textContent = '🤖 Thêm Đồng Đội AI Hợp Tác';
    botBtn.addEventListener('click', () => {
      this.callbacks?.onSpawnBotPartner();
    });

    topControls.append(nickGroup, botBtn);

    // 3 Transport Mode Tabs
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'mp-transport-tabs';
    for (const spec of TRANSPORT_TABS) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = `mp-transport-tab mp-tab-${spec.mode}`;
      if (spec.mode === this.selectedMode) tabBtn.classList.add('is-selected');

      const tabTitle = document.createElement('div');
      tabTitle.className = 'mp-transport-tab-title';
      tabTitle.textContent = spec.label;
      const tabDesc = document.createElement('div');
      tabDesc.className = 'mp-transport-tab-desc';
      tabDesc.textContent = spec.desc;
      tabBtn.append(tabTitle, tabDesc);

      tabBtn.addEventListener('click', () => {
        this.selectTransportMode(spec.mode);
      });
      this.transportTabBtns.set(spec.mode, tabBtn);
      tabsWrap.appendChild(tabBtn);
    }

    // Relay URL input row (shown for websocket_relay)
    const relayRow = document.createElement('div');
    relayRow.className = 'mp-relay-row';
    const relayLbl = document.createElement('span');
    relayLbl.className = 'mp-field-label';
    relayLbl.textContent = 'Relay Server URL:';
    const relayInput = document.createElement('input');
    relayInput.type = 'text';
    relayInput.className = 'mp-text-input mp-relay-input';
    relayInput.style.flex = '1';
    relayInput.value = 'ws://localhost:8787';
    relayInput.placeholder = 'wss://your-relay.example.com hoặc ws://localhost:8787';
    this.bindLobbyTextInputGuard(relayInput);
    relayRow.append(relayLbl, relayInput);
    this.relayRowEl = relayRow;
    this.relayInputEl = relayInput;

    // Host & Join Action Panels
    const actionsGrid = document.createElement('div');
    actionsGrid.className = 'mp-lobby-actions-grid';

    // Left: Create Online Party + Glowing 6-Char Room Code
    const hostPanel = document.createElement('div');
    hostPanel.className = 'mp-action-panel';
    const hostBtn = document.createElement('button');
    hostBtn.type = 'button';
    hostBtn.className = 'mp-cta-btn mp-host-btn';
    hostBtn.textContent = '👑 Tạo Phòng Online (Chủ Phòng Mới)';
    hostBtn.addEventListener('click', () => {
      this.callbacks?.onHostRoom(
        this.selectedMode,
        this.getNicknameValue(),
        this.getRelayUrlValue(),
      );
    });

    const codeBox = document.createElement('div');
    codeBox.className = 'mp-room-code-box';
    const codeText = document.createElement('span');
    codeText.className = 'mp-room-code-display';
    codeText.textContent = '------';

    const copyBtns = document.createElement('div');
    copyBtns.className = 'mp-copy-btns';

    const copyCodeBtn = document.createElement('button');
    copyCodeBtn.type = 'button';
    copyCodeBtn.className = 'mp-mini-btn mp-copy-code-btn';
    copyCodeBtn.textContent = '📋 Sao Chép Mã';
    copyCodeBtn.addEventListener('click', () => {
      if (!this.lastRoomCode) return;
      this.writeClipboardSafe(this.lastRoomCode);
      this.copyCodeBtnEl!.textContent = '✓ Đã Sao Chép!';
      this.copyCodeFeedbackSec = 1.6;
    });

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.type = 'button';
    copyLinkBtn.className = 'mp-mini-btn mp-copy-link-btn';
    copyLinkBtn.textContent = '🔗 Sao Chép Link Mời';
    copyLinkBtn.addEventListener('click', () => {
      if (!this.lastRoomCode) return;
      const inviteUrl = this.buildInviteLink(this.lastRoomCode);
      this.writeClipboardSafe(inviteUrl);
      this.copyLinkBtnEl!.textContent = '✓ Đã Sao Chép Link!';
      this.copyLinkFeedbackSec = 1.6;
    });

    const leaveBtn = document.createElement('button');
    leaveBtn.type = 'button';
    leaveBtn.className = 'mp-cta-btn mp-danger-cta mp-leave-btn';
    leaveBtn.style.display = 'none';
    leaveBtn.textContent = '🚪 Rời Phòng';
    leaveBtn.addEventListener('click', () => {
      this.callbacks?.onLeaveRoom();
    });

    copyBtns.append(copyCodeBtn, copyLinkBtn);
    codeBox.append(codeText, copyBtns);
    hostPanel.append(hostBtn, codeBox, leaveBtn);

    this.roomCodeBoxEl = codeBox;
    this.roomCodeTextEl = codeText;
    this.copyCodeBtnEl = copyCodeBtn;
    this.copyLinkBtnEl = copyLinkBtn;
    this.leaveRoomBtnEl = leaveBtn;

    // Right: Join by Room Code
    const joinPanel = document.createElement('div');
    joinPanel.className = 'mp-action-panel';
    const joinLbl = document.createElement('div');
    joinLbl.className = 'mp-field-label';
    joinLbl.textContent = 'Vào Phòng Bằng Mã 6 Ký Tự:';

    const joinInput = document.createElement('input');
    joinInput.type = 'text';
    joinInput.className = 'mp-text-input mp-join-code-input';
    joinInput.maxLength = 12;
    joinInput.placeholder = 'NHẬP MÃ PHÒNG (VD: K7X9Q2)';
    this.bindLobbyTextInputGuard(
      joinInput,
      () => {
        joinInput.value = joinInput.value.toUpperCase();
      },
      () => this.submitJoinRoom(),
    );
    this.joinCodeInputEl = joinInput;

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'mp-cta-btn mp-join-btn';
    joinBtn.textContent = '⚔️ Vào Phòng (Tham Gia Tổ Đội)';
    joinBtn.addEventListener('click', () => this.submitJoinRoom());

    joinPanel.append(joinLbl, joinInput, joinBtn);
    actionsGrid.append(hostPanel, joinPanel);

    // Error Banner
    const errorBanner = document.createElement('div');
    errorBanner.className = 'mp-error-banner';
    this.errorBannerEl = errorBanner;

    // 4-Player Party Roster Header + Gift Buttons
    const rosterHdr = document.createElement('div');
    rosterHdr.className = 'mp-roster-header';
    const rosterTitle = document.createElement('span');
    rosterTitle.className = 'mp-field-label';
    rosterTitle.textContent = 'Đội Hình Chiến Binh (1 / 4):';
    this.rosterCountLabelEl = rosterTitle;

    const giftGroup = document.createElement('div');
    giftGroup.className = 'mp-copy-btns';
    const giftGoldBtn = document.createElement('button');
    giftGoldBtn.type = 'button';
    giftGoldBtn.className = 'mp-mini-btn mp-gift-gold-btn';
    giftGoldBtn.textContent = '🪙 Tặng Vàng (100g)';
    giftGoldBtn.addEventListener('click', () => {
      this.callbacks?.onDropGiftForParty('gold');
    });
    const giftPotionBtn = document.createElement('button');
    giftPotionBtn.type = 'button';
    giftPotionBtn.className = 'mp-mini-btn mp-gift-potion-btn';
    giftPotionBtn.textContent = '🧪 Tặng Thuốc (Potion)';
    giftPotionBtn.addEventListener('click', () => {
      this.callbacks?.onDropGiftForParty('potion');
    });
    giftGroup.append(giftGoldBtn, giftPotionBtn);
    rosterHdr.append(rosterTitle, giftGroup);

    // 4-Player Roster Grid
    const rosterGrid = document.createElement('div');
    rosterGrid.className = 'mp-roster-grid';
    this.rosterGridEl = rosterGrid;

    // Build Local Player Slot 0 + 3 Empty Placeholders initially
    const localCard = this.createLocalRosterCard();
    rosterGrid.appendChild(localCard);

    this.rosterEmptyPlaceholders = [];
    for (let i = 0; i < 3; i++) {
      const empty = document.createElement('div');
      empty.className = 'mp-roster-card is-empty';
      empty.textContent = 'Ô Trống — Chia sẻ Mã Phòng hoặc Thêm Đồng Đội AI';
      this.rosterEmptyPlaceholders.push(empty);
      rosterGrid.appendChild(empty);
    }

    modal.append(hdr, topControls, tabsWrap, relayRow, actionsGrid, errorBanner, rosterHdr, rosterGrid);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  private createLocalRosterCard(): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'mp-roster-card mp-local-roster-card';

    const top = document.createElement('div');
    top.className = 'mp-rc-top';
    const emblem = document.createElement('div');
    emblem.className = 'mp-rc-emblem';
    emblem.innerHTML = renderClassEmblemSvg('vanguard');

    const titleCol = document.createElement('div');
    titleCol.className = 'mp-rc-title-col';
    const nameRow = document.createElement('div');
    nameRow.className = 'mp-rc-name';
    const crown = document.createElement('span');
    crown.className = 'mp-host-crown';
    crown.innerHTML = renderCrownSvg();
    const nameTxt = document.createElement('span');
    nameTxt.textContent = 'Bạn (You)';
    nameRow.append(crown, nameTxt);

    const sub = document.createElement('div');
    sub.className = 'mp-transport-tab-desc';
    sub.textContent = 'Chiến Binh Bản Địa';
    titleCol.append(nameRow, sub);

    const ping = document.createElement('span');
    ping.className = 'mp-ping-pill';
    ping.textContent = '0 ms';

    top.append(emblem, titleCol, ping);

    const wave = document.createElement('div');
    wave.className = 'mp-voice-waveform';
    this.localRosterWaveBars = [];
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'mp-wave-bar';
      this.localRosterWaveBars.push(b);
      wave.appendChild(b);
    }

    this.localRosterNameEl = nameTxt;
    this.localRosterCrownEl = crown;

    card.append(top, wave);
    return card;
  }

  private createRemoteRosterCard(peer: RemotePeerSnapshot): RosterPeerCardRefs {
    const card = document.createElement('div');
    card.className = `mp-roster-card mp-peer-roster-card`;

    const top = document.createElement('div');
    top.className = 'mp-rc-top';

    const emblem = document.createElement('div');
    emblem.className = 'mp-rc-emblem';
    emblem.innerHTML = renderClassEmblemSvg(peer.heroClass);

    const titleCol = document.createElement('div');
    titleCol.className = 'mp-rc-title-col';
    const nameRow = document.createElement('div');
    nameRow.className = 'mp-rc-name';

    const crown = document.createElement('span');
    crown.className = 'mp-host-crown';
    crown.innerHTML = renderCrownSvg();
    crown.style.display = peer.isHost ? 'inline-block' : 'none';

    const nameText = document.createElement('span');
    nameText.textContent = peer.nickname;
    nameRow.append(crown, nameText);

    const subInfo = document.createElement('div');
    subInfo.className = 'mp-transport-tab-desc';
    titleCol.append(nameRow, subInfo);

    const ping = document.createElement('span');
    ping.className = 'mp-ping-pill';

    top.append(emblem, titleCol, ping);

    // Live Green Voice Waveform Bar
    const wave = document.createElement('div');
    wave.className = 'mp-voice-waveform';
    const waveBars: HTMLDivElement[] = [];
    for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
      const b = document.createElement('div');
      b.className = 'mp-wave-bar';
      waveBars.push(b);
      wave.appendChild(b);
    }

    // Per-Player Mute & 0%-200% Volume Slider
    const volRow = document.createElement('div');
    volRow.className = 'mp-vol-row';

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'mp-mini-btn mp-peer-mute-btn';
    muteBtn.textContent = '🔊';
    const peerId = peer.peerId;
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentlyMuted = this.lastPeerMutedMap.get(peerId) ?? false;
      this.callbacks?.onSetPeerMuted(peerId, !currentlyMuted);
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '200';
    slider.step = '5';
    slider.value = '100';
    slider.className = 'mp-peer-vol-slider';

    const volVal = document.createElement('span');
    volVal.textContent = '100%';

    const refs: RosterPeerCardRefs = {
      cardEl: card,
      emblemEl: emblem,
      nameTextEl: nameText,
      crownEl: crown,
      subInfoEl: subInfo,
      pingEl: ping,
      waveBars,
      muteBtnEl: muteBtn,
      volSliderEl: slider,
      volValueEl: volVal,
      isDraggingVolume: false,
      lastClass: peer.heroClass,
    };

    slider.addEventListener('pointerdown', () => {
      refs.isDraggingVolume = true;
    });
    slider.addEventListener('pointerup', () => {
      refs.isDraggingVolume = false;
    });
    slider.addEventListener('blur', () => {
      refs.isDraggingVolume = false;
    });
    const onVolChange = () => {
      const pct = clamp(Number(slider.value) || 0, 0, 200);
      volVal.textContent = `${Math.round(pct)}%`;
      this.callbacks?.onSetPeerVolume(peerId, pct / 100);
    };
    slider.addEventListener('input', onVolChange);
    slider.addEventListener('change', onVolChange);

    volRow.append(muteBtn, slider, volVal);

    // Teleport to Ally & Drop Gift (100g / Potion) Buttons
    const actions = document.createElement('div');
    actions.className = 'mp-rc-actions';

    const tpBtn = document.createElement('button');
    tpBtn.type = 'button';
    tpBtn.className = 'mp-mini-btn mp-teleport-btn';
    tpBtn.textContent = '⚡ Dịch Chuyển Tới Đồng Đội';
    tpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onTeleportToPeer(peerId);
    });

    const giftGold = document.createElement('button');
    giftGold.type = 'button';
    giftGold.className = 'mp-mini-btn mp-card-gift-gold-btn';
    giftGold.textContent = '🪙 100g';
    giftGold.title = 'Tặng Vàng (100 Gold)';
    giftGold.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onDropGiftForParty('gold');
    });

    const giftPot = document.createElement('button');
    giftPot.type = 'button';
    giftPot.className = 'mp-mini-btn mp-card-gift-potion-btn';
    giftPot.textContent = '🧪 Potion';
    giftPot.title = 'Tặng Thuốc (Health Potion)';
    giftPot.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onDropGiftForParty('potion');
    });

    actions.append(tpBtn, giftGold, giftPot);
    card.append(top, wave, volRow, actions);
    return refs;
  }

  private createPartyHudFrame(peer: RemotePeerSnapshot): PartyHudFrameRefs {
    const frame = document.createElement('div');
    frame.className = 'mp-party-frame';

    const top = document.createElement('div');
    top.className = 'mp-pf-top';

    const avatar = document.createElement('div');
    avatar.className = 'mp-pf-avatar';
    avatar.innerHTML = renderClassEmblemSvg(peer.heroClass);

    const meta = document.createElement('div');
    meta.className = 'mp-pf-meta';

    const nameRow = document.createElement('div');
    nameRow.className = 'mp-pf-name-row';
    const crown = document.createElement('span');
    crown.className = 'mp-host-crown';
    crown.innerHTML = renderCrownSvg();
    const nameSpan = document.createElement('span');
    nameSpan.textContent = peer.nickname;
    nameRow.append(crown, nameSpan);

    const subRow = document.createElement('div');
    subRow.className = 'mp-pf-sub-row';
    const lvlPing = document.createElement('span');
    const hpText = document.createElement('span');
    subRow.append(lvlPing, hpText);

    meta.append(nameRow, subRow);

    const tpMini = document.createElement('button');
    tpMini.type = 'button';
    tpMini.className = 'mp-pf-tp-mini';
    tpMini.title = 'Dịch chuyển tới đồng đội (Teleport to Ally)';
    tpMini.textContent = '⚡';
    const peerId = peer.peerId;
    tpMini.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks?.onTeleportToPeer(peerId);
    });

    top.append(avatar, meta, tpMini);

    const hpTrack = document.createElement('div');
    hpTrack.className = 'mp-pf-hp-track';
    const hpFill = document.createElement('div');
    hpFill.className = 'mp-pf-hp-fill';
    hpTrack.appendChild(hpFill);

    const downedBadge = document.createElement('div');
    downedBadge.className = 'mp-downed-alert-badge';
    downedBadge.textContent = '🆘 CỨU ĐỒNG ĐỘI [F]!';

    frame.append(top, hpTrack, downedBadge);

    return {
      frameEl: frame,
      avatarEl: avatar,
      nameEl: nameSpan,
      crownEl: crown,
      lvlPingEl: lvlPing,
      hpTextEl: hpText,
      hpFillEl: hpFill,
      downedBadgeEl: downedBadge,
      lastClass: peer.heroClass,
    };
  }

  // =========================================================================
  // LIVE 120HZ INCREMENTAL UPDATERS
  // =========================================================================

  private updateTopBarAndLobbyState(snapshot: MultiplayerUISnapshot): void {
    const conn = snapshot.connection;
    const totalPlayers = Math.min(4, 1 + snapshot.peers.length);
    this.lastRoomCode = conn.roomCode || '';

    if (this.triggerPillEl && this.triggerLabelEl) {
      this.triggerPillEl.classList.toggle('is-connected', conn.connected);
      this.triggerPillEl.classList.toggle('is-connecting', conn.connecting && !conn.connected);

      if (conn.connected && conn.roomCode) {
        this.triggerLabelEl.textContent = `🌐 CO-OP [P] • ${totalPlayers}/4 • ${conn.roomCode}`;
      } else if (conn.connecting) {
        this.triggerLabelEl.textContent = '🌐 CO-OP [P] • Đang kết nối...';
      } else if (snapshot.peers.length > 0) {
        this.triggerLabelEl.textContent = `🌐 CO-OP [P] • ${totalPlayers}/4`;
      } else {
        this.triggerLabelEl.textContent = '🌐 CO-OP [P]';
      }
    }

    if (
      this.nicknameInputEl &&
      !this.nicknameEditedByUser &&
      !this.lobbyInputFocused &&
      conn.localNickname
    ) {
      this.nicknameInputEl.value = conn.localNickname;
    }

    if (this.roomCodeTextEl) {
      this.roomCodeTextEl.textContent = conn.roomCode ? conn.roomCode : '------';
    }

    if (this.leaveRoomBtnEl) {
      this.leaveRoomBtnEl.style.display =
        conn.connected || snapshot.peers.length > 0 ? 'inline-block' : 'none';
    }

    if (this.connStatusBadgeEl) {
      if (conn.connected) {
        this.connStatusBadgeEl.textContent = conn.isHost
          ? `TRỰC TUYẾN • CHỦ PHÒNG (${conn.roomCode})`
          : `TRỰC TUYẾN • KHÁCH (${conn.roomCode})`;
        this.connStatusBadgeEl.classList.remove('ping-mid', 'ping-high');
      } else if (conn.connecting) {
        this.connStatusBadgeEl.textContent = 'ĐANG KẾT NỐI...';
        this.connStatusBadgeEl.classList.add('ping-mid');
      } else {
        this.connStatusBadgeEl.textContent =
          snapshot.peers.length > 0 ? 'AI CO-OP LOCAL' : 'SOLO OFFLINE';
        this.connStatusBadgeEl.classList.remove('ping-mid', 'ping-high');
      }
    }

    if (this.errorBannerEl) {
      const hasErr = Boolean(conn.errorMessage);
      this.errorBannerEl.classList.toggle('is-visible', hasErr);
      if (hasErr) {
        this.errorBannerEl.textContent = `⚠️ ${conn.errorMessage}`;
      }
    }
  }

  private updateVoiceDock(voice: LocalVoiceState): void {
    this.lastVoiceMode = voice.mode;
    const isMutedOrOff = !voice.micEnabled || voice.muted || voice.deafened;
    this.voiceDockEl?.classList.toggle('is-muted', isMutedOrOff);

    if (this.micEnableBtnEl) {
      this.micEnableBtnEl.classList.toggle('is-active', voice.micEnabled);
      this.micEnableBtnEl.classList.toggle(
        'is-danger',
        voice.micPermission === 'denied' || voice.micPermission === 'unavailable',
      );
      this.micEnableBtnEl.textContent = voice.micEnabled ? '🎙️ Mic Bật' : '🎙️ Mic Tắt';
    }

    if (this.micMuteBtnEl && this.micMuteIconEl) {
      this.micMuteBtnEl.classList.toggle('is-danger', voice.muted);
      this.micMuteIconEl.innerHTML = renderMicSvg(voice.muted);
    }

    if (this.voiceModeBtnEl) {
      const pttHeld = voice.pttActive || this.pttEventActive;
      this.voiceModeBtnEl.classList.toggle('is-active', voice.mode === 'open_mic' || pttHeld);
      this.voiceModeBtnEl.textContent = voice.mode === 'ptt' ? '[T] PTT' : 'Mic Mở';
    }

    if (this.deafenBtnEl && this.deafenIconEl) {
      this.deafenBtnEl.classList.toggle('is-danger', voice.deafened);
      this.deafenIconEl.innerHTML = renderHeadphonesSvg(voice.deafened);
    }

    if (this.spatialBtnEl) {
      this.spatialBtnEl.classList.toggle('is-active', voice.spatialAudio);
    }

    if (this.vuMeterEl && this.vuFillEl && this.vuStatusEl) {
      const levelPct = Math.round(clamp(voice.voiceLevel, 0, 1) * 100);
      this.vuFillEl.style.width = `${levelPct}%`;
      this.vuMeterEl.classList.toggle('is-speaking', voice.isSpeaking);

      if (voice.micPermission === 'denied') {
        this.vuStatusEl.textContent = 'Mic Bị Từ Chối';
      } else if (voice.deafened) {
        this.vuStatusEl.textContent = 'Đang Điếc';
      } else if (!voice.micEnabled) {
        this.vuStatusEl.textContent = 'Mic Tắt';
      } else if (voice.muted) {
        this.vuStatusEl.textContent = 'Đã Tắt Tiếng';
      } else if (voice.isSpeaking || voice.pttActive || this.pttEventActive) {
        this.vuStatusEl.textContent = 'Đang Nói';
      } else {
        this.vuStatusEl.textContent = voice.mode === 'ptt' ? 'Giữ [T]' : 'Mic Trực Tiếp';
      }
    }
  }

  private updateSwornBrethrenBadge(snapshot: MultiplayerUISnapshot): void {
    if (!this.swornBadgeEl || !this.swornTimerEl || !this.swornSubEl) return;
    const buff = snapshot.socialBuff;
    const active = buff.swornBrethrenSec > 0;
    this.swornBadgeEl.classList.toggle('is-visible', active);
    if (active) {
      this.swornTimerEl.textContent = `${Math.ceil(buff.swornBrethrenSec)}s`;
      const xpPct = Math.round((buff.xpGoldMultiplier - 1) * 100);
      const dmgPct = Math.round((buff.powerMultiplier - 1) * 100);
      const spdPct = Math.round((buff.moveSpeedBonus > 1 ? buff.moveSpeedBonus - 1 : buff.moveSpeedBonus) * 100);
      this.swornSubEl.textContent = `+${xpPct}% XP/Gold • +${dmgPct}% DMG • +${spdPct}% SPD`;
    }
  }

  private updatePartyHudFrames(
    peers: RemotePeerSnapshot[],
    peerVoice: Record<string, PeerVoiceState>,
  ): void {
    if (!this.partyFramesContainerEl) return;

    const activeIds = new Set(peers.map((p) => p.peerId));
    for (const [id, refs] of this.partyFrameRefs.entries()) {
      if (!activeIds.has(id)) {
        refs.frameEl.remove();
        this.partyFrameRefs.delete(id);
      }
    }

    for (const peer of peers) {
      let refs = this.partyFrameRefs.get(peer.peerId);
      if (!refs) {
        refs = this.createPartyHudFrame(peer);
        this.partyFrameRefs.set(peer.peerId, refs);
        this.partyFramesContainerEl.appendChild(refs.frameEl);
      }

      if (refs.lastClass !== peer.heroClass) {
        refs.avatarEl.innerHTML = renderClassEmblemSvg(peer.heroClass);
        refs.lastClass = peer.heroClass;
      }

      const vState = peerVoice[peer.peerId];
      const speaking = Boolean(vState?.isSpeaking && !vState?.mutedByLocal);

      refs.frameEl.classList.toggle('is-speaking', speaking);
      refs.frameEl.classList.toggle('is-downed', peer.downed);
      refs.crownEl.style.display = peer.isHost ? 'inline-block' : 'none';
      refs.nameEl.textContent = peer.awakened ? `✦ ${peer.nickname}` : peer.nickname;
      refs.lvlPingEl.textContent = `Lv.${peer.level} • ${Math.round(peer.pingMs)}ms`;

      const hpPct = peer.maxHp > 0 ? clamp((peer.hp / peer.maxHp) * 100, 0, 100) : 0;
      refs.hpFillEl.style.width = `${hpPct.toFixed(1)}%`;
      refs.hpTextEl.textContent = `${Math.max(0, Math.ceil(peer.hp))}/${Math.round(peer.maxHp)}`;

      if (peer.downed) {
        const bleedTxt =
          peer.downedBleedoutSec !== undefined ? ` (${peer.downedBleedoutSec.toFixed(1)}s)` : '';
        refs.downedBadgeEl.textContent = `🆘 CỨU ĐỒNG ĐỘI [F]!${bleedTxt}`;
      }
    }
  }

  private updateLocalDownedAndHighFive(snapshot: MultiplayerUISnapshot): void {
    const d = snapshot.downedState;
    if (this.downedOverlayEl) {
      this.downedOverlayEl.classList.toggle('is-visible', d.isDowned);
      if (d.isDowned) {
        if (this.bleedoutTimerEl) {
          this.bleedoutTimerEl.textContent = `Hấp hối còn: ${Math.max(0, d.bleedoutRemainingSec).toFixed(1)}s`;
        }
        if (this.bleedoutFillEl) {
          const pct =
            d.bleedoutTotalSec > 0
              ? clamp((d.bleedoutRemainingSec / d.bleedoutTotalSec) * 100, 0, 100)
              : 0;
          this.bleedoutFillEl.style.width = `${pct.toFixed(1)}%`;
        }
        if (this.reviveWrapEl && this.reviveFillEl && this.reviveLabelEl) {
          const reviving = d.reviveProgress01 > 0.01;
          this.reviveWrapEl.classList.toggle('is-active', reviving);
          if (reviving) {
            const rPct = Math.round(clamp(d.reviveProgress01, 0, 1) * 100);
            this.reviveFillEl.style.width = `${rPct}%`;
            const savior = d.reviverName || 'Đồng đội';
            this.reviveLabelEl.textContent = `✨ ${savior} đang cứu bạn... (${rPct}%)`;
          }
        }
      }
    }

    if (this.highFiveBannerEl && this.highFiveTitleEl) {
      const inviter = snapshot.nearbyInviteName?.trim();
      const showInvite = Boolean(inviter) && !d.isDowned;
      this.highFiveBannerEl.classList.toggle('is-visible', showInvite);
      if (showInvite) {
        this.highFiveTitleEl.textContent = `[H] High-Five / Đập Kiếm cùng ${inviter}!`;
      }
    }
  }

  private updateLobbyRoster(snapshot: MultiplayerUISnapshot): void {
    if (!this.rosterGridEl) return;

    const visiblePeers = snapshot.peers.slice(0, 3);
    const totalCount = 1 + visiblePeers.length;
    if (this.rosterCountLabelEl) {
      this.rosterCountLabelEl.textContent = `Đội Hình Chiến Binh (${totalCount} / 4):`;
    }

    // Update Local Card
    if (this.localRosterNameEl) {
      this.localRosterNameEl.textContent = `${snapshot.connection.localNickname || 'Bạn'} (You)`;
    }
    if (this.localRosterCrownEl) {
      const showCrown = snapshot.connection.isHost || !snapshot.connection.connected;
      this.localRosterCrownEl.style.display = showCrown ? 'inline-block' : 'none';
    }
    this.animateWaveformBars(
      this.localRosterWaveBars,
      snapshot.localVoice.voiceLevel,
      snapshot.localVoice.isSpeaking,
    );

    // Sync Remote Cards
    const activeIds = new Set(visiblePeers.map((p) => p.peerId));
    for (const [id, refs] of this.rosterPeerCards.entries()) {
      if (!activeIds.has(id)) {
        refs.cardEl.remove();
        this.rosterPeerCards.delete(id);
        this.lastPeerMutedMap.delete(id);
      }
    }

    // Detach empty placeholders temporarily so DOM order stays [Local, ...Peers, ...Placeholders]
    for (const ph of this.rosterEmptyPlaceholders) {
      ph.remove();
    }

    for (const peer of visiblePeers) {
      let refs = this.rosterPeerCards.get(peer.peerId);
      if (!refs) {
        refs = this.createRemoteRosterCard(peer);
        this.rosterPeerCards.set(peer.peerId, refs);
        this.rosterGridEl.appendChild(refs.cardEl);
      }

      if (refs.lastClass !== peer.heroClass) {
        refs.emblemEl.innerHTML = renderClassEmblemSvg(peer.heroClass);
        refs.lastClass = peer.heroClass;
      }

      refs.crownEl.style.display = peer.isHost ? 'inline-block' : 'none';
      refs.nameTextEl.textContent = peer.isSimulated ? `🤖 ${peer.nickname}` : peer.nickname;
      const clsTitle = CLASS_DISPLAY_META[peer.heroClass]?.label ?? peer.heroClass;
      refs.subInfoEl.textContent = `${clsTitle} • Lv.${peer.level}${peer.downed ? ' • 🆘 GỤC' : ''}`;

      const pingMs = Math.round(peer.pingMs);
      refs.pingEl.textContent = `${pingMs} ms`;
      refs.pingEl.classList.toggle('ping-mid', pingMs >= 65 && pingMs <= 135);
      refs.pingEl.classList.toggle('ping-high', pingMs > 135);

      const pv = snapshot.peerVoice[peer.peerId];
      const muted = Boolean(pv?.mutedByLocal);
      const speaking = Boolean(pv?.isSpeaking && !muted);
      const level = muted ? 0 : (pv?.voiceLevel ?? 0);

      this.lastPeerMutedMap.set(peer.peerId, muted);
      refs.cardEl.classList.toggle('is-speaking', speaking);
      refs.muteBtnEl.textContent = muted ? '🔇 Bật Tiếng' : '🔊 Tắt Tiếng';

      if (!refs.isDraggingVolume && pv !== undefined) {
        const volPct = Math.round(clamp(pv.volume, 0, 2) * 100);
        refs.volSliderEl.value = String(volPct);
        refs.volValueEl.textContent = `${volPct}%`;
      }

      this.animateWaveformBars(refs.waveBars, level, speaking);
    }

    const emptySlotsNeeded = Math.max(0, 3 - visiblePeers.length);
    for (let i = 0; i < emptySlotsNeeded; i++) {
      this.rosterGridEl.appendChild(this.rosterEmptyPlaceholders[i]);
    }
  }

  private animateWaveformBars(
    bars: HTMLDivElement[],
    voiceLevel: number,
    isSpeaking: boolean,
  ): void {
    const lvl = clamp(voiceLevel, 0, 1);
    for (let i = 0; i < bars.length; i++) {
      let pct = 16;
      if (isSpeaking || lvl > 0.04) {
        const wave = 0.55 + 0.45 * Math.sin(this.elapsedSec * 15 + i * 1.35);
        pct = Math.round(clamp(18 + lvl * 82 * wave, 16, 100));
      }
      bars[i].style.height = `${pct}%`;
    }
  }

  // =========================================================================
  // INTERACTION & GLOBAL INPUT HANDLERS
  // =========================================================================

  private bindLobbyTextInputGuard(
    input: HTMLInputElement,
    onInputExtra?: () => void,
    onEnterSubmit?: () => void,
  ): void {
    input.addEventListener('focus', () => {
      this.lobbyInputFocused = true;
    });
    input.addEventListener('blur', () => {
      this.lobbyInputFocused = false;
    });
    input.addEventListener('input', () => {
      onInputExtra?.();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof input.blur === 'function') input.blur();
        this.lobbyInputFocused = false;
      } else if (e.key === 'Enter' && onEnterSubmit) {
        e.preventDefault();
        onEnterSubmit();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  private bindGlobalListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;

      // Escape closes active Chat, Radial Wheel, Ping Rose, or Lobby Modal
      if (e.key === 'Escape') {
        if (this.chatFocused) {
          e.preventDefault();
          e.stopPropagation();
          this.blurChat();
          return;
        }
        if (this.wheelOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.closeRadialWheel(false);
          return;
        }
        if (this.pingRoseOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.closePingRose();
          return;
        }
        if (this.lobbyOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.closeLobby();
          return;
        }
        return;
      }

      // Enter focuses Party Chat when not typing in another field
      if (e.key === 'Enter') {
        if (this.lobbyOpen) return;
        if (!this.chatFocused) {
          e.preventDefault();
          e.stopPropagation();
          this.focusChat();
        } else {
          e.preventDefault();
          e.stopPropagation();
          this.submitChatInput();
          this.blurChat();
        }
        return;
      }

      if (this.isChatFocused()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = (e.key || '').toLowerCase();
      if (key === 'p') {
        e.preventDefault();
        this.toggleLobby();
      } else if (!this.lobbyOpen && (key === 'g' || key === 'b')) {
        e.preventDefault();
        this.openRadialWheel(key === 'g' ? 'emote' : 'emoji', key);
      } else if (!this.lobbyOpen && key === 'h') {
        e.preventDefault();
        this.callbacks?.onTriggerHighFive();
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      const key = (e.key || '').toLowerCase();
      if (this.wheelOpen && this.wheelHeldKey && key === this.wheelHeldKey) {
        this.closeRadialWheel(true);
      }
    };

    const onPointerMove = (e: PointerEvent | MouseEvent): void => {
      const cx = e.clientX ?? 0;
      const cy = e.clientY ?? 0;
      if (this.wheelOpen) {
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 720;
        const idx = computeRadialOctantIndex(cx - vw * 0.5, cy - vh * 0.5, 30);
        this.setWheelSelectedSlice(idx);
      }
      if (this.pingRoseOpen) {
        const nextType = computeCardinalPingType(cx - this.pingAnchorX, cy - this.pingAnchorY, 20);
        this.setPingRoseHighlight(nextType);
      }
    };

    const onPointerDown = (e: PointerEvent | MouseEvent): void => {
      if (this.lobbyOpen || this.isChatFocused()) return;
      if (!e.altKey || (e.button !== undefined && e.button !== 0)) return;
      e.preventDefault?.();
      this.openPingRose(e.clientX ?? 640, e.clientY ?? 360);
    };

    const onPointerUp = (e: PointerEvent | MouseEvent): void => {
      if (!this.pingRoseOpen) return;
      const cx = e.clientX ?? this.pingAnchorX;
      const cy = e.clientY ?? this.pingAnchorY;
      this.pingSelectedType = computeCardinalPingType(
        cx - this.pingAnchorX,
        cy - this.pingAnchorY,
        20,
      );
      this.lastAltPointerPingAt = Date.now();
      this.commitPingRose();
    };

    const onAltClickFallback = (e: MouseEvent): void => {
      if (this.lobbyOpen || this.isChatFocused()) return;
      if (!e.altKey) return;
      if (Date.now() - this.lastAltPointerPingAt < 250) return;
      e.preventDefault?.();
      this.spawnSonarRipple(e.clientX ?? 640, e.clientY ?? 360);
      this.callbacks?.onTriggerPing('attack');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('click', onAltClickFallback);

    this.windowCleanups.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => window.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('click', onAltClickFallback),
    );
  }

  private bindEventBus(): void {
    for (const unsub of this.busUnsubscribers) unsub();
    this.busUnsubscribers = [];

    this.busUnsubscribers.push(
      eventBus.on('mp:openLobby', () => {
        this.openLobby();
      }),
    );

    this.busUnsubscribers.push(
      eventBus.on('mp:voicePtt', ({ active }) => {
        this.pttEventActive = active;
      }),
    );
  }

  private focusChat(): void {
    if (!this.chatInputEl) return;
    this.chatFocused = true;
    this.chatBoxEl?.classList.add('is-focused');
    if (typeof this.chatInputEl.focus === 'function') {
      this.chatInputEl.focus();
    }
  }

  private blurChat(): void {
    this.chatFocused = false;
    this.chatBoxEl?.classList.remove('is-focused');
    if (this.chatInputEl && typeof this.chatInputEl.blur === 'function') {
      this.chatInputEl.blur();
    }
  }

  private submitChatInput(): void {
    if (!this.chatInputEl) return;
    const raw = this.chatInputEl.value;
    this.chatInputEl.value = '';
    const parsed = parseChatSlashCommand(raw);
    if (!parsed) return;

    if (parsed.kind === 'emote') {
      this.callbacks?.onTriggerEmote(parsed.emoteId);
    } else if (parsed.kind === 'highfive') {
      this.callbacks?.onTriggerHighFive();
    } else if (parsed.kind === 'emoji') {
      this.callbacks?.onTriggerEmoji(parsed.emojiId);
    } else {
      this.callbacks?.onSendChat(parsed.text);
    }
  }

  private openRadialWheel(mode: 'emote' | 'emoji', heldKey: 'g' | 'b'): void {
    this.wheelOpen = true;
    this.wheelHeldKey = heldKey;
    this.setWheelMode(mode);
    this.setWheelSelectedSlice(-1);
    this.wheelBackdropEl?.classList.add('is-open');
  }

  private closeRadialWheel(commitSelection: boolean): void {
    if (!this.wheelOpen) return;
    const selected = this.wheelSelectedSlice;
    const mode = this.wheelMode;
    this.wheelOpen = false;
    this.wheelHeldKey = null;
    this.wheelSelectedSlice = -1;
    this.wheelBackdropEl?.classList.remove('is-open');

    if (commitSelection && selected >= 0 && selected < 8) {
      if (mode === 'emote') {
        this.callbacks?.onTriggerEmote(RADIAL_EMOTE_SLICES[selected].emoteId);
      } else {
        this.callbacks?.onTriggerEmoji(RADIAL_EMOJI_SLICES[selected].emojiId);
      }
    }
  }

  private setWheelMode(mode: 'emote' | 'emoji'): void {
    this.wheelMode = mode;
    this.refreshWheelLabels();
  }

  private refreshWheelLabels(): void {
    if (this.wheelModeBtnEl) {
      this.wheelModeBtnEl.textContent =
        this.wheelMode === 'emote' ? '🎭 Cử Chỉ [G] ⇄ [B]' : '😀 Biểu Cảm [B] ⇄ [G]';
    }
    for (let i = 0; i < 8; i++) {
      if (!this.wheelSliceIconEls[i] || !this.wheelSliceLabelEls[i]) continue;
      if (this.wheelMode === 'emote') {
        const s = RADIAL_EMOTE_SLICES[i];
        this.wheelSliceIconEls[i].textContent = s.icon;
        this.wheelSliceLabelEls[i].textContent = s.label;
      } else {
        const s = RADIAL_EMOJI_SLICES[i];
        this.wheelSliceIconEls[i].textContent = s.icon;
        this.wheelSliceLabelEls[i].textContent = s.label;
      }
    }
  }

  private setWheelSelectedSlice(idx: number): void {
    this.wheelSelectedSlice = idx;
    for (let i = 0; i < this.wheelSliceEls.length; i++) {
      this.wheelSliceEls[i].classList.toggle('is-selected', i === idx);
    }
  }

  private openPingRose(clientX: number, clientY: number): void {
    if (!this.pingRoseEl) return;
    this.pingRoseOpen = true;
    this.pingAnchorX = clientX;
    this.pingAnchorY = clientY;
    this.pingRoseEl.style.left = `${Math.round(clientX)}px`;
    this.pingRoseEl.style.top = `${Math.round(clientY)}px`;
    this.setPingRoseHighlight('attack');
    this.pingRoseEl.classList.add('is-open');
  }

  private setPingRoseHighlight(type: TacticalPingType): void {
    this.pingSelectedType = type;
    for (const [k, btn] of this.pingRoseBtnMap.entries()) {
      btn.classList.toggle('is-selected', k === type);
    }
  }

  private commitPingRose(): void {
    const chosen = this.pingSelectedType;
    const x = this.pingAnchorX;
    const y = this.pingAnchorY;
    this.closePingRose();
    this.spawnSonarRipple(x, y);
    this.callbacks?.onTriggerPing(chosen);
  }

  private closePingRose(): void {
    this.pingRoseOpen = false;
    this.pingRoseEl?.classList.remove('is-open');
  }

  private spawnSonarRipple(x: number, y: number): void {
    if (!this.rootEl || typeof document === 'undefined') return;
    const ring = document.createElement('div');
    ring.className = 'mp-ping-sonar';
    ring.style.left = `${Math.round(x)}px`;
    ring.style.top = `${Math.round(y)}px`;
    this.rootEl.appendChild(ring);
    if (typeof setTimeout === 'function') {
      setTimeout(() => ring.remove(), 680);
    }
  }

  private selectTransportMode(mode: MultiplayerTransportMode): void {
    this.selectedMode = mode;
    for (const [m, btn] of this.transportTabBtns.entries()) {
      btn.classList.toggle('is-selected', m === mode);
    }
    this.relayRowEl?.classList.toggle('is-visible', mode === 'websocket_relay');
    eventBus.emit('sfx:request', { id: 'ui_click' });
  }

  private submitJoinRoom(): void {
    const rawCode = (this.joinCodeInputEl?.value ?? '').trim().toUpperCase();
    if (!rawCode) return;
    this.callbacks?.onJoinRoom(
      rawCode,
      this.selectedMode,
      this.getNicknameValue(),
      this.getRelayUrlValue(),
    );
  }

  private getNicknameValue(): string {
    const val = (this.nicknameInputEl?.value ?? '').trim();
    return val || 'Chiến Binh';
  }

  private getRelayUrlValue(): string | undefined {
    if (this.selectedMode !== 'websocket_relay') return undefined;
    const val = (this.relayInputEl?.value ?? '').trim();
    return val || 'ws://localhost:8787';
  }

  private prefillRoomCodeFromUrl(): void {
    if (typeof window === 'undefined' || !window.location?.search || !this.joinCodeInputEl) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room')?.trim().toUpperCase();
      if (room) {
        this.joinCodeInputEl.value = room;
      }
    } catch {
      // Ignore malformed location search in headless tests
    }
  }

  private buildInviteLink(roomCode: string): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const path = window.location.pathname || '/';
      return `${window.location.origin}${path}?room=${encodeURIComponent(roomCode)}`;
    }
    return `https://abyssal-realms.local/?room=${encodeURIComponent(roomCode)}`;
  }

  private writeClipboardSafe(text: string): void {
    try {
      const nav = (globalThis as any).navigator;
      if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
        void Promise.resolve(nav.clipboard.writeText(text)).catch(() => {});
      }
    } catch {
      // Safe no-op in non-secure / headless test contexts
    }
  }

  private teardownDomOnly(): void {
    for (const cleanup of this.windowCleanups) cleanup();
    this.windowCleanups = [];

    for (const unsub of this.busUnsubscribers) unsub();
    this.busUnsubscribers = [];

    this.partyFrameRefs.clear();
    this.rosterPeerCards.clear();
    this.lastPeerMutedMap.clear();
    this.transportTabBtns.clear();
    this.pingRoseBtnMap.clear();

    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }

    if (this.ownsStyleRef) {
      activeStyleMountCount = Math.max(0, activeStyleMountCount - 1);
      this.ownsStyleRef = false;
      if (activeStyleMountCount === 0 && typeof document !== 'undefined') {
        const styleEl = document.getElementById(MP_UI_STYLE_ELEMENT_ID);
        styleEl?.remove();
      }
    }

    this.lobbyOpen = false;
    this.chatFocused = false;
    this.lobbyInputFocused = false;
    this.wheelOpen = false;
    this.pingRoseOpen = false;
    this.container = null;
  }
}

export function createMultiplayerUI(): IMultiplayerUI {
  return new MultiplayerUI();
}
