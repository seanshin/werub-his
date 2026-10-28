/**
 * 🔴 Linux Node 22(운영·CI)는 ko-KR 12시간제에 `AM`/`PM` 을 낸다 — 정본이 dayPeriod 조각을 한국어로 되돌리는지.
 * ICU 가 로컬(macOS)에서 이미 `오전` 을 내면 원시 호출만으로는 결함을 재현할 수 없으므로, formatToParts 를 `AM` 으로 강제해 겨눈다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateTimeLocale } from '@/lib/ko-day-period';

const D = new Date(Date.UTC(2026, 0, 1, 3, 5));
const O: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Seoul' };

function forceLatinDayPeriod() {
  const orig = Intl.DateTimeFormat.prototype.formatToParts;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (this: Intl.DateTimeFormat, d?: Date | number) {
    return orig.call(this, d).map((p) => (p.type === 'dayPeriod' ? { ...p, value: /오후|午後|PM/i.test(p.value) ? 'PM' : 'AM' } : p));
  });
}

describe('ko dayPeriod 정본', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ko — ICU 가 PM 을 내도 오후로 그린다', () => {
    forceLatinDayPeriod();
    expect(new Intl.DateTimeFormat('ko-KR', O).formatToParts(D).find((p) => p.type === 'dayPeriod')?.value).toBe('PM'); // 주입 성공 확인
    const s = formatDateTimeLocale(D, 'ko-KR', O);
    expect(s).toContain('오후');
    expect(s).not.toMatch(/AM|PM/);
  });

  it('대조군 — en 은 PM 그대로(ko 밖을 한국어로 바꾸지 않는다)', () => {
    forceLatinDayPeriod();
    const s = formatDateTimeLocale(D, 'en-US', O);
    expect(s).toMatch(/PM/);
    expect(s).not.toMatch(/오전|오후/);
  });

  it('dayPeriod 없는 옵션은 원 포맷과 같다', () => {
    const o: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' };
    expect(formatDateTimeLocale(D, 'ko-KR', o)).toBe(new Intl.DateTimeFormat('ko-KR', o).format(D));
  });
});

describe('정본 소비처 — 시각 조각을 ICU 원시 호출로 그리지 않는다', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  it('ui-settings formatKDate 는 toLocaleTimeString 을 부르지 않는다', () => {
    expect(read('lib/ui-settings.tsx')).not.toMatch(/toLocaleTimeString\(/);
    expect(read('lib/ui-settings.tsx')).toMatch(/formatDateTimeLocale\(/);
  });
  it('🔴 web src 전체에 toLocaleTimeString( 원시 호출이 없다(서버 렌더에서 AM/PM · 하이드레이션 불일치)', () => {
    const root = path.resolve(__dirname, '../../src');
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(p);
      }
      return acc;
    };
    const files = walk(root);
    expect(files.length, '스캔 대상이 사라졌다').toBeGreaterThan(500);
    const hits = files.filter((f) => /\.toLocaleTimeString\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });
  it('portal-date 는 Intl.DateTimeFormat(...).format 을 직접 부르지 않는다', () => {
    expect(read('app/portal/_shared/portal-date.ts')).not.toMatch(/new Intl\.DateTimeFormat\(/);
    expect(read('app/portal/_shared/portal-date.ts')).toMatch(/formatDateTimeLocale\(/);
  });
});

/**
 * 🔴 (2026-09-14 갈래 l) 남은 모양 — `new Intl.DateTimeFormat(` 원시 호출·시각 옵션을 단 `toLocaleString(`/`toLocaleDateString(`,
 * 그리고 격리 빌드 공개 사이트(apps/homepage). 옵션 없는 `date.toLocaleString()` 은 텍스트로 수신자 타입을 못 가르므로
 * 이 가드 밖이다(2026-09-14 타입 검사기 전수 스캔: web·api·homepage 에서 Date 수신자 toLocaleString 0 · toLocaleDateString 은 시각 옵션 0).
 */
describe('남은 dayPeriod 경로 — Intl 원시·시각 옵션·공개 사이트 사본', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const walk = (d: string, acc: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc); }
      else if (/\.(tsx?|jsx?)$/.test(e.name)) acc.push(p);
    }
    return acc;
  };
  const WEB = path.resolve(__dirname, '../../src');
  const HP = path.resolve(__dirname, '../../../homepage/src');
  const CANON = path.resolve(__dirname, '../../../../packages/shared/src/locale-time.ts');
  const HP_COPY = path.join(HP, 'lib/locale-time.ts');

  /** 시각 필드를 옵션에 단 로케일 포맷 호출(여러 줄 옵션 포함) — 괄호 짝을 맞춰 인자 전체를 본다 */
  const timeOptionCalls = (src: string): string[] => {
    const out: string[] = [];
    const re = /\.(toLocaleString|toLocaleDateString)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let k = re.lastIndex;
      let depth = 1;
      while (depth && k < src.length) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') depth--;
        k++;
      }
      const args = src.slice(re.lastIndex, k - 1);
      if (/\b(hour|dayPeriod|timeStyle)\s*:/.test(args)) out.push(`${m[1]}(${args.replace(/\s+/g, ' ').slice(0, 60)})`);
    }
    return out;
  };
  const scan = (root: string, skip: (f: string) => boolean = () => false) =>
    walk(root).filter((f) => !skip(f)).flatMap((f) => {
      const s = strip(fs.readFileSync(f, 'utf8'));
      const hits = [
        ...(/new Intl\.DateTimeFormat\(/.test(s) ? ['new Intl.DateTimeFormat('] : []),
        ...(/\.toLocaleTimeString\(/.test(s) ? ['toLocaleTimeString('] : []),
        ...timeOptionCalls(s),
      ];
      return hits.map((h) => `${path.relative(root, f)} ${h}`);
    });

  it('검출기 대조군 — 여러 줄 시각 옵션을 실제로 잡고 숫자·날짜만 옵션은 잡지 않는다(못 잡으면 아래 0 은 빈 검사)', () => {
    expect(timeOptionCalls("d.toLocaleString('ko-KR', {\n  hour: '2-digit',\n  minute: '2-digit' })")).toHaveLength(1);
    expect(timeOptionCalls("n.toLocaleString('ko-KR', { maximumFractionDigits: 0 })")).toHaveLength(0);
    expect(timeOptionCalls("d.toLocaleDateString('ko', { month: 'long', day: 'numeric' })")).toHaveLength(0);
  });

  it('🔴 web src — Intl.DateTimeFormat 원시·시각 옵션 toLocaleString 0', () => {
    expect(walk(WEB).length, '스캔 대상이 사라졌다').toBeGreaterThan(500);
    expect(scan(WEB)).toEqual([]);
  });

  it('🔴 apps/homepage src — 시각 원시 호출 0(사본 정본 파일만 예외)', () => {
    expect(walk(HP).length, '공개 사이트 스캔 대상이 사라졌다').toBeGreaterThan(20);
    expect(scan(HP, (f) => f === HP_COPY)).toEqual([]);
  });

  it('🔴 apps/homepage locale-time 사본이 shared 정본과 한 글자도 다르지 않다', () => {
    const copy = fs.readFileSync(HP_COPY, 'utf8').replace(/^\/\* eslint-disable \*\/\n(?:\/\/.*\n)+/, '');
    expect(copy, '공개 사이트 사본이 shared 정본과 갈라졌다 — 정본을 고쳤으면 머리말 아래로 그대로 복사하라').toBe(fs.readFileSync(CANON, 'utf8'));
  });
});
