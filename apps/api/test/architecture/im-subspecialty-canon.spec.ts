import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IM_SUBSPECIALTY_KEYS } from '@hospital-run/shared';

/**
 * 🔴 내과 세부전문과 어휘 정합 — 이연 회수 T2-3(2026-08-18).
 *
 * 실측에서 **같은 개념에 어휘가 네 벌**이었다:
 *   코드 정본 `GASTRO`/`ENDOCRINE` · 리치니스 시드 `GASTROENTEROLOGY`/`ENDOCRINOLOGY` ·
 *   진료 입력 화면 **한글**(`소화기내과`) · 그 결과 저장된 값이 뒤섞였다.
 * 조회 화면과 지표 추이표는 코드로 필터하므로, 다른 어휘로 저장된 기록은
 * **저장한 사람에게도 보이지 않았다**(운영 표본 20명에서 15건).
 *
 * 어휘는 조용히 갈라진다 — 정본(shared)을 놓고 소비처를 기계로 맞춘다.
 */

const API = process.cwd();
const WEB = join(API, '..', 'web');

function read(p: string): string {
  return readFileSync(p, 'utf-8');
}

/** 소스에서 대문자 상수형 세부전문과 후보를 뽑는다(문자열 리터럴만). */
function upperKeysIn(src: string): string[] {
  return [...src.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]);
}

describe('내과 세부전문과 어휘 정합', () => {
  it('스키마 주석의 예시 어휘가 정본과 일치한다', () => {
    const schema = read(join(API, 'prisma/schema.prisma'));
    const line = schema.split('\n').find((l) => l.includes('subspecialty') && l.includes('//'));
    expect(line, 'InternalMedicineExam.subspecialty 주석을 찾지 못했다').toBeDefined();
    const inComment = upperKeysIn(`'${(line ?? '').split('//')[1].trim().replace(/,\s*/g, "','")}'`);
    expect(inComment.sort()).toEqual([...IM_SUBSPECIALTY_KEYS].sort());
  });

  it('🔴 서버 지표 추이표의 과 키가 정본과 일치한다 — 없는 키면 그 과 지표가 통째로 빠진다', () => {
    const svc = read(join(API, 'src/modules/internal-medicine/internal-medicine.service.ts'));
    const table = /scoreFieldsBySubspecialty:[\s\S]*?=\s*\{([\s\S]*?)\n    \};/.exec(svc);
    expect(table, '지표 추이표를 찾지 못했다').not.toBeNull();
    const keys = [...table![1].matchAll(/^\s{6}([A-Z][A-Z_]+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...IM_SUBSPECIALTY_KEYS].sort());
  });

  it('🔴 리치니스 시드가 정본 목록을 그대로 쓴다 — 시드만 다른 어휘를 쓰면 DB 를 고쳐도 되살아난다', () => {
    const seed = read(join(API, 'prisma/seeds/dept-richness.ts'));
    expect(seed).toContain('IM_SUBSPECIALTY_KEYS');
    // 주석은 옛 어휘를 '설명'할 수 있으므로 코드만 본다
    const code = seed.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '시드에 자체 어휘 배열이 남아 있다').not.toMatch(/GASTROENTEROLOGY|ENDOCRINOLOGY/);
  });

  it('🔴 진료 입력 화면이 한글을 저장값으로 쓰지 않는다', () => {
    const layout = read(join(WEB, 'src/app/(main)/patients/[id]/encounter/new/components/InternalMedicineEncounterLayout.tsx'));
    expect(layout).toContain('IM_SUBSPECIALTIES');
    expect(layout, '한글 세부전문과가 저장값 후보로 남아 있다').not.toMatch(/'(소화기|심장|호흡기|내분비|신장|혈액종양|감염|류마티스)내과'/);
  });

  it('조회 화면의 과 키 정본(웹 lib)이 어휘 정본과 일치한다', () => {
    // 🔴 2026-08-26: 종전엔 대시보드와 환자 차트 탭이 **각자** 과 표를 선언했고(그래서 여기서 2곳을 훑었다),
    //    한쪽만 고쳐진 채 갈라져 검사표 14칸이 서버에 없는 필드명을 읽고 있었다.
    //    표는 `lib/specialty/internal-medicine-views.ts` 한 곳으로 모았으므로 여기도 그곳을 본다.
    const rel = 'src/lib/specialty/internal-medicine-views.ts';
    const src = read(join(WEB, rel));
    const keys = [...src.matchAll(/key:\s*'([A-Z][A-Z_]+)'/g)].map((m) => m[1]);
    expect(keys.length, `${rel} 에서 과 키를 찾지 못했다`).toBeGreaterThan(0);
    expect([...new Set(keys)].sort(), `${rel} 의 과 키가 정본과 다르다`).toEqual([...IM_SUBSPECIALTY_KEYS].sort());
  });

  it('🔴 조회 화면 2곳은 과 표를 다시 선언하지 않는다 — 다시 선언하면 또 갈라진다', () => {
    for (const rel of [
      'src/app/(main)/internal-medicine/page.tsx',
      'src/app/(main)/patients/[id]/components/InternalMedicineTab.tsx',
    ]) {
      const src = read(join(WEB, rel));
      expect(src, `${rel} 가 세부과 표를 다시 선언한다`).not.toMatch(/scoreSeriesConfig:\s*\[/);
      expect(src, `${rel} 가 정본을 import 하지 않는다`).toContain('@/lib/specialty/internal-medicine-views');
    }
  });
});
