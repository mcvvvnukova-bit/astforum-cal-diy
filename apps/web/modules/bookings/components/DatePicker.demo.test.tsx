/**
 * @vitest-environment jsdom
 */

import { BookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { createBookerStore } from "@calcom/features/bookings/Booker/store";
import { BookerLayouts } from "@calcom/prisma/zod-utils";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

const { embedState }: { embedState: { isEmbed: boolean } } = vi.hoisted(() => ({
  embedState: { isEmbed: true },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useEmbedStyles: () => ({}),
  useIsEmbed: () => embedState.isEmbed,
  useSlotsViewOnSmallScreen: () => false,
}));

vi.mock("@calcom/lib/hooks/useLocale", () => ({
  useLocale: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));

const slots = {
  "2026-09-08": [{ time: "2026-09-08T09:00:00.000Z" }],
  "2026-09-10": [{ time: "2026-09-10T09:00:00.000Z" }],
};

const getDay = (day: string) => screen.getByText(day, { selector: 'button[data-testid="day"]' });

const renderDatePicker = ({
  isEmbed = true,
  username = "demo",
  eventSlug = "60min",
}: {
  isEmbed?: boolean;
  username?: string;
  eventSlug?: string;
} = {}) => {
  embedState.isEmbed = isEmbed;
  const store = createBookerStore();
  const onDateChange = vi.fn();
  store.setState({
    eventSlug,
    layout: BookerLayouts.MONTH_VIEW,
    month: "2026-09",
    selectedDate: "2026-09-08",
    username,
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <BookerStoreContext.Provider value={store}>{children}</BookerStoreContext.Provider>
  );

  const result = render(
    <DatePicker
      classNames={{ datePickerContainer: "caller-calendar" }}
      event={{}}
      isLoading={false}
      onDateChange={onDateChange}
      slots={slots}
    />,
    { wrapper: Wrapper }
  );

  return { ...result, onDateChange, store };
};

describe("demo DatePicker selected-day presentation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
    embedState.isEmbed = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scopes the selected-day calendar to the demo embed and moves selection through the real Booker store", () => {
    const { container, onDateChange, store } = renderDatePicker();
    const calendar = container.querySelector(".caller-calendar");
    const selectedDay = getDay("8");
    const otherAvailableDay = getDay("10");
    const unavailableDay = getDay("9");
    const todayMarker = screen.getByText("today").parentElement;

    expect(calendar).toHaveClass("caller-calendar");
    expect(calendar?.className).toMatch(/selectedDayCalendar/);
    // The scoped selector relies on the shared calendar marking only selected day buttons this way.
    expect(selectedDay).toHaveClass("bg-brand-default");
    expect(otherAvailableDay).not.toHaveClass("bg-brand-default");
    expect(unavailableDay).toBeDisabled();
    expect(todayMarker).toHaveClass("bg-brand-accent");

    fireEvent.click(otherAvailableDay);

    expect(store.getState().selectedDate).toBe("2026-09-10");
    expect(onDateChange).toHaveBeenCalledOnce();
    expect(selectedDay).not.toHaveClass("bg-brand-default");
    expect(otherAvailableDay).toHaveClass("bg-brand-default");
    expect(unavailableDay).toBeDisabled();
  });

  it.each([
    { label: "the direct page", isEmbed: false },
    { label: "another embedded event", eventSlug: "30min" },
    { label: "another embedded username", username: "other" },
  ])("does not opt into the selected-day calendar for $label", ({ isEmbed, eventSlug, username }) => {
    const { container } = renderDatePicker({ isEmbed, eventSlug, username });
    const calendar = container.querySelector(".caller-calendar");

    expect(calendar).toHaveClass("caller-calendar");
    expect(calendar?.className).not.toMatch(/selectedDayCalendar/);
  });
});
