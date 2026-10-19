import { useIsEmbed } from "@calcom/embed-core/embed-iframe";
import { useBookerStoreContext } from "@calcom/features/bookings/Booker/BookerStoreProvider";

export const useDemoWidgetPresentation = () => {
  const isEmbed = useIsEmbed();
  const isDemoEvent = useBookerStoreContext(
    (state) => state.username === "demo" && state.eventSlug === "60min"
  );

  return isEmbed === true && isDemoEvent;
};
