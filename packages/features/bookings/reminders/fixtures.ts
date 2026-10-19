import type { ReminderBooking } from "./policy";

export const booking: ReminderBooking = {
  id: 7,
  uid: "demo-7",
  eventTypeId: 3,
  status: "ACCEPTED",
  rescheduled: false,
  createdAt: new Date("2026-09-30T12:00:00Z"),
  startTime: new Date("2026-10-02T12:00:00Z"),
  endTime: new Date("2026-10-02T13:00:00Z"),
  name: "Анна",
  email: "anna@example.test",
  meetingUrl: "https://video.example.test/room",
  disabled: false,
};
