import {
  z,
  type Branch,
  type ChangeRequestChecksInput,
  type Context,
  type MergeCheck,
  type Space,
} from "@docleus/sdk";
import type { ChangeRequest } from "../shared/index.ts";

/** Reported in place of the checks when a listener throws or reports invalid data. */
export const CHECK_ERROR = "change-requests.check-error";

const MAX_CHECKS = 100;

const checkSchema = z.strictObject({
  name: z
    .string()
    .max(200)
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, {
      error: "a check name is namespaced, such as acme.lint",
    }),
  title: z.string().trim().min(1).max(200),
  status: z.enum(["pending", "success", "failure"]),
  isRequired: z.boolean(),
  summary: z.string().max(1000).optional(),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .optional(),
});

/** Whether every required check succeeded. */
export function areRequiredChecksPassing(
  checks: readonly MergeCheck[],
): boolean {
  return checks.every(
    (check) => !check.isRequired || check.status === "success",
  );
}

/**
 * Asks the plugins enabled in the space for the checks of the branch's
 * current head. Problems with a listener are reported as one failed
 * required check, so they block the merge without hiding the change
 * request.
 */
export async function collectChecks(
  ctx: Context,
  space: Space,
  cr: ChangeRequest,
  branch: Branch,
): Promise<MergeCheck[]> {
  const logger = ctx.logger("change-requests");
  const reported: unknown[] = [];
  const input: ChangeRequestChecksInput = {
    spaceId: space.id,
    number: cr.number,
    title: cr.title,
    branch: branch.name,
    base: branch.base,
    head: branch.head,
    report: (check) => {
      reported.push(check);
    },
  };
  const scope = await ctx.installations.scope({
    kind: "space",
    orgId: space.orgId,
    spaceId: space.id,
  });
  const problems: string[] = [];
  try {
    await ctx.parallel(scope, "change-request/checks", input);
  } catch (error) {
    logger.warn(
      "a check of change request #%d in space %s failed: %s",
      cr.number,
      space.id,
      error,
    );
    problems.push("A check could not run.");
  }
  const checks = new Map<string, MergeCheck>();
  for (const value of reported.slice(0, MAX_CHECKS)) {
    const result = checkSchema.safeParse(value);
    if (!result.success) {
      logger.warn(
        "ignoring an invalid check of change request #%d: %s",
        cr.number,
        z.prettifyError(result.error),
      );
      problems.push("A check reported an invalid result.");
    } else if (checks.has(result.data.name)) {
      problems.push(`The check ${result.data.name} was reported twice.`);
    } else {
      checks.set(result.data.name, result.data);
    }
  }
  if (reported.length > MAX_CHECKS) {
    problems.push(`More than ${MAX_CHECKS} checks were reported.`);
  }
  const out = [...checks.values()].toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (problems.length > 0) {
    out.push({
      name: CHECK_ERROR,
      title: "Checks",
      status: "failure",
      isRequired: true,
      summary: [...new Set(problems)].join(" "),
    });
  }
  return out;
}
