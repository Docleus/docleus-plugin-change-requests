// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createEditBranchResolver } from "./resolver.ts";
import { createTestDom, type TestDom } from "./test-dom.ts";

const SPACE = "/api/orgs/o1/spaces/s1";
const context = { orgId: "o1", spaceId: "s1", entryId: "p1" };

let dom: TestDom;
afterEach(() => dom.dispose());

describe("edit branch resolver", () => {
  it("leaves writes on main in direct mode", async () => {
    dom = createTestDom();
    dom.route("GET", `${SPACE}/change-request-workflow`, () => ({
      body: {
        workflow: { mode: "direct", requiredApprovals: 0 },
        inherited: true,
      },
    }));
    const resolve = createEditBranchResolver(dom.api);
    expect(await resolve(context)).toBeUndefined();
    expect(dom.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("creates a draft change request and returns its branch", async () => {
    dom = createTestDom();
    dom.route("GET", `${SPACE}/change-request-workflow`, () => ({
      body: {
        workflow: { mode: "change-requests", requiredApprovals: 0 },
        inherited: true,
      },
    }));
    dom.route("GET", "/api/me", () => ({ body: { user: { id: "u1" } } }));
    dom.route("GET", `${SPACE}/change-requests?status=draft`, () => ({
      body: {
        changeRequests: [
          { number: 2, branch: "cr/2", author: "u2", updatedAt: 1 },
        ],
      },
    }));
    dom.route("POST", `${SPACE}/change-requests`, () => ({
      status: 201,
      body: { changeRequest: { number: 3, branch: "cr/3" } },
    }));
    const resolve = createEditBranchResolver(dom.api);
    expect(await resolve(context)).toBe("cr/3");
    expect(dom.calls.at(-1)).toMatchObject({
      method: "POST",
      path: `${SPACE}/change-requests`,
    });
  });

  it("resumes the user's latest draft instead of starting another", async () => {
    dom = createTestDom();
    dom.route("GET", `${SPACE}/change-request-workflow`, () => ({
      body: {
        workflow: { mode: "change-requests", requiredApprovals: 0 },
        inherited: true,
      },
    }));
    dom.route("GET", "/api/me", () => ({ body: { user: { id: "u1" } } }));
    dom.route("GET", `${SPACE}/change-requests?status=draft`, () => ({
      body: {
        changeRequests: [
          { number: 4, branch: "cr/4", author: "u1", updatedAt: 1 },
          { number: 5, branch: "cr/5", author: "u1", updatedAt: 9 },
        ],
      },
    }));
    const resolve = createEditBranchResolver(dom.api);
    expect(await resolve(context)).toBe("cr/5");
    expect(dom.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("rejects with the server's error", async () => {
    dom = createTestDom();
    dom.route("GET", `${SPACE}/change-request-workflow`, () => ({
      status: 403,
      body: { code: "api/forbidden", message: "no write access" },
    }));
    const resolve = createEditBranchResolver(dom.api);
    await expect(resolve(context)).rejects.toMatchObject({
      code: "api/forbidden",
      message: "no write access",
    });
  });
});
