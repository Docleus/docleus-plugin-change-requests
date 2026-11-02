import {
  DocleusError,
  type MergeConflict,
  type MergeResolution,
  type Scope,
  type UiService,
} from "@docleus/sdk";
import type {
  ChangeRequest,
  ChangeRequestState,
  ChangeRequestStatus,
  EntryChange,
  WorkflowSettings,
} from "../shared/index.ts";

/** The space a view belongs to. */
export interface SpaceRef {
  readonly orgId: string;
  readonly spaceId: string;
}

export type Resolutions = Readonly<Record<string, MergeResolution>>;

export interface ConflictsView {
  readonly main: string | null;
  readonly conflicts: readonly MergeConflict[];
  readonly resolutions: Resolutions;
}

export interface ChangeRequestDetail {
  readonly changeRequest: ChangeRequest;
  readonly state: ChangeRequestState;
}

export interface WorkflowView {
  readonly workflow: WorkflowSettings;
  readonly inherited: boolean;
}

export interface PageSummary {
  readonly id: string;
  readonly title: string;
}

export type StatusFilter = "active" | ChangeRequestStatus | "all";

/** The instance API as this plugin uses it. */
export interface Api {
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
}

const FALLBACK_CODE = "change-requests/request-failed";

async function errorOf(response: Response): Promise<DocleusError> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { code?: unknown; message?: unknown };
    return new DocleusError(
      typeof body.code === "string" ? body.code : FALLBACK_CODE,
      typeof body.message === "string" ? body.message : text,
    );
  } catch {
    return new DocleusError(FALLBACK_CODE, text || response.statusText);
  }
}

/** JSON calls through `ctx.ui.request`; non-2xx answers throw a {@link DocleusError}. */
export function createApi(ui: Pick<UiService, "request">): Api {
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await ui.request(path, {
        method,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw await errorOf(response);
      const text = await response.text();
      return (text === "" ? undefined : JSON.parse(text)) as T;
    },
  };
}

const enc = encodeURIComponent;

export function spaceApiPath(space: SpaceRef): string {
  return `/api/orgs/${enc(space.orgId)}/spaces/${enc(space.spaceId)}`;
}

/** `/api/.../change-requests[/<number>]`. */
export function crPath(space: SpaceRef, number?: number): string {
  const base = `${spaceApiPath(space)}/change-requests`;
  return number === undefined ? base : `${base}/${number}`;
}

export function workflowPath(scope: Scope): string {
  if (scope.kind === "space") {
    return `${spaceApiPath(scope)}/change-request-workflow`;
  }
  if (scope.kind === "org") {
    return `/api/orgs/${enc(scope.orgId)}/change-request-workflow`;
  }
  throw new DocleusError(
    "change-requests/invalid-scope",
    "the workflow is set per organization or space",
  );
}

export function listChangeRequests(
  api: Api,
  space: SpaceRef,
  status: StatusFilter = "active",
): Promise<ChangeRequest[]> {
  return api
    .call<{
      changeRequests: ChangeRequest[];
    }>("GET", `${crPath(space)}?status=${status}`)
    .then((result) => result.changeRequests);
}

export function getChangeRequest(
  api: Api,
  space: SpaceRef,
  number: number,
): Promise<ChangeRequestDetail> {
  return api.call<ChangeRequestDetail>("GET", crPath(space, number));
}

/** Pages of the space at `branch`, for titles. */
export function listPages(
  api: Api,
  space: SpaceRef,
  branch: string,
): Promise<PageSummary[]> {
  return api
    .call<{
      pages: PageSummary[];
    }>("GET", `${spaceApiPath(space)}?branch=${enc(branch)}`)
    .then((result) => result.pages);
}

/** The signed-in user's id, or `undefined`. */
export function currentUserId(api: Api): Promise<string | undefined> {
  return api
    .call<{ user: { id: string } | null }>("GET", "/api/me")
    .then((result) => result.user?.id);
}

export function listChanges(
  api: Api,
  space: SpaceRef,
  number: number,
): Promise<EntryChange[]> {
  return api
    .call<{ changes: EntryChange[] }>("GET", `${crPath(space, number)}/changes`)
    .then((result) => result.changes);
}
