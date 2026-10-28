import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AdmissionVitalsReader } from '../../src/modules/vitals/admission-vitals.reader';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';
import { QI_SUPPLIERS, qiChartKindFor } from '@hospital-run/shared';

/**
 * 입원 활력 두 원장 정본 + 간호 과정 지표(2026-10-10).
 * 🔴 간호 스테이션 'VS 일괄'·차트 빠른 입력은 외래 원장(PreVisitVitals)에, 플로시트·워크스테이션은 입원 원장(FlowSheetEntry)에 썼다 —
 *    서로 상대 원장의 활력을 "기록 없음"이라 말했다(운영 실측: 재원 기간 안 외래 원장 행 27).
 */

const ADM = { id: 'a1', patientId: 'p1', admitDate: new Date('2026-10-01T00:00:00Z'), dischargeDate: new Date('2026-10-05T00:00:00Z') };

function prisma(fs: any[], pv: any[]) {
  return {
    flowSheetEntry: { findMany: vi.fn(async (a: any) => (a.distinct ? fs.slice(0, 1) : fs)) },
    preVisitVitals: {
      findMany: vi.fn(async () => pv),
      findFirst: vi.fn(async () => pv[0] ?? null),
    },
  };
}

describe('AdmissionVitalsReader — 한 재원의 활력 = 두 원장', () => {
  it('🔴 외래 원장은 재원 기간(입원 이상 · 퇴원 미만)으로만 조회한다', async () => {
    const p = prisma([], []);
    await new AdmissionVitalsReader(p as never).rows([ADM]);
    expect(p.preVisitVitals.findMany.mock.calls[0][0].where.OR).toEqual([{ patientId: 'p1', measuredAt: { gte: ADM.admitDate, lt: ADM.dischargeDate } }]);
  });

  it('요청 창과 재원 기간의 교집합 — 겹치지 않으면 외래 원장을 조회하지 않는다', async () => {
    const p = prisma([], []);
    const r = new AdmissionVitalsReader(p as never);
    await r.rows([ADM], { gte: new Date('2026-10-03T00:00:00Z'), lt: new Date('2026-10-10T00:00:00Z') });
    expect(p.preVisitVitals.findMany.mock.calls[0][0].where.OR[0].measuredAt).toEqual({ gte: new Date('2026-10-03T00:00:00Z'), lt: ADM.dischargeDate });
    p.preVisitVitals.findMany.mockClear();
    await r.rows([ADM], { gte: new Date('2026-10-06T00:00:00Z') });
    expect(p.preVisitVitals.findMany).not.toHaveBeenCalled();
  });

  it('합쳐 최근 순 · 행마다 원장 · 값은 그대로(결측 null · 체온 숫자)', async () => {
    const p = prisma(
      [{ id: 'fs1', admissionId: 'a1', nurseId: 'n1', recordedAt: new Date('2026-10-02T00:00:00Z'), heartRate: 0, temperature: '36.8', consciousness: 'ALERT' }],
      [{ id: 'pv1', patientId: 'p1', nurseId: 'n2', measuredAt: new Date('2026-10-03T00:00:00Z'), heartRate: 90, temperature: null }],
    );
    const rows = await new AdmissionVitalsReader(p as never).rows([ADM]);
    expect(rows.map((r) => [r.id, r.ledger])).toEqual([['pv1', 'PREVISIT'], ['fs1', 'FLOWSHEET']]);
    expect(rows[1]).toMatchObject({ heartRate: 0, temperature: 36.8, consciousness: 'ALERT' });
    expect(rows[0]).toMatchObject({ temperature: null, consciousness: null, admissionId: 'a1' });
  });

  it('🔴 재원 밖 외래 측정은 어느 재원에도 붙이지 않는다(조회가 넓게 와도)', async () => {
    const p = prisma([], [{ id: 'pv-out', patientId: 'p1', nurseId: 'n', measuredAt: new Date('2026-09-20T00:00:00Z') }]);
    expect(await new AdmissionVitalsReader(p as never).rows([ADM])).toEqual([]);
  });

  it('최신 — 두 원장 중 더 늦은 것 · 없으면 Map 에 없다', async () => {
    const p = prisma(
      [{ id: 'fs1', admissionId: 'a1', nurseId: 'n1', recordedAt: new Date('2026-10-02T00:00:00Z') }],
      [{ id: 'pv1', patientId: 'p1', nurseId: 'n2', measuredAt: new Date('2026-10-03T00:00:00Z') }],
    );
    const r = new AdmissionVitalsReader(p as never);
    expect((await r.latestByAdmission([ADM])).get('a1')).toMatchObject({ id: 'pv1', ledger: 'PREVISIT' });
    const empty = new AdmissionVitalsReader(prisma([], []) as never);
    expect((await empty.latestByAdmission([ADM])).has('a1')).toBe(false);
  });
});

/**
 * 구조 가드 — 입원 화면 서비스가 입원 원장을 **직접** 읽어 "최근 활력"을 말하지 않는다.
 * 🔴 기준선은 지금 남은 직접 읽기(정당 — 플로시트 편집 화면·I/O·적합성 점검·멱등 등)를 파일별 정확 수로 동결한다.
 */
describe('구조 가드 — 입원 활력 직접 읽기 기준선', () => {
  const ROOT = join(__dirname, '../../src/modules');
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) files.push(p); } };
  walk(ROOT);
  const count = () => {
    const m: Record<string, number> = {};
    for (const f of files) {
      const n = (readFileSync(f, 'utf8').match(/flowSheetEntry\.(findMany|findFirst|groupBy|count)\(/g) ?? []).length;
      if (n) m[relative(ROOT, f)] = n;
    }
    return m;
  };
  // 정당: 읽기 정본 자신 · 수집 포트 멱등 · 적합성 점검 · 플로시트 시트/타임라인(입원 원장 칸·I/O — 외래 행은 정본으로 덧붙인다) ·
  //       기록 타임라인·FHIR·환자 활력 타임라인·포털(원장 태그를 이미 단다) · listRecent
  const BASELINE: Record<string, number> = {
    'vitals/admission-vitals.reader.ts': 3,
    'vitals/vitals-ingest.service.ts': 1,
    'vitals/vitals-conformance.service.ts': 2,
    'nursing/nursing.service.ts': 3,
    'record-timeline/record-timeline.service.ts': 1,
    // 2026-10-10 포털 입원 활력 → AdmissionVitalsReader(직접 읽기 0) · I/O 읽기 정본이 플로시트 I/O 칸을 읽는다(활력 아님)
    'nursing/admission-io.reader.ts': 1,
    'patient/patient.service.ts': 1,
    'fhir/fhir.controller.ts': 1,
    // 2026-10-10 질 지표 근무조 활력 완결률 — 한 달치 재원 전체를 두 원장(플로시트·외래 원장) 모두 한 번에 집계(재원별 리더 반복은 N+1)
    'quality/indicator-supplier.service.ts': 1,
  };
  it('늘지 않는다 — 새 자리는 AdmissionVitalsReader 를 쓴다', () => {
    expect(count()).toEqual(BASELINE);
  });
  it('🔴 의사 회진·재원 목록·병동 보드·미체크·근무조 마감은 정본을 쓴다(직접 읽기 0)', () => {
    const c = count();
    for (const f of ['doctors/doctors.service.ts', 'inpatient/inpatient.service.ts', 'admission/admission.service.ts']) expect(c[f] ?? 0).toBe(0);
  });
});

describe('간호초기평가 24시간 내 완료율 — 공급원', () => {
  const H = 3_600_000;
  const t0 = new Date('2026-09-10T00:00:00Z');
  const adm = (id: string, admitDate: Date, dischargeDate: Date | null, assessed: Date[]) => ({ id, admitDate, dischargeDate, nursingAssessments: assessed.map((assessedAt) => ({ assessedAt })) });
  const svc = (rows: any[]) => {
    const p = { admission: { findMany: vi.fn(async () => rows) } };
    return { s: new IndicatorSupplierService(p as never), p };
  };
  const range = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };

  it('🔴 분모 = 24시간 이상 머문 입원 · 분자 = 24시간 안 평가 · 늦은 평가·평가 없음은 분자 아님', async () => {
    const { s, p } = svc([
      adm('ok', t0, new Date(t0.getTime() + 72 * H), [new Date(t0.getTime() + 3 * H)]),
      adm('late', t0, new Date(t0.getTime() + 72 * H), [new Date(t0.getTime() + 30 * H)]),
      adm('never', t0, null, []),
      adm('short', t0, new Date(t0.getTime() + 10 * H), []),
      adm('before', t0, new Date(t0.getTime() + 48 * H), [new Date(t0.getTime() - 1 * H)]),
    ]);
    const r = await s.supply('NURSING_INITIAL_24H', range);
    expect(r).toMatchObject({ available: true, numerator: 1, denominator: 4, evidence: { excluded: { pending: 0, shortStay: 1 }, missed: { late: 1, never: 2 } } });
    expect(p.admission.findMany.mock.calls[0][0].where).toMatchObject({ status: { not: 'CANCELLED' }, admitDate: { gte: range.from, lt: range.to } });
  });

  it('경계 — 정확히 24시간째 평가는 안(포함)', async () => {
    const { s } = svc([adm('edge', t0, new Date(t0.getTime() + 48 * H), [new Date(t0.getTime() + 24 * H)])]);
    expect(await s.supply('NURSING_INITIAL_24H', range)).toMatchObject({ available: true, numerator: 1, denominator: 1 });
  });

  it('표본 0 이면 산출 불가(0% 가 아니다) — 24시간이 아직 안 지난 재원은 분모에 넣지 않는다', async () => {
    const recent = new Date(Date.now() - 2 * H);
    const { s } = svc([adm('pending', recent, null, [])]);
    expect(await s.supply('NURSING_INITIAL_24H', { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) }))
      .toMatchObject({ available: false, reason: 'NO_SAMPLE', detail: { pending: 1, shortStay: 0 } });
  });

  it('비율 지표 — p 관리도 · 이름으로도 찾는다', () => {
    expect(qiChartKindFor('NURSING_INITIAL_24H', [], 100)).toBe('P');
    expect(new IndicatorSupplierService({} as never).supplierOf({ name: '간호초기평가 24시간 내 완료율' })).toBe('NURSING_INITIAL_24H');
    expect(QI_SUPPLIERS.NURSING_INITIAL_24H.kind).toBe('NURSING_INITIAL');
  });
});
