import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { twinCdsView } from './twin-cds';

/**
 * 🔴 r3 B2 — 트윈 CDS 0장을 "위험 없음"으로 그리지 않는다.
 * 응답 모양은 서버 정본(`twin.controller.ts` `TwinCdsResult`: `{ cards, status, reason, upstreamStatus? }`) 그대로.
 */
describe('twinCdsView', () => {
  it('🔴 서버가 UNAVAILABLE(401·5xx·차단)을 말하면 확인 불가 — 0장을 "없음"으로 읽지 않는다', () => {
    expect(twinCdsView({ data: { cards: [], status: 'UNAVAILABLE', reason: 'UPSTREAM_ERROR', upstreamStatus: 401 }, isError: false })).toBe('UNCHECKED');
  });
  it('🔴 조회 자체가 실패하면 확인 불가', () => {
    expect(twinCdsView({ data: undefined, isError: true })).toBe('UNCHECKED');
  });
  it('🔴 status 가 없는 응답(모르는 모양)의 0장도 "없음"이 아니다', () => {
    expect(twinCdsView({ data: { cards: [] }, isError: false })).toBe('UNCHECKED');
  });
  it('미설정은 따로 말한다', () => {
    expect(twinCdsView({ data: { cards: [], status: 'UNCONFIGURED', reason: 'BASE_URL_UNSET' }, isError: false })).toBe('UNCONFIGURED');
  });
  it('로딩 중을 확인 불가로 말하지 않는다', () => {
    expect(twinCdsView({ data: undefined, isError: false })).toBe('LOADING');
  });
  it('대조군 — 트윈이 답한 진짜 0장은 NONE(성공을 실패로 말하지 않는다)', () => {
    expect(twinCdsView({ data: { cards: [], status: 'OK', reason: null }, isError: false })).toBe('NONE');
  });
  it('대조군 — 카드가 있으면 CARDS', () => {
    expect(twinCdsView({ data: { cards: [{ summary: 'x' }], status: 'OK', reason: null }, isError: false })).toBe('CARDS');
  });
});

describe('차트 화면 배선', () => {
  const src = readFileSync(join(__dirname, '../app/(main)/patients/[id]/page.tsx'), 'utf8');
  it('TwinCdsCards 가 twinCdsView 로 가르고 UNCHECKED·UNCONFIGURED 를 말한다', () => {
    const body = src.slice(src.indexOf('function TwinCdsCards'));
    expect(body).toMatch(/twinCdsView\(\{ data: cdsQuery\.data\?\.data, isError: cdsQuery\.isError \}\)/);
    expect(body).toMatch(/view === 'UNCHECKED' &&/);
    expect(body).toMatch(/view === 'UNCONFIGURED' &&/);
  });
});
