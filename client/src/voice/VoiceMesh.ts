// WebRTC mesh voice for up to 6 players, with a proximity audio graph per peer (TECH.md "Voice").
// Signaling goes through the game server via opts.send / handleSignal; audio is peer-to-peer.

import { createFakeVoice } from './fakeVoice.ts';
import { LocalMic } from './LocalMic.ts';
import { PeerLink } from './PeerLink.ts';
import { RemoteVoice, type PeerMix } from './RemoteVoice.ts';
import { VOICE } from './tuning.ts';
import type { MicResult, PeerPose, PeerState, Vec3, VoiceOptions, VoiceSignal } from './types.ts';

interface Peer {
  link: PeerLink;
  voice: RemoteVoice | null;
  /** Restarts since this peer last connected; drives the backoff. */
  retries: number;
  startTimer: number | undefined;
  watchdog: number | undefined;
}

/** An offer from a peer setPeers doesn't list yet (the room state can lag the signaling). */
interface PendingOffer {
  sdp: string;
  ice: RTCIceCandidateInit[];
  at: number;
}

export class VoiceMesh {
  private readonly opts: VoiceOptions;
  private readonly mic: LocalMic;
  private readonly peers = new Map<string, Peer>();
  private desired = new Set<string>();
  private readonly mixes = new Map<string, PeerMix>();
  private readonly pending = new Map<string, PendingOffer>();
  private readonly speakingListeners = new Set<(speaking: boolean) => void>();
  private mode: 'ptt' | 'open' = 'ptt';
  private talking = false;
  private wasSpeaking = false;
  private state: MicResult | 'off' = 'off';
  private micRequest: Promise<MicResult> | null = null;
  private lastTick = performance.now();
  private readonly meterTimer: number;
  private disposed = false;

  constructor(opts: VoiceOptions) {
    this.opts = opts;
    this.mic = new LocalMic(opts.context, () => {
      this.state = 'unavailable';
      this.onMicChanged();
    });
    this.meterTimer = window.setInterval(this.tick, VOICE.meterIntervalMs);
  }

  // --- Local mic ------------------------------------------------------------------------------

  /** Asks for the mic (echoCancellation/noiseSuppression/autoGainControl on). Never throws. */
  enableMic(): Promise<MicResult> {
    if (this.disposed) return Promise.resolve('unavailable');
    this.micRequest ??= this.requestMic().finally(() => {
      this.micRequest = null;
    });
    return this.micRequest;
  }

  /** Dev/testing: a synthetic voice instead of a real mic. */
  useFakeMic(): void {
    if (this.disposed) return;
    const fake = createFakeVoice(this.opts.context);
    if (!this.mic.use(fake.stream, fake.stop)) return;
    this.state = 'ok';
    this.onMicChanged();
  }

  /** The browser-processed local mic stream (for on-device keyword spotting), or null. Not gated by push-to-talk. */
  get micStream(): MediaStream | null {
    return this.mic.stream;
  }

  get micState(): MicResult | 'off' {
    return this.state;
  }

  /** Push-to-talk (default) vs open mic. With PTT, the mic track is only enabled while talking(true). */
  setMode(mode: 'ptt' | 'open'): void {
    this.mode = mode;
    this.applyTransmit();
  }

  setTalking(down: boolean): void {
    this.talking = down;
    this.applyTransmit();
  }

  /** Whether peers are hearing us right now (mic on, and open mode or PTT held). */
  get transmitting(): boolean {
    return this.mic.on && (this.mode === 'open' || this.talking);
  }

  /** Voice activity on the local mic; in PTT it only counts while talking. */
  get speaking(): boolean {
    return this.transmitting && this.mic.vadActive;
  }

  onSpeakingChange(cb: (speaking: boolean) => void): () => void {
    this.speakingListeners.add(cb);
    return () => this.speakingListeners.delete(cb);
  }

  /** 0..1, what peers hear from us (0 while PTT is up). */
  localLevel(): number {
    return this.transmitting ? this.mic.level : 0;
  }

  /** 0..1, the raw mic level even when not transmitting (mic test / permission screen). */
  micLevel(): number {
    return this.mic.level;
  }

  // --- Peers ----------------------------------------------------------------------------------

  /** Peers currently in the room (self is ignored). Opens links to new ones, closes removed ones. */
  setPeers(ids: string[]): void {
    if (this.disposed) return;
    const next = new Set(ids.filter((id) => id !== this.opts.selfId));
    for (const id of [...this.peers.keys()]) if (!next.has(id)) this.dropPeer(id, true);
    this.desired = next;
    for (const id of next) if (!this.peers.has(id)) this.addPeer(id, 0);
    this.prunePending(performance.now());
  }

  handleSignal(from: string, signal: VoiceSignal): void {
    if (this.disposed || from === this.opts.selfId) return;
    const peer = this.peers.get(from);
    if (!peer) {
      this.stash(from, signal);
      return;
    }
    if (signal.kind === 'bye') {
      // They hung up: left, restarted, or their room list lost us. Start clean either way, so
      // their next offer (or ours, after a backoff) lands on a fresh connection.
      const retries = peer.retries;
      this.dropPeer(from, false);
      this.addPeer(from, peer.link.isOfferer ? retries + 1 : 0);
      return;
    }
    if (signal.kind === 'offer' && peer.link.gotOffer) {
      // A second offer means the offerer started over without our seeing its bye.
      this.dropPeer(from, false);
      this.addPeer(from, 0).link.handle(signal);
      return;
    }
    peer.link.handle(signal);
  }

  /** Called every frame for each peer: head position and room-graph muffling. */
  updatePeer(id: string, p: PeerPose): void {
    const [x, y, z] = p.position;
    if (![x, y, z, p.cutoffHz, p.gain].every(Number.isFinite)) return;
    const mix = this.mixFor(id);
    mix.x = x;
    mix.y = y;
    mix.z = z;
    mix.cutoffHz = p.cutoffHz;
    mix.roomGain = p.gain;
    this.peers.get(id)?.voice?.apply(mix);
  }

  setListener(position: Vec3, forward: Vec3): void {
    const [px, py, pz] = position;
    const len = Math.hypot(forward[0], forward[1], forward[2]);
    if (!(len > 1e-6) || ![px, py, pz].every(Number.isFinite)) return;
    const fx = forward[0] / len;
    const fy = forward[1] / len;
    const fz = forward[2] / len;
    // Up = world up minus its forward part, so looking up or down keeps a valid basis.
    let ux = -fy * fx;
    let uy = 1 - fy * fy;
    let uz = -fy * fz;
    const ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-3) [ux, uy, uz] = [0, 0, fy > 0 ? 1 : -1];
    else [ux, uy, uz] = [ux / ul, uy / ul, uz / ul];

    const l = this.opts.context.listener;
    // Firefox has no AudioParams on the listener yet, only the deprecated setters.
    if ((l.positionX as AudioParam | undefined) === undefined) {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
      return;
    }
    l.positionX.value = px;
    l.positionY.value = py;
    l.positionZ.value = pz;
    l.forwardX.value = fx;
    l.forwardY.value = fy;
    l.forwardZ.value = fz;
    l.upX.value = ux;
    l.upY.value = uy;
    l.upZ.value = uz;
  }

  /** 1 = as received, up to VOICE.maxPeerVolume. Survives reconnects. */
  setPeerVolume(id: string, v: number): void {
    const mix = this.mixFor(id);
    mix.volume = Number.isFinite(v) ? Math.min(VOICE.maxPeerVolume, Math.max(0, v)) : 1;
    this.peers.get(id)?.voice?.apply(mix);
  }

  setPeerMuted(id: string, muted: boolean): void {
    const mix = this.mixFor(id);
    mix.muted = muted;
    this.peers.get(id)?.voice?.apply(mix);
  }

  /** 0..1, how loud they're talking (before distance, muffling, volume and mute). */
  peerLevel(id: string): number {
    return this.peers.get(id)?.voice?.meter.level ?? 0;
  }

  /** Connection state per peer for the debug overlay. */
  peerStates(): Record<string, PeerState> {
    const out: Record<string, PeerState> = {};
    for (const id of this.desired) out[id] = this.peers.get(id)?.link.state ?? 'new';
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.meterTimer);
    for (const id of [...this.peers.keys()]) this.dropPeer(id, true);
    this.desired.clear();
    this.pending.clear();
    this.mic.release();
    this.state = 'off';
    this.updateSpeaking();
    this.speakingListeners.clear();
  }

  // --- Internals ------------------------------------------------------------------------------

  private async requestMic(): Promise<MicResult> {
    const result = await getMic();
    if (typeof result === 'string') {
      // A failed request keeps a mic that already works (e.g. the fake one).
      if (!this.mic.on) this.state = result;
      return result;
    }
    if (this.disposed || !this.mic.use(result)) {
      for (const t of result.getTracks()) t.stop();
      return 'unavailable';
    }
    this.state = 'ok';
    this.onMicChanged();
    return 'ok';
  }

  private onMicChanged(): void {
    for (const peer of this.peers.values()) peer.link.setTrack(this.mic.sendTrack);
    this.applyTransmit();
  }

  private applyTransmit(): void {
    this.mic.setTransmitting(this.transmitting);
    this.updateSpeaking();
  }

  private updateSpeaking(): void {
    const now = this.speaking;
    if (now === this.wasSpeaking) return;
    this.wasSpeaking = now;
    for (const cb of this.speakingListeners) cb(now);
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dtMs = Math.min(1000, now - this.lastTick);
    this.lastTick = now;
    this.mic.sample(dtMs);
    for (const peer of this.peers.values()) peer.voice?.meter.sample(dtMs / 1000);
    this.updateSpeaking();
    if (this.pending.size > 0) this.prunePending(now);
  };

  private mixFor(id: string): PeerMix {
    let mix = this.mixes.get(id);
    if (!mix) {
      mix = { x: 0, y: 0, z: 0, cutoffHz: VOICE.cutoffMaxHz, roomGain: 1, volume: 1, muted: false };
      this.mixes.set(id, mix);
    }
    return mix;
  }

  private addPeer(id: string, retries: number): Peer {
    const isOfferer = this.opts.selfId < id;
    const link: PeerLink = new PeerLink(id, isOfferer, this.opts.iceServers, this.mic.sendTrack, {
      send: (signal) => this.opts.send(id, signal),
      onTrack: (track) => this.attachVoice(id, link, track),
      onState: (state) => this.onLinkState(id, link, state),
    });
    const peer: Peer = { link, voice: null, retries, startTimer: undefined, watchdog: undefined };
    this.peers.set(id, peer);

    if (isOfferer) {
      const delay =
        retries === 0 ? 0 : Math.min(VOICE.retryMaxMs, VOICE.retryBaseMs * 2 ** (retries - 1));
      if (delay === 0) link.start();
      else peer.startTimer = window.setTimeout(() => link.start(), delay);
      this.armWatchdog(id, peer, delay + VOICE.connectTimeoutMs);
    } else {
      const stashed = this.pending.get(id);
      if (stashed) {
        this.pending.delete(id);
        link.handle({ kind: 'offer', sdp: stashed.sdp });
        for (const candidate of stashed.ice) link.handle({ kind: 'ice', candidate });
      }
    }
    return peer;
  }

  private dropPeer(id: string, sayBye: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    window.clearTimeout(peer.startTimer);
    window.clearTimeout(peer.watchdog);
    peer.link.close(sayBye);
    peer.voice?.dispose();
    this.peers.delete(id);
  }

  /** Offerer only: tear down and dial again after a backoff. */
  private restart(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.dropPeer(id, true);
    if (this.desired.has(id)) this.addPeer(id, peer.retries + 1);
  }

  private armWatchdog(id: string, peer: Peer, ms: number): void {
    window.clearTimeout(peer.watchdog);
    peer.watchdog = window.setTimeout(() => {
      if (this.peers.get(id) === peer && peer.link.state !== 'connected') this.restart(id);
    }, ms);
  }

  private onLinkState(id: string, link: PeerLink, state: RTCPeerConnectionState): void {
    const peer = this.peers.get(id);
    if (!peer || peer.link !== link) return;
    if (state === 'connected') {
      peer.retries = 0;
      window.clearTimeout(peer.watchdog);
      peer.watchdog = undefined;
      return;
    }
    if (!link.isOfferer) return; // the offerer drives recovery
    if (state === 'failed') this.restart(id);
    else if (state === 'disconnected') this.armWatchdog(id, peer, VOICE.disconnectGraceMs);
  }

  private attachVoice(id: string, link: PeerLink, track: MediaStreamTrack): void {
    const peer = this.peers.get(id);
    if (!peer || peer.link !== link) return;
    peer.voice?.dispose();
    peer.voice = new RemoteVoice(this.opts.context, track, this.opts.output);
    peer.voice.apply(this.mixFor(id));
  }

  private stash(from: string, signal: VoiceSignal): void {
    switch (signal.kind) {
      case 'offer':
        if (this.opts.selfId > from) {
          this.pending.set(from, { sdp: signal.sdp, ice: [], at: performance.now() });
        }
        return;
      case 'ice': {
        const p = this.pending.get(from);
        if (p && p.ice.length < VOICE.pendingIceMax) p.ice.push(signal.candidate);
        return;
      }
      case 'bye':
        this.pending.delete(from);
        return;
      case 'answer':
        return;
    }
  }

  private prunePending(now: number): void {
    for (const [id, p] of this.pending) {
      if (now - p.at > VOICE.pendingOfferTtlMs) this.pending.delete(id);
    }
  }
}

async function getMic(): Promise<MediaStream | MicResult> {
  if (!window.isSecureContext) return 'insecure';
  // why: older or locked-down browsers leave mediaDevices undefined despite the DOM typings.
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (typeof devices?.getUserMedia !== 'function') return 'unavailable';
  try {
    return await devices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    // SecurityError = blocked by permissions policy, which the player experiences as "denied".
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    return 'unavailable';
  }
}
