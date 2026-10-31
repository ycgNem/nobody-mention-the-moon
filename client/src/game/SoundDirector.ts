// Turns the game into sound: positional effects muffled by the house's room graph, a murmur
// for each guest that tracks their mood, the record player, the Chase loop, and the evening's
// events (thunder, a power cut, a barking dog, toasts). Reads only the view and events, so solo
// and online sound the same.

import {
  findSocket,
  muffling,
  type GameEvent,
  type GameView,
  type Layout,
  type RoomGraph,
  type Vec3,
} from '@moon/shared';
import { SFX_NAMES, type AudioEngine, type Murmur, type MurmurMood, type SfxName } from '../audio/index.ts';

const SFX = new Set<string>(SFX_NAMES);
/** A loose dog barks this often (seconds). */
const BARK_EVERY = 3.5;

export class SoundDirector {
  private readonly murmurs = new Map<number, Murmur>();
  private readonly record: Vec3 | null;
  private readonly front: Vec3 | null;
  private listener: Vec3 = [0, 1.6, 0];
  private isOpen: (door: string) => boolean = () => true;
  private chasing = false;
  private musicOn = false;
  private barkIn = 0;

  constructor(
    readonly audio: AudioEngine,
    private readonly graph: RoomGraph,
    layout: Layout,
  ) {
    this.record = layout.interactables.find((i) => i.kind === 'record_player')?.position ?? null;
    this.front = findSocket(layout, 'guest_door')?.position ?? layout.interactables.find((i) => i.id === 'front')?.position ?? null;
  }

  /** 0 = clear, 1 = through two closed doors. */
  muffleAt(p: Vec3): number {
    return muffling(this.graph, p, this.listener, this.isOpen).muffle;
  }

  update(v: GameView, listener: Vec3, forward: Vec3, guestPoses: Map<number, number[]>, dt = 0): void {
    this.listener = listener;
    const doors = new Map(v.doors.map((d) => [d.id, d.open]));
    this.isOpen = (id) => doors.get(id) ?? true;
    this.audio.setListener(listener, forward);

    const d = v.dinner;
    const live = v.phase === 'dinner' && d.active;

    // Guest murmurs: present guests babble, louder and faster when it's going well or badly.
    const seen = new Set<number>();
    if (live) {
      for (const g of d.guests) {
        if (g.where === 'gone' || g.where === 'outside') continue;
        const pose = guestPoses.get(g.id);
        if (!pose) continue;
        seen.add(g.id);
        let m = this.murmurs.get(g.id);
        if (!m) {
          m = this.audio.createMurmur(pitchFor(g.name));
          this.murmurs.set(g.id, m);
        }
        const p: Vec3 = [pose[0]!, g.where === 'seated' ? 1.2 : 1.6, pose[1]!];
        m.setPosition(p);
        m.setMuffle(this.muffleAt(p));
        m.setMood(moodOf(g, d.topic.holder === g.id));
      }
    }
    for (const [id, m] of this.murmurs) {
      if (seen.has(id)) continue;
      m.dispose();
      this.murmurs.delete(id);
    }

    // The dog, while it's loose and nobody has it.
    const dog = live && d.room.dogLoose ? v.props.find((p) => p.kind === 'dog' && p.holder === '') : undefined;
    this.barkIn -= dt;
    if (dog && this.barkIn <= 0) {
      this.barkIn = BARK_EVERY;
      this.play('bark', [dog.x, dog.y + 0.4, dog.z], 0.8);
    }

    // The record player (it needs power) and the Chase.
    const music = live && d.room.musicOn && d.room.powerOn && d.phase !== 'chase';
    if (music !== this.musicOn) {
      this.musicOn = music;
      if (music) this.audio.music.play();
      else this.audio.music.stop();
    }
    if (this.record) {
      this.audio.music.setPosition(this.record);
      this.audio.music.setMuffle(this.muffleAt(this.record));
    }
    this.audio.music.setTension(live ? Math.max(0, Math.min(1, 1 - d.cover / 100 + d.strikes * 0.15)) : 0);
    const chase = live && d.phase === 'chase';
    if (chase !== this.chasing) {
      this.chasing = chase;
      if (chase) this.audio.startChase();
      else this.audio.stopChase();
    }
  }

  onEvents(events: GameEvent[], v: GameView, selfId: string, guestPoses: Map<number, number[]>): void {
    const guestAt = (id: number): Vec3 | undefined => {
      const p = guestPoses.get(id);
      return p ? [p[0]!, 1.3, p[1]!] : undefined;
    };
    for (const e of events) {
      switch (e.t) {
        case 'sfx':
          if (SFX.has(e.name)) this.play(e.name as SfxName, [e.x, e.y, e.z]);
          break;
        case 'doorbell':
          this.play('doorbell', this.front ?? undefined);
          break;
        case 'neighbor':
          if (e.arrived) this.play('knock', this.front ?? undefined);
          break;
        case 'tell':
          if (e.mood === 'bad') this.play('gasp', guestAt(e.guest), 0.6);
          break;
        case 'slip':
          this.play('murmur_shock', guestAt(e.guest));
          break;
        case 'strike':
          this.audio.sfx('strike');
          break;
        case 'eaten':
          this.play('crunch', guestAt(e.guest));
          break;
        case 'question':
          if (e.target === selfId) this.audio.sfx('question');
          break;
        case 'rule':
          this.audio.sfx('rule');
          break;
        case 'ruleBroken':
        case 'contradiction':
          this.audio.ui('ui_bad');
          break;
        case 'served':
          if (e.dish === 'red_wine') this.play('pour', guestAt(e.guest));
          break;
        case 'phase':
          if (e.phase === 'course' || e.phase === 'dessert') this.play('glass_clink', guestAt(v.dinner.guests[0]?.id ?? -1));
          break;
        case 'room':
          if (e.what === 'lights') this.audio.sfx(e.on ? 'power_up' : 'power_down', { volume: 0.4 });
          break;
        case 'chase':
          this.audio.sfx('chase_sting');
          break;
        case 'caught':
          this.audio.sfx(e.player === selfId ? 'strike' : 'gasp');
          break;
        case 'escaped':
          this.audio.sfx('van_door');
          break;
        case 'ended':
          this.audio.sfx(e.result.outcome === 'survived' ? 'applause' : e.result.outcome === 'exposed' ? 'engine' : 'door_close');
          break;
        case 'dinnerStarted':
          this.audio.ui('ui_good');
          break;
        case 'event':
          if (e.id === 'power_cut') this.audio.sfx('power_down');
          else if (e.id === 'thunderstorm') this.audio.sfx('thunder');
          else if (e.id === 'pizza') this.play('doorbell', this.front ?? undefined);
          else if (e.id === 'wine_spill') this.play('pour', guestAt(v.dinner.guests[0]?.id ?? -1));
          else if (e.id === 'toast' || e.id === 'party_game') this.play('glass_clink', guestAt(v.dinner.guests[0]?.id ?? -1));
          break;
        case 'eventEnd':
          if (e.id === 'power_cut') this.audio.sfx('power_up');
          break;
        case 'lightning':
          this.audio.sfx('thunder', { volume: 0.8 });
          break;
        case 'toast':
          if (e.kind === 'done') this.play('applause', guestAt(e.guest));
          else if (e.kind === 'failed') this.audio.ui('ui_bad');
          break;
        case 'favor':
          if (e.kind !== 'asked') this.audio.ui(e.kind === 'done' ? 'ui_good' : 'ui_bad');
          break;
        case 'stone':
          this.play('hiss', guestAt(e.guest));
          break;
        case 'partFell':
          this.play('thud', guestAt(e.guest), 0.6);
          break;
        case 'objective':
          if (e.status === 'done') this.audio.sfx('cheer');
          else this.audio.ui('ui_bad');
          break;
        case 'visitor':
          if (e.kind === 'hunter' && e.arrived) this.play('gasp', guestAt(v.dinner.guests[0]?.id ?? -1), 0.5);
          break;
        default:
          break;
      }
    }
  }

  private play(name: SfxName, at?: Vec3, volume = 1): void {
    if (!at) return this.audio.sfx(name, { volume });
    this.audio.sfx(name, { position: at, muffle: this.muffleAt(at), volume });
  }

  dispose(): void {
    for (const m of this.murmurs.values()) m.dispose();
    this.murmurs.clear();
    if (this.musicOn) this.audio.music.stop();
    if (this.chasing) this.audio.stopChase();
  }
}

function moodOf(g: GameView['dinner']['guests'][number], holding: boolean): MurmurMood {
  if (g.where === 'door') return 'silent';
  if (g.slipping) return 'slipping';
  if (g.eating) return 'eating';
  if (g.composure < 35 || g.suspicious) return 'tense';
  if (holding) return 'chatty';
  if (g.composure > 80) return 'happy';
  return 'calm';
}

/** Voice pitch from the guest's name, not their monster type (that would be a hidden tell). */
function pitchFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.75 + (h % 60) / 100;
}
