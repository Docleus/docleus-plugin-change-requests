import type { Entry, EntryContent, EntrySet } from "@docleus/sdk";
import type { EntryChange } from "../shared/index.ts";

export function toEntrySet(entries: readonly Entry[]): EntrySet {
  const out: Record<string, EntryContent> = {};
  for (const { id, ...content } of entries) out[id] = content;
  return out;
}

/** Structural equality of JSON-like values; a key holding `undefined` counts as absent. */
export function isEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => isEqualValue(item, b[i]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set(
    [...Object.keys(left), ...Object.keys(right)].filter(
      (key) => left[key] !== undefined || right[key] !== undefined,
    ),
  );
  for (const key of keys) {
    if (!isEqualValue(left[key], right[key])) return false;
  }
  return true;
}

export interface EntryDiff {
  readonly put: Record<string, EntryContent>;
  readonly remove: string[];
}

/** The `put` and `remove` of a commit that turns `from` into `to`. */
export function diffEntrySets(from: EntrySet, to: EntrySet): EntryDiff {
  const put: Record<string, EntryContent> = {};
  const remove: string[] = [];
  for (const [id, content] of Object.entries(to)) {
    const before = from[id];
    if (before === undefined || !isEqualValue(before, content)) {
      put[id] = content;
    }
  }
  for (const id of Object.keys(from)) {
    if (to[id] === undefined) remove.push(id);
  }
  return { put, remove };
}

export function isEmptyDiff(diff: EntryDiff): boolean {
  return Object.keys(diff.put).length === 0 && diff.remove.length === 0;
}

/**
 * How each entry differs from `base` to `head`: entries of `head` first, in
 * its order, then removed ones. `isUnchanged` lets callers skip entries they
 * already know are the same, for example by content hash.
 */
export function entryChanges(
  base: EntrySet,
  head: EntrySet,
  isUnchanged: (entryId: string) => boolean = () => false,
): EntryChange[] {
  const changes: EntryChange[] = [];
  for (const [entryId, after] of Object.entries(head)) {
    const before = base[entryId];
    if (before === undefined) {
      changes.push({ entryId, title: after.title, kind: "added" });
      continue;
    }
    if (isUnchanged(entryId) || isEqualValue(before, after)) continue;
    const isMoveOnly = isEqualValue(
      { ...before, parent: undefined, order: undefined },
      { ...after, parent: undefined, order: undefined },
    );
    changes.push({
      entryId,
      title: after.title,
      kind: isMoveOnly ? "moved" : "changed",
    });
  }
  for (const [entryId, before] of Object.entries(base)) {
    if (head[entryId] === undefined) {
      changes.push({ entryId, title: before.title, kind: "removed" });
    }
  }
  return changes;
}
