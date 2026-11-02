import {
  DocleusError,
  type Action,
  type Context,
  type HttpMethod,
  type HttpRequestContext,
  type Org,
  type Space,
} from "@docleus/sdk";
import { PLUGIN_NAME } from "../shared/index.ts";
import {
  isConflicted,
  type Caller,
  type ChangeRequestOperations,
  type Conflicted,
  type Landed,
} from "./operations.ts";
import { handle, json } from "./respond.ts";
import {
  parseCreateBody,
  parseNumber,
  parsePatchBody,
  parseResolutionsBody,
  parseStatusFilter,
  parseWorkflowBody,
  readJson,
} from "./validate.ts";
import type { WorkflowStore } from "./workflow.ts";

const SPACE = "/api/orgs/:orgId/spaces/:spaceId";
const CR = `${SPACE}/change-requests`;
const ONE = `${CR}/:number`;

function param(context: HttpRequestContext, name: string): string {
  const value = context.params[name];
  if (value === undefined) {
    throw new DocleusError(
      "change-requests/invalid-request",
      `missing "${name}"`,
    );
  }
  return value;
}

function forbidden(action: Action): DocleusError {
  return new DocleusError(
    "change-requests/forbidden",
    `not allowed to ${action}`,
  );
}

function notEnabled(): DocleusError {
  return new DocleusError(
    "change-requests/not-enabled",
    "change requests are not enabled here",
  );
}

function landed(result: Landed | Conflicted, number: number): Response {
  if (isConflicted(result)) {
    return json(
      {
        code: "change-requests/merge-conflict",
        message: `change request #${number} has ${result.conflicts.length} unresolved conflict(s)`,
        conflicts: result.conflicts,
      },
      409,
    );
  }
  return json(result);
}

export function registerRoutes(
  ctx: Context,
  operations: ChangeRequestOperations,
  workflows: WorkflowStore,
): void {
  async function requireSpace(
    context: HttpRequestContext,
    action: Action,
  ): Promise<Space> {
    const orgId = param(context, "orgId");
    const spaceId = param(context, "spaceId");
    const scope = { kind: "space", orgId, spaceId } as const;
    if (!(await ctx.authz.can(context.actor, action, scope))) {
      throw forbidden(action);
    }
    const space = (await ctx.content.listSpaces(orgId)).find(
      (candidate) => candidate.id === spaceId,
    );
    if (!space) {
      throw new DocleusError(
        "change-requests/space-not-found",
        `space "${spaceId}" does not exist`,
      );
    }
    if (!(await ctx.installations.isEnabled(PLUGIN_NAME, scope))) {
      throw notEnabled();
    }
    return space;
  }

  async function requireOrg(
    context: HttpRequestContext,
    action: Action,
  ): Promise<Org> {
    const orgId = param(context, "orgId");
    if (!(await ctx.authz.can(context.actor, action, { kind: "org", orgId }))) {
      throw forbidden(action);
    }
    const org = await ctx.content.getOrg(orgId);
    if (!org) {
      throw new DocleusError(
        "change-requests/org-not-found",
        `organization "${orgId}" does not exist`,
      );
    }
    if (!(await ctx.installations.isInstalled(PLUGIN_NAME))) {
      throw notEnabled();
    }
    return org;
  }

  async function callerOf(
    context: HttpRequestContext,
    space: Space,
  ): Promise<Caller> {
    const { actor } = context;
    if (actor.kind !== "user") throw forbidden("write");
    const scope = {
      kind: "space",
      orgId: space.orgId,
      spaceId: space.id,
    } as const;
    const [user, isSpaceAdmin, canWrite] = await Promise.all([
      ctx.identity.getUser(actor.userId),
      ctx.authz.can(actor, "manage", scope),
      ctx.authz.can(actor, "write", scope),
    ]);
    return {
      actor,
      userId: actor.userId,
      name: user?.name ?? actor.userId,
      isSpaceAdmin,
      canWrite,
    };
  }

  function route(
    method: HttpMethod,
    path: string,
    handler: (
      context: HttpRequestContext,
      space: Space,
      caller: Caller,
    ) => Promise<Response>,
  ): void {
    const action: Action = method === "GET" ? "read" : "write";
    ctx.http.route(
      method,
      path,
      handle(ctx, async (context) => {
        const space = await requireSpace(context, action);
        return handler(context, space, await callerOf(context, space));
      }),
    );
  }

  route("GET", CR, async ({ request }, space, caller) => {
    const filter = parseStatusFilter(
      new URL(request.url).searchParams.get("status"),
    );
    return json({
      changeRequests: await operations.list(space, caller, filter),
    });
  });

  route("POST", CR, async ({ request }, space, caller) => {
    const { title } = parseCreateBody(await readJson(request));
    return json(
      { changeRequest: await operations.create(space, caller, title) },
      201,
    );
  });

  route("GET", ONE, async (context, space, caller) => {
    const changeRequest = await operations.get(
      space,
      caller,
      parseNumber(context.params.number),
    );
    return json({
      changeRequest,
      state: await operations.state(space, caller, changeRequest),
    });
  });

  route("PATCH", ONE, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    const patch = parsePatchBody(await readJson(context.request));
    return json({
      changeRequest: await operations.update(space, caller, number, patch),
    });
  });

  route("POST", `${ONE}/request-review`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return json({
      changeRequest: await operations.requestReview(space, caller, number),
    });
  });

  route("POST", `${ONE}/approve`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return json({
      changeRequest: await operations.approve(space, caller, number, true),
    });
  });

  route("DELETE", `${ONE}/approve`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return json({
      changeRequest: await operations.approve(space, caller, number, false),
    });
  });

  route("POST", `${ONE}/close`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return json({
      changeRequest: await operations.close(space, caller, number),
    });
  });

  route("GET", `${ONE}/changes`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    const withBodies =
      new URL(context.request.url).searchParams.get("bodies") === "1";
    return json({
      changes: await operations.changes(space, caller, number, { withBodies }),
    });
  });

  route("GET", `${ONE}/conflicts`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return json(await operations.conflicts(space, caller, number));
  });

  route("PUT", `${ONE}/resolutions`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    const resolutions = parseResolutionsBody(await readJson(context.request));
    return json(
      await operations.setResolutions(space, caller, number, resolutions),
    );
  });

  route("POST", `${ONE}/rebase`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return landed(await operations.rebase(space, caller, number), number);
  });

  route("POST", `${ONE}/merge`, async (context, space, caller) => {
    const number = parseNumber(context.params.number);
    return landed(await operations.merge(space, caller, number), number);
  });

  ctx.http.route(
    "GET",
    `${SPACE}/change-request-workflow`,
    handle(ctx, async (context) => {
      const space = await requireSpace(context, "read");
      return json(
        await workflows.get({
          kind: "space",
          orgId: space.orgId,
          spaceId: space.id,
        }),
      );
    }),
  );

  ctx.http.route(
    "PUT",
    `${SPACE}/change-request-workflow`,
    handle(ctx, async (context) => {
      const space = await requireSpace(context, "manage");
      const workflow = parseWorkflowBody(await readJson(context.request));
      const scope = {
        kind: "space",
        orgId: space.orgId,
        spaceId: space.id,
      } as const;
      await workflows.set(scope, workflow);
      return json(await workflows.get(scope));
    }),
  );

  ctx.http.route(
    "GET",
    "/api/orgs/:orgId/change-request-workflow",
    handle(ctx, async (context) => {
      const org = await requireOrg(context, "read");
      return json(await workflows.get({ kind: "org", orgId: org.id }));
    }),
  );

  ctx.http.route(
    "PUT",
    "/api/orgs/:orgId/change-request-workflow",
    handle(ctx, async (context) => {
      const org = await requireOrg(context, "manage");
      const workflow = parseWorkflowBody(await readJson(context.request));
      const scope = { kind: "org", orgId: org.id } as const;
      await workflows.set(scope, workflow);
      return json(await workflows.get(scope));
    }),
  );
}
