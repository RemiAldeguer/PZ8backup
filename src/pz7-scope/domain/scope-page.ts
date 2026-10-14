import type { ProjectSummary, ScopePage, ZoneSummary } from "../client";

export function checkedScopePage<T extends ZoneSummary | ProjectSummary>(page: ScopePage<T>, planzoneId: string, zoneId?: string | null) {
  if (page.items.some(item => item.planzoneId !== planzoneId || (zoneId && "zoneId" in item && item.zoneId !== zoneId))) {
    throw { status: 502, code: "INVALID_SCOPE" };
  }
  return page;
}
