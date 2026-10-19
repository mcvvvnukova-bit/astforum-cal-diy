export class SmtpFailure extends Error {
  constructor(
    readonly kind: "transient" | "permanent" | "unknown",
    readonly reason: string
  ) {
    super(reason);
  }
}

/** Persist codes only: provider messages can contain recipient addresses and credentials. */
export function classifySmtpError(error: unknown): SmtpFailure {
  if (error instanceof SmtpFailure) return error;
  if (!error || typeof error !== "object") return new SmtpFailure("unknown", "smtp_unknown");
  const { responseCode, command, code } = error as { responseCode?: number; command?: string; code?: string };
  if (responseCode && responseCode >= 400 && responseCode < 600) {
    return new SmtpFailure(responseCode < 500 ? "transient" : "permanent", `smtp_${responseCode}`);
  }
  if (code === "EAUTH" || code === "EENVELOPE") return new SmtpFailure("permanent", "smtp_configuration");
  // A disconnect after DATA may happen after acceptance. Never retry it automatically.
  // Nodemailer also uses CONN for a socket close/timeout AFTER DATA.
  if (code === "EDNS" || (command && /^(EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)$/i.test(command))) {
    return new SmtpFailure("transient", "smtp_before_data");
  }
  return new SmtpFailure("unknown", "smtp_unknown");
}
