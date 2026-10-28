import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 장비 점검일지 — 판정하지 않은 항목이 '적합'으로 저장되지 않는다 (2026-08-24 · P16 유형)
 *
 * 🔴 실측: 점검 5항목이 전부 `result: 'PASS'` 로 시작해 **점검하지 않아도 전부 합격이 저장됐다**.
 *    간호초기평가 '전부 정상' 사고와 동일 유형 — 쓰기 폼의 초기값은 미선택이다.
 */
const SRC = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'equipment', 'components', 'InspectionLogTab.tsx');
const src = fs.readFileSync(SRC, 'utf8');

describe('점검 항목 초기값은 미선택', () => {
  it("🔴 기본 체크리스트에 'PASS' 초기값이 없다 — 되돌리면 실패한다", () => {
    const block = src.match(/DEFAULT_CHECK_ITEMS[\s\S]*?\];/)?.[0] ?? '';
    expect(block).not.toContain("result: 'PASS'");
    expect(block).toContain("result: ''");
  });

  it('미판정 항목이 있으면 저장이 막히고 항목명이 나열된다', () => {
    expect(src).toMatch(/unjudged[\s\S]*=[\s\S]*checkItems\.filter/);
    expect(src).toContain('판정하지 않은 항목');
  });

  it('대조군 — 미점검·해당없음(N/A)을 구분한다 (미선택 option 과 NA option 이 따로 있다)', () => {
    // 🔴 UI 언어 배선(2026-09-09) 후 option 자식은 `{tAttr('원문')}` 이다(‹span› 을 넣을 수 없는 자리).
    //    **원문이 그대로 키로 남으므로** 검사는 두 형태를 모두 인정하도록 넓힌다 —
    //    문구를 지우거나 단언을 빼면 가드가 조용히 죽는다(부정 단언은 통과해 버린다).
    expect(src).toMatch(/<option value="">(?:미점검 — 선택|\{tAttr\('미점검 — 선택'\)\})<\/option>/);
    expect(src).toContain('<option value="NA">N/A</option>');
  });
});
