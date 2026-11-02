// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ChecksList } from "./checks-list.tsx";
import { createTestDom, type TestDom } from "./test-dom.ts";

let dom: TestDom;
afterEach(async () => {
  await dom.dispose();
});

describe("ChecksList", () => {
  it("lists each check with its status, link and summary", async () => {
    dom = createTestDom();
    await dom.render(
      createElement(ChecksList, {
        checks: [
          {
            name: "acme.lint",
            title: "Lint",
            status: "success",
            isRequired: true,
            url: "https://ci.example.com/1",
          },
          {
            name: "acme.spell",
            title: "Spelling",
            status: "failure",
            isRequired: false,
            summary: "2 typos",
          },
        ],
      }),
    );
    const items = [...dom.container.querySelectorAll("li")].map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "Passed Lint (required)",
      "Failed Spelling – 2 typos",
    ]);
    expect(dom.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://ci.example.com/1",
    );
  });

  it("says when no check was reported", async () => {
    dom = createTestDom();
    await dom.render(createElement(ChecksList, { checks: [] }));
    expect(dom.container.textContent).toBe("No checks reported.");
  });
});
