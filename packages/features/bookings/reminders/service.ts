import { z } from "zod";
import {
  DISPATCH_WINDOW_MS,
  isCurrentReminder,
  type ReminderBooking,
  SEND_TIMEOUT_MS,
  sameBooking,
} from "./policy";
import { classifySmtpError } from "./smtp-error";

export const reminderPayloadSchema = z.object({
  bookingId: z.number().int().positive(),
  uid: z.string().min(1),
  eventTypeId: z.number().int().positive(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  dueAt: z.string().datetime(),
  minutesBefore: z.union([z.literal(1440), z.literal(60), z.literal(15)]),
  state: z.enum(["queued", "sending", "smtp_accepted", "skipped", "failed", "unknown"]),
  startedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
});
export type ReminderPayload = z.infer<typeof reminderPayloadSchema>;
export type ReminderTask = {
  id: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  succeededAt: Date | null;
};
export type TaskPatch = Partial<
  Pick<ReminderTask, "payload" | "attempts" | "maxAttempts" | "scheduledAt" | "succeededAt">
> & { lastError?: string | null; lastFailedAttemptAt?: Date };
export interface ReminderStore {
  get(id: string): Promise<ReminderTask | null>;
  getBooking(id: number): Promise<ReminderBooking | null>;
  compareAndSet(previous: ReminderTask, patch: TaskPatch): Promise<boolean>;
}

export class ReminderService {
  constructor(
    private readonly store: ReminderStore,
    private readonly send: (booking: ReminderBooking, payload: ReminderPayload) => Promise<void>,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async finish(
    task: ReminderTask,
    payload: ReminderPayload,
    state: ReminderPayload["state"],
    reason?: string
  ) {
    return this.store.compareAndSet(task, {
      payload: JSON.stringify({ ...payload, state, reason }),
      maxAttempts: 0,
      succeededAt: state === "smtp_accepted" || state === "skipped" ? this.now() : null,
      lastError: reason ?? null,
    });
  }

  private async parse(task: ReminderTask) {
    const parsed = reminderPayloadSchema.safeParse(
      (() => {
        try {
          return JSON.parse(task.payload);
        } catch {
          return null;
        }
      })()
    );
    if (parsed.success) return parsed.data;
    await this.store.compareAndSet(task, { maxAttempts: 0, lastError: "invalid_reminder_payload" });
    return null;
  }

  /** Runs independently of Tasker's attempt limit to recover a crash on the final attempt. */
  async retire(task: ReminderTask): Promise<void> {
    const payload = await this.parse(task);
    if (!payload || task.maxAttempts === 0) return;
    if (payload.state === "sending") {
      if (!payload.startedAt || this.now().getTime() - Date.parse(payload.startedAt) >= SEND_TIMEOUT_MS)
        await this.finish(task, payload, "unknown", "worker_interrupted_check_smtp_logs");
    } else if (payload.state === "queued") {
      const booking = await this.store.getBooking(payload.bookingId);
      if (
        !sameBooking(payload, booking) ||
        this.now().getTime() >= Date.parse(payload.dueAt) + DISPATCH_WINDOW_MS
      )
        await this.finish(task, payload, "skipped", "booking_changed_disabled_or_expired");
    }
  }

  async process(id: string): Promise<void> {
    const task = await this.store.get(id);
    if (!task || task.maxAttempts === 0 || task.succeededAt) return;
    const payload = await this.parse(task);
    if (!payload) return;
    if (payload.state === "sending") return this.retire(task);
    if (payload.state !== "queued" || task.attempts >= task.maxAttempts || task.scheduledAt > this.now())
      return;

    const sending: ReminderPayload = { ...payload, state: "sending", startedAt: this.now().toISOString() };
    const patch: TaskPatch = {
      payload: JSON.stringify(sending),
      attempts: task.attempts + 1,
      scheduledAt: new Date(this.now().getTime() + SEND_TIMEOUT_MS),
    };
    if (!(await this.store.compareAndSet(task, patch))) return;
    const claimed: ReminderTask = { ...task, ...patch };
    // Read committed state immediately before SMTP, including kill switches and the current link.
    const booking = await this.store.getBooking(payload.bookingId);
    if (!isCurrentReminder(payload, booking, this.now()) || !booking) {
      await this.finish(claimed, sending, "skipped", "booking_changed_disabled_or_expired");
      return;
    }
    let failure: ReturnType<typeof classifySmtpError> | undefined;
    try {
      await this.send(booking, sending);
    } catch (error) {
      failure = classifySmtpError(error);
    }
    // Database failures after SMTP acceptance must propagate WITHOUT resending the message.
    if (!failure) {
      await this.finish(claimed, sending, "smtp_accepted");
      return;
    }
    const retryAt = new Date(this.now().getTime() + 10_000);
    if (
      failure.kind === "transient" &&
      claimed.attempts < claimed.maxAttempts &&
      retryAt.getTime() < Date.parse(payload.dueAt) + DISPATCH_WINDOW_MS
    ) {
      await this.store.compareAndSet(claimed, {
        payload: JSON.stringify({ ...payload, state: "queued", reason: failure.reason }),
        scheduledAt: retryAt,
        lastError: failure.reason,
        lastFailedAttemptAt: this.now(),
      });
    } else {
      await this.finish(claimed, sending, failure.kind === "unknown" ? "unknown" : "failed", failure.reason);
    }
  }
}
