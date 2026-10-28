/**
 * 🔴 약효군·일반 명사가 "DUR 통과"로 둔갑하던 것 — 약명 경로 승격 조건 가드.
 *
 * 무엇이 일어났나(2026-08-20 운영 실측 · `his.example.org` 활성 22,713행):
 *   LLM 이 약이 아니라 **약효군**(`콜레스테롤 저하제`)을 약명으로 냈다. 후보 질의가 첫 토큰 `콜레스테롤` 로
 *   넓혀지며 nameKo 부분일치가 **우연히 1건**에 걸렸고 — `아도스테롤(131I)주사액(요오디네이티트(131I)노르콜레스테롤)`,
 *   진단용 방사성 의약품이다 — 후보 1건이라 `ONE`→`EXACT` 로 승격, 그 제품 하나에 DUR 이 돌아 `PASS`,
 *   화면은 초록 배지를 그렸다. **환자와 무관한 약을 "DUR 통과"로 보여주는 거짓 안심**이다.
 *
 * 봉합: 승격(ONE·INGREDIENT_GROUP) 전에 **질의가 그 제품과 의미 있게 일치하는지**를 따로 묻는다
 *      (`queryMatchesRow` — 토큰 경계 시작 또는 code 접두). 일치가 없으면 특정하지 않고 **이유를 말한다**.
 *
 * 전후 실측(같은 DB · 실제 해석기 함수를 태움):
 *   · 일반 명사·약효군 44종: `EXACT 1 · AMBIGUOUS 12 · NONE 31` → `EXACT 0 · AMBIGUOUS 6 · NONE 38`
 *   · 정상 약명 72종(성분 힌트 12 · 약명 경로 60): **판정 분포·선택 품목 전부 불변**(오탐 0)
 *
 * ── 재주입하면 실패하는 것(이 파일의 존재 이유) ─────────────────────────────────
 *   1. "후보 1건이면 무조건 EXACT" 로 되돌림          → `rows.length === 1` 앞의 관련성 게이트를 빼면 실패
 *   2. 약효군 질의가 EXACT 로 승격                    → 같은 게이트
 *   3. 대표가 질의와 무관한데 성분 대표 판정          → `repIrrelevant` 조건을 빼면 실패
 *   4. 정상 약명이 NONE 으로 떨어짐(오탐 회귀)        → 경계 규칙을 "완전 일치"·"끝 경계까지"로 조이면 실패
 *   5. basis 가 이유를 말하지 않음                    → 사유 문구를 지우면 실패
 */
import { describe, it, expect, vi } from 'vitest';
import {
  matchesAtTokenBoundary, queryMatchesRow, resolveMedicationCode, verdictForRecommendation,
} from '../../src/modules/medical-ai/drug-verdict';

const PID = '11111111-1111-4111-8111-111111111111';
const ENC = '22222222-2222-4222-8222-222222222222';

interface Row { id: string; code: string; nameKo: string; nameEn?: string | null; ingredient: string | null; ingredientCode?: string | null }

/**
 * 약가마스터 시늉 — `ingredient.contains`/`startsWith`(성분 경로)와 `OR`(약명 경로)를 실제 Prisma 처럼 처리한다.
 * 🔴 질의를 무시하고 같은 행을 돌려주는 목이면 이 가드는 아무것도 재지 못한다(목만 통과하는 테스트 금지).
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
    out.sort((a, b) => (byCode ? a.code.localeCompare(b.code) : String(a.nameKo).localeCompare(String(b.nameKo))));
    return typeof take === 'number' ? out.slice(0, take) : out;
  });
  return { medicationCode: { findMany } } as any;
}

/** 🔴 운영에서 실제로 오판을 만든 그 행(코드·표기 그대로) */
const ADOSTEROL: Row = {
  id: 'ad', code: '656900482', nameKo: '아도스테롤(131I)주사액(요오디네이티트(131I)노르콜레스테롤)',
  nameEn: null, ingredient: 'iodinated (131I) norcholesterol   37MBq',
};
const LASIX: Row = { id: 'lx', code: '652100200', nameKo: '라식스정(푸로세미드)', nameEn: null, ingredient: 'furosemide   40mg' };
const NORVASC: Row = { id: 'nv', code: '073400360', nameKo: '노바스크정5밀리그람(암로디핀베실산염)', nameEn: 'Norvasc', ingredient: 'amlodipine besylate (as amlodipine   5mg)' };
const K_ASPIRIN: Row = { id: 'ka', code: '054801360', nameKo: '케이아스피린장용정(아스피린)', nameEn: null, ingredient: 'aspirin   0.1g' };
const MEGAPEN: Row = { id: 'mp', code: '060500030', nameKo: '엘앤씨메가펜정(아세트아미노펜제피세립)', nameEn: null, ingredient: 'acetaminophen   0.3457g' };

describe('matchesAtTokenBoundary — 부분 문자열과 "의미 있는 일치"를 가른다', () => {
  it('🔴 앞 글자가 한글/라틴/숫자면 일치가 아니다 — 다른 낱말의 어미로 걸린 것', () => {
    expect(matchesAtTokenBoundary('콜레스테롤', ADOSTEROL.nameKo)).toBe(false); // …노르콜레스테롤)
    expect(matchesAtTokenBoundary('statin', 'rosuvastatin calcium')).toBe(false);
    expect(matchesAtTokenBoundary('주사제', '프락스바인드주사제(이다루시주맙)')).toBe(false);
  });
  it('문두·괄호·공백 뒤는 일치다', () => {
    expect(matchesAtTokenBoundary('아스피린', K_ASPIRIN.nameKo)).toBe(true);   // (아스피린)
    expect(matchesAtTokenBoundary('라식스정', LASIX.nameKo)).toBe(true);       // 문두
    expect(matchesAtTokenBoundary('amlodipine', NORVASC.ingredient)).toBe(true);
  });
  it('🔴 끝 경계는 요구하지 않는다 — 한국어 표기는 접미가 그대로 붙는다(요구하면 정상 약명이 대량 탈락)', () => {
    expect(matchesAtTokenBoundary('아세트아미노펜', MEGAPEN.nameKo)).toBe(true); // (아세트아미노펜제피세립)
    expect(matchesAtTokenBoundary('metformin', 'metformin hydrochloride')).toBe(true);
  });
  it('queryMatchesRow — 제품명(한/영)·성분·코드 접두 중 하나라도 경계 일치면 참', () => {
    expect(queryMatchesRow('콜레스테롤', ADOSTEROL)).toBe(false);
    expect(queryMatchesRow('Norvasc', NORVASC)).toBe(true);
    expect(queryMatchesRow('6569004', ADOSTEROL)).toBe(true); // 코드 접두는 의미 있는 일치다
    expect(queryMatchesRow('', LASIX)).toBe(false);
  });
});

describe('🔴 재주입 1·2 — 후보 1건이라는 사실만으로 EXACT 를 주지 않는다', () => {
  it('운영 재현: 약효군 `콜레스테롤 저하제` 는 후보 1건이어도 EXACT 가 아니다', async () => {
    const r: any = await resolveMedicationCode(master([ADOSTEROL]), '콜레스테롤 저하제');
    expect(r.status).toBe('NONE');
    expect(r.resolution).toBeUndefined();
    expect(r.reason).toBe('NO_MEANINGFUL_MATCH');
    expect(r.looseCount).toBe(1);
    expect(r.query).toBe('콜레스테롤');
  });
  it('🔴 그 판정에 DUR 를 돌리지 않는다 — 초록 배지의 재료를 만들지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([ADOSTEROL]), dur }, { name: '콜레스테롤 저하제', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('UNRESOLVED');
    expect(v.resolution).toBe('NONE');
    expect(v.medicationCodeId).toBeUndefined();
    expect(dur.checkInteractions).not.toHaveBeenCalled();
  });
  it('같은 마스터에서 **정상 약명**은 후보 1건으로 EXACT 가 된다(게이트가 전부를 막는 게 아니다)', async () => {
    const r: any = await resolveMedicationCode(master([ADOSTEROL, LASIX]), '라식스정');
    expect(r.status).toBe('ONE');
    expect(r.id).toBe('lx');
  });
  it('약효군 어휘 여러 종 — 어느 것도 EXACT/INGREDIENT_GROUP 이 되지 않는다', async () => {
    // 전부 마스터에 부분 문자열로만 걸리는 행을 하나씩 둔다(0건이면 게이트를 재는 게 아니라 마스터가 비어서 통과한다)
    const rows: Row[] = [
      ADOSTEROL,
      { id: 'p1', code: '653501561', nameKo: '프락스바인드주사제(이다루시주맙)', ingredient: 'idarucizumab   2.5g' },
      { id: 's1', code: '052400140', nameKo: '로슈바정20mg(로수바스타틴칼슘)', ingredient: 'rosuvastatin calcium (as rosuvastatin   20mg)' },
    ];
    for (const q of ['콜레스테롤 저하제', '주사제', '스타틴', 'statin']) {
      const r: any = await resolveMedicationCode(master(rows), q);
      expect([r.status, q]).toEqual(['NONE', q]);
    }
  });
});

describe('🔴 재주입 3 — 대표가 질의와 무관하면 성분 대표 판정을 하지 않는다', () => {
  /**
   * 성분은 하나(rosuvastatin)로 모이지만 **최소 code 대표**에는 질의가 낱말 가운데로만 걸리는 경우.
   * 실제 형태다 — `스타틴` 은 약효군인데 `로수바스타틴칼슘` 안에 부분 문자열로 들어 있다.
   */
  const ROWS: Row[] = [
    { id: 'x1', code: '000000001', nameKo: '로슈바정20mg(로수바스타틴칼슘)', nameEn: null, ingredient: 'rosuvastatin calcium (as rosuvastatin   20mg)' },
    { id: 'x2', code: '000000002', nameKo: '스타틴정10mg', nameEn: null, ingredient: 'rosuvastatin calcium (as rosuvastatin   10mg)' },
  ];
  it('그룹 안 한 건만 경계로 걸린 질의로는 대표 판정을 하지 않는다 → MANY(사유 동봉)', async () => {
    const r: any = await resolveMedicationCode(master(ROWS), '스타틴');
    expect(r.status).toBe('MANY');
    expect(r.repIrrelevant).toBe(true);
    expect(r.distinctIngredients).toBe(1); // 성분은 하나로 모였다 — 그래도 대표 판정은 하지 않는다
  });
  it('🔴 그 경우에도 DUR 를 돌리지 않고 이유를 말한다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master(ROWS), dur }, { name: '스타틴', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('UNRESOLVED');
    expect(v.resolution).toBe('AMBIGUOUS');
    expect(v.durVerdictBasis).toContain('대표 품목이 질의와 의미 있게 일치하지 않아');
    expect(dur.checkInteractions).not.toHaveBeenCalled();
  });
  it('대표가 질의와 일치하면 종전대로 성분 대표 판정을 한다(막기만 하는 게 아니다)', async () => {
    // 같은 성분·같은 질의인데 이번엔 **대표부터** 경계로 일치한다 → 승격
    const rows: Row[] = [
      ROWS[1],
      { id: 'x3', code: '000000003', nameKo: '스타틴정20mg', nameEn: null, ingredient: 'rosuvastatin calcium (as rosuvastatin   20mg)' },
    ];
    const r: any = await resolveMedicationCode(master(rows), '스타틴');
    expect(r.status).toBe('INGREDIENT_GROUP');
    expect(r.code).toBe('000000002'); // 대표는 최소 code(결정론) — 그리고 그 대표가 질의와 일치한다
    expect(r.count).toBe(2);
  });
});

describe('🔴 재주입 4 — 정상 약명이 NONE 으로 떨어지면 안 된다(오탐 회귀)', () => {
  const ALL = [ADOSTEROL, LASIX, NORVASC, K_ASPIRIN, MEGAPEN];
  it('운영 표기형 약명은 전부 특정된다(EXACT 또는 INGREDIENT_GROUP)', async () => {
    const cases: Array<[string, string]> = [
      ['라식스정', 'lx'], ['노바스크', 'nv'], ['Norvasc', 'nv'], ['아스피린', 'ka'],
      ['아세트아미노펜', 'mp'], ['furosemide', 'lx'], ['amlodipine', 'nv'],
    ];
    for (const [q, id] of cases) {
      const r: any = await resolveMedicationCode(master(ALL), q);
      expect([q, r.status]).not.toEqual([q, 'NONE']);
      expect([q, r.id]).toEqual([q, id]);
    }
  });
  it('성분(INN) 힌트 경로는 이 게이트와 무관하다 — 행별 성분 검증이라 종전 그대로', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([ADOSTEROL, NORVASC]), dur }, { name: '암로디핀', ingredient: 'amlodipine', patientId: PID, encounterId: ENC });
    expect(v.durVerdict).toBe('PASS');
    expect(v.medicationCodeId).toBe('nv');
  });
});

describe('🔴 재주입 5 — basis 가 "왜 특정하지 못했는지"를 말해야 한다', () => {
  it('약효군 사유: 후보 수·질의·부분 문자열임을 사람이 읽을 수 있게 남긴다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([ADOSTEROL]), dur }, { name: '콜레스테롤 저하제', patientId: PID, encounterId: ENC });
    expect(v.durVerdictBasis).toContain('약효군·일반 명사로 보여 특정하지 않음');
    expect(v.durVerdictBasis).toContain('후보 1건');
    expect(v.durVerdictBasis).toContain("질의 '콜레스테롤'");
    expect(v.durVerdictBasis).toContain('부분 문자열만 겹침');
    expect(v.durVerdictBasis).toContain('처방 폼에서 특정');
  });
  it('진짜 0건(마스터 미등재)은 다른 문장이다 — 두 사실을 섞지 않는다', async () => {
    const dur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    const v = await verdictForRecommendation({ prisma: master([LASIX]), dur }, { name: '나이아즈올', patientId: PID, encounterId: ENC });
    expect(v.durVerdictBasis).toContain('약가마스터 미매칭');
    expect(v.durVerdictBasis).not.toContain('약효군');
  });
});
