import { addDays, weekDates } from "./fiscal.ts";

const DAY_MS = 86_400_000;

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday + 7 - first) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const offset = (lastWeekday + 7 - weekday) % 7;
  return `${year}-${pad(month)}-${pad(lastDay - offset)}`;
}

function observeFixed(year: number, month: number, day: number): string {
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = weekdayOf(dateStr);
  if (weekday === 6) return addDays(dateStr, -1);
  if (weekday === 0) return addDays(dateStr, 1);
  return dateStr;
}

export interface ObservedHoliday {
  name: string;
  date: string;
}

export function computeObservedHolidays(year: number): ObservedHoliday[] {
  const holidays: ObservedHoliday[] = [
    { name: "New Year's Day", date: observeFixed(year, 1, 1) },
    { name: "Memorial Day", date: lastWeekdayOfMonth(year, 5, 1) },
    { name: "Independence Day", date: observeFixed(year, 7, 4) },
    { name: "Labor Day", date: nthWeekdayOfMonth(year, 9, 1, 1) },
    { name: "Thanksgiving", date: nthWeekdayOfMonth(year, 11, 4, 4) },
    { name: "Christmas", date: observeFixed(year, 12, 25) },
  ];

  return holidays
    .filter((h) => h.date.startsWith(String(year)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function deadlineForWeek(
  weekStartDate: string,
  holidays: string[],
): string {
  const normalDeadline = addDays(weekStartDate, 12);
  if (holidays.includes(normalDeadline)) {
    return addDays(normalDeadline, -3);
  }
  return normalDeadline;
}

export function expectedHours(
  weekStartDate: string,
  standardWeeklyHours: number,
  holidays: string[],
): number {
  const days = weekDates(weekStartDate);
  const holidayCount = days.filter((d) => holidays.includes(d)).length;
  const adjusted = standardWeeklyHours - (standardWeeklyHours / 5) * holidayCount;
  return Math.round(adjusted * 4) / 4;
}

export function isHoliday(dateStr: string, holidays: string[]): boolean {
  return holidays.includes(dateStr);
}

export { DAY_MS };
