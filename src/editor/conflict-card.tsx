import { useId, useState } from "react";
import type {
  BlockNode,
  BlockPosition,
  EntryContent,
  MergeConflict,
  MergeResolution,
} from "@docleus/sdk";
import {
  describeBlock,
  describePosition,
  editSeed,
  isEditable,
  resolutionLabel,
  resolutionOf,
  type EditSeed,
} from "./conflict-model.ts";
import { messageOf } from "./error-view.tsx";

export type TitleOf = (entryId: string) => string;

const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: "type",
  title: "title",
  position: "position in the page tree",
  fields: "fields",
  meta: "metadata",
};

/** The heading of a conflict: what both sides changed. */
export function conflictTitle(conflict: MergeConflict, titleOf: TitleOf) {
  switch (conflict.kind) {
    case "entry":
      return `Page “${titleOf(conflict.entryId)}”: ${FIELD_LABELS[conflict.field] ?? conflict.field}`;
    case "entry-deleted":
      return `Page “${titleOf(conflict.entryId)}”: deleted on one side, changed on the other`;
    case "block": {
      const block = conflict.theirs ?? conflict.ours ?? conflict.base;
      const type = block ? ` (${block.type})` : "";
      return `Page “${titleOf(conflict.entryId)}”: block${type}`;
    }
    case "block-position":
      return `Page “${titleOf(conflict.entryId)}”: block moved on both sides`;
    case "tree":
      return `Page tree: ${conflict.entryIds.map((id) => `“${titleOf(id)}”`).join(", ")}`;
  }
}

function Deleted() {
  return <p className="cr-deleted">Deleted</p>;
}

function BlockVersion(props: { readonly block: BlockNode | undefined }) {
  if (!props.block) return <Deleted />;
  const { label, text } = describeBlock(props.block);
  return (
    <>
      <p className="cr-block-type">{label}</p>
      {text === "" ? (
        <p className="notice">No text</p>
      ) : (
        <p className="cr-block-text">{text}</p>
      )}
    </>
  );
}

function EntryVersion(props: { readonly entry: EntryContent | undefined }) {
  const { entry } = props;
  if (!entry) return <Deleted />;
  const blocks = entry.body?.content ?? [];
  return (
    <>
      <p className="cr-block-type">
        {entry.type} “{entry.title}”
      </p>
      {blocks.map((block) => (
        <BlockVersion key={block.id} block={block} />
      ))}
    </>
  );
}

function ValueVersion(props: {
  readonly value: unknown;
  readonly field: string;
}) {
  const { value, field } = props;
  if (value === undefined) return <Deleted />;
  if (field === "title" && typeof value === "string") {
    return <p className="cr-block-text">{value === "" ? "Untitled" : value}</p>;
  }
  return <pre className="cr-json">{JSON.stringify(value, null, 2)}</pre>;
}

function PositionVersion(props: {
  readonly position: BlockPosition | undefined;
}) {
  if (!props.position) return <Deleted />;
  return <p>{describePosition(props.position)}</p>;
}

function Version(props: {
  readonly conflict: MergeConflict;
  readonly side: "ours" | "theirs";
  readonly titleOf: TitleOf;
}) {
  const { conflict, side } = props;
  switch (conflict.kind) {
    case "entry":
      return <ValueVersion value={conflict[side]} field={conflict.field} />;
    case "entry-deleted":
      return <EntryVersion entry={conflict[side]} />;
    case "block":
      return <BlockVersion block={conflict[side]} />;
    case "block-position":
      return <PositionVersion position={conflict[side]} />;
    case "tree":
      return (
        <p>
          The {side === "ours" ? "main" : "change request"} version of{" "}
          {conflict.entryIds.map((id) => `“${props.titleOf(id)}”`).join(", ")}
        </p>
      );
  }
}

export interface ConflictCardProps {
  readonly conflict: MergeConflict;
  readonly titleOf: TitleOf;
  /** The resolution chosen so far, saved or not. */
  readonly resolution: MergeResolution | undefined;
  readonly isSaved: boolean;
  onResolve(resolution: MergeResolution | undefined): void;
}

/** One conflict: both versions side by side and the ways to settle it. */
export function ConflictCard(props: ConflictCardProps) {
  const { conflict, resolution } = props;
  const headingId = useId();
  const editId = useId();
  const [edit, setEdit] = useState<EditSeed | undefined>();
  const [editError, setEditError] = useState<string | undefined>();
  const takes =
    resolution && "take" in resolution ? resolution.take : undefined;

  const startEdit = () => {
    if (!isEditable(conflict)) return;
    setEdit(editSeed(conflict, resolution));
    setEditError(undefined);
  };

  const applyEdit = () => {
    if (!edit || !isEditable(conflict)) return;
    try {
      props.onResolve(resolutionOf(conflict, edit.mode, edit.text));
      setEdit(undefined);
      setEditError(undefined);
    } catch (error) {
      setEditError(messageOf(error));
    }
  };

  return (
    <section
      className={`cr-conflict${resolution ? " is-resolved" : ""}`}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{conflictTitle(conflict, props.titleOf)}</h2>
      <div className="cr-sides">
        <div className={`cr-side${takes === "ours" ? " is-chosen" : ""}`}>
          <h3>Main</h3>
          <Version conflict={conflict} side="ours" titleOf={props.titleOf} />
        </div>
        <div className={`cr-side${takes === "theirs" ? " is-chosen" : ""}`}>
          <h3>Change request</h3>
          <Version conflict={conflict} side="theirs" titleOf={props.titleOf} />
        </div>
      </div>
      <div className="cr-actions">
        <button
          type="button"
          aria-pressed={takes === "ours"}
          onClick={() => props.onResolve({ take: "ours" })}
        >
          Use main
        </button>
        <button
          type="button"
          aria-pressed={takes === "theirs"}
          onClick={() => props.onResolve({ take: "theirs" })}
        >
          Use change request
        </button>
        {isEditable(conflict) && (
          <button
            type="button"
            aria-expanded={edit !== undefined}
            aria-controls={edit ? editId : undefined}
            onClick={startEdit}
          >
            Edit
          </button>
        )}
        {resolution && (
          <button type="button" onClick={() => props.onResolve(undefined)}>
            Undo
          </button>
        )}
      </div>
      {edit && (
        <div id={editId} className="cr-edit">
          <label>
            {edit.mode === "text" ? "Text" : "Value (JSON)"}
            <textarea
              value={edit.text}
              rows={edit.mode === "text" ? 3 : 10}
              onChange={(event) =>
                setEdit({ mode: edit.mode, text: event.target.value })
              }
              aria-invalid={editError !== undefined}
            />
          </label>
          {editError !== undefined && (
            <p role="alert" className="error">
              {editError}
            </p>
          )}
          <p>
            <button type="button" onClick={applyEdit}>
              Use this version
            </button>{" "}
            <button type="button" onClick={() => setEdit(undefined)}>
              Cancel
            </button>
          </p>
        </div>
      )}
      {resolution && (
        <p className="cr-resolved">
          {resolutionLabel(resolution)}
          {props.isSaved ? "" : " (not saved yet)"}
        </p>
      )}
    </section>
  );
}
