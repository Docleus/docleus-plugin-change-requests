import type { EditBranchResolver } from "@docleus/sdk";
import type { ChangeRequest } from "../shared/index.ts";
import {
  crPath,
  currentUserId,
  workflowPath,
  type Api,
  type WorkflowView,
} from "./api.ts";

/**
 * Sends the first edit of a space shown at `main` to the user's latest
 * draft there, or to a new draft change request, unless the space edits
 * `main` directly.
 */
export function createEditBranchResolver(api: Api): EditBranchResolver {
  return async ({ orgId, spaceId }) => {
    const space = { orgId, spaceId };
    const { workflow } = await api.call<WorkflowView>(
      "GET",
      workflowPath({ kind: "space", ...space }),
    );
    if (workflow.mode === "direct") return undefined;
    const [userId, drafts] = await Promise.all([
      currentUserId(api),
      api.call<{ changeRequests: ChangeRequest[] }>(
        "GET",
        `${crPath(space)}?status=draft`,
      ),
    ]);
    const own = drafts.changeRequests
      .filter((each) => each.author === userId)
      .toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
    if (own) return own.branch;
    const { changeRequest } = await api.call<{ changeRequest: ChangeRequest }>(
      "POST",
      crPath(space),
      {},
    );
    return changeRequest.branch;
  };
}
