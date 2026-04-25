// Session-scoped memory of the last Waldstück the user was looking at.
// Mirrors to sessionStorage so navigation + invalidateAll still restores
// the plot (module-level $state can reset across some navigations).

const STORAGE_KEY = 'waldmeister.activePlotId';

let activePlotId = $state<string | null>(null);

function readStored(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
}

export const activePlotStore = {
  get id() {
    return activePlotId;
  },
  set(id: string | null) {
    activePlotId = id;
    writeStored(id);
  },
  /**
   * Write the plot id to sessionStorage only (no in-memory $state update).
   * Use immediately before `goto` + `invalidateAll` so the return target still
   * sees the right plot via `hydrate()` without mutating runes in the same
   * transition as client navigation.
   */
  persistSessionPlot(id: string) {
    writeStored(id);
  },
  /** Restore from sessionStorage when in-memory state was cleared (e.g. after navigation). */
  hydrate() {
    if (activePlotId) return;
    const v = readStored();
    if (v) activePlotId = v;
  }
};
