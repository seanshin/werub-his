/**
 * 🔴 무수정 승인율(human_edit_ratio) — 기획서 chart-ai-assistant-agent §4.5·§4.6.
 *
 * 스키마(사람 게이트) 없이 **감사 원장**으로 센다:
 *   · `POST /api/v1/ai/draft-outcome`  — 초안↔최종본 편집 거리를 서버가 계산하고 **숫자만** 남긴다
 *   · `GET  /api/v1/ai/draft-metrics`  — AiDraftApply(적용)·AiDraftOutcome(확정) 감사행 집계
 *
 * 재주입하면 실패하는 것(전부 이 저장소에서 실제로 나왔던 형태다):
 *   ① 본문(PHI)이 응답·감사 meta 에 실린다
 *   ② 초안이 없는데 편집거리 0(=무수정)으로 센다
 *   ③ `unchanged` 를 `applied`(적용 건수)로 나눈다 — 분모가 다르다
 *   ④ 표본이 0인데 중앙값을 0으로 낸다('산출 불가'여야 한다)
 *   ⑤ 캡(앞 1500자)에 걸린 것을 하한이라 말하지 않는다
 */
import { describe, it, expect, vi } from 'vitest';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { ZERO_UUID } from '../../src/modules/audit/audit-routes';
import { EDIT_DISTANCE_CAP } from '../../src/common/util/edit-distance';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const mk = (audit?: any) => new MedicalAiController({} as any, audit);
const base = { resourceType: 'ENCOUNTER_SOAP', source: 'ASSISTANT' } as any;

describe('POST /api/v1/ai/draft-outcome — 편집 거리만 남긴다', () => {
  it('수정한 경우: 편집 거리·길이·unchanged=false · 감사행은 AiDraftOutcome(egress k=v 요약)', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const r = await mk(audit).draftOutcome(
      { ...base, patientId: PATIENT, field: 'A', draftText: '고혈압 의증', finalText: '고혈압 진단' } as any,
      'user-1',
    );
    expect(r.data).toMatchObject({ recorded: true, draftLen: 6, finalLen: 6, unchanged: false, capped: false });
    expect(r.data.editDistance).toBe(2);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.resourceType).toBe('AiDraftOutcome');
    expect(entry.resourceId).toBe(PATIENT);
    expect(entry.userId).toBe('user-1');
    const summary = entry.changes.egress.new as string;
    for (const k of ['resourceType=ENCOUNTER_SOAP', 'source=ASSISTANT', 'field=A', 'editDistance=2', 'draftLen=6', 'finalLen=6', 'unchanged=false', 'capped=false']) {
      expect(summary).toContain(k);
    }
  });

  it('🔴 본문은 응답에도 감사행에도 한 자도 실리지 않는다(PHI)', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const draftText = '환자 홍길동 님은 흉통을 호소';
    const finalText = '환자 홍길동 님은 흉통과 호흡곤란을 호소';
    const r = await mk(audit).draftOutcome({ ...base, patientId: PATIENT, draftText, finalText } as any, 'user-1');
    const dumped = JSON.stringify(r) + JSON.stringify(audit.log.mock.calls[0][0]);
    expect(dumped).not.toContain('홍길동');
    expect(dumped).not.toContain('흉통');
    expect(dumped).not.toContain(draftText);
    expect(dumped).not.toContain(finalText);
    expect(r.data.editDistance).toBeGreaterThan(0); // 계산은 했다
  });

  it('🔴 초안이 비어 있으면 편집거리는 0 이 아니라 null + NO_DRAFT — "무수정"으로 세지 않는다', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    for (const draftText of ['', '   \n ']) {
      audit.log.mockClear();
      const r = await mk(audit).draftOutcome({ ...base, patientId: PATIENT, draftText, finalText: '사람이 처음부터 쓴 기록' } as any, 'user-1');
      expect(r.data.editDistance).toBeNull();
      expect(r.data.unchanged).toBe(false);
      expect((r.data as any).reason).toBe('NO_DRAFT');
      const summary = audit.log.mock.calls[0][0].changes.egress.new as string;
      expect(summary).toContain('reason=NO_DRAFT');
      expect(summary).not.toContain('editDistance=0');
      expect(summary).toContain('unchanged=false');
    }
  });

  it('그대로 승인한 경우에만 unchanged=true(거리 0)', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const t = '두통, 발열 3일';
    const r = await mk(audit).draftOutcome({ ...base, patientId: PATIENT, draftText: t, finalText: t } as any, 'user-1');
    expect(r.data).toMatchObject({ editDistance: 0, unchanged: true, capped: false });
    expect(audit.log.mock.calls[0][0].changes.egress.new).toContain('unchanged=true');
  });

  it('🔴 캡에 걸리면 거리는 하한이다 — 앞부분만 같은 것을 "무수정"이라 하지 않는다', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const head = '가'.repeat(EDIT_DISTANCE_CAP);
    const r = await mk(audit).draftOutcome({ ...base, patientId: PATIENT, draftText: head + '초안 꼬리', finalText: head + '완전히 다른 꼬리' } as any, 'user-1');
    expect(r.data.capped).toBe(true);
    expect(r.data.editDistance).toBe(0); // 앞 1500자만 본 하한
    expect(r.data.unchanged).toBe(false); // 🔴 하한 0 을 무수정으로 접지 않는다
    const summary = audit.log.mock.calls[0][0].changes.egress.new as string;
    expect(summary).toContain('capped=true');
    expect(summary).toContain('하한');
  });

  it('🔴 환자를 모르면 추정하지 않는다 — ZERO_UUID', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    await mk(audit).draftOutcome({ ...base, draftText: 'a', finalText: 'b' } as any, 'user-1');
    expect(audit.log.mock.calls[0][0].resourceId).toBe(ZERO_UUID);
  });

  it('🔴 기록하지 못하면 recorded=false 라고 말한다(계산값은 그대로 준다)', async () => {
    const none = await mk(undefined).draftOutcome({ ...base, draftText: 'abc', finalText: 'abd' } as any, 'user-1');
    expect(none.data.recorded).toBe(false);
    expect(none.data.editDistance).toBe(1);
    const failing = { log: vi.fn().mockRejectedValue(new Error('db down')) };
    const r = await mk(failing).draftOutcome({ ...base, draftText: 'abc', finalText: 'abd' } as any, 'user-1');
    expect(r.data.recorded).toBe(false);
  });
});

// ── 집계 ──────────────────────────────────────────────────────────────────────

const applyRow = (resourceType: string) => ({
  resourceType: 'AiDraftApply',
  changes: { aiDraftApply: { old: null, new: { resourceType, source: 'ASSISTANT', resourceId: null, field: 'A', model: 'qwen', promptVersion: 'v1', textLength: 120 } } },
});
const outcomeRow = (resourceType: string, meta: Record<string, string | number | boolean>) => ({
  resourceType: 'AiDraftOutcome',
  changes: { egress: { old: null, new: Object.entries({ resourceType, source: 'ASSISTANT', ...meta }).map(([k, v]) => `${k}=${v}`).join(';') } },
});

const metricsOf = async (rows: any[]) => {
  const prisma: any = { auditLog: { findMany: vi.fn().mockResolvedValue(rows) } };
  const config = { get: vi.fn((_k: string, d?: any) => d) } as any;
  const runtime = { get: vi.fn(), getHospitalContext: vi.fn() } as any;
  const svc = new MedicalAiService(config, runtime, prisma);
  return { out: await svc.draftMetrics(30), prisma };
};

describe('GET /api/v1/ai/draft-metrics — 분모를 함께 낸다', () => {
  it('두 형태(egress 문자열 · aiDraftApply 객체)를 모두 읽는다 · 자원 종류별로 나눈다', async () => {
    const { out, prisma } = await metricsOf([
      applyRow('ENCOUNTER_SOAP'), applyRow('ENCOUNTER_SOAP'), applyRow('DISCHARGE_SUMMARY'),
      outcomeRow('ENCOUNTER_SOAP', { editDistance: 0, draftLen: 10, finalLen: 10, unchanged: true, capped: false }),
      outcomeRow('ENCOUNTER_SOAP', { editDistance: 4, draftLen: 10, finalLen: 12, unchanged: false, capped: false }),
    ]);
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.resourceType).toEqual({ in: ['AiDraftApply', 'AiDraftOutcome'] });
    expect(out.total).toMatchObject({ applied: 3, outcomes: 2, measured: 2, unchanged: 1, medianEditDistance: 2 });
    const soap = out.byResourceType.find((b) => b.resourceType === 'ENCOUNTER_SOAP')!;
    expect(soap).toMatchObject({ applied: 2, outcomes: 2, unchanged: 1, medianEditDistance: 2 });
    const dc = out.byResourceType.find((b) => b.resourceType === 'DISCHARGE_SUMMARY')!;
    expect(dc).toMatchObject({ applied: 1, outcomes: 0, unchanged: 0, medianEditDistance: null });
  });

  it('🔴 무수정의 분모는 outcomes 다 — applied 로 나누면 다른 수가 된다(서버는 비율을 만들지 않는다)', async () => {
    const { out } = await metricsOf([
      ...Array.from({ length: 5 }, () => applyRow('ENCOUNTER_SOAP')),
      outcomeRow('ENCOUNTER_SOAP', { editDistance: 0, draftLen: 9, finalLen: 9, unchanged: true, capped: false }),
      outcomeRow('ENCOUNTER_SOAP', { editDistance: 6, draftLen: 9, finalLen: 15, unchanged: false, capped: false }),
    ]);
    expect(out.total.applied).toBe(5);
    expect(out.total.outcomes).toBe(2);
    expect(out.total.unchanged / out.total.outcomes).toBe(0.5); // 정답
    expect(out.total.unchanged / out.total.applied).not.toBe(0.5); // applied 로 나누면 0.2 — 다른 사실
    // 서버가 비율을 미리 계산해 분모를 감추지 않는다
    expect(Object.keys(out.total).some((k) => /ratio|rate|percent|pct/i.test(k))).toBe(false);
    expect(out.note).toContain('outcomes');
    expect(out.note).toContain('산출 불가');
  });

  it('🔴 표본이 0이면 중앙값은 null(산출 불가) — 0 을 만들어 내지 않는다', async () => {
    const { out } = await metricsOf([applyRow('CONSENT'), applyRow('CONSENT')]);
    expect(out.total.outcomes).toBe(0);
    expect(out.total.medianEditDistance).toBeNull();
    expect(out.byResourceType[0].medianEditDistance).toBeNull();
    const empty = await metricsOf([]);
    expect(empty.out.total).toMatchObject({ applied: 0, outcomes: 0, measured: 0, unchanged: 0, medianEditDistance: null });
    expect(empty.out.byResourceType).toEqual([]);
  });

  it('🔴 초안 없음(NO_DRAFT)은 outcomes 로는 세지만 무수정·중앙값 표본에서는 뺀다', async () => {
    const { out } = await metricsOf([
      outcomeRow('VOC_REPLY', { draftLen: 0, finalLen: 40, unchanged: false, capped: false, reason: 'NO_DRAFT' }),
      outcomeRow('VOC_REPLY', { draftLen: 0, finalLen: 12, unchanged: false, capped: false, reason: 'NO_DRAFT' }),
    ]);
    expect(out.total).toMatchObject({ outcomes: 2, measured: 0, unchanged: 0, medianEditDistance: null });
  });

  it('중앙값: 홀수는 가운데, 짝수는 두 값의 평균 · 창(days)은 1~365 로 접는다', async () => {
    const odd = await metricsOf([
      outcomeRow('REFERRAL', { editDistance: 10, unchanged: false, draftLen: 1, finalLen: 1, capped: false }),
      outcomeRow('REFERRAL', { editDistance: 0, unchanged: true, draftLen: 1, finalLen: 1, capped: false }),
      outcomeRow('REFERRAL', { editDistance: 2, unchanged: false, draftLen: 1, finalLen: 1, capped: false }),
    ]);
    expect(odd.out.total.medianEditDistance).toBe(2);
    const even = await metricsOf([
      outcomeRow('REFERRAL', { editDistance: 1, unchanged: false, draftLen: 1, finalLen: 1, capped: false }),
      outcomeRow('REFERRAL', { editDistance: 4, unchanged: false, draftLen: 1, finalLen: 1, capped: false }),
    ]);
    expect(even.out.total.medianEditDistance).toBe(2.5);
    expect(odd.out.windowDays).toBe(30);
  });

  it('컨트롤러: days 는 1~180 으로 접고 서비스에 그대로 넘긴다', async () => {
    const svc = { draftMetrics: vi.fn().mockResolvedValue({ ok: true }) } as any;
    const c = new MedicalAiController(svc);
    await c.draftMetrics('7'); expect(svc.draftMetrics).toHaveBeenLastCalledWith(7);
    await c.draftMetrics('9999'); expect(svc.draftMetrics).toHaveBeenLastCalledWith(180);
    await c.draftMetrics(undefined); expect(svc.draftMetrics).toHaveBeenLastCalledWith(30);
    await c.draftMetrics('-3'); expect(svc.draftMetrics).toHaveBeenLastCalledWith(1);
  });
});
