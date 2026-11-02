import {
  DocleusError,
  type BlockNode,
  type BlockPosition,
  type InlineNode,
  type MergeConflict,
  type MergeResolution,
} from "@docleus/sdk";

/** How the "Edit" form of a conflict edits its value. */
export type EditMode = "text" | "json";

export interface EditSeed {
  readonly mode: EditMode;
  readonly text: string;
}

/** A conflict that can take a hand-written value. */
type EditableConflict = Extract<
  MergeConflict,
  { kind: "entry" | "entry-deleted" | "block" }
>;

export function isEditable(
  conflict: MergeConflict,
): conflict is EditableConflict {
  return (
    conflict.kind === "entry" ||
    conflict.kind === "entry-deleted" ||
    conflict.kind === "block"
  );
}

const isPlainText = (node: InlineNode) =>
  node.type === "text" && node.content === undefined;

/** Whether a block's own content is plain inline text that a textarea can edit. */
export function isTextBlock(block: BlockNode | undefined): block is BlockNode {
  return block?.inline !== undefined && block.inline.every(isPlainText);
}

export function inlineText(inline: readonly InlineNode[]): string {
  return inline
    .map((node) =>
      node.type === "text"
        ? (node.text ?? "")
        : typeof node.attrs?.source === "string"
          ? node.attrs.source
          : node.content
            ? inlineText(node.content)
            : "",
    )
    .join("");
}

/** The block's own content (no children), as a resolution value needs it. */
export function withoutChildren(block: BlockNode): BlockNode {
  const { content: _children, ...own } = block;
  return own;
}

function attrsSummary(attrs: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return "";
  return keys
    .map((key) => {
      const value = attrs[key];
      return `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .join(", ");
}

/** A block as one readable line: its type and attributes, then its text. */
export function describeBlock(block: BlockNode): {
  readonly label: string;
  readonly text: string;
} {
  const attrs = attrsSummary(block.attrs);
  return {
    label: attrs === "" ? block.type : `${block.type} (${attrs})`,
    text: block.inline ? inlineText(block.inline) : "",
  };
}

export function describePosition(position: BlockPosition): string {
  return position.after === undefined
    ? `First in block ${position.parent}`
    : `In block ${position.parent}, after block ${position.after}`;
}

/** The value an edit starts from: the change request's side, else main's. */
function startingValue(conflict: EditableConflict): unknown {
  return conflict.theirs !== undefined ? conflict.theirs : conflict.ours;
}

/** What the "Edit" form starts with: an earlier edit, else a side's value. */
export function editSeed(
  conflict: EditableConflict,
  resolution?: MergeResolution,
): EditSeed {
  const seed = sideSeed(conflict);
  if (!resolution || !("value" in resolution)) return seed;
  const { value } = resolution;
  if (seed.mode === "json") {
    return { mode: "json", text: JSON.stringify(value, null, 2) };
  }
  if (typeof value === "string") return { mode: "text", text: value };
  if (isRecord(value) && Array.isArray(value.inline)) {
    return { mode: "text", text: inlineText(value.inline as InlineNode[]) };
  }
  return seed;
}

function sideSeed(conflict: EditableConflict): EditSeed {
  const start = startingValue(conflict);
  if (conflict.kind === "entry" && conflict.field === "title") {
    return { mode: "text", text: typeof start === "string" ? start : "" };
  }
  if (conflict.kind === "block") {
    const block = conflict.theirs ?? conflict.ours;
    if (isTextBlock(block)) {
      return { mode: "text", text: inlineText(block.inline ?? []) };
    }
    return {
      mode: "json",
      text: JSON.stringify(block ? withoutChildren(block) : null, null, 2),
    };
  }
  return { mode: "json", text: JSON.stringify(start ?? null, null, 2) };
}

const invalid = (message: string) =>
  new DocleusError("change-requests/invalid-edit", message);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalid("The value is not valid JSON.");
  }
}

function checkBlock(value: unknown, id: string): void {
  if (value === null) return;
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.v !== "number" ||
    !isRecord(value.attrs)
  ) {
    throw invalid(
      "A block needs a string type, a number v and an attrs object, or null to delete it.",
    );
  }
  if (value.id !== id) throw invalid(`The block id must stay "${id}".`);
  if (value.content !== undefined) {
    throw invalid("Leave out content: child blocks merge on their own.");
  }
  if (value.inline !== undefined && !Array.isArray(value.inline)) {
    throw invalid("inline must be an array.");
  }
}

function checkEntry(value: unknown): void {
  if (value === null) return;
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.title !== "string" ||
    typeof value.order !== "number" ||
    !isRecord(value.fields)
  ) {
    throw invalid(
      "An entry needs a string type and title, a number order and a fields object, or null to delete it.",
    );
  }
}

/**
 * The resolution an edit stands for. Text edits of a block keep the
 * chosen side's marks when the text is unchanged and become plain text
 * otherwise. Throws a {@link DocleusError} with a readable message when
 * the edit is invalid.
 */
export function resolutionOf(
  conflict: EditableConflict,
  mode: EditMode,
  text: string,
): MergeResolution {
  if (mode === "text") {
    if (conflict.kind === "entry") return { value: text };
    if (conflict.kind === "block") {
      const block = conflict.theirs ?? conflict.ours;
      if (!block) throw invalid("There is no block to edit.");
      const kept = [conflict.theirs, conflict.ours].find(
        (side) => side?.inline && inlineText(side.inline) === text,
      );
      const inline =
        kept?.inline ?? (text === "" ? [] : [{ type: "text", text }]);
      return { value: { ...withoutChildren(block), inline } };
    }
    throw invalid("This conflict is edited as JSON.");
  }
  const value = parseJson(text);
  if (conflict.kind === "block") checkBlock(value, conflict.blockId);
  if (conflict.kind === "entry-deleted") checkEntry(value);
  if (conflict.kind === "entry" && conflict.field === "title") {
    if (typeof value !== "string") throw invalid("A title is a string.");
  }
  return { value };
}

/** Which side a resolution took, for the resolved marker. */
export function resolutionLabel(resolution: MergeResolution): string {
  if ("take" in resolution) {
    return resolution.take === "ours"
      ? "Resolved: using main"
      : "Resolved: using the change request";
  }
  return "Resolved: edited";
}
