import { describe, expect, it } from "vitest";
import { createKeyedSerializer } from "./respond.ts";

interface Gate {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Gate {
  const gate: { promise?: Promise<void>; resolve: () => void } = {
    resolve: () => undefined,
  };
  gate.promise = new Promise<void>((done) => {
    gate.resolve = done;
  });
  return { promise: gate.promise, resolve: () => gate.resolve() };
}

describe("createKeyedSerializer", () => {
  it("runs tasks with the same key one after another", async () => {
    const serial = createKeyedSerializer();
    const order: string[] = [];
    const gate = deferred();
    const first = serial("a", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = serial("a", async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs different keys concurrently", async () => {
    const serial = createKeyedSerializer();
    const gate = deferred();
    const blocked = serial("a", () => gate.promise);
    await expect(serial("b", async () => "b")).resolves.toBe("b");
    gate.resolve();
    await blocked;
  });

  it("keeps going after a task fails and reports the failure to its caller", async () => {
    const serial = createKeyedSerializer();
    const failed = serial("a", async () => {
      throw new Error("boom");
    });
    const next = serial("a", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
