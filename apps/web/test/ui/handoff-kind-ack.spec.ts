/**
 * 인계 종류·인수 확인자 — 화면(2026-10-26).
 *  · 🔴 간호 스테이션 "인수 확인 + 담당 인수"는 서버 판정 kind 로(종류 문자열 비교 없음 · 옛 서버면 종류로)
 *  · 직원 인계 화면 '교대' 배지도 kind · 인계 이력 화면은 관리자 대리 확인을 그렇게 말한다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '../../src/app');
const code = (p: string) => readFileSync(join(SRC, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('🔴 인계 종류는 서버 판정으로', () => {
  it('간호 스테이션 — 종류 문자열 직접 비교로 단추를 가르지 않는다 · kind 우선', () => {
    const s = code('(main)/nurse-station/page.tsx');
    expect(s).not.toMatch(/h\.type === 'NURSING_SHIFT' && h\.admissionId/);
    expect(s).toMatch(/isNursingShift\(h\) && h\.admissionId/);
    expect(s).toMatch(/h\.kind \? h\.kind === 'NURSING_SHIFT' : h\.type === 'NURSING_SHIFT'/);
  });
  it('직원 인계 화면 교대 배지도 kind 우선', () => {
    expect(code('staff/handoffs/page.tsx')).toMatch(/h\.kind \? h\.kind === 'NURSING_SHIFT'/);
  });
  it('🔴 인계 이력 — 관리자 대리 확인 표시', () => {
    const s = code('(main)/handoffs/page.tsx');
    expect(s).toMatch(/h\.acknowledgedByProxy === true && <span[^>]*data-handoff-ack-proxy/);
  });
});
