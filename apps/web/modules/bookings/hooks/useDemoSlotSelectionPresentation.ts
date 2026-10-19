import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { useDemoWidgetPresentation } from "@calcom/features/bookings/Booker/hooks/useDemoWidgetPresentation";
import { BookerLayouts } from "@calcom/prisma/zod-utils";

export const useDemoSlotSelectionPresentation = (): boolean => {
  const isDemoWidget = useDemoWidgetPresentation();
  const state = useBookerStoreContext((value) => value.state);
  const layout = useBookerStoreContext((value) => value.layout);

  return (
    isDemoWidget &&
    layout === BookerLayouts.MONTH_VIEW &&
    (state === "selecting_date" || state === "selecting_time")
  );
};
