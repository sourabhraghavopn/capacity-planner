export interface Holiday {
  date: string;
  name: string;
  zone?: 'US' | 'TH';
}

export interface HolidayEntry {
  date: string;
  name: string;
}

export interface HolidaysByZone {
  US: HolidayEntry[];
  TH: HolidayEntry[];
}

export interface PlannerConfig {
  'default-window': { start: string; end: string };
  'team-members': number;
  'capacity-factor': number;
  'sp-per-man-day': number;
  'working-days': number[];
}

export interface ZoneMembers {
  members: number;
  ratio: number;
}

export interface LeaveEntry {
  member: string;
  zone: 'Dev' | 'QA';
  days: number;
  date?: string;
  start?: string;
  end?: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface PlanningSprint {
  key: string;
  name: string;
  start: string;
  end: string;
}

export interface ConfigEpic {
  window: DateRange;
  capacityCommitPercent: number;
  spPerManDay: number;
  devSpPerManDay: number;
  qaSpPerManDay: number;
  zones: { Dev: ZoneMembers; QA: ZoneMembers };
  leaves: LeaveEntry[];
  sprints: PlanningSprint[];
}

export type UtilisationTier = 'headroom' | 'tight' | 'overload';

export interface CapacityResult {
  totalManDays: number;
  workingDays: number;
  holidayDaysInWindow: number;
  leaveDays: number;
  leaveDaysDev: number;
  leaveDaysQa: number;
  roleCapacityDev: number;
  roleCapacityQa: number;
  totalCapacity: number;
  availableSp: number;
  availableSpDev: number;
  availableSpQa: number;
  usMembers: number;
  thMembers: number;
  devMembers: number;
  qaMembers: number;
}

export interface WorkSp {
  dev: number;
  qa: number;
}
