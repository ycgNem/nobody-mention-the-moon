// Snapshot interpolation: other players, guests and props are drawn a little in the past,
// between the two snapshots around that moment, so 20 Hz server updates look smooth.

interface Sample {
  t: number;
  v: number[];
}

/** Indices in a sample vector that are angles (wrapped when interpolating). */
export type AngleMask = readonly number[];

export class Track {
  private samples: Sample[] = [];

  constructor(private readonly angles: AngleMask = []) {}

  /** Records a value at time t (ms). Repeated identical values only refresh the latest time. */
  push(t: number, v: number[]): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.t >= t) {
      last.v = v;
      return;
    }
    this.samples.push({ t, v });
    if (this.samples.length > 12) this.samples.shift();
  }

  /** The value at time t (ms), interpolated; holds the newest value past the end. */
  sample(t: number, out: number[] = []): number[] {
    const s = this.samples;
    if (s.length === 0) return out;
    if (t <= s[0]!.t || s.length === 1) return copy(s[0]!.v, out);
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t >= a.t) {
        if (t >= b.t) return copy(b.v, out);
        const k = (t - a.t) / (b.t - a.t);
        for (let j = 0; j < b.v.length; j++) {
          const x = a.v[j] ?? 0;
          let d = (b.v[j] ?? 0) - x;
          if (this.angles.includes(j)) d = Math.atan2(Math.sin(d), Math.cos(d));
          out[j] = x + d * k;
        }
        out.length = b.v.length;
        return out;
      }
    }
    return copy(s[s.length - 1]!.v, out);
  }

  get latest(): number[] | undefined {
    return this.samples[this.samples.length - 1]?.v;
  }
}

function copy(v: number[], out: number[]): number[] {
  for (let i = 0; i < v.length; i++) out[i] = v[i]!;
  out.length = v.length;
  return out;
}

/** One Track per entity id; entities missing from a snapshot are dropped. */
export class Tracks<K> {
  private tracks = new Map<K, Track>();

  constructor(private readonly angles: AngleMask = []) {}

  push(t: number, id: K, v: number[]): void {
    let tr = this.tracks.get(id);
    if (!tr) {
      tr = new Track(this.angles);
      this.tracks.set(id, tr);
    }
    tr.push(t, v);
  }

  get(id: K): Track | undefined {
    return this.tracks.get(id);
  }

  retain(ids: Set<K>): void {
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
  }
}
