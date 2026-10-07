import type { Dayjs } from "@calcom/dayjs";

export const formatSlotSelectionDate = (date: Dayjs, language: string): string => {
  if (!date.isValid()) return "";

  const calendarDate = new Date(Date.UTC(date.year(), date.month(), date.date()));

  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(calendarDate);
};
