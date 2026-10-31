import type { GuestTypeId } from '../content/guests.ts';
import type { TopicTag } from '../content/topics.ts';
import type { SimTuning } from '../tuning.ts';

export type Phase = 'course' | 'dessert' | 'ended';

export interface GuestState {
  id: number;
  type: GuestTypeId;
  name: string;
  color: string;
  /** Index into the seat ring (0..seatCount-1, clockwise around the table). */
  seat: number;
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
  options: AnswerOption[];
  timer: number;
  total: number;
}

export interface RoomState {
  curtainsOpen: boolean;
  mirrorCovered: boolean;
  lightsOn: boolean;
  moonUp: boolean;
  neighborPresent: boolean;
  neighborTimer: number;
}

export type ScheduledKind = 'moonrise' | 'neighbor';

export interface ScheduledEvent {
  kind: ScheduledKind;
  at: number;
  fired: boolean;
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

export interface DinnerResult {
  outcome: 'survived' | 'strikes' | 'exposed';
  tips: number;
  stars: number;
  review: string;
}

export interface DinnerState {
  seed: string;
  rngState: number;
  tuning: SimTuning;
  seatCount: number;

  time: number;
  phase: Phase;
  /** 0-based course index. */
  course: number;
  /** Seconds left in the current course or dessert. */
  phaseTime: number;
  beat: number;
  beatTimer: number;

  guests: GuestState[];
  topic: TopicState | null;
  nextStarter: number | null;

  /** Small Talk hand: topic ids, null while a slot refills. */
  hand: (string | null)[];
  handCooldown: number[];
  dishCooldown: Record<string, number>;
  propsUsed: string[];

  cover: number;
  strikes: number;
  room: RoomState;
  /** Rule ids in the order they were added. */
  ledger: string[];

  question: QuestionState | null;
  questionInBeats: number;
  recentQuestions: string[];

  schedule: ScheduledEvent[];
  stats: DinnerStats;
  result: DinnerResult | null;
}

/** What the sim asks the outside world (3D room, later the server's physics). */
export interface SimWorld {
  /** Can guest `id` hear the player who is speaking right now? */
  canHear(guestId: number): boolean;
  /** Is a player standing close enough to block the table's view of guest `id`? */
  isBlocking(guestId: number): boolean;
}

export const OPEN_WORLD: SimWorld = { canHear: () => true, isBlocking: () => false };

export type ToggleTarget = 'curtains' | 'mirror' | 'lights';

export type Action =
  | { type: 'smallTalk'; guest: number; card: number }
  | { type: 'serve'; guest: number; dish: string }
  | { type: 'toggle'; what: ToggleTarget }
  | { type: 'prop'; prop: string }
  | { type: 'answer'; choice: number }
  | { type: 'say'; text: string }
  | { type: 'reseat'; guest: number; seat: number }
  | { type: 'showOut' };

export type SimEvent =
  | { t: 'topic'; guest: number; kind: 'start' | 'pass' | 'smallTalk' | 'prop'; text: string }
  | { t: 'topicDropped'; guest: number; text: string }
  | { t: 'tell'; guest: number; mood: 'bad' | 'good' | 'neutral'; text: string; cause: string }
  | { t: 'slip'; guest: number; text: string }
  | { t: 'slipHidden'; guest: number }
  | { t: 'slipSeen'; guest: number }
  | { t: 'strike'; strikes: number; reason: string }
  | { t: 'eaten'; guest: number; by: number }
  | { t: 'eyeing'; guest: number; target: number }
  | { t: 'served'; guest: number; dish: string; text: string }
  | { t: 'question'; guest: number }
  | { t: 'answered'; kind: AnswerOption['kind'] | 'silence'; text: string }
  | { t: 'rule'; rule: string }
  | { t: 'ruleBroken'; rule: string }
  | { t: 'contradiction'; a: string; b: string; guest: number }
  | { t: 'cover'; delta: number; reason: string }
  | { t: 'room'; what: ToggleTarget; on: boolean }
  | { t: 'moonrise' }
  | { t: 'neighbor'; arrived: boolean; text: string }
  | { t: 'reseat'; guest: number; seat: number; swappedWith: number | null }
  | { t: 'phase'; phase: Phase; course: number }
  | { t: 'ended'; result: DinnerResult }
  | { t: 'note'; text: string };
