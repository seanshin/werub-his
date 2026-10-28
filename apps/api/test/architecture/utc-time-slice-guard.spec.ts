import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * 🔴 **UTC 에서 시각을 잘라 사람에게 보여주지 않는다** (2026-09-11 · 정본 `common/day-range.ts` `localDateTimeKey`).
 *
 * `toISOString().slice(0,16)` · `.slice(11,16)` 는 **UTC** 다. 실측으로 나온 자리:
 *  - go-live 백업 판정: 03:00 KST 백업을 "2026-09-10 18:00" 으로
 *  - 검체·오더 라벨(ZPL): 인쇄 시각이 9시간 전으로 **인쇄물에** 박힘
 *  - 포털 발급 문서: 환자에게 주는 문서의 발급 시각이 9시간 전
 *  - 위급값 통보 시각(데이터 품질)·파트너 알림 시각
 *  - CRM 대행 예약 슬롯: 범위는 +09:00 인데 예약 시각은 UTC `HH:mm` 로 비교 → **예약된 자리를 빈 자리로**
 *
 * 허용 목록은 **이유와 함께** 적는다 — 사람이 읽지 않는 식별자이거나, 오프셋을 명시적으로 더하고 표기한 자리.
 * 파일 순회는 `readdirSync` 재귀(🔴 `fs.globSync` 는 Node 22+ — CI 20 에서 가드가 죽었던 전례).
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const UTC_TIME_SLICE = /toISOString\(\)\s*\.\s*(?:slice|substring|substr)\(\s*(?:11\b|0\s*,\s*1[3-9]\b)/g;

const ALLOWED: Record<string, { count: number; why: string }> = {
  'modules/compounding/compounding.service.ts': { count: 1, why: '+9h 를 명시적으로 더하고 " KST" 를 붙여 표기한다(시간대가 문자열에 있다)' },
  'modules/ess/ess.service.ts': { count: 1, why: 'ERP 로 가는 멱등키(att:{사번}:{분}:{type}) — 사람이 읽지 않고 일관성만 필요. 바꾸면 ERP 쪽 키 계약이 깨진다' },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 주석 줄은 뺀다 — 이 규칙을 설명하는 주석이 검사에 걸리면 가드가 다른 이유로 실패/통과한다 */
function hits(file: string): number {
  const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  return (code.match(UTC_TIME_SLICE) ?? []).length;
}

describe('🔴 UTC 시각 절단 — 사람이 읽는 자리에 쓰지 않는다', () => {
  const files = walk(SRC);
  const found = new Map<string, number>();
  for (const f of files) {
    const n = hits(f);
    if (n) found.set(path.relative(SRC, f).split(path.sep).join('/'), n);
  }

  it('대조군 — 소스를 실제로 훑었다(패턴이 헛돌지 않는다)', () => {
    expect(files.length, 'src 파일을 못 찾았다').toBeGreaterThan(500);
    expect(found.size, '허용 목록조차 안 걸린다 — 정규식이 헛돈다').toBeGreaterThan(0);
  });

  it('허용 목록 밖에 UTC 시각 절단이 없다 — 표시는 localDateTimeKey 로', () => {
    const bad = [...found.entries()].filter(([f, n]) => !ALLOWED[f] || n > ALLOWED[f].count);
    expect(bad, `UTC 에서 시각을 잘라 쓴다 — 사람에게 보이면 9시간 어긋난다. common/day-range.ts localDateTimeKey 를 쓰거나, 정말 식별자라면 이유와 함께 ALLOWED 에 적어라:\n${bad.map(([f, n]) => `  ${f} (${n})`).join('\n')}`).toEqual([]);
  });

  it('허용 목록이 썩지 않는다 — 없어진 자리는 목록에서도 뺀다(여유를 두면 신규 위반을 흡수한다)', () => {
    const stale = Object.entries(ALLOWED).filter(([f, a]) => (found.get(f) ?? 0) < a.count);
    expect(stale.map(([f]) => f)).toEqual([]);
  });
});
