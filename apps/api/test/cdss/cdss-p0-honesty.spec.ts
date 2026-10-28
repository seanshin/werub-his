/**
 * 임상 규칙·템플릿 교차검증 P0 — CDSS(2026-10-21 · `clinical-rules-templates-review-2026-10.plan.md` R1·R3).
 *  · 🔴 진료 작성 보완 배너는 판정 범위를 넓히지 않고(encounterId 없음 — DUR 패널과 겹치지 않음) 판정 기록만 남긴다(logEncounterId)
 *    종전엔 주 처방 경로의 판정이 CdssLog(안전 게이트 관제 통계 원천)에 한 건도 남지 않았다(운영 0건)
 *  · 🔴 DUR 를 돌리지 않았으면 "중복 처방 없음(PASS)"을 지어내지 않는다
 *  · 🔴 규칙 통계가 엔진 사실을 낸다 — 이 표는 판정이 읽지 않는다 · 적중 수 계측 없음 · 실제 DUR 룰 수
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CdssService, CDSS_CODE_RULES } from '../../src/modules/cdss/cdss.service';

let prisma: any;
let dur: any;
let svc: CdssService;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  prisma = {
    patient: { findUnique: vi.fn(async () => ({ id: 'p-1', dateOfBirth: new Date('1980-01-01'), gender: 'MALE' })) },
    medicationCode: { findUnique: vi.fn(async () => ({ id: 'med-1', nameKo: '아목시실린', ingredient: '아목시실린' })) },
    allergy: { findMany: vi.fn(async () => []) },
    labResultItem: { findFirst: vi.fn(async () => null) },
    encounter: { findUnique: vi.fn(async () => ({ id: 'enc-1', doctorId: 'doc-1', diagnoses: [] })), findMany: vi.fn(async () => []) },
    orderSet: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    cdssRule: { findMany: vi.fn(async () => [{ id: 'r', name: 'x', category: 'AGE', level: 'WARNING', hitCount: 0 }]) },
    cdssLog: { create: vi.fn(async () => ({})) },
    durRule: { count: vi.fn(async () => 55) },
  };
  dur = { checkInteractions: vi.fn(async () => []) };
  svc = new CdssService(prisma, { getRuleSet: vi.fn() } as never, dur);
});

describe('🔴 판정 기록 — 범위는 그대로, 기록은 남긴다', () => {
  it('logEncounterId 만 주면 DUR·진단·가이드라인 검사를 켜지 않고 CdssLog 에 그 진료로 남긴다', async () => {
    const r = await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1', logEncounterId: 'enc-1' });
    await flush();
    expect(dur.checkInteractions).not.toHaveBeenCalled();
    expect(r.checks.some((c) => c.category === 'DIAGNOSIS' || c.category === 'GUIDELINE' || c.category === 'INTERACTION')).toBe(false);
    expect(prisma.cdssLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.cdssLog.create.mock.calls[0][0].data).toMatchObject({ encounterId: 'enc-1', patientId: 'p-1', doctorId: 'doc-1' });
  });
  it('대조군 — 진료가 없으면 기록하지 않는다 · encounterId 를 주면 종전대로 DUR 와 기록', async () => {
    await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1' });
    await flush();
    expect(prisma.cdssLog.create).not.toHaveBeenCalled();
    await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1' });
    await flush();
    expect(dur.checkInteractions).toHaveBeenCalled();
    expect(prisma.cdssLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 하지 않은 검사를 통과로 말하지 않는다', () => {
  it('DUR 를 돌리지 않았으면 중복 처방 PASS 가 없다', async () => {
    const r = await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1' });
    expect(r.checks.find((c) => c.category === 'DUPLICATE')).toBeUndefined();
    const r2 = await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1', skipDur: true });
    expect(r2.checks.find((c) => c.category === 'DUPLICATE')).toBeUndefined();
  });
  it('대조군 — DUR 를 돌렸고 중복이 없으면 PASS', async () => {
    const r = await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1' });
    expect(r.checks.find((c) => c.category === 'DUPLICATE')?.level).toBe('PASS');
  });
});

describe('🔴 규칙 통계 — 엔진 사실', () => {
  it('이 표는 판정이 읽지 않는다 · 적중 계측 없음 · 실제 DUR 룰 수 · 코드 규칙 목록', async () => {
    const s = await svc.getRuleStats();
    expect(s.engine).toEqual({ readsThisTable: false, hitsMeasured: false, durRulesActive: 55, codeRules: CDSS_CODE_RULES });
  });
  it('DUR 룰 수 조회 실패는 null(확인 불가) — 0 이 아니다', async () => {
    prisma.durRule.count.mockRejectedValue(new Error('db'));
    expect((await svc.getRuleStats()).engine.durRulesActive).toBeNull();
  });
  it('🔴 구조 가드 — 판정(check)은 CdssRule 을 읽지 않는다(읽게 되면 이 고지를 바꿔야 한다)', async () => {
    await svc.check({ patientId: 'p-1', medicationCodeId: 'med-1', encounterId: 'enc-1' });
    expect(prisma.cdssRule.findMany).not.toHaveBeenCalled();
  });
});
