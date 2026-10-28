import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AI_ORIGIN_TEXT, AI_BRAND, AI_DEFAULT_DISCLAIMER } from '@hospital-run/shared';

/**
 * AI 표기 정책 가드 (2026-08-19 결정: **인간에게 정보를 전달하는 것이 최선**).
 *
 * 🔴 실측: AI EP 를 부르는 화면 35개 중 사용자에게 "AI"가 보이는 곳은 5개뿐이었고,
 *    그것이 **의도된 설계**로 문서에 남아 있었다(f7 §6.5 "AI 단독 라벨 금지").
 *    앱마다 표기가 달라 같은 환자가 앱을 바꾸면 다른 이름을 봤다.
 *    AI기본법 §31 은 이용자가 AI 산출물임을 알 수 있게 할 것을 요구한다 — 브랜드는 그 사실을 가린다.
 *
 * 2026-08-19 저녁 — 브랜드 단독 리터럴 **web 102파일·414줄(비주석)** 을 정본 `AI_ORIGIN_TEXT` 참조로 수렴.
 * 이 가드는 **전 범위(src)** 를 스캔한다(처음 판은 3파일만 봤다 — 부분집합 기준선은 가드가 아니다).
 *
 * 재주입하면 실패한다: 화면 어디든 `'WeRU.B 요약'` 같은 브랜드 단독 문구를 넣으면 잡힌다.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
};
const FILES = walk(SRC);
const rel = (f: string) => path.relative(SRC, f);

/** 제품·연동 명칭 — AI 산출물 표기가 아니다(허용 목록은 **정확한 문자열**로만) */
const PRODUCT_NAMES = [/Clinic\(WeRU\.B\)/, /WeRU\.B HIS/, /weve\.io\.kr/];
const NEAR = 14;
const nearHasAi = (line: string, idx: number) => {
  const win = line.slice(Math.max(0, idx - NEAR), idx + AI_BRAND.length + NEAR);
  return /(^|[^A-Za-z_])AI([^A-Za-z_]|$)/.test(win) || /인공지능/.test(win);
};
/** 주석을 벗긴 코드 줄 — 주석 안의 브랜드는 사용자에게 보이지 않는다 */
const stripComments = (line: string) => {
  const t = line.trim();
  if (/^(\/\/|\/\*|\*|\{\/\*)/.test(t)) return '';
  return line.replace(/\{\/\*.*?\*\/\}/g, '').replace(/\/\*.*?\*\//g, '').replace(/\s\/\/.*$/, '');
};

describe('AI 표기 — 브랜드가 "AI" 를 대체하지 않는다', () => {
  it('표기 정본이 브랜드와 "AI" 를 함께 낸다', () => {
    expect(AI_ORIGIN_TEXT).toContain('AI');
    expect(AI_ORIGIN_TEXT).toContain(AI_BRAND);
    expect(AI_DEFAULT_DISCLAIMER).toContain(AI_ORIGIN_TEXT);
  });

  it('🔴 화면 어디에도 브랜드 단독 표기가 없다 — 전 범위(src) 0건', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const r = rel(f);
      if (r === 'app/manifest.ts') continue; // PWA 앱 이름(제품명)
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (!line.includes(AI_BRAND)) return;
        if (PRODUCT_NAMES.some((re) => re.test(line))) return;
        let idx = line.indexOf(AI_BRAND);
        while (idx >= 0) {
          if (!nearHasAi(line, idx)) { offenders.push(`${r}:${i + 1} → ${line.trim().slice(0, 100)}`); break; }
          idx = line.indexOf(AI_BRAND, idx + AI_BRAND.length);
        }
      });
    }
    expect(offenders, `브랜드만 쓰고 "AI"를 밝히지 않는 문구:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔴 mobile·homepage 사본이 shared 정본과 같은 값이다(정본이 둘이면 앱마다 다른 이름을 본다)', () => {
    // 두 앱은 shared 워크스페이스에 의존하지 않아 값을 복제한다 — 갈라지면 여기서 잡힌다
    for (const app of ['mobile', 'homepage']) {
      const f = path.join(__dirname, '..', '..', '..', app, 'src', 'lib', 'ai-brand.ts');
      const src = fs.readFileSync(f, 'utf8');
      const brand = src.match(/export const AI_BRAND = '([^']+)'/)?.[1];
      const origin = src.match(/export const AI_ORIGIN_TEXT = `([^`]+)`/)?.[1]?.replace('${AI_BRAND}', brand ?? '');
      expect(brand, `${app}: AI_BRAND`).toBe(AI_BRAND);
      expect(origin, `${app}: AI_ORIGIN_TEXT`).toBe(AI_ORIGIN_TEXT);
    }
  });

  it('정본 상수를 실제로 쓰고 있다(가드가 헛돌지 않는지 — 분모 확인)', () => {
    const users = FILES.filter((f) => /\bAI_ORIGIN_TEXT\b/.test(fs.readFileSync(f, 'utf8'))).length;
    expect(users, 'AI_ORIGIN_TEXT 를 쓰는 파일이 너무 적다 — 변환이 되돌려졌는가').toBeGreaterThan(80);
  });

  it('🔴 법정 고지가 화면에서 가장 작지 않다 — AI 면책·참고 고지는 11px 미만을 쓰지 않는다(전 범위)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/text-\[(7|8|9|10)px\]/.test(line)) return;
        if (!/(AI_ORIGIN_TEXT\}|\bAI\b|AiDisclaimer|인공지능)/.test(line)) return;
        if (!/(참고|면책|disclaimer|최종 판단|의료행위)/i.test(line)) return;
        offenders.push(`${rel(f)}:${i + 1} → ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders, `면책·AI 고지가 11px 미만으로 남아 있다:\n${offenders.join('\n')}`).toEqual([]);
  });
});
