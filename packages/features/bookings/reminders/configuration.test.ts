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
