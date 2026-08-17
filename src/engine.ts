import type {
  CapacityResult,
  ConfigEpic,
  DateRange,
  Holiday,
  HolidaysByZone,
  LeaveEntry,
  PlannerConfig,
} from './types';

const MS_PER_DAY = 86_400_000;
export const RATIO_DRAFT = /^\d*\.?\d*$/;

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatPlanningDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatHolidayDate(iso: string): string {
  return formatPlanningDate(iso);
}

export function formatSprintDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const startDay = startDate.getUTCDate();
  const endDay = endDate.getUTCDate();
  const startMonth = startDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const endMonth = endDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${startMonth}`;
  }
  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

export function eachDayInRange(startIso: string, endIso: string): Date[] {
  const days: Date[] = [];
  const start = parseDate(startIso);
  const end = parseDate(endIso);
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    days.push(new Date(t));
  }
  return days;
}

export function isWorkingDay(date: Date, workingDays: number[]): boolean {
  const dow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return workingDays.includes(dow);
}

export function flattenHolidays(byZone: HolidaysByZone): Holiday[] {
  return [
    ...byZone.US.map((holiday) => ({ ...holiday, zone: 'US' as const })),
    ...byZone.TH.map((holiday) => ({ ...holiday, zone: 'TH' as const })),
  ];
}

export function holidaysInWindow(holidays: Holiday[], window: DateRange): Holiday[] {
  return holidays
    .filter((holiday) => holiday.date >= window.start && holiday.date <= window.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function countWeekdaysInWindow(window: DateRange, workingDays: number[]): number {
  let total = 0;
  for (const day of eachDayInRange(window.start, window.end)) {
    if (isWorkingDay(day, workingDays)) total += 1;
  }
  return total;
}

export function teamSize(zones: ConfigEpic['zones']): number {
  return zones.Dev.members + zones.QA.members;
}

export function countWorkingDaysBetween(
  start: string | undefined,
  end: string | undefined,
  workingDays: number[],
): number {
  if (!start || !end || end < start) return 0;
  let total = 0;
  for (const day of eachDayInRange(start, end)) {
    if (isWorkingDay(day, workingDays)) total += 1;
  }
  return total;
}

export function leaveDaysForEntry(leave: LeaveEntry, workingDays: number[]): number {
  const start = leave.start ?? leave.date;
  const end = leave.end ?? leave.date ?? leave.start;
  if (start && end) {
    return countWorkingDaysBetween(start, end, workingDays);
  }
  return Math.max(0, Math.round(leave.days));
}

export function applyLeavePatch(
  leaves: LeaveEntry[],
  index: number,
  patch: Partial<LeaveEntry>,
  workingDays: number[],
): LeaveEntry[] {
  return leaves.map((leave, i) => {
    if (i !== index) return leave;
    const merged = { ...leave, ...patch };
    if (merged.start || merged.end) {
      const start = merged.start || merged.end || merged.date;
      const end = merged.end || merged.start || merged.date;
      const normalized = { ...merged, start, end, date: undefined };
      return { ...normalized, days: leaveDaysForEntry(normalized, workingDays) };
    }
    return { ...merged, days: leaveDaysForEntry(merged, workingDays) };
  });
}

export function addLeaveEntry(leaves: LeaveEntry[], windowStart: string): LeaveEntry[] {
  return [...leaves, { member: '', zone: 'QA', days: 1, start: windowStart, end: windowStart }];
}

export function removeLeaveEntry(leaves: LeaveEntry[], index: number): LeaveEntry[] {
  return leaves.filter((_, i) => i !== index);
}

export function clampSpRatio(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(0, value));
}

export function acceptRatioDraft(raw: string): string | null {
  const normalized = raw.replace(',', '.');
  if (normalized !== '' && !RATIO_DRAFT.test(normalized)) return null;
  return normalized;
}

export function ratioFromDraft(draft: string): number | undefined {
  if (draft === '' || draft === '.' || draft.endsWith('.')) return undefined;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function finalizeRatioDraft(draft: string, previous: number): number {
  const parsed = Number(draft);
  if (draft === '' || draft === '.' || !Number.isFinite(parsed) || parsed < 0) {
    return previous;
  }
  return clampSpRatio(parsed);
}

export function normalizeSpRate(rate: number | undefined): number {
  return typeof rate === 'number' && rate > 0 ? rate : 1;
}

export function roleSpRates(
  config: Pick<ConfigEpic, 'spPerManDay' | 'devSpPerManDay' | 'qaSpPerManDay' | 'zones'>,
): { dev: number; qa: number } {
  const shared = normalizeSpRate(config.spPerManDay);
  return {
    dev: normalizeSpRate(config.zones?.Dev?.ratio ?? config.devSpPerManDay ?? shared),
    qa: normalizeSpRate(config.zones?.QA?.ratio ?? config.qaSpPerManDay ?? shared),
  };
}

export function formatSpRate(rate: number | undefined): string {
  return String(Math.round(normalizeSpRate(rate) * 100) / 100);
}

export function manDaysToSp(manDays: number, ratio: number): number {
  return Math.round(Math.max(0, manDays) * normalizeSpRate(ratio));
}

export function roleCapacityBeforeCommit(
  members: number,
  workingDays: number,
  leaveDays: number,
  ratio: number,
): number {
  return manDaysToSp(Math.max(0, members * workingDays - leaveDays), ratio);
}

function holidaysForZone(holidays: Holiday[], zone: 'US' | 'TH'): Holiday[] {
  return holidays.filter((holiday) => (holiday.zone ?? 'US') === zone);
}

function countHolidayWeekdaysInWindow(
  window: DateRange,
  holidays: Holiday[],
  workingDays: number[],
): number {
  const holidayDates = new Set(holidaysInWindow(holidays, window).map((holiday) => holiday.date));
  let count = 0;
  for (const day of eachDayInRange(window.start, window.end)) {
    if (!isWorkingDay(day, workingDays)) continue;
    if (holidayDates.has(formatIso(day))) count += 1;
  }
  return count;
}

export function leaveDaysForZone(leaves: LeaveEntry[], zone: 'Dev' | 'QA'): number {
  return leaves
    .filter((leave) => leave.zone === zone)
    .reduce((sum, leave) => sum + Math.max(0, Math.round(leave.days)), 0);
}

export function countWorkingDays(
  window: DateRange,
  holidays: Holiday[],
  workingDays: number[],
): { workingDays: number; holidayDaysInWindow: number; totalManDays: number } {
  const totalManDays = countWeekdaysInWindow(window, workingDays);
  const holidayDaysInWindow = countHolidayWeekdaysInWindow(
    window,
    holidaysForZone(holidays, 'TH'),
    workingDays,
  );
  return {
    totalManDays,
    holidayDaysInWindow,
    workingDays: Math.max(0, totalManDays - holidayDaysInWindow),
  };
}

export function computeZoneCapacity(
  window: DateRange,
  configEpic: ConfigEpic,
  holidays: Holiday[],
  plannerConfig: PlannerConfig,
): CapacityResult {
  const workingDaysConfig = plannerConfig['working-days'];
  const { totalManDays, holidayDaysInWindow, workingDays } = countWorkingDays(
    window,
    holidays,
    workingDaysConfig,
  );

  const usMembers = Math.max(0, configEpic.zones.Dev.members);
  const thMembers = Math.max(0, configEpic.zones.QA.members);
  const leaveDays = configEpic.leaves.reduce(
    (sum, leave) => sum + Math.max(0, Math.round(leave.days)),
    0,
  );
  const leaveDaysDev = leaveDaysForZone(configEpic.leaves, 'Dev');
  const leaveDaysQa = leaveDaysForZone(configEpic.leaves, 'QA');
  const commit = configEpic.capacityCommitPercent;
  const rates = roleSpRates(configEpic);
  const roleCapacityDev = roleCapacityBeforeCommit(usMembers, workingDays, leaveDaysDev, rates.dev);
  const roleCapacityQa = roleCapacityBeforeCommit(thMembers, workingDays, leaveDaysQa, rates.qa);
  const totalCapacity = roleCapacityDev + roleCapacityQa;
  const availableSp = Math.round(totalCapacity * commit);
  const availableSpQa = Math.round(roleCapacityQa * commit);
  const availableSpDev = availableSp - availableSpQa;

  return {
    totalManDays,
    workingDays,
    holidayDaysInWindow,
    leaveDays,
    leaveDaysDev,
    leaveDaysQa,
    roleCapacityDev,
    roleCapacityQa,
    totalCapacity,
    availableSp,
    availableSpDev,
    availableSpQa,
    usMembers,
    thMembers,
    devMembers: usMembers,
    qaMembers: thMembers,
  };
}

export function initialConfigEpic(raw: {
  window: DateRange;
  capacityCommitPercent: number;
  spPerManDay: number;
  zones: ConfigEpic['zones'];
  leaves: LeaveEntry[];
  sprints: ConfigEpic['sprints'];
}): ConfigEpic {
  return {
    ...raw,
    devSpPerManDay: raw.zones.Dev.ratio,
    qaSpPerManDay: raw.zones.QA.ratio,
  };
}
