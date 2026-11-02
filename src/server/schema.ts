import type { Kysely } from "kysely";
import type { Migration } from "@docleus/sdk";

export interface ChangeRequestsTable {
  space_id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  author: string;
  author_name: string;
  created_at: number;
  updated_at: number;
  merged_at: number | null;
  merged_by: string | null;
  merged_revision: string | null;
  /** Once merged or closed, the branch base and head at that moment (the branch itself is deleted). */
  final_base: string | null;
  final_head: string | null;
}

export interface ApprovalsTable {
  space_id: string;
  number: number;
  user_id: string;
  name: string;
  at: number;
  /** The branch head the approval was given for; `null` for approvals from before 0002. */
  head: string | null;
}

/** One stored conflict resolution; `json` is a `MergeResolution`. */
export interface ResolutionsTable {
  space_id: string;
  number: number;
  conflict_id: string;
  json: string;
}

export interface ChangeRequestSchema {
  change_requests: ChangeRequestsTable;
  change_request_approvals: ApprovalsTable;
  change_request_resolutions: ResolutionsTable;
}

export const changeRequestMigrations: readonly Migration[] = [
  {
    id: "0001-create-tables",
    async up(db: Kysely<unknown>) {
      const typed = db as unknown as Kysely<ChangeRequestSchema>;
      await typed.schema
        .createTable("change_requests")
        .addColumn("space_id", "text", (c) => c.notNull())
        .addColumn("number", "integer", (c) => c.notNull())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("description", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("author", "text", (c) => c.notNull())
        .addColumn("author_name", "text", (c) => c.notNull())
        .addColumn("created_at", "integer", (c) => c.notNull())
        .addColumn("updated_at", "integer", (c) => c.notNull())
        .addColumn("merged_at", "integer")
        .addColumn("merged_by", "text")
        .addColumn("merged_revision", "text")
        .addColumn("final_base", "text")
        .addColumn("final_head", "text")
        .addPrimaryKeyConstraint("change_requests_pk", ["space_id", "number"])
        .execute();
      await typed.schema
        .createTable("change_request_approvals")
        .addColumn("space_id", "text", (c) => c.notNull())
        .addColumn("number", "integer", (c) => c.notNull())
        .addColumn("user_id", "text", (c) => c.notNull())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("at", "integer", (c) => c.notNull())
        .addPrimaryKeyConstraint("change_request_approvals_pk", [
          "space_id",
          "number",
          "user_id",
        ])
        .execute();
      await typed.schema
        .createTable("change_request_resolutions")
        .addColumn("space_id", "text", (c) => c.notNull())
        .addColumn("number", "integer", (c) => c.notNull())
        .addColumn("conflict_id", "text", (c) => c.notNull())
        .addColumn("json", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("change_request_resolutions_pk", [
          "space_id",
          "number",
          "conflict_id",
        ])
        .execute();
    },
  },
  {
    id: "0002-approval-head",
    async up(db: Kysely<unknown>) {
      const typed = db as unknown as Kysely<ChangeRequestSchema>;
      await typed.schema
        .alterTable("change_request_approvals")
        .addColumn("head", "text")
        .execute();
    },
  },
];
