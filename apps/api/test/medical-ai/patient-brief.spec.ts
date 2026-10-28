/**
 * 환자 AI 브리핑(하이브리드 배치 A) — 기획서 chart-ai-assistant-agent §4.6-a.
 * · LLM 을 부르지 않는다 · 캐시 없으면 lazy 계산 후 저장 · 이벤트가 오면 지운다 · 야간 배치는 config OFF 면 아무 것도 안 한다
 * · 계산 못 한 축은 unavailable 에 적는다(조용히 비우지 않는다)
 */
import { describe, it, expect, vi } from 'vitest';
import { PatientBriefService } from '../../src/modules/medical-ai/patient-brief.service';

const PID = '11111111-1111-4111-8111-111111111111';
const mkPrisma = (over: Record<string, unknown> = {}) => ({
  patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1975-01-01'), gender: 'FEMALE' }) },
  prescription: { findMany: vi.fn().mockResolvedValue([
    { dosage: '5mg', frequency: '1일 1회', duration: 30, createdAt: new Date(Date.now() - 3 * 86400_000), medicationCode: { nameKo: '암로디핀' } },
    { dosage: '5mg', frequency: '1일 1회', duration: 30, createdAt: new Date(Date.now() - 90 * 86400_000), medicationCode: { nameKo: '암로디핀' } },
  ]) },
  encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([]) },
  // 실제 모양(2026-10-03 v3): 전 상태 · 진단 코드 동반
  problemList: { findMany: vi.fn().mockResolvedValue([{ description: '고혈압', status: 'ACTIVE', diagnosisCode: { code: 'I10' } }]) },
  labResult: { findMany: vi.fn().mockResolvedValue([
    { completedAt: new Date('2026-08-18T09:00:00Z'), items: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }, { testName: 'Hb', value: '13', unit: 'g/dL', flag: 'N' }] },
    { completedAt: new Date('2026-08-10T09:00:00Z'), items: [{ testName: 'K', value: '4.1', unit: 'mmol/L', flag: 'N' }] },
  ]), findFirst: vi.fn().mockResolvedValue({ completedAt: new Date('2026-08-18T09:00:00Z') }) },
  // 최신 활력 = 두 원장 읽기 정본(외래 + 입원 · 2026-10-10) — 여기선 외래 원장 한 건·입원 원장 없음
  preVisitVitals: { findMany: vi.fn().mockResolvedValue([{ measuredAt: new Date('2026-08-19T01:00:00Z'), systolicBp: 150, diastolicBp: 95, heartRate: 102, temperature: 36.8, spo2: 94, respiratoryRate: 20 }]) },
  flowSheetEntry: { findMany: vi.fn().mockResolvedValue([]) },
  encounter: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date('2026-08-05'), chiefComplaint: '두통', assessment: '긴장성 두통', status: 'SIGNED' }) },
  admission: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([{ patientId: PID }]) },
  appointment: { findMany: vi.fn().mockResolvedValue([{ patientId: PID }, { patientId: 'p2' }]) },
  ...over,
});
const mkRedis = () => { const store = new Map<string, string>(); return { store, get: vi.fn(async (k: string) => store.get(k) ?? null), setex: vi.fn(async (k: string, _t: number, v: string) => { store.set(k, v); }), del: vi.fn(async (k: string) => { store.delete(k); }) }; };

describe('PatientBriefService', () => {
  it('lazy 계산 — 정본 값만 · 항목별 최신 검사값(K 는 5.9 H, 4.1 이 아니다) · 알레르기 3상태 · 캐시에 저장', async () => {
    const redis = mkRedis(); const prisma = mkPrisma();
    const svc = new PatientBriefService(prisma as any, redis as any, undefined, { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any);
    const b = await svc.get(PID);
    expect(b.cached).toBe(false); expect(b.trigger).toBe('LAZY');
    expect(b.activeMedications).toEqual(['암로디핀']);
    expect(b.recentLabs.find((l) => l.testName === 'K')).toMatchObject({ value: '5.9', flag: 'H' });
    expect(b.abnormalLabCount).toBe(1);
    expect(b.allergy.status).toBe('NOT_ASSESSED');
    expect(b.latestVitals?.spo2).toBe(94);
    expect(b.unavailable).toEqual([]);
    expect(redis.setex).toHaveBeenCalledWith(`ai:brief:v3:${PID}`, 24 * 3600, expect.any(String));
    const again = await svc.get(PID);
    expect(again.cached).toBe(true);
  });

  it('🔴 계산 못 한 축은 unavailable 에 적고 나머지는 낸다(조용히 비우지 않는다)', async () => {
    const prisma = mkPrisma({ labResult: { findMany: vi.fn().mockRejectedValue(new Error('db')), findFirst: vi.fn().mockResolvedValue(null) } });
    const svc = new PatientBriefService(prisma as any, undefined, undefined, undefined);
    const b = await svc.get(PID);
    expect(b.unavailable).toContain('recentLabs');
    expect(b.unavailable).toContain('allergy'); // 상태 서비스 미주입도 "모른다"
    expect(b.allergy.status).toBe('UNAVAILABLE');
    expect(b.activeProblems).toEqual(['고혈압']);
  });

  it('근거 데이터 이벤트가 오면 캐시를 지운다 → 다음 조회가 재계산', async () => {
    const redis = mkRedis(); const prisma = mkPrisma();
    const svc = new PatientBriefService(prisma as any, redis as any);
    await svc.get(PID);
    expect(redis.store.has(`ai:brief:v3:${PID}`)).toBe(true);
    svc.onLab({ patientId: PID }); await new Promise((r) => setTimeout(r, 0));
    expect(redis.store.has(`ai:brief:v3:${PID}`)).toBe(false);
    const b = await svc.get(PID); expect(b.cached).toBe(false);
  });

  it('야간 배치: config OFF 면 아무것도 계산하지 않고, ON 이면 내일 예약+재원만', async () => {
    const prisma = mkPrisma();
    const off = new PatientBriefService(prisma as any, mkRedis() as any, { get: vi.fn().mockResolvedValue(false) } as any);
    expect(await off.nightly()).toBeUndefined();
    const on = new PatientBriefService(prisma as any, mkRedis() as any, { get: vi.fn(async (k: string) => (k === 'ai.brief.batch.enabled' ? true : null)) } as any);
    const r = await on.nightly();
    expect(r).toEqual({ targets: 2, ok: 2, fail: 0 });
    expect(prisma.appointment.findMany).toHaveBeenCalled();
  });
});

/**
 * 🔴 배치 B(LLM 사전 스킬 · 검사해석) — 기획서 §4.6-a 배치 B · §5 P1.
 *   · `ai.brief.llm.enabled` OFF(기본) → 해석기를 부르지 않는다 · lazy/refresh 는 어떤 경우에도 부르지 않는다
 *   · ON → 검사 결과가 있는 환자만(근거 게이트) · 검증층 통과(source AI)만 싣는다 · 예산 초과는 셈하고 unavailable 에 적는다
 * 재주입 확인: 검사 0건 환자에게도 부르면 실패 · FALLBACK 을 실으면 실패 · 예산 초과를 조용히 건너뛰면(셈이 0) 실패.
 */
describe('PatientBriefService — 배치 B(야간 LLM 사전 스킬)', () => {
  const cfg = (over: Record<string, unknown>) => ({ get: vi.fn(async (k: string) => (k in over ? over[k] : null)) }) as any;
  const AI_OK = { summary: '고칼륨혈증', findings: [{ test: 'K', interpretation: '칼륨 상승', severity: 'HIGH' }], clinicalImplication: '신기능 확인', suggestedActions: [], confidence: 0.8, source: 'AI', latencyMs: 1200, verify: { passed: ['LAB_DIRECTION'], failed: [] } };

  it('OFF(기본): 배치 A 만 · 해석기 호출 0 · skills.labInterpretation null', async () => {
    const svc = new PatientBriefService(mkPrisma() as any, mkRedis() as any, cfg({ 'ai.brief.batch.enabled': true }));
    const interp = vi.fn().mockResolvedValue(AI_OK);
    svc.attachLabInterpreter(interp);
    const r = await svc.nightly();
    expect(r).toEqual({ targets: 2, ok: 2, fail: 0 });
    expect(interp).not.toHaveBeenCalled();
    const b = await svc.get(PID); expect(b.skills.labInterpretation).toBeNull();
  });

  it('🔴 ON: 검사 있는 환자만 부른다 · AI 결과는 computedAt·basedOn 과 함께 skills 에 · 검사 0건 환자는 null(호출 없음)', async () => {
    const prisma = mkPrisma();
    // p2 는 검사 없음
    prisma.labResult.findMany = vi.fn(async ({ where }: any) => (where.patientId === PID ? [{ completedAt: new Date('2026-08-18T09:00:00Z'), items: [{ testName: 'K', value: '5.9', unit: 'mmol/L', flag: 'H' }] }] : []));
    const redis = mkRedis();
    const svc = new PatientBriefService(prisma as any, redis as any, cfg({ 'ai.brief.batch.enabled': true, 'ai.brief.llm.enabled': true }));
    const interp = vi.fn().mockResolvedValue(AI_OK);
    svc.attachLabInterpreter(interp);
    const r: any = await svc.nightly();
    expect(interp).toHaveBeenCalledTimes(1);
    expect(interp.mock.calls[0][0]).toBe(PID);
    expect(interp.mock.calls[0][1].recentLabs[0]).toMatchObject({ testName: 'K', flag: 'H' });
    expect(r.llm).toEqual({ eligible: 1, computed: 1, budgetSkipped: 0, rejected: 0, noInterpreter: 0, error: 0, noLabs: 1 });
    const b = JSON.parse(redis.store.get(`ai:brief:v3:${PID}`)!);
    expect(b.skills.labInterpretation).toMatchObject({ summary: '고칼륨혈증', source: 'AI', latencyMs: 1200 });
    expect(typeof b.skills.labInterpretation.computedAt).toBe('string');
    expect(b.skills.labInterpretation.basedOn).toEqual([`브리핑 ${b.computedAt}`, 'K 5.9mmol/L(H)']);
    const p2 = JSON.parse(redis.store.get('ai:brief:v3:p2')!);
    expect(p2.skills.labInterpretation).toBeNull();
    // 캐시 조회도 skills 를 그대로 낸다
    const got = await svc.get(PID); expect(got.cached).toBe(true); expect(got.skills.labInterpretation?.summary).toBe('고칼륨혈증');
  });

  it('🔴 검증층 탈락(FALLBACK)은 싣지 않는다 — null + unavailable 에 사유', async () => {
    const redis = mkRedis();
    const svc = new PatientBriefService(mkPrisma() as any, redis as any, cfg({ 'ai.brief.batch.enabled': true, 'ai.brief.llm.enabled': true }));
    svc.attachLabInterpreter(vi.fn().mockResolvedValue({ ...AI_OK, source: 'FALLBACK', reason: 'VERIFY_REJECTED:LAB_DIRECTION' }));
    const r: any = await svc.nightly();
    expect(r.llm.rejected).toBe(2); expect(r.llm.computed).toBe(0);
    const b = JSON.parse(redis.store.get(`ai:brief:v3:${PID}`)!);
    expect(b.skills.labInterpretation).toBeNull();
    expect(b.unavailable).toContain('skills.labInterpretation(FALLBACK:VERIFY_REJECTED:LAB_DIRECTION)');
  });

  it('🔴 환자당 예산 초과는 셈하고 unavailable 에 적는다(조용히 건너뛰지 않는다) · 해석기 오류도 셈한다', async () => {
    const redis = mkRedis();
    const svc = new PatientBriefService(mkPrisma() as any, redis as any, cfg({ 'ai.brief.batch.enabled': true, 'ai.brief.llm.enabled': true, 'ai.brief.patientBudgetSec': 0.02, 'ai.brief.concurrency': 1 }));
    let n = 0;
    svc.attachLabInterpreter(vi.fn().mockImplementation(() => (++n === 1 ? new Promise((res) => setTimeout(() => res(AI_OK), 200)) : Promise.reject(new Error('llm 500')))));
    const r: any = await svc.nightly();
    expect(r.llm.budgetSkipped).toBe(1); expect(r.llm.error).toBe(1); expect(r.llm.computed).toBe(0);
    const b = JSON.parse(redis.store.get(`ai:brief:v3:${PID}`)!);
    expect(b.unavailable.join('|')).toMatch(/skills\.labInterpretation\(예산 .*초과 — 미계산\)/);
    const p2 = JSON.parse(redis.store.get('ai:brief:v3:p2')!);
    expect(p2.unavailable).toContain('skills.labInterpretation(오류: llm 500)');
  });

  it('해석기가 안 붙었으면 "해석기 미연결"로 셈한다 · lazy/refresh 는 LLM 을 부르지 않고 근거가 같으면 배치 결과를 이어받는다', async () => {
    const redis = mkRedis();
    const svc = new PatientBriefService(mkPrisma() as any, redis as any, cfg({ 'ai.brief.batch.enabled': true, 'ai.brief.llm.enabled': true }));
    const r: any = await svc.nightly();
    expect(r.llm.noInterpreter).toBe(2);
    // 이제 해석기를 붙이고 배치 → 결과 저장 → refresh(lazy 재계산)해도 해석기는 불리지 않고 결과는 이어받는다
    const interp = vi.fn().mockResolvedValue(AI_OK);
    svc.attachLabInterpreter(interp);
    await svc.nightly();
    expect(interp).toHaveBeenCalledTimes(2);
    const re = await svc.get(PID, { refresh: true });
    expect(interp).toHaveBeenCalledTimes(2);
    expect(re.trigger).toBe('REFRESH'); expect(re.skills.labInterpretation?.summary).toBe('고칼륨혈증');
    // 근거가 달라지면(검사 이벤트 → 무효화 → lazy) null 로 돌아간다 — 옛 해석을 새 검사에 붙이지 않는다
    svc.onLab({ patientId: PID }); await new Promise((r) => setTimeout(r, 0));
    const lazy = await svc.get(PID);
    expect(lazy.trigger).toBe('LAZY'); expect(lazy.skills.labInterpretation).toBeNull();
    expect(interp).toHaveBeenCalledTimes(2);
  });
});

describe('PatientBriefService — 진료 전 요약 보강(2026-10-02)', () => {
  const svcOf = (prisma: unknown) => new PatientBriefService(prisma as any, undefined, undefined, { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any);

  it('🔴 투약 — 같은 약·용량·용법은 한 줄(count) · 최신 처방 기준 기간 경과 · 일수 없으면 모름(null)', async () => {
    const prisma = mkPrisma({ prescription: { findMany: vi.fn().mockResolvedValue([
      { dosage: '10mg', frequency: '1일 1회', duration: 28, createdAt: new Date(Date.now() - 58 * 86400_000), medicationCode: { nameKo: '아토르바스타틴' } },
      { dosage: '10mg', frequency: '1일 1회', duration: 28, createdAt: new Date(Date.now() - 64 * 86400_000), medicationCode: { nameKo: '아토르바스타틴' } },
      { dosage: '10mg', frequency: '1일 1회', duration: 28, createdAt: new Date(Date.now() - 64 * 86400_000), medicationCode: { nameKo: '아토르바스타틴' } },
      { dosage: '50mg', frequency: '1일 1회', duration: 28, createdAt: new Date(Date.now() - 2 * 86400_000), medicationCode: { nameKo: '로사르탄' } },
      { dosage: '1정', frequency: null, duration: null, createdAt: new Date(), medicationCode: { nameKo: '무기한약' } },
    ]) } });
    const b = await svcOf(prisma).compute(PID, 'LAZY');
    const by = Object.fromEntries((b.medicationDetails ?? []).map((m) => [m.name, m]));
    expect(by['아토르바스타틴']).toMatchObject({ count: 3, overDuration: true });
    expect(by['로사르탄']).toMatchObject({ count: 1, overDuration: false });
    expect(by['무기한약'].overDuration).toBeNull(); // 일수 없으면 지났는지 모른다
    // 투약만 묻는다 — 검사·영상 오더를 처방으로 세지 않는다
    expect((prisma.prescription.findMany as any).mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE', type: 'MEDICATION' });
  });

  it('🔴 진료 기록 진단 — 서명·정정 진료만 · 코드별 최신 시각·진료 건수 · 문제 목록과 섞지 않는다', async () => {
    const enc = (id: string, d: string) => ({ id, createdAt: new Date(d) });
    const prisma = mkPrisma({
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([
        { diagnosisCode: { id: 'dc-j', code: 'J18.9', nameKo: '폐렴' }, encounter: enc('e3', '2026-07-09') },
        { diagnosisCode: { id: 'dc-e', code: 'E11', nameKo: '2형 당뇨병' }, encounter: enc('e2', '2026-05-07') },
        { diagnosisCode: { id: 'dc-i', code: 'I10', nameKo: '본태성 고혈압' }, encounter: enc('e1', '2026-03-02') },
        { diagnosisCode: { id: 'dc-i', code: 'I10', nameKo: '본태성 고혈압' }, encounter: enc('e0', '2026-01-01') },
      ]) },
    });
    const b = await svcOf(prisma).compute(PID, 'LAZY');
    expect(b.activeProblems).toEqual([]);
    expect(b.recordDiagnoses).toEqual([
      { code: 'J18.9', name: '폐렴', diagnosisCodeId: 'dc-j', lastAt: new Date('2026-07-09').toISOString(), encounters: 1, onProblemList: false },
      { code: 'E11', name: '2형 당뇨병', diagnosisCodeId: 'dc-e', lastAt: new Date('2026-05-07').toISOString(), encounters: 1, onProblemList: false },
      { code: 'I10', name: '본태성 고혈압', diagnosisCodeId: 'dc-i', lastAt: new Date('2026-03-02').toISOString(), encounters: 2, onProblemList: false },
    ]);
    expect((prisma.encounterDiagnosis.findMany as any).mock.calls[0][0].where).toEqual({ encounter: { patientId: PID, status: { in: ['SIGNED', 'AMENDED'] } } });
  });

  it('🔴 (10-03) 문제 목록 — 요약엔 활성·만성(종전 활성만 — 만성 문제가 빠졌다) · 진단 등재 여부는 상태 무관(해결도 정리된 것)', async () => {
    const enc = (id: string, d: string) => ({ id, createdAt: new Date(d) });
    const prisma = mkPrisma({
      problemList: { findMany: vi.fn().mockResolvedValue([
        { description: '2형 당뇨병', status: 'CHRONIC', diagnosisCode: { code: 'E11' } },
        { description: '폐렴', status: 'RESOLVED', diagnosisCode: { code: 'J18.9' } },
        { description: '요통', status: 'ACTIVE', diagnosisCode: { code: 'M54.5' } },
      ]) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([
        { diagnosisCode: { id: 'dc-j', code: 'J18.9', nameKo: '폐렴' }, encounter: enc('e3', '2026-07-09') },
        { diagnosisCode: { id: 'dc-e', code: 'E11', nameKo: '2형 당뇨병' }, encounter: enc('e2', '2026-05-07') },
        { diagnosisCode: { id: 'dc-i', code: 'I10', nameKo: '본태성 고혈압' }, encounter: enc('e1', '2026-03-02') },
      ]) },
    });
    const b = await svcOf(prisma).compute(PID, 'LAZY');
    expect(b.activeProblems).toEqual(['2형 당뇨병', '요통']);
    expect(b.recordDiagnoses!.map((d) => [d.code, d.onProblemList])).toEqual([['J18.9', true], ['E11', true], ['I10', false]]);
    expect((prisma.problemList.findMany as any).mock.calls[0][0].where).toEqual({ patientId: PID }); // 전 상태
  });

  it('🔴 문제 목록을 읽지 못하면 등재 여부는 null(모름 — "없음"으로 말하지 않는다)', async () => {
    const prisma = mkPrisma({
      problemList: { findMany: vi.fn().mockRejectedValue(new Error('db')) },
      encounterDiagnosis: { findMany: vi.fn().mockResolvedValue([{ diagnosisCode: { id: 'dc-i', code: 'I10', nameKo: '본태성 고혈압' }, encounter: { id: 'e1', createdAt: new Date('2026-03-02') } }]) },
    });
    const b = await svcOf(prisma).compute(PID, 'LAZY');
    expect(b.unavailable).toContain('activeProblems');
    expect(b.recordDiagnoses![0].onProblemList).toBeNull();
  });

  it('검사 — 30일 창이 비어도 마지막 검사 시각을 말한다 · 검사 기록이 없으면 null', async () => {
    const empty = mkPrisma({ labResult: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ completedAt: new Date('2026-08-05T03:00:00Z') }) } });
    const b = await svcOf(empty).compute(PID, 'LAZY');
    expect(b.recentLabs).toEqual([]);
    expect(b.lastLabAt).toBe('2026-08-05T03:00:00.000Z');
    const none = mkPrisma({ labResult: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) } });
    expect((await svcOf(none).compute(PID, 'LAZY')).lastLabAt).toBeNull();
  });

  it('진단 조회 실패는 unavailable 에 적는다(빈 진단으로 말하지 않는다)', async () => {
    const prisma = mkPrisma({ encounterDiagnosis: { findMany: vi.fn().mockRejectedValue(new Error('db')) } });
    const b = await svcOf(prisma).compute(PID, 'LAZY');
    expect(b.unavailable).toContain('recordDiagnoses');
  });
});
