/**
 * 🔴 알레르기 "없음" 단언은 정본으로만 — 2026-08-27 신설.
 *
 * 발단: C1(2026-08-26)이 차트 헤더의 초록 `NKDA` 를 4상태 정본으로 고치면서 계획서에
 * **"거짓 단언은 헤더의 초록 NKDA 한 곳뿐"**이라고 적었다. 그 문장이 틀렸다. 재실측(2026-08-27):
 *
 *   · `BoardHeaderBar`(회진 보드 헤더) · `TabletTopBar`(간호 타블렛) — 초록 `NKDA`
 *   · `OverviewTab` 안전카드 — 조건이 `summary?.allergies !== undefined`("응답이 왔다")인데 **"확인됨"**이라 적었다
 *   · `OverviewTab` AI 요약 텍스트 · `AllergyTab` 초록 `NKA` · 원격진료 `PatientInfoPanel` 초록 "등록된 알레르기 없음"
 *   · `PatientInfoTab` 회색 "없음"
 *
 * 원인: 정본 컴포넌트가 `(main)/patients/[id]/components/` **한 라우트 안에** 있었다 —
 * 다른 라우트는 그것을 알 수 없어 **자기 판정을 새로 적었다.** 그래서 `components/clinical/` 로 옮겼다.
 *
 * 규칙: 알레르기 **안전 단언 문구**를 비주석 코드에 쓰는 파일은 반드시 정본을 함께 써야 한다.
 * 재주입: 아무 화면에서 `allergies.length === 0 → 'NKDA'` 를 되살리면 실패한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.resolve(__dirname, '..', '..', 'src');

/** 초록/안전으로 읽히는 단언 문구 — 실측으로 모은 것이다 */
const ASSERTION = /NKDA|NKA \(|무알레르기|알레르기 없음|알레르기: 없음/;
/**
 * 정본을 쓰고 있다는 표식 — 헬퍼/배지뿐 아니라 **4상태 값으로 분기하는 것**도 정본 사용이다.
 * 🔴 첫 판정은 `AiAssistantPanel` 을 위반으로 올렸는데, 그 파일은 `brief.allergy.status` 로
 *    정직하게 분기하고 있었다(내 표식이 좁았을 뿐이다). **정직한 코드를 가드에 맞추지 않는다.**
 */
const CANON = /allergyStatusIsReassuring|AllergyStatusBadge|useAllergyStatus|allergyStatus|ALLERGY_STATUS|NO_KNOWN_ALLERGIES|UNABLE_TO_ASSESS|NOT_ASSESSED/;
/** 정본 자신 — 문구의 출처다 */
const CANON_FILES = [path.join('components', 'clinical', 'allergy-status.tsx')];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

/** 주석을 걷어낸 코드만 본다 — 이 파일들의 주석에는 "종전엔 NKDA 였다"는 설명이 잔뜩 있다 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

describe('알레르기 — "없음"은 정본만 말한다', () => {
  const files = walk(WEB_SRC).filter((f) => !/\.(spec|test)\.tsx?$/.test(f));

  it('🔴 안전 단언 문구를 쓰는 화면은 4상태 정본을 함께 쓴다', () => {
    // 표본이 사라지면 조용히 통과한다 — 하한을 건다
    expect(files.length, 'web 소스 수집 실패').toBeGreaterThan(300);

    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(WEB_SRC, f);
      if (CANON_FILES.includes(rel)) continue;
      const code = codeOnly(fs.readFileSync(f, 'utf8'));
      if (!ASSERTION.test(code)) continue;
      if (CANON.test(code)) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `알레르기 "없음"을 정본 없이 단언한다(빈 목록 ≠ 확인함):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('대조군 — 판정 함수가 실제로 결함을 잡는다(무조건 통과가 아니다)', () => {
    const bad = "const x = allergies.length === 0 ? 'NKDA' : '알레르기';";
    const good = "const x = allergyStatusIsReassuring(s, a) ? '알레르기 없음(확인함)' : '미확인';";
    const commentOnly = "// 🔴 종전엔 NKDA 를 그렸다\nconst x = 1;";
    expect(ASSERTION.test(codeOnly(bad)) && !CANON.test(codeOnly(bad))).toBe(true);
    expect(ASSERTION.test(codeOnly(good)) && !CANON.test(codeOnly(good))).toBe(false);
    // 주석만으로는 위반이 아니다 — 오탐을 내면 가드를 끄게 된다
    expect(ASSERTION.test(codeOnly(commentOnly))).toBe(false);
  });
});
