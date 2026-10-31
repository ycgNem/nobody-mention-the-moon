// Network view of the game: the Colyseus schema mirrors shared/src/game/types.ts GameView field
// for field, so a client's decoded state (toJSON) is exactly what solo play renders.
// `syncInto` copies a fresh GameView into the schema; only changed fields go over the wire.

import { ArraySchema, Schema, schema, t } from '@colyseus/schema';

const LookState = schema(
  { apron: t.string(), hat: t.string(), skin: t.string(), hair: t.string(), hairColor: t.string() },
  'LookState',
);

export const PlayerState = schema(
  {
    id: t.string(),
    name: t.string(),
    look: t.ref(LookState),
    x: t.number(),
    y: t.number(),
    z: t.number(),
    yaw: t.number(),
    pitch: t.number(),
    crouch: t.boolean(),
    held: t.number(),
    ready: t.boolean(),
    connected: t.boolean(),
    speaking: t.boolean(),
    caught: t.boolean(),
    escaped: t.boolean(),
    stone: t.number(),
    nameTaken: t.boolean(),
  },
  'PlayerState',
);

const PropState = schema(
  {
    id: t.number(),
    kind: t.string(),
    x: t.number(),
    y: t.number(),
    z: t.number(),
    qx: t.number(),
    qy: t.number(),
    qz: t.number(),
    qw: t.number(),
    holder: t.string(),
    at: t.string(),
    dish: t.string(),
    stage: t.number(),
    progress: t.number(),
    burnt: t.boolean(),
    plated: t.boolean(),
    fire: t.boolean(),
  },
  'PropState',
);

const DoorState = schema({ id: t.string(), open: t.boolean() }, 'DoorState');
const NoteState = schema({ guest: t.number(), label: t.string(), by: t.string() }, 'NoteState');

const GuestLookState = schema(
  {
    outfit: t.string(),
    color: t.string(),
    hair: t.string(),
    hairColor: t.string(),
    skin: t.string(),
    accessory: t.string(),
    body: t.string(),
  },
  'GuestLookState',
);

const GuestState = schema(
  {
    id: t.number(),
    name: t.string(),
    look: t.ref(GuestLookState),
    where: t.string(),
    seat: t.number(),
    x: t.number(),
    z: t.number(),
    yaw: t.number(),
    composure: t.number(),
    hunger: t.number(),
    revealed: t.string(),
    form: t.string(),
    slipping: t.boolean(),
    eating: t.boolean(),
    eyeing: t.number(),
    suspicious: t.boolean(),
    waitingInvite: t.boolean(),
    chasing: t.boolean(),
  },
  'GuestState',
);

const TopicState = schema(
  { id: t.string(), label: t.string(), tags: t.array('string'), holder: t.number(), next: t.number() },
  'TopicState',
);
const HandState = schema({ player: t.string(), cards: t.array('string'), cooldowns: t.array('number') }, 'HandState');
const OptionState = schema({ kind: t.string(), text: t.string(), rule: t.string() }, 'OptionState');
const QuestionState = schema(
  {
    asker: t.number(),
    target: t.string(),
    text: t.string(),
    options: t.array(OptionState),
    timer: t.number(),
    total: t.number(),
  },
  'QuestionState',
);
const RoomState = schema(
  {
    curtainsOpen: t.boolean(),
    mirrorCovered: t.boolean(),
    lightsOn: t.boolean(),
    musicOn: t.boolean(),
    moonUp: t.boolean(),
    neighborPresent: t.boolean(),
    alarm: t.boolean(),
    powerOn: t.boolean(),
    storm: t.boolean(),
    spill: t.boolean(),
    dogLoose: t.boolean(),
  },
  'RoomState',
);
const ObjectiveState = schema({ label: t.string(), status: t.string(), progress: t.number(), goal: t.number() }, 'ObjectiveState');
const ToastState = schema(
  { player: t.string(), guest: t.number(), timer: t.number(), spoken: t.number(), need: t.number() },
  'ToastState',
);
const FavorState = schema({ player: t.string(), guest: t.number(), label: t.string(), beats: t.number() }, 'FavorState');
const VisitorState = schema({ kind: t.string(), where: t.string(), suspicion: t.number() }, 'VisitorState');
const CharadesState = schema({ actor: t.number(), guess: t.number() }, 'CharadesState');
const CourseMenuState = schema({ dishes: t.array('string') }, 'CourseMenuState');
const AwardState = schema({ player: t.string(), title: t.string(), why: t.string() }, 'AwardState');
const IncidentState = schema({ t: t.number(), kind: t.string(), text: t.string(), guest: t.number() }, 'IncidentState');
const ResultState = schema(
  {
    outcome: t.string(),
    tips: t.number(),
    stars: t.number(),
    review: t.string(),
    awards: t.array(AwardState),
    incidents: t.array(IncidentState),
  },
  'ResultState',
);

const DinnerViewState = schema(
  {
    active: t.boolean(),
    seed: t.string(),
    phase: t.string(),
    course: t.number(),
    courses: t.number(),
    phaseTime: t.number(),
    beatTimer: t.number(),
    beatSeconds: t.number(),
    cover: t.number(),
    strikes: t.number(),
    maxStrikes: t.number(),
    guests: t.array(GuestState),
    topic: t.ref(TopicState),
    hands: t.array(HandState),
    question: t.ref(QuestionState),
    room: t.ref(RoomState),
    ledger: t.array('string'),
    menu: t.array(CourseMenuState),
    result: t.ref(ResultState),
    occasion: t.string(),
    occasionLabel: t.string(),
    objective: t.ref(ObjectiveState),
    book: t.array('string'),
    honoree: t.number(),
    toast: t.ref(ToastState),
    favors: t.array(FavorState),
    visitor: t.ref(VisitorState),
    charades: t.ref(CharadesState),
  },
  'DinnerViewState',
);

export const GameState = schema(
  {
    code: t.string(),
    asset: t.string(),
    phase: t.string(),
    roomHost: t.string(),
    size: t.string(),
    seed: t.string(),
    relaxed: t.boolean(),
    tutorial: t.boolean(),
    house: t.string(),
    resultsTime: t.number(),
    players: t.array(PlayerState),
    props: t.array(PropState),
    doors: t.array(DoorState),
    notes: t.array(NoteState),
    dinner: t.ref(DinnerViewState),
  },
  'GameState',
);
export type GameState = InstanceType<typeof GameState>;

type Ctor = new () => Schema;

/** Child schema classes per (parent class, field): what to construct for refs and array items. */
const CHILDREN = new Map<Ctor, Record<string, Ctor>>([
  [PlayerState, { look: LookState }],
  [GuestState, { look: GuestLookState }],
  [QuestionState, { options: OptionState }],
  [ResultState, { awards: AwardState, incidents: IncidentState }],
  [
    DinnerViewState,
    {
      guests: GuestState,
      topic: TopicState,
      hands: HandState,
      question: QuestionState,
      room: RoomState,
      menu: CourseMenuState,
      result: ResultState,
      objective: ObjectiveState,
      toast: ToastState,
      favors: FavorState,
      visitor: VisitorState,
      charades: CharadesState,
    },
  ],
  [GameState, { players: PlayerState, props: PropState, doors: DoorState, notes: NoteState, dinner: DinnerViewState }],
]);

type Plain = Record<string, unknown>;
// why: schema instances are indexed by field name here, generically over every schema class.
type Indexable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Copies `src` (a plain view object) into `target` (its schema twin), touching only changes. */
export function syncInto(target: Schema, src: Plain, cls: Ctor = target.constructor as Ctor): void {
  const t = target as unknown as Indexable;
  const kids = CHILDREN.get(cls) ?? {};
  for (const [key, value] of Object.entries(src)) {
    const child = kids[key];
    if (Array.isArray(value)) {
      let arr = t[key] as ArraySchema<unknown> | undefined;
      if (!arr) {
        arr = new ArraySchema();
        t[key] = arr;
      }
      while (arr.length > value.length) arr.pop();
      for (let i = 0; i < value.length; i++) {
        const v = value[i];
        if (child) {
          if (i >= arr.length) arr.push(new child());
          syncInto(arr[i] as Schema, v as Plain, child);
        } else if (i >= arr.length) {
          arr.push(v);
        } else if (arr[i] !== v) {
          arr[i] = v;
        }
      }
    } else if (child) {
      if (!t[key]) t[key] = new child();
      syncInto(t[key] as Schema, value as Plain, child);
    } else if (t[key] !== value) {
      t[key] = value;
    }
  }
}
