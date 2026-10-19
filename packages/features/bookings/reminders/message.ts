import process from "node:process";
import { buildStandardCancelLink, buildStandardRescheduleLink } from "@calcom/lib/LinkBuilder";
import { type Reminder, type ReminderBooking, reminderKey } from "./policy";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );

export function buildReminderMessage(
  booking: ReminderBooking,
  reminder: Reminder,
  baseUrl: string,
  from: string
) {
  const bookingUrl = new URL(`/booking/${encodeURIComponent(booking.uid)}`, baseUrl).href;
  let meetingUrl = bookingUrl;
  try {
    const url = new URL(booking.meetingUrl ?? "");
    if (["http:", "https:"].includes(url.protocol)) meetingUrl = url.href;
  } catch {
    /* Missing meeting URL: the booking page remains usable. */
  }
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(booking.startTime);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(booking.startTime);
  const subject = {
    1440: "АСТ Форум — завтра ждем Вас на демо",
    60: "АСТ Форум — через час ждем Вас на демо",
    15: "АСТ Форум — уже ждём Вас на демо",
  }[reminder.minutesBefore];
  const duration = Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000);
  const intro =
    reminder.minutesBefore === 15
      ? `${booking.name}, скоро начинаем. Встречаемся ${date} в ${time}, МСК (GMT+3). Проверьте подключение к интернету и звук.`
      : `${booking.name}, напоминаем: демонстрация начнётся ${date} в ${time}, МСК (GMT+3). Продолжительность: ${duration} мин. Подключайтесь по ссылке в назначенное время.`;
  const actions = [{ label: "Подключиться к встрече", url: meetingUrl }];
  if (reminder.minutesBefore !== 15) {
    // The booking page offers calendar downloads using the current saved version.
    actions.push(
      { label: "Добавить в календарь", url: bookingUrl },
      {
        label: "Перенести на другое время",
        url: buildStandardRescheduleLink({ bookerUrl: baseUrl, uid: booking.uid }),
      },
      { label: "Отменить встречу", url: buildStandardCancelLink({ bookerUrl: baseUrl, uid: booking.uid }) }
    );
  }
  const closing = reminder.minutesBefore === 15 ? "" : "Если возникнут вопросы, ответьте на это письмо";
  return {
    from: { name: process.env.EMAIL_FROM_NAME || "АСТ Форум", address: from },
    to: { name: booking.name, address: booking.email },
    subject,
    text: [intro, ...actions.map((action) => `${action.label}: ${action.url}`), closing]
      .filter(Boolean)
      .join("\n\n"),
    html: `<div lang="ru" style="font-family:Arial,sans-serif;line-height:1.6;color:#172b4d"><p>${escapeHtml(intro)}</p>${actions.map((action) => `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>`).join("")}${closing ? `<p>${closing}</p>` : ""}</div>`,
    messageId: `<booking-reminder-${reminderKey(reminder)}@${new URL(baseUrl).hostname}>`,
  };
}
