/**
 * 🔴 영역 카탈로그 간 사본 키 계측 — **언어별로** 판정한다(2026-09-15 §12-E 재실측).
 *
 * 조회(`tOf`)와 팩 조립(registry.ts 역순 채움)은 둘 다 **언어마다** "그 언어 값이 비어 있지 않은
 * 첫 영역"을 고른다. 그래서 같은 키의 뒤 영역 사본은 언어마다 셋 중 하나다:
 *   · 앞 영역이 그 언어 값을 가졌다 → 이 사본의 그 언어 값은 **화면에 나가지 않는다**
 *   · 앞 영역에 그 언어 값이 없다   → 이 사본이 **그 언어의 실제 출력**이다(지우면 번역이 사라진다)
 *
 * 종전 가드(p5 스펙)는 en/ja/ar 세 값을 **통째로** 비교해 "같은 사본 0"을 말했다. 그런데
 * 사본이 ar 을 안 가진 것(앞 영역은 가짐)도 "값이 다르다"로 셌다 — 그렇게 **죽은 사본 7개**가
 * "값이 다른 사본 91" 안에 숨어 있었다(전부 ar 을 등재하지 않는 checkup 영역). 반대로 사본이
 * 앞 영역에 없는 ar 을 **공급하는** 7개도 같은 91 에 섞여 "죽은 키 후보"처럼 읽혔다.
 *
 * 분류(사본 1개 = 뒤 영역의 키 1개):
 *   · `deadSame`     — 공급하는 언어 없음 · 가진 값이 전부 승자와 같다 → 지워도 출력 불변(0 이어야 한다)
 *   · `deadConflict` — 공급하는 언어 없음 · 승자와 **다른** 값이 있다 → 화면엔 승자 값. 어느 번역이 맞는지는
 *                      사람 검수 몫이라 **지우지 않는다**(지우면 더 나은 번역이 조용히 사라질 수 있다)
 *   · `liveFill`     — 앞 영역에 없는 언어를 이 사본이 공급한다 → 죽은 키가 아니다
 */
import type { MessageCatalog } from './t';

export const CATALOG_COPY_LOCALES = ['en', 'ja', 'ar'] as const;
type CopyLocale = (typeof CATALOG_COPY_LOCALES)[number];

export interface CatalogCopy {
  key: string;
  /** 같은 키를 가진 첫 영역(등록 순서상 우선) */
  first: string;
  /** 이 사본이 들어 있는 뒤 영역 */
  copy: string;
  /** deadConflict: 승자와 값이 다른 언어 · liveFill: 이 사본이 공급하는 언어 */
  locales: CopyLocale[];
}

export interface CatalogCopyReport {
  deadSame: CatalogCopy[];
  deadConflict: CatalogCopy[];
  liveFill: CatalogCopy[];
  /** 영역 합집합 키 수(en/ja/ar 어느 하나라도 가진 키) — 계측이 헛돌지 않았는지의 하한 확인용 */
  totalKeys: number;
}

const val = (c: MessageCatalog, l: CopyLocale, k: string): string | undefined => {
  const v = (c as Record<string, Record<string, string> | undefined>)[l]?.[k];
  return v != null && v !== '' ? v : undefined;
};

export function catalogCopyReport(
  catalogs: readonly { area: string; c: MessageCatalog }[],
): CatalogCopyReport {
  const byKey = new Map<string, { area: string; c: MessageCatalog }[]>();
  for (const entry of catalogs) {
    const declared = new Set<string>();
    for (const l of CATALOG_COPY_LOCALES) {
      for (const k of Object.keys((entry.c as Record<string, Record<string, string> | undefined>)[l] ?? {})) declared.add(k);
    }
    for (const k of declared) {
      const list = byKey.get(k);
      if (list) list.push(entry);
      else byKey.set(k, [entry]);
    }
  }
  const report: CatalogCopyReport = { deadSame: [], deadConflict: [], liveFill: [], totalKeys: byKey.size };
  for (const [key, list] of byKey) {
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      const earlier = list.slice(0, i);
      const supplies: CopyLocale[] = [];
      const differs: CopyLocale[] = [];
      for (const l of CATALOG_COPY_LOCALES) {
        const mine = val(cur.c, l, key);
        if (mine === undefined) continue;
        const winner = earlier.find((e) => val(e.c, l, key) !== undefined);
        if (!winner) supplies.push(l);
        else if (val(winner.c, l, key) !== mine) differs.push(l);
      }
      const base = { key, first: list[0].area, copy: cur.area };
      if (supplies.length) report.liveFill.push({ ...base, locales: supplies });
      else if (differs.length) report.deadConflict.push({ ...base, locales: differs });
      else report.deadSame.push({ ...base, locales: [] });
    }
  }
  return report;
}
