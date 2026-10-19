import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { buildReminderMessage } from "./message";
import type { Reminder, ReminderBooking } from "./policy";
import { classifySmtpError, SmtpFailure } from "./smtp-error";

export async function sendReminderSmtp(
  booking: ReminderBooking,
  reminder: Reminder,
  config: {
    transport: string | SMTPTransport.Options;
    from: string;
    baseUrl: string;
    headers?: Record<string, string>;
  }
) {
  const limits = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };
  let transport: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
  if (typeof config.transport === "string") {
    const url = new URL(config.transport);
    if (!["smtp:", "smtps:"].includes(url.protocol)) throw new SmtpFailure("permanent", "smtp_configuration");
    for (const [key, value] of Object.entries(limits)) url.searchParams.set(key, String(value));
    transport = nodemailer.createTransport(url.href);
  } else {
    transport = nodemailer.createTransport({ ...config.transport, ...limits });
  }
  // A hard deadline also bounds a server that keeps the socket alive without completing DATA.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      transport.sendMail({
        ...buildReminderMessage(booking, reminder, config.baseUrl, config.from),
        headers: config.headers,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          transport.close();
          reject(new SmtpFailure("unknown", "smtp_deadline"));
        }, 45_000);
      }),
    ]);
    if (
      !info.accepted.some(
        (recipient) =>
          (typeof recipient === "string" ? recipient : recipient.address).toLowerCase() ===
          booking.email.toLowerCase()
      )
    )
      throw new SmtpFailure("permanent", "smtp_recipient_not_accepted");
  } catch (error) {
    throw classifySmtpError(error);
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}
