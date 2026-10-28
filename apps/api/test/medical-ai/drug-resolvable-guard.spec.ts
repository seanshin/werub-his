/**
 * 🔴 검증층 규칙 6 `DRUGS_RESOLVABLE` + 약명 표기 규칙 `DRUG_NAME_SCRIPT` 가드
 *    — 기획서 chart-ai-assistant-agent §4.4 규칙 6.
 *
 * 2026-08-20 운영 실측을 그대로 재주입한다: `POST /api/v1/ai/recommend-drugs` 를 진단 5종으로 부르니
 * LLM 이 낸 약명 **6건 중 4건이 약가마스터에 없었다** — `나이아즈올`(존재하지 않는 약) · `로바statin`(한글+라틴 혼입) ·
 * `파разォ린`(키릴+가나 — MIXED_SCRIPT 가 잡았다) · `Rosiglitazone`(국내 부재).
 * **그런데 그중 일부가 `source:'AI'` 로 화면에 나갔다.**
 *
 * 재주입하면 실패해야 하는 것:
 *   ① `checkDrugsResolvable` 를 체크 배열에서 빼면 → 미매칭 100% 추천이 `source:'AI'` 로 나간다
 *   ② 빈 추천 목록에서 DRUGS_RESOLVABLE 이 실패로 잡히면 → 폐기 사유가 EMPTY_RESULT 와 겹쳐 갈린다
 *   ③ `로바statin` 이 DRUG_NAME_SCRIPT 를 통과하면 실패 / `D-dimer`·`암로디핀 5mg` 이 걸리면 실패(오탐)
 */
import { describe, it, expect, vi } from 'vitest';
import { checkDrugNameScript, checkDrugsResolvable } from '../../src/modules/medical-ai/ai-verify';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

// ─────────────────────────────────────────────────────────────────────────────
// 순수 함수
// ─────────────────────────────────────────────────────────────────────────────
describe('규칙 6 — 약가마스터 미매칭 비율(분모 포함)', () => {
  it('🔴 실측 재현: 6건 중 4건 미매칭이면 떨어진다 · detail 에 분모가 있다', () => {
    const items = [
      { resolution: 'NONE' }, { resolution: 'NONE' }, { resolution: 'NONE' }, { resolution: 'NONE' },
      { resolution: 'AMBIGUOUS' }, { resolution: 'AMBIGUOUS' },
    ];
    const r = checkDrugsResolvable(items);
    expect(r.name).toBe('DRUGS_RESOLVABLE');
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('미매칭 4/6');
  });

  it('② 🔴 빈 목록은 **통과** — 빈 결과는 NON_EMPTY 가 잡는다(한 사실에 두 규칙이 겹치면 사유가 갈린다)', () => {
    expect(checkDrugsResolvable([]).ok).toBe(true);
    expect(checkDrugsResolvable([]).detail).toBeUndefined();
    expect(checkDrugsResolvable(null).ok).toBe(true);
    expect(checkDrugsResolvable(undefined).ok).toBe(true);
  });

  it('resolution 이 하나도 기록되지 않았으면(DUR 미주입·재검증 실패) 통과 — 모르는 것을 위반으로 세지 않는다', () => {
    const r = checkDrugsResolvable([{}, {}]);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('판정 보류');
  });

  it('AMBIGUOUS·INGREDIENT_GROUP 은 미매칭이 아니다(처방 폼에서 특정 가능) · 임계 경계는 미달이 아니다', () => {
    expect(checkDrugsResolvable([{ resolution: 'AMBIGUOUS' }, { resolution: 'INGREDIENT_GROUP' }]).ok).toBe(true);
    expect(checkDrugsResolvable([{ resolution: 'NONE' }, { resolution: 'EXACT' }])).toMatchObject({ ok: true, detail: '미매칭 1/2' });
    // 임계를 낮추면(운영 조정) 같은 입력이 떨어진다
    expect(checkDrugsResolvable([{ resolution: 'NONE' }, { resolution: 'EXACT' }], 0.4).ok).toBe(false);
    // 형식 위반 임계는 코드 기본(0.5)으로 접는다
    expect(checkDrugsResolvable([{ resolution: 'NONE' }, { resolution: 'EXACT' }], NaN).ok).toBe(true);
  });
});

describe('③ 약명 표기 혼입 — 약명에만 적용(본문 규칙을 넓히지 않는다)', () => {
  it('🔴 `로바statin`(한글+라틴)은 떨어진다 — MIXED_SCRIPT 는 키릴·가나만 봐서 이걸 통과시켰다', () => {
    const r = checkDrugNameScript(['로바statin']);
    expect(r.name).toBe('DRUG_NAME_SCRIPT');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('로바statin');
  });

  it('🔴 오탐 금지 — 정상 약명·검사약어는 전부 통과한다', () => {
    for (const ok of [
      'ramipril', 'Rosiglitazone', 'D-dimer', '암로디핀 5mg', '암로디핀', '아스피린정100mg',
      '메트포르민 500mg', '비타민B12', '메트포르민XR', '아스피린(aspirin)', '아스피린-aspirin',
      '리바로정 2mg', '', '  ',
    ]) {
      expect(checkDrugNameScript([ok]), `오탐: ${ok}`).toMatchObject({ ok: true });
    }
    expect(checkDrugNameScript([null, undefined]).ok).toBe(true);
    expect(checkDrugNameScript(null).ok).toBe(true);
  });

  it('여러 건 중 하나만 혼입돼도 잡고, 중복은 접는다', () => {
    const r = checkDrugNameScript(['암로디핀', '로바statin', '로바statin', 'ramipril']);
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('로바statin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 종단 — recommendDrugs 출력 계약
// ─────────────────────────────────────────────────────────────────────────────
/** 약가마스터 조회 결과를 주입해 `resolution` 을 만든다(NONE / EXACT) */
const mk = (llmAnswer: string | null, medRows: any[]) => {
  const config = { get: vi.fn((_k: string, d?: any) => d) };
  const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  const prisma: any = {
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1975-01-01'), gender: 'FEMALE', familyName: '김', givenName: '영희' }) },
    allergy: { findMany: vi.fn().mockResolvedValue([]) },
    problemList: { findMany: vi.fn().mockResolvedValue([]) },
    prescription: { findMany: vi.fn().mockResolvedValue([]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    orderSet: { findMany: vi.fn().mockResolvedValue([]) },
    medicationCode: { findMany: vi.fn().mockResolvedValue(medRows) },
    encounter: { findFirst: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }) },
  };
  const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
  const service = new MedicalAiService(
    config as any, runtime as any, prisma,
    { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any,
    undefined, undefined, dur as any,
  );
  vi.spyOn(service as any, 'getRecentLabsSummary').mockResolvedValue([]);
  vi.spyOn(service as any, 'chatLlm').mockResolvedValue(llmAnswer);
  return { service, prisma };
};

const PID = '22222222-2222-4222-8222-222222222222';
const EXACT_ROW = [{ id: '33333333-3333-4333-8333-333333333333', code: 'A11111111', nameKo: '암로디핀정', nameEn: 'Amlodipine', ingredient: 'amlodipine', ingredientCode: 'AML' }];

describe('① 종단 — 마스터에 없는 약은 AI 로 나가지 않는다', () => {
  it('🔴 미매칭 100%(나이아즈올·Rosiglitazone) → FALLBACK/VERIFY_REJECTED:DRUGS_RESOLVABLE · 본문은 남긴다', async () => {
    const { service } = mk(
      '{"recommendations":[{"name":"나이아즈올","dosage":"1일 1회 경구","reason":"이상지질혈증 조절","guideline":"국내 진료지침"},{"name":"로시글리타존","dosage":"1일 1회 경구","reason":"혈당 조절","guideline":"국내 진료지침"}],"contraindicated":[],"orderSetSuggested":null}',
      [], // 약가마스터 0건 → resolution NONE
    );
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '이상지질혈증' });
    expect(r.source).toBe('FALLBACK');
    expect(r.reason).toBe('VERIFY_REJECTED:DRUGS_RESOLVABLE');
    expect(r.verify.failed.join('|')).toContain('DRUGS_RESOLVABLE(미매칭 2/2)');
    expect(r.recommendations).toHaveLength(2); // 지우지 않는다 — 화면이 "왜 못 믿는지"와 함께 접어 보여준다
    expect(r.recommendations[0].resolution).toBe('NONE');
  });

  it('마스터로 특정되는 추천은 그대로 AI · DRUGS_RESOLVABLE 이 passed 에 든다', async () => {
    const { service } = mk(
      '{"recommendations":[{"name":"암로디핀","dosage":"1일 1회 5mg 경구","reason":"고혈압 조절","guideline":"국내 진료지침"}],"contraindicated":[],"orderSetSuggested":null}',
      EXACT_ROW,
    );
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '본태성 고혈압' });
    expect(r.source).toBe('AI');
    expect(r.verify.passed).toContain('DRUGS_RESOLVABLE');
    expect(r.verify.passed).toContain('DRUG_NAME_SCRIPT');
  });

  it('② 🔴 빈 추천 목록의 사유는 EMPTY_RESULT 하나뿐이다(DRUGS_RESOLVABLE 이 겹치면 사유가 갈린다)', async () => {
    const { service } = mk('{"recommendations":[],"contraindicated":[],"orderSetSuggested":null}', []);
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '이상지질혈증' });
    expect(r.source).toBe('FALLBACK');
    expect(r.reason).toBe('EMPTY_RESULT');
    expect(r.verify.failed).toHaveLength(1);
    expect(r.verify.failed.join('|')).not.toContain('DRUGS_RESOLVABLE');
    expect(r.verify.passed).toContain('DRUGS_RESOLVABLE');
  });

  it('③ 🔴 마스터에 매칭되더라도 약명 표기가 혼입(`로바statin`)이면 AI 로 나가지 않는다', async () => {
    const { service } = mk(
      '{"recommendations":[{"name":"로바statin","dosage":"1일 1회 경구","reason":"이상지질혈증 조절","guideline":"국내 진료지침"}],"contraindicated":[],"orderSetSuggested":null}',
      EXACT_ROW,
    );
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '이상지질혈증' });
    expect(r.source).toBe('FALLBACK');
    expect(r.reason).toBe('VERIFY_REJECTED:DRUG_NAME_SCRIPT');
    expect(r.verify.failed.join('|')).toContain('DRUG_NAME_SCRIPT');
  });

  it('임계는 운영이 조정한다 — maxUnresolvedDrugRatio=1 이면 전건 미매칭도 통과(위원회 판단)', async () => {
    const { service, prisma } = mk(
      '{"recommendations":[{"name":"나이아즈올","dosage":"1일 1회 경구","reason":"이상지질혈증 조절","guideline":"국내 진료지침"}],"contraindicated":[],"orderSetSuggested":null}',
      [],
    );
    const runtime: any = (service as any).runtimeConfig;
    runtime.get.mockImplementation(async (k: string) => (k === 'ai.skill.quality.maxUnresolvedDrugRatio' ? 1 : null));
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '이상지질혈증' });
    expect(r.source).toBe('AI');
    expect(prisma.medicationCode.findMany).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 관제 EP — skillQuality 는 skillMetrics 를 재사용한다(정본이 둘이 되지 않게)
// ─────────────────────────────────────────────────────────────────────────────
describe('skillQuality — 계측 재료는 skillMetrics 정본 하나', () => {
  const svc = () => {
    const { service } = mk(null, []);
    return service;
  };

  it('스킬 4종을 항상 전부 낸다 · 계측이 없는 스킬은 UNMEASURED/aiRate null(0 아님)', async () => {
    const service = svc();
    const spy = vi.spyOn(service, 'skillMetrics').mockResolvedValue({
      windowDays: 30, generatedAt: '2026-08-20T00:00:00.000Z', note: 'note',
      skills: [{ skill: 'RecommendDrugs', calls: 14, aiOk: 5 } as any],
    } as any);
    const out: any = await service.skillQuality(30);
    expect(spy).toHaveBeenCalledWith(30);
    expect(out.skills.map((s: any) => s.skill)).toEqual(['RealtimeDdx', 'AutoSoap', 'InterpretLab', 'RecommendDrugs']);
    const ddx = out.skills.find((s: any) => s.skill === 'RealtimeDdx');
    expect(ddx.calls).toBe(0);
    expect(ddx.aiRate).toBeNull();
    expect(ddx.status).toBe('UNCONFIGURED'); // 조치 기본 OFF
    expect(ddx.effect).toBe('NONE');
    const drugs = out.skills.find((s: any) => s.skill === 'RecommendDrugs');
    expect(drugs.calls).toBe(14);
    expect(drugs.aiOk).toBe(5);
    expect(drugs.basis).toContain('5/14');
    expect(drugs.threshold).toEqual({ minAiRate: null, minCalls: 20, action: 'OFF' });
  });

  it('🔴 위원회가 임계를 넣어야 판정한다 — 표본 부족은 여전히 내리지 않는다', async () => {
    const service = svc();
    vi.spyOn(service, 'skillMetrics').mockResolvedValue({
      windowDays: 30, generatedAt: 'x', note: 'note',
      skills: [{ skill: 'RecommendDrugs', calls: 14, aiOk: 5 }, { skill: 'AutoSoap', calls: 100, aiOk: 20 }] as any,
    } as any);
    const runtime: any = (service as any).runtimeConfig;
    runtime.get.mockImplementation(async (k: string) => {
      if (k === 'ai.skill.quality.minAiRate') return { recommendDrugs: 0.5, autoSoap: 0.5 };
      if (k === 'ai.skill.quality.action') return { recommendDrugs: 'BLOCK', autoSoap: 'BLOCK' };
      return null;
    });
    const out: any = await service.skillQuality(30);
    const drugs = out.skills.find((s: any) => s.skill === 'RecommendDrugs');
    expect(drugs.status).toBe('INSUFFICIENT_SAMPLE'); // 14 < 20
    expect(drugs.effect).toBe('NONE');
    const soap = out.skills.find((s: any) => s.skill === 'AutoSoap');
    expect(soap.status).toBe('DEGRADED');
    expect(soap.effect).toBe('HIDE');
    expect(soap.basis).toContain('20/100');
  });
});
