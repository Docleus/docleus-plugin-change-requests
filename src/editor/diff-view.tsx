import type { BlockNode } from "@docleus/sdk";
import { useState, type ReactNode } from "react";
import type { EntryChange } from "../shared/index.ts";
import {
  countRows,
  diffWords,
  diffBlocks,
  foldRows,
  textOf,
  type DiffRow,
  type Word,
} from "./block-diff.ts";

const LETTERS: Readonly<Record<EntryChange["kind"], "A" | "M" | "D">> = {
  added: "A",
  changed: "M",
  moved: "M",
  removed: "D",
};

export function letterOf(kind: EntryChange["kind"]): "A" | "M" | "D" {
  return LETTERS[kind];
}

/** `acme.api-endpoint` → `Api endpoint`: a type's name in words. */
export function typeLabel(type: string): string {
  const name = (type.split(".").at(-1) ?? type).replaceAll("-", " ");
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

const TABLE = "commonmark.table";

/** Each cell's words on one side of a changed table, by row and column. */
type CellWords = ReadonlyMap<string, readonly Word[]>;

function cellWords(from: BlockNode, to: BlockNode): [CellWords, CellWords] {
  const before = new Map<string, readonly Word[]>();
  const after = new Map<string, readonly Word[]>();
  const rows = Math.max(from.content?.length ?? 0, to.content?.length ?? 0);
  for (let r = 0; r < rows; r++) {
    const a = from.content?.[r]?.content ?? [];
    const b = to.content?.[r]?.content ?? [];
    for (let c = 0; c < Math.max(a.length, b.length); c++) {
      const was = a[c];
      const now = b[c];
      const [removed, added] = diffWords(
        was ? textOf(was) : "",
        now ? textOf(now) : "",
      );
      before.set(`${r}:${c}`, removed);
      after.set(`${r}:${c}`, added);
    }
  }
  return [before, after];
}

/** A table block as a table; `words` marks what changed in each cell. */
function TableText(props: { block: BlockNode; words?: CellWords }) {
  return (
    <table className="dtable">
      <tbody>
        {(props.block.content ?? []).map((tableRow, r) => (
          <tr key={tableRow.id}>
            {(tableRow.content ?? []).map((tableCell, c) => {
              const words = props.words?.get(`${r}:${c}`);
              const Cell = r === 0 ? "th" : "td";
              return (
                <Cell key={tableCell.id}>
                  {words ? <Words words={words} /> : textOf(tableCell)}
                </Cell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A changed block's two sides, cell by cell for tables, word by word otherwise. */
function changedSides(
  row: Extract<DiffRow, { kind: "change" }>,
): [ReactNode, ReactNode] {
  if (row.from.type === TABLE && row.to.type === TABLE) {
    const [before, after] = cellWords(row.from, row.to);
    return [
      <TableText block={row.from} words={before} />,
      <TableText block={row.to} words={after} />,
    ];
  }
  return [
    <BlockText block={row.from}>
      <Words words={row.removed} />
    </BlockText>,
    <BlockText block={row.to}>
      <Words words={row.added} />
    </BlockText>,
  ];
}

/** A block's text in the element its type reads as: heading, list, quote, code. */
function BlockText(props: { block: BlockNode; children?: ReactNode }) {
  const { block } = props;
  const content = props.children ?? textOf(block);
  switch (block.type) {
    case "commonmark.heading":
      return Number(block.attrs.depth) <= 2 ? (
        <h2>{content}</h2>
      ) : (
        <h3>{content}</h3>
      );
    case "commonmark.blockquote":
      return <blockquote>{content}</blockquote>;
    case "commonmark.code":
    case "mermaid.diagram":
      return <pre>{content}</pre>;
    case "commonmark.list":
      return props.children !== undefined ? (
        <p>{content}</p>
      ) : (
        <ul>
          {(block.content ?? []).map((item) => (
            <li key={item.id}>{textOf(item)}</li>
          ))}
        </ul>
      );
    case TABLE:
      return <TableText block={block} />;
    case "commonmark.thematic-break":
      return <hr />;
    case "commonmark.image":
      return <p className="muted">Image {String(block.attrs.alt ?? "")}</p>;
    case "paragraph":
      return <p>{content}</p>;
    default:
      return (
        <p>
          <span className="muted">{typeLabel(block.type)}</span> {content}
        </p>
      );
  }
}

function Words(props: { words: readonly Word[] }) {
  return (
    <>
      {props.words.map((word, i) =>
        word.kind === "ins" ? (
          <ins key={i}>{word.text}</ins>
        ) : word.kind === "del" ? (
          <del key={i}>{word.text}</del>
        ) : (
          word.text
        ),
      )}
    </>
  );
}

/** Writers read what changed, not line numbers: the gutter is only the sign. */
function Gutter(props: { sign: string }) {
  return <span className="sg">{props.sign}</span>;
}

function Unified(props: { row: DiffRow }) {
  const { row } = props;
  if (row.kind === "same") {
    return (
      <div className="drow">
        <Gutter sign="" />
        <div className="tx">
          <BlockText block={row.block} />
        </div>
      </div>
    );
  }
  if (row.kind === "add" || row.kind === "del") {
    const isAdd = row.kind === "add";
    return (
      <div className={`drow ${isAdd ? "is-add" : "is-del"}`}>
        <Gutter sign={isAdd ? "+" : "−"} />
        <div className="tx">
          <BlockText block={row.block} />
        </div>
      </div>
    );
  }
  const [removed, added] = changedSides(row);
  return (
    <>
      <div className="drow is-del">
        <Gutter sign="−" />
        <div className="tx">{removed}</div>
      </div>
      <div className="drow is-add">
        <Gutter sign="+" />
        <div className="tx">{added}</div>
      </div>
    </>
  );
}

function Side(props: {
  className?: string;
  sign: string;
  children?: ReactNode;
}) {
  if (props.children === undefined) return <div className="drow is-none" />;
  return (
    <div className={`drow ${props.className ?? ""}`}>
      <span className="sg">{props.sign}</span>
      <div className="tx">{props.children}</div>
    </div>
  );
}

function Split(props: { row: DiffRow }) {
  const { row } = props;
  if (row.kind === "same") {
    return (
      <>
        <Side sign="">
          <BlockText block={row.block} />
        </Side>
        <Side sign="">
          <BlockText block={row.block} />
        </Side>
      </>
    );
  }
  if (row.kind === "add") {
    return (
      <>
        <Side sign="" />
        <Side className="is-add" sign="+">
          <BlockText block={row.block} />
        </Side>
      </>
    );
  }
  if (row.kind === "del") {
    return (
      <>
        <Side className="is-del" sign="−">
          <BlockText block={row.block} />
        </Side>
        <Side sign="" />
      </>
    );
  }
  const [removed, added] = changedSides(row);
  return (
    <>
      <Side className="is-del" sign="−">
        {removed}
      </Side>
      <Side className="is-add" sign="+">
        {added}
      </Side>
    </>
  );
}

/** One changed page as a block diff, with unchanged runs folded. */
export function PageDiff(props: {
  change: EntryChange;
  isSplit: boolean;
  href?: string;
  parentTitle?: string;
}) {
  const { change } = props;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const rows = diffBlocks(change.before, change.after);
  const counts = countRows(rows);
  const shown = foldRows(rows, (key) => open.has(key));
  const letter = letterOf(change.kind);
  const fold = (key: string, count: number) => (
    <button
      key={`fold-${key}`}
      type="button"
      className="drow is-fold"
      onClick={() => setOpen(new Set([...open, key]))}
    >
      <span className="sg">⋯</span>
      <span className="tx">
        Show {count} unchanged block{count === 1 ? "" : "s"}
      </span>
    </button>
  );
  const body = shown.map((item, i) =>
    item.kind === "fold" ? (
      fold(item.key, item.count)
    ) : props.isSplit ? (
      <Split key={i} row={item.row} />
    ) : (
      <Unified key={i} row={item.row} />
    ),
  );
  return (
    <article className="dfile" aria-label={change.title || "Untitled"}>
      <header>
        <span className={`chl is-${letter.toLowerCase()}`}>{letter}</span>
        {props.parentTitle && (
          <span className="path">{props.parentTitle} /</span>
        )}
        <strong>
          {props.href ? (
            <a href={props.href}>{change.title || "Untitled"}</a>
          ) : (
            change.title || "Untitled"
          )}
        </strong>
        {change.kind === "moved" && <span className="muted">moved</span>}
        <span className="stat">
          {counts.added > 0 && <span className="a">+{counts.added}</span>}
          {counts.removed > 0 && <span className="d">−{counts.removed}</span>}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="dempty">No changes to the page body.</p>
      ) : props.isSplit ? (
        <div className="dsplit">{body}</div>
      ) : (
        body
      )}
    </article>
  );
}

/** Unified or Split, with the number of changed pages. */
export function DiffTools(props: {
  count: number;
  isSplit: boolean;
  onSplit(isSplit: boolean): void;
}) {
  return (
    <div className="dtools">
      <span className="muted">
        {props.count} changed page{props.count === 1 ? "" : "s"} compared with
        main
      </span>
      <span className="seg" role="group" aria-label="Diff layout">
        <button
          type="button"
          aria-pressed={!props.isSplit}
          onClick={() => props.onSplit(false)}
        >
          Unified
        </button>
        <button
          type="button"
          aria-pressed={props.isSplit}
          onClick={() => props.onSplit(true)}
        >
          Split
        </button>
      </span>
    </div>
  );
}
