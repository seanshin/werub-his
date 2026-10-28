import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  IM_SUBSPECIALTY_VIEWS, imViewOf, imCellValue, imTrendSeries,
} from '../../src/lib/specialty/internal-medicine-views';
import {
  growthPointsOf, growthSexOf, devOverallResult, devResultView,
} from '../../src/lib/specialty/pediatrics-views';
import { IM_SUBSPECIALTY_KEYS } from '@hospital-run/shared';

/**
 * 전문진료 대시보드 정직성 가드 — 2026-08-26 (레인 E1 봉합분).
 *
 * 계약 가드(`specialty-endpoint-contract.spec.ts`)는 **경로**만 본다.
 * 여기서는 경로가 맞아도 남는 거짓말을 잡는다:
 *   ① 화면이 읽는 **필드명**이 서버 모델에 실제로 있는가(값이 있는데 `-` 를 보이던 14칸)
 *   ② 서버 응답 **모양**을 화면이 맞게 읽는가(flat 배열 ↔ 그룹맵 — 차트가 한 번도 안 떴다)
 *   ③ 미측정을 조건식에서 폴백하지 않는가(`?? 0` — 임상 불가능한 GCS 0 을 'Severe' 로)
 *   ④ 임상 파라미터를 하드코딩하지 않는가(`gender="male"` — 여아를 남아 곡선 위에)
 *
 * 🔴 각 단언은 **결함을 되돌리면 실패**해야 한다. 통과만 하는 문자열 검색은 가드가 아니다.
 */


/**
 * 주석을 제거한 소스 — 가드는 **코드**만 본다.
 * 🔴 봉합 주석은 "종전에 무엇이 잘못이었는가"를 적으므로 옛 코드 조각을 그대로 담는다.
 *    주석을 같이 훑으면 고쳐진 파일이 실패하고, 그 실패를 피하려 주석을 지우게 된다(설명이 사라진다).
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const WEB = join(process.cwd(), 'src');
const SCHEMA = join(process.cwd(), '..', 'api', 'prisma', 'schema.prisma');

/** schema.prisma 의 한 모델 블록에 선언된 필드명 집합. */
function fieldsOf(model: string): Set<string> {
  const src = readFileSync(SCHEMA, 'utf8');
  const m = new RegExp(`^model ${model} \\{$([\\s\\S]*?)^\\}$`, 'm').exec(src);
  if (!m) throw new Error(`model ${model} 을 schema.prisma 에서 찾지 못했다`);
  return new Set(
    m[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
      .map((l) => l.split(/\s+/)[0]),
  );
}

/* ═════════ ① 내과 검사표 컬럼이 실컬럼명인가 ═════════ */

describe('내과 세부과 표시 정본', () => {
  const fields = fieldsOf('InternalMedicineExam');

  it('컬럼 key 와 점수 field 가 전부 InternalMedicineExam 의 실필드다', () => {
    // 🔴 재주입 검증: `meldScore` 를 `meld` 로 되돌리면 이 단언이 실패한다.
    const unknownNames: string[] = [];
    for (const def of IM_SUBSPECIALTY_VIEWS) {
      for (const c of def.columns) if (!fields.has(c.key)) unknownNames.push(`${def.key}.columns.${c.key}`);
      for (const s of def.scoreSeriesConfig) if (!fields.has(s.field)) unknownNames.push(`${def.key}.series.${s.field}`);
    }
    expect(unknownNames, `모델에 없는 필드명을 읽는다(값이 있어도 화면은 '-'):\n${unknownNames.join('\n')}`).toEqual([]);
  });

  it('대조군 — 없는 필드명은 이 검사가 실제로 잡는다', () => {
    expect(fields.has('meldScore')).toBe(true);
    expect(fields.has('meld')).toBe(false);
    expect(fields.has('haqDi')).toBe(true);
    expect(fields.has('haqdi')).toBe(false);
    expect(fields.has('sofaScore')).toBe(true);
    expect(fields.has('sofa')).toBe(false);
  });

  it('세부과 key 집합이 shared 어휘 정본과 일치한다', () => {
    expect([...IM_SUBSPECIALTY_VIEWS.map((s) => s.key)].sort()).toEqual([...IM_SUBSPECIALTY_KEYS].sort());
  });

  it('세부과 정본은 화면이 아니라 lib 한 곳에만 있다', () => {
    // 🔴 종전엔 대시보드와 환자 차트 탭이 각자 정의해 한쪽만 고쳐진 채 갈라져 있었다(P12).
    for (const page of [
      'app/(main)/internal-medicine/page.tsx',
      'app/(main)/patients/[id]/components/InternalMedicineTab.tsx',
    ]) {
      const src = codeOf(join(WEB, page));
      expect(src, `${page} 가 세부과 표를 다시 정의한다`).not.toMatch(/scoreSeriesConfig:\s*\[/);
      expect(src, `${page} 가 정본을 import 하지 않는다`).toContain("@/lib/specialty/internal-medicine-views");
    }
  });

  it('imCellValue — 값이 있으면 보여주고, 없을 때만 `-`', () => {
    const gastro = imViewOf('GASTRO');
    const meldCol = gastro.columns.find((c) => c.key === 'meldScore')!;
    expect(imCellValue({ meldScore: 22 }, meldCol)).toBe('22');
    expect(imCellValue({}, meldCol)).toBe('-');
    // 0 은 "기록 없음"이 아니다
    expect(imCellValue({ meldScore: 0 }, meldCol)).toBe('0');
  });
});

/* ═════════ ② 점수추이: flat 배열을 읽는가 ═════════ */

describe('내과 점수추이 — 서버 flat 배열을 그대로 읽는다', () => {
  const gastro = imViewOf('GASTRO');

  it('flat 배열에서 시리즈가 만들어진다', () => {
    // 서버 `getScoreTrend()` 실제 반환 모양(선택 필드 + examinedAt 의 flat 배열)
    const rows = [
      { id: 'a', subspecialty: 'GASTRO', examinedAt: '2026-06-01T00:00:00Z', meldScore: 18, childPughScore: 8 },
      { id: 'b', subspecialty: 'GASTRO', examinedAt: '2026-06-20T00:00:00Z', meldScore: 22, childPughScore: 9 },
    ];
    const series = imTrendSeries(rows, gastro);
    expect(series.map((s) => s.name).sort()).toEqual(['Child-Pugh', 'MELD']);
    expect(series.find((s) => s.name === 'MELD')!.data.map((d) => d.value)).toEqual([18, 22]);
  });

  it('🔴 재주입 — 옛 코드가 기대하던 "표시명 그룹맵"을 넘기면 시리즈가 0이 된다(그래서 차트가 안 떴다)', () => {
    const groupMapShape = [{ MELD: [{ date: 'x', value: 1 }] }] as unknown as Record<string, unknown>[];
    expect(imTrendSeries(groupMapShape, gastro)).toEqual([]);
  });

  it('값이 없는 시점은 점을 찍지 않는다(`?? 0` 으로 채우면 안 잰 것이 0점이 된다)', () => {
    const rows = [
      { examinedAt: '2026-06-01T00:00:00Z', meldScore: 18 },
      { examinedAt: '2026-06-20T00:00:00Z', meldScore: null },
    ];
    const meld = imTrendSeries(rows, gastro).find((s) => s.name === 'MELD')!;
    expect(meld.data).toHaveLength(1);
    expect(meld.data[0].value).toBe(18);
  });
});

/* ═════════ ③ 신경외과 GCS — 결측을 0 으로 접지 않는가 ═════════ */

describe('신경외과 GCS 추이', () => {
  const src = codeOf(join(WEB, 'app/(main)/neurosurgery/page.tsx'));

  it('🔴 성분을 `?? 0` 으로 합산하지 않는다 — GCS 최솟값은 3이고 0~2 는 임상적으로 불가능하다', () => {
    // 재주입 검증: `Number(r.eye ?? 0) + …` 를 되돌리면 실패한다.
    expect(src).not.toMatch(/r\.(eye|verbal|motor)\s*\?\?\s*0/);
  });

  it('저장된 총점(total)을 정본으로 쓰고, 없으면 성분이 모두 있을 때만 합산한다', () => {
    expect(src).toContain("typeof r.total === 'number' ? r.total");
    expect(src).toContain("parts.every((v) => v != null)");
  });

  it('총점을 못 구하면 중증도를 단정하지 않는다', () => {
    // 문구는 shared 정본(`RATIO_UNAVAILABLE`) — 화면이 손으로 적지 않는다
    expect(src).toContain('severity ?? RATIO_UNAVAILABLE');
  });

  it('GCS 추이가 응답의 시각 필드(`date`)를 읽는다 — `recordedAt` 은 응답에 없다', () => {
    expect(src).not.toContain('r.recordedAt');
  });

  it('근력맵이 exam 행의 motorExam 을 쓰고, 피부분절도가 빈 배열 하드코딩이 아니다', () => {
    expect(src).not.toContain('motorExam={[]}');
    expect(src).toContain('motorExam={latestMotorExam}');
  });
});

/* ═════════ ④ 소아 성장곡선 — 성별 하드코딩·빈 데이터 ═════════ */

describe('소아 성장곡선', () => {
  const consumers = [
    'app/(main)/pediatrics/page.tsx',
    'app/(main)/patients/[id]/components/PediatricsTab.tsx',
    'app/(main)/patients/[id]/encounter/new/components/PediatricsEncounterLayout.tsx',
  ];

  it('🔴 어떤 화면도 성별을 하드코딩하지 않는다 — 여아를 남아 백분위 곡선 위에 그리는 것은 임상 오정보다', () => {
    for (const page of consumers) {
      const src = codeOf(join(WEB, page));
      expect(src, `${page}`).not.toMatch(/gender=["'](male|female)["']/);
    }
  });

  it('🔴 대시보드가 빈 배열을 곡선에 넘기지 않는다(운영 성장기록이 하나도 안 찍히던 자리)', () => {
    const src = codeOf(join(WEB, 'app/(main)/pediatrics/page.tsx'));
    expect(src).not.toMatch(/<GrowthCurveChart\s+data=\{\[\]\}/);
    expect(src).toContain('data={growthPoints}');
  });

  it('growthSexOf — 원장 성별만 쓰고, OTHER/UNKNOWN/부재는 미상(null)', () => {
    expect(growthSexOf({ patient: { gender: 'FEMALE' } })).toBe('female');
    expect(growthSexOf({ patient: { gender: 'MALE' } })).toBe('male');
    expect(growthSexOf({ patient: { gender: 'OTHER' } })).toBeNull();
    expect(growthSexOf({ patient: { gender: 'UNKNOWN' } })).toBeNull();
    expect(growthSexOf({})).toBeNull();
    expect(growthSexOf(undefined)).toBeNull();
  });

  it('growthPointsOf — Decimal 문자열을 읽고, 월령 없는 행은 버리며, 0 은 살린다', () => {
    const pts = growthPointsOf([
      { ageMonths: 12, weight: '9.6', height: '75.7' },
      { ageMonths: 0, weight: 3.3 },
      { weight: 10 },
    ]);
    expect(pts.map((p) => p.ageMonths)).toEqual([0, 12]);
    expect(pts[1].weight).toBe(9.6);
  });

  it('서버 성장기록 조회가 성별을 함께 준다(화면이 곡선을 고를 수 있어야 한다)', () => {
    const svc = codeOf(join(process.cwd(), '..', 'api', 'src', 'modules', 'pediatrics', 'pediatrics.service.ts'));
    const getGrowth = svc.slice(svc.indexOf('async getGrowth('), svc.indexOf('async createGrowth('));
    expect(getGrowth).toContain('gender: true');
  });
});

/* ═════════ ⑤ 소아 진료 저장 — 존재하는 EP 로, 지어내지 않고 ═════════ */

describe('소아 진료 저장 경로', () => {
  const src = codeOf(join(WEB, 'app/(main)/patients/[id]/encounter/new/components/PediatricsEncounterLayout.tsx'));

  it('🔴 존재하지 않던 `pediatrics/exams` 를 부르지 않고 정본 3개를 쓴다', () => {
    expect(src).not.toContain('/api/v1/pediatrics/exams');
    expect(src).toContain('/api/v1/pediatrics/growth');
    expect(src).toContain('/api/v1/pediatrics/immunizations');
    expect(src).toContain('/api/v1/pediatrics/developmental');
  });

  it('DTO 필드명을 쓴다 — `headCircumference` 는 whitelist 가 지우는 이름이다', () => {
    expect(src).not.toContain('headCircumference');
    expect(src).toContain('headCirc:');
  });

  it('접종일 없이 접종 기록을 만들지 않는다(체크만으로 오늘 시행한 것으로 남기지 않는다)', () => {
    expect(src).toContain("c.date.trim()");
    expect(src).not.toMatch(/givenAt:\s*new Date\(\)\.toISOString\(\)/);
  });

  it('부분 실패를 성공으로 말하지 않는다', () => {
    expect(src).toContain('failed.length');
    expect(src).toContain('toast.error');
  });

  it('devOverallResult — 하나라도 미평가면 종합판정을 지어내지 않고, 가장 나쁜 영역을 올린다', () => {
    expect(devOverallResult(['NORMAL', 'NORMAL', 'NORMAL', ''])).toBeNull();
    expect(devOverallResult(['NORMAL', 'NORMAL', 'NORMAL', null])).toBeNull();
    expect(devOverallResult(['NORMAL', 'SUSPECT', 'NORMAL', 'NORMAL'])).toBe('SUSPECT');
    expect(devOverallResult(['NORMAL', 'SUSPECT', 'DELAYED', 'NORMAL'])).toBe('DELAYED');
    expect(devOverallResult(['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'])).toBe('NORMAL');
  });

  it('devResultView — 입력이 저장하는 어휘를 읽는 화면이 전부 안다(SUSPECT/DELAYED 가 영문으로 새지 않는다)', () => {
    for (const v of ['NORMAL', 'SUSPECT', 'DELAYED']) {
      const view = devResultView(v)!;
      expect(view.label, `${v} 가 한글 라벨로 번역되지 않는다`).not.toBe(v);
      expect(view.cls, `${v} 가 미지 어휘로 회색 처리된다`).not.toBe('bg-gray-100 text-gray-600');
    }
    // 미평가는 정상(초록)이 아니라 없음
    expect(devResultView(null)).toBeNull();
    expect(devResultView('')).toBeNull();
    // 모르는 값은 삼키지 않고 원문 그대로
    expect(devResultView('WHATEVER')!.label).toBe('WHATEVER');
  });
});

/* ═════════ ⑥ 분만장 보드 — 실패를 "분만 없음"으로 말하지 않는다 ═════════ */

describe('분만장 보드(L&D)', () => {
  const src = codeOf(join(WEB, 'app/(main)/obgyn/DeliveryBoard.tsx'));

  it('🔴 조회 실패를 화면에 말한다 — 없으면 요약이 전부 0, 목록이 "진행 중 분만 없음"이 된다', () => {
    expect(src).toContain('isError');
    expect(src).toContain('QueryErrorFallback');
  });

  it('요약 타일이 로딩 중을 0 으로 단정하지 않는다', () => {
    expect(src).not.toMatch(/\(v as number\)\s*\?\?\s*0/);
  });

  it('🔴 쓰기 뮤테이션 4종 전부에 onError 가 있다(Apgar·분만유형은 법정 기록이다)', () => {
    const muts = src.match(/const \w+Mut = useMutation\(\{[\s\S]*?\n  \}\);/g) ?? [];
    expect(muts.length, '뮤테이션을 찾지 못했다 — 정규식이 조준을 잃었다').toBe(4);
    const noHandler = muts.filter((m) => !m.includes('onError')).map((m) => m.slice(0, 40));
    expect(noHandler, `실패가 침묵하는 뮤테이션:\n${noHandler.join('\n')}`).toEqual([]);
  });
});
