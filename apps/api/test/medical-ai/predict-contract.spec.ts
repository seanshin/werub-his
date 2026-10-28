/**
 * AI 서버 예측 API 계약(2026-10-07) — 상류 정본 `AI_server/routes/medical_advanced.py` 와 대조.
 *  · 재입원 `patient_data` 필수 · 부작용 `medications` 필수 · 합병증은 `patient_info.age/sex` 로(최상위 age 는 상류가 읽지 않는다)
 *  · 응답 정규화 — 상류 `prediction.*` 에서만(재입원 risk_level · 합병증/부작용 overall_risk) · 모르는 어휘 null · 없으면 null(빈 배열 아님) · 원 응답 보존
 *  · 상류 4xx 는 502(우리 서버 고장 500 이 아니다) · 문구 유지
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';

const egress = vi.fn();
vi.mock('../../src/common/util/ai-egress-fetch', async (orig) => ({ ...(await orig<object>()), aiEgressFetch: (...a: unknown[]) => egress(...a) }));

import { adverseDrugBody, complicationBody, hisRiskLevel, normalizePrediction, readmissionBody } from '../../src/modules/medical-ai/predict-contract';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

describe('요청 — 상류 계약', () => {
  it('🔴 재입원은 patient_data 로 싼다(문서화 키 diagnosis·length_of_stay·past_admissions)', () => {
    const b = readmissionBody({ age: 70, sex: 'M', diagnoses: ['폐렴', '당뇨'], lengthOfStay: 5, previousAdmissions: 2 });
    expect(Object.keys(b)).toEqual(['patient_data']);
    expect(b.patient_data).toMatchObject({ age: 70, sex: 'M', diagnosis: '폐렴, 당뇨', length_of_stay: 5, past_admissions: 2 });
  });
  it('🔴 부작용은 medications(문자열 배열) + patient_info', () => {
    const b = adverseDrugBody({ drugs: ['와파린'], age: 70, sex: 'F', allergies: ['페니실린'] });
    expect(b.medications).toEqual(['와파린']);
    expect('drugs' in b).toBe(false);
    expect(b.patient_info).toMatchObject({ age: 70, sex: 'F', allergies: ['페니실린'] });
  });
  it('🔴 합병증은 diagnosis + patient_info.age/sex(최상위 age·sex 없음)', () => {
    const b = complicationBody({ age: 70, sex: 'M', diagnosis: '폐렴', comorbidities: ['COPD'] }) as Record<string, unknown>;
    expect(b).toMatchObject({ diagnosis: '폐렴', patient_info: { age: 70, sex: 'M', conditions: ['COPD'] } });
    expect('age' in b).toBe(false);
  });
});

describe('응답 정규화', () => {
  it('위험 어휘 low/medium/high → LOW/MODERATE/HIGH · 모르면 null', () => {
    expect([hisRiskLevel('low'), hisRiskLevel('Medium'), hisRiskLevel('HIGH'), hisRiskLevel('critical'), hisRiskLevel(undefined)]).toEqual(['LOW', 'MODERATE', 'HIGH', null, null]);
  });
  it('🔴 합병증 — overall_risk·이름 목록 · 원 응답 보존(운영 실측 모양)', () => {
    const raw = { model: 'm', duration_ms: 1, prediction: { overall_risk: 'medium', complications: [{ name: '호흡곤란', probability: 'high' }, { name: '패혈증' }] } };
    const n = normalizePrediction('complication', raw);
    expect(n).toMatchObject({ risk_level: 'MODERATE', complications: ['호흡곤란', '패혈증'], prediction: raw.prediction, model: 'm' });
  });
  it('🔴 상류가 목록을 안 주면 null — 빈 배열("합병증 없음")로 바꿔 말하지 않는다', () => {
    expect(normalizePrediction('complication', { prediction: { overall_risk: 'low' } }).complications).toBeNull();
    expect(normalizePrediction('adverse-drug', { prediction: { overall_risk: 'low' } }).adverse_events).toBeNull();
  });
  it('🔴 prediction 이 없으면(상류가 원문을 {response} 로 싸 200) 성공이 아니라 502 AI_UPSTREAM_MALFORMED', () => {
    for (const body of [{}, { response: '모델 원문' }, { prediction: 'x' }, { prediction: [] }, { prediction: { response: '모델 원문' } }]) {
      let err: unknown;
      try { normalizePrediction('readmission', body); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(502);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'AI_UPSTREAM_MALFORMED' });
    }
  });
  it('🔴 재입원 권장 키 — lab_results·admission_info 를 싣고 없는 값은 뺀다', () => {
    const b = readmissionBody({ age: 70, sex: 'M', diagnoses: ['심부전'], lengthOfStay: 7, previousAdmissions: 3, labResults: 'Hb 10.8 g/dL (2026-10-05)', admissionInfo: '응급실 경유 입원' });
    expect(b.patient_data).toMatchObject({ lab_results: 'Hb 10.8 g/dL (2026-10-05)', admission_info: '응급실 경유 입원', past_admissions: 3, length_of_stay: 7 });
    const none = JSON.parse(JSON.stringify(readmissionBody({ age: 70, sex: 'M', diagnoses: [], lengthOfStay: null, labResults: null })));
    expect(Object.keys(none.patient_data)).toEqual(['age', 'sex']);
  });
  it('재입원 — risk_level·score·위험요인·예방 조치', () => {
    const n = normalizePrediction('readmission', { prediction: { risk_level: 'high', score: 8, risk_factors: ['재원 5일 이상'], preventive_measures: ['퇴원 후 7일 내 외래'] } });
    expect(n).toMatchObject({ risk_level: 'HIGH', score: 8, factors: ['재원 5일 이상'], recommendations: ['퇴원 후 7일 내 외래'] });
  });
  it('부작용 — overall_risk · 심각 부작용 먼저', () => {
    const n = normalizePrediction('adverse-drug', { prediction: { overall_risk: 'high', individual_risks: [{ drug: '와파린', common_adr: [{ reaction: '멍' }], serious_adr: [{ reaction: '출혈' }] }] } });
    expect(n.risk_level).toBe('HIGH');
    expect(n.adverse_events).toEqual([{ event: '출혈', drug: '와파린', serious: true }, { event: '멍', drug: '와파린', serious: false }]);
  });
});

describe('서비스 배선', () => {
  function svc() {
    const s = Object.create(MedicalAiService.prototype) as any;
    s.logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
    s.getAiConfig = async () => ({ url: 'http://ai.local', key: 'k', gpuKey: '', enabled: true, timeoutMs: 1000 });
    s.assertAiEgressUrl = () => undefined;
    s.sleep = async () => undefined;
    return s;
  }
  it('🔴 predictAdverseDrug 가 상류에 medications 로 보내고 정규화해 돌려준다', async () => {
    egress.mockReset().mockResolvedValue(new Response(JSON.stringify({ prediction: { overall_risk: 'low', individual_risks: [] }, tokens: 10 }), { status: 200 }));
    const r = await svc().predictAdverseDrug({ drugs: ['와파린'], age: 70 });
    const sent = JSON.parse(egress.mock.calls[0][2].body);
    expect(sent.medications).toEqual(['와파린']);
    expect(r).toMatchObject({ risk_level: 'LOW', adverse_events: [] });
  });
  it('🔴 상류 400 은 502(상류 오류) — 500 INTERNAL_ERROR 가 아니다 · 문구 유지', async () => {
    egress.mockReset().mockResolvedValue(new Response('{"error":"patient_data is required"}', { status: 400 }));
    const err = await svc().predictReadmission({ age: 70, sex: 'M', diagnoses: ['폐렴'], lengthOfStay: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(502);
    expect((err as Error).message).toBe('AI API error: 400');
  });
});
