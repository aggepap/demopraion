/** How this tab relates to a resource. `theirs` is the only one that disables. */
export type LockPhase = 'unlocked' | 'mine' | 'mine-elsewhere' | 'theirs' | 'unavailable';
