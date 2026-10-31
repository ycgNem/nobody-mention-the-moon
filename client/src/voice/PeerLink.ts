// One RTCPeerConnection to one peer, carrying a single sendrecv audio transceiver.
//
// The lexicographically smaller id offers, so there's never glare. The transceiver is sendrecv
// from the first offer even with no mic yet, so a mic that shows up later is just replaceTrack():
// no renegotiation, ever. A link is single-use: on 'bye' or failure the mesh builds a new one.

import type { PeerState, VoiceSignal } from './types.ts';

export interface PeerLinkHooks {
  send(signal: VoiceSignal): void;
  onTrack(track: MediaStreamTrack): void;
  onState(state: RTCPeerConnectionState): void;
}

export class PeerLink {
  /** True once an offer has been handled; a second one means the offerer started over. */
  gotOffer = false;
  private readonly pc: RTCPeerConnection;
  private transceiver: RTCRtpTransceiver | null = null;
  /** Remote candidates that arrived before the remote description. */
  private readonly pendingIce: RTCIceCandidateInit[] = [];
  /** Local candidates held until our description has gone out; null after that. */
  private outbox: RTCIceCandidateInit[] | null = [];
  /** Signaling steps run one at a time, in arrival order. */
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    readonly peerId: string,
    readonly isOfferer: boolean,
    iceServers: RTCIceServer[],
    private track: MediaStreamTrack | null,
    private readonly hooks: PeerLinkHooks,
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = e.candidate.toJSON();
      if (this.outbox) this.outbox.push(c);
      else this.hooks.send({ kind: 'ice', candidate: c });
    };
    this.pc.ontrack = (e) => {
      if (e.track.kind === 'audio') this.hooks.onTrack(e.track);
    };
    this.pc.onconnectionstatechange = () => this.hooks.onState(this.pc.connectionState);
  }

  get state(): PeerState {
    return this.pc.connectionState;
  }

  /** Offerer only: sends the offer. */
  start(): void {
    if (!this.isOfferer) return;
    this.enqueue(async () => {
      this.transceiver = this.pc.addTransceiver(this.track ?? 'audio', { direction: 'sendrecv' });
      await this.pc.setLocalDescription(await this.pc.createOffer());
      this.sendDescription('offer');
    });
  }

  handle(signal: VoiceSignal): void {
    switch (signal.kind) {
      case 'offer':
        if (this.isOfferer) {
          console.warn(`[voice] ignoring offer from ${this.peerId}: we are the offerer`);
          return;
        }
        this.gotOffer = true;
        this.enqueue(() => this.answer(signal.sdp));
        return;
      case 'answer':
        this.enqueue(async () => {
          if (this.pc.signalingState !== 'have-local-offer') return; // stale
          await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
          await this.flushIce();
        });
        return;
      case 'ice':
        this.enqueue(() => this.addIce(signal.candidate));
        return;
      case 'bye':
        return; // the mesh handles hang-ups
    }
  }

  /** Swaps what we send (null = nothing). Never renegotiates. */
  setTrack(track: MediaStreamTrack | null): void {
    this.track = track;
    this.enqueue(async () => {
      if (this.transceiver) await this.transceiver.sender.replaceTrack(this.track);
    });
  }

  close(sayBye: boolean): void {
    if (this.closed) return;
    this.closed = true;
    if (sayBye) this.hooks.send({ kind: 'bye' });
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }

  private async answer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushIce();
    const t = this.pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
    if (t) {
      // The offer's transceiver arrives recvonly on our side; make it two-way before answering.
      t.direction = 'sendrecv';
      this.transceiver = t;
      if (this.track) await t.sender.replaceTrack(this.track);
    }
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    this.sendDescription('answer');
  }

  private sendDescription(kind: 'offer' | 'answer'): void {
    const sdp = this.pc.localDescription?.sdp;
    if (!sdp) return;
    this.hooks.send({ kind, sdp });
    const held = this.outbox ?? [];
    this.outbox = null;
    for (const candidate of held) this.hooks.send({ kind: 'ice', candidate });
  }

  private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      // Candidates from a session we already replaced fail harmlessly.
      console.debug(`[voice] dropped ICE candidate from ${this.peerId}`, err);
    }
  }

  private async flushIce(): Promise<void> {
    const queued = this.pendingIce.splice(0);
    for (const c of queued) await this.addIce(c);
  }

  private enqueue(step: () => Promise<void>): void {
    this.chain = this.chain
      .then(async () => {
        if (!this.closed) await step();
      })
      .catch((err: unknown) => {
        if (!this.closed) console.warn(`[voice] signaling with ${this.peerId} failed`, err);
      });
  }
}
