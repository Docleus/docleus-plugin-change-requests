import type { Kysely } from "kysely";
import { DocleusError, type Context, type MergeResolution } from "@docleus/sdk";
import {
  PLUGIN_NAME,
  branchOf,
  type Approval,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "../shared/index.ts";
import {
  changeRequestMigrations,
  type ChangeRequestSchema,
  type ChangeRequestsTable,
} from "./schema.ts";
import { toResolution, toStatus } from "./validate.ts";

/** An approval with the branch head it was given for. */
export interface StoredApproval extends Approval {
  readonly head: string | null;
}

export interface NewChangeRequest {
  readonly spaceId: string;
  readonly title: string;
  readonly author: string;
  readonly authorName: string;
}

/** A change request with what the plugin keeps beside it. */
export interface StoredChangeRequest extends ChangeRequest {
  /** Every approval, including those given for an earlier head. */
  readonly approvals: readonly StoredApproval[];
  /** Once merged or closed: the branch's base and head at that moment. */
  readonly final:
    { base: string | undefined; head: string | undefined } | undefined;
}

export interface ChangeRequestPatch {
  readonly title?: string;
  readonly description?: string;
  readonly status?: ChangeRequestStatus;
  readonly mergedAt?: number;
  readonly mergedBy?: string;
  readonly mergedRevision?: string;
  readonly final?: { base: string | undefined; head: string | undefined };
}

export interface ListFilter {
  readonly statuses: readonly ChangeRequestStatus[] | undefined;
}

/** The plugin's own tables. Rows are validated when read back. */
export interface ChangeRequestStore {
  /** Allocates the next number of the space. Callers serialize per space. */
  create(input: NewChangeRequest): Promise<StoredChangeRequest>;
  /** Removes a change request that never got its branch. */
  discard(spaceId: string, number: number): Promise<void>;
  get(
    spaceId: string,
    number: number,
  ): Promise<StoredChangeRequest | undefined>;
  /** Newest first. */
  list(spaceId: string, filter: ListFilter): Promise<StoredChangeRequest[]>;
  update(
    spaceId: string,
    number: number,
    patch: ChangeRequestPatch,
  ): Promise<StoredChangeRequest>;
  /** Replaces the caller's earlier approval, if any. */
  approve(
    spaceId: string,
    number: number,
    approval: StoredApproval,
  ): Promise<void>;
  withdraw(spaceId: string, number: number, userId: string): Promise<void>;
  resolutions(
    spaceId: string,
    number: number,
  ): Promise<Record<string, MergeResolution>>;
  setResolutions(
    spaceId: string,
    number: number,
    resolutions: Readonly<Record<string, MergeResolution>>,
  ): Promise<void>;
}

function notFound(number: number): DocleusError {
  return new DocleusError(
    "change-requests/not-found",
    `change request #${number} does not exist`,
  );
}

export function createChangeRequestStore(
  ctx: Context,
  now: () => number,
): ChangeRequestStore {
  const db = ctx.storage.db as unknown as Kysely<ChangeRequestSchema>;
  const ready = ctx.storage.migrate(PLUGIN_NAME, changeRequestMigrations);
  const logger = ctx.logger("change-requests");

  async function approvalsOf(
    spaceId: string,
    numbers: readonly number[],
  ): Promise<Map<number, StoredApproval[]>> {
    const out = new Map<number, StoredApproval[]>();
    if (numbers.length === 0) return out;
    const rows = await db
      .selectFrom("change_request_approvals")
      .selectAll()
      .where("space_id", "=", spaceId)
      .where("number", "in", numbers)
      .orderBy("at")
      .orderBy("user_id")
      .execute();
    for (const row of rows) {
      const list = out.get(row.number) ?? [];
      list.push({
        userId: row.user_id,
        name: row.name,
        at: row.at,
        head: row.head,
      });
      out.set(row.number, list);
    }
    return out;
  }

  function toChangeRequest(
    row: ChangeRequestsTable,
    approvals: readonly StoredApproval[],
  ): StoredChangeRequest | undefined {
    const status = toStatus(row.status);
    if (status === undefined) {
      logger.warn(
        "change request #%d of space %s has an invalid status %s",
        row.number,
        row.space_id,
        row.status,
      );
      return undefined;
    }
    return {
      spaceId: row.space_id,
      number: row.number,
      title: row.title,
      description: row.description,
      status,
      author: row.author,
      authorName: row.author_name,
      branch: branchOf(row.number),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      mergedAt: row.merged_at ?? undefined,
      mergedBy: row.merged_by ?? undefined,
      mergedRevision: row.merged_revision ?? undefined,
      approvals,
      final:
        row.status === "merged" || row.status === "closed"
          ? {
              base: row.final_base ?? undefined,
              head: row.final_head ?? undefined,
            }
          : undefined,
    };
  }

  async function get(spaceId: string, number: number) {
    await ready;
    const row = await db
      .selectFrom("change_requests")
      .selectAll()
      .where("space_id", "=", spaceId)
      .where("number", "=", number)
      .executeTakeFirst();
    if (!row) return undefined;
    const approvals = await approvalsOf(spaceId, [number]);
    return toChangeRequest(row, approvals.get(number) ?? []);
  }

  async function mustGet(spaceId: string, number: number) {
    const found = await get(spaceId, number);
    if (!found) throw notFound(number);
    return found;
  }

  return {
    async create(input) {
      await ready;
      const at = now();
      const number = await ctx.storage.transaction(async (trx) => {
        const typed = trx as unknown as Kysely<ChangeRequestSchema>;
        const last = await typed
          .selectFrom("change_requests")
          .select((eb) => eb.fn.max("number").as("last"))
          .where("space_id", "=", input.spaceId)
          .executeTakeFirst();
        const next = Number(last?.last ?? 0) + 1;
        await typed
          .insertInto("change_requests")
          .values({
            space_id: input.spaceId,
            number: next,
            title: input.title,
            description: "",
            status: "draft",
            author: input.author,
            author_name: input.authorName,
            created_at: at,
            updated_at: at,
            merged_at: null,
            merged_by: null,
            merged_revision: null,
            final_base: null,
            final_head: null,
          })
          .execute();
        return next;
      });
      return mustGet(input.spaceId, number);
    },

    async discard(spaceId, number) {
      await ready;
      await db
        .deleteFrom("change_requests")
        .where("space_id", "=", spaceId)
        .where("number", "=", number)
        .execute();
    },

    get,

    async list(spaceId, filter) {
      await ready;
      let query = db
        .selectFrom("change_requests")
        .selectAll()
        .where("space_id", "=", spaceId);
      if (filter.statuses !== undefined) {
        if (filter.statuses.length === 0) return [];
        query = query.where("status", "in", filter.statuses);
      }
      const rows = await query.orderBy("number", "desc").execute();
      const approvals = await approvalsOf(
        spaceId,
        rows.map((row) => row.number),
      );
      return rows.flatMap((row) => {
        const found = toChangeRequest(row, approvals.get(row.number) ?? []);
        return found ? [found] : [];
      });
    },

    async update(spaceId, number, patch) {
      await ready;
      await db
        .updateTable("change_requests")
        .set({
          updated_at: now(),
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.description !== undefined && {
            description: patch.description,
          }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.mergedAt !== undefined && { merged_at: patch.mergedAt }),
          ...(patch.mergedBy !== undefined && { merged_by: patch.mergedBy }),
          ...(patch.mergedRevision !== undefined && {
            merged_revision: patch.mergedRevision,
          }),
          ...(patch.final !== undefined && {
            final_base: patch.final.base ?? null,
            final_head: patch.final.head ?? null,
          }),
        })
        .where("space_id", "=", spaceId)
        .where("number", "=", number)
        .execute();
      return mustGet(spaceId, number);
    },

    async approve(spaceId, number, approval) {
      await ready;
      await db
        .insertInto("change_request_approvals")
        .values({
          space_id: spaceId,
          number,
          user_id: approval.userId,
          name: approval.name,
          at: approval.at,
          head: approval.head,
        })
        .onConflict((oc) =>
          oc.columns(["space_id", "number", "user_id"]).doUpdateSet({
            name: approval.name,
            at: approval.at,
            head: approval.head,
          }),
        )
        .execute();
    },

    async withdraw(spaceId, number, userId) {
      await ready;
      await db
        .deleteFrom("change_request_approvals")
        .where("space_id", "=", spaceId)
        .where("number", "=", number)
        .where("user_id", "=", userId)
        .execute();
    },

    async resolutions(spaceId, number) {
      await ready;
      const rows = await db
        .selectFrom("change_request_resolutions")
        .selectAll()
        .where("space_id", "=", spaceId)
        .where("number", "=", number)
        .orderBy("conflict_id")
        .execute();
      const out: Record<string, MergeResolution> = {};
      for (const row of rows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.json);
        } catch {
          parsed = undefined;
        }
        const resolution = toResolution(parsed);
        if (resolution) {
          out[row.conflict_id] = resolution;
        } else {
          logger.warn(
            "ignoring an invalid stored resolution %s of change request #%d",
            row.conflict_id,
            number,
          );
        }
      }
      return out;
    },

    async setResolutions(spaceId, number, resolutions) {
      await ready;
      await ctx.storage.transaction(async (trx) => {
        const typed = trx as unknown as Kysely<ChangeRequestSchema>;
        await typed
          .deleteFrom("change_request_resolutions")
          .where("space_id", "=", spaceId)
          .where("number", "=", number)
          .execute();
        const rows = Object.entries(resolutions).map(([id, resolution]) => ({
          space_id: spaceId,
          number,
          conflict_id: id,
          json: JSON.stringify(resolution),
        }));
        // Batches stay under SQLite's bound-parameter limit.
        for (let i = 0; i < rows.length; i += 200) {
          await typed
            .insertInto("change_request_resolutions")
            .values(rows.slice(i, i + 200))
            .execute();
        }
      });
    },
  };
}
