// Occasions (docs/GUESTS.md): what tonight's party is for. Each changes the guest list, event
// weights, rumors or seating, and adds one special objective worth bonus tips.

import type { EventId } from './events.ts';
import type { GuestTypeId } from './guests.ts';
import type { RelationshipId } from './relationships.ts';

export type OccasionId = 'dinner_party' | 'birthday' | 'book_club' | 'wedding' | 'surprise' | 'ex_reunion' | 'hunter_night';

export type ObjectiveId = 'birthday_cake' | 'book_streak' | 'family_toasts' | 'keep_secret' | 'exes_apart' | 'hunter_fooled';

export interface OccasionDef {
  id: OccasionId;
  label: string;
  /** One line for the Booking Card. */
  blurb: string;
  /** How often it's rolled (relative). */
  weight: number;
  /** Multipliers on the event deck's weights. */
  eventWeights: Partial<Record<EventId, number>>;
  /** Events that always happen at this occasion. */
  forcedEvents?: readonly EventId[];
  objective: { id: ObjectiveId; label: string; tips: number } | null;
  /** A guest of honor (birthday, surprise party), optionally of a set type. */
  honoree?: { type?: GuestTypeId; doubleSwings?: boolean };
  /** Book Club: a random pair of topic tags is "the book" all night. */
  book?: boolean;
  /** Wedding: two families, each all one monster type, on opposite sides of the table. */
  families?: boolean;
  /** Relationships this occasion guarantees. */
  relationships?: readonly RelationshipId[];
  /** Hunter Night: the Monster Hunter is the entertainment. */
  hunter?: boolean;
  /** Dessert always includes this dish. */
  dessert?: string;
}

export const OCCASIONS: Record<OccasionId, OccasionDef> = {
  dinner_party: {
    id: 'dinner_party',
    label: 'Dinner Party',
    blurb: 'A perfectly ordinary dinner party. For monsters.',
    weight: 4,
    eventWeights: {},
    objective: null,
  },
  birthday: {
    id: 'birthday',
    label: 'Birthday',
    blurb: "It's someone's birthday. Their nerves are on edge, and there's a cake with candles.",
    weight: 2,
    eventWeights: { toast: 2 },
    objective: { id: 'birthday_cake', label: 'Serve the birthday guest their cake while they are composed', tips: 30 },
    honoree: { doubleSwings: true },
    dessert: 'birthday_cake',
  },
  book_club: {
    id: 'book_club',
    label: 'Book Club',
    blurb: 'Everyone has read the book. Topics keep drifting back to it.',
    weight: 2,
    eventWeights: { party_game: 1.5 },
    objective: { id: 'book_streak', label: 'Keep a topic about the book going for 6 beats in a row', tips: 25 },
    book: true,
  },
  wedding: {
    id: 'wedding',
    label: 'Wedding Rehearsal',
    blurb: "Two families, one on each side of the table. Neither knows what the other is.",
    weight: 1,
    eventWeights: { toast: 3 },
    forcedEvents: ['toast', 'toast'],
    objective: { id: 'family_toasts', label: 'A toast to each family without a single slip', tips: 35 },
    families: true,
  },
  surprise: {
    id: 'surprise',
    label: 'Surprise Party',
    blurb: "The guest of honor is a ghost. They've been dead 200 years and don't know. Hide the candles.",
    weight: 1,
    eventWeights: { toast: 1.5 },
    objective: { id: 'keep_secret', label: "Keep the guest of honor from slipping before dessert", tips: 35 },
    honoree: { type: 'ghost' },
    dessert: 'birthday_cake',
  },
  ex_reunion: {
    id: 'ex_reunion',
    label: 'Ex Reunion',
    blurb: 'Two couples who used to be couples. Seat them carefully.',
    weight: 1,
    eventWeights: { wine_spill: 1.5 },
    objective: { id: 'exes_apart', label: "Keep both pairs of exes out of each other's sight all through the main course", tips: 30 },
    relationships: ['exes', 'exes'],
  },
  hunter_night: {
    id: 'hunter_night',
    label: 'Hunter Night',
    blurb: 'The "magician" you booked turns out to be a Monster Hunter. He thinks he\'s the entertainment.',
    weight: 1,
    eventWeights: { neighbor: 0.3 },
    objective: { id: 'hunter_fooled', label: 'Get the hunter out the door without him noticing anything', tips: 40 },
    hunter: true,
  },
};

export const OCCASION_IDS = Object.keys(OCCASIONS) as OccasionId[];

export function occasionById(id: OccasionId): OccasionDef {
  return OCCASIONS[id];
}
