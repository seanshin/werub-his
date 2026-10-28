import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tOf, DASHBOARD_MESSAGES } from '@hospital-run/shared';

/**
 * 🔴 통합 상황판(`/command-center`) · 대시보드(`/dashboard`) UI 크롬 i18n 배선 가드 (P2d · 2026-09-09).
 *
 * 사람 신고: 화면 언어를 English 로 바꿨는데 두 화면 **본문이 전부 한국어로 남는다**.
 * 두 화면은 카탈로그 축(`T`/`tOf`/`useUiLocale`)에 **배선되지 않은 화면**이었다.
 *
 * 이 가드가 못박는 것(전부 반증 가능한 것만):
 *   ① 두 화면 트리에 **JSX 텍스트 노드로 남은 생한글이 0** 이다(기준선 정확 비교 — 여유를 두지 않는다).
 *      리터럴이 `label:`·`name:` 같은 **데이터**로 남는 것은 정상이다(nav.ts 선례 — 데이터 불변·렌더만 `<T>`).
 *   ② 화면이 `<T k="…">` 로 넘기는 **한국어 키가 카탈로그에 실제로 있다**(EN× 거짓 티가 뜨지 않는다).
 *      단, 임상 검수 보류로 **의도적 미등재**인 키는 아래 목록에 사유와 함께 못박는다.
 *   ③ 대조군 — 스캐너가 실제로 파일을 읽었고 `<T>` 사용이 0 이 아니다(검사가 헛돌지 않게).
 *
 * 🔴 재주입 역검증(2026-09-09): ①에 생한글 텍스트 노드 1개를 주입 → 실패 확인 → 복원.
 *    ②에 미등재 키 1개(`@spec전용미등록표본`)를 주입 → 실패 확인 → 복원.
 */
const WEB_SRC = resolve(process.cwd(), 'src');
const SCREENS = [
  join(WEB_SRC, 'app/(main)/command-center'),
  join(WEB_SRC, 'app/(main)/dashboard'),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p) && !/\.spec\./.test(p)) out.push(p);
  }
  return out;
}

/** 주석 제거(🔴 규약상 한국어 주석이 많다 — 훑으면 전부 오탐) */
function stripComments(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const l of src.split('\n')) {
    let s = l;
    if (inBlock) {
      const e = s.indexOf('*/');
      if (e < 0) { out.push(''); continue; }
      s = s.slice(e + 2);
      inBlock = false;
    }
    for (;;) {
      const b = s.indexOf('/*');
      if (b < 0) break;
      const e = s.indexOf('*/', b + 2);
      if (e < 0) { s = s.slice(0, b); inBlock = true; break; }
      s = s.slice(0, b) + s.slice(e + 2);
    }
    out.push(s.replace(/\/\/.*$/, ''));
  }
  return out;
}

/** 문자열 리터럴을 비운 뒤 남는 `>텍스트<` = 화면에 그대로 그려지는 생한글 */
function rawKoreanJsxText(files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (!f.endsWith('.tsx')) continue;
    stripComments(readFileSync(f, 'utf8')).forEach((line, i) => {
      const s = line
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, '``');
      if (!/[가-힣]/.test(s)) return;
      /**
       * 🔴 `<Unit>명</Unit>` 은 **배선된 형태**다 — 단위 부품이 `명@단위` 로 조회해 로케일별 낱말과
       *    띄어쓰기까지 정한다(맨 키 `<T k="명" />` 은 'people' 을 공백 없이 붙여 `1749people` 이 됐다).
       *    이 형태를 생한글로 세면 "배선했더니 가드가 실패한다"가 되어, 다음 사람이 **틀린 형태로 되돌린다**.
       *    (정본 `ui-locale-i18n.plan.md` §10 — 배선이 가드를 죽이면 기준선이 아니라 패턴을 넓힌다.)
       */
      const wired = s.replace(/<(Unit|UnitText)>([^<>{}]*)<\/\1>/g, '<$1/>');
      for (const m of wired.matchAll(/>([^<>{}]*[가-힣][^<>{}]*)</g)) {
        hits.push(`${f.slice(WEB_SRC.length + 1)}:${i + 1}: ${m[1].trim()}`);
      }
    });
  }
  return hits.sort();
}

/**
 * 🔴 **정확 집합**(여유 없음). 0 이 목표이고 지금 0 이다 — 늘면 실패, 줄 수는 없다.
 *    불가피한 잔여가 생기면 여기에 `파일:행: 문구` 와 **이유**를 함께 적는다.
 */
const RAW_KOREAN_BASELINE: string[] = [];

/**
 * 🔴 `<T k="…">` 로 넘기지만 **의도적으로 카탈로그에 넣지 않은 키**(원문 + EN×/JA× 티가 정직하다).
 *    사유 없이 늘리지 않는다 — 사유는 `packages/shared/src/i18n/messages/dashboard.ts` 머리 주석과 같다.
 */
const INTENTIONALLY_UNREGISTERED: Record<string, string> = {
  // 만 단위 축약(`${v/10000}만`) — 자릿수 규약이 언어마다 달라 사람 결정 전까지 원문 유지
  '만': '만 단위 축약 — 자릿수 규약이 언어마다 다르다(사람 결정 대기)',
  // KTAS 등급 문구 — status.ts 가 같은 이유로 KTAS 5종을 이미 뺐다(CTAS/JTAS 등급 문구와 대응이 어긋난다)
  '1급 소생': 'KTAS 등급 문구 — 임상 검수 대기',
  '2급 긴급': 'KTAS 등급 문구 — 임상 검수 대기',
  '3급 응급': 'KTAS 등급 문구 — 임상 검수 대기',
  '4급 준응급': 'KTAS 등급 문구 — 임상 검수 대기',
  '5급 비응급': 'KTAS 등급 문구 — 임상 검수 대기',
};

const FILES = SCREENS.flatMap(walk);

describe('🔴 통합 상황판·대시보드 — UI 크롬 i18n 배선 (P2d)', () => {
  it('대조군 — 스캐너가 두 화면을 실제로 읽었고 <T> 배선이 존재한다', () => {
    expect(FILES.length, '스캔 대상 파일이 0 이면 이 스펙은 헛돈다').toBeGreaterThan(50);
    const wired = FILES.filter((f) => /from '@\/components\/ui\/i18n-text'/.test(readFileSync(f, 'utf8')));
    expect(wired.length, '<T>/useTAttr 을 쓰는 파일이 0 이면 배선이 아예 없는 것이다').toBeGreaterThan(30);
  });

  it('① 두 화면에 JSX 텍스트 노드로 남은 생한글이 기준선과 정확히 같다', () => {
    expect(rawKoreanJsxText(FILES)).toEqual([...RAW_KOREAN_BASELINE].sort());
  });

  it('② <T k="한국어"> 키가 카탈로그에 있다 — 거짓 EN× 티가 뜨지 않는다', () => {
    const used = new Set<string>();
    for (const f of FILES) {
      for (const l of stripComments(readFileSync(f, 'utf8'))) {
        for (const m of l.matchAll(/\bk="([^"]+)"/g)) if (/[가-힣]/.test(m[1])) used.add(m[1]);
        for (const m of l.matchAll(/\btt\('([^']+)'\)/g)) if (/[가-힣]/.test(m[1])) used.add(m[1]);
      }
    }
    expect(used.size, '두 화면에서 쓰는 한국어 키가 0 이면 검사가 헛돈다').toBeGreaterThan(150);
    const missing = [...used]
      .filter((k) => !(k in INTENTIONALLY_UNREGISTERED))
      .filter((k) => tOf(k, 'en').missing)
      .sort();
    expect(missing, '카탈로그에 없는 키(화면에 EN× 티가 뜬다)').toEqual([]);
  });

  it('③ dashboard 카탈로그가 등록돼 있고 두 화면의 키를 갖는다', () => {
    // 🔴 등록부(정본)에 실제로 **등재**됐는지는 소스로 확인한다 — export 만 하고 등재를 빠뜨리면
    //    화면은 빌트인 경로로 찾아내 증상이 없고, 팩만 보는 소비처(검수 관제)에서만 구멍이 난다.
    const registry = readFileSync(
      resolve(process.cwd(), '../../packages/shared/src/i18n/messages/registry.ts'),
      'utf8',
    );
    expect(registry, 'registerCatalog(DASHBOARD_MESSAGES) 가 없다').toMatch(/registerCatalog\(DASHBOARD_MESSAGES/);
    expect(registry, "AREA_CATALOGS 에 'dashboard' 영역이 없다 — 등록부에서 파생하는 소비처가 못 본다")
      .toMatch(/area:\s*'dashboard'/);
    const en = DASHBOARD_MESSAGES.en ?? {};
    // command-center 쪽 · dashboard 쪽 각각 표본
    expect(en['지금 조치 필요'], '상황판 키가 dashboard 카탈로그에 없다').toBeTruthy();
    expect(en['경고 총합'], '상황판 키가 dashboard 카탈로그에 없다').toBeTruthy();
    expect(en['대시보드 편집 중'], '대시보드 키가 dashboard 카탈로그에 없다').toBeTruthy();
    expect(en['위젯 로드 실패'], '대시보드 키가 dashboard 카탈로그에 없다').toBeTruthy();
    // 🔴 세 언어 키 집합 동일(빈 값 0) — 한 언어만 조용히 비는 회귀를 여기서도 막는다
    for (const lang of ['en', 'ja', 'ar'] as const) {
      const t = DASHBOARD_MESSAGES[lang] ?? {};
      expect(Object.keys(t).sort(), `${lang} 키 집합이 en 과 다르다`).toEqual(Object.keys(en).sort());
      expect(Object.entries(t).filter(([, v]) => !v).map(([k]) => k), `${lang} 에 빈 값이 있다`).toEqual([]);
    }
  });

  it('🔴 의도적 미등재는 사유를 갖는다 — "아무도 안 한 것"과 구분한다', () => {
    for (const [k, why] of Object.entries(INTENTIONALLY_UNREGISTERED)) {
      expect(why.length, `${k} 의 미등재 사유가 비어 있다`).toBeGreaterThan(5);
      expect(tOf(k, 'en').missing, `${k} 는 미등재여야 한다(등재됐으면 이 목록에서 빼라)`).toBe(true);
    }
  });
});
