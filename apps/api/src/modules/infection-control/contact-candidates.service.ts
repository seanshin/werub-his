import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CONTACT_WINDOW_DAYS, OBSERVED_LOCATION_SOURCES, type ContactCandidateGrade } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { InfectionControlService } from './infection-control.service';

/**
 * 위치 겹침 감염 접촉자 **후보**(기획 `spatial-flow-vision-3d.plan.md` P5 · 결정 `infection.contactCandidates`).
 *
 * 🔴 규칙:
 *   - 설정 `infection.contactCandidates.enabled` 가 꺼져 있으면(기본) **조회하지 않는다**(`enabled:false`).
 *   - 지표 환자의 **떠난 시각이 있는 구역 단위** 구간만 쓴다 — 열린 구간·층 단위·시뮬레이션·출처 미상은 빼고 뺀 수를 낸다.
 *   - 추정 겹침은 설정 `…includeInferred` 가 켜졌고 화면이 요청할 때만, **별도 등급**(INFERRED)으로.
 *   - 🔴 "후보 0" 과 "볼 수 있는 위치가 없음"을 구분한다 — 지표 환자의 구간이 0 이면 `indexIntervals` 가 그렇게 말한다.
 *   - 확정·격리·통보를 하지 않는다(쓰기 없음). 해상도는 구역 — 같은 방이라도 거리는 모른다.
 */
@Injectable()
export class ContactCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  private async flag(key: string): Promise<boolean> {
    const v = await this.config?.get(key);
    return v === true || v === 'true';
  }

  async candidates(patientId: string, daysRaw?: string, wantInferred?: boolean) {
    const enabled = await this.flag('infection.contactCandidates.enabled');
    if (!enabled) return { enabled: false as const };
    const days = daysRaw == null || daysRaw === '' ? CONTACT_WINDOW_DAYS.default : Number(daysRaw);
    if (!Number.isInteger(days) || days < CONTACT_WINDOW_DAYS.min || days > CONTACT_WINDOW_DAYS.max) {
      throw new BadRequestException({ code: 'CONTACT_DAYS_INVALID', min: CONTACT_WINDOW_DAYS.min, max: CONTACT_WINDOW_DAYS.max });
    }
    const inferredAllowed = await this.flag('infection.contactCandidates.includeInferred');
    const includeInferred = inferredAllowed && wantInferred === true;
    const since = new Date(Date.now() - days * 86_400_000);
    const observed = Prisma.join([...OBSERVED_LOCATION_SOURCES]);

    const idx = await this.prisma.$queryRaw<Array<{ observed: number; inferred: number; openExcluded: number; floorExcluded: number; otherExcluded: number }>>`
      SELECT count(*) FILTER (WHERE granularity = 'ZONE' AND left_at > entered_at AND source IN (${observed}))::int AS observed,
             count(*) FILTER (WHERE granularity = 'ZONE' AND left_at > entered_at AND source = 'INFERRED_EVENT')::int AS inferred,
             count(*) FILTER (WHERE left_at IS NULL)::int AS "openExcluded",
             count(*) FILTER (WHERE granularity = 'FLOOR' AND left_at IS NOT NULL)::int AS "floorExcluded",
             count(*) FILTER (WHERE source IN ('SIMULATED', 'UNKNOWN'))::int AS "otherExcluded"
        FROM patient_locations
       WHERE patient_id = ${patientId}::uuid AND entered_at >= ${since}`;
    const indexIntervals = idx[0] ?? { observed: 0, inferred: 0, openExcluded: 0, floorExcluded: 0, otherExcluded: 0 };

    const rows = await this.prisma.$queryRaw<Array<{
      patientId: string; familyName: string | null; givenName: string | null; mrn: string | null;
      grade: ContactCandidateGrade; overlaps: number; overlapMinutes: number; zones: string[]; firstAt: Date;
    }>>`
      WITH idx AS (
        SELECT zone_id, entered_at, left_at, (source IN (${observed})) AS obs
          FROM patient_locations
         WHERE patient_id = ${patientId}::uuid AND entered_at >= ${since}
           AND granularity = 'ZONE' AND left_at > entered_at
           AND (source IN (${observed}) OR (${includeInferred} AND source = 'INFERRED_EVENT'))
      ), pairs AS (
        SELECT o.patient_id, o.zone_id,
               (i.obs AND o.source IN (${observed})) AS both_obs,
               greatest(o.entered_at, i.entered_at) AS s,
               least(o.left_at, i.left_at) AS e
          FROM idx i
          JOIN patient_locations o
            ON o.zone_id = i.zone_id AND o.patient_id <> ${patientId}::uuid
           AND o.granularity = 'ZONE' AND o.left_at > o.entered_at
           AND o.entered_at < i.left_at AND o.left_at > i.entered_at
           AND (o.source IN (${observed}) OR (${includeInferred} AND o.source = 'INFERRED_EVENT'))
      )
      SELECT p.patient_id::text AS "patientId", pt.family_name AS "familyName", pt.given_name AS "givenName", pt.mrn,
             CASE WHEN bool_or(p.both_obs) THEN 'OBSERVED' ELSE 'INFERRED' END AS grade,
             count(*)::int AS overlaps,
             round((sum(extract(epoch FROM p.e - p.s)) / 60)::numeric)::int AS "overlapMinutes",
             array_agg(DISTINCT sn.name) AS zones,
             min(p.s) AS "firstAt"
        FROM pairs p
        JOIN patients pt ON pt.id = p.patient_id
        LEFT JOIN space_nodes sn ON sn.id = p.zone_id
       GROUP BY p.patient_id, pt.family_name, pt.given_name, pt.mrn`;

    // 이미 접촉자로 등록된(미해소) 후보 — 두 번 누르지 않게 화면이 표시한다(등록 경로가 중복을 거절하기도 한다)
    const ids = rows.map((r) => r.patientId);
    const registeredRows = ids.length
      ? await this.prisma.infectionSurveillance.findMany({
          where: { patientId: { in: ids }, resolvedAt: null, infectionType: { startsWith: InfectionControlService.CONTACT_TRACE_PREFIX } },
          select: { patientId: true },
        })
      : [];
    const registered = new Set(registeredRows.map((r) => r.patientId));
    const candidates = [...rows].map((r) => ({ ...r, registered: registered.has(r.patientId) })).sort((a, b) =>
      (a.grade === b.grade ? 0 : a.grade === 'OBSERVED' ? -1 : 1) || b.overlapMinutes - a.overlapMinutes || a.patientId.localeCompare(b.patientId));
    return {
      enabled: true as const,
      windowDays: days,
      since: since.toISOString(),
      inferredAllowed,
      includeInferred,
      indexIntervals,
      candidates,
    };
  }
}
