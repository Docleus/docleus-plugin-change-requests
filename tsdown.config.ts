import { defineConfig } from "tsdown";

const common = {
  format: "esm",
  dts: false,
  outExtensions: () => ({ js: ".js" }),
} as const;

/** Provided by the host's import map; never bundled. */
const HOST_MODULES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "@docleus/sdk",
];

export default defineConfig([
  {
    ...common,
    entry: { "server/index": "src/server/index.ts" },
    clean: ["dist/server", "dist/*.js"],
  },
  {
    // A browser build of its own, so its chunks stay inside `dist/editor`,
    // the browser root the host serves.
    ...common,
    entry: { index: "src/editor/index.ts" },
    outDir: "dist/editor",
    platform: "browser",
    external: HOST_MODULES,
    clean: true,
  },
]);
