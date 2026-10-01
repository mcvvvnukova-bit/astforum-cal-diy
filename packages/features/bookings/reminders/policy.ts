import { createHash } from "node:crypto";

const eligible = (booking: ReminderBooking) =>
  booking.status === "ACCEPTED" && !booking.rescheduled && !booking.disabled && !!booking.email;

export const REMINDER_TYPE = "sendBookingReminder";
export const DISPATCH_WINDOW_MS = 60_000;
export const MAX_ATTEMPTS = 3;
export const SEND_TIMEOUT_MS = 120_000;

export type ReminderBooking = {
  id: number;
  uid: string;
  eventTypeId: number | null;
  status: string;
  rescheduled: boolean | null;
  createdAt: Date;
  startTime: Date;
  endTime: Date;
  name: string;
  email: string;
  meetingUrl: string | null;
  disabled: boolean;
};

export type Reminder = {
  bookingId: number;
  uid: string;
  eventTypeId: number;
  startTime: string;
  endTime: string;
  minutesBefore: 1440 | 60 | 15;
  dueAt: string;
};

export function planReminders(booking: ReminderBooking, now: Date): Reminder[] {
  if (!eligible(booking) || !booking.eventTypeId) return [];
  return ([1440, 60, 15] as const).flatMap((minutesBefore) => {
    const due = booking.startTime.getTime() - minutesBefore * 60_000;
    if (due <= now.getTime()) return [];
    if (minutesBefore === 1440 && booking.startTime.getTime() - booking.createdAt.getTime() < 48 * 3600_000)
      return [];
    return [
      {
        bookingId: booking.id,
        uid: booking.uid,
        eventTypeId: booking.eventTypeId as number,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        minutesBefore,
        dueAt: new Date(due).toISOString(),
      },
    ];
  });
}

export function sameBooking(reminder: Reminder, booking: ReminderBooking | null): booking is ReminderBooking {
  return (
    !!booking &&
    eligible(booking) &&
    booking.id === reminder.bookingId &&
    booking.uid === reminder.uid &&
    booking.eventTypeId === reminder.eventTypeId &&
    booking.startTime.toISOString() === reminder.startTime &&
    booking.endTime.toISOString() === reminder.endTime
  );
}

export function isCurrentReminder(reminder: Reminder, booking: ReminderBooking | null, now: Date): boolean {
  const age = now.getTime() - Date.parse(reminder.dueAt);
  return sameBooking(reminder, booking) && age >= 0 && age < DISPATCH_WINDOW_MS;
}

export function reminderKey(reminder: Reminder): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        reminder.bookingId,
        reminder.uid,
        reminder.eventTypeId,
        reminder.startTime,
        reminder.endTime,
        reminder.minutesBefore,
      ])
    )
    .digest("hex");
}
