import type { Context, Scope, SpaceRole } from "@docleus/sdk";
import { PLUGIN_NAME } from "../src/shared/index.ts";
import { createChangeRequestsPlugin } from "../src/server/index.ts";
import { createInstance as createServerInstance } from "@docleus/server";
import { testStorageLocation } from "@docleus/testing";

const ORIGIN = "http://docleus.test";

export interface Instance {
  readonly ctx: Context;
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
}

// In-memory SQLite, or a fresh Postgres database dropped after the test
// when DOCLEUS_TEST_POSTGRES_URL is set.
async function createInstance(): Promise<Instance> {
  return createServerInstance({ database: await testStorageLocation() });
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export interface Client {
  readonly userId: string;
  call(method: string, path: string, body?: unknown): Promise<Response>;
  /** Throws unless the response is 2xx. */
  json<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface Fixture {
  readonly instance: Instance;
  readonly orgId: string;
  readonly spaceId: string;
  /** `/api/orgs/:orgId/spaces/:spaceId`. */
  readonly space: string;
  /** The org owner: `manage` on the space. */
  readonly owner: Client;
  /** Space editors. */
  readonly alice: Client;
  readonly bob: Client;
  /** Space viewer. */
  readonly vera: Client;
  createUser(name: string, role: SpaceRole | undefined): Promise<Client>;
  /** Creates another space in the org, with the plugin enabled unless `isEnabled` is false. */
  createSpace(slug: string, isEnabled?: boolean): Promise<string>;
  dispose(): Promise<void>;
}

function clientOf(instance: Instance, userId: string, token: string): Client {
  const call = (method: string, path: string, body?: unknown) =>
    instance.fetch(
      new Request(new URL(path, ORIGIN), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  return {
    userId,
    call,
    async json<T>(method: string, path: string, body?: unknown) {
      const response = await call(method, path, body);
      if (!response.ok) {
        throw new Error(
          `${method} ${path}: ${response.status} ${await response.text()}`,
        );
      }
      return (await response.json()) as T;
    },
  };
}

/**
 * A real instance with this plugin mounted, installed and enabled for one
 * org, and an org owner, two space editors and a space viewer.
 */
export async function setUp(): Promise<Fixture> {
  const instance = await createInstance();
  let tick = 1_000;
  const fiber = await instance.ctx.plugin(
    createChangeRequestsPlugin({ now: () => tick++ }),
  );
  await instance.ctx.installations.install(PLUGIN_NAME);

  const org = await instance.ctx.content.createOrg({
    slug: "acme",
    name: "Acme",
  });
  const orgScope: Scope = { kind: "org", orgId: org.id };
  await instance.ctx.installations.setEnabled(PLUGIN_NAME, orgScope, true);

  async function createSpace(slug: string, isEnabled = true) {
    const space = await instance.ctx.content.createSpace({
      orgId: org.id,
      slug,
      name: slug,
    });
    if (!isEnabled) {
      await instance.ctx.installations.setEnabled(
        PLUGIN_NAME,
        { kind: "space", orgId: org.id, spaceId: space.id },
        false,
      );
    }
    return space.id;
  }

  const spaceId = await createSpace("docs");

  async function createUser(name: string, role: SpaceRole | undefined) {
    const user = await instance.ctx.identity.createUser({
      email: `${name.toLowerCase()}@example.com`,
      name,
    });
    if (role !== undefined) {
      await instance.ctx.authz.grant(
        user.id,
        { kind: "space", orgId: org.id, spaceId },
        role,
      );
    }
    const token = await instance.ctx.identity.createSession(user.id);
    return clientOf(instance, user.id, token);
  }

  const owner = await createUser("Owner", undefined);
  await instance.ctx.authz.grant(owner.userId, orgScope, "owner");

  return {
    instance,
    orgId: org.id,
    spaceId,
    space: `/api/orgs/${org.id}/spaces/${spaceId}`,
    owner,
    alice: await createUser("Alice", "editor"),
    bob: await createUser("Bob", "editor"),
    vera: await createUser("Vera", "viewer"),
    createUser,
    createSpace,
    async dispose() {
      await fiber.dispose();
      await instance.dispose();
    },
  };
}

export async function errorOf(response: Response): Promise<{
  status: number;
  body: ApiError & Record<string, unknown>;
}> {
  return {
    status: response.status,
    body: (await response.json()) as ApiError & Record<string, unknown>,
  };
}
