import { randomUUID } from "node:crypto";
import process from "node:process";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, it } from "vitest";
import { planReminders, REMINDER_TYPE, reminderKey } from "./policy";
import { ReminderRepository } from "./repository";

const databaseUrl = process.env.BOOKING_REMINDER_TEST_DATABASE_URL;

it.skipIf(!databaseUrl)(
  "concurrent PostgreSQL reconciliation creates one task and preserves its result",
  async () => {
    if (!databaseUrl) throw new Error("A disposable test database URL is required");
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!/^(build|test)(_|$)/.test(databaseName)) throw new Error("Use a disposable build/test database");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const event = await db.eventType.create({
      data: { title: "TEST reminder concurrency", slug: randomUUID(), length: 60 },
    });
    const now = new Date();
    const booking = await db.booking.create({
      data: {
        uid: randomUUID(),
        eventTypeId: event.id,
        title: "TEST reminder concurrency",
        status: "ACCEPTED",
        startTime: new Date(now.getTime() + 7200000),
        endTime: new Date(now.getTime() + 10800000),
        responses: { email: "test@example.test" },
        attendees: { create: { name: "Test", email: "test@example.test", timeZone: "Europe/Moscow" } },
      },
    });
    const repository = new ReminderRepository(db, [event.id]);
    const mapped = await repository.getBooking(booking.id);
    if (!mapped) throw new Error("Test booking missing");
    const reminder = planReminders(mapped, now)[0];
    const referenceUid = reminderKey(reminder);
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => repository.schedule(reminder))
      );
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      expect(await db.task.count({ where: { type: REMINDER_TYPE, referenceUid } })).toBe(1);
      const task = await db.task.findUniqueOrThrow({
        where: { referenceUid_type: { type: REMINDER_TYPE, referenceUid } },
      });
      await repository.compareAndSet(task, {
        payload: JSON.stringify({ ...reminder, state: "smtp_accepted" }),
        maxAttempts: 0,
        succeededAt: now,
      });
      await Promise.all(Array.from({ length: 20 }, () => repository.schedule(reminder)));
      const preserved = await repository.get(task.id);
      expect(preserved?.maxAttempts).toBe(0);
      expect(JSON.parse(preserved?.payload ?? "{}").state).toBe("smtp_accepted");
    } finally {
      await db.task.deleteMany({ where: { type: REMINDER_TYPE, referenceUid } });
      await db.booking.delete({ where: { id: booking.id } });
      await db.eventType.delete({ where: { id: event.id } });
      await db.$disconnect();
    }
  }
);
