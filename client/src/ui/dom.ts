// Tiny DOM helper: h('div.card.cool', { title: 'x' }, 'text', child).

type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tagAndClasses: K | `${K}.${string}`,
  attrs: Record<string, string> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = tagAndClasses.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length > 0) el.className = classes.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Replaces an element's children only when `key` changed since last time. */
export function renderIfChanged(el: HTMLElement, key: string, build: () => Child[]): void {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...build().filter((c): c is Node | string => c !== null && c !== undefined && c !== false).map((c) => (typeof c === 'number' ? String(c) : c)));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
