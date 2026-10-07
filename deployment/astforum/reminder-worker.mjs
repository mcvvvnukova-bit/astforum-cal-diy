import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for the reminder worker");
const endpoint = "http://web:3000/api/tasks/cron";
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
while (!stopped) {
  const start = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55_000),
    });
    await response.body?.cancel();
    if (!response.ok) console.error(`Tasker cron returned HTTP ${response.status}`);
  } catch {
    console.error("Tasker cron unavailable or timed out; inspect web logs");
  }
  if (!stopped) await delay(Math.max(1000, 10_000 - (Date.now() - start)));
}
