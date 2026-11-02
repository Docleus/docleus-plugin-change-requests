import type { BlockNode } from "@docleus/sdk";

/** A run of words in a changed block: kept, inserted or deleted. */
export interface Word {
  readonly text: string;
  readonly kind: "same" | "ins" | "del";
}

/** One row of a page diff: a top-level block on one or both sides. */
export type DiffRow =
  | {
      readonly kind: "same";
      readonly before: number;
      readonly after: number;
      readonly block: BlockNode;
    }
  | { readonly kind: "add"; readonly after: number; readonly block: BlockNode }
  | { readonly kind: "del"; readonly before: number; readonly block: BlockNode }
  | {
      readonly kind: "change";
      readonly before: number;
      readonly after: number;
      readonly from: BlockNode;
      readonly to: BlockNode;
      readonly removed: readonly Word[];
      readonly added: readonly Word[];
    };

/** The visible text of a block: its inline text, then its children's, one per line. */
export function textOf(block: BlockNode): string {
  const own = (block.inline ?? [])
    .map((node) => (typeof node.text === "string" ? node.text : ""))
    .join("");
  const children = (block.content ?? []).map(textOf).filter(Boolean);
  return [own, ...children].filter(Boolean).join("\n");
}

/** Blocks compare by type, attrs and content; ids and versions are not content. */
function signature(block: BlockNode): string {
  const strip = (node: BlockNode): unknown => ({
    type: node.type,
    attrs: node.attrs,
    inline: node.inline,
    content: node.content?.map(strip),
  });
  return JSON.stringify(strip(block));
}

const isBlank = (block: BlockNode) =>
  textOf(block).trim() === "" &&
  (block.content?.length ?? 0) === 0 &&
  block.type === "paragraph";

const WORD = /\s+|[^\s]+/g;

/** Appends `text`, merging it into the last word of the same kind. */
function push(out: Word[], text: string, kind: Word["kind"]): void {
  const last = out.at(-1);
  if (last?.kind === kind)
    out[out.length - 1] = { text: last.text + text, kind };
  else out.push({ text, kind });
}

/** A word diff by longest common subsequence; capped so huge blocks stay fast. */
export function diffWords(a: string, b: string): [Word[], Word[]] {
  const left = a.match(WORD) ?? [];
  const right = b.match(WORD) ?? [];
  const n = left.length;
  const m = right.length;
  if (n * m > 250_000) {
    return [[{ text: a, kind: "del" }], [{ text: b, kind: "ins" }]];
  }
  const width = m + 1;
  // lcs[i * width + j]: the common length of left[i..] and right[j..].
  const lcs = new Uint32Array((n + 1) * width);
  const at = (i: number, j: number) => lcs[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        left[i] === right[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const removed: Word[] = [];
  const added: Word[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const l = left[i];
    const r = right[j];
    if (l !== undefined && r !== undefined && l === r) {
      push(removed, l, "same");
      push(added, r, "same");
      i++;
      j++;
    } else if (
      r !== undefined &&
      (l === undefined || at(i, j + 1) >= at(i + 1, j))
    ) {
      push(added, r, r.trim() === "" ? "same" : "ins");
      j++;
    } else if (l !== undefined) {
      push(removed, l, l.trim() === "" ? "same" : "del");
      i++;
    }
  }
  return [removed, added];
}

/**
 * The rows of a page diff, keyed by block id: blocks of `after` in order,
 * with the blocks `before` had and `after` lost placed where they were.
 */
export function diffBlocks(
  before: BlockNode | undefined,
  after: BlockNode | undefined,
): DiffRow[] {
  const old = before?.content ?? [];
  const now = after?.content ?? [];
  const rows: DiffRow[] = [];
  let next = 0;
  let oldLine = 0;
  let newLine = 0;
  const flushRemoved = (upTo: number) => {
    while (next < upTo) {
      const block = old[next++];
      if (block && !isBlank(block))
        rows.push({ kind: "del", before: ++oldLine, block });
    }
  };
  for (const block of now) {
    const index = old.findIndex((candidate) => candidate.id === block.id);
    if (index < 0) {
      if (!isBlank(block)) rows.push({ kind: "add", after: ++newLine, block });
      continue;
    }
    if (index >= next) flushRemoved(index);
    next = Math.max(next, index + 1);
    const was = old[index];
    if (!was) continue;
    if (signature(was) === signature(block)) {
      rows.push({ kind: "same", before: ++oldLine, after: ++newLine, block });
    } else {
      const [removed, added] = diffWords(textOf(was), textOf(block));
      rows.push({
        kind: "change",
        before: ++oldLine,
        after: ++newLine,
        from: was,
        to: block,
        removed,
        added,
      });
    }
  }
  flushRemoved(old.length);
  return rows;
}

/** Added and removed block counts, as `+n −m` shows them. */
export function countRows(rows: readonly DiffRow[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "add" || row.kind === "change") added++;
    if (row.kind === "del" || row.kind === "change") removed++;
  }
  return { added, removed };
}

/** A fold of unchanged rows, or a row to show. */
export type ShownRow =
  | { readonly kind: "row"; readonly row: DiffRow }
  | { readonly kind: "fold"; readonly key: string; readonly count: number };

/** Folds runs of more than two unchanged rows, keeping one on each side. */
export function foldRows(
  rows: readonly DiffRow[],
  isOpen: (key: string) => boolean,
): ShownRow[] {
  const out: ShownRow[] = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    if (row && row.kind !== "same") {
      out.push({ kind: "row", row });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j]?.kind === "same") j++;
    const run = rows.slice(i, j);
    const key = String(i);
    if (run.length > 2 && !isOpen(key)) {
      const head = i === 0 ? [] : run.slice(0, 1);
      const tail = j === rows.length ? [] : run.slice(-1);
      out.push(...head.map((kept) => ({ kind: "row" as const, row: kept })));
      out.push({
        kind: "fold",
        key,
        count: run.length - head.length - tail.length,
      });
      out.push(...tail.map((kept) => ({ kind: "row" as const, row: kept })));
    } else {
      out.push(...run.map((kept) => ({ kind: "row" as const, row: kept })));
    }
    i = j;
  }
  return out;
}
