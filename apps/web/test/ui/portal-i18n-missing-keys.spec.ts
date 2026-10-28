/**
 * 🔴 (2026-09-14 country-language-governance FR-06) 포털 화면이 부르는 키가 포털 카탈로그에 전부 있는가.
 *
 * 포털은 직원 축(`tOf`)과 **다른 카탈로그**(`lib/i18n/portal-messages*`·`trOf`)를 쓴다. 직원 축 가드는
 * 포털 키를 보지 않아서, 포털 화면에 새 문구를 `<PT k>` 로 배선만 하고 카탈로그를 빠뜨리면
 * 영어·중국어·일본어 환자에게 한국어 원문+티가 나가도 어떤 테스트도 실패하지 않았다.
 *
 * 지키는 것:
 *  ① 포털 소스의 리터럴 키(`<PT k="…">`·`<PT k={a ? '…' : '…'}>`·`usePortalTAttr()` 로 받은 함수의 `('…')`)가
 *     en·zh·ja 에서 전부 조회된다 — **의도적 미등재 목록**(사유 필수)만 예외.
 *  ② 의도적 미등재 목록은 실제로 미등재다(등재됐는데 목록에 남으면 목록이 거짓이 된다).
 *  ③ 대조군 — 스캐너가 실제로 키를 읽는다(0 이면 ①은 빈 검사).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { trOf } from '@/lib/i18n/portal-i18n';

const PORTAL_SRC = resolve(process.cwd(), 'src/app/portal');
const LOCALES = ['en', 'zh', 'ja'] as const;

/** 의도적 미등재 — 지어내지 않고 원문+티로 드러내는 키(사유 필수) */
const INTENTIONALLY_UNREGISTERED: Record<string, string> = {
  '검사 전날 자정부터 금식해주세요. 아침 약은 소량의 물과 함께 복용 가능합니다.':
    '임상 지시 상세문 — 오역이 환자 행동을 바꾼다(사람 검수 전 미등재 · portal-locale-tie 가드와 같은 규약)',
  // 2026-10-20 포털 P3 B2 진료 후 요약의 일반 안내 — 복약지도·응급 안내 성격(카탈로그 헤더 '복약지도 성격의 안내문' 규약)
  '처방받은 약은 안내받은 대로 드시고, 임의로 끊거나 양을 바꾸지 마세요.':
    '복약지도 문장 — 오역이 복약 행동을 바꾼다(사람 검수 전 미등재)',
  '증상이 나빠지거나 새로운 증상이 생기면 병원에 문의하세요. 응급 상황이면 119에 연락하세요.':
    '응급 안내 문장 — 나라마다 응급 번호가 달라 번역만으로 맞지 않는다(사람 검수 전 미등재)',
};

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

export function scanPortalKeys(src: string): string[] {
  const code = stripComments(src);
  const keys = new Set<string>();
  for (const m of code.matchAll(/<PT\s+k="([^"]+)"/g)) keys.add(m[1]);
  for (const m of code.matchAll(/<PT\s+k=\{([^}]*)\}/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) keys.add(lit[1]);
  }
  for (const v of [...code.matchAll(/const\s+(\w+)\s*=\s*usePortalTAttr\(\)/g)].map((x) => x[1])) {
    for (const m of code.matchAll(new RegExp(`\\b${v}\\('([^']+)'\\)`, 'g'))) keys.add(m[1]);
  }
  return [...keys].filter((k) => /[가-힣]/.test(k));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(PORTAL_SRC);
const used = new Map<string, string>();
for (const f of files) for (const k of scanPortalKeys(readFileSync(f, 'utf8'))) used.set(k, relative(PORTAL_SRC, f));

describe('포털 i18n — 화면이 부르는 키가 포털 카탈로그에 있다', () => {
  it('③ 대조군 — 스캐너가 세 모양을 읽고 실트리에서 키를 찾는다', () => {
    const fixture = [
      '<PT k="진료 시간" />',
      "<PT k={open ? '열림' : '닫힘'} />",
      'const tAttr = usePortalTAttr();',
      "<input placeholder={tAttr('검색어')} />",
      '// <PT k="주석 속 키" />',
    ].join('\n');
    expect(scanPortalKeys(fixture).sort()).toEqual(['검색어', '닫힘', '열림', '진료 시간']);
    expect(files.length, '포털 소스를 훑지 못했다').toBeGreaterThan(10);
    expect(used.size, '포털 키를 하나도 못 읽었다 — 아래 검사가 헛돈다').toBeGreaterThan(200);
  });

  it('① 모든 리터럴 키가 en·zh·ja 에 등재돼 있다(의도적 미등재 목록 제외)', () => {
    const missing: string[] = [];
    for (const [k, file] of used) {
      if (k in INTENTIONALLY_UNREGISTERED) continue;
      const lost = LOCALES.filter((l) => trOf(k, l).missing);
      if (lost.length) missing.push(`${JSON.stringify(k)} (${lost.join(',')}) @ ${file}`);
    }
    expect(missing, `포털 카탈로그 미등재 — portal-messages 에 등재하거나 의도적 미등재 목록에 사유와 함께 넣는다:\n${missing.join('\n')}`).toEqual([]);
  });

  it('② 의도적 미등재 목록은 사유가 있고 실제로 미등재다', () => {
    for (const [k, reason] of Object.entries(INTENTIONALLY_UNREGISTERED)) {
      expect(reason.trim().length, k).toBeGreaterThan(0);
      expect(LOCALES.every((l) => trOf(k, l).missing), `${k} 가 등재됐다 — 목록에서 뺀다`).toBe(true);
    }
  });
});
