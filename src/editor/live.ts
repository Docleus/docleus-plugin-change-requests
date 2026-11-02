import { useSyncExternalStore } from "react";

/**
 * Tells the change-request views of one page (bar, panel, changes view)
 * that a change request changed, so they all reload together. Created per
 * plugin load, so a reload of the plugin starts clean.
 */
export interface LiveChanges {
  /** Increases whenever any change request may have changed. */
  version(): number;
  subscribe(onChange: () => void): () => void;
  bump(): void;
}

export function createLiveChanges(): LiveChanges {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    version: () => version,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    bump() {
      version++;
      for (const listener of listeners) listener();
    },
  };
}

export function useLiveVersion(live: LiveChanges): number {
  return useSyncExternalStore(live.subscribe, live.version);
}
