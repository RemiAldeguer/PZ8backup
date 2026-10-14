import type { AppData, Resource, TimeEntry } from './types';
import { normalizeResource } from './resources';

export interface PlanzonePreferences {
  id: 'planzone-preferences'; version: number;
  automaticTimeIntegration: boolean;
  allocationInDays: boolean;
  blockIntegratedDates: boolean;
  showTimeSheetProgress: boolean;
  extendAcrossNonWorkingDays: boolean;
  allowSelfAssignment: boolean;
  linkAllocationToDuration: boolean;
  criticalDailySpanHours: number;
  criticalDailyWorkHours: number;
  minimumRestHours: number;
  warnDuringUnavailability: boolean;
  viewRoles?: import('./view-access').ViewRoleAssignments;
}

/** Absent settings retain the existing application's behaviour. */
export const DEFAULT_PLANZONE_PREFERENCES: Readonly<PlanzonePreferences> = {
  id: 'planzone-preferences', version: 0, automaticTimeIntegration: true,
  allocationInDays: false, blockIntegratedDates: true, showTimeSheetProgress: false,
  extendAcrossNonWorkingDays: false, allowSelfAssignment: true, linkAllocationToDuration: false,
  criticalDailySpanHours: 0, criticalDailyWorkHours: 0, minimumRestHours: 0, warnDuringUnavailability: false,
};
export function planzonePreferences(data: Pick<AppData, 'planzonePreferences'>): PlanzonePreferences {
  return { ...DEFAULT_PLANZONE_PREFERENCES, ...data.planzonePreferences?.[0] };
}
export function projectTimeEntries(data: Pick<AppData, 'planzonePreferences' | 'timeEntries'>): TimeEntry[] {
  return planzonePreferences(data).automaticTimeIntegration ? data.timeEntries : data.timeEntries.filter(entry => entry.validated);
}
export function allocationHoursPerDay(resource?: Resource): number { return resource ? normalizeResource(resource).hoursPerDay : 8; }
export function manuallyValidated(entry: TimeEntry): boolean { return entry.manuallyValidated ?? (entry.validated && !entry.integrationValidated); }
export function timeEntryLocked(data: Pick<AppData, 'planzonePreferences'>, entry: TimeEntry): boolean {
  return manuallyValidated(entry) || Boolean(planzonePreferences(data).blockIntegratedDates && entry.integrationValidated);
}
