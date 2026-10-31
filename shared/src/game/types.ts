// The game around the dinner rules: hosts walking around the house, physical props, the kitchen,
// the lobby and results. `DinnerGame` runs it on the server (and in the browser for solo play).
// Clients send Commands and render a GameView; the view mirrors the server's Colyseus schema
// field for field, so solo and online play render the same thing.

import type { HouseSetting } from '../content/houses.ts';
import type { Hair, HatId } from '../content/guests.ts';
import type { Award, Incident, Phase, SimEvent } from '../sim/types.ts';

export type GamePhase = 'lobby' | 'dinner' | 'results';
export type PartySize = 'cozy' | 'dinner' | 'banquet' | 'surprise';

export const PARTY_GUESTS: Record<Exclude<PartySize, 'surprise'>, number> = { cozy: 3, dinner: 5, banquet: 7 };

/** What a player can aim at and act on. */
export type Target =
  | { kind: 'guest'; id: number }
  | { kind: 'thing'; id: string }
  | { kind: 'prop'; id: number }
  | { kind: 'seat'; seat: number }
  | { kind: 'neighbor' }
  | { kind: 'visitor' };

export interface HostLook {
  apron: string;
  hat: HatId;
  skin: string;
  hair: Hair;
  hairColor: string;
}

export type Command =
  | { c: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean }
  | { c: 'ready'; ready: boolean }
  | { c: 'look'; look: Partial<HostLook> }
  | { c: 'settings'; size?: PartySize; seed?: string; relaxed?: boolean; tutorial?: boolean; house?: HouseSetting }
  | { c: 'start' }
  | { c: 'back' }
  | { c: 'interact'; target: Target }
  | { c: 'take'; from: 'fridge' | 'cellar' | 'plates'; dish: string }
  | { c: 'drop' }
  | { c: 'throw'; power: number }
  | { c: 'holdUp' }
  | { c: 'smallTalk'; guest: number; card: number }
  | { c: 'answer'; choice: number }
  | { c: 'say'; text: string }
  | { c: 'heard'; word: string }
  | { c: 'reseat'; guest: number; seat: number }
  | { c: 'speaking'; on: boolean }
  | { c: 'skip' }
  | { c: 'note'; guest: number; label: string };

// ---------------------------------------------------------------------------------------------
// The view (no nulls: "none" is '' or -1, so it maps onto a Colyseus schema)

export interface PlayerView {
  id: string;
  name: string;
  look: HostLook;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  /** Prop id in hand, or -1. */
  held: number;
  ready: boolean;
  connected: boolean;
  speaking: boolean;
  caught: boolean;
  escaped: boolean;
  /** Seconds left as a statue (gorgon). */
  stone: number;
  /** A fae took their name. */
  nameTaken: boolean;
}

export type PropKind =
  | 'food'
  | 'plate'
  | 'bottle'
  | 'painting'
  | 'candelabra'
  | 'snow_globe'
  | 'photo_frame'
  | 'record'
  | 'pot'
  | 'pan'
  | 'tea_towel'
  | 'dog'
  | 'part';

export interface PropView {
  id: number;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Player holding it, or ''. */
  holder: string;
  /** Interactable it sits on (a station), `guest:<id>` once served, or ''. */
  at: string;
  /** Food: the dish, how many recipe steps are done, progress of the current one (0..1). */
  dish: string;
  stage: number;
  progress: number;
  burnt: boolean;
  plated: boolean;
  fire: boolean;
}

export interface DoorView {
  id: string;
  open: boolean;
}

export interface GuestLookView {
  outfit: string;
  color: string;
  hair: string;
  hairColor: string;
  skin: string;
  accessory: string;
  body: string;
}

export interface GuestView {
  id: number;
  name: string;
  look: GuestLookView;
  where: string;
  seat: number;
  x: number;
  z: number;
  yaw: number;
  composure: number;
  hunger: number;
  /** Monster type once the players have seen a slip, else ''. */
  revealed: string;
  /** The monster showing through right now (slipping or chasing), else ''. What anyone looking can see. */
  form: string;
  slipping: boolean;
  eating: boolean;
  /** Guest id they're eyeing hungrily, or -1. */
  eyeing: number;
  suspicious: boolean;
  /** Waiting on the doorstep for an invite (vampires). */
  waitingInvite: boolean;
  chasing: boolean;
}

export interface TopicView {
  id: string;
  label: string;
  tags: string[];
  /** Guest holding it, or -1 for no topic. */
  holder: number;
  /** The guest it passes to next beat (the preview arc), or -1. */
  next: number;
}

export interface HandView {
  player: string;
  /** Topic ids; '' while a card refills. */
  cards: string[];
  cooldowns: number[];
}

export interface OptionView {
  kind: string;
  text: string;
  rule: string;
}

export interface QuestionView {
  /** Guest asking, or -1 for no question. */
  asker: number;
  target: string;
  text: string;
  options: OptionView[];
  timer: number;
  total: number;
}

export interface RoomView {
  curtainsOpen: boolean;
  mirrorCovered: boolean;
  lightsOn: boolean;
  musicOn: boolean;
  moonUp: boolean;
  neighborPresent: boolean;
  alarm: boolean;
  powerOn: boolean;
  storm: boolean;
  spill: boolean;
  dogLoose: boolean;
}

export interface ObjectiveView {
  label: string;
  /** '' when tonight's occasion has no objective. */
  status: string;
  progress: number;
  goal: number;
}

export interface ToastView {
  /** '' when nobody is giving a toast. */
  player: string;
  guest: number;
  timer: number;
  spoken: number;
  need: number;
}

export interface FavorView {
  player: string;
  guest: number;
  label: string;
  beats: number;
}

export interface VisitorView {
  /** '' (nobody), 'pizza' or 'hunter'. */
  kind: string;
  where: string;
  suspicion: number;
}

export interface CharadesView {
  /** Guest acting, or -1. */
  actor: number;
  guess: number;
}

export interface CourseMenuView {
  dishes: string[];
}

export interface AwardView {
  player: string;
  title: string;
  why: string;
}

export interface IncidentView {
  t: number;
  kind: string;
  text: string;
  guest: number;
}

export interface ResultView {
  /** '' while the dinner is still going. */
  outcome: string;
  tips: number;
  stars: number;
  review: string;
  awards: AwardView[];
  incidents: IncidentView[];
}

export interface DinnerView {
  /** False in the lobby before the first dinner. */
  active: boolean;
  seed: string;
  phase: Phase | 'none';
  course: number;
  courses: number;
  phaseTime: number;
  beatTimer: number;
  beatSeconds: number;
  cover: number;
  strikes: number;
  maxStrikes: number;
  guests: GuestView[];
  topic: TopicView;
  hands: HandView[];
  question: QuestionView;
  room: RoomView;
  ledger: string[];
  menu: CourseMenuView[];
  result: ResultView;
  occasion: string;
  occasionLabel: string;
  objective: ObjectiveView;
  book: string[];
  /** Guest of honor, or -1. */
  honoree: number;
  toast: ToastView;
  favors: FavorView[];
  visitor: VisitorView;
  charades: CharadesView;
}

export interface NoteView {
  guest: number;
  label: string;
  by: string;
}

export interface GameView {
  phase: GamePhase;
  /** The player who picks party size and starts the dinner. */
  roomHost: string;
  size: PartySize;
  seed: string;
  relaxed: boolean;
  /** In the lobby: the next dinner is the First Shift tutorial. At dinner: this one is. */
  tutorial: boolean;
  /** The lobby's house setting: a house id, or 'surprise' (the dinner seed picks). */
  house: string;
  /** The house everyone is in right now (its .glb and .layout.json name). */
  asset: string;
  /** Seconds left on the results screen before everyone is back at the van. */
  resultsTime: number;
  players: PlayerView[];
  props: PropView[];
  doors: DoorView[];
  notes: NoteView[];
  dinner: DinnerView;
}

/** Things that happen, for logs, toasts, tells and sounds. Sim events plus the game's own. */
export type GameEvent =
  | SimEvent
  | { t: 'chat'; by: string; name: string; text: string; x: number; y: number; z: number }
  | { t: 'sfx'; name: string; x: number; y: number; z: number }
  | { t: 'joined'; player: string; name: string }
  | { t: 'left'; player: string; name: string }
  | { t: 'cooked'; prop: number; dish: string; stage: number }
  | { t: 'burnt'; prop: number; dish: string }
  | { t: 'fire'; at: string; on: boolean }
  | { t: 'plated'; prop: number; dish: string; by: string }
  | { t: 'lobby' }
  | { t: 'dinnerStarted'; seed: string };

export type { Award, Incident };
