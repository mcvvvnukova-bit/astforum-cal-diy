import { describe, expect, it } from "vitest";
import { getRescheduleLocation } from "./getRescheduleLocation";

describe("getRescheduleLocation", () => {
  it("keeps the saved conference URL when the booking response selects the same provider", () => {
    expect(
      getRescheduleLocation("integrations:jitsi", {
        optionValue: "integrations:jitsi",
        value: "",
      })
    ).toBeUndefined();
  });

  it("previews a different location selected while rescheduling", () => {
    expect(
      getRescheduleLocation("integrations:jitsi", {
        optionValue: "integrations:zoom",
        value: "",
      })
    ).toBe("integrations:zoom");
  });

  it.each([
    null,
    undefined,
    "integrations:jitsi",
    {},
    { optionValue: null },
  ])("does not override the saved location for an absent or invalid response: %j", (responseLocation) => {
    expect(getRescheduleLocation("integrations:jitsi", responseLocation)).toBeUndefined();
  });
});
