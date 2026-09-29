import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { booking } from "./fixtures";
import { planReminders } from "./policy";
import { sendReminderSmtp } from "./smtp";
import { classifySmtpError } from "./smtp-error";

const sockets = new Set<Socket>();
let server: Server | undefined;
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function fakeSmtp(outcome: "accept" | "reject" | "disconnect") {
  const messages: string[] = [];
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 local-test ESMTP\r\n");
    let buffer = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (data) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        messages.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        data = false;
        if (outcome === "disconnect") {
          socket.destroy();
          return;
        }
        socket.write(outcome === "reject" ? "450 Try again later\r\n" : "250 accepted\r\n");
      }
      while (!data && buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith("EHLO")) socket.write("250 local-test\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 Send data\r\n");
        } else if (line === "QUIT") {
          socket.end("221 Bye\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test SMTP address");
  return { url: `smtp://127.0.0.1:${address.port}`, messages };
}

describe("SMTP adapter", () => {
  const payload = planReminders(booking, new Date("2026-09-30T13:00Z"))[1];
  it("sends the real MIME message to a local SMTP server", async () => {
    const { url, messages } = await fakeSmtp("accept");
    await sendReminderSmtp(booking, payload, {
      transport: url,
      from: "notifications@astforum.ru",
      baseUrl: "https://cal.astforum.ru",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("anna@example.test");
    expect(messages[0].replace(/\r\n\s+/g, " ")).toContain("Message-ID: <booking-reminder-");
  });
  it.each([
    ["reject", "transient"],
    ["disconnect", "unknown"],
  ] as const)("classifies %s after DATA as %s", async (outcome, kind) => {
    const { url } = await fakeSmtp(outcome);
    await expect(
      sendReminderSmtp(booking, payload, {
        transport: url,
        from: "notifications@astforum.ru",
        baseUrl: "https://cal.astforum.ru",
      })
    ).rejects.toMatchObject({ kind });
  });
  it("treats 550 as permanent and pre-DATA failures as retryable", () => {
    expect(classifySmtpError({ responseCode: 550, command: "RCPT TO" }).kind).toBe("permanent");
    expect(classifySmtpError({ code: "EDNS", command: "CONN" }).kind).toBe("transient");
    expect(classifySmtpError({ code: "ECONNECTION", command: "CONN" }).kind).toBe("unknown");
    expect(classifySmtpError({ code: "ETIMEDOUT", command: "DATA" }).kind).toBe("unknown");
  });
});
