// The event deck (docs/GUESTS.md): 2–4 drawn per dinner, weighted by occasion. Oven fires aren't
// in the deck: they happen on their own when someone leaves the hob on.

import type { GuestTypeId } from './guests.ts';

export type EventId =
  | 'moonrise'
  | 'neighbor'
  | 'toast'
  | 'dog'
  | 'power_cut'
  | 'thunderstorm'
  | 'late_guest'
  | 'pizza'
  | 'wine_spill'
  | 'party_game';

export interface EventDef {
  id: EventId;
  label: string;
  /** What everyone is told when it starts. */
  announce: string;
  weight: number;
  /** At most one of these per dinner (the moon only rises once). */
  once: boolean;
  /** Only drawn if a guest of one of these types is coming. */
  needsType?: readonly GuestTypeId[];
  /** How long it lasts, in seconds (0: until players deal with it). */
  seconds: number;
}

export const EVENTS: Record<EventId, EventDef> = {
  moonrise: {
    id: 'moonrise',
    label: 'Moonrise',
    announce: 'The full moon is rising behind the curtains. Nobody mention it.',
    weight: 3,
    once: true,
    seconds: 0,
  },
  neighbor: {
    id: 'neighbor',
    label: 'Doorbell: Gary',
    announce: 'Ding-dong. Gary from next door "just popped round". He is very human.',
    weight: 2,
    once: true,
    seconds: 60,
  },
  toast: {
    id: 'toast',
    label: 'Toast',
    announce: '"Speech! Speech!"',
    weight: 2,
    once: false,
    seconds: 25,
  },
  dog: {
    id: 'dog',
    label: 'The Dog Got Out',
    announce: 'The dog got out of the garage and is heading for the dining room!',
    weight: 2,
    once: true,
    seconds: 0,
  },
  power_cut: {
    id: 'power_cut',
    label: 'Power Cut',
    announce: 'The lights die. Somebody find the fuse box!',
    weight: 2,
    once: true,
    seconds: 45,
  },
  thunderstorm: {
    id: 'thunderstorm',
    label: 'Thunderstorm',
    announce: 'A storm rolls in. The curtains keep blowing open.',
    weight: 1.5,
    once: true,
    seconds: 90,
  },
  late_guest: {
    id: 'late_guest',
    label: 'Late Guest',
    announce: 'The doorbell: someone is fashionably late.',
    weight: 1.5,
    once: true,
    seconds: 0,
  },
  pizza: {
    id: 'pizza',
    label: 'Doorbell: Pizza',
    announce: 'A pizza driver is at the door. Nobody ordered pizza. Sign, tip, send them off.',
    weight: 1.5,
    once: true,
    seconds: 40,
  },
  wine_spill: {
    id: 'wine_spill',
    label: 'Wine Spill',
    announce: 'Red wine all over the tablecloth! Grab the tea towel.',
    weight: 1.5,
    once: true,
    seconds: 0,
  },
  party_game: {
    id: 'party_game',
    label: 'Party Game',
    announce: 'Someone suggests charades. Everyone acts out… themselves.',
    weight: 1,
    once: true,
    seconds: 0,
  },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export function eventById(id: EventId): EventDef {
  return EVENTS[id];
}
