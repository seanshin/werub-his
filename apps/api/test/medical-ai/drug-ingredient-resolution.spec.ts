/**
 * 🔴 성분(INN) 단위 약가마스터 특정 가드 — 기획서 `chart-ai-assistant-agent.plan.md` §1.5 후속 선택지 1.
 *
 * 왜 생겼나(2026-08-20 운영 실측 · 활성 22,713행):
 *   · 종전 성분 키가 `ingredientCode` 였다. 그건 성분이 아니라 **성분+염+함량+제형**을 식별한다
 *     (amlodipine 단일제만 15개 코드접두). 그래서 "후보가 전부 같은 성분"이 성립할 수 없었고
 *     `INGREDIENT_GROUP` 이 **운영 적중 0/10** 이었다.
 *   · 약명 부분일치는 복합제를 대량으로 끌어온다(`q=암로디핀` 후보 100건에 성분 56종).
 *   → 지금은 LLM 이 낸 **영문 성분명(INN)** 으로 `ingredient` 필드를 좁혀 조회하고, **행마다** 단일제 여부와
 *     활성 본체 일치를 검증한 뒤 대표(최소 code)를 고른다.
 *
 * ── 재주입하면 실패하는 것(이 파일의 존재 이유) ─────────────────────────────────
 *   1. 복합제를 단일제로 오인해 대표를 고름          → `ingredientMoieties` 가 세그먼트 1개만 보면 실패
 *   2. 성분 정확일치가 부분일치로 되돌아감            → `key === inn` 을 `key.startsWith(inn)` 로 되돌리면 실패
 *   3. 후보 절단 상태에서 대표를 고름                → 절단 가드를 빼면 실패(1차 소진논증·2차 접미논증 둘 다)
 *   4. UNRESOLVED 여야 하는데 PASS 를 주장           → 특정 실패인데 DUR 를 부르거나 PASS 를 내면 실패
 *   5. 대표 선택이 비결정적                          → `orderBy code asc` 를 빼거나 정렬 없이 첫 건을 잡으면 실패
 */
import { describe, it, expect, vi } from 'vitest';
import {
  baseIngredientKey, ingredientMoieties, moietyOfComponent, normalizeInnQuery,
  productIngredientKey, resolveMedicationCode, splitIngredientComponents, verdictForRecommendation,
} from '../../src/modules/medical-ai/drug-verdict';

const PID = '11111111-1111-4111-8111-111111111111';
const ENC = '22222222-2222-4222-8222-222222222222';

interface Row { id: string; code: string; nameKo: string; nameEn?: string | null; ingredient: string | null; ingredientCode?: string | null }

/**
 * 약가마스터 시늉 — `where.ingredient.contains`(1차) · `where.ingredient.startsWith`(2차) · `where.OR`(약명 경로)와
 * `orderBy`·`take` 를 실제 Prisma 처럼 처리한다. 🔴 정렬을 흉내내야 "대표가 결정론적인가"를 잴 수 있다
 * (정렬을 무시하는 목이면 5번 재주입이 통과해 버린다 — 목만 통과하는 가드는 가드가 아니다).
 */
function master(rows: Row[]) {
  const findMany = vi.fn(async (args: any) => {
    const { where = {}, orderBy, take } = args;
    let out = rows.slice();
    const ing = where.ingredient;
    if (ing?.contains) out = out.filter((r) => (r.ingredient ?? '').toLowerCase().includes(String(ing.contains).toLowerCase()));
    else if (ing?.startsWith) out = out.filter((r) => (r.ingredient ?? '').toLowerCase().startsWith(String(ing.startsWith).toLowerCase()));
    else if (Array.isArray(where.OR)) {
      out = out.filter((r) => where.OR.some((t: any) => {
        if (t.code?.startsWith) return r.code.toUpperCase().startsWith(String(t.code.startsWith).toUpperCase());
        for (const f of ['nameKo', 'nameEn', 'ingredient'] as const) {
          if (t[f]?.contains) return String((r as any)[f] ?? '').toLowerCase().includes(String(t[f].contains).toLowerCase());
        }
        return false;
      }));
    }
    const byCode = JSON.stringify(orderBy ?? '').includes('"code"');
    out.sort((a, b) => byCode ? a.code.localeCompare(b.code) : String(a.nameKo).localeCompare(String(b.nameKo)));
    return typeof take === 'number' ? out.slice(0, take) : out;
  });
  return { medicationCode: { findMany } } as any;
}

// 운영 마스터의 실제 표기형을 그대로 쓴다(실측 표본)
const AMLO_5 = { id: 'a5', code: '052400890', nameKo: '로바스크정', ingredient: 'amlodipine besylate (as amlodipine   5mg)', ingredientCode: '107601ATB' };
const AMLO_10 = { id: 'a10', code: '099900010', nameKo: '노바스크정10mg', ingredient: 'amlodipine besylate (as amlodipine   10mg)', ingredientCode: '107602ATB' };
const AMLO_CAM = { id: 'ac', code: '012300010', nameKo: '아모디핀정', ingredient: 'amlodipine camsylate (as amlodipine   5mg)', ingredientCode: '459902ATB' };
/** 복합제 — amlodipine 이 들어 있지만 **단일제가 아니다** */
const COMBO = { id: 'cb', code: '000000001', nameKo: '아이스타플러스정', ingredient: 'amlodipine besylate (as amlodipine   5mg), rosuvastatin calcium (as rosuvastatin   10mg), telmisartan   80mg', ingredientCode: '671500ATB' };

describe('ingredient 표기 파서 — 운영 마스터 실측 표기형', () => {
  it('최상위 콤마로만 나눈다 — 괄호 안 콤마는 경계가 아니다(실측 74행)', () => {
    expect(splitIngredientComponents('a   1mg, b   2mg')).toHaveLength(2);
    expect(splitIngredientComponents('omega-3-acid ethyl esters90   1g (as EPA   0.46g, DHA   0.38g)')).toHaveLength(1);
  });
  it('`(as X …)` 안이 활성 본체 · 함량은 잘라낸다', () => {
    expect(moietyOfComponent('amlodipine besylate (as amlodipine   5mg)')).toBe('amlodipine');
    expect(moietyOfComponent('carvedilol   25mg')).toBe('carvedilol');
    expect(moietyOfComponent('telmisartan   80mg')).toBe('telmisartan');
  });
  it('🔴 `(as A …, B …)` 는 다성분 — 단일제로 접지 않는다(모르면 null)', () => {
    expect(moietyOfComponent('omega-3 (as EPA   0.46g, DHA   0.38g)')).toBeNull();
    expect(ingredientMoieties('omega-3 (as EPA   0.46g, DHA   0.38g)')).toBeNull();
  });
  it('염·수화물 접미는 정규화한다(마스터는 염표기·LLM 은 INN)', () => {
    expect(baseIngredientKey('metformin hydrochloride')).toBe('metformin');
    expect(baseIngredientKey('atorvastatin calcium')).toBe('atorvastatin');
    expect(baseIngredientKey('ceftriaxone sodium hydrate')).toBe('ceftriaxone');
  });
  it('🔴 벗기면 원소명만 남는 것은 벗기지 않는다 — potassium chloride ≠ potassium citrate', () => {
    expect(baseIngredientKey('potassium chloride')).toBe('potassium chloride');
    expect(baseIngredientKey('sodium chloride')).toBe('sodium chloride');
    expect(baseIngredientKey('magnesium oxide')).toBe('magnesium oxide');
  });
  it('복합제 키는 성분을 정렬해 합친다 — 단일제와 절대 같아지지 않는다', () => {
    expect(productIngredientKey(COMBO)).toBe('amlodipine+rosuvastatin+telmisartan');
    expect(productIngredientKey(AMLO_5)).toBe('amlodipine');
  });
  it('normalizeInnQuery — 상품 표기가 섞여 들어와도 성분 키로 접는다', () => {
    expect(normalizeInnQuery('Metformin HCl 500mg')).toBe('metformin');
    expect(normalizeInnQuery('amlodipine besylate')).toBe('amlodipine');
  });
});

describe('🔴 재주입 1 — 복합제를 단일제로 오인하면 안 된다', () => {
  it('마스터에 복합제만 있으면 성분 대표를 고르지 않는다(단일제 0건)', async () => {
    const r: any = await resolveMedicationCode(master([COMBO]), '암로디핀', 'amlodipine');
    // 복합제는 1차(정확일치)·2차(접미)에서 모두 탈락 → 성분 경로가 아무것도 내지 않는다
    expect(r.status).not.toBe('INGREDIENT_GROUP');
    expect(r.status).not.toBe('ONE');
  });
  it('단일제와 복합제가 섞여 있으면 **단일제만** 세어 대표를 고른다', async () => {
    const r: any = await resolveMedicationCode(master([COMBO, AMLO_5, AMLO_10]), '암로디핀', 'amlodipine');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.count).toBe(2);            // 복합제는 후보에 들어오지 않는다
    expect(r.id).not.toBe('cb');
  });
  it('🔴 2차(에스터 접미) 경로에도 복합제가 새면 안 된다 — 정렬된 복합키가 `${inn} ` 로 시작할 수 있다', async () => {
    const OLME = { id: 'o1', code: '060500640', nameKo: '올메텍정', ingredient: 'olmesartan medoxomil   20mg' };
    // 이 복합제의 키는 `olmesartan medoxomil+rosuvastatin` — 문자열로는 'olmesartan ' 로 시작한다
    const OLME_COMBO = { id: 'o2', code: '000000002', nameKo: '올메복합정', ingredient: 'olmesartan medoxomil   20mg, rosuvastatin calcium (as rosuvastatin   10mg)' };
    const r: any = await resolveMedicationCode(master([OLME, OLME_COMBO]), '올메사르탄', 'olmesartan');
    expect(r.status).toBe('ONE');       // 단일제 1건만 후보
    expect(r.id).toBe('o1');
  });
});

describe('🔴 재주입 2 — 성분 정확일치가 부분일치로 되돌아가면 안 된다', () => {
  it('활성 본체가 갈리는 프로드러그는 특정하지 않는다(tenofovir alafenamide vs disoproxil)', async () => {
    const rows = [
      { id: 't1', code: '100000001', nameKo: '테노포비르AF정', ingredient: 'tenofovir alafenamide hemifumarate (as tenofovir alafenamide   25mg)' },
      { id: 't2', code: '100000002', nameKo: '테노포비르DF정', ingredient: 'tenofovir disoproxil   0.245g' },
    ];
    const r: any = await resolveMedicationCode(master(rows), '테노포비르', 'tenofovir');
    // 1차: 정확일치 0건(둘 다 접미가 있다) · 2차: 접미 본체가 2종 → 어느 쪽인지 모른다 → 특정 금지
    expect(['MANY', 'NONE']).toContain(r.status);
  });
  it('접미 본체가 **하나뿐**일 때만 2차로 특정한다(olmesartan → olmesartan medoxomil)', async () => {
    const rows = [
      { id: 'o1', code: '060500640', nameKo: '올메텍정20mg', ingredient: 'olmesartan medoxomil   20mg' },
      { id: 'o2', code: '060500641', nameKo: '올메텍정40mg', ingredient: 'olmesartan medoxomil   40mg' },
    ];
    const r: any = await resolveMedicationCode(master(rows), '올메사르탄', 'olmesartan');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.ingredientLabel).toBe('olmesartan medoxomil');
  });
  it('다른 성분이 INN 을 부분 포함해도 끌려오지 않는다(rosuvastatin 질의에 atorvastatin 이 섞이지 않는다)', async () => {
    const rows = [
      { id: 'r1', code: '052400140', nameKo: '로슈바정', ingredient: 'rosuvastatin calcium (as rosuvastatin   20mg)' },
      { id: 'x1', code: '000000003', nameKo: '아토르바정', ingredient: 'atorvastatin calcium (as atorvastatin   10mg)' },
    ];
    const r: any = await resolveMedicationCode(master(rows), '로수바스타틴', 'rosuvastatin');
    expect(r.status).toBe('ONE');
    expect(r.id).toBe('r1');
  });
});

describe('🔴 재주입 3 — 절단 상태에서 대표를 고르면 안 된다', () => {
  it('2차(접미) 경로: 조회 창이 가득 차면 "접미 본체가 하나뿐"을 논증할 수 없다 → 특정 금지', async () => {
    // 전부 같은 접미 본체지만 창(200)을 채운다 — 창 밖에 다른 본체가 있을 수 있다
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, code: `2${String(i).padStart(8, '0')}`, nameKo: `올메${i}`, ingredient: 'olmesartan medoxomil   20mg' }));
    const r: any = await resolveMedicationCode(master(rows), '올메사르탄', 'olmesartan');
    expect(r.status).not.toBe('INGREDIENT_GROUP');
    expect(r.status).not.toBe('ONE');
  });
  it('1차(정확일치) 경로는 절단돼도 **틀리지 않는다** — 행별 검증이라 대표가 유지되고, 잘랐다고 말한다', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `q${i}`, code: `3${String(i).padStart(8, '0')}`, nameKo: `암로${i}`, ingredient: 'amlodipine besylate (as amlodipine   5mg)' }));
    const r: any = await resolveMedicationCode(master(rows), '암로디핀', 'amlodipine');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.scanTruncated).toBe(true);
    expect(r.code).toBe('300000000'); // 최소 code — 절단돼도 흔들리지 않는다
  });
  it('절단 사실이 근거 문구에 남는다(자르면 잘랐다고 말한다)', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `q${i}`, code: `3${String(i).padStart(8, '0')}`, nameKo: `암로${i}`, ingredient: 'amlodipine besylate (as amlodipine   5mg)' }));
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master(rows), dur }, { name: '암로디핀', ingredient: 'amlodipine', patientId: PID, encounterId: ENC });
    expect(v.durVerdictBasis).toContain('조회 창 절단');
  });
});

describe('🔴 재주입 4 — 특정하지 못하면 PASS 를 주장하지 않는다', () => {
  it('마스터에 없는 성분(환각)은 UNRESOLVED · DUR 를 부르지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([AMLO_5]), dur }, { name: '나이아즈올', ingredient: 'niazol', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('UNRESOLVED');
    expect(v.resolution).toBe('NONE');
    expect(dur.checkInteractions).not.toHaveBeenCalled();
  });
  it('복합제만 있어 특정 못 하면 UNRESOLVED — 아무 후보나 대표로 잡지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([COMBO]), dur }, { name: '암로디핀', ingredient: 'amlodipine', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('UNRESOLVED');
    expect(dur.checkInteractions).not.toHaveBeenCalled();
  });
  it('특정에 성공해도 판정은 DUR 정본이 낸다 — WARNING 을 PASS 로 접지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([{ severity: 'WARNING', type: 'DUPLICATE', message: '동일 성분 중복' }]) };
    const v = await verdictForRecommendation({ prisma: master([AMLO_5, AMLO_10]), dur }, { name: '암로디핀', ingredient: 'amlodipine', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('WARNING');
    expect(v.resolution).toBe('INGREDIENT_GROUP');
  });
  it('성분 힌트가 빗나가도 추천을 버리지 않는다 — 조용히 약명 경로로 내려간다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([AMLO_5]), dur }, { name: '로바스크정', ingredient: '알 수 없음', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('PASS');
    expect(v.medicationCodeId).toBe('a5');
  });
});

describe('🔴 재주입 5 — 대표 선택은 결정론적이다', () => {
  const ROWS = [AMLO_10, AMLO_5, AMLO_CAM]; // code: 099900010 / 052400890 / 012300010 → 최소는 012300010
  it('입력 순서가 어떻든 최소 code 를 고른다', async () => {
    const perms = [ROWS, [...ROWS].reverse(), [ROWS[1], ROWS[2], ROWS[0]]];
    const got = [];
    for (const p of perms) { const r: any = await resolveMedicationCode(master(p), '암로디핀', 'amlodipine'); got.push(`${r.status}:${r.code}:${r.id}`); }
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe('INGREDIENT_GROUP:012300010:ac');
  });
  it('🔴 성분 경로는 code 오름차순으로 조회한다 — 이 정렬이 곧 대표의 결정론이다', async () => {
    const m = master(ROWS);
    await resolveMedicationCode(m, '암로디핀', 'amlodipine');
    const call = m.medicationCode.findMany.mock.calls[0][0];
    expect(JSON.stringify(call.orderBy)).toContain('"code"');
    expect(JSON.stringify(call.orderBy)).toContain('asc');
    expect(call.where.isActive).toBe(true);
    expect(call.where.ingredient.contains).toBe('amlodipine');
  });
  it('염이 달라도(besylate·camsylate) 한 성분으로 묶는다 — 주성분코드는 3종이다', async () => {
    expect(new Set(ROWS.map((r) => r.ingredientCode)).size).toBe(3);
    const r: any = await resolveMedicationCode(master(ROWS), '암로디핀', 'amlodipine');
    expect(r.count).toBe(3);
  });
});
