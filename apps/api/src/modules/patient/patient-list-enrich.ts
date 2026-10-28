/**
 * 환자 목록 행 덧붙임(2026-10-20 환자 목록 P3 · `patients-list-refinement-2026-10.plan.md` B2·B4·B5).
 * 한 쪽(≤100행)의 환자 id 로 묶어서 읽는다 — 행마다 따로 부르지 않는다(N+1 금지).
 *
 *  - 최근 방문: 서명된 진료(SIGNED·AMENDED)의 가장 최근 생성 시각 — 작성 중 기록은 방문으로 세지 않는다. 없으면 null.
 *  - 다음 예약: 지금 이후 예정·확정·접수 예약 중 가장 이른 것. 없으면 null.
 *  - 지금 머무는 곳: 재원(입원 ADMITTED · 병동/호실) · 응급 진행(COMPLETED 아님) — 현재 위치 판정 정본(`floor/current-location.ts`)이
 *    "여러 날 머무는 자리"로 보는 두 근거와 같다. 구역 단위 위치는 3D·상황판 몫(목록은 머무는 근거만).
 *  - 알레르기 확인 상태: 단건 조회와 같은 규칙(`deriveAllergyStatus`) · 🔴 조회 권한 역할(ALLERGY_STATUS_ROLES)일 때만 낸다.
 *  - 오래된 작성 중 기록(2026-10-20 P4 B6): `STALE_DRAFT_DAYS` 일 넘게 서명되지 않은 진료(DRAFT) — 의사는 **본인이 작성한 것만**,
 *    관리자는 작성자와 무관하게 수만. 다른 역할은 칸이 없다(권한 밖 = undefined · 0 이 아니다).
 */
import { deriveAllergyStatus } from '../allergy/allergy-status-derive';
import type { AllergyStatusKey } from '@hospital-run/shared';

/** 작성 중 기록을 "오래됐다"고 말하는 기준(일) — 표시 신호일 뿐 정책이 아니다(회수 알림 크론 기준은 `encounter.draftReminder.*`) */
export const STALE_DRAFT_DAYS = 7;

/** 오래된 작성 중 기록 범위 — MINE = 열람 의사가 작성한 것만 · ALL = 작성자 무관(관리자) */
export type StaleDraftScope = { mode: 'MINE'; userId: string } | { mode: 'ALL' } | null;

export interface ListRowExtras {
  lastVisitAt: string | null;
  nextAppointment: { at: string; department: string | null } | null;
  stay: { kind: 'ADMITTED'; ward: string | null; room: string | null; bed: string | null } | { kind: 'ER'; status: string } | null;
  /** 권한 밖이면 칸 자체가 없다(undefined) — null 이 아니다 */
  allergyStatus?: AllergyStatusKey;
  /** 최신 문진 시각 — 초록(확인했고 없음)은 문진 기록이 있을 때만(`allergyStatusIsReassuring`) */
  allergyAssessedAt?: string | null;
  /** 오래된 작성 중 기록 — 권한 밖이면 칸 없음 · 있으면 수와 가장 오래된 작성 시각(없으면 count 0 · oldestAt null) */
  staleDrafts?: { count: number; oldestAt: string | null };
}

type Db = {
  encounter: { groupBy: (a: unknown) => Promise<unknown[]> };
  appointment: { findMany: (a: unknown) => Promise<unknown[]> };
  admission: { findMany: (a: unknown) => Promise<unknown[]> };
  emergencyVisit: { findMany: (a: unknown) => Promise<unknown[]> };
  allergy: { groupBy: (a: unknown) => Promise<unknown[]> };
  allergyAssessment: { findMany: (a: unknown) => Promise<unknown[]> };
};

export async function listRowExtras(db: Db, ids: string[], opts: { allergy: boolean; staleDrafts?: StaleDraftScope; now?: Date }): Promise<Map<string, ListRowExtras>> {
  const out = new Map<string, ListRowExtras>();
  if (!ids.length) return out;
  const now = opts.now ?? new Date();
  const stale = opts.staleDrafts ?? null;
  const [visits, appts, adms, ers, activeAllergies, allergyChanges, assessments, staleRows] = await Promise.all([
    db.encounter.groupBy({ by: ['patientId'], where: { patientId: { in: ids }, status: { in: ['SIGNED', 'AMENDED'] } }, _max: { createdAt: true } }),
    db.appointment.findMany({
      where: { patientId: { in: ids }, scheduledAt: { gte: now }, status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] } },
      orderBy: { scheduledAt: 'asc' },
      select: { patientId: true, scheduledAt: true, departmentName: true },
    }),
    db.admission.findMany({
      where: { patientId: { in: ids }, status: 'ADMITTED' },
      select: { patientId: true, bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } } },
    }),
    db.emergencyVisit.findMany({ where: { patientId: { in: ids }, status: { not: 'COMPLETED' } }, select: { patientId: true, status: true } }),
    opts.allergy ? db.allergy.groupBy({ by: ['patientId'], where: { patientId: { in: ids }, isActive: true }, _count: { _all: true } }) : Promise.resolve([]),
    opts.allergy ? db.allergy.groupBy({ by: ['patientId'], where: { patientId: { in: ids } }, _max: { updatedAt: true } }) : Promise.resolve([]),
    opts.allergy
      ? db.allergyAssessment.findMany({ where: { patientId: { in: ids } }, orderBy: { assessedAt: 'desc' }, distinct: ['patientId'], select: { patientId: true, result: true, assessedAt: true } })
      : Promise.resolve([]),
    stale
      ? db.encounter.groupBy({
          by: ['patientId'],
          where: {
            patientId: { in: ids }, status: 'DRAFT', createdAt: { lt: new Date(now.getTime() - STALE_DRAFT_DAYS * 86_400_000) },
            ...(stale.mode === 'MINE' ? { doctorId: stale.userId } : {}),
          },
          _count: { _all: true }, _min: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const byId = <T extends { patientId: string }>(rows: unknown[]) => {
    const m = new Map<string, T>();
    for (const r of rows as T[]) if (!m.has(r.patientId)) m.set(r.patientId, r);
    return m;
  };
  const visitM = byId<{ patientId: string; _max: { createdAt: Date | null } }>(visits);
  const apptM = byId<{ patientId: string; scheduledAt: Date; departmentName: string | null }>(appts);
  const admM = byId<{ patientId: string; bed: { roomNumber: string; bedNumber: string; ward: { name: string } | null } | null }>(adms);
  const erM = byId<{ patientId: string; status: string }>(ers);
  const activeM = byId<{ patientId: string; _count: { _all: number } }>(activeAllergies);
  const changeM = byId<{ patientId: string; _max: { updatedAt: Date | null } }>(allergyChanges);
  const assessM = byId<{ patientId: string; result: string; assessedAt: Date }>(assessments);
  const staleM = byId<{ patientId: string; _count: { _all: number }; _min: { createdAt: Date | null } }>(staleRows);

  for (const id of ids) {
    const v = visitM.get(id)?._max.createdAt ?? null;
    const a = apptM.get(id);
    const adm = admM.get(id);
    const er = erM.get(id);
    const row: ListRowExtras = {
      lastVisitAt: v ? new Date(v).toISOString() : null,
      nextAppointment: a ? { at: new Date(a.scheduledAt).toISOString(), department: a.departmentName ?? null } : null,
      stay: adm
        ? { kind: 'ADMITTED', ward: adm.bed?.ward?.name ?? null, room: adm.bed?.roomNumber ?? null, bed: adm.bed?.bedNumber ?? null }
        : er ? { kind: 'ER', status: er.status } : null,
    };
    if (opts.allergy) {
      const latest = assessM.get(id);
      row.allergyStatus = deriveAllergyStatus({
        activeCount: activeM.get(id)?._count._all ?? 0,
        latest: latest ? { result: String(latest.result), assessedAt: new Date(latest.assessedAt) } : null,
        lastAllergyChangeAt: changeM.get(id)?._max.updatedAt ?? null,
      });
      row.allergyAssessedAt = latest ? new Date(latest.assessedAt).toISOString() : null;
    }
    if (stale) {
      const sd = staleM.get(id);
      row.staleDrafts = { count: sd?._count._all ?? 0, oldestAt: sd?._min.createdAt ? new Date(sd._min.createdAt).toISOString() : null };
    }
    out.set(id, row);
  }
  return out;
}
