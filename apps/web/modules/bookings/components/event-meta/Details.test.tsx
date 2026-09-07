/**
 * @vitest-environment jsdom
 */

import { render } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventDetails } from "./Details";

const { embedState }: { embedState: { isEmbed: boolean } } = vi.hoisted(() => ({
  embedState: { isEmbed: false },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => embedState.isEmbed,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string, values?: { count?: number }) => {
      if (key === "hour_one_short") return `${values?.count ?? 1}h`;
      return key;
    },
  }),
}));

const event = Object.freeze({
  currency: "USD",
  price: 0,
  locations: Object.freeze([Object.freeze({ type: "integrations:daily" })]),
  enablePerHostLocations: false,
  requiresConfirmation: true,
  recurringEvent: null,
  length: 60,
  metadata: Object.freeze({}),
  isDynamic: false,
}) as unknown as BookerEvent;

describe("EventDetails demo widget presentation", () => {
  beforeEach(() => {
    embedState.isEmbed = false;
  });

  it("omits confirmation and location while preserving duration for embedded demo/60min", () => {
    embedState.isEmbed = true;

    render(
      <TooltipProvider>
        <EventDetails event={event} />
      </TooltipProvider>,
      {
        mockStore: { username: "demo", eventSlug: "60min" },
      }
    );

    expect(screen.queryByText("requires_confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Cal Video")).not.toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
  });

  it("preserves confirmation, location, and duration outside the target flow", () => {
    render(
      <TooltipProvider>
        <EventDetails event={event} />
      </TooltipProvider>,
      {
        mockStore: { username: "demo", eventSlug: "60min" },
      }
    );

    expect(screen.getByText("requires_confirmation")).toBeInTheDocument();
    expect(screen.getByText("Cal Video")).toBeInTheDocument();
    expect(screen.getByText("1h")).toBeInTheDocument();
  });
});
