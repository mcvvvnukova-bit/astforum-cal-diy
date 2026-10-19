/**
 * @vitest-environment jsdom
 */

import { render } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeFormatToggle } from "./TimeFormatToggle";

const { embedState }: { embedState: { isEmbed: boolean } } = vi.hoisted(() => ({
  embedState: { isEmbed: false },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => embedState.isEmbed,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

describe("TimeFormatToggle demo widget presentation", () => {
  beforeEach(() => {
    embedState.isEmbed = false;
  });

  it("does not render for the embedded demo/60min flow", () => {
    embedState.isEmbed = true;

    render(<TimeFormatToggle />, {
      mockStore: { username: "demo", eventSlug: "60min" },
    });

    expect(screen.queryByLabelText("time_format")).not.toBeInTheDocument();
  });

  it.each([
    ["the same event outside an embed", false, "demo", "60min"],
    ["another embedded event", true, "demo", "30min"],
  ])("renders for %s", (_name, isEmbed, username, eventSlug) => {
    embedState.isEmbed = isEmbed;

    render(<TimeFormatToggle />, {
      mockStore: { username, eventSlug },
    });

    expect(screen.getByLabelText("time_format")).toBeInTheDocument();
  });
});
