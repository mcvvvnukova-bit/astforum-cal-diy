/**
 * @vitest-environment jsdom
 */

import dayjs from "@calcom/dayjs";
import { render, screen } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import type { BookerStore } from "@calcom/features/bookings/Booker/store";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { BookerLayouts } from "@calcom/prisma/zod-utils";
import type { useScheduleForEventReturnType } from "@calcom/web/modules/schedules/hooks/useEvent";
import type { Slot } from "@calcom/web/modules/schedules/lib/types";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvailableTimeSlots } from "./AvailableTimeSlots";
import { AvailableTimesHeader } from "./AvailableTimesHeader";
import { SlotSelectionModalHeader } from "./SlotSelectionModalHeader";

const { boundaryState }: { boundaryState: { isEmbed: boolean; language: string } } = vi.hoisted(() => ({
  boundaryState: { isEmbed: true, language: "ru" },
}));

vi.mock("@calcom/embed-core/embed-iframe", () => ({
  useIsEmbed: () => boundaryState.isEmbed,
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  };
});

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

vi.mock("@calcom/lib/hooks/useLocale", async () => {
  const { default: ru } = await import("@calcom/i18n/locales/ru/common.json");

  return {
    useLocale: () => ({
      t: (key: string, values?: Record<string, string | number>) => {
        const translation = (ru as Record<string, unknown>)[key];
        let message = key;
        if (typeof translation === "string") message = translation;
        for (const [name, value] of Object.entries(values ?? {})) {
          message = message.replaceAll(`{{${name}}}`, String(value));
        }
        return message;
      },
      i18n: { language: boundaryState.language },
      isLocaleReady: true,
    }),
  };
});

const targetStore: Partial<BookerStore> = {
  username: "demo",
  eventSlug: "60min",
  state: "selecting_time" as const,
  layout: BookerLayouts.MONTH_VIEW,
  selectedDate: "2026-09-08",
  timezone: "Europe/Moscow",
};

const modalEvent = Object.freeze({
  length: 60,
  metadata: Object.freeze({}),
  lockTimeZoneToggleOnBookingPage: false,
  lockedTimeZone: null,
  isDynamic: false,
  currency: "USD",
  price: 0,
  locations: Object.freeze([]),
  requiresConfirmation: false,
  recurringEvent: null,
  enablePerHostLocations: false,
}) as unknown as BookerEvent;

const renderSlots = (
  slots: Slot[],
  store: Partial<BookerStore> = {},
  hideAvailableTimesHeader: boolean = false
): ReturnType<typeof render> => {
  const schedule = {
    data: { slots: { "2026-09-08": slots } },
    invalidate: vi.fn(),
  } as unknown as useScheduleForEventReturnType;

  return render(
    <AvailableTimeSlots
      schedule={schedule}
      isLoading={false}
      limitHeight
      event={{ data: null }}
      loadingStates={{ creatingBooking: false, creatingRecurringBooking: false }}
      isVerificationCodeSending={false}
      renderConfirmNotVerifyEmailButtonCond={false}
      onSubmit={vi.fn()}
      skipConfirmStep={false}
      unavailableTimeSlots={[]}
      onAvailableTimeSlotSelect={vi.fn()}
      hideAvailableTimesHeader={hideAvailableTimesHeader}
    />,
    { mockStore: { ...targetStore, ...store } }
  );
};

describe("demo slot selection presentation", () => {
  beforeEach(() => {
    boundaryState.isEmbed = true;
    boundaryState.language = "ru";
  });

  it("shows the complete selected calendar date and updates it when the header date changes", () => {
    const { rerender } = render(<AvailableTimesHeader date={dayjs("2026-09-08")} />, {
      mockStore: targetStore,
    });

    expect(screen.getByTestId("demo-slot-date")).toHaveTextContent("вторник, 8 сентября 2026 г.");

    rerender(<AvailableTimesHeader date={dayjs("2027-01-01")} />);
    expect(screen.getByTestId("demo-slot-date")).toHaveTextContent("пятница, 1 января 2027 г.");
  });

  it("formats the selected calendar date without shifting a positive-offset day through UTC", () => {
    render(<AvailableTimesHeader date={dayjs.tz("2026-09-08 00:00", "Pacific/Kiritimati")} />, {
      mockStore: targetStore,
    });

    expect(screen.getByTestId("demo-slot-date")).toHaveTextContent("вторник, 8 сентября 2026 г.");
    expect(screen.queryByText(/7 сентября/)).not.toBeInTheDocument();
  });

  it("places the read-only Moscow timezone footer after the available times", async () => {
    renderSlots([{ time: "2026-09-08T11:00:00.000Z" } as Slot]);

    const time = await screen.findByTestId("time");
    const zone = screen.getByTestId("demo-slot-timezone");

    expect(time).toHaveTextContent("14:00");
    expect(zone).toHaveTextContent("по московскому времени (GMT+3)");
    expect(time.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(zone.querySelector("button,input,select,[role=combobox],[tabindex]")).toBeNull();
    expect(zone.className).not.toContain("cursor-not-allowed");
  });

  it("keeps the target empty message before the timezone footer", async () => {
    renderSlots([]);

    const empty = await screen.findByTestId("demo-slot-empty");
    const zone = screen.getByTestId("demo-slot-timezone");

    expect(empty).toHaveTextContent("Все интервалы забронированы.");
    expect(empty.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the effective non-Moscow timezone literally", async () => {
    renderSlots([{ time: "2026-09-08T11:00:00.000Z" } as Slot], {
      timezone: "Asia/Yekaterinburg",
    });

    await screen.findByTestId("time");
    expect(screen.getByTestId("demo-slot-timezone")).toHaveTextContent("Asia/Yekaterinburg");
    expect(screen.queryByText("по московскому времени (GMT+3)")).not.toBeInTheDocument();
  });

  it("keeps the timezone footer visible when the duplicate desktop header is hidden", async () => {
    renderSlots([{ time: "2026-09-08T11:00:00.000Z" } as Slot], {}, true);

    await screen.findByTestId("time");
    expect(screen.getByTestId("demo-slot-timezone")).toBeVisible();
  });

  it.each([
    {
      label: "the same non-embedded event",
      isEmbed: false,
      store: {},
    },
    {
      label: "another embedded event",
      isEmbed: true,
      store: { eventSlug: "30min" },
    },
    {
      label: "the embedded demo week layout",
      isEmbed: true,
      store: { layout: BookerLayouts.WEEK_VIEW },
    },
    {
      label: "the embedded demo column layout",
      isEmbed: true,
      store: { layout: BookerLayouts.COLUMN_VIEW },
    },
    {
      label: "the embedded demo booking step",
      isEmbed: true,
      store: { state: "booking" as const },
    },
  ])("preserves the original slot presentation for $label", async ({ isEmbed, store }) => {
    boundaryState.isEmbed = isEmbed;
    renderSlots([{ time: "2026-09-08T11:00:00.000Z" } as Slot], store);

    await screen.findByTestId("time");
    expect(screen.queryByTestId("demo-slot-date")).not.toBeInTheDocument();
    expect(screen.queryByTestId("demo-slot-timezone")).not.toBeInTheDocument();
  });

  it("uses the complete date without a second selector in the target mobile header and retains back", () => {
    const onClick = vi.fn();

    render(<SlotSelectionModalHeader onClick={onClick} event={modalEvent} selectedDate="2026-09-08" />, {
      mockStore: targetStore,
    });

    expect(screen.getByTestId("demo-slot-date")).toHaveTextContent("вторник, 8 сентября 2026 г.");
    expect(screen.getByText("1ч")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("globe-icon")).not.toBeInTheDocument();
    expect(screen.queryByText("September 8, 2026")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
