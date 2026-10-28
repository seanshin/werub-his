/**
 * 🔴 P1 컨텍스트 빌더 = 브리핑 주입 · 실시간 응답 캐시 가드 — 기획서 chart-ai-assistant-agent §4.6-a·§5 P1.
 *
 *   · 브리핑 서비스가 있으면 4스킬(감별진단·SOAP·검사해석·약물추천)은 알레르기 3상태·활성약·활성 문제·최근 검사를
 *     **브리핑에서** 읽고 prisma 를 재조회하지 않는다 · `groundedOn` 에 `브리핑(<trigger> <computedAt>)` 를 적는다
 *   · 브리핑이 없거나 실패하면 종전 직접 조회로 접는다(같은 값 · 다른 신선도) — 프롬프트는 여전히 3상태를 말한다
 *   · 응답 캐시: 같은 입력 재호출은 `cached:true`·`cachedAt` 을 달고 LLM 을 다시 부르지 않는다 · `source:'AI'` 만 저장 ·
 *     Redis 없으면 캐시 없음(던지지 않는다)
 *
 * 재주입 확인(가드가 가드인지): 캐시 hit 에서 `cached:true` 를 빼면 첫 it 가 실패한다 · FALLBACK 을 저장하면 "실패는 저장하지 않는다" it 가 실패한다 ·
 * 브리핑 대신 prisma 를 다시 조회하면 "재조회 없음" it 가 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';

const PID = '11111111-1111-4111-8111-111111111111';
const BRIEF = {
  version: 1, patientId: PID, computedAt: '2026-08-19T02:10:00.000Z', trigger: 'BATCH', basis: [],
  demographics: { age: 51, sex: 'FEMALE' },
  allergy: { status: 'HAS_ALLERGIES', items: ['페니실린'] },
  activeMedications: ['암로디핀', '메트포르민'],
  activeProblems: ['고혈압', '제2형 당뇨병'],
  recentLabs: [{ testName: 'Hb', value: '13', unit: 'g/dL', flag: 'N', resultedAt: null }, { testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H', resultedAt: null }],
  abnormalLabCount: 1, latestVitals: null, lastEncounter: null, currentAdmission: null, unavailable: [], skills: { labInterpretation: null },
};
const mkRedis = () => { const store = new Map<string, string>(); return { store, get: vi.fn(async (k: string) => store.get(k) ?? null), setex: vi.fn(async (k: string, _t: number, v: string) => { store.set(k, v); }) }; };

const mk = (llmAnswer: string | null, opts: { brief?: any; redis?: any } = {}) => {
  const config = { get: vi.fn((_k: string, d?: any) => d) };
  const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
  const prisma: any = {
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1975-01-01'), gender: 'FEMALE', familyName: '김', givenName: '영희' }) },
    allergy: { findMany: vi.fn().mockResolvedValue([]) },
    problemList: { findMany: vi.fn().mockResolvedValue([{ description: '직접조회-문제' }]) },
    prescription: { findMany: vi.fn().mockResolvedValue([{ medicationCode: { nameKo: '직접조회-약' } }]) },
    labResult: { findMany: vi.fn().mockResolvedValue([]) },
    orderSet: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const allergy = { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) };
  const briefSvc = opts.brief === undefined ? undefined : { get: vi.fn().mockImplementation(opts.brief), attachLabInterpreter: vi.fn() };
  const service = new MedicalAiService(config as any, runtime as any, prisma, allergy as any, briefSvc as any, opts.redis, undefined);
  const chat = vi.spyOn(service as any, 'chatLlm').mockResolvedValue(llmAnswer);
  vi.spyOn(service as any, 'analyze').mockResolvedValue({ diagnoses: [] });
  vi.spyOn(service as any, 'draft').mockResolvedValue({ assessment: '', plan: '' });
  const promptOf = (i = 0) => (chat.mock.calls[i][0] as { content: string }[]).map((m) => m.content).join('\n');
  return { service, prisma, chat, allergy, briefSvc, promptOf };
};

const DDX_OK = '{"differentials":[{"rank":1,"code":"I10","name":"본태성 고혈압","probability":60,"urgency":"MODERATE","reasoning":"혈압 상승","keyFindings":[],"suggestedQuestions":[]}],"suggestedTests":[],"redFlags":[]}';

describe('브리핑 주입 — 재조회 없음 · groundedOn 에 기준 시각', () => {
  it('🔴 감별진단: 알레르기·문제·검사가 브리핑에서 온다(이상치 K 가 먼저) · prisma 재조회 0 · groundedOn 브리핑(BATCH <computedAt>)', async () => {
    const { service, prisma, allergy, promptOf, briefSvc } = mk(DDX_OK, { brief: async () => ({ ...BRIEF, cached: true }) });
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '3일 전부터 두통' });
    expect(briefSvc!.get).toHaveBeenCalledWith(PID);
    const p = promptOf();
    expect(p).toContain('알레르기: 페니실린');
    expect(p).toContain('활성 문제목록: 고혈압, 제2형 당뇨병');
    expect(p).toContain('최근 검사(30일·이상치 우선): K 5.9mmol/L(H), Hb 13g/dL');
    // 재조회 없음 — 직접 조회 경로의 값이 프롬프트에 없고, 그 mock 이 불리지 않는다
    expect(p).not.toContain('직접조회');
    expect(prisma.problemList.findMany).not.toHaveBeenCalled();
    expect(prisma.prescription.findMany).not.toHaveBeenCalled();
    expect(prisma.labResult.findMany).not.toHaveBeenCalled();
    expect(allergy.getStatus).not.toHaveBeenCalled();
    expect(r.groundedOn).toContain('브리핑(BATCH 2026-08-19T02:10:00.000Z)');
    expect(r.source).toBe('AI');
  });

  it('브리핑 allergy UNAVAILABLE 은 "조회 불가"로 · 미계산 축은 groundedOn 에 ⚠️ 로 밝힌다', async () => {
    const { service, promptOf } = mk(DDX_OK, { brief: async () => ({ ...BRIEF, allergy: { status: 'UNAVAILABLE', items: [] }, unavailable: ['allergy'], cached: false }) });
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(promptOf()).toContain('알레르기: 조회 불가');
    expect(r.groundedOn.join('|')).toContain('⚠️ 브리핑 미계산 축: allergy');
  });

  it('브리핑 서비스가 없으면 종전 직접 조회로 접는다(같은 정본 값) · groundedOn 에 브리핑 표기 없음', async () => {
    const { service, prisma, promptOf } = mk(DDX_OK, {});
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(promptOf()).toContain('활성 문제목록: 직접조회-문제');
    expect(prisma.problemList.findMany).toHaveBeenCalled();
    expect(r.groundedOn.join('|')).not.toContain('브리핑(');
  });

  it('브리핑 조회가 던지면 직접 조회로 접는다 — 던지지 않는다', async () => {
    const { service, promptOf } = mk(DDX_OK, { brief: async () => { throw new Error('redis down'); } });
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(r.source).toBe('AI');
    expect(promptOf()).toContain('활성 문제목록: 직접조회-문제');
  });

  it('검사해석: 활성 문제·복용약·직전 검사가 브리핑에서 · groundedOn 브리핑', async () => {
    const { service, promptOf, prisma } = mk('{"summary":"고칼륨혈증","findings":[{"test":"K","interpretation":"칼륨 상승","severity":"HIGH"}],"clinicalImplication":"신기능 확인","suggestedActions":[],"confidence":0.8}', { brief: async () => ({ ...BRIEF, cached: true }) });
    const r: any = await service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }] });
    const p = promptOf();
    expect(p).toContain('현재 복용약물: 암로디핀, 메트포르민');
    expect(p).toContain('직전 확정 검사(30일·추이 비교용): K 5.9mmol/L(H), Hb 13g/dL');
    expect(prisma.prescription.findMany).not.toHaveBeenCalled();
    expect(r.groundedOn).toContain('브리핑(BATCH 2026-08-19T02:10:00.000Z)');
    expect(r.source).toBe('AI');
  });

  it('약물추천: 알레르기·현재 약물·문제·검사가 브리핑에서(클라 전달값은 우선) · groundedOn 브리핑', async () => {
    const { service, promptOf, prisma } = mk('{"recommendations":[{"name":"암로디핀","dosage":"5mg qd","reason":"고혈압 1차","guideline":"KSH"}],"contraindicated":[],"orderSetSuggested":null}', { brief: async () => ({ ...BRIEF, cached: true }) });
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    const p = promptOf();
    expect(p).toContain('알레르기: 페니실린');
    expect(p).toContain('현재 약물: 암로디핀, 메트포르민');
    expect(p).toContain('활성 문제: 고혈압, 제2형 당뇨병');
    expect(prisma.prescription.findMany).not.toHaveBeenCalled();
    expect(r.groundedOn).toContain('브리핑(BATCH 2026-08-19T02:10:00.000Z)');
    const b = mk('{"recommendations":[{"name":"암로디핀","dosage":"5mg qd","reason":"고혈압 1차","guideline":"KSH"}],"contraindicated":[],"orderSetSuggested":null}', { brief: async () => ({ ...BRIEF, cached: true }) });
    await b.service.recommendDrugs({ patientId: PID, diagnosis: '고혈압', patientContext: { currentMedications: ['클라-약'], allergies: ['클라-알레르기'] } } as any);
    expect(b.promptOf()).toContain('현재 약물: 클라-약');
    expect(b.promptOf()).toContain('알레르기: 클라-알레르기');
  });

  it('SOAP 초안: 클라가 약물을 안 넘기면 브리핑 활성약을 넣고 groundedOn 에 "현재 약물(브리핑)" · 넘기면 클라 값', async () => {
    const SOAP = '{"assessment":"본태성 고혈압","plan":"1. 암로디핀 유지\\n2. 혈압 재측정","confidence":0.7,"references":[]}';
    const a = mk(SOAP, { brief: async () => ({ ...BRIEF, cached: true }) });
    const r: any = await a.service.autoSoap({ patientId: PID, subjective: '두통' });
    expect(a.promptOf()).toContain('현재 약물: 암로디핀, 메트포르민');
    expect(r.groundedOn).toContain('현재 약물(브리핑)');
    expect(r.groundedOn).toContain('브리핑(BATCH 2026-08-19T02:10:00.000Z)');
    const b = mk(SOAP, { brief: async () => ({ ...BRIEF, cached: true }) });
    const r2: any = await b.service.autoSoap({ patientId: PID, subjective: '두통', existingMedications: ['클라-약'] });
    expect(b.promptOf()).toContain('현재 약물: 클라-약');
    expect(r2.groundedOn).toContain('현재 약물(클라 전달)');
    expect(b.briefSvc!.get).not.toHaveBeenCalled(); // 클라 값이 있으면 브리핑을 부르지 않는다
    // 브리핑 서비스가 없으면 종전대로 약물 줄 없음
    const c = mk(SOAP, {});
    await c.service.autoSoap({ patientId: PID, subjective: '두통' });
    expect(c.promptOf()).not.toContain('현재 약물:');
  });
});

describe('실시간 응답 캐시 — 입력 해시 · source AI 만 · cached:true', () => {
  it('🔴 같은 입력 재호출은 cached:true·cachedAt 을 달고 LLM 을 다시 부르지 않는다 · 원본 latencyMs 유지 · 키 형식 ai:skill:<skill>:<sha256>', async () => {
    const redis = mkRedis();
    const { service, chat } = mk(DDX_OK, { redis });
    const first: any = await service.realtimeDdx({ patientId: PID, subjective: '두통', objective: undefined });
    expect(first.cached).toBeFalsy();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(redis.setex).toHaveBeenCalledTimes(1);
    const [key, ttl] = redis.setex.mock.calls[0];
    expect(key).toMatch(/^ai:skill:realtimeDdx:[0-9a-f]{64}$/);
    expect(ttl).toBe(600);
    // 키 순서·undefined 가 달라도 같은 입력이면 같은 키
    const second: any = await service.realtimeDdx({ subjective: '두통', patientId: PID } as any);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(typeof second.cachedAt).toBe('string');
    expect(second.latencyMs).toBe(first.latencyMs);
    expect(second.differentials[0].name).toBe('본태성 고혈압');
    // 다른 입력이면 새 호출
    await service.realtimeDdx({ patientId: PID, subjective: '흉통' });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('🔴 FALLBACK/실패는 저장하지 않는다 — 다음 호출이 다시 시도한다', async () => {
    const redis = mkRedis();
    const { service, chat } = mk('{"differentials":[],"suggestedTests":[],"redFlags":[]}', { redis });
    const r: any = await service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(r.source).toBe('FALLBACK');
    expect(redis.setex).not.toHaveBeenCalled();
    await service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('4스킬 모두 각자 키로 캐시된다(interpretLab·recommendDrugs·autoSoap)', async () => {
    const redis = mkRedis();
    const lab = mk('{"summary":"고칼륨혈증","findings":[{"test":"K","interpretation":"칼륨 상승","severity":"HIGH"}],"clinicalImplication":"확인","suggestedActions":[],"confidence":0.8}', { redis });
    await lab.service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', flag: 'H' }] });
    await lab.service.interpretLab({ patientId: PID, results: [{ testName: 'K', value: '5.9', flag: 'H' }] });
    expect(lab.chat).toHaveBeenCalledTimes(1);
    const rx = mk('{"recommendations":[{"name":"암로디핀","dosage":"5mg","reason":"1차","guideline":"KSH"}],"contraindicated":[],"orderSetSuggested":null}', { redis });
    await rx.service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    const hit: any = await rx.service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    expect(rx.chat).toHaveBeenCalledTimes(1); expect(hit.cached).toBe(true);
    const soap = mk('{"assessment":"긴장성 두통","plan":"1. 휴식","confidence":0.7,"references":[]}', { redis });
    await soap.service.autoSoap({ patientId: PID, subjective: '두통' });
    await soap.service.autoSoap({ patientId: PID, subjective: '두통' });
    expect(soap.chat).toHaveBeenCalledTimes(1);
    const keys = [...redis.store.keys()];
    expect(keys.some((k) => k.startsWith('ai:skill:interpretLab:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('ai:skill:recommendDrugs:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('ai:skill:autoSoap:'))).toBe(true);
  });

  it('Redis 가 없으면 캐시 없이 매번 부른다 · Redis 가 던져도 결과는 나온다', async () => {
    const none = mk(DDX_OK, {});
    await none.service.realtimeDdx({ patientId: PID, subjective: '두통' });
    await none.service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(none.chat).toHaveBeenCalledTimes(2);
    const broken = mk(DDX_OK, { redis: { get: vi.fn().mockRejectedValue(new Error('down')), setex: vi.fn().mockRejectedValue(new Error('down')) } });
    const r: any = await broken.service.realtimeDdx({ patientId: PID, subjective: '두통' });
    expect(r.source).toBe('AI'); expect(r.cached).toBeFalsy();
  });

  it('환자가 다르면 같은 입력이라도 다른 키(환자 간 응답 누출 금지)', () => {
    const a = MedicalAiService.skillCacheKey('realtimeDdx', 'p1', { subjective: '두통' });
    const b = MedicalAiService.skillCacheKey('realtimeDdx', 'p2', { subjective: '두통' });
    expect(a).not.toBe(b);
    expect(MedicalAiService.skillCacheKey('realtimeDdx', 'p1', { subjective: '두통', objective: undefined })).toBe(a);
  });
});
