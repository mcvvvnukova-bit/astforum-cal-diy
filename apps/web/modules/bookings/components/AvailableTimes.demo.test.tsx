/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import type { BookerStore } from "@calcom/features/bookings/Booker/store";
import type { Slot } from "@calcom/web/modules/schedules/lib/types";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvailableTimes } from "./AvailableTimes";

const { boundaryState }: { boundaryState: { isEmbed: boolean } } = vi.hoisted(() => ({
  boundaryState: { isEmbed: true },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => boundaryState.isEmbed,
}));

vi.mock("@calcom/trpc/react", () => ({
  trpc: {
    viewer: {
      timezones: {
        cityTimezones: {
          useQuery: () => ({ data: [], isPending: false }),
        },
      },
    },
  },
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    t: (key: string) => key,
  }),
}));

type AvailableTimesProps = ComponentProps<typeof AvailableTimes>;

const targetStore: Partial<BookerStore> = {
  username: "demo",
  eventSlug: "60min",
  state: "selecting_time",
  timezone: "Europe/Moscow",
};

const event: AvailableTimesProps["event"] = {
  data: { length: 60, metadata: {}, price: 0, currency: "USD", bookingFields: [] },
};

const renderAvailableTimes = ({
  store = {},
  loadingStates = { creatingBooking: false, creatingRecurringBooking: false },
  confirmButtonDisabled = false,
}: {
  store?: Partial<BookerStore>;
  loadingStates?: AvailableTimesProps["loadingStates"];
  confirmButtonDisabled?: boolean;
} = {}) =>
  render(
    <AvailableTimes
      slots={[{ time: "2026-09-08T09:00:00.000Z", showConfirmButton: true } as Slot]}
      event={event}
      onTimeSelect={vi.fn()}
      confirmStepClassNames={{ confirmButton: "caller-confirm" }}
      loadingStates={loadingStates}
      confirmButtonDisabled={confirmButtonDisabled}
      renderConfirmNotVerifyEmailButtonCond
    />,
    { mockStore: { ...targetStore, ...store } }
  );

describe("demo available time primary action presentation", () => {
  beforeEach(() => {
    boundaryState.isEmbed = true;
  });

  it("adds the scoped action class only to the target confirmation and preserves its caller class", () => {
    renderAvailableTimes();

    const confirm = screen.getByTestId("skip-confirm-book-button");
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(screen.getByTestId("time").className).not.toMatch(/primaryAction/);
  });

  it.each([
    { label: "the direct target event", isEmbed: false, store: {} },
    { label: "another embedded event", isEmbed: true, store: { eventSlug: "30min" } },
    { label: "another embedded username", isEmbed: true, store: { username: "other" } },
  ])("does not add the scoped action class for $label", ({ isEmbed, store }) => {
    boundaryState.isEmbed = isEmbed;
    renderAvailableTimes({ store });

    expect(screen.getByTestId("skip-confirm-book-button").className).not.toMatch(/primaryAction/);
  });

  it("keeps the target confirmation disabled while applying the scoped action class", () => {
    renderAvailableTimes({
      confirmButtonDisabled: true,
    });

    const confirm = screen.getByTestId("skip-confirm-book-button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(confirm.querySelector("svg.animate-spin")).not.toBeInTheDocument();
  });

  it("shows a loading spinner for the target confirmation while applying the scoped action class", () => {
    renderAvailableTimes({
      store: { selectedTimeslot: "2026-09-08T09:00:00.000Z" },
      loadingStates: { creatingBooking: true, creatingRecurringBooking: false },
    });

    const confirm = screen.getByTestId("skip-confirm-book-button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveClass("caller-confirm");
    expect(confirm.className).toMatch(/primaryAction/);
    expect(confirm.querySelector("svg.animate-spin")).toBeInTheDocument();
  });
});
