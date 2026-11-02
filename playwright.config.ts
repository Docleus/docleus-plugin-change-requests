import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4321;
const bundle = fileURLToPath(new URL("tests/e2e/bundle.yaml", import.meta.url));
const data = mkdtempSync(join(tmpdir(), "docleus-cr-e2e-"));

// The server loads the built app and the built plugins of every repository
// in the bundle, so the command builds them first.
const command = [
  "pnpm --dir ../docleus-core build",
  "pnpm --dir ../docleus-plugin-editor build",
  "pnpm --dir ../docleus-plugin-blocks-commonmark build",
  "pnpm build",
  `pnpm --dir ../docleus-core docleus serve --dev --bundle ${bundle} --data ${data} --port ${PORT}`,
].join(" && ");

export default defineConfig({
  testDir: "tests/e2e",
  // Traces stay out of the repository, which does not ignore test-results/.
  outputDir: join(data, "test-results"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command,
    url: `http://127.0.0.1:${PORT}/api/auth/methods`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
