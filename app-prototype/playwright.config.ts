import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4000",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
