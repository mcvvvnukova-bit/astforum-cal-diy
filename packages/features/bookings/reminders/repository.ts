import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { MAX_ATTEMPTS, REMINDER_TYPE, type Reminder, type ReminderBooking, reminderKey } from "./policy";
import type { ReminderStore, ReminderTask, TaskPatch } from "./service";

const bookingSelect = {
  id: true,
  uid: true,
  eventTypeId: true,
  status: true,
  rescheduled: true,
  createdAt: true,
  startTime: true,
  endTime: true,
  responses: true,
  metadata: true,
  location: true,
  attendees: { select: { email: true, name: true }, orderBy: { id: "asc" as const } },
  references: {
    select: { meetingUrl: true },
    where: { OR: [{ deleted: false }, { deleted: null }] },
    orderBy: { id: "desc" as const },
  },
  eventType: { select: { metadata: true } },
} satisfies Prisma.BookingSelect;
const taskSelect = {
  id: true,
  payload: true,
  attempts: true,
  maxAttempts: true,
  scheduledAt: true,
  succeededAt: true,
};
type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function firstMeetingUrl(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch {
      /* Try the next persisted source. */
    }
  }
  return null;
}

export function toReminderBooking(row: BookingRow, enabled: boolean): ReminderBooking {
  const emailResponse = object(row.responses).email;
  const responseEmail = typeof emailResponse === "string" ? emailResponse : object(emailResponse).value;
  const attendee =
    row.attendees.find((a) => a.email.toLowerCase() === String(responseEmail).toLowerCase()) ??
    row.attendees[0];
  const metadataUrl = object(row.metadata).videoCallUrl;
  const disabled =
    object(object(object(row.eventType?.metadata).disableStandardEmails).all).attendee === true;
  return {
    ...row,
    name: attendee?.name ?? "",
    email: attendee?.email ?? "",
    meetingUrl: firstMeetingUrl([metadataUrl, ...row.references.map((ref) => ref.meetingUrl), row.location]),
    disabled: !enabled || disabled,
  };
}

export class ReminderRepository implements ReminderStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly eventTypeIds: number[]
  ) {}
  async get(id: string) {
    return this.db.task.findFirst({ where: { id, type: REMINDER_TYPE }, select: taskSelect });
  }
  async getBooking(id: number) {
    const row = await this.db.booking.findUnique({ where: { id }, select: bookingSelect });
    if (!row) return null;
    const killSwitch = await this.db.feature.findUnique({
      where: { slug: "emails" },
      select: { enabled: true },
    });
    return toReminderBooking(row, !killSwitch?.enabled && this.eventTypeIds.includes(row.eventTypeId ?? -1));
  }
  async compareAndSet(previous: ReminderTask, patch: TaskPatch) {
    const result = await this.db.task.updateMany({
      where: {
        id: previous.id,
        type: REMINDER_TYPE,
        payload: previous.payload,
        attempts: previous.attempts,
        maxAttempts: previous.maxAttempts,
        succeededAt: null,
      },
      data: patch,
    });
    return result.count === 1;
  }
  async schedule(reminder: Reminder) {
    const referenceUid = reminderKey(reminder);
    const where = { referenceUid_type: { referenceUid, type: REMINDER_TYPE } };
    try {
      await this.db.task.upsert({
        where,
        update: {},
        create: {
          type: REMINDER_TYPE,
          referenceUid,
          payload: JSON.stringify({ ...reminder, state: "queued" }),
          scheduledAt: new Date(reminder.dueAt),
          maxAttempts: MAX_ATTEMPTS,
        },
        select: { id: true },
      });
    } catch (error) {
      // Prisma may race its read and insert; only the exact persisted duplicate is harmless.
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        const existing = await this.db.task.findUnique({ where, select: { id: true } });
        if (existing) return;
      }
      throw error;
    }
  }
  async *activeTasks() {
    let cursor: string | undefined;
    for (;;) {
      const rows: ReminderTask[] = await this.db.task.findMany({
        where: {
          type: REMINDER_TYPE,
          maxAttempts: { gt: 0 },
          succeededAt: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: taskSelect,
        orderBy: { id: "asc" },
        take: 200,
      });
      if (!rows.length) return;
      yield* rows;
      cursor = rows[rows.length - 1].id;
    }
  }
  async *upcomingBookings(now: Date) {
    if (!this.eventTypeIds.length) return;
    const killSwitch = await this.db.feature.findUnique({
      where: { slug: "emails" },
      select: { enabled: true },
    });
    if (killSwitch?.enabled) return;
    let cursor = 0;
    for (;;) {
      const rows = await this.db.booking.findMany({
        where: {
          id: { gt: cursor },
          eventTypeId: { in: this.eventTypeIds },
          status: "ACCEPTED",
          startTime: { gt: now, lte: new Date(now.getTime() + 49 * 3600_000) },
        },
        select: bookingSelect,
        orderBy: { id: "asc" },
        take: 200,
      });
      if (!rows.length) return;
      for (const row of rows) yield toReminderBooking(row, true);
      cursor = rows[rows.length - 1].id;
    }
  }
}
