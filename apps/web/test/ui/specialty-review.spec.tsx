/**
 * 전문진료 화면 검토(2026-10-07).
 *  · 안과: 굴절값(JsonB 객체)을 문자열로 캐스팅해 탭이 죽던 것 → 정본 포맷터
 *  · 비뇨: IPSS 7문항이 0(무증상)으로 시작해 합계를 지어냈다 → 미선택·완료 시만 합계·전송
 *  · 방사선: 부작용 등급 키가 DTO 와 달라 전부 버려졌다 → DTO 키 · 미선택 시작 · 점막염 칸
 *  · 재활: activities 배열(DTO @IsObject → 400)·duration 30 날조·없는 필드(painVas·gaitStatus·riskLevel)
 *  · 투석: 서버가 안 주는 machineName·elapsedMinutes → machine.name·startTime 실측 · 건체중 초과는 둘 다 있을 때만
 *  · 산부인과: 분만 시각 = 사람이 적는 사실(미래 불가) · 대조 실패 ≠ 불일치
 *  · 정신과: 계속심사는 보호·행정입원만 · 결과를 골라야 기록 · 퇴원도 창에서
 *  · 치과·이비인후과·호스피스·피부과: 쓰기 폼 미선택 · 상태 없는 치아를 건전치로 그리지 않음 · 빈 비교 슬라이더 없음
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildToxicityBody, emptyToxicityForm, toxicityFormReady } from '@/app/(main)/radiation/radiation-toxicity';
import { bergFallRisk, buildRehabCompleteBody, emptyRehabCompleteForm, rehabActivitiesText } from '@/lib/rehab-session';
import { dialysisElapsedMinutes, dialysisMachineName, excessOverDryWeight } from '@/lib/dialysis-session';
import { deliveredAtIso, motherBabyVerifyOutcome } from '@/lib/obgyn-delivery';

const src = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');

describe('방사선 부작용 본문', () => {
  it('🔴 DTO 키(skinGrade…)로 · 고른 것만 · 미선택 시작', () => {
    const f = emptyToxicityForm();
    expect(f.skin).toBeNull();
    expect(toxicityFormReady(f)).toBe(false);
    const g = { ...f, week: 3, skin: 2, mucositis: 0, notes: ' 건조 ' };
    expect(toxicityFormReady(g)).toBe(true);
    expect(buildToxicityBody(g)).toEqual({ week: 3, skinGrade: 2, mucositisGrade: 0, notes: '건조' });
  });
  it('주차 없으면 저장 불가 · 화면은 본문 빌더를 쓴다', () => {
    expect(toxicityFormReady({ ...emptyToxicityForm(), skin: 1 })).toBe(false);
    const page = src('app/(main)/radiation/page.tsx');
    expect(page).toContain('addToxicity.mutate(buildToxicityBody(toxForm))');
    expect(page).toContain('t.mucositisGrade');
  });
});

describe('재활 완료 본문·평가 표시', () => {
  it('🔴 activities 는 객체 · duration 은 적은 값만', () => {
    const b = buildRehabCompleteBody({ ...emptyRehabCompleteForm(), activities: 'ROM 운동', hr: '88', bp: '120/80' });
    expect(Array.isArray(b.activities)).toBe(false);
    expect(b.activities).toEqual({ text: 'ROM 운동' });
    expect(b.vitals).toEqual({ bp: '120/80', hr: 88 });
    expect('duration' in b).toBe(false);
    expect(buildRehabCompleteBody({ ...emptyRehabCompleteForm(), duration: '25' }).duration).toBe(25);
    expect(buildRehabCompleteBody(emptyRehabCompleteForm())).toEqual({});
  });
  it('옛 배열·새 객체 활동 둘 다 읽는다 · Berg 해석 · 서버 필드명', () => {
    expect(rehabActivitiesText([{ name: '보행' }, { name: 'ROM' }])).toBe('보행, ROM');
    expect(rehabActivitiesText({ text: '근력' })).toBe('근력');
    expect(bergFallRisk(null)).toBeNull();
    expect(bergFallRisk(20)).toBe('HIGH');
    expect(bergFallRisk(40)).toBe('MODERATE');
    expect(bergFallRisk(41)).toBe('LOW');
    const page = src('app/(main)/rehab/page.tsx');
    expect(page).not.toMatch(/painVas|gaitStatus|riskLevel|duration: 30/);
    const ws = src('app/(main)/workstation/therapy/page.tsx');
    expect(ws).toContain('activities: { text: rehabForm.activities.trim() }');
  });
});

describe('투석 카드', () => {
  it('🔴 경과는 시작 시각에서 · 기계는 machine.name', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    expect(dialysisElapsedMinutes('2026-10-07T08:30:00Z', now)).toBe(90);
    expect(dialysisElapsedMinutes(null, now)).toBeNull();
    expect(dialysisMachineName({ machine: { name: 'HD-03' } })).toBe('HD-03');
    expect(dialysisMachineName({ machineName: 'x' })).toBeNull();
  });
  it('건체중 초과는 둘 다 있을 때만', () => {
    expect(excessOverDryWeight('72.3', '70.0')).toBe(2.3);
    expect(excessOverDryWeight(null, '70')).toBeNull();
    const page = src('app/(main)/dialysis/page.tsx');
    expect(page).not.toContain('s.elapsedMinutes');
    expect(page).not.toContain('s.machineName');
  });
});

describe('분만·모아 대조', () => {
  it('🔴 분만 시각은 적은 값 · 비면 불가 · 미래 불가', () => {
    const now = new Date('2026-10-07T10:00:00');
    expect(deliveredAtIso('', now)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(deliveredAtIso('2026-10-07T11:00', now)).toEqual({ ok: false, reason: 'FUTURE' });
    expect(deliveredAtIso('2026-10-07T09:12', now).ok).toBe(true);
    const page = src('app/(main)/obgyn/DeliveryBoard.tsx');
    expect(page).not.toContain('deliveredAt: new Date().toISOString()');
  });
  it('🔴 서버가 불일치라 한 것만 불일치', () => {
    expect(motherBabyVerifyOutcome({ code: 'MOTHER_BABY_MISMATCH' })).toBe('MISMATCH');
    expect(motherBabyVerifyOutcome({ code: 'BAD_REQUEST', details: { babyOk: false, motherOk: true } })).toBe('MISMATCH');
    expect(motherBabyVerifyOutcome(new Error('network'))).toBe('ERROR');
    expect(motherBabyVerifyOutcome({ code: 'Not Found' })).toBe('ERROR');
  });
});

describe('비뇨 IPSS·안과 굴절', () => {
  it('🔴 IPSS 는 미선택 시작 · 완료됐을 때만 합계·전송', () => {
    const u = src('app/(main)/patients/[id]/encounter/new/components/UrologyEncounterLayout.tsx');
    expect(u).toContain('Array(7).fill(null)');
    expect(u).not.toContain('Array(7).fill(0)');
    expect(u).toContain('...(ipssComplete && ipssTotal != null ? { ipssScore: ipssTotal } : {})');
  });
  it('🔴 굴절 객체를 문자열로 포맷 · 값 없으면 undefined', async () => {
    const { fmtRefractionObj } = await import('@/app/(main)/patients/[id]/components/OphthalmologyTab');
    expect(fmtRefractionObj(null)).toBeUndefined();
    expect(fmtRefractionObj({})).toBeUndefined();
    expect(typeof fmtRefractionObj({ sphere: -1.25, cylinder: -0.5, axis: 180 })).toBe('string');
    const page = src('app/(main)/ophthalmology/page.tsx');
    expect(page).toContain('fmtRefractionObj(latestExam.refractionOd)');
    expect(page).not.toMatch(/refractionO[ds] as string/);
  });
});

describe('쓰기 폼 미선택·표시 정직성', () => {
  it('🔴 이비인후과·호스피스·정신과·치과·피부과', () => {
    const ent = src('app/(main)/ent/page.tsx');
    expect(ent).toContain("{ ear: '', type: '', model: '', notes: '' }");
    expect(ent).not.toMatch(/studyType: 'PSG'/);
    const hos = src('app/(main)/hospice/page.tsx');
    expect(hos).toContain('Array(9).fill(null)');
    expect(hos).not.toContain('ppsScore: 50');
    const sec = src('app/(main)/psychiatry/SeclusionRestraintSection.tsx');
    expect(sec).toContain("type: '', riskType: ''");
    const den = src('app/(main)/dental/page.tsx');
    expect(den).not.toContain("?? 'NORMAL'");
    expect(den).toContain('nextDentalLabStatus(current)');
    const der = src('app/(main)/dermatology/page.tsx');
    expect(der).toContain('data-derm-photos-empty');
  });
});

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe('정신과 비자의입원 심사', () => {
  beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); });
  const row = (id: string, legalType: string, continuationReviewDue: string | null) => ({ id, legalType, status: 'ACTIVE', admittedAt: '2026-07-01T00:00:00Z', legalExpiryAt: null, suitabilityReviewDue: null, suitabilityReviewedAt: null, suitabilityResult: null, guardian1Name: null, guardian2Name: null, continuationReviewDue, patient: { familyName: '김', givenName: id, mrn: id } });
  it('🔴 응급입원엔 계속심사 버튼이 없다 · 보호입원은 결과를 골라야 기록', async () => {
    get.mockResolvedValue({ data: [row('E1', 'EMERGENCY', null), row('G1', 'GUARDIAN', '2026-10-01')] });
    patch.mockResolvedValue({ data: {} });
    const { default: Section } = await import('@/app/(main)/psychiatry/InvoluntaryAdmissionSection');
    const { container } = render(<Section />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelectorAll('[data-psych-review="discharge"]').length).toBe(2));
    expect(container.querySelectorAll('[data-psych-review="continuation"]').length).toBe(1);
    fireEvent.click(container.querySelector('[data-psych-review="continuation"]')!);
    const confirm = () => container.querySelector('[data-review-confirm]') as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-review-result="계속입원"]')!);
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/psychiatry/admissions/G1/continuation-review', { result: '계속입원' }));
  });
});
