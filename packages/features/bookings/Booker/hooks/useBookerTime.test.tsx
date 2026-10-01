/**
 * @vitest-environment jsdom
 */

import { BookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { createBookerStore } from "@calcom/features/bookings/Booker/store";
import { timePreferencesStore } from "@calcom/features/bookings/lib/timePreferences";
import { TimeFormat } from "@calcom/lib/timeFormat";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookerTime } from "./useBookerTime";

const { embedState }: { embedState: { isEmbed: boolean } } = vi.hoisted(() => ({
  embedState: { isEmbed: false },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => embedState.isEmbed,
}));

const originalTimePreferences = timePreferencesStore.getState();

const createWrapper = ({ username, eventSlug }: { username: string; eventSlug: string }) => {
  const store = createBookerStore();
  store.setState({ username, eventSlug });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <BookerStoreContext.Provider value={store}>{children}</BookerStoreContext.Provider>;
  };
};

describe("useBookerTime demo widget presentation", () => {
  beforeEach(() => {
    embedState.isEmbed = false;
    timePreferencesStore.setState({ timeFormat: TimeFormat.TWELVE_HOUR });
  });

  afterEach(() => {
    timePreferencesStore.setState({
      timeFormat: originalTimePreferences.timeFormat,
      timezone: originalTimePreferences.timezone,
    });
  });

  it("uses 24-hour time for the embedded demo/60min flow without changing the saved preference", () => {
    embedState.isEmbed = true;

    const { result } = renderHook(() => useBookerTime(), {
      wrapper: createWrapper({ username: "demo", eventSlug: "60min" }),
    });

    expect(result.current.timeFormat).toBe(TimeFormat.TWENTY_FOUR_HOUR);
    expect(timePreferencesStore.getState().timeFormat).toBe(TimeFormat.TWELVE_HOUR);
  });

  it.each([
    ["the same event outside an embed", false, "demo", "60min"],
    ["another embedded event", true, "demo", "30min"],
  ])("preserves the saved time format for %s", (_name, isEmbed, username, eventSlug) => {
    embedState.isEmbed = isEmbed;

    const { result } = renderHook(() => useBookerTime(), {
      wrapper: createWrapper({ username, eventSlug }),
    });

    expect(result.current.timeFormat).toBe(TimeFormat.TWELVE_HOUR);
  });
});
