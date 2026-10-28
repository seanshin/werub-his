import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAudiogramSeries, audiogramSeriesOf, latestAudiogramRow } from '@/lib/specialty/audiogram';

/**
 * 전문진료 6화면(안과·이비인후과·피부과·치과·성형외과·비뇨) 정직성 가드 — 2026-08-26.
 *
 * 여기 걸린 것은 전부 **개통 이래 계속 틀린 말을 하고 있던 것**이다:
 *  · 청력도가 두 겹으로 죽어 화면에 그려진 적이 없다(어휘 불일치 + 값 키 불일치)
 *  · ABCDE 항목별 막대가 총점에서 역산한 **날조**였다(흑색종 판단 근거)
 *  · 미측정(PTA·AHI·안압·ABCDE)을 `?? 0` 으로 접어 '정상' 초록으로 말했다
 *  · 성형외과 표가 **모델에 없는 필드**를 읽어 EP 를 고쳐도 빈 칸이었다
 *
 * 🔴 가드는 결함을 재주입해 실패해야 가드다 — 각 항목에 **성공/실패 두 방향** 단언을 둔다.
 */

const WEB_SRC = join(process.cwd(), 'src');
const raw = (rel: string) => readFileSync(join(WEB_SRC, rel), 'utf8');

/**
 * 🔴 **주석을 코드로 읽지 않는다.** 이 가드들은 "결함 문자열이 없다"를 단언하는데, 봉합 커밋이
 *    "종전엔 `?? 0` 이었다"고 적어두면 그 설명 때문에 가드가 실패한다(v4.4.0 에서 코디네이터가
 *    주석을 코드로 오판한 사례 2건). 코드만 남기고 판정한다.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')  // JSX 주석 {/* … */}
    .replace(/\/\*[\s\S]*?\*\//g, '')            // 블록 주석
    .replace(/(^|[^:])\/\/.*$/gm, '$1');         // 줄 주석(URL 의 `://` 는 건드리지 않는다)
}
const read = (rel: string) => stripComments(raw(rel));

const ENT_PAGE = 'app/(main)/ent/page.tsx';
const ENT_TAB = 'app/(main)/patients/[id]/components/EntTab.tsx';
const DERM_PAGE = 'app/(main)/dermatology/page.tsx';
const OPH_PAGE = 'app/(main)/ophthalmology/page.tsx';
const OPH_TAB = 'app/(main)/patients/[id]/components/OphthalmologyTab.tsx';
const PLASTIC_PAGE = 'app/(main)/plastic/page.tsx';
const URO_PAGE = 'app/(main)/urology/page.tsx';

/* ════════════════════════════════════════════════════════════════════════
   1. 청력도 — 저장 정본 모양을 읽는다
   ════════════════════════════════════════════════════════════════════════ */

/**
 * 운영 `ent_exams.audiogram_right` 실측값을 그대로 옮긴 것(2026-08-26 조회).
 * 🔴 **내가 가정한 모양이 아니라 서버가 저장한 모양**을 목으로 쓴다 —
 *    v4.2.0 "목만 통과하는 테스트"·v4.7 "퇴원 게이트 래핑"이 그 반대로 하다 헛돌았다.
 */
const STORED_RIGHT = [
  { ac: 10, bc: 5, freq: 250 }, { ac: 10, bc: 5, freq: 500 },
  { ac: 15, bc: 10, freq: 1000 }, { ac: 15, bc: 10, freq: 2000 },
  { ac: 20, bc: 15, freq: 4000 }, { ac: 25, bc: 20, freq: 8000 },
];
/** bc 가 없는 행도 실재한다(운영 3/4건) — 골도가 없다고 기도까지 버리면 안 된다. */
const STORED_LEFT_NO_BC = [
  { ac: 25, freq: 250 }, { ac: 30, freq: 500 }, { ac: 35, freq: 1000 },
  { ac: 40, freq: 2000 }, { ac: 45, freq: 4000 }, { ac: 50, freq: 8000 },
];

describe('청력도(오디오그램) — 저장 정본 `[{freq, ac, bc?}]` 를 읽는다', () => {
  it('기도(ac)·골도(bc)를 각각 뽑는다', () => {
    expect(parseAudiogramSeries(STORED_RIGHT, 'ac')).toEqual([
      { freq: 250, db: 10 }, { freq: 500, db: 10 }, { freq: 1000, db: 15 },
      { freq: 2000, db: 15 }, { freq: 4000, db: 20 }, { freq: 8000, db: 25 },
    ]);
    expect(parseAudiogramSeries(STORED_RIGHT, 'bc')).toHaveLength(6);
  });

  it('골도가 없는 검사도 기도는 온전히 나온다 (bc 는 빈 목록 = "그릴 것이 없다")', () => {
    expect(parseAudiogramSeries(STORED_LEFT_NO_BC, 'ac')).toHaveLength(6);
    expect(parseAudiogramSeries(STORED_LEFT_NO_BC, 'bc')).toEqual([]);
  });

  it('🔴 재주입 검증 — 종전처럼 `db` 키만 요구하면 실데이터가 전건 탈락한다', () => {
    // 종전 파서의 필터를 그대로 재현한다: `p.freq != null && p.db != null`
    const legacy = STORED_RIGHT.filter((p) => (p as Record<string, unknown>).db != null);
    expect(legacy, '저장값에 `db` 키는 없다 — 그래서 차트 렌더 조건이 영원히 false 였다').toEqual([]);
    // 정본 파서는 같은 입력에서 6점을 낸다
    expect(parseAudiogramSeries(STORED_RIGHT, 'ac').length).toBeGreaterThan(0);
  });

  it('🔴 재주입 검증 — 종전처럼 `rightAC`/`acRight` 어휘로 부르면 교집합이 0 이다', () => {
    const row = { audiogramRight: STORED_RIGHT, audiogramLeft: STORED_LEFT_NO_BC } as Record<string, unknown>;
    expect(row.rightAC, '서버는 `rightAC` 를 주지 않는다').toBeUndefined();
    expect(row.acRight, '서버는 `acRight` 를 주지 않는다').toBeUndefined();
    // 정본 어휘로는 네 계열이 모두 나온다(좌측 bc 는 저장이 없어 빈 목록)
    const series = audiogramSeriesOf(row);
    expect(series.rightAC).toHaveLength(6);
    expect(series.leftAC).toHaveLength(6);
    expect(series.rightBC).toHaveLength(6);
    expect(series.leftBC).toEqual([]);
  });

  it('모르는 모양은 지어내지 않고 버린다', () => {
    expect(parseAudiogramSeries(null, 'ac')).toEqual([]);
    expect(parseAudiogramSeries('20dB', 'ac')).toEqual([]);
    // 구형 `{freq: db}` 객체는 기도만 — 골도로 넘겨 짚지 않는다
    expect(parseAudiogramSeries({ 250: 10, 500: 20 }, 'ac')).toHaveLength(2);
    expect(parseAudiogramSeries({ 250: 10, 500: 20 }, 'bc')).toEqual([]);
  });

  it('🔴 차트는 가장 최근 회차를 그린다 (서버는 오래된 순으로 준다)', () => {
    // getAudiogram 은 `examinedAt: 'asc'` — 화면이 rows[0] 을 "최신"이라 부르면 가장 오래된 것을 그린다
    const rows = [
      { id: 'old', examinedAt: '2024-01-02T00:00:00Z', audiogramRight: STORED_LEFT_NO_BC },
      { id: 'new', examinedAt: '2026-05-28T00:00:00Z', audiogramRight: STORED_RIGHT },
    ];
    expect(latestAudiogramRow(rows)?.id, 'asc 순서의 rows[0] 은 최신이 아니다').toBe('new');
    // 대조군 — 한 건뿐이면 그것이 최신이고, 빈 목록은 null(빈 차트를 지어내지 않는다)
    expect(latestAudiogramRow([rows[0]])?.id).toBe('old');
    expect(latestAudiogramRow([])).toBeNull();
  });

  it('화면이 "어느 회차인가"를 밝힌다 (한 회차를 전체 요약처럼 보이게 하지 않는다)', () => {
    for (const f of [ENT_PAGE, ENT_TAB]) {
      const src = read(f);
      expect(src, `${f}: 최신 회차 선택을 하지 않는다`).toContain('latestAudiogramRow');
      expect(src, `${f}: 차트가 어느 검사인지 말하지 않는다`).toContain('검사일 미상');
    }
  });

  it('읽기 정본은 하나다 — 대시보드와 환자 차트 탭이 같은 함수를 쓴다', () => {
    for (const f of [ENT_PAGE, ENT_TAB]) {
      const src = read(f);
      expect(src, `${f}: 정본 파서를 쓰지 않는다`).toContain('audiogramSeriesOf');
      expect(src.includes('rightAC ?? '), `${f}: 서버에 없는 어휘가 남아 있다`).toBe(false);
      expect(src.includes('acRight'), `${f}: 서버에 없는 어휘가 남아 있다`).toBe(false);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
   2. 피부과 ABCDE — 총점에서 항목값을 만들어내지 않는다
   ════════════════════════════════════════════════════════════════════════ */

describe('피부과 ABCDE — 저장돼 있지 않은 항목별 값을 지어내지 않는다', () => {
  it('총점에서 A·B·C·D·E 를 역산하는 코드가 없다', () => {
    const src = read(DERM_PAGE);
    // 종전 코드: `{ label: 'A', val: abcde >= 1 ? Math.min(Math.ceil(abcde / 2), 3) : 0 }` …
    expect(src.includes('abcdeBreakdown'), 'ABCDE 항목별 값을 총점에서 만들고 있다').toBe(false);
    for (const frag of ["label: 'A'", "label: 'B'", "label: 'C'", "label: 'D'", "label: 'E'"]) {
      expect(src.includes(frag), `ABCDE 항목별 막대가 되살아났다: ${frag}`).toBe(false);
    }
    expect(src.includes('Math.ceil(abcde'), '총점 역산 산식이 남아 있다').toBe(false);
    expect(src.includes('Math.floor(abcde'), '총점 역산 산식이 남아 있다').toBe(false);
  });

  it('항목별이 없다는 사실을 화면이 말한다 (침묵하지 않는다)', () => {
    expect(read(DERM_PAGE)).toContain('항목별');
  });

  it('🔴 미평가 ABCDE 를 0 으로 접지 않는다', () => {
    const src = read(DERM_PAGE);
    expect(src.includes('(l.abcdeScore as number) ?? 0'), '미평가가 "0/8 초록"이 된다').toBe(false);
    expect(src).toContain("typeof l.abcdeScore === 'number'");
    expect(src).toContain('미평가');
  });
});

/* ════════════════════════════════════════════════════════════════════════
   3. 미측정을 안전값으로 접는 관용구 — `?? 0` / `|| 0` 금지
   ════════════════════════════════════════════════════════════════════════ */

describe('미측정을 조건식에서 폴백하지 않는다 (표시보다 조건이 더 위험하다)', () => {
  const FOLDS: { file: string; frag: string; why: string }[] = [
    { file: ENT_PAGE, frag: '(a.ptaRight as number) ?? 0', why: 'PTA 미측정이 0dB → "정상" 초록' },
    { file: ENT_PAGE, frag: '(a.ptaLeft as number) ?? 0', why: 'PTA 미측정이 0dB → "정상" 초록' },
    { file: ENT_PAGE, frag: 'sd.ahi) || 0', why: 'AHI 미기록이 0 → 수면무호흡 "정상"' },
    { file: OPH_PAGE, frag: 'Number(d.iopOd ?? 0)', why: '안압 미측정이 0 mmHg(존재 불가값)로 급락' },
    { file: OPH_PAGE, frag: 'Number(d.iopOs ?? 0)', why: '안압 미측정이 0 mmHg(존재 불가값)로 급락' },
    { file: OPH_TAB, frag: 'Number(d.iopOd ?? 0)', why: '안압 미측정이 0 mmHg 로 급락(차트 탭)' },
    { file: OPH_TAB, frag: 'Number(d.iopOs ?? 0)', why: '안압 미측정이 0 mmHg 로 급락(차트 탭)' },
  ];

  for (const { file, frag, why } of FOLDS) {
    it(`${file} — \`${frag}\` 가 없다 (${why})`, () => {
      expect(read(file).includes(frag), why).toBe(false);
    });
  }

  it('대신 null 분기로 말한다 — 대조군(정직한 표현이 실제로 있는지)', () => {
    expect(read(ENT_PAGE), 'PTA 미측정 표기가 없다').toContain('미측정');
    expect(read(ENT_PAGE), 'AHI 미판정 표기가 없다').toContain('UNKNOWN');
    expect(read(OPH_PAGE), '안압 null 분기가 없다').toContain('d.iopOd == null');
    expect(read(OPH_TAB), '안압 null 분기가 없다').toContain('numOrNull(d.iopOd)');
    // EyeDiagram 은 `iop: number | null` 로 '미측정'을 그린다 — `?? 0` 이 그 분기를 도달 불가로 만들었었다
    expect(read(OPH_TAB), '검사기록 도해가 미측정을 0 으로 넘긴다').toContain('numOrNull(latestExam.iopOd)');
  });
});

/* ════════════════════════════════════════════════════════════════════════
   4. 성형외과 표 — 모델(PlasticExam)에 있는 필드만 읽는다
   ════════════════════════════════════════════════════════════════════════ */

describe('성형외과 시술기록 표는 모델에 있는 필드를 읽는다', () => {
  /** `PlasticExam` 에 **없는** 필드들 — 종전 표는 8칸 중 5칸을 이것으로 채웠다(전부 '-'). */
  const NOT_IN_MODEL = ['r.procedureDate', 'r.site', 'r.procedureName', 'r.anesthesia as', 'r.status'];
  /** 실제 컬럼 — 이 중 하나라도 빠지면 표가 다시 비어 있다는 뜻이다. */
  const IN_MODEL = ['r.examinedAt', 'r.bodyPart', 'r.procedure as', 'r.anesthesiaType', 'r.material', 'r.fitzpatrickType', 'r.duration'];

  it('모델에 없는 필드를 읽지 않는다', () => {
    const src = read(PLASTIC_PAGE);
    for (const f of NOT_IN_MODEL) {
      expect(src.includes(f), `PlasticExam 에 없는 필드를 읽는다: ${f}`).toBe(false);
    }
  });

  it('모델에 있는 필드를 실제로 읽는다 (대조군 — 칸을 지워서 통과하지 못하게)', () => {
    const src = read(PLASTIC_PAGE);
    for (const f of IN_MODEL) {
      expect(src.includes(f), `표가 ${f} 를 읽지 않는다`).toBe(true);
    }
  });

  it('전후사진 슬라이더에 URL 을 넘긴다 (인자 없는 빈 상자를 그리지 않는다)', () => {
    const src = read(PLASTIC_PAGE);
    expect(src.includes('<BeforeAfterSlider />'), '인자 없는 슬라이더 = 비교 자료가 있는 것처럼 보이는 빈 상자').toBe(false);
    expect(src).toContain('beforeUrl={beforeUrls[0]}');
  });
});

/* ════════════════════════════════════════════════════════════════════════
   5. 배선 — 노쇼 칸 · 비뇨 시술기록 탭
   ════════════════════════════════════════════════════════════════════════ */

describe('오늘 현황 4칸이 총계와 어긋나는 이유(노쇼)를 화면이 말한다', () => {
  const PAGES = [ENT_PAGE, DERM_PAGE, PLASTIC_PAGE, URO_PAGE, 'app/(main)/dental/page.tsx', OPH_PAGE];
  for (const p of PAGES) {
    it(`${p} — 노쇼 건수를 표시한다`, () => {
      const src = read(p);
      expect(src.includes('stats.noShow'), '노쇼가 어느 칸에도 없다').toBe(true);
      expect(src.includes('노쇼'), '노쇼 라벨이 없다').toBe(true);
    });
  }
});

describe('비뇨의학과 시술기록 탭이 배선돼 있다', () => {
  it('EP 를 부르고 탭이 존재한다', () => {
    const src = read(URO_PAGE);
    expect(src).toContain('/api/v1/urology/procedures/');
    expect(src).toContain("'procedures' as UroTab");
  });

  it('🔴 검체 채취 여부를 3상태로 말한다 (미기록을 "없음"으로 접지 않는다)', () => {
    const src = read(URO_PAGE);
    expect(src).toContain('p.specimenTaken == null');
    expect(src).toContain('미기록');
  });
});
