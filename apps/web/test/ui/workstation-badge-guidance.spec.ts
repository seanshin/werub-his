import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 워크스테이션 선택기가 **목적을 말하지 않았다**(2026-08-26 사람 신고).
 *    `WS-DIAG-CARDIAC` 같은 코드만 나열돼 무엇을 고르는지, 고르면 뭐가 달라지는지 알 수 없었다.
 *
 * 🔴 안내는 **실제로 달라지는 것만** 적는다 — 실측상 이 선택이 바꾸는 것은 인쇄 라우팅 하나다.
 *    워크리스트·권한이 바뀐다고 적으면 화면이 없는 능력을 주장하게 된다.
 */
const F = join(process.cwd(), 'src/components/layout/WorkstationBadge.tsx');

describe('워크스테이션 선택기는 목적을 말한다', () => {
  const src = readFileSync(F, 'utf8');

  it('무엇을 고르는 것인지 사람 말로 적혀 있다', () => {
    expect(src).toContain('이 컴퓨터가 놓인 자리');
  });

  it('고르면 무엇이 달라지는지 적혀 있다(인쇄 라우팅)', () => {
    expect(src).toMatch(/라벨.*인쇄|인쇄가 그 자리 프린터/);
  });

  it('🔴 바뀌지 않는 것도 말한다 — 넓혀 말하지 않는다', () => {
    expect(src).toContain('환자 목록·권한은 바뀌지 않습니다');
  });

  it('🔴 자리는 정했는데 프린터가 없으면 그 사실을 말한다(인쇄가 파일로 떨어진다)', () => {
    expect(src).toContain('등록된 프린터가 없습니다');
  });

  it('선택이 이 브라우저에만 남는다는 한계를 밝힌다', () => {
    expect(src).toContain('이 브라우저에만');
  });

  it('목록이 길면 이름·부서로 찾을 수 있다', () => {
    expect(src).toMatch(/picks\.length > \d+/);
    expect(src).toContain('자리 이름·부서로 찾기');
  });

  it('🔴 사람이 찾는 이름을 앞에 둔다(코드는 보조)', () => {
    const item = src.slice(src.indexOf('{p.label}') - 200, src.indexOf('{p.label}') + 200);
    expect(item.indexOf('{p.label}')).toBeLessThan(item.indexOf('{p.code}'));
  });

  it('대조군 — 코드를 지우지는 않았다(전산 문의 때 필요하다)', () => {
    expect(src).toContain('{p.code}');
  });
});
