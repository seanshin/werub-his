import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스크립트(`scripts/i18n-unwired-scan.mjs`)에 있다 — 수치를 두 곳에 적으면 갈라진다.
// 🔴 `@ts-expect-error` 를 달았다가 뺐다: 해당 .mjs 가 타입 해석에 성공해 **지시자 자체가
//    미사용 오류(TS2578)** 가 됐다. 억제는 실제로 억제할 것이 있을 때만 단다.
import {
  SAFETY_PATH,
  scanScreens,
  commonChromeKeys,
  registeredCatalogFiles,
  hasExclusionReason,
} from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **"제외에는 사유가 있다"** — 병렬 산출물 검토 V2 (기획 `parallel-output-review.plan.md` §2 기전 6 · §4 V2 · §6).
 *
 * 병렬 에이전트 6기가 **각자 옳게** 판단해 안전 문구를 뺐다(오역이 임상 위해가 되는 자리).
 * 그런데 화면에서는 **아무도 안 한 것**과 **모두가 뺀 것**이 구분되지 않는다 — 둘 다 한국어로 보인다.
 * 이 구분이 없으면 "안전 문구는 일부러 한국어입니다"가 **검증 불가능한 주장**이 된다.
 *
 * 🔴 이 가드는 "제외인지"를 판정하지 않는다(제외 사유는 **어휘 단위**로 카탈로그 헤더에 적히고,
 *    구멍은 **화면 단위**로 생긴다 — 두 축은 기계적으로 대조되지 않는다). 대신 **반증 가능한 것만**
 *    못박는다:
 *      ① 등록된 영역 카탈로그가 제외 사유를 헤더에 적었는가 — 안 적은 것의 목록을 동결.
 *      ② 안전 축 화면 중 `<T>`/`tAttr` 배선이 **0** 인 것 — 카탈로그 저자가 본 적 없는 화면이므로
 *         그 화면에 대한 "일부러 뺐다"는 주장은 근거가 없다. 목록을 동결.
 *      ③ 그중 `common` 정본의 **무해 공통 크롬 키**(취소·닫기·저장·불러오는 중…)를 생한글로
 *         그리는 화면 — "안전해서 한국어로 뒀다"가 **반증되는** 자리. 아무도 환자안전을 이유로
 *         '취소' 버튼을 한국어로 두지 않는다.
 *
 * 🔴 **기준선에 여유를 두지 않는다**(이 저장소가 이번 라운드에 그 함정을 두 번 겪었다 — 55로 두었더니
 *    실측 50에 재주입 1건이 그대로 통과했다). 정확 집합 비교다. **줄었으면 기준선을 낮추고**,
 *    늘었으면 실패다.
 * 🔴 **정본에서 파생한다** — 카탈로그 목록은 `registry.ts`, 안전 축은 경로 패턴, 무해 키는 `common.ts`.
 *    수기 배열을 두면 새 카탈로그·새 화면이 통째로 시야 밖이 된다(기전 2 · 실제로 8종이 그랬다).
 *
 * 실측 2026-09-07 (재현: `node scripts/i18n-unwired-scan.mjs --safety`)
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');

/** 2026-09-07 실측 — 제외 사유를 헤더에 적지 않은 영역 카탈로그(사유를 적으면 여기서 빼고 기준선을 낮춘다) */
const NO_REASON_BASELINE = ['adminops.ts', 'common.ts', 'outpatient.ts', 'pharmlab.ts'];

/**
 * 2026-09-07 실측 — 안전 축 화면 중 `<T>`/`tAttr` 배선이 **0** 인 것(= 누락. 제외가 아니다).
 * 🔴 이 목록은 "안전해서 한국어로 뒀다"는 주장이 **성립하지 않는** 화면들이다.
 *    배선하면 목록에서 빠진다 → 기준선을 낮춘다. 새 안전 화면이 미배선으로 들어오면 실패한다.
 */
const UNWIRED_SAFETY_BASELINE = [
  // 🔴 2026-09-09 재실측으로 14 → 4 로 **낮췄다**(완화가 아니라 구멍이 실제로 메워진 것 —
  //    대조군 it 이 "배선된 화면은 이 목록에 없다"를 계속 지킨다). 빠진 10건의 출처를 갈라 적는다:
  //    · blood-bank 2건(`page.tsx`·`BloodBankEnhancement.tsx`) = 임상 진료 갈래(clinical3) 배선분
  //    · inpatient/nursing 8건 = **다른 갈래**가 같은 트리에서 배선한 것(내 몫이 아니다)
  // 🔴 2026-09-12 4 → 3: `nurse-station/imaging` 배선(§12 잔여 회수) — 구멍이 메워져 빠진 것이지 기준을 푼 것이 아니다.
  'tablet/nursing/[admissionId]/note/page.tsx',
  'tablet/nursing/[admissionId]/page.tsx',
  'tablet/nursing/page.tsx',
];

/**
 * 그중 무해 공통 크롬 키를 생한글로 렌더해 **"안전해서 제외"가 반증된** 화면(2026-09-07 실측 9 → 2026-09-09 실측 3).
 * 🔴 BCMA/MAR 투약 확정 화면이 여기 있다 — 기획 §2 기전 6 이 "지금은 알 수 없다"고 남긴 질문의 답이다.
 */
const FALSIFIED_BASELINE = [
  // 🔴 2026-09-09 재실측 9 → 3. blood-bank 2건은 임상 진료 갈래가, MAR·flowsheet·io·care-plan 4건은
  //    다른 갈래가 배선했다(출처를 갈라 적는다 — 남의 몫을 내 수에 섞지 않는다).
  // 🔴 2026-09-12 3 → 2: `nurse-station/imaging` 배선으로 반증 대상에서 빠졌다.
  'tablet/nursing/[admissionId]/note/page.tsx',
  'tablet/nursing/page.tsx',
];

type Row = { file: string; t: number; ko: number; frags: string[] };
const rows: Row[] = scanScreens(APP, APP);
const chrome: Set<string> = commonChromeKeys(MSG);

describe('🔴 i18n — "안 한 것"과 "일부러 뺀 것"을 가른다 (V2 구멍/제외 분리)', () => {
  it('스캐너가 실제 화면을 본다 — 대상이 0이 되면 이 가드는 아무것도 보증하지 않는다', () => {
    // 🔴 조준을 좁히는 것은 완화가 아니지만, 대상이 0 이 되면 통과가 무의미하다(하한을 둔다)
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.filter((r) => r.ko > 0).length).toBeGreaterThan(300);
    expect(chrome.size).toBeGreaterThan(50); // common.ts 파싱이 깨지면 반증이 조용히 0이 된다
    expect(rows.filter((r) => SAFETY_PATH.test(r.file) && r.ko > 0).length).toBeGreaterThan(10);
  });

  it('① 등록된 영역 카탈로그는 제외 사유를 헤더에 적는다 (사유 없는 것 = 정확 목록)', () => {
    const cats: string[] = registeredCatalogFiles(MSG);
    expect(cats.length).toBeGreaterThan(15); // registry 파싱이 깨지면 0종이 되어 조용히 통과한다
    const noReason = cats.filter((f) => !hasExclusionReason(readFileSync(join(MSG, f), 'utf8')));
    // 🔴 "중복 등재 금지"·"고빈도 우선" 은 제외 사유가 아니다 — 왜 한국어로 남기는지를 말하지 않는다.
    expect(noReason.sort()).toEqual([...NO_REASON_BASELINE].sort());
  });

  it('② 안전 축 화면의 <T> 미배선 목록이 조용히 늘지 않는다 (미배선 = 누락, 제외가 아니다)', () => {
    const unwired = rows
      .filter((r) => SAFETY_PATH.test(r.file) && r.ko > 0 && r.t === 0)
      .map((r) => r.file)
      .sort();
    expect(unwired).toEqual([...UNWIRED_SAFETY_BASELINE].sort());
  });

  it('③ 🔴 "안전해서 한국어로 뒀다"가 반증되는 화면 — 무해 공통 크롬 키를 생한글로 그린다', () => {
    const falsified = rows
      .filter((r) => SAFETY_PATH.test(r.file) && r.t === 0 && r.frags.some((f) => chrome.has(f)))
      .map((r) => r.file)
      .sort();
    expect(falsified).toEqual([...FALSIFIED_BASELINE].sort());
  });

  it('🔴 대조군 — 배선된 안전 축 화면은 미배선 목록에 들어오지 않는다(성공을 실패로 말하지 않는다)', () => {
    const wired = rows.filter((r) => SAFETY_PATH.test(r.file) && r.ko > 0 && r.t > 0);
    expect(wired.length).toBeGreaterThan(0); // 표본이 0이면 이 대조군은 아무것도 말하지 않는다
    for (const r of wired) expect(UNWIRED_SAFETY_BASELINE).not.toContain(r.file);
  });
});
