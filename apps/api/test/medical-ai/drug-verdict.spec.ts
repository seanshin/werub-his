/**
 * 🔴 약물추천 DUR 정본 재검증(`durVerdict`) 가드 — 기획서 chart-ai-assistant-agent §4.2·§4.4 규칙 6.
 *
 *   · 판정은 DurService.checkInteractions 결과에서만: ERROR/BLOCK/CONTRAINDICATED→BLOCK · WARNING→WARNING · 없음(INFO 만)→PASS
 *   · 약명은 약가마스터 정본 검색(buildMedicationSearchWhere)으로 특정 — 0건/여러 건 → UNRESOLVED(추정 매칭으로 PASS 를 만들지 않는다)
 *   · DUR 서비스 부재/오류 → durVerdict null + "재검증 실패: …"(PASS 아님)
 *   · encounterId: 입력 > 최근 진료 > ZERO_UUID(임신·현 진료 처방 점검 생략을 basis 에 적는다)
 *
 * 재주입 확인: WARNING 만 있는데 PASS 를 내면 실패 · 후보 여러 건에 첫 건을 잡아 PASS 를 내면 실패 · 서비스 없을 때 PASS 를 내면 실패.
 */
import { describe, it, expect, vi } from 'vitest';
import { medicationQueryCandidates, normalizeIngredientKey, resolveEncounterForDur, resolveMedicationCode, verdictForRecommendation, verdictFromWarnings } from '../../src/modules/medical-ai/drug-verdict';
import { MedicalAiService } from '../../src/modules/medical-ai/medical-ai.service';
import { ZERO_UUID } from '../../src/modules/audit/audit-routes';

const PID = '11111111-1111-4111-8111-111111111111';
const ENC = '22222222-2222-4222-8222-222222222222';
const AMLO = { id: 'mc-1', code: 'A001', nameKo: '암로디핀정5mg', nameEn: 'Amlodipine', ingredient: 'amlodipine besylate' };

describe('verdictFromWarnings — 심각도 → 판정', () => {
  it('ERROR/BLOCK/CONTRAINDICATED 하나라도 → BLOCK', () => {
    expect(verdictFromWarnings([{ severity: 'WARNING' }, { severity: 'ERROR' }])).toBe('BLOCK');
    expect(verdictFromWarnings([{ severity: 'block' }])).toBe('BLOCK');
    expect(verdictFromWarnings([{ severity: 'CONTRAINDICATED' }])).toBe('BLOCK');
  });
  it('WARNING 만 → WARNING(PASS 가 아니다) · 없음/INFO 만 → PASS', () => {
    expect(verdictFromWarnings([{ severity: 'WARNING' }, { severity: 'INFO' }])).toBe('WARNING');
    expect(verdictFromWarnings([])).toBe('PASS');
    expect(verdictFromWarnings([{ severity: 'INFO' }])).toBe('PASS');
  });
});

describe('medicationQueryCandidates — LLM 약명 정규화', () => {
  it('원문 → 괄호·용량 제거 → 첫 토큰 순(중복 제거)', () => {
    expect(medicationQueryCandidates('암로디핀 5mg (노바스크)')).toEqual(['암로디핀 5mg (노바스크)', '암로디핀 5mg', '암로디핀']);
    expect(medicationQueryCandidates('Metformin 500 mg')).toEqual(['Metformin 500 mg', 'Metformin']);
    expect(medicationQueryCandidates('  ')).toEqual([]);
  });
});

describe('resolveMedicationCode — 약가마스터 정본 검색', () => {
  it('정확히 1건 → ONE · 활성 코드만 · 정본 where(OR nameKo/nameEn/ingredient/code) 로 조회', async () => {
    const findMany = vi.fn().mockResolvedValue([AMLO]);
    // 한글 약명 → 성분(INN) 경로는 빗나가고(마스터 ingredient 는 영문) 약명 경로가 특정한다
    const r = await resolveMedicationCode({ medicationCode: { findMany } } as any, '암로디핀');
    expect(r).toMatchObject({ status: 'ONE', id: 'mc-1', code: 'A001' });
    const where = findMany.mock.calls.at(-1)![0].where;
    expect(where.isActive).toBe(true);
    expect(JSON.stringify(where.OR)).toContain('"nameKo"');
    expect(JSON.stringify(where.OR)).toContain('"ingredient"');
  });
  it('정확 일치 1건이면 ONE(동명 상품이 여럿이면 아래 성분 판정으로)', async () => {
    const exact = [AMLO, { ...AMLO, id: 'mc-3', code: 'A003', nameKo: '노바스크정', nameEn: 'Norvasc' }];
    expect(await resolveMedicationCode({ medicationCode: { findMany: vi.fn().mockResolvedValue(exact) } } as any, '노바스크정')).toMatchObject({ status: 'ONE', id: 'mc-3' });
  });
  it('0건 → 후보 질의를 차례로 시도하고 전부 0건이면 NONE', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    // 🔴 "0건"과 "부분 문자열로만 겹친다"는 다른 사실이라 사유를 동봉한다(NO_CANDIDATE)
    expect(await resolveMedicationCode({ medicationCode: { findMany } } as any, '없는약 5mg')).toEqual({ status: 'NONE', reason: 'NO_CANDIDATE' });
    expect(findMany.mock.calls.length).toBeGreaterThan(1);
  });
});

/**
 * 🔴 성분 단위 판정(P2) — 종전엔 성분명 질의가 거의 전부 `MANY → UNRESOLVED` 였다(운영 실측).
 *    후보가 여럿이어도 **주성분이 하나면** 대표 1건으로 DUR 를 돌린다. 성분이 갈라지면 판정하지 않는다.
 *
 * 재주입하면 실패한다: 대표를 `rows[0]`(정렬 없이)로 잡으면 결정론 테스트가 실패 ·
 * 성분이 다른데 대표를 잡아 PASS 를 내면 실패 · 성분 정보 없는 후보를 무시하면 실패.
 */
describe('resolveMedicationCode — 성분 단위 판정(INGREDIENT_GROUP)', () => {
  const lookup = (rows: any[]) => ({ medicationCode: { findMany: vi.fn().mockResolvedValue(rows) } } as any);
  /**
   * 🔴 이 픽스처는 2026-08-20 에 바뀌었다 — 종전엔 성분 키를 `ingredientCode`(AML01) 로 잡았고 테스트도 그걸 못박고 있었다.
   *    운영 실측에서 그게 **INGREDIENT_GROUP 적중 0/10** 의 원인이었다: 주성분코드는 성분이 아니라 성분+염+함량+제형을
   *    식별해서(amlodipine 단일제만 15개 코드접두) 같은 성분이 절대 한 키로 묶이지 않았다.
   *    지금 키는 `ingredient` 파싱 → 활성 본체 → 염 정규화다. 그래서 아래 픽스처는 **함량이 다른 실제 표기**를 쓴다.
   */
  const GROUP = [
    { id: 'mc-9', code: 'A009', nameKo: '암로디핀정10mg', nameEn: null, ingredient: 'amlodipine besylate (as amlodipine   10mg)', ingredientCode: '107602ATB' },
    { id: 'mc-2', code: 'A002', nameKo: '노바스크정5mg(암로디핀베실산염)', nameEn: 'Norvasc', ingredient: 'Amlodipine  Besylate (as Amlodipine   5mg)', ingredientCode: '107601ATB' },
    { id: 'mc-5', code: 'A005', nameKo: '아모디핀정5mg', nameEn: null, ingredient: 'amlodipine camsylate (as amlodipine   5mg)', ingredientCode: '459902ATB' },
  ];

  it('후보 여럿이지만 주성분이 하나 → INGREDIENT_GROUP · 개수·주성분 동봉', async () => {
    const r: any = await resolveMedicationCode(lookup(GROUP), '암로디핀');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.count).toBe(3);
    expect(r.ingredientLabel).toBe('amlodipine');
  });

  it('🔴 주성분코드가 달라도(염·함량이 다를 뿐) 같은 성분으로 묶는다 — 종전 구현이 여기서 전부 갈라졌다', async () => {
    const codes = GROUP.map((g) => g.ingredientCode);
    expect(new Set(codes).size).toBe(3); // 주성분코드는 3종이다
    const r: any = await resolveMedicationCode(lookup(GROUP), '암로디핀');
    expect(r.status).toBe('INGREDIENT_GROUP'); // 그래도 성분은 하나
  });

  it('🔴 대표는 결정론적이다 — 입력 순서가 달라도 code 최소(A002)를 고른다', async () => {
    const a: any = await resolveMedicationCode(lookup(GROUP), '암로디핀');
    const b: any = await resolveMedicationCode(lookup([...GROUP].reverse()), '암로디핀');
    const c: any = await resolveMedicationCode(lookup([GROUP[2], GROUP[0], GROUP[1]]), '암로디핀');
    expect([a.code, b.code, c.code]).toEqual(['A002', 'A002', 'A002']);
    expect([a.id, b.id, c.id]).toEqual(['mc-2', 'mc-2', 'mc-2']);
  });

  it('성분명 표기 흔들림(대소문자·연속 공백)은 같은 성분으로 묶는다 — 주성분코드가 없어도', async () => {
    const rows = [
      { id: 'x1', code: 'B002', nameKo: '메트포르민정500mg', nameEn: null, ingredient: 'Metformin HCl', ingredientCode: null },
      { id: 'x2', code: 'B001', nameKo: '메트포르민서방정', nameEn: null, ingredient: ' metformin  hcl ', ingredientCode: null },
    ];
    const r: any = await resolveMedicationCode(lookup(rows), '메트포르민');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.code).toBe('B001');
    expect(normalizeIngredientKey(' Metformin  HCl ')).toBe('metformin hcl');
  });

  it('🔴 성분이 2종 이상이면 MANY — 몇 종인지 말한다(대표를 잡지 않는다)', async () => {
    const rows = [
      GROUP[0],
      { id: 'y1', code: 'C001', nameKo: '발사르탄정', nameEn: null, ingredient: 'valsartan   80mg', ingredientCode: 'VAL01' },
    ];
    const r: any = await resolveMedicationCode(lookup(rows), '암로디핀');
    expect(r.status).toBe('MANY');
    expect(r.distinctIngredients).toBe(2);
    expect(r.ingredientLabels).toEqual(['amlodipine', 'valsartan']);
    expect(r.unknownIngredient).toBe(false);
  });

  it('🔴 주성분 정보가 없는 후보가 섞이면 대표 판정 금지(모르는 것을 같다고 하지 않는다)', async () => {
    const rows = [GROUP[0], { id: 'z1', code: 'A010', nameKo: '암로디핀정', nameEn: null, ingredient: null, ingredientCode: null }];
    const r: any = await resolveMedicationCode(lookup(rows), '암로디핀');
    expect(r.status).toBe('MANY');
    expect(r.unknownIngredient).toBe(true);
  });

  it('🔴 후보가 조회 상한에 닿으면 전체를 못 본 것 — 성분 동일이라 말하지 않는다(truncated)', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, code: `Z${String(i).padStart(3, '0')}`, nameKo: `같은성분정${i}`, nameEn: null, ingredient: 'same ingredient', ingredientCode: 'SAME1' }));
    const r: any = await resolveMedicationCode(lookup(rows), '같은성분');
    expect(r.status).toBe('MANY');
    expect(r.truncated).toBe(true);
  });
});

describe('resolveEncounterForDur', () => {
  it('입력 > 최근 진료 > ZERO_UUID(생략 사유 명시)', async () => {
    expect(await resolveEncounterForDur({ encounter: { findFirst: vi.fn() } } as any, PID, ENC)).toEqual({ encounterId: ENC, note: null });
    expect(await resolveEncounterForDur({ encounter: { findFirst: vi.fn().mockResolvedValue({ id: 'e-latest' }) } } as any, PID)).toEqual({ encounterId: 'e-latest', note: '최근 진료 기준' });
    const z = await resolveEncounterForDur({ encounter: { findFirst: vi.fn().mockResolvedValue(null) } } as any, PID);
    expect(z.encounterId).toBe(ZERO_UUID); expect(z.note).toContain('임신 여부');
    // prisma.encounter 자체가 없어도 던지지 않는다
    const nz = await resolveEncounterForDur({} as any, PID);
    expect(nz.encounterId).toBe(ZERO_UUID);
  });
});

describe('verdictForRecommendation — 한 건의 판정', () => {
  const prisma = { medicationCode: { findMany: vi.fn().mockResolvedValue([AMLO]) } } as any;
  it('PASS: 경고 0건 · medicationCodeId·resolvedName 동봉 · DUR 에 encounterId·dosage 전달', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const r = await verdictForRecommendation({ prisma, dur }, { name: '암로디핀', dosage: '5mg qd', patientId: PID, encounterId: ENC });
    expect(r).toMatchObject({ durVerdict: 'PASS', medicationCodeId: 'mc-1', resolvedName: '암로디핀정5mg', durWarnings: [] });
    expect(r.durVerdictBasis).toContain('A001'); expect(r.durVerdictBasis).toContain('경고 0건');
    expect(dur.checkInteractions).toHaveBeenCalledWith(ENC, 'mc-1', PID, { dosage: '5mg qd' });
  });
  it('WARNING: WARNING 만 → WARNING · durWarnings 는 type/severity/message 로 다듬는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([{ severity: 'WARNING', type: 'DUPLICATE', message: '동일 성분 중복', drugA: 'x', drugB: 'y' }]) };
    const r = await verdictForRecommendation({ prisma, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r.durVerdict).toBe('WARNING');
    expect(r.durWarnings).toEqual([{ type: 'DUPLICATE', severity: 'WARNING', message: '동일 성분 중복' }]);
    expect(r.durVerdictBasis).toContain('WARNING 1');
  });
  it('BLOCK: ERROR 하나라도 → BLOCK', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([{ severity: 'INFO', type: 'DOSE_EXCEEDED', message: 'i' }, { severity: 'ERROR', type: 'ALLERGY', message: '알레르기 성분' }]) };
    const r = await verdictForRecommendation({ prisma, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC, encounterNote: '진료 미특정 — 임신 여부·현 진료 처방 점검 생략' });
    expect(r.durVerdict).toBe('BLOCK');
    expect(r.durVerdictBasis).toContain('ERROR 1');
    expect(r.durVerdictBasis).toContain('임신 여부');
  });
  it('UNRESOLVED: 미매칭 → NONE · 성분이 갈라지면 AMBIGUOUS — DUR 를 부르지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const none = await verdictForRecommendation({ prisma: { medicationCode: { findMany: vi.fn().mockResolvedValue([]) } } as any, dur }, { name: '없는약', patientId: PID, encounterId: ENC });
    expect(none.durVerdict).toBe('UNRESOLVED'); expect(none.durVerdictBasis).toContain('미매칭'); expect(none.resolution).toBe('NONE');
    const mixed = [AMLO, { ...AMLO, id: 'mc-2', code: 'A002', nameKo: '발사르탄정', ingredient: 'valsartan' }];
    const many = await verdictForRecommendation({ prisma: { medicationCode: { findMany: vi.fn().mockResolvedValue(mixed) } } as any, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(many.durVerdict).toBe('UNRESOLVED'); expect(many.resolution).toBe('AMBIGUOUS');
    expect(many.durVerdictBasis).toContain('후보 2건'); expect(many.durVerdictBasis).toContain('서로 다른 성분 2종'); expect(many.durVerdictBasis).toContain('처방 폼에서 특정');
    expect(dur.checkInteractions).not.toHaveBeenCalled();
  });

  it('🔴 성분 대표 판정: 후보 여럿·성분 하나 → 대표(code 최소)로 DUR 를 돌리고 근거에 "성분 대표 판정"을 못 박는다', async () => {
    const rows = [
      { id: 'mc-9', code: 'A009', nameKo: '암로디핀정10mg', nameEn: null, ingredient: 'amlodipine besylate', ingredientCode: 'AML01' },
      // 🔴 nameKo 는 운영 마스터 표기형(제품명+괄호 안 한글 성분) — 종전 픽스처는 `노바스크정5mg` 뿐이라
    //    "질의가 대표와 의미 있게 일치하는가"를 재지 못했다(목만 통과하는 픽스처)
    { id: 'mc-2', code: 'A002', nameKo: '노바스크정5mg(암로디핀베실산염)', nameEn: 'Norvasc', ingredient: 'amlodipine besylate', ingredientCode: 'AML01' },
    ];
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const r = await verdictForRecommendation({ prisma: { medicationCode: { findMany: vi.fn().mockResolvedValue(rows) } } as any, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r.durVerdict).toBe('PASS');
    expect(r.resolution).toBe('INGREDIENT_GROUP');
    expect(r.medicationCodeId).toBe('mc-2');
    expect(r.durVerdictBasis).toContain('성분 동일 후보 2건 대표 판정');
    expect(r.durVerdictBasis).toContain('주성분 amlodipine');
    expect(r.durVerdictBasis).toContain('대표 A002 노바스크정5mg(암로디핀베실산염)');
    expect(r.durVerdictBasis).toContain('제품별 함량·제형 차이는 처방 폼에서 확정');
    expect(dur.checkInteractions).toHaveBeenCalledWith(ENC, 'mc-2', PID, { dosage: null });
  });

  it('🔴 성분 대표 판정이라도 경고가 있으면 PASS 가 아니다(WARNING 그대로)', async () => {
    const rows = [
      { id: 'mc-9', code: 'A009', nameKo: '암로디핀정10mg', nameEn: null, ingredient: 'amlodipine besylate', ingredientCode: 'AML01' },
      // 🔴 nameKo 는 운영 마스터 표기형(제품명+괄호 안 한글 성분) — 종전 픽스처는 `노바스크정5mg` 뿐이라
    //    "질의가 대표와 의미 있게 일치하는가"를 재지 못했다(목만 통과하는 픽스처)
    { id: 'mc-2', code: 'A002', nameKo: '노바스크정5mg(암로디핀베실산염)', nameEn: 'Norvasc', ingredient: 'amlodipine besylate', ingredientCode: 'AML01' },
    ];
    const dur = { checkInteractions: vi.fn().mockResolvedValue([{ severity: 'WARNING', type: 'DUPLICATE', message: '동일 성분 중복' }]) };
    const r = await verdictForRecommendation({ prisma: { medicationCode: { findMany: vi.fn().mockResolvedValue(rows) } } as any, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r.durVerdict).toBe('WARNING');
    expect(r.resolution).toBe('INGREDIENT_GROUP');
  });

  it('🔴 EXACT 매칭은 resolution=EXACT — 성분 대표 문구를 붙이지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const r = await verdictForRecommendation({ prisma, dur }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r.resolution).toBe('EXACT');
    expect(r.durVerdictBasis).not.toContain('성분 대표 판정');
  });
  it('🔴 DUR 서비스 부재/오류 → null + "재검증 실패"(PASS 를 지어내지 않는다)', async () => {
    const r1 = await verdictForRecommendation({ prisma, dur: undefined }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r1.durVerdict).toBeNull(); expect(r1.durVerdictBasis).toContain('재검증 실패');
    const r2 = await verdictForRecommendation({ prisma, dur: { checkInteractions: vi.fn().mockRejectedValue(new Error('rules repo down')) } }, { name: '암로디핀', patientId: PID, encounterId: ENC });
    expect(r2.durVerdict).toBeNull(); expect(r2.durVerdictBasis).toBe('재검증 실패: rules repo down');
  });
});

describe('MedicalAiService.recommendDrugs — 추천마다 durVerdict 를 정본으로 채운다', () => {
  const mk = (llm: string, dur: any, over: Record<string, any> = {}) => {
    const config = { get: vi.fn((_k: string, d?: any) => d) };
    const runtime = { get: vi.fn().mockResolvedValue(null), getHospitalContext: vi.fn().mockResolvedValue('') };
    const prisma: any = {
      systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
      patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: new Date('1975-01-01'), gender: 'FEMALE' }) },
      problemList: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { findMany: vi.fn().mockResolvedValue([]) },
      labResult: { findMany: vi.fn().mockResolvedValue([]) },
      orderSet: { findMany: vi.fn().mockResolvedValue([]) },
      medicationCode: { findMany: vi.fn().mockImplementation(async ({ where }: any) => (JSON.stringify(where).includes('암로디핀') ? [AMLO] : [])) },
      encounter: { findFirst: vi.fn().mockResolvedValue({ id: 'e-latest' }) },
      ...over,
    };
    const service = new MedicalAiService(config as any, runtime as any, prisma, { getStatus: vi.fn().mockResolvedValue({ status: 'NOT_ASSESSED', allergies: [] }) } as any, undefined, undefined, dur);
    vi.spyOn(service as any, 'chatLlm').mockResolvedValue(llm);
    return { service, prisma };
  };
  const LLM = '{"recommendations":[{"name":"암로디핀","dosage":"5mg qd","reason":"고혈압 1차","guideline":"KSH 2018","cdssCheck":"PASS"},{"name":"없는약","dosage":"1정","reason":"보조","guideline":"-"}],"contraindicated":[],"orderSetSuggested":null}';

  it('🔴 LLM "cdssCheck: PASS" 와 무관하게 DUR 정본이 WARNING 이면 WARNING · 미매칭은 UNRESOLVED · encounterId 미전달이면 최근 진료', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([{ severity: 'WARNING', type: 'BEERS', message: 'Beers 목록' }]) };
    const { service } = mk(LLM, dur);
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    expect(r.source).toBe('AI');
    const [a, b] = r.recommendations;
    expect(a).toMatchObject({ durVerdict: 'WARNING', medicationCodeId: 'mc-1', resolvedName: '암로디핀정5mg', modelNote: 'PASS' });
    expect(a.durWarnings).toEqual([{ type: 'BEERS', severity: 'WARNING', message: 'Beers 목록' }]);
    expect(a.durVerdictBasis).toContain('최근 진료 기준');
    expect(b.durVerdict).toBe('UNRESOLVED'); expect(b.durWarnings).toEqual([]);
    expect(dur.checkInteractions).toHaveBeenCalledWith('e-latest', 'mc-1', PID, { dosage: '5mg qd' });
    expect(dur.checkInteractions).toHaveBeenCalledTimes(1); // 미매칭 건은 부르지 않는다
  });
  it('encounterId 전달 시 그대로 · 진료가 하나도 없으면 ZERO_UUID + 생략 사유', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const a = mk(LLM, dur);
    await a.service.recommendDrugs({ patientId: PID, diagnosis: '고혈압', encounterId: ENC } as any);
    expect(dur.checkInteractions.mock.calls[0][0]).toBe(ENC);
    const b = mk(LLM, dur, { encounter: { findFirst: vi.fn().mockResolvedValue(null) } });
    const r: any = await b.service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    expect(dur.checkInteractions.mock.calls[1][0]).toBe(ZERO_UUID);
    expect(r.recommendations[0].durVerdict).toBe('PASS');
    expect(r.recommendations[0].durVerdictBasis).toContain('임신 여부');
  });
  it('🔴 DUR 가 던지면 그 추천은 null + 재검증 실패 — 응답 전체는 살아 있다', async () => {
    const dur = { checkInteractions: vi.fn().mockRejectedValue(new Error('dur down')) };
    const { service } = mk(LLM, dur);
    const r: any = await service.recommendDrugs({ patientId: PID, diagnosis: '고혈압' } as any);
    expect(r.source).toBe('AI');
    expect(r.recommendations[0].durVerdict).toBeNull();
    expect(r.recommendations[0].durVerdictBasis).toBe('재검증 실패: dur down');
  });
});
