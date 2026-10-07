import { describe, expect, it, vi } from "vitest";
import { booking } from "./fixtures";
import { planReminders } from "./policy";
import { ReminderService, type ReminderStore, type ReminderTask, type TaskPatch } from "./service";
import { SmtpFailure } from "./smtp-error";

class MemoryStore implements ReminderStore {
  task: ReminderTask = {
    id: "task-1",
    payload: JSON.stringify({ ...planReminders(booking, new Date("2026-09-30T13:00Z"))[1], state: "queued" }),
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: new Date("2026-10-02T11:00Z"),
    succeededAt: null,
  };
  current: typeof booking | null = { ...booking };
  async get() {
    return structuredClone(this.task);
  }
  async getBooking() {
    return this.current;
  }
  async compareAndSet(previous: ReminderTask, patch: TaskPatch) {
    if (
      this.task.payload !== previous.payload ||
      this.task.attempts !== previous.attempts ||
      this.task.maxAttempts !== previous.maxAttempts
    )
      return false;
    Object.assign(this.task, patch);
    return true;
  }
}

function setup() {
  const store = new MemoryStore();
  let now = new Date("2026-10-02T11:00:05Z");
  const send = vi.fn(async () => {});
  const service = new ReminderService(store, send, () => now);
  return {
    store,
    send,
    service,
    setNow: (date: string) => {
      now = new Date(date);
    },
    state: () => JSON.parse(store.task.payload).state,
  };
}

describe("durable reminder delivery", () => {
  it("claims atomically so concurrent cron runs and repeated jobs send once", async () => {
    const { service, send, store, state } = setup();
    await Promise.all([service.process("task-1"), service.process("task-1")]);
    await service.process("task-1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(state()).toBe("smtp_accepted");
    expect(store.task.attempts).toBe(1);
  });
  it("cancels an old schedule without sending", async () => {
    const { service, send, store, state } = setup();
    store.current = { ...booking, status: "CANCELLED" };
    await service.process("task-1");
    expect(send).not.toHaveBeenCalled();
    expect(state()).toBe("skipped");
  });
  it("rechecks persisted booking state after claiming", async () => {
    const { service, send, store, state } = setup();
    vi.spyOn(store, "getBooking").mockResolvedValue({ ...booking, startTime: new Date("2026-10-03T12:00Z") });
    await service.process("task-1");
    expect(send).not.toHaveBeenCalled();
    expect(state()).toBe("skipped");
  });
  it("retries an explicit temporary rejection, at most three attempts", async () => {
    const { service, send, store, state, setNow } = setup();
    send.mockRejectedValue(new SmtpFailure("transient", "smtp_450"));
    await service.process("task-1");
    expect(state()).toBe("queued");
    await service.process("task-1");
    expect(send).toHaveBeenCalledTimes(1);
    setNow("2026-10-02T11:00:16Z");
    await service.process("task-1");
    setNow("2026-10-02T11:00:27Z");
    await service.process("task-1");
    setNow("2026-10-02T11:00:38Z");
    await service.process("task-1");
    expect(send).toHaveBeenCalledTimes(3);
    expect(store.task.attempts).toBe(3);
    expect(state()).toBe("failed");
  });
  it.each(["permanent", "unknown"] as const)("does not retry %s SMTP outcomes", async (kind) => {
    const { service, send, state } = setup();
    send.mockRejectedValue(new SmtpFailure(kind, "smtp_failure"));
    await service.process("task-1");
    await service.process("task-1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(state()).toBe(kind === "unknown" ? "unknown" : "failed");
  });
  it("quarantines a crashed send, including the final attempt", async () => {
    const { service, store, send, state, setNow } = setup();
    store.task.payload = JSON.stringify({
      ...JSON.parse(store.task.payload),
      state: "sending",
      startedAt: "2026-10-02T11:00:00Z",
    });
    store.task.attempts = 3;
    setNow("2026-10-02T11:02:01Z");
    await service.retire(store.task);
    expect(state()).toBe("unknown");
    expect(send).not.toHaveBeenCalled();
  });
  it("leaves accepted-but-unrecorded mail in sending state for reconciliation", async () => {
    const { service, store, send, state } = setup();
    const original = store.compareAndSet.bind(store);
    vi.spyOn(store, "compareAndSet").mockImplementation(async (row, patch) => {
      if (JSON.parse(patch.payload ?? "{}").state === "smtp_accepted")
        throw new Error("database unavailable");
      return original(row, patch);
    });
    await expect(service.process("task-1")).rejects.toThrow("database unavailable");
    expect(state()).toBe("sending");
    await service.process("task-1");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("retires cancelled future jobs without deleting deduplication history", async () => {
    const { service, store, state, setNow } = setup();
    store.current = null;
    setNow("2026-10-01T13:00Z");
    await service.retire(store.task);
    expect(state()).toBe("skipped");
    expect(store.task.maxAttempts).toBe(0);
  });
});
