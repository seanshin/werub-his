import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tOf } from '@hospital-run/shared';
import { CLINICAL3_MESSAGES } from '@hospital-run/shared/dist/i18n/messages/clinical3';
// 🔴 카탈로그 목록은 정본에서 파생한다(수기 배열은 낡는다 — P2b 에서 8종이 시야 밖이었다)
import { AREA_CATALOGS } from '@hospital-run/shared/dist/i18n/messages/registry';
// 계측 규칙 정본은 스캐너 하나 — 수치를 두 곳에 적으면 갈라진다(`scripts/i18n-unwired-scan.mjs`).
import { stripComments, stripI18nKeys } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **임상 진료 화면(clinical3) UI 언어 배선 가드** — 2026-09-09 P3 라운드.
 *
 * 무엇을 못박는가:
 *  (a) 소유 10화면 + 전용 컴포넌트 2의 **한글 JSX 텍스트 노드 잔여 수**를 정확 동결(전부 0).
 *      늘면 실패(신규 하드코딩), 줄면 기준선을 낮춘다. 여유를 두지 않는다 —
 *      이 저장소는 기준선에 여유를 뒀다가 재주입 1건을 그대로 통과시킨 적이 있다.
 *  (b) 화면마다 **대표 키가 카탈로그에 실제로 등재**돼 있다(배선만 하고 카탈로그가 빈 상태를 막는다).
 *  (c) 🔴 **죽은 키 0** — 이 라운드의 핵심 가드다. `tOf` 는 **먼저 등록된 카탈로그가 이기는** 구조라,
 *      다른 영역에 이미 있는 원문을 clinical3 에 또 적으면 그 정의는 영원히 조회되지 않는다.
 *      "만든 것 ≠ 소비처가 쓰는 것"의 카탈로그판이라, 실행(`tOf`)으로 판정한다(수기 대조 금지).
 *
 * 🔴 대조군을 함께 둔다 — 성공을 실패로 말하지 않기 위해(측정 대상이 0이면 통과가 무의미하다).
 */
const ROOT = resolve(process.cwd(), '../..');
const APP = join(ROOT, 'apps/web/src/app');

/** 소유 화면 — 경로는 app/ 기준. 대표 키는 그 화면에서 실제로 쓰는 원문이다. */
const OWNED: { file: string; sample: string }[] = [
  { file: '(main)/orders/page.tsx', sample: '처방 관리 (CPOE)' },
  { file: '(main)/orders/OrderSignLogPanel.tsx', sample: '아직 봉인된 행위가 없습니다' },
  { file: '(main)/clinical-pathway/page.tsx', sample: '표준 진료 경로 관리 및 환자 적용 현황' },
  { file: '(main)/cssd/page.tsx', sample: '중앙공급실 (CSSD)' },
  { file: '(main)/blood-bank/page.tsx', sample: '혈액 출고 — 적합 유닛 자동매칭' },
  { file: '(main)/blood-bank/BloodBankEnhancement.tsx', sample: '활성 대량수혈 프로토콜(MTP)' },
  { file: '(main)/telehealth/page.tsx', sample: '원격진료 (Telehealth)' },
  { file: '(main)/remote-consult/page.tsx', sample: '비대면 진료 관리' },
  { file: '(main)/surgery/[id]/page.tsx', sample: '수술 전 확인 (Time-out)' },
  { file: '(main)/orthopedics/page.tsx', sample: '정형외과 대시보드' },
  { file: '(main)/chemo/page.tsx', sample: '항암 치료 (사이클 엔진)' },
  { file: '(main)/diagnostics/page.tsx', sample: '생리기능검사 의뢰 · 대기 · 결과 관리' },
];

/**
 * 2026-09-09 실측 — 한글 JSX 텍스트 노드 잔여(배선 후). 전부 0.
 * 🔴 0 이 목표가 아니라 **실측값**이다. 남는 것이 생기면 그 이유를 여기 적고 수를 올리는 것이 아니라,
 *    남길 이유가 있는지부터 판정한다(보간 문자열·저장값은 애초에 이 계측에 잡히지 않는다).
 */
const JSX_KO_BASELINE: Record<string, number> = Object.fromEntries(OWNED.map((o) => [o.file, 0]));

/** JSX 텍스트 노드만 — 문자열 리터럴(Record 값·비교값)은 제외한다(계측 규칙 §③(a)) */
function jsxKoFragments(src: string): string[] {
  const noc = stripI18nKeys(stripComments(src));
  const out = new Set<string>();
  for (const m of noc.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) {
    const s = m[1].trim();
    if (s) out.add(s);
  }
  return [...out];
}

const read = (f: string) => readFileSync(join(APP, f), 'utf8');

describe('🔴 clinical3 — 임상 진료 화면 UI 언어 배선', () => {
  it('대조군 — 소유 화면이 실제로 존재하고 <T>/tAttr 로 배선돼 있다(대상 0이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(OWNED.length).toBe(12);
    for (const { file } of OWNED) {
      const noc = stripComments(read(file));
      const wired = (noc.match(/<T[\s>]/g) || []).length + (noc.match(/tAttr\(/g) || []).length;
      expect(wired, `${file} 이 배선돼 있지 않다`).toBeGreaterThan(0);
    }
  });

  it('(a) 한글 JSX 텍스트 노드 잔여가 기준선과 정확히 일치한다(늘면 실패·줄면 기준선을 낮춘다)', () => {
    const actual: Record<string, number> = {};
    for (const { file } of OWNED) actual[file] = jsxKoFragments(read(file)).length;
    expect(actual).toEqual(JSX_KO_BASELINE);
  });

  it('(b) 화면마다 대표 키가 clinical3 카탈로그에 등재돼 있다(3언어 모두)', () => {
    for (const { file, sample } of OWNED) {
      for (const lang of ['en', 'ja', 'ar'] as const) {
        const v = CLINICAL3_MESSAGES[lang]?.[sample];
        expect(v, `${file} 의 대표 키 '${sample}' 가 ${lang} 에 없다`).toBeTruthy();
      }
    }
  });

  it('(b-대조군) 아무도 등재할 수 없는 표본 키는 미등록으로 나온다(등재 검사가 항상 참이 아니다)', () => {
    // 🔴 표본은 **누구도 등재할 수 없는 값**으로 둔다 — 종전 라운드에서 표본 키를 실제로 등재해
    //    계약 검사가 깨진 사고가 있었다.
    expect(CLINICAL3_MESSAGES.en?.['@spec전용미등록표본clinical3']).toBeUndefined();
    expect(tOf('@spec전용미등록표본clinical3', 'en').missing).toBe(true);
  });

  it('🔴 (c) 죽은 키 0 — clinical3 의 어떤 키도 먼저 등록된 카탈로그에 가려지지 않는다', () => {
    const keys = Object.keys(CLINICAL3_MESSAGES.en ?? {});
    expect(keys.length).toBeGreaterThan(300); // 카탈로그가 비면 이 검사는 조용히 통과한다
    /**
     * 🔴 **번역값 비교로 판정하지 않는다.** 처음엔 `tOf(k) !== clinical3[k]` 로 썼다가
     *    재주입에서 통과해 버렸다 — `취소`(common='Cancel')를 clinical3 에 'Cancel' 로 다시 적으면
     *    **값이 같아서** 가려진 사실이 보이지 않는다(다른 이유로 통과한 가드).
     *    판정은 **존재 여부**로 한다: 다른 등록 카탈로그에 그 원문이 있으면 clinical3 정의는 죽는다
     *    (clinical3 는 등록 순서상 맨 뒤다). 목록은 `AREA_CATALOGS` 정본에서 파생한다 — 수기 배열은 낡는다.
     */
    /**
     * 🔴 **객체 동일성으로 자기 자신을 제외하면 안 된다** — 이 스펙은 `CLINICAL3_MESSAGES` 를 dist 딥임포트로,
     *    `AREA_CATALOGS` 는 배럴로 가져온다. 두 모듈 인스턴스가 달라 `a.c !== CLINICAL3_MESSAGES` 가 항상 참이 되고,
     *    **자기 키 682개 전부가 "죽은 키"로 잡혔다**(2026-09-09 실측). 정본이 주는 이름(`area`)으로 가른다.
     * 🔴 그리고 죽은 키는 **등록 순서상 앞선** 카탈로그가 같은 키를 가질 때만이다 — 뒤에 오는 카탈로그는
     *    이 파일에 지지 않는다(registry 는 앞이 이긴다).
     */
    const selfIdx = AREA_CATALOGS.findIndex((a) => a.area === 'clinical3');
    expect(selfIdx, 'clinical3 이 등록부에 없다 — 조립 누락이면 화면은 되는데 팩이 빈다').toBeGreaterThan(-1);
    const others = AREA_CATALOGS.slice(0, selfIdx);
    expect(others.length).toBeGreaterThan(15); // 정본 파싱이 깨지면 조용히 0종이 된다
    const dead = keys.filter((k) => others.some((a) => a.c.en?.[k] != null));
    expect(dead, `다른 카탈로그가 이기는 키 ${dead.length}개 — 여기 정의는 죽은 정의다`).toEqual([]);
    // 대조군 — 조회가 실제로 clinical3 값을 돌려준다(등재만 하고 조회는 다른 데서 오는 상태 방지)
    expect(tOf('항암 치료 (사이클 엔진)', 'en').text).toBe(CLINICAL3_MESSAGES.en!['항암 치료 (사이클 엔진)']);
  });

  it('🔴 세 언어 키 집합이 같고 빈 값이 없다(한 언어만 조용히 비는 회귀 방지)', () => {
    const en = Object.keys(CLINICAL3_MESSAGES.en ?? {}).sort();
    const ja = Object.keys(CLINICAL3_MESSAGES.ja ?? {}).sort();
    const ar = Object.keys(CLINICAL3_MESSAGES.ar ?? {}).sort();
    expect(ja).toEqual(en);
    expect(ar).toEqual(en);
    for (const k of en) {
      for (const lang of ['en', 'ja', 'ar'] as const) {
        expect(CLINICAL3_MESSAGES[lang]![k]?.trim(), `${lang}/${k} 가 빈 값`).toBeTruthy();
      }
    }
  });

  it('🔴 저장·전송되는 값은 번역 대상이 아니다 — <option> 이 표시 텍스트를 값으로 쓰지 않는다', () => {
    // value 없는 <option> 은 **표시 텍스트가 곧 저장값**이라, 번역되는 순간 서버로 가는 데이터가 갈라진다.
    // (실측: 비대면 처방 빈도 select 가 `1일 3회` 텍스트를 값으로 써 총량 계산 `dosesPerDay` 와 짝이었다.)
    for (const { file } of OWNED) {
      const noc = stripComments(read(file));
      for (const m of noc.matchAll(/<option(?![^>]*\bvalue=)[^>]*>([^<]*)</g)) {
        expect(m[1], `${file}: value 없는 <option> 이 번역 부품을 담고 있다`).not.toMatch(/tAttr\(|<T\b/);
      }
    }
  });
});
