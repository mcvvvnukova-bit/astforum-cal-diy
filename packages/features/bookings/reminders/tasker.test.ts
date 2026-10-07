import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNextBatch: vi.fn(),
  succeed: vi.fn(),
  retry: vi.fn(),
  handler: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock("../../tasker/repository", () => ({ Task: mocks }));
vi.mock("../../tasker/tasks", () => ({
  default: { sendBookingReminder: async () => mocks.handler, sendSms: async () => mocks.handler },
  tasksConfig: { sendBookingReminder: { managesLifecycle: true } },
}));
vi.mock("app/api/defaultResponderForAppDir", () => ({
  defaultResponderForAppDir: (handler: unknown) => handler,
}));
vi.mock("./runtime", () => ({ reconcileBookingReminders: mocks.reconcile }));

import { NextRequest } from "next/server";
import { GET, POST } from "../../../../apps/web/app/api/tasks/cron/route";
import { TaskProcessor } from "../../tasker/task-processor";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handler.mockReset().mockResolvedValue(undefined);
  mocks.reconcile.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Tasker reminder integration", () => {
  it.each([false, true])("does not overwrite reminder lifecycle when handler fails=%s", async (fails) => {
    mocks.getNextBatch.mockResolvedValue([
      { id: "reminder", type: "sendBookingReminder", payload: "{}", attempts: 0, maxAttempts: 3 },
    ]);
    if (fails) mocks.handler.mockRejectedValue(new Error("storage unavailable"));
    await new TaskProcessor().processQueue();
    expect(mocks.succeed).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("keeps existing success handling for ordinary tasks", async () => {
    mocks.getNextBatch.mockResolvedValue([{ id: "other", type: "sendSms", payload: "{}" }]);
    await new TaskProcessor().processQueue();
    expect(mocks.succeed).toHaveBeenCalledWith("other");
  });
  it("rejects an unset cron secret without reading or changing bookings", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const result = await GET(
      new NextRequest("http://localhost/api/tasks/cron", { headers: { authorization: "Bearer undefined" } })
    );
    expect(result.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("reconciles the persisted schedule through the actual POST route used by the worker", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    mocks.getNextBatch.mockResolvedValue([]);
    const result = await POST(
      new NextRequest("http://localhost/api/tasks/cron", { headers: { authorization: "Bearer test-secret" } })
    );
    expect(result.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getNextBatch.mock.invocationCallOrder[0]
    );
  });
});
