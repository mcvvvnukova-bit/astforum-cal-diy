/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@calcom/features/bookings/Booker/__tests__/test-utils";
import type { BookerEvent } from "@calcom/features/bookings/types";
import { BookerLayouts } from "@calcom/prisma/zod-utils";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventMeta } from "./EventMeta";

const { boundaryState }: { boundaryState: { isEmbed: boolean; language: string } } = vi.hoisted(() => ({
  boundaryState: {
    isEmbed: false,
    language: "ru",
  },
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

const event = Object.freeze({
  lockTimeZoneToggleOnBookingPage: false,
  lockedTimeZone: null,
  schedule: null,
  seatsPerTimeSlot: null,
  subsetOfUsers: Object.freeze([]),
  length: 60,
  schedulingType: null,
  profile: Object.freeze({ name: "Demo", image: null }),
  entity: Object.freeze({ name: "Demo", logoUrl: null, teamSlug: null, hideProfileLink: false }),
  description: null,
  title: "Demo",
  metadata: Object.freeze({}),
  locations: Object.freeze([]),
  currency: "USD",
  requiresConfirmation: false,
  recurringEvent: null,
  price: 0,
  isDynamic: false,
  fieldTranslations: Object.freeze([]),
  autoTranslateDescriptionEnabled: false,
  enablePerHostLocations: false,
}) as unknown as BookerEvent;

const renderEventMeta = ({
  state,
  timezone,
  isEmbed = true,
  eventSlug = "60min",
  layout = BookerLayouts.MONTH_VIEW,
}: {
  state: "booking" | "selecting_date";
  timezone: string;
  isEmbed?: boolean;
  eventSlug?: string;
  layout?: BookerLayouts;
}): ReturnType<typeof render> => {
  boundaryState.isEmbed = isEmbed;
  return render(
    <TooltipProvider>
      <EventMeta
        event={event}
        isPending={false}
        isPlatform={false}
        isPrivateLink={false}
        selectedTimeslot={null}
        locale="ru"
      />
    </TooltipProvider>,
    {
      mockStore: {
        username: "demo",
        eventSlug,
        state,
        timezone,
        layout,
      },
    }
  );
};

describe("EventMeta demo booking timezone presentation", () => {
  beforeEach(() => {
    boundaryState.isEmbed = true;
    boundaryState.language = "ru";
  });

  it("shows the Moscow label before duration on the target booking step", () => {
    renderEventMeta({ state: "booking", timezone: "Europe/Moscow" });

    const timezone = screen.getByText("МСК (GMT+3)");
    const duration = screen.getByText("1ч");

    expect(timezone.textContent).toBe("МСК (GMT+3)");
    expect(timezone.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the actual non-Moscow timezone while retaining the target second-step order", () => {
    renderEventMeta({ state: "booking", timezone: "Asia/Yekaterinburg" });

    const timezone = screen.getByText("Asia/Yekaterinburg");
    const duration = screen.getByText("1ч");

    expect(timezone.compareDocumentPosition(duration) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("removes the legacy timezone selector from the target first step", () => {
    renderEventMeta({ state: "selecting_date", timezone: "Europe/Moscow" });

    expect(screen.getByText("1ч")).toBeInTheDocument();
    expect(screen.queryByTestId("event-meta-current-timezone")).not.toBeInTheDocument();
    expect(screen.queryByText("МСК (GMT+3)")).not.toBeInTheDocument();
  });

  it.each([
    {
      label: "the same non-embedded event",
      isEmbed: false,
      eventSlug: "60min",
      layout: BookerLayouts.MONTH_VIEW,
    },
    { label: "another embedded event", isEmbed: true, eventSlug: "30min", layout: BookerLayouts.MONTH_VIEW },
    {
      label: "the embedded demo week layout",
      isEmbed: true,
      eventSlug: "60min",
      layout: BookerLayouts.WEEK_VIEW,
    },
    {
      label: "the embedded demo column layout",
      isEmbed: true,
      eventSlug: "60min",
      layout: BookerLayouts.COLUMN_VIEW,
    },
  ])("retains the selector after duration for $label", ({ isEmbed, eventSlug, layout }) => {
    renderEventMeta({ state: "selecting_date", timezone: "Europe/Moscow", isEmbed, eventSlug, layout });

    const duration = screen.getByText("1ч");
    const timezone = screen.getByTestId("event-meta-current-timezone");

    expect(duration.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timezone).toHaveClass("current-timezone");
    expect(screen.queryByText("МСК (GMT+3)")).not.toBeInTheDocument();
  });
});
