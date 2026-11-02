import {
  DocleusError,
  MAIN_BRANCH,
  type Context,
  type PreCommitInput,
  type Scope,
} from "@docleus/sdk";
import {
  DEFAULT_WORKFLOW,
  PLUGIN_NAME,
  type WorkflowSettings,
} from "../shared/index.ts";
import { storedLevelOf, toWorkflow } from "./validate.ts";

type SettingsScope = Extract<Scope, { kind: "org" | "space" }>;

/**
 * Stored settings carry the level they were set at, so a space can tell its
 * own settings from the org's (`getSettings` returns the nearest ones).
 */
interface StoredWorkflow extends WorkflowSettings {
  readonly level: SettingsScope["kind"];
}

export interface EffectiveWorkflow {
  readonly workflow: WorkflowSettings;
  /** Whether the settings come from a level above `scope` (or are the default). */
  readonly inherited: boolean;
}

export interface WorkflowStore {
  get(scope: SettingsScope): Promise<EffectiveWorkflow>;
  /** `null` clears the settings at this level. */
  set(scope: SettingsScope, workflow: WorkflowSettings | null): Promise<void>;
}

export function createWorkflowStore(ctx: Context): WorkflowStore {
  const logger = ctx.logger("change-requests");
  return {
    async get(scope) {
      const stored = await ctx.installations.getSettings(PLUGIN_NAME, scope);
      if (stored === undefined) {
        return { workflow: DEFAULT_WORKFLOW, inherited: true };
      }
      const inherited = storedLevelOf(stored) !== scope.kind;
      const workflow = toWorkflow(stored);
      if (!workflow) {
        logger.warn(
          "invalid workflow settings for %s; using the default",
          scope.kind === "space"
            ? `space ${scope.spaceId}`
            : `org ${scope.orgId}`,
        );
        return { workflow: DEFAULT_WORKFLOW, inherited };
      }
      return { workflow, inherited };
    },
    async set(scope, workflow) {
      const stored: StoredWorkflow | undefined =
        workflow === null ? undefined : { ...workflow, level: scope.kind };
      await ctx.installations.setSettings(PLUGIN_NAME, scope, stored);
    },
  };
}

export const COMMIT_REJECTED = "change-requests/commit-rejected";

/**
 * Lets through commits to other branches, merges and system commits (no
 * author); rejects user commits to `main` in spaces that use change requests.
 * The hook only runs in spaces where the plugin is enabled.
 */
export function registerMainProtection(
  ctx: Context,
  workflows: WorkflowStore,
): void {
  ctx.on(
    "content/pre-commit",
    async (
      input: PreCommitInput,
      next: () => Promise<PreCommitInput>,
    ): Promise<PreCommitInput> => {
      const { commit, space } = input;
      if (
        commit.branch !== MAIN_BRANCH ||
        commit.author === undefined ||
        commit.merged !== undefined
      ) {
        return next();
      }
      const { workflow } = await workflows.get({
        kind: "space",
        orgId: space.orgId,
        spaceId: space.id,
      });
      if (workflow.mode === "change-requests") {
        throw new DocleusError(
          COMMIT_REJECTED,
          "this space uses change requests; edit in a change request",
        );
      }
      return next();
    },
  );
}
