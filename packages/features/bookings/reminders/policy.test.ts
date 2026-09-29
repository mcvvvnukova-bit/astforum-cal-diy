import { describe, expect, it } from "vitest";
import { booking } from "./fixtures";
import { isCurrentReminder, planReminders } from "./policy";

describe("reminder policy", () => {
  it("plans three future reminders at the 48-hour booking boundary", () => {
    expect(planReminders(booking, new Date("2026-09-30T13:00:00Z")).map((p) => p.dueAt)).toEqual([
      "2026-10-01T12:00:00.000Z",
      "2026-10-02T11:00:00.000Z",
      "2026-10-02T11:45:00.000Z",
    ]);
  });
  it("does not send a daily reminder for a booking made less than 48 hours ahead", () => {
    expect(
      planReminders(
        { ...booking, createdAt: new Date("2026-09-30T12:00:00.001Z") },
        new Date("2026-09-30T13:00:00Z")
      ).map((p) => p.minutesBefore)
    ).toEqual([60, 15]);
  });
  it.each([
    "PENDING",
    "REJECTED",
    "CANCELLED",
    "AWAITING_HOST",
  ])("does not schedule %s bookings", (status) => {
    expect(planReminders({ ...booking, status }, new Date("2026-09-30T13:00:00Z"))).toEqual([]);
  });
  it.each([
    { rescheduled: true },
    { disabled: true },
  ])("does not schedule suppressed bookings %j", (change) => {
    expect(planReminders({ ...booking, ...change }, new Date("2026-09-30T13:00:00Z"))).toEqual([]);
  });
  it("only schedules 15 minutes when confirmed less than an hour ahead", () => {
    expect(planReminders(booking, new Date("2026-10-02T11:01:00Z")).map((p) => p.minutesBefore)).toEqual([
      15,
    ]);
  });
  it("does not catch up deadlines already reached at confirmation", () => {
    expect(planReminders(booking, new Date("2026-10-02T11:45:00Z"))).toEqual([]);
  });
  it("rechecks cancellation and schedule version before sending", () => {
    const p = planReminders(booking, new Date("2026-09-30T13:00:00Z"))[1];
    const now = new Date("2026-10-02T11:00:30Z");
    expect(isCurrentReminder(p, booking, now)).toBe(true);
    expect(isCurrentReminder(p, { ...booking, status: "CANCELLED" }, now)).toBe(false);
    expect(isCurrentReminder(p, { ...booking, startTime: new Date("2026-10-02T14:00:00Z") }, now)).toBe(
      false
    );
    expect(isCurrentReminder(p, { ...booking, uid: "replacement" }, now)).toBe(false);
    expect(isCurrentReminder(p, null, now)).toBe(false);
  });
  it("skips early and expired dispatches; allows less than 60 seconds of processing delay", () => {
    const p = planReminders(booking, new Date("2026-09-30T13:00:00Z"))[1];
    expect(isCurrentReminder(p, booking, new Date("2026-10-02T10:59:59Z"))).toBe(false);
    expect(isCurrentReminder(p, booking, new Date("2026-10-02T11:00:59.999Z"))).toBe(true);
    expect(isCurrentReminder(p, booking, new Date("2026-10-02T11:01:00Z"))).toBe(false);
  });
});
