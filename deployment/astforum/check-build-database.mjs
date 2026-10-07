import { lookup } from "node:dns/promises";
import { createConnection, isIP } from "node:net";
import process, { env } from "node:process";

try {
  const target = new URL(env.DATABASE_URL);
  const expected = env.BUILD_DATABASE_IP;
  if (!["postgresql:", "postgres:"].includes(target.protocol) || isIP(expected) !== 4) {
    throw new Error("A disposable database URL and expected IPv4 are required");
  }
  const resolved = await lookup(target.hostname, { family: 4 });
  if (resolved.address !== expected) throw new Error("Database resolved outside its owned build network");
  const port = Number(target.port || 5432);
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.hostname, port });
    socket.setTimeout(5000, () => socket.destroy(new Error("Database TCP deadline exceeded")));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
  });
  console.log(`Build database preflight: ${target.hostname} -> ${resolved.address}:${port}; TCP accepted`);
} catch (error) {
  console.error(`Build database preflight failed: ${error.message}`);
  process.exitCode = 1;
}
