import { readFileSync } from "node:fs";
import type { PrismaClient } from "@calcom/prisma";
import { getDMMF } from "@prisma/internals";
import { generatePrismockSync } from "prismock";
import { describe, expect, it } from "vitest";
import { booking } from "./fixtures";
import { planReminders } from "./policy";
import { ReminderRepository } from "./repository";

async function setup() {
  const dmmf = await getDMMF({ datamodel: readFileSync("packages/prisma/schema.prisma", "utf8") });
  const db = generatePrismockSync<PrismaClient>({ models: dmmf.datamodel.models });
  db.setData({
    ...db.getData(),
    booking: [
      { ...booking, metadata: { videoCallUrl: booking.meetingUrl }, responses: { email: booking.email } },
    ],
    eventType: [{ id: 3, metadata: {} }],
    attendee: [{ id: 1, bookingId: 7, email: booking.email, name: booking.name }],
    bookingReference: [],
  });
  return { db, repository: new ReminderRepository(db, [3]) };
}

describe("Prisma reminder adapter (in-memory schema)", () => {
  it.each([
    "",
    "javascript:alert(1)",
    "invalid-url",
  ])("falls through invalid metadata URL %s to the current conference", async (videoCallUrl) => {
    const { db, repository } = await setup();
    await db.booking.update({
      where: { id: 7 },
      data: { metadata: { videoCallUrl }, location: "https://video.example.test/location" },
    });
    await db.bookingReference.create({
      data: {
        id: 1,
        bookingId: 7,
        type: "test_video",
        uid: "reference-1",
        deleted: false,
        meetingUrl: "https://video.example.test/reference",
      },
    });
    expect(await repository.getBooking(7)).toMatchObject({
      meetingUrl: "https://video.example.test/reference",
    });
    await db.bookingReference.update({ where: { id: 1 }, data: { deleted: true } });
    expect(await repository.getBooking(7)).toMatchObject({
      meetingUrl: "https://video.example.test/location",
    });
  });
  it("maps the primary attendee, meeting link and all three suppression switches", async () => {
    const { db, repository } = await setup();
    expect(await repository.getBooking(7)).toMatchObject({
      email: booking.email,
      meetingUrl: booking.meetingUrl,
      disabled: false,
    });
    expect(await new ReminderRepository(db, []).getBooking(7)).toMatchObject({ disabled: true });
    await db.feature.create({ data: { slug: "emails", enabled: true } });
    expect(await repository.getBooking(7)).toMatchObject({ disabled: true });
    await db.feature.update({ where: { slug: "emails" }, data: { enabled: false } });
    await db.eventType.update({
      where: { id: 3 },
      data: { metadata: { disableStandardEmails: { all: { attendee: true } } } },
    });
    expect(await repository.getBooking(7)).toMatchObject({ disabled: true });
  });
  it("does not reset a terminal task when reconciliation schedules it again", async () => {
    const { db, repository } = await setup();
    const reminder = planReminders(booking, new Date("2026-09-30T13:00Z"))[1];
    await repository.schedule(reminder);
    const row = await db.task.findFirstOrThrow();
    await repository.compareAndSet(row, {
      maxAttempts: 0,
      succeededAt: new Date(),
      payload: JSON.stringify({ ...reminder, state: "smtp_accepted" }),
    });
    await repository.schedule(reminder);
    expect(await db.task.count()).toBe(1);
    expect(await repository.get(row.id)).toMatchObject({ maxAttempts: 0 });
  });
  it("rejects a stale claim after another worker changed the persisted payload", async () => {
    const { db, repository } = await setup();
    await repository.schedule(planReminders(booking, new Date("2026-09-30T13:00Z"))[1]);
    const row = await db.task.findFirstOrThrow();
    expect(await repository.compareAndSet(row, { payload: "claimed", attempts: 1 })).toBe(true);
    expect(await repository.compareAndSet(row, { payload: "duplicate", attempts: 1 })).toBe(false);
  });
});
