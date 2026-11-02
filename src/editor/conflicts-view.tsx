import { useEffect, useState } from "react";
import {
  MAIN_BRANCH,
  type MergeConflict,
  type MergeResolution,
} from "@docleus/sdk";
import {
  crPath,
  getChangeRequest,
  listPages,
  type Api,
  type ConflictsView as ConflictsData,
  type Resolutions,
  type SpaceRef,
} from "./api.ts";
import { mergeBlocker } from "./actions.tsx";
import { ConflictCard } from "./conflict-card.tsx";
import { ErrorView } from "./error-view.tsx";
import { appHref, Link, navigate, spaceHref } from "./navigation.tsx";
import { useAction, useLoad } from "./use-load.ts";

const sameResolution = (
  a: MergeResolution | undefined,
  b: MergeResolution | undefined,
) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The conflicts the view knows: the server answers only the ones its saved
 * resolutions leave open, so conflicts resolved during this visit are kept
 * to show them with their resolution.
 */
function known(
  previous: readonly MergeConflict[],
  data: ConflictsData,
): MergeConflict[] {
  const open = new Map(
    data.conflicts.map((conflict) => [conflict.id, conflict]),
  );
  const kept = previous.filter(
    (conflict) => !open.has(conflict.id) && conflict.id in data.resolutions,
  );
  return [...kept, ...data.conflicts];
}

export function ConflictsView(props: {
  readonly api: Api;
  readonly space: SpaceRef;
  readonly number: number;
}) {
  const { api, space, number } = props;
  const path = crPath(space, number);
  const key = `${space.orgId}/${space.spaceId}/${number}`;
  const detail = useLoad(key, () => getChangeRequest(api, space, number));
  const branch = detail.data?.changeRequest.branch;
  const titles = useLoad(`${key}#${branch ?? ""}`, async () => {
    const pages = await Promise.all([
      listPages(api, space, MAIN_BRANCH),
      branch ? listPages(api, space, branch) : [],
    ]);
    return new Map(pages.flat().map((page) => [page.id, page.title]));
  });
  const [conflicts, setConflicts] = useState<MergeConflict[]>([]);
  const [saved, setSaved] = useState<Resolutions>({});
  const [drafts, setDrafts] = useState<Resolutions>({});
  const [isLoaded, setLoaded] = useState(false);
  const action = useAction();

  const accept = (data: ConflictsData) => {
    setConflicts((previous) => known(previous, data));
    setSaved(data.resolutions);
    setDrafts(data.resolutions);
    setLoaded(true);
  };

  useEffect(() => {
    let isCurrent = true;
    api.call<ConflictsData>("GET", `${path}/conflicts`).then(
      (data) => isCurrent && accept(data),
      (error: unknown) => isCurrent && action.setError(error),
    );
    return () => {
      isCurrent = false;
    };
  }, [api, path]);

  const titleOf = (entryId: string) => {
    const title = titles.data?.get(entryId);
    return title === undefined ? entryId : title || "Untitled";
  };

  const ids = new Set(conflicts.map((conflict) => conflict.id));
  const isDirty = conflicts.some(
    (conflict) => !sameResolution(drafts[conflict.id], saved[conflict.id]),
  );
  const unresolved = conflicts.filter((conflict) => !(conflict.id in drafts));
  const hiddenSaved = Object.keys(saved).filter((id) => !ids.has(id)).length;

  const save = () =>
    action.run("save", async () => {
      const resolutions = Object.fromEntries(
        Object.entries({ ...saved, ...drafts }).filter(
          ([id]) => !ids.has(id) || id in drafts,
        ),
      );
      accept(
        await api.call<ConflictsData>("PUT", `${path}/resolutions`, {
          resolutions,
        }),
      );
      detail.reload();
    });

  const discardSaved = () =>
    action.run("discard", async () => {
      accept(
        await api.call<ConflictsData>("PUT", `${path}/resolutions`, {
          resolutions: {},
        }),
      );
      detail.reload();
    });

  const rebase = () =>
    action.run("rebase", async () => {
      await api.call<unknown>("POST", `${path}/rebase`);
      navigate(appHref(space, number));
    });

  const merge = () =>
    action.run("merge", async () => {
      await api.call<unknown>("POST", `${path}/merge`);
      navigate(spaceHref(space, MAIN_BRANCH));
    });

  if (detail.error !== undefined) return <ErrorView error={detail.error} />;
  const changeRequest = detail.data?.changeRequest;
  const isBusy = action.pending !== undefined;
  const canContinue = isLoaded && !isDirty && unresolved.length === 0;
  const blocker = detail.data && mergeBlocker(detail.data);

  return (
    <div className="wrap cr-app">
      <nav className="crumbs">
        <Link href={appHref(space, number)}>← Change request #{number}</Link>
      </nav>
      <h1>
        Resolve conflicts
        {changeRequest ? `: #${number} ${changeRequest.title}` : ""}
      </h1>
      {isLoaded && conflicts.length === 0 && (
        <p>There are no conflicts with main.</p>
      )}
      {conflicts.length > 0 && (
        <p className="notice" role="status">
          {unresolved.length === 0
            ? "Every conflict has a resolution."
            : `${unresolved.length} of ${conflicts.length} conflicts unresolved.`}
        </p>
      )}
      {conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          titleOf={titleOf}
          resolution={drafts[conflict.id]}
          isSaved={sameResolution(drafts[conflict.id], saved[conflict.id])}
          onResolve={(resolution) =>
            setDrafts((current) => {
              const { [conflict.id]: _dropped, ...rest } = current;
              return resolution ? { ...rest, [conflict.id]: resolution } : rest;
            })
          }
        />
      ))}
      {hiddenSaved > 0 && (
        <p className="notice">
          {hiddenSaved} saved{" "}
          {hiddenSaved === 1 ? "resolution applies" : "resolutions apply"} to
          conflicts not shown.{" "}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void discardSaved()}
          >
            Discard saved resolutions
          </button>
        </p>
      )}
      <div className="cr-actions">
        <button
          type="button"
          disabled={isBusy || !isDirty}
          onClick={() => void save()}
        >
          Save resolutions
        </button>
        <button
          type="button"
          disabled={isBusy || !canContinue}
          onClick={() => void rebase()}
        >
          Update from main
        </button>
        <button
          type="button"
          disabled={isBusy || !canContinue || blocker !== undefined}
          onClick={() => void merge()}
        >
          Merge
        </button>
        {isDirty && <span className="notice">Save the resolutions first.</span>}
        {!isDirty && blocker !== undefined && unresolved.length === 0 && (
          <span className="notice">{blocker}</span>
        )}
      </div>
      {action.error !== undefined && <ErrorView error={action.error} />}
    </div>
  );
}
