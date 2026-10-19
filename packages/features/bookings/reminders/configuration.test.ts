import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));

import { configuredEventTypes } from "./runtime";

describe("reminder event allowlist", () => {
  it("is disabled by an empty configuration", () => {
    expect(configuredEventTypes("")).toEqual([]);
    expect(configuredEventTypes(" ")).toEqual([]);
  });
  it("allows only configured event IDs, once each", () => {
    expect(configuredEventTypes(" 3, 5, 3 ")).toEqual([3, 5]);
  });
  it("passes the reminder allowlist to the web process through Turbo", () => {
    const directory = mkdtempSync(join(tmpdir(), "booking-reminder-env-"));
    const config = JSON.parse(readFileSync("turbo.json", "utf8"));
    try {
      mkdirSync(join(directory, "apps/web"), { recursive: true });
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "reminder-env-test",
          private: true,
          packageManager: "npm@10.9.3",
          workspaces: ["apps/*"],
        })
      );
      writeFileSync(
        join(directory, "package-lock.json"),
        JSON.stringify({
          name: "reminder-env-test",
          lockfileVersion: 3,
          packages: {
            "": { name: "reminder-env-test", workspaces: ["apps/*"] },
            "apps/web": { name: "@calcom/web" },
          },
        })
      );
      writeFileSync(join(directory, "yarn.lock"), "__metadata:\n  version: 8\n  cacheKey: 10\n");
      writeFileSync(
        join(directory, "turbo.json"),
        JSON.stringify({ ...config, tasks: { start: { ...config.tasks.start, cache: false } } })
      );
      writeFileSync(
        join(directory, "apps/web/package.json"),
        JSON.stringify({ name: "@calcom/web", scripts: { start: "node probe.cjs" } })
      );
      writeFileSync(
        join(directory, "apps/web/probe.cjs"),
        "console.log('reminder-env:' + (process.env.BOOKING_REMINDER_EVENT_TYPE_IDS ?? 'missing'))"
      );
      const result = spawnSync(
        resolve("node_modules/.bin/turbo"),
        ["run", "start", "--filter=@calcom/web", "--env-mode=strict"],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 8000,
          env: { ...process.env, BOOKING_REMINDER_EVENT_TYPE_IDS: "3", TURBO_TELEMETRY_DISABLED: "1" },
        }
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("reminder-env:3");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    "3,",
    "abc",
    "0",
    "-1",
    "3.5",
    "9007199254740992",
  ])("rejects malformed configuration %s", (value) => {
    expect(() => configuredEventTypes(value)).toThrow("Invalid BOOKING_REMINDER_EVENT_TYPE_IDS");
  });
});
