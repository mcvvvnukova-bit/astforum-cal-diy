import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { getBookerTimezone } from "@calcom/features/bookings/Booker/utils/getBookerTimezone";
import { useTimePreferences } from "@calcom/features/bookings/lib/timePreferences";
import { TimeFormat } from "@calcom/lib/timeFormat";
import { shallow } from "zustand/shallow";
import { useDemoWidgetPresentation } from "./useDemoWidgetPresentation";

export const useBookerTime = () => {
  const [timezoneFromBookerStore] = useBookerStoreContext((state) => [state.timezone], shallow);
  const { timezone: timezoneFromTimePreferences, timeFormat: preferredTimeFormat } = useTimePreferences();
  const isDemoWidgetPresentation = useDemoWidgetPresentation();
  const timezone = getBookerTimezone({
    storeTimezone: timezoneFromBookerStore,
    bookerUserPreferredTimezone: timezoneFromTimePreferences,
  });
  const timeFormat = isDemoWidgetPresentation ? TimeFormat.TWENTY_FOUR_HOUR : preferredTimeFormat;

  return {
    timezone,
    timeFormat,
    timezoneFromBookerStore,
    timezoneFromTimePreferences,
  };
};
