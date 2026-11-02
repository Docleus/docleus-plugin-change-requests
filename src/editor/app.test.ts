import { describe, expect, it } from "vitest";
import { parseAppPath, parseViewQuery } from "./app.tsx";
import { appHref } from "./navigation.tsx";

describe("parseAppPath", () => {
  it("parses the list, detail and conflict routes", () => {
    expect(parseAppPath("o1/s1")).toEqual({
      view: "list",
      orgId: "o1",
      spaceId: "s1",
    });
    expect(parseAppPath("o1/s1/12")).toEqual({
      view: "detail",
      orgId: "o1",
      spaceId: "s1",
      number: 12,
    });
    expect(parseAppPath("o1/s1/12/conflicts")).toEqual({
      view: "conflicts",
      orgId: "o1",
      spaceId: "s1",
      number: 12,
    });
  });

  it("rejects other paths", () => {
    for (const path of [
      "",
      "o1",
      "o1/s1/0",
      "o1/s1/x",
      "o1/s1/1/other",
      "o1/s1/1/conflicts/x",
      "%E0/s1",
    ]) {
      expect(parseAppPath(path)).toBeUndefined();
    }
  });
});

describe("parseViewQuery", () => {
  const space = { orgId: "o1", spaceId: "s1" };
  it("reads the list, a change request and its conflicts from the query", () => {
    expect(parseViewQuery(space, "?view=change-requests.requests")).toEqual({
      view: "list",
      ...space,
    });
    expect(parseViewQuery(space, "?view=x&cr=12")).toEqual({
      view: "detail",
      ...space,
      number: 12,
    });
    expect(parseViewQuery(space, "?cr=12&conflicts=1")).toEqual({
      view: "conflicts",
      ...space,
      number: 12,
    });
    expect(parseViewQuery(space, "?cr=0")).toBeUndefined();
  });

  it("links into the space so its tree stays in the sidebar", () => {
    expect(appHref(space, 12, "conflicts")).toBe(
      "/orgs/o1/spaces/s1?view=change-requests.requests&cr=12&conflicts=1",
    );
  });
});
