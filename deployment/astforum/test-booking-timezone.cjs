const assert = require("node:assert/strict");
const { env } = require("node:process");
const { after, test } = require("node:test");
const { Pool } = require("pg");

assert.ok(env.DATABASE_URL, "Run inside the web container with DATABASE_URL configured");

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  options: "-c default_transaction_read_only=on",
  max: 1,
  connectionTimeoutMillis: 5000,
});

after(() => pool.end());

test("UTC booking timestamps display at the correct Moscow time", async () => {
  const { rows } = await pool.query(`
    SELECT timestamp '2026-10-13 13:00:00' AS start,
           timestamp '2026-10-13 14:00:00' AS finish
  `);

  assert.equal(rows[0].start.toISOString(), "2026-10-13T13:00:00.000Z");
  assert.equal(rows[0].finish.toISOString(), "2026-10-13T14:00:00.000Z");
  assert.equal(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }).format(rows[0].start),
    "16:00"
  );
});

test("booking status comparisons use the same UTC storage convention", async () => {
  for (const [now, expectedUpcoming] of [
    ["2026-10-13T11:05:50.000Z", true],
    ["2026-10-13T14:05:50.000Z", false],
  ]) {
    const { rows } = await pool.query("SELECT timestamp '2026-10-13 14:00:00' >= $1::timestamp AS upcoming", [
      new Date(now),
    ]);

    assert.equal(rows[0].upcoming, expectedUpcoming, `Classification at ${now}`);
  }
});
