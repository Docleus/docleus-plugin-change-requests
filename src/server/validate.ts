import { DocleusError, z, type MergeResolution } from "@docleus/sdk";
import type {
  ChangeRequestStatus,
  WorkflowMode,
  WorkflowSettings,
} from "../shared/index.ts";

export const DEFAULT_TITLE = "Untitled change request";
export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 20_000;
export const MAX_REQUIRED_APPROVALS = 20;
const MAX_RESOLUTIONS = 10_000;
const MAX_CONFLICT_ID_LENGTH = 1_000;

const STATUSES = [
  "draft",
  "open",
  "merged",
  "closed",
] as const satisfies readonly ChangeRequestStatus[];
const MODES = [
  "change-requests",
  "direct",
] as const satisfies readonly WorkflowMode[];

export type StatusFilter = ChangeRequestStatus | "active" | "all";
const STATUS_FILTERS = [
  ...STATUSES,
  "active",
  "all",
] as const satisfies readonly StatusFilter[];

const WORKFLOW_MESSAGE = `workflow must be null or { mode: "change-requests" | "direct", requiredApprovals: 0-${MAX_REQUIRED_APPROVALS} }`;
const RESOLUTION_MESSAGE = 'must be { take: "ours" | "theirs" } or { value }';

function invalid(message: string): DocleusError {
  return new DocleusError("change-requests/invalid-request", message);
}

/**
 * Parses `value` and throws `change-requests/invalid-request` with the first
 * problem. Unknown fields are reported before anything else, so a typo in a
 * field name is named even when other fields are also wrong.
 */
function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  fallback?: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const { issues } = result.error;
  const unknown = issues.find((issue) => issue.code === "unrecognized_keys");
  if (unknown) throw invalid(`unknown field "${unknown.keys[0] ?? ""}"`);
  throw invalid(fallback ?? issues[0]?.message ?? "invalid request");
}

const objectError = (name: string) => (issue: { code: string }) =>
  issue.code === "invalid_type" ? `${name} must be an object` : undefined;

const titleSchema = z
  .string({ error: "title must be a string" })
  .trim()
  .min(1, { error: "title must not be empty" })
  .max(MAX_TITLE_LENGTH, {
    error: `title is longer than ${MAX_TITLE_LENGTH} characters`,
  });

const createBodySchema = z.strictObject(
  {
    title: z
      .string({ error: "title must be a string" })
      .optional()
      .transform((title) =>
        title === undefined || title === "" ? DEFAULT_TITLE : title,
      )
      .pipe(titleSchema),
  },
  { error: objectError("body") },
);

const patchBodySchema = z.strictObject(
  {
    title: titleSchema.optional(),
    description: z
      .string({ error: "description must be a string" })
      .max(MAX_DESCRIPTION_LENGTH, {
        error: `description is longer than ${MAX_DESCRIPTION_LENGTH} characters`,
      })
      .optional(),
  },
  { error: objectError("body") },
);

const resolutionSchema = z.union([
  z.strictObject({ take: z.enum(["ours", "theirs"]) }),
  z
    .strictObject({ value: z.unknown() })
    .refine((resolution) => "value" in resolution),
]);

const resolutionsBodySchema = z.strictObject(
  {
    resolutions: z
      .record(z.string(), z.unknown(), {
        error: objectError("resolutions"),
      })
      .transform((resolutions, ctx) => {
        const entries = Object.entries(resolutions);
        if (entries.length > MAX_RESOLUTIONS) {
          ctx.addIssue({ code: "custom", message: "too many resolutions" });
          return z.NEVER;
        }
        const out: Record<string, MergeResolution> = {};
        for (const [id, value] of entries) {
          if (id === "" || id.length > MAX_CONFLICT_ID_LENGTH) {
            ctx.addIssue({ code: "custom", message: "invalid conflict id" });
            return z.NEVER;
          }
          const resolution = resolutionSchema.safeParse(value);
          if (!resolution.success) {
            ctx.addIssue({
              code: "custom",
              message: `resolution "${id}" ${RESOLUTION_MESSAGE}`,
            });
            return z.NEVER;
          }
          out[id] = resolution.data;
        }
        return out;
      }),
  },
  { error: objectError("body") },
);

const workflowShape = {
  mode: z.enum(MODES),
  requiredApprovals: z.number().int().min(0).max(MAX_REQUIRED_APPROVALS),
};
/** Stored settings also carry the level they were set at. */
const storedWorkflowSchema = z.object(workflowShape);
const workflowBodySchema = z.strictObject(
  { workflow: z.union([z.null(), z.strictObject(workflowShape)]) },
  { error: objectError("body") },
);
const storedLevelSchema = z.object({ level: z.enum(["org", "space"]) });

const statusFilterSchema = z
  .enum(STATUS_FILTERS, {
    error: `status must be one of ${STATUS_FILTERS.join(", ")}`,
  })
  .optional()
  .default("active");

const numberSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number);

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DocleusError(
      "change-requests/invalid-request",
      "body is not JSON",
      { cause: error },
    );
  }
}

export function parseCreateBody(body: unknown): { title: string } {
  return parse(createBodySchema, body);
}

export function parsePatchBody(body: unknown): {
  title?: string;
  description?: string;
} {
  return parse(patchBodySchema, body);
}

/** A `MergeResolution`, or `undefined` when `value` is not one. */
export function toResolution(value: unknown): MergeResolution | undefined {
  const result = resolutionSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseResolutionsBody(
  body: unknown,
): Record<string, MergeResolution> {
  return parse(resolutionsBodySchema, body).resolutions;
}

/** `WorkflowSettings`, or `undefined` when `value` is not valid settings. */
export function toWorkflow(value: unknown): WorkflowSettings | undefined {
  const result = storedWorkflowSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** The level stored settings were set at, or `undefined` when unknown. */
export function storedLevelOf(value: unknown): "org" | "space" | undefined {
  const result = storedLevelSchema.safeParse(value);
  return result.success ? result.data.level : undefined;
}

export function parseWorkflowBody(body: unknown): WorkflowSettings | null {
  const isObject = typeof body === "object" && body !== null;
  return parse(
    workflowBodySchema,
    body,
    isObject && !Array.isArray(body) ? WORKFLOW_MESSAGE : undefined,
  ).workflow;
}

export function parseStatusFilter(value: string | null): StatusFilter {
  return parse(
    statusFilterSchema,
    value === null || value === "" ? undefined : value,
  );
}

export function toStatus(value: string): ChangeRequestStatus | undefined {
  const result = z.enum(STATUSES).safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseNumber(value: string | undefined): number {
  const result = numberSchema.safeParse(value);
  if (!result.success) {
    throw new DocleusError(
      "change-requests/not-found",
      `change request "${value ?? ""}" does not exist`,
    );
  }
  return result.data;
}
