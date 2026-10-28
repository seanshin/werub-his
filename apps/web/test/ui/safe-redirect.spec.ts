import { describe, it, expect } from 'vitest';
import { toInternalPath } from '../../src/lib/safe-redirect';

/**
 * 🔴 `/login?redirect=` 가 검증 없이 `router.push()` 로 들어가고 있었다(요청서 WEB-SEC-01).
 *    로그인 **직후**의 이동이라 사용자는 병원 사이트가 보낸 화면이라 믿는다.
 */
describe('로그인 후 이동은 내부 경로만', () => {
  it.each([
    ['https://evil.example/login', '절대 URL'],
    ['//evil.example', '프로토콜 상대'],
    ['/\\evil.example', '역슬래시(일부 브라우저가 // 로 해석)'],
    ['javascript:alert(1)', '스킴'],
    ['%2f%2fevil.example', '인코딩된 프로토콜 상대'],
    ['%68ttps://evil.example', '인코딩된 스킴'],
    ['/dashboard\nSet-Cookie: x=1', '제어문자'],
    ['/dash board', '공백'],
    ['dashboard', '상대경로'],
    ['', '빈 값'],
  ])('%s 거부 (%s)', (input) => {
    expect(toInternalPath(input)).toBeNull();
  });

  /** 대조군 — 정상 내부 경로까지 막으면 로그인 후 아무 데도 못 간다 */
  it.each([
    '/dashboard',
    '/command-center',
    '/patients/00000000-0000-4000-8000-000000000001',
    '/imaging?tab=orders',
    '/admin/data-quality#imaging',
  ])('%s 는 통과', (input) => {
    expect(toInternalPath(input)).toBe(input);
  });

  it('null·undefined 는 이동하지 않는다(기본 진입점으로 간다)', () => {
    expect(toInternalPath(null)).toBeNull();
    expect(toInternalPath(undefined)).toBeNull();
  });
});
