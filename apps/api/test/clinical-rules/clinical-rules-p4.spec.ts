/**
 * 임상 규칙·템플릿 P4(2026-10-21 · `clinical-rules-templates-review-2026-10.plan.md` B1·A8·B2).
 *  · 대장: 카탈로그마다 shared 정의의 지표 코드를 빠짐없이 · 🔴 한 카드 실패는 그 카드만 null(다른 카드 그대로) · DUR 적중은 계측 전 null
 *  · 처방집 상태 조회: 처방 게이트와 같은 판정(REMOVED 제외·최근 행·사용중지·미등재) · 시행 모드
 *  · 🔴 DUR 미리보기: 실제 판정과 같은 매칭 — 병용은 같은 진료만 · 연령 경계 · Beers 65세 · 용량 초과/못 읽음 · 소아 체중은 미리보기 불가(0 아님)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { CLINICAL_RULES_LEDGER } from '@hospital-run/shared';
import { ClinicalRulesLedgerService } from '../../src/modules/clinical-rules/clinical-rules-ledger.service';
import { FormularyGateService } from '../../src/modules/formulary/formulary-gate.service';
import { previewDurRule, type PreviewRx } from '../../src/modules/prescription/dur/dur-rule-preview';

const agg = (d?: Date) => vi.fn(async () => ({ _max: { updatedAt: d ?? new Date('2026-10-01'), publishedAt: null, createdAt: d ?? new Date('2026-10-01') }, _sum: { hitCount: 37 } }));
function prismaMock(over: Record<string, unknown> = {}) {
  const count = (n: number) => vi.fn(async () => n);
  const base: any = {
    orderSet: { count: vi.fn(async (a: any) => (a?.where?.approvedBy === null ? 26 : a?.where?.OR ? 24 : a?.where?.status === 'DRAFT' ? 2 : 26)), aggregate: agg() },
    orderSetUsage: { count: count(3) },
    treatmentScheduleTemplate: { count: count(1), aggregate: agg() },
    patientTreatmentSchedule: { count: count(2) },
    formularyItem: { count: count(132), aggregate: agg() },
    formularyRequest: { count: count(0) },
    durRule: { findMany: vi.fn(async () => [{ ruleType: 'INTERACTION', severity: 'ERROR', drugA: 'a', drugB: 'b', keywords: null, minAge: null, maxAge: null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: 'm' }]), aggregate: agg() },
    cdssRule: { count: count(17) },
    $queryRaw: vi.fn().mockResolvedValueOnce([{ since: null }]).mockResolvedValueOnce([{ n: 0 }]),
    protocolTemplate: { count: count(4), aggregate: agg() },
    protocolInstance: { count: count(5) },
    chartTemplate: { count: count(26), aggregate: agg() },
    chartTemplateVersion: { count: count(0) },
    formSchema: { count: count(13), aggregate: agg() },
    formSubmission: { count: count(0) },
    clinicalChartVerification: { findMany: vi.fn(async () => []) },
    triageRule: { count: count(72), aggregate: agg() },
    triageSymptom: { count: count(29) },
    triageAlias: { count: count(169) },
    systemConfig: { findUnique: vi.fn(async () => ({ value: { choice: 'UNASSIGNED', legalReviewRef: '개발 시드(DEV-SEED) — x', authorityClaim: '개발 시드(DEV-SEED)' } })) },
  };
  return Object.assign(base, over);
}
const svc = (prisma: any) => new ClinicalRulesLedgerService(prisma, { get: vi.fn(async () => ({ enabled: false, allowDelegate: false })) } as never, { getPolicy: vi.fn(async () => ({ MEDICATION: 'WARN', LAB: 'OFF' })) } as never);

describe('🔴 임상 규칙 대장', () => {
  it('카탈로그 10 · 지표 코드 = shared 정의(빠짐·덧붙임 없음)', async () => {
    const r = await svc(prismaMock()).ledger();
    expect(r.cards.map((c) => c.key)).toEqual(CLINICAL_RULES_LEDGER.map((c) => c.key));
    for (const def of CLINICAL_RULES_LEDGER) {
      const card = r.cards.find((c) => c.key === def.key)!;
      expect(Object.keys(card.metrics ?? {}).sort(), def.key).toEqual(def.metrics.map((m) => m.code).sort());
    }
  });
  it('값 — 승인 기록 없음 26 · 진단 연결 없음 = 사용 중 − 연결 · 처방집 시행 영역 수 · 🔴 DUR 적중은 계측 전 null · 옛 규칙 17 · 소유 결정 시드', async () => {
    const r = await svc(prismaMock()).ledger();
    const m = (k: string) => r.cards.find((c) => c.key === k)!.metrics!;
    expect(m('ORDER_SET')).toMatchObject({ active: 26, activeNoApprover: 26, activeNoDiagnosis: 2, usage90d: 3 });
    expect(m('FORMULARY').enforcedDomains).toBe(1);
    expect(m('DUR')).toMatchObject({ rulesActive: 1, fallbackTypes: 4, hits90d: null, legacyUnused: 17 });
    expect(m('PRESCRIBER')).toEqual({ enabled: false, allowDelegate: false });
    expect(m('TRIAGE').hits).toBe(37);
    expect(r.ownership).toEqual({ choice: 'UNASSIGNED', seeded: true, known: true });
  });
  it('🔴 한 카드 조회가 실패하면 그 카드만 null — 다른 카드는 그대로(0 으로 접지 않는다)', async () => {
    const r = await svc(prismaMock({ triageRule: { count: vi.fn().mockRejectedValue(new Error('db')), aggregate: agg() } })).ledger();
    expect(r.cards.find((c) => c.key === 'TRIAGE')!.metrics).toBeNull();
    expect(r.cards.find((c) => c.key === 'ORDER_SET')!.metrics).not.toBeNull();
  });
  it('계측 뒤면 DUR 적중 숫자 · 설정 모양을 모르면 null', async () => {
    const p = prismaMock(); p.$queryRaw = vi.fn().mockResolvedValueOnce([{ since: new Date() }]).mockResolvedValueOnce([{ n: 4 }]);
    const s = new ClinicalRulesLedgerService(p, { get: vi.fn(async () => ({ enabled: 'yes' })) } as never, { getPolicy: vi.fn(async () => ({})) } as never);
    const r = await s.ledger();
    expect(r.cards.find((c) => c.key === 'DUR')!.metrics!.hits90d).toBe(4);
    expect(r.cards.find((c) => c.key === 'PRESCRIBER')!.metrics).toEqual({ enabled: null, allowDelegate: null });
  });
});

describe('처방집 상태 조회 — 처방 게이트와 같은 판정', () => {
  it('최근 행 · REMOVED 제외 조건 · 사용중지 · 미등재 · 시행 모드', async () => {
    const prisma: any = {
      formularyItem: { findMany: vi.fn(async () => [{ codeId: 'a', status: 'SUSPENDED' }, { codeId: 'a', status: 'ACTIVE' }, { codeId: 'b', status: 'ACTIVE' }]) },
    };
    const gate = new FormularyGateService(prisma, { get: vi.fn(async () => ({ MEDICATION: 'BLOCK' })) } as never);
    const r = await gate.statusOf('MEDICATION', ['a', 'b', 'c', 'a']);
    expect(r).toMatchObject({ mode: 'BLOCK', enforceable: true, statuses: { a: 'SUSPENDED', b: 'LISTED', c: 'NOT_LISTED' } });
    const where = prisma.formularyItem.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ where: { domain: 'MEDICATION', codeId: { in: ['a', 'b', 'c'] }, status: { not: 'REMOVED' } }, orderBy: { createdAt: 'desc' } });
  });
});

describe('🔴 DUR 영향 미리보기 — 실제 판정과 같은 매칭', () => {
  const rx = (o: Partial<PreviewRx>): PreviewRx => ({ id: Math.random().toString(36), encounterId: 'e1', patientId: 'p1', age: 50, hay: '', dosage: null, frequency: null, ...o });
  it('병용 — 같은 진료의 다른 처방만(다른 진료는 아님)', () => {
    const r = previewDurRule({ ruleType: 'INTERACTION', drugA: 'warfarin', drugB: 'aspirin' }, [
      rx({ id: '1', hay: 'warfarin' }), rx({ id: '2', hay: 'aspirin' }), rx({ id: '3', encounterId: 'e2', patientId: 'p2', hay: 'warfarin' }),
    ]);
    expect(r).toMatchObject({ supported: true, matchedRx: 2, matchedPatients: 1 });
  });
  it('연령 경계 — 이하/이상 · 나이 모르면 제외 · Beers 65세 이상만', () => {
    const rows = [rx({ hay: 'codeine', age: 12 }), rx({ hay: 'codeine', age: 13 }), rx({ hay: 'codeine', age: null })];
    expect(previewDurRule({ ruleType: 'AGE', drugA: 'codeine', maxAge: 12 }, rows).matchedRx).toBe(1);
    expect(previewDurRule({ ruleType: 'BEERS', keywords: ['diazepam'] }, [rx({ hay: 'diazepam', age: 65 }), rx({ hay: 'diazepam', age: 64 })]).matchedRx).toBe(1);
  });
  it('용량 — 초과는 차단 · 용법을 못 읽으면 경고로 셈 · 이내는 셈 안 함', () => {
    const r = previewDurRule({ ruleType: 'MAX_DOSE', drugA: 'acetaminophen', maxDailyDose: 4000, unit: 'mg' }, [
      rx({ hay: 'acetaminophen', dosage: '1000mg', frequency: '1일 5회' }), rx({ hay: 'acetaminophen', dosage: '500mg', frequency: '1일 3회' }), rx({ hay: 'acetaminophen', dosage: '1정', frequency: null }),
    ]);
    expect(r).toMatchObject({ matchedRx: 2, doseExceeded: 1, doseUnreadable: 1 });
  });
  it('🔴 소아 체중 기반은 미리보기 불가(0 이 아니라 이유) · 내용 부족도 이유', () => {
    expect(previewDurRule({ ruleType: 'PEDIATRIC_DOSE', drugA: 'x' }, [])).toMatchObject({ supported: false, reason: 'WEIGHT_NOT_IN_HISTORY' });
    expect(previewDurRule({ ruleType: 'INTERACTION', drugA: 'x' }, [])).toMatchObject({ supported: false, reason: 'INCOMPLETE_RULE' });
  });
  it('구조 가드 — 미리보기와 판정이 같은 매칭 함수·같은 용법 정규식을 쓴다', () => {
    const preview = readFileSync(join(__dirname, '../../src/modules/prescription/dur/dur-rule-preview.ts'), 'utf8');
    const dur = readFileSync(join(__dirname, '../../src/modules/prescription/dur/dur.service.ts'), 'utf8');
    expect(preview).toMatch(/import \{ hayMatchesTerm \} from '\.\/ingredient-terms'/);
    for (const re of ['/(\\d+(?:\\.\\d+)?)\\s*mg/i', '/(\\d+)\\s*회/']) {
      expect(preview.includes(re), re).toBe(true);
      expect(dur.includes(re), re).toBe(true);
    }
    expect(dur).toMatch(/patientAge >= 65/);
    expect(preview).toMatch(/r\.age >= 65/);
  });
});
