// Public types for the voice mesh, plus a guard for signals relayed by the game server.

export type Vec3 = [number, number, number];

/** One WebRTC signaling message. The game server relays these between two clients as-is. */
export type VoiceSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'bye' };

export interface VoiceOptions {
  selfId: string;
  /** Sends a signal to one peer through the game server (which relays it as-is). */
  send(to: string, signal: VoiceSignal): void;
  iceServers: RTCIceServer[];
  /** Shared AudioContext + the node remote voices should end in (the game's voice volume bus). */
  context: AudioContext;
  output: AudioNode;
}

export type MicResult = 'ok' | 'denied' | 'unavailable' | 'insecure';

/** A peer's head position and how the house muffles them (from the room graph). */
export interface PeerPose {
  position: Vec3;
  /** Low-pass cutoff, ≈400 (through a shut door) to 20000 (same room). */
  cutoffHz: number;
  /** 0..1 */
  gain: number;
}

export type PeerState = RTCPeerConnectionState | 'new';

/** Checks a relayed message before it reaches VoiceMesh.handleSignal. */
export function isVoiceSignal(value: unknown): value is VoiceSignal {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'offer':
    case 'answer':
      return typeof v.sdp === 'string';
    case 'ice':
      return typeof v.candidate === 'object' && v.candidate !== null;
    case 'bye':
      return true;
    default:
      return false;
  }
}
