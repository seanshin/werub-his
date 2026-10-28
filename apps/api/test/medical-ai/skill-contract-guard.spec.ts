/**
 * 🔴 진료 보조 스킬 출력 계약 가드 — 기획서 chart-ai-assistant-agent §4.1·§7.
 *
 * 2026-08-19 운영 실측을 **그대로 재주입**한다:
 *   · 감별진단이 15~23초 뒤 `differentials: []` 를 source 없이 냈다 → 이제 FALLBACK/EMPTY_RESULT 로 말해야 한다
 *   · SOAP 이 영어 + "avoiding aspirin … in ACS" → FALLBACK/VERIFY_REJECTED
 *   · 검사해석이 K 5.9(H) 를 "저하" · 미입력 WBC 언급 → FALLBACK/VERIFY_REJECTED
 *   · 추론 상류 400 → 500 이 아니라 FALLBACK/UPSTREAM_ERROR · patient_text 를 함께 보낸다(상류 계약 드리프트)
 * 재주입: `finalizeSkill` 호출을 빼고 파싱 결과를 그대로 돌려주면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

const PID = 'pat-1';
const mk = (llmAnswer: string | null) => {
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
  };
  const service = new MedicalAiService(config as any, runtime as any, prisma, { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any);
  vi.spyOn(service as any, 'getRecentLabsSummary').mockResolvedValue([]);
  vi.spyOn(service as any, 'chatLlm').mockResolvedValue(llmAnswer);
  vi.spyOn(service as any, 'analyze').mockResolvedValue({ diagnoses: [] });
  vi.spyOn(service as any, 'draft').mockResolvedValue({ assessment: '', plan: '' });
  return { service, prisma };
};

describe('감별진단 — 빈 배열은 성공이 아니다', () => {
  it('🔴 LLM 이 빈 differentials 를 주면 FALLBACK/EMPTY_RESULT · latencyMs·groundedOn 동봉', async () => {
    const { service } = mk('{"differentials":[],"suggestedTests":[],"redFlags":[]}');
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '3일 전부터 흉통과 호흡곤란' });
    expect(r.source).toBe('FALLBACK');
    expect(r.reason).toBe('EMPTY_RESULT');
    expect(typeof r.latencyMs).toBe('number');
    expect(r.groundedOn).toContain('알레르기 3상태');
  });
  it('모델이 감별과 검사를 한 집합에 섞어 내면 검사 어휘는 suggestedTests 로 옮긴다(운영 실측)', async () => {
    const { service } = mk('{\n {"name":"불안정 협심증","reasoning":"흉통"},\n {"name":"심전도 검사","reasoning":"확인"},\n {"name":"폐색전증","reasoning":"호흡곤란"}\n }');
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '3일 전부터 흉통과 호흡곤란' });
    expect(r.source).toBe('AI');
    expect(r.differentials.map((d: any) => d.name)).toEqual(['불안정 협심증', '폐색전증']);
    expect(r.differentials.map((d: any) => d.rank)).toEqual([1, 2]);
    expect(r.suggestedTests.map((t: any) => t.name)).toContain('심전도 검사');
  });

  it('내용 있는 한국어 감별은 AI', async () => {
    const { service } = mk('{"differentials":[{"rank":1,"code":"I20.0","name":"불안정 협심증","probability":40,"urgency":"HIGH","reasoning":"흉통·호흡곤란","keyFindings":[],"suggestedQuestions":[]}],"suggestedTests":[{"name":"ECG"}],"redFlags":[]}');
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '3일 전부터 흉통과 호흡곤란' });
    expect(r.source).toBe('AI'); expect(r.differentials).toHaveLength(1);
  });
});

describe('SOAP 초안 — 영어·금칙 조언은 AI 로 나가지 않는다', () => {
  it('🔴 실측 영어 SOAP + ACS 아스피린 회피 → FALLBACK/VERIFY_REJECTED · 본문은 남긴다', async () => {
    const { service } = mk('{"assessment":"Acute Coronary Syndrome (ACS) with possible pulmonary edema","plan":["1. Administer sublingual nitroglycerin.","2. Consider NSAIDs for pain management, avoiding aspirin due to potential bleeding risk in ACS patients."],"confidence":0.8,"references":[]}');
    const r: any = await service.autoSoap({ patientId: PID, subjective: '흉통' });
    expect(r.source).toBe('FALLBACK');
    expect(String(r.reason)).toMatch(/^VERIFY_REJECTED:(KOREAN|FORBIDDEN_ADVICE)/);
    expect(r.verify.failed.join('|')).toMatch(/KOREAN/);
    expect(r.verify.failed.join('|')).toMatch(/FORBIDDEN_ADVICE/);
    expect(r.assessment).toContain('Acute'); // 지우지 않는다 — 화면이 "왜 못 믿는지"와 함께 접어 보여준다
  });
  it('한국어·금칙 없음 → AI', async () => {
    const { service } = mk('{"assessment":"급성 관상동맥증후군 의심","plan":"1. 심전도 즉시\\n2. 트로포닌 확인\\n3. 아스피린 300mg 저작","confidence":0.7,"references":["KSC 2023"]}');
    const r: any = await service.autoSoap({ patientId: PID, subjective: '흉통' });
    expect(r.source).toBe('AI');
  });
});

describe('검사해석 — flag 와 반대로 말하거나 없는 검사를 말하면 떨어진다', () => {
  it('🔴 K 5.9(H) → "저하" · 보내지 않은 WBC 언급 → FALLBACK/VERIFY_REJECTED · 프롬프트에 flag 방향이 들어간다', async () => {
    const { service } = mk('{"summary":"K 저하","findings":[{"test":"WBC","interpretation":"정상","severity":"NORMAL"},{"test":"K","interpretation":"K 수치는 저하됨","severity":"MODERATE"}],"clinicalImplication":"전립선 질환 등 의심","suggestedActions":[],"confidence":0.8}');
    const chat = (service as any).chatLlm as ReturnType<typeof vi.fn>;
    const r: any = await service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }] });
    expect(r.source).toBe('FALLBACK');
    const failed = r.verify.failed.join('|');
    expect(failed).toMatch(/LAB_DIRECTION/); expect(failed).toMatch(/ONLY_PROVIDED_TESTS/); expect(failed).toMatch(/SEX_AGE/);
    const prompt = (chat.mock.calls[0][0] as { content: string }[]).map((m) => m.content).join('\n');
    expect(prompt).toContain('↑(높음)'); // flag 가 프롬프트에 방향으로 들어간다(종전엔 버려졌다)
    expect(prompt).toContain('전달된 검사 항목만');
  });
  it('🔴 LLM 실패 시 규칙 폴백도 flag 를 존중한다 — K 5.9(H) 를 "정상 범위"라 말하지 않는다(운영 재실측)', async () => {
    const { service } = mk(''); // LLM 빈 응답 → 규칙 폴백
    const r: any = await service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }, { testName: 'Na', value: '140', unit: 'mmol/L' }] });
    expect(r.source).toBe('FALLBACK'); expect(r.reason).toBe('UPSTREAM_FALLBACK');
    expect(r.findings.find((f: any) => f.test === 'K')).toMatchObject({ severity: 'MODERATE' });
    expect(r.findings.find((f: any) => f.test === 'K').interpretation).toContain('높음');
    expect(r.findings.find((f: any) => f.test === 'Na').severity).toBe('UNKNOWN'); // flag·기준치 없음 = 판정 불가(정상 아님)
    expect(r.summary).toContain('이상 소견 1건');
  });

  it('방향이 맞고 입력 검사만 말하면 AI', async () => {
    const { service } = mk('{"summary":"고칼륨혈증","findings":[{"test":"K","interpretation":"칼륨 상승 — 고칼륨혈증","severity":"HIGH"}],"clinicalImplication":"신기능·약물 확인","suggestedActions":["ECG"],"confidence":0.8}');
    const r: any = await service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }] });
    expect(r.source).toBe('AI');
  });
});

describe('약물추천 — LLM 의 "cdssCheck: PASS" 는 판정이 아니다', () => {
  it('cdssCheck 는 modelNote 로 옮기고, DUR 서비스가 없으면 durVerdict=null + "재검증 실패"(PASS 를 지어내지 않는다)', async () => {
    const { service } = mk('{"recommendations":[{"name":"암로디핀","dosage":"5mg qd","reason":"고혈압 1차","guideline":"KSH 2018","cdssCheck":"PASS"}],"contraindicated":[],"orderSetSuggested":null}');
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    expect(r.recommendations[0].cdssCheck).toBeUndefined();
    expect(r.recommendations[0].modelNote).toBe('PASS');
    expect(r.recommendations[0].durVerdict).toBeNull();
    expect(r.recommendations[0].durVerdictBasis).toContain('재검증 실패');
    expect(r.recommendations[0].durVerdictBasis).not.toContain('미배선'); // P1 자리표시자는 사라졌다
    expect(r.recommendations[0].durWarnings).toEqual([]);
    expect(r.source).toBe('AI');
  });
});

describe('추론 체인 — 상류 계약 드리프트·실패를 봉투로', () => {
  it('🔴 상류 400 이 500 으로 새지 않고 FALLBACK/UPSTREAM_ERROR · patient_text 를 보낸다', async () => {
    const { service } = mk(null);
    const req = vi.spyOn(service as any, 'request').mockRejectedValue(new Error('AI API error: 400'));
    const r: any = await service.reasoningChain({ symptoms: ['흉통', '호흡곤란'], history: 'BP 150/95' });
    expect(r.source).toBe('FALLBACK'); expect(r.reason).toBe('UPSTREAM_ERROR'); expect(r.steps).toEqual([]);
    const body = req.mock.calls[0][1] as Record<string, unknown>;
    expect(String(body.patient_text)).toContain('흉통');
    expect(body.symptoms).toEqual(['흉통', '호흡곤란']); // 옛 필드도 유지
  });
});
