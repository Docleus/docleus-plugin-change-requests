import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChangeRequest, ChangeRequestState } from "../shared/index.ts";
import { createApi, type Api, type ChangeRequestDetail } from "./api.ts";

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export type Handler = (call: Call) => { status?: number; body?: unknown };

/**
 * A DOM container plus an {@link Api} answering from registered routes
 * (unknown routes answer 404). Create one per test and dispose it after.
 */
export interface TestDom {
  readonly api: Api;
  readonly calls: Call[];
  readonly container: HTMLElement;
  route(method: string, path: string, handler: Handler): void;
  render(node: ReactNode): Promise<void>;
  waitFor<T>(find: () => T | null | undefined | false): Promise<T>;
  button(name: string, within?: ParentNode): HTMLButtonElement | undefined;
  buttons(within?: ParentNode): string[];
  click(element: HTMLElement): Promise<void>;
  type(
    element: HTMLTextAreaElement | HTMLInputElement,
    value: string,
  ): Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

const textOf = (element: Element) => (element.textContent ?? "").trim();

export function createTestDom(): TestDom {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const calls: Call[] = [];
  const routes = new Map<string, Handler>();
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;

  const api = createApi({
    async request(path, init = {}) {
      const method = init.method ?? "GET";
      const body =
        typeof init.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      const call = { method, path, body };
      calls.push(call);
      const handler = routes.get(`${method} ${path}`);
      const result = handler
        ? handler(call)
        : { status: 404, body: { code: "test/no-route", message: path } };
      return new Response(JSON.stringify(result.body ?? {}), {
        status: result.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  return {
    api,
    calls,
    container,
    route(method, path, handler) {
      routes.set(`${method} ${path}`, handler);
    },
    async render(node) {
      root ??= createRoot(container);
      const current = root;
      await act(async () => current.render(node));
      await flush();
    },
    async waitFor(find) {
      for (let i = 0; i < 50; i++) {
        const found = find();
        if (found) return found;
        await flush();
      }
      throw new Error(`not found; DOM: ${container.innerHTML}`);
    },
    button(name, within = container) {
      return [...within.querySelectorAll("button")].find(
        (button) => textOf(button) === name,
      );
    },
    buttons(within = container) {
      return [...within.querySelectorAll("button")].map(textOf);
    },
    async click(element) {
      await act(async () => element.click());
      await flush();
    },
    async type(element, value) {
      await act(async () => {
        const prototype = Object.getPrototypeOf(element) as object;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await flush();
    },
    flush,
    async dispose() {
      const current = root;
      if (current) await act(async () => current.unmount());
      container.remove();
    },
  };
}

/** A change request answer as `GET .../change-requests/:number` returns it. */
export function detailFixture(
  changeRequest: Partial<ChangeRequest> = {},
  state: Partial<ChangeRequestState> = {},
): ChangeRequestDetail {
  const number = changeRequest.number ?? 1;
  return {
    changeRequest: {
      spaceId: "s1",
      number,
      title: "Fix the intro",
      description: "",
      status: "draft",
      author: "u1",
      authorName: "Ada",
      branch: `cr/${number}`,
      createdAt: 0,
      updatedAt: 0,
      mergedAt: undefined,
      mergedBy: undefined,
      mergedRevision: undefined,
      approvals: [],
      ...changeRequest,
    },
    state: {
      isBehind: false,
      conflicts: 0,
      requiredApprovals: 0,
      checks: [],
      canMerge: true,
      canApprove: false,
      canEdit: true,
      ...state,
    },
  };
}
