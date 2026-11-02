import { definePlugin, type Context, type DocleusPlugin } from "@docleus/sdk";
import { PLUGIN_NAME } from "../shared/index.ts";
import { createOperations } from "./operations.ts";
import { registerRoutes } from "./routes.ts";
import { createChangeRequestStore } from "./store.ts";
import { createWorkflowStore, registerMainProtection } from "./workflow.ts";

export {
  CHANGE_REQUEST_MERGED,
  type ChangeRequestMerged,
} from "./operations.ts";
export { COMMIT_REJECTED } from "./workflow.ts";

/** Options for {@link createChangeRequestsPlugin}. */
export interface ChangeRequestsPluginOptions {
  /** The clock, in milliseconds since the epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * The change-requests server plugin. Keeps change requests, approvals and
 * conflict resolutions in its own tables, serves the change-request HTTP API,
 * and rejects user commits to `main` in spaces that use change requests.
 *
 * @stability experimental
 */
export function createChangeRequestsPlugin(
  options: ChangeRequestsPluginOptions = {},
): DocleusPlugin {
  const now = options.now ?? Date.now;
  return definePlugin({
    name: PLUGIN_NAME,
    inject: [
      "storage",
      "content",
      "http",
      "authz",
      "installations",
      "identity",
    ],
    apply(ctx: Context) {
      const store = createChangeRequestStore(ctx, now);
      const workflows = createWorkflowStore(ctx);
      registerMainProtection(ctx, workflows);
      registerRoutes(
        ctx,
        createOperations(ctx, store, workflows, now),
        workflows,
      );
    },
  });
}

/** The plugin as loaded from the manifest's `server` entry. */
export const plugin = createChangeRequestsPlugin();
