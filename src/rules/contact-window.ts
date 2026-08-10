import type { ContactPurpose, GuardrailRule } from "../types.js";
import { PROMOTIONAL_PURPOSES, result } from "./shared.js";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TimeRange {
  /** Inclusive local time in HH:MM format. */
  readonly start: string;
  /** Exclusive local time in HH:MM format. */
  readonly end: string;
}

export type WeeklySchedule = Readonly<Partial<Record<Weekday, readonly TimeRange[]>>>;

export interface ContactWindowRuleOptions {
  readonly id?: string;
  readonly schedule: WeeklySchedule;
  readonly purposes?: readonly ContactPurpose[];
}

interface ParsedRange {
  readonly start: number;
  readonly end: number;
}

interface ZonedLocalTime {
  readonly weekday: Weekday;
  readonly minutes: number;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function parseTime(value: string): number {
  if (!TIME_PATTERN.test(value)) {
    throw new Error(`Invalid local time: ${value}`);
  }
  const [hoursText, minutesText] = value.split(":");
  return Number(hoursText) * 60 + Number(minutesText);
}

function parseSchedule(schedule: WeeklySchedule): Readonly<Record<Weekday, readonly ParsedRange[]>> {
  return Object.fromEntries(
    WEEKDAYS.map((weekday) => [
      weekday,
      (schedule[weekday] ?? []).map((range) => {
        const parsed = { start: parseTime(range.start), end: parseTime(range.end) };
        if (parsed.start === parsed.end) {
          throw new Error("A contact window cannot have the same start and end time.");
        }
        return parsed;
      }),
    ]),
  ) as unknown as Readonly<Record<Weekday, readonly ParsedRange[]>>;
}

function localTimeAt(instant: Date, timezone: string): ZonedLocalTime | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
      parts.find((candidate) => candidate.type === type)?.value;
    const weekdayText = part("weekday")?.toLocaleLowerCase("en-US") as Weekday | undefined;
    const hours = Number(part("hour"));
    const minutes = Number(part("minute"));

    if (!weekdayText || !WEEKDAYS.includes(weekdayText) || !Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return null;
    }

    return { weekday: weekdayText, minutes: hours * 60 + minutes };
  } catch {
    return null;
  }
}

function isInsideSchedule(
  local: ZonedLocalTime,
  schedule: Readonly<Record<Weekday, readonly ParsedRange[]>>,
): boolean {
  const currentDayIndex = WEEKDAYS.indexOf(local.weekday);
  const previousDay = WEEKDAYS[(currentDayIndex + 6) % 7];
  if (!previousDay) return false;

  const currentRanges = schedule[local.weekday];
  for (const range of currentRanges) {
    if (range.start < range.end && local.minutes >= range.start && local.minutes < range.end) {
      return true;
    }
    if (range.start > range.end && local.minutes >= range.start) {
      return true;
    }
  }

  for (const range of schedule[previousDay]) {
    if (range.start > range.end && local.minutes < range.end) {
      return true;
    }
  }

  return false;
}

export function createContactWindowRule(options: ContactWindowRuleOptions): GuardrailRule {
  const id = options.id ?? "contact.local-window";
  const schedule = parseSchedule(options.schedule);
  const purposes = options.purposes ?? PROMOTIONAL_PURPOSES;

  return {
    id,
    description: "Allows promotional contact only in configured local-time windows.",
    evaluate({ action }) {
      if (!purposes.includes(action.purpose)) {
        return result(id, "allow", "PURPOSE_NOT_APPLICABLE", "Contact window does not apply to this purpose.");
      }

      const instant = new Date(action.scheduledAt);
      const local = localTimeAt(instant, action.customer.timezone);
      if (!local) {
        return result(id, "block", "INVALID_TIMEZONE", "The customer time zone could not be evaluated.");
      }

      if (!isInsideSchedule(local, schedule)) {
        return result(
          id,
          "block",
          "OUTSIDE_CONTACT_WINDOW",
          "The proposed contact is outside the configured local-time window.",
          { localWeekday: local.weekday, localMinutesAfterMidnight: local.minutes },
        );
      }

      return result(id, "allow", "WITHIN_CONTACT_WINDOW", "The proposed contact is within the configured window.");
    },
  };
}
