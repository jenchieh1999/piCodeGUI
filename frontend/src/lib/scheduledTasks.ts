import type { ScheduledTask } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function timeToCron(time: string): string {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = clampInt(hourRaw, 0, 23, 9);
  const minute = clampInt(minuteRaw, 0, 59, 0);
  return `${minute} ${hour} * * *`;
}

export function cronToTime(cronExpression: string): string {
  const { hour, minute } = parseDailyCron(cronExpression);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function computeNextRunAt(
  cronExpression: string,
  daysOfWeek: number[],
  from = Date.now()
): number {
  const { hour, minute } = parseDailyCron(cronExpression);
  const normalizedDays = normalizeDays(daysOfWeek);
  const start = new Date(from);

  for (let offset = 0; offset <= 14; offset++) {
    const candidate = new Date(start.getTime() + offset * DAY_MS);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= from) continue;
    if (normalizedDays.length > 0 && !normalizedDays.includes(candidate.getDay())) continue;
    return candidate.getTime();
  }

  const fallback = new Date(from + DAY_MS);
  fallback.setHours(hour, minute, 0, 0);
  return fallback.getTime();
}

export function describeTaskSchedule(task: Pick<ScheduledTask, 'cronExpression' | 'daysOfWeek'>): string {
  const time = cronToTime(task.cronExpression);
  const days = normalizeDays(task.daysOfWeek);
  if (days.length === 0 || days.length === 7) return `Every day at ${time}`;
  return `${days.map((day) => WEEKDAY_LABELS[day]).join(', ')} at ${time}`;
}

export function normalizeDays(days: number[]): number[] {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b);
}

function parseDailyCron(cronExpression: string): { hour: number; minute: number } {
  const [minuteRaw, hourRaw] = cronExpression.trim().split(/\s+/);
  return {
    hour: clampInt(hourRaw, 0, 23, 9),
    minute: clampInt(minuteRaw, 0, 59, 0),
  };
}

function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
