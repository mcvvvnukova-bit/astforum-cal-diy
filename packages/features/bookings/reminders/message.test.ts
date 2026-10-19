import { describe, expect, it } from "vitest";
import { booking } from "./fixtures";
import { buildReminderMessage } from "./message";
import { planReminders } from "./policy";

describe("reminder content", () => {
  const payload = () => planReminders(booking, new Date("2026-09-30T13:00:00Z"))[1];
  it.each([
    [1440, "АСТ Форум — завтра ждем Вас на демо"],
    [60, "АСТ Форум — через час ждем Вас на демо"],
    [15, "АСТ Форум — уже ждём Вас на демо"],
  ] as const)("uses the agreed subject and actions for %s minutes", (minutesBefore, subject) => {
    const mail = buildReminderMessage(
      booking,
      { ...payload(), minutesBefore },
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    expect(mail.subject).toBe(subject);
    if (minutesBefore === 15) expect(mail.text).toContain("Проверьте подключение к интернету и звук");
    else {
      expect(mail.text).toContain("Если возникнут вопросы, ответьте на это письмо");
      expect(mail.html).toContain("Добавить в календарь");
      expect(mail.html).toContain('href="https://cal.astforum.ru/reschedule/demo-7"');
      expect(mail.html).toContain(
        'href="https://cal.astforum.ru/booking/demo-7?cancel=true&amp;allRemainingBookings=false"'
      );
    }
  });
  it("rolls over to the next date in Moscow", () => {
    const mail = buildReminderMessage(
      { ...booking, startTime: new Date("2026-10-02T22:00Z"), endTime: new Date("2026-10-02T23:00Z") },
      payload(),
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    expect(mail.text).toContain("03.10.2026");
    expect(mail.text).toContain("01:00");
  });
  it("renders Moscow 24-hour time and the current meeting link", () => {
    const mail = buildReminderMessage(
      booking,
      payload(),
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    expect(mail.text).toContain("02.10.2026");
    expect(mail.text).toContain("15:00");
    expect(mail.text).toContain("МСК");
    expect(mail.text).toContain("60 мин");
    expect(mail.html).toContain('href="https://video.example.test/room"');
    expect(mail.to).toEqual({ name: "Анна", address: "anna@example.test" });
    expect(mail.from).toEqual({ name: "АСТ Форум", address: "notifications@astforum.ru" });
  });
  it("escapes names and prevents executable meeting URLs", () => {
    const mail = buildReminderMessage(
      { ...booking, name: '<img src=x onerror="alert(1)">', meetingUrl: "javascript:alert(1)" },
      payload(),
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("javascript:");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).toContain('href="https://cal.astforum.ru/booking/demo-7"');
  });
  it("uses a stable message ID per reminder, without exposing an email address in the ID", () => {
    const first = buildReminderMessage(
      booking,
      payload(),
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    const second = buildReminderMessage(
      { ...booking, name: "Новое имя" },
      payload(),
      "https://cal.astforum.ru",
      "notifications@astforum.ru"
    );
    expect(first.messageId).toBe(second.messageId);
    expect(first.messageId).not.toContain("anna");
  });
});
