import {
  MAIN_BRANCH,
  type SpaceBarProps,
  type SpaceViewProps,
  type UiService,
} from "@docleus/sdk";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  numberOfBranch,
  type ChangeRequest,
  type EntryChange,
} from "../shared/index.ts";
import { isActive, mergeBlocker, STATUS_LABELS } from "./actions.tsx";
import {
  crPath,
  currentUserId,
  getChangeRequest,
  listChanges,
  workflowPath,
  type Api,
  type ChangeRequestDetail,
  type SpaceRef,
  type WorkflowView,
} from "./api.ts";
import { DiffTools, PageDiff, letterOf } from "./diff-view.tsx";
import { ErrorView } from "./error-view.tsx";
import { useLiveVersion, type LiveChanges } from "./live.ts";
import { appHref, Link, spaceHref } from "./navigation.tsx";
import { useLoad } from "./use-load.ts";

export const PANEL_ID = "change-requests.review";
export const VIEW_ID = "change-requests.changes";

/** How often an open draft refreshes its change count while editing. */
const REFRESH_MS = 4000;

/** `Draft`, `In review`, `Merged`, `Closed`: the word in a change request's tag. */
export function statusWord(changeRequest: ChangeRequest): string {
  return STATUS_LABELS[changeRequest.status];
}

export function tagClass(changeRequest: ChangeRequest): string {
  if (changeRequest.status === "draft") return "tag is-muted";
  if (changeRequest.status === "merged") return "tag is-solid";
  return "tag";
}

/** Reloads every `ms` while the page is visible. */
function useTick(ms: number, isOn: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isOn) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, ms);
    return () => clearInterval(timer);
  }, [ms, isOn]);
  return tick;
}

interface Shown {
  readonly detail: ChangeRequestDetail;
  readonly changes: readonly EntryChange[];
  readonly workflow: WorkflowView | undefined;
  readonly userId: string | undefined;
}

/** The change request on the shown branch, with its changes, kept fresh. */
function useShown(
  api: Api,
  live: LiveChanges,
  space: SpaceRef,
  number: number | undefined,
  isPolling: boolean,
) {
  const version = useLiveVersion(live);
  const tick = useTick(REFRESH_MS, isPolling);
  return useLoad<Shown | undefined>(
    `${space.orgId}/${space.spaceId}/${number ?? "-"}#${version}.${tick}`,
    async () => {
      if (number === undefined) return undefined;
      const [detail, changes, workflow, userId] = await Promise.all([
        getChangeRequest(api, space, number),
        listChanges(api, space, number),
        api
          .call<WorkflowView>("GET", workflowPath({ kind: "space", ...space }))
          .catch(() => undefined),
        currentUserId(api),
      ]);
      return { detail, changes, workflow, userId };
    },
  );
}

const withView = (href: string) =>
  `${href}${href.includes("?") ? "&" : "?"}view=${VIEW_ID}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the one primary action of an open draft is, and why it may be blocked. */
function primaryOf(shown: Shown): {
  readonly label: "Request review" | "Merge";
  readonly blocker: string | undefined;
} {
  const { changeRequest, state } = shown.detail;
  const needsReview =
    state.requiredApprovals > 0 && changeRequest.status === "draft";
  if (needsReview) {
    return {
      label: "Request review",
      blocker: shown.changes.length === 0 ? "Change a page first." : undefined,
    };
  }
  if (shown.changes.length === 0 && state.conflicts === 0) {
    return { label: "Merge", blocker: "Nothing to merge yet." };
  }
  return { label: "Merge", blocker: mergeBlocker(shown.detail) };
}

/**
 * The actions that move a draft forward: request review or merge. Merging
 * leaves edit mode; the toast says what happened.
 */
function usePrimary(
  api: Api,
  ui: Pick<UiService, "notify">,
  live: LiveChanges,
  space: SpaceRef,
  onMerged: () => void,
) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = async (shown: Shown) => {
    const { changeRequest } = shown.detail;
    const { label } = primaryOf(shown);
    setIsBusy(true);
    setError(undefined);
    try {
      if (label === "Request review") {
        await api.call(
          "POST",
          `${crPath(space, changeRequest.number)}/request-review`,
        );
        ui.notify({ message: `Asked for review on #${changeRequest.number}` });
      } else {
        await api.call("POST", `${crPath(space, changeRequest.number)}/merge`);
        ui.notify({ message: `Merged #${changeRequest.number} into main` });
        onMerged();
      }
      live.bump();
    } catch (cause) {
      setError(cause);
      ui.notify({
        message: cause instanceof Error ? cause.message : "The action failed",
      });
    } finally {
      setIsBusy(false);
    }
  };
  return { run, isBusy, error };
}

/**
 * The change request's part of the space top bar while editing on its
 * branch: its tag (opens the review panel), Review changes, and the one
 * primary action. Done (the host's) closes a draft that has no changes.
 */
export function createBar(api: Api, ui: UiService, live: LiveChanges) {
  return function ChangeRequestBar(props: SpaceBarProps) {
    const number = numberOfBranch(props.branch);
    const space = { orgId: props.orgId, spaceId: props.spaceId };
    const shown = useShown(api, live, space, number, props.isEditing);
    const primary = usePrimary(api, ui, live, space, props.stopEditing);
    const latest = useRef(shown.data);
    latest.current = shown.data;
    const { onStopEditing } = props;
    useEffect(
      () =>
        onStopEditing(async () => {
          const current = latest.current;
          if (!current) return;
          const { changeRequest, state } = current.detail;
          if (changeRequest.status !== "draft" || !state.canEdit) return;
          const changes = await listChanges(api, space, changeRequest.number);
          if (changes.length > 0) return;
          await api.call(
            "POST",
            `${crPath(space, changeRequest.number)}/close`,
          );
          live.bump();
        }),
      [onStopEditing, space.orgId, space.spaceId],
    );
    if (!props.isEditing || number === undefined) return null;
    if (shown.error !== undefined) {
      return (
        <span className="tag is-muted" title={String(shown.error)}>
          #{number}
        </span>
      );
    }
    const data = shown.data;
    if (!data) return null;
    const { changeRequest, state } = data.detail;
    if (!isActive(changeRequest)) {
      return (
        <span className={tagClass(changeRequest)}>
          {statusWord(changeRequest)} <span className="mono">#{number}</span>
        </span>
      );
    }
    const { label, blocker } = primaryOf(data);
    const isPanelOpen = props.panel === PANEL_ID;
    const isViewOpen = props.view === VIEW_ID;
    return (
      <>
        <button
          type="button"
          className={tagClass(changeRequest)}
          aria-expanded={isPanelOpen}
          aria-controls="cr-review"
          title="Change request details"
          onClick={() => props.openPanel(isPanelOpen ? undefined : PANEL_ID)}
        >
          {statusWord(changeRequest)} <span className="mono">#{number}</span>
        </button>
        {(data.changes.length > 0 || isViewOpen) && (
          <button
            type="button"
            className="btn is-quiet"
            aria-pressed={isViewOpen}
            onClick={() => props.openView(isViewOpen ? undefined : VIEW_ID)}
          >
            {isViewOpen ? "Back to editing" : "Review changes"}
            {!isViewOpen && <span className="mono">{data.changes.length}</span>}
          </button>
        )}
        {state.conflicts > 0 ? (
          <Link
            className="btn is-primary"
            href={appHref(space, number, "conflicts")}
          >
            Resolve {plural(state.conflicts, "conflict")}
          </Link>
        ) : (
          <button
            type="button"
            className="btn is-primary"
            disabled={primary.isBusy || blocker !== undefined}
            title={blocker}
            onClick={() => void primary.run(data)}
          >
            {label}
          </button>
        )}
      </>
    );
  };
}

/** The review panel beside the page: title, changes, checks, reviews, actions. */
export function createPanel(api: Api, ui: UiService, live: LiveChanges) {
  return function ChangeRequestPanel(props: SpaceViewProps) {
    const number = numberOfBranch(props.branch);
    const space = { orgId: props.orgId, spaceId: props.spaceId };
    const shown = useShown(api, live, space, number, true);
    const primary = usePrimary(api, ui, live, space, () =>
      props.openBranch(MAIN_BRANCH),
    );
    const [title, setTitle] = useState<string | undefined>();
    if (number === undefined) return null;
    const data = shown.data;
    const head = (
      <header>
        <h2>#{number}</h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close panel"
          onClick={props.close}
        >
          ×
        </button>
      </header>
    );
    if (shown.error !== undefined) {
      return (
        <aside className="panel" id="cr-review" aria-label="Change request">
          {head}
          <section>
            <ErrorView error={shown.error} />
          </section>
        </aside>
      );
    }
    if (!data) {
      return (
        <aside className="panel" id="cr-review" aria-label="Change request">
          {head}
        </aside>
      );
    }
    const { changeRequest, state } = data.detail;
    const { label, blocker } = primaryOf(data);
    const saveTitle = async () => {
      const next = title?.trim();
      setTitle(undefined);
      if (!next || next === changeRequest.title) return;
      await api.call("PATCH", crPath(space, number), { title: next });
      live.bump();
    };
    const discard = async () => {
      await api.call("POST", `${crPath(space, number)}/close`);
      live.bump();
      ui.notify({ message: `Discarded draft #${number}` });
      props.openBranch(MAIN_BRANCH);
    };
    return (
      <aside className="panel" id="cr-review" aria-label="Change request">
        {head}
        <section>
          <input
            className="ptitle"
            spellCheck={false}
            aria-label="Change request title"
            value={title ?? changeRequest.title}
            readOnly={!state.canEdit}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <p className="pmeta">
            <span className={tagClass(changeRequest)}>
              {statusWord(changeRequest)}
            </span>
            <span className="muted">{changeRequest.authorName}</span>
          </p>
        </section>
        <section>
          <h3>Changes</h3>
          {data.changes.length === 0 ? (
            <p className="muted">
              Nothing yet. Edit a page and it appears here.
            </p>
          ) : (
            <ul className="plist">
              {data.changes.map((change) => {
                const letter = letterOf(change.kind);
                return (
                  <li key={change.entryId}>
                    <span className={`chl is-${letter.toLowerCase()}`}>
                      {letter}
                    </span>
                    {change.kind === "removed" ? (
                      <span className="ell">{change.title || "Untitled"}</span>
                    ) : (
                      <Link
                        href={withView(
                          spaceHref(space, props.branch, change.entryId),
                        )}
                      >
                        {change.title || "Untitled"}
                      </Link>
                    )}
                    {change.kind === "moved" && (
                      <span className="r muted">moved</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {state.checks.length > 0 && (
          <section>
            <h3>Checks</h3>
            <ul className="plist">
              {state.checks.map((check) => (
                <li key={check.name}>
                  <span
                    className={`ic ${check.status === "success" ? "ic-check" : check.status === "failure" ? "ic-alert" : "ic-run"}`}
                  />
                  <span className="ell">{check.title}</span>
                  <span className="r res">
                    {check.status === "success"
                      ? "passed"
                      : check.status === "failure"
                        ? "failed"
                        : "running"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3>Reviews</h3>
          {state.requiredApprovals === 0 ? (
            <p className="muted">
              Not required in this space. You can merge on your own.
            </p>
          ) : changeRequest.approvals.length === 0 ? (
            <p className="muted">
              Needs {plural(state.requiredApprovals, "approval")} before merge.
            </p>
          ) : (
            <ul className="plist">
              {changeRequest.approvals.map((approval) => (
                <li key={approval.userId}>
                  <span className="ell">{approval.name}</span>
                  <span className="r res">
                    <span className="ic ic-check" />
                    Approved
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          {state.conflicts > 0 ? (
            <Link
              className="btn is-primary wide"
              href={appHref(space, number, "conflicts")}
            >
              Resolve {plural(state.conflicts, "conflict")}
            </Link>
          ) : (
            <button
              type="button"
              className="btn is-primary wide"
              disabled={primary.isBusy || blocker !== undefined}
              onClick={() => void primary.run(data)}
            >
              {label === "Merge" ? "Merge into main" : label}
            </button>
          )}
          {blocker !== undefined && (
            <p className="muted panel-note">{blocker}</p>
          )}
          <p className="panel-links">
            <Link className="linkish" href={appHref(space, number)}>
              Open full view
            </Link>
            {state.canEdit && (
              <button
                type="button"
                className="linkish is-danger"
                onClick={() => void discard()}
              >
                Discard draft
              </button>
            )}
          </p>
        </section>
      </aside>
    );
  };
}

/** Review changes: every changed page as a block diff, the shown page first. */
export function createChangesView(api: Api, live: LiveChanges) {
  return function ChangesView(props: SpaceViewProps) {
    const number = numberOfBranch(props.branch);
    const space = { orgId: props.orgId, spaceId: props.spaceId };
    const version = useLiveVersion(live);
    const [isSplit, setIsSplit] = useState(false);
    const changes = useLoad(
      `${space.orgId}/${space.spaceId}/${number ?? "-"}/bodies#${version}`,
      () =>
        number === undefined
          ? Promise.resolve([])
          : api
              .call<{ changes: EntryChange[] }>(
                "GET",
                `${crPath(space, number)}/changes?bodies=1`,
              )
              .then((result) => result.changes),
    );
    if (number === undefined) {
      return (
        <section className="dpage">
          <p className="muted">Nothing to review on main.</p>
        </section>
      );
    }
    if (changes.error !== undefined) {
      return (
        <section className="dpage">
          <ErrorView error={changes.error} />
        </section>
      );
    }
    const list = [...(changes.data ?? [])].toSorted(
      (a, b) =>
        Number(b.entryId === props.entryId) -
        Number(a.entryId === props.entryId),
    );
    return (
      <section className="dpage" aria-label="Changes">
        <DiffTools count={list.length} isSplit={isSplit} onSplit={setIsSplit} />
        {list.map((change, i) => (
          <div
            key={change.entryId}
            className="stagger"
            style={{ "--i": i } as CSSProperties}
          >
            <PageDiff
              change={change}
              isSplit={isSplit}
              {...(change.kind !== "removed" && {
                href: spaceHref(space, props.branch, change.entryId),
              })}
            />
          </div>
        ))}
        {changes.data && list.length === 0 && (
          <p className="muted">No changes yet. Edit a page and come back.</p>
        )}
      </section>
    );
  };
}

/** Finds the user's own draft in a space that has changes, for Continue editing. */
export function createDraftFinder(api: Api) {
  return async (space: SpaceRef) => {
    const [userId, list] = await Promise.all([
      currentUserId(api),
      api.call<{ changeRequests: ChangeRequest[] }>(
        "GET",
        `${crPath(space)}?status=draft`,
      ),
    ]);
    const own = list.changeRequests
      .filter((each) => each.author === userId)
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
    for (const draft of own) {
      const changes = await listChanges(api, space, draft.number);
      if (changes.length > 0)
        return { branch: draft.branch, label: `Draft #${draft.number}` };
    }
    return undefined;
  };
}
