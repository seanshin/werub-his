import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `QueryErrorFallback` 을 **import 만 하고 렌더하지 않는 화면이 없다.**
 *
 * 🔴 2026-09-02 실측: 커밋 `dd45608a` 는 "환자 차트 탭 33개 에러 처리 일괄 적용 — API 실패 시
 *    빈 화면 → 에러 메시지 + 재시도 버튼"이라 적었는데, 17개 파일에는 **import 와
 *    `isError/error/refetch` 구조분해만** 들어가고 **JSX 렌더가 없었다.**
 *    그래서 알레르기·투약·검사결과·문제목록·간호기록 탭이 403/500 에도
 *    **"등록된 알레르기가 없습니다"** 를 그렸다 — 조회 실패를 "없음"으로 번역하는 코드다.
 *    (실행하지 않고 성공 상태만 기록 = P16. 커밋 메시지가 사실이 아니었다.)
 *
 * 🔴 이 가드는 **import 를 세지 않는다** — import 는 사용 검사를 대신 통과시킨다(이 저장소의 반복 함정).
 *    주석·import 를 걷어낸 뒤 `<QueryErrorFallback` 사용만 센다.
 */
const APP = join(process.cwd(), 'src', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (f.endsWith('.tsx')) out.push(f);
  }
  return out;
}
const rel = (f: string) => f.slice(APP.length + 1);
const body = (s: string) =>
  s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?$/gm, '')
   .replace(/\/\*[\s\S]*?\*\//g, '')
   .replace(/^\s*\/\/.*$/gm, '');

/**
 * 아직 렌더가 없는 자리 — **줄이는 것만 허용**한다.
 * QueueTab 은 `isLoading` 삼항이 다른 컴포넌트 안이라 기계 주입이 안 되는 자리다(수동 회수 대상).
 */
const KNOWN_UNRENDERED = ['(main)/reception/components/QueueTab.tsx'];

describe('QueryErrorFallback — import 만 하고 안 그리는 화면이 없다', () => {
  const files = walk(APP);
  const offenders = files.filter((f) => {
    const raw = readFileSync(f, 'utf8');
    return /import[^;]*QueryErrorFallback[^;]*from/.test(raw) && !/<QueryErrorFallback/.test(body(raw));
  }).map(rel);

  it('대조군: 실제로 렌더하는 화면이 충분히 많다(스캔이 헛돌지 않는다)', () => {
    const rendered = files.filter((f) => /<QueryErrorFallback/.test(body(readFileSync(f, 'utf8'))));
    expect(rendered.length).toBeGreaterThan(250);
  });

  it('🔴 import 만 있고 렌더가 없는 파일이 알려진 것 외에 없다', () => {
    const unexpected = offenders.filter((f) => !KNOWN_UNRENDERED.includes(f));
    expect(unexpected, `조회 실패를 "없음"으로 그리게 된다:\n${unexpected.join('\n')}`).toEqual([]);
  });

  it('알려진 미회수 목록이 늘어나지 않는다(줄이는 것만 허용)', () => {
    expect(offenders.length).toBeLessThanOrEqual(KNOWN_UNRENDERED.length);
  });
});
