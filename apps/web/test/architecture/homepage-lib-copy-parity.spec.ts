/**
 * 🔴 web lib 정본 ↔ apps/homepage 사본 드리프트 가드 (2026-09-01 · 환자 앱/공개 사이트 축).
 *
 * `apps/homepage` 는 격리 빌드(자체 `npm install`)라 `apps/web`·`@hospital-run/shared` 를
 * 참조할 수 없어 필요한 lib 을 **사본**으로 둔다. 사본은 갈라진다 — 이 저장소에서 반복해서 나온 유형이다
 * (v4.12.0: "web 만 고치면 실공개 사이트 hospital.example.org 은 죽은 채"). CMS 표현(`cms-style-preset`)과
 * AI 표기(`ai-brand`)는 이미 대조 가드가 있으나 `sanitize`·`public-fetch` 는 없었다.
 *
 * 🔴 특히 `sanitize` 는 **공개 사이트의 XSS 방어**(dangerouslySetInnerHTML 앞에서 호출)라,
 *    web 정본에서 취약점을 고쳐도 사본이 뒤처지면 **공개 사이트만 뚫린다.**
 *
 * 정본은 `apps/web/src/lib/*` · 사본은 `apps/homepage/src/lib/*`. 두 본문이 한 글자라도 다르면 실패한다.
 * 재주입: 사본에서 한 글자를 바꾸면(예: 허용 태그 추가) 이 테스트가 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const WEB_LIB = join(__dirname, '..', '..', 'src', 'lib');
const HP_LIB = join(__dirname, '..', '..', '..', 'homepage', 'src', 'lib');

/** 사본 머리말(대조 안내 주석)만 걷어낸다 — 본문은 한 글자도 달라선 안 된다. */
const stripCopyHeader = (s: string) => s.replace(/^\/\* eslint-disable \*\/\n(?:\/\/.*\n)+/, '');

const COPIES = ['sanitize.ts', 'public-fetch.ts', 'clinic-hours.ts'] as const;

describe('web lib 정본 ↔ apps/homepage 사본 (격리 빌드 드리프트)', () => {
  it('대조 대상이 실제로 존재한다(스캔이 비면 가드가 아니다)', () => {
    for (const f of COPIES) {
      expect(existsSync(join(WEB_LIB, f)), `web 정본 없음: ${f}`).toBe(true);
      expect(existsSync(join(HP_LIB, f)), `homepage 사본 없음: ${f}`).toBe(true);
    }
  });

  for (const f of COPIES) {
    it(`🔴 ${f} 사본이 web 정본과 한 글자도 다르지 않다`, () => {
      const canon = readFileSync(join(WEB_LIB, f), 'utf8');
      const copy = stripCopyHeader(readFileSync(join(HP_LIB, f), 'utf8'));
      expect(
        copy,
        `apps/homepage 사본 ${f} 이 web 정본과 갈라졌다 — 정본을 고쳤으면 사본에 그대로 복사하라`,
      ).toBe(canon);
    });
  }
});
