// Validates commands arriving from the network. Friends-only co-op: this stops malformed
// messages from crashing the room, not cheaters (docs/TECH.md "Authority model").

import { isHouseId } from '../content/houses.ts';
import { HAIRS, HATS } from '../content/guests.ts';
import type { Command, HostLook, Target } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => num(v) && Number.isInteger(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function isTarget(v: unknown): v is Target {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'guest':
    case 'prop':
      return int(v.id);
    case 'thing':
      return str(v.id, 64);
    case 'seat':
      return int(v.seat);
    case 'neighbor':
    case 'visitor':
      return true;
    default:
      return false;
  }
}

function isLook(v: unknown): v is Partial<HostLook> {
  if (!isObj(v)) return false;
  if (v.apron !== undefined && !color(v.apron)) return false;
  if (v.skin !== undefined && !color(v.skin)) return false;
  if (v.hairColor !== undefined && !color(v.hairColor)) return false;
  if (v.hat !== undefined && !(HATS as readonly unknown[]).includes(v.hat)) return false;
  if (v.hair !== undefined && !(HAIRS as readonly unknown[]).includes(v.hair)) return false;
  return true;
}

export function isCommand(v: unknown): v is Command {
  if (!isObj(v)) return false;
  switch (v.c) {
    case 'move':
      return num(v.x) && num(v.y) && num(v.z) && num(v.yaw) && num(v.pitch) && bool(v.crouch);
    case 'ready':
      return bool(v.ready);
    case 'look':
      return isLook(v.look);
    case 'settings':
      return (
        (v.size === undefined || ['cozy', 'dinner', 'banquet', 'surprise'].includes(v.size as string)) &&
        (v.seed === undefined || str(v.seed, 24)) &&
        (v.relaxed === undefined || bool(v.relaxed)) &&
        (v.tutorial === undefined || bool(v.tutorial)) &&
        (v.house === undefined || v.house === 'surprise' || (typeof v.house === 'string' && isHouseId(v.house)))
      );
    case 'start':
    case 'back':
    case 'drop':
    case 'holdUp':
    case 'skip':
      return true;
    case 'interact':
      return isTarget(v.target);
    case 'take':
      return ['fridge', 'cellar', 'plates'].includes(v.from as string) && str(v.dish, 40);
    case 'throw':
      return num(v.power);
    case 'smallTalk':
      return int(v.guest) && int(v.card);
    case 'answer':
      return int(v.choice);
    case 'say':
      return str(v.text, 140);
    case 'heard':
      return str(v.word, 40);
    case 'reseat':
      return int(v.guest) && int(v.seat);
    case 'speaking':
      return bool(v.on);
    case 'note':
      return int(v.guest) && str(v.label, 24);
    default:
      return false;
  }
}
