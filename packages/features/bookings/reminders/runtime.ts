import process from "node:process";
import { serverConfig } from "@calcom/lib/serverConfig";
import { prisma } from "@calcom/prisma";
import { planReminders } from "./policy";
import { ReminderRepository } from "./repository";
import { ReminderService } from "./service";
import { sendReminderSmtp } from "./smtp";
import { SmtpFailure } from "./smtp-error";

function runtime() {
  const repository = new ReminderRepository(prisma, configuredEventTypes());
  const service = new ReminderService(repository, async (booking, payload) => {
    if (
      !serverConfig.from ||
      (typeof serverConfig.transport !== "string" && "sendmail" in serverConfig.transport)
    )
      throw new SmtpFailure("permanent", "explicit_smtp_configuration_required");
    await sendReminderSmtp(booking, payload, {
      ...serverConfig,
      transport: serverConfig.transport,
      from: serverConfig.from,
      baseUrl: process.env.NEXT_PUBLIC_WEBAPP_URL || "https://cal.astforum.ru",
    });
  });
  return { repository, service };
}

export function configuredEventTypes(value = process.env.BOOKING_REMINDER_EVENT_TYPE_IDS ?? ""): number[] {
  if (!value.trim()) return [];
  const ids = value.split(",").map((id) => Number(id.trim()));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error("Invalid BOOKING_REMINDER_EVENT_TYPE_IDS");
  return [...new Set(ids)];
}

/** Called by the existing authenticated Tasker cron. No Redis or new database schema is required. */
export async function reconcileBookingReminders() {
  const { repository, service } = runtime();
  for await (const task of repository.activeTasks()) await service.retire(task);
  const now = new Date();
  for await (const booking of repository.upcomingBookings(now)) {
    for (const reminder of planReminders(booking, now)) await repository.schedule(reminder);
  }
}

export async function sendBookingReminder(_payload: string, taskId?: string) {
  if (!taskId) throw new Error("Reminder task ID is required");
  await runtime().service.process(taskId);
}
