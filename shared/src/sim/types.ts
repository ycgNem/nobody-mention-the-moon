import type { DishTag } from '../content/dishes.ts';
import type { EventId } from '../content/events.ts';
import type { GuestTypeId, Look } from '../content/guests.ts';
import type { ObjectiveId, OccasionId } from '../content/occasions.ts';
import type { RuleCheck } from '../content/questions.ts';
import type { QuirkId } from '../content/quirks.ts';
import type { RelationshipId } from '../content/relationships.ts';
import type { PropTopicId, TopicTag } from '../content/topics.ts';
import type { SimTuning } from '../tuning.ts';

/** booking → prep → arrivals → course ×N → dessert → ended. Cover at 0 → chase → ended. */
export type Phase = 'booking' | 'prep' | 'arrivals' | 'course' | 'dessert' | 'chase' | 'ended';

/** Where a guest is in the evening. */
export type GuestWhere =
  | 'outside' // not here yet
  | 'door' // rang the bell, waiting on the doorstep
  | 'entering' // walking from the door to the dining room
  | 'standing' // in the dining room, waiting to be shown a seat
  | 'seated'
  | 'gone'; // eaten, or left after dessert

export interface GuestState {
  id: number;
  type: GuestTypeId;
  name: string;
  look: Look;
  /** Index into the seat ring (0..seatCount-1, clockwise). -1 until seated. */
  seat: number;
  where: GuestWhere;
  /** Dinner time (seconds since booking) when they ring the bell. */
  arriveAt: number;
  /** Seconds spent in the current `where` (doorstep wait, walk progress, standing wait). */
  whereTime: number;
  /** Standing spot in the dining room while waiting for a seat. */
  standSpot: number;
  /** A host greeted them at the door (vampires still need an invite). */
  greeted: boolean;
  invited: boolean;

  composure: number;
  hunger: number;
  eaten: boolean;
  /** The players have seen this guest slip, so the HUD may show what they are. */
  revealed: boolean;
  /** > 0 while slipping. */
  slipTimer: number;
  eatingBeats: number;
  addressedBeats: number;
  eyeing: number | null;
  eyeingBeats: number;
  suspicious: boolean;
  moonBeats: number;
  /** Secondary quirks rolled for tonight. */
  quirks: QuirkId[];
  /** Topics and Small Talk they've received (the shapeshifter copies whoever has most). */
  attention: number;
  /** Shapeshifter: the guest they're currently copying (looks, name and triggers), or null. */
  copying: number | null;
  /** Gorgon: seconds left with the sunglasses off (staring people to stone). */
  glassesOff: number;
  /** Zombie: body parts currently off. */
  partsOff: number;
  /** Beats left of being sore about a seat change (possessive / mushrooms / creaky quirks). */
  sore: number;
  /** Beats left locked counting spilled drops (no topics). */
  counting: number;
  /** Wedding: which family (0 or 1), or -1. */
  family: number;
  /** Late Guest: dinner time when they ring the bell during the courses, or -1. */
  lateAt: number;
}

export interface TopicState {
  id: string;
  label: string;
  tags: TopicTag[];
  holder: number;
  previous: number | null;
  age: number;
  life: number;
}

export type AnswerOption =
  | { kind: 'lie'; rule: string; text: string }
  | { kind: 'truth'; text: string }
  | { kind: 'deflect'; text: string };

export interface QuestionState {
  id: string;
  text: string;
  asker: number;
  /** The player being asked; only they can answer. */
  target: string;
  options: AnswerOption[];
  timer: number;
  total: number;
}

export interface RoomState {
  curtainsOpen: boolean;
  mirrorCovered: boolean;
  lightsOn: boolean;
  musicOn: boolean;
  moonUp: boolean;
  neighborPresent: boolean;
  neighborTimer: number;
  /** Something in the kitchen is on fire and the smoke alarm is going. */
  alarm: boolean;
  /** False during a Power Cut, until someone resets the fuse box. */
  powerOn: boolean;
  /** Seconds of thunderstorm left (0: no storm). */
  storm: number;
  /** Red wine on the tablecloth. */
  spill: boolean;
  /** The dog is out of the garage. */
  dogLoose: boolean;
}

export type ScheduledKind = EventId;

export interface ScheduledEvent {
  kind: ScheduledKind;
  /** Seconds after the first course starts. */
  at: number;
  fired: boolean;
}

/** A guest called "Speech!" at a host: talk for a while without a trigger word (GDD §7.7). */
export interface ToastState {
  player: string;
  guest: number;
  /** Seconds left to give the speech. */
  timer: number;
  /** Seconds of speech so far (voice activity, or typed words). */
  spoken: number;
  /** Seconds of speech needed. */
  need: number;
  /** A trigger word slipped out mid-speech. */
  spoiled: boolean;
  /** Wedding: which family it's for, or -1. */
  family: number;
}

/** Fae debt: the player thanked them and now owes a Favor. */
export interface FavorState {
  player: string;
  guest: number;
  /** A dish id to serve them, or a prop to show them ('prop:<id>'). */
  want: string;
  beats: number;
}

/** Someone at the door or in the house who isn't a guest (GUESTS.md "Special visitors"). */
export interface VisitorState {
  kind: 'pizza' | 'hunter';
  where: 'door' | 'inside';
  /** Seconds left before they act (pizza: wander in). */
  timer: number;
  /** Hunter: how much he's noticed (100 = he knows). */
  suspicion: number;
  /** Hunter: beats until his next "trick". */
  trickIn: number;
}

/** Charades: guests take turns acting out… what they really are. */
export interface PartyGameState {
  actor: number;
  /** 0..100: how close the table is to guessing the actor. */
  guess: number;
  turns: number;
}

export interface ObjectiveState {
  id: ObjectiveId;
  label: string;
  status: 'pending' | 'done' | 'failed';
  progress: number;
  goal: number;
  tips: number;
}

export interface RelationshipState {
  kind: RelationshipId;
  a: number;
  b: number;
}

/** Per-player tallies, for awards on the results screen. */
export interface PlayerStats {
  lies: number;
  plated: number;
  served: number;
  wordsLanded: number;
  smallTalk: number;
  reseats: number;
  curtains: number;
  coveredSlips: number;
  rulesBroken: number;
  greeted: number;
  propsShown: number;
  toasts: number;
  favors: number;
  chores: number;
}

export interface SimPlayer {
  id: string;
  name: string;
  /** Small Talk hand: topic ids, null while a slot refills. */
  hand: (string | null)[];
  handCooldown: number[];
  stats: PlayerStats;
  /** Chase: dragged back to the table / made it to the van. */
  caught: boolean;
  escaped: boolean;
  caughtAt: number | null;
  /** Seconds left as a statue (a gorgon looked at you). */
  stone: number;
  /** A fae took your name: guests call you "you there" and you can't lie to them. */
  nameTaken: boolean;
}

export interface DinnerStats {
  triggers: number;
  wordsHeard: number;
  slips: number;
  slipsHidden: number;
  rulesAdded: number;
  rulesBroken: number;
  contradictions: number;
  servings: number;
  reseats: number;
  smallTalk: number;
  questionsAnswered: number;
}

export interface Award {
  player: string;
  id: string;
  title: string;
  why: string;
}

export interface Incident {
  /** Dinner time. */
  t: number;
  kind: 'slip' | 'strike' | 'eaten' | 'contradiction' | 'moonrise' | 'neighbor' | 'chase' | 'event' | 'stone' | 'toast' | 'objective';
  text: string;
  guest: number | null;
  /** 0..10: the reel picks the biggest. */
  drama: number;
}

export interface DinnerResult {
  outcome: 'survived' | 'strikes' | 'exposed';
  tips: number;
  stars: number;
  review: string;
  awards: Award[];
  incidents: Incident[];
}

export interface DinnerState {
  seed: string;
  rngState: number;
  tuning: SimTuning;
  seatCount: number;
  /** Stand spots in the dining room for guests waiting to be seated. */
  standCount: number;

  /** Seconds since the dinner was created. */
  time: number;
  phase: Phase;
  /** 0-based course index. */
  course: number;
  /** Seconds left in the current phase. */
  phaseTime: number;
  /** When the first course started (time), or null before. */
  dinnerStart: number | null;
  beat: number;
  beatTimer: number;

  guests: GuestState[];
  players: SimPlayer[];
  topic: TopicState | null;
  nextStarter: number | null;
  propsUsed: string[];

  /** Dish ids on the Booking Card, per course. */
  menu: string[][];

  cover: number;
  strikes: number;
  room: RoomState;
  /** Rule ids in the order they were added. */
  ledger: string[];

  question: QuestionState | null;
  questionInBeats: number;
  recentQuestions: string[];

  schedule: ScheduledEvent[];
  occasion: OccasionId;
  objective: ObjectiveState | null;
  /** Book Club: the book's topic tags. */
  book: TopicTag[];
  /** Birthday / Surprise Party: the guest of honor, or null. */
  honoree: number | null;
  relationships: RelationshipState[];
  toast: ToastState | null;
  favors: FavorState[];
  visitor: VisitorState | null;
  partyGame: PartyGameState | null;
  stats: DinnerStats;
  incidents: Incident[];
  /** Tips banked when the chase started (escapees keep them). */
  chaseTips: number;
  result: DinnerResult | null;
}

/** What the sim asks the outside world: the house, bodies and line of sight. */
export interface SimWorld {
  /** Can guest `guestId` hear player `playerId` talking right now? */
  canHear(guestId: number, playerId: string): boolean;
  /** Can `viewer` (a guest, or Gary from next door) see guest `guestId`? Walls and bodies block. */
  sees(viewer: number | 'neighbor', guestId: number): boolean;
  /** Can any guest at the table see player `playerId` right now? */
  seenBy(playerId: string): boolean;
  /** The player standing between guest `guestId` and the table, if any (credit for a cover-up). */
  blocker(guestId: number): string | null;
  /** Is player `playerId` talking right now (voice activity)? */
  speaking(playerId: string): boolean;
  /** Players guest `guestId` is looking at (in front of them, in line of sight). */
  gazeAt(guestId: number): string[];
  /** Is the loose dog in the dining room? */
  dogAtTable(): boolean;
  /** Fallen-off body parts lying where the table can see them. */
  partsInView(): number;
}

export const OPEN_WORLD: SimWorld = {
  canHear: () => true,
  sees: () => true,
  seenBy: () => true,
  blocker: () => null,
  speaking: () => false,
  gazeAt: () => [],
  dogAtTable: () => false,
  partsInView: () => 0,
};

export type ToggleTarget = 'curtains' | 'mirror' | 'lights' | 'music';

export type Action =
  | { type: 'skip'; by: string }
  | { type: 'greet'; by: string; guest: number }
  | { type: 'invite'; by: string; guest: number }
  | { type: 'smallTalk'; by: string; guest: number; card: number }
  | { type: 'serve'; by: string; guest: number; dish: string; burnt?: boolean }
  | { type: 'toggle'; by: string; what: ToggleTarget }
  | { type: 'prop'; by: string; prop: PropTopicId }
  | { type: 'answer'; by: string; choice: number }
  | { type: 'say'; by: string; text: string; voice?: boolean }
  | { type: 'reseat'; by: string; guest: number; seat: number }
  | { type: 'showOut'; by: string }
  | { type: 'did'; by: string; what: RuleCheck }
  | { type: 'plated'; by: string }
  | { type: 'alarm'; on: boolean }
  | { type: 'fuse'; by: string }
  | { type: 'dogHome'; by: string }
  | { type: 'clean'; by: string }
  | { type: 'reattach'; by: string; guest: number }
  | { type: 'visitor'; by: string }
  | { type: 'thrown'; by: string; hit: number | null }
  | { type: 'caught'; player: string }
  | { type: 'escaped'; player: string };

export type SimEvent =
  | { t: 'topic'; guest: number; kind: 'start' | 'pass' | 'smallTalk' | 'prop'; text: string; by?: string }
  | { t: 'topicDropped'; guest: number; text: string }
  | { t: 'tell'; guest: number; mood: 'bad' | 'good' | 'neutral'; text: string; cause: string }
  | { t: 'slip'; guest: number; text: string }
  | { t: 'slipHidden'; guest: number; by: string | null }
  | { t: 'slipSeen'; guest: number; witness: number | 'neighbor' }
  | { t: 'strike'; strikes: number; reason: string }
  | { t: 'eaten'; guest: number; by: number }
  | { t: 'eyeing'; guest: number; target: number }
  | { t: 'served'; guest: number; dish: string; by: string; text: string; ate: boolean }
  | { t: 'question'; guest: number; target: string }
  | { t: 'answered'; kind: AnswerOption['kind'] | 'silence'; text: string; by: string | null }
  | { t: 'rule'; rule: string; by: string }
  | { t: 'ruleBroken'; rule: string; by: string }
  | { t: 'contradiction'; a: string; b: string; guest: number }
  | { t: 'cover'; delta: number; reason: string }
  | { t: 'room'; what: ToggleTarget; on: boolean; by: string }
  | { t: 'moonrise' }
  | { t: 'neighbor'; arrived: boolean; text: string }
  | { t: 'doorbell'; guest: number }
  | { t: 'greeted'; guest: number; by: string }
  | { t: 'threshold'; guest: number }
  | { t: 'entering'; guest: number; letThemselvesIn: boolean }
  | { t: 'standing'; guest: number }
  | { t: 'seated'; guest: number; seat: number; by: string | null }
  | { t: 'reseat'; guest: number; seat: number; swappedWith: number | null; by: string }
  | { t: 'heard'; guest: number; word: string; by: string }
  | { t: 'phase'; phase: Phase; course: number }
  | { t: 'chase' }
  | { t: 'caught'; player: string }
  | { t: 'escaped'; player: string }
  | { t: 'ended'; result: DinnerResult }
  | { t: 'note'; text: string; to?: string }
  | { t: 'event'; id: EventId; text: string }
  | { t: 'eventEnd'; id: EventId; text: string }
  | { t: 'lightning' }
  | { t: 'toast'; player: string; guest: number; kind: 'start' | 'done' | 'failed' }
  | { t: 'favor'; player: string; guest: number; want: string; kind: 'asked' | 'done' | 'failed' }
  | { t: 'stone'; player: string; guest: number }
  | { t: 'partFell'; guest: number; part: string }
  | { t: 'copy'; guest: number; of: number }
  | { t: 'objective'; status: 'done' | 'failed'; text: string }
  | { t: 'visitor'; kind: VisitorState['kind']; arrived: boolean; text: string }
  | { t: 'charades'; guest: number; guess: number };

/** Everything the dinner shows on the Booking Card. */
export interface BookingCard {
  guests: number;
  menu: string[][];
  rumor: string;
  seed: string;
}

export type { DishTag };
