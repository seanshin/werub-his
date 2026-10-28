/**
 * 🔴 (2026-09-13) Linux Node 22(운영 v22.22.1)는 ko-KR 12시간제에 `AM`/`PM` 을 낸다 — 예약 알림·AI 도구 결과가 `PM 03:30` 으로 나갔다.
 * 지키는 것: ① 정본(shared `locale-time`)이 ICU 의 라틴 dayPeriod 를 한국어로 되돌린다(주입으로 겨눔 — macOS ICU 는 이미 `오전` 이라 원시 호출로는 재현 불가)
 *           ② ko 밖은 바꾸지 않는다(대조군) ③ 기본 옵션이 네이티브와 같다 ④ API 소스에 `toLocaleTimeString(` 원시 호출 0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localeDateTimeText, localeTimeText } from '@hospital-run/shared';

const D = new Date(Date.UTC(2026, 0, 1, 6, 30));
const TZ = { timeZone: 'Asia/Seoul' } as const;

function forceLatinDayPeriod() {
  const orig = Intl.DateTimeFormat.prototype.formatToParts;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (this: Intl.DateTimeFormat, d?: Date | number) {
    return orig.call(this, d).map((p) => (p.type === 'dayPeriod' ? { ...p, value: /오후|PM/i.test(p.value) ? 'PM' : 'AM' } : p));
  });
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('ko dayPeriod 정본(서버 문구)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('① ICU 가 PM 을 내도 오후', () => {
    forceLatinDayPeriod();
    expect(new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', ...TZ }).formatToParts(D).find((p) => p.type === 'dayPeriod')?.value).toBe('PM');
    const t = localeTimeText(D, 'ko-KR', { hour: '2-digit', minute: '2-digit', ...TZ });
    expect(t).toContain('오후');
    expect(t).not.toMatch(/AM|PM/);
    expect(localeDateTimeText(D, 'ko-KR', TZ)).toContain('오후');
  });

  it('② 대조군 — en 은 PM 그대로', () => {
    forceLatinDayPeriod();
    expect(localeTimeText(D, 'en-US', { hour: '2-digit', minute: '2-digit', ...TZ })).toMatch(/PM/);
  });

  it('③ 기본 옵션이 네이티브 toLocale* 과 같다(24시간제 지정 포함)', () => {
    const ko = (x: string) => x.replace('AM', '오전').replace('PM', '오후'); // Linux ICU 는 AM/PM · macOS 는 오전/오후 — 양쪽에서 같은 기대값
    expect(localeDateTimeText(D, 'ko-KR', TZ)).toBe(ko(D.toLocaleString('ko-KR', TZ)));
    expect(localeTimeText(D, 'ko-KR', TZ)).toBe(ko(D.toLocaleTimeString('ko-KR', TZ)));
    const h23 = { hour: '2-digit', minute: '2-digit', hour12: false, ...TZ } as const;
    expect(localeTimeText(D, 'ko-KR', h23)).toBe(D.toLocaleTimeString('ko-KR', h23));
    expect(localeDateTimeText(D, 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric', ...TZ })).toBe(D.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', ...TZ }));
  });

  it('④ API 소스에 toLocaleTimeString( 원시 호출이 없다', () => {
    const root = path.resolve(__dirname, '../../src');
    const hits = walk(root).filter((f) => /\.toLocaleTimeString\(/.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });

  /**
   * ⑤ (2026-09-14 갈래 l) 남은 모양 — `new Intl.DateTimeFormat(` 원시·시각 옵션을 단 toLocaleString/toLocaleDateString(여러 줄 포함).
   * 옵션 없는 `date.toLocaleString()` 은 텍스트로 수신자 타입을 못 가르므로 이 가드 밖이다
   * (2026-09-14 타입 검사기 전수 스캔: Date·any(시각 이름) 수신자 toLocaleString 0 · toLocaleDateString 20 은 전부 시각 옵션 없음).
   */
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
      if (/\b(hour|dayPeriod|timeStyle)\s*:/.test(src.slice(re.lastIndex, k - 1))) out.push(m[1]);
    }
    return out;
  };

  it('⑤-대조군 검출기가 여러 줄 시각 옵션은 잡고 숫자·날짜만 옵션은 잡지 않는다', () => {
    expect(timeOptionCalls("d.toLocaleString('ko-KR', {\n  hour: '2-digit',\n})")).toHaveLength(1);
    expect(timeOptionCalls("n.toLocaleString('ko-KR', { maximumFractionDigits: 0 })")).toHaveLength(0);
    expect(timeOptionCalls("d.toLocaleDateString('ko', { month: 'long' })")).toHaveLength(0);
  });

  it('⑤ API 소스에 Intl.DateTimeFormat 원시·시각 옵션 toLocaleString 이 없다', () => {
    const root = path.resolve(__dirname, '../../src');
    const hits = walk(root).flatMap((f) => {
      const s = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      return [...(/new Intl\.DateTimeFormat\(/.test(s) ? ['new Intl.DateTimeFormat('] : []), ...timeOptionCalls(s)].map((h) => `${path.relative(root, f)} ${h}`);
    });
    expect(hits).toEqual([]);
  });
});
