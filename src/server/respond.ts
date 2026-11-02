import {
  DocleusError,
  type Context,
  type HttpRequestContext,
  type RouteHandler,
} from "@docleus/sdk";

const STATUS_BY_SUFFIX: readonly (readonly [string, number])[] = [
  ["/not-enabled", 404],
  ["/not-found", 404],
  ["/forbidden", 403],
  ["/not-allowed", 403],
  ["/invalid-request", 400],
  ["/invalid-id", 400],
  ["/invalid-resolution", 400],
  ["/invalid-commit", 400],
  ["/invalid-entry", 400],
  ["/invalid-branch", 400],
  ["/invalid-state", 409],
  ["/stale-head", 409],
  ["/branch-taken", 409],
  ["/commit-rejected", 409],
  ["/merge-conflict", 409],
  ["/checks-failed", 409],
];

function statusOf(code: string): number | undefined {
  if (code.endsWith("-not-found")) return 404;
  return STATUS_BY_SUFFIX.find(([suffix]) => code.endsWith(suffix))?.[1];
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Answers a `DocleusError` with a known code as `{ code, message }` and a
 * matching status. Other errors are logged and propagate.
 */
export function handle(
  ctx: Context,
  handler: (context: HttpRequestContext) => Promise<Response>,
): RouteHandler {
  const logger = ctx.logger("change-requests");
  return async (context) => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof DocleusError) {
        const status = statusOf(error.code);
        if (status !== undefined) {
          return json({ code: error.code, message: error.message }, status);
        }
      }
      logger.error(error);
      throw error;
    }
  };
}

/** Runs tasks with the same key one after another; different keys run concurrently. */
export function createKeyedSerializer(): <T>(
  key: string,
  task: () => Promise<T>,
) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (key, task) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(() => task());
    // The chain only orders tasks; each caller still sees its own rejection.
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
