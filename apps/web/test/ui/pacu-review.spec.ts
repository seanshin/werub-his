/**
 * PACU 화면 검토 보완 — 2026-09-30.
 *  · 재실 목록은 /pacu/active(종전 전체 300건에서 거름 → 오래 재실한 환자부터 빠짐)
 *  · 조회 실패는 "없음"이 아니다(활력·입실 대기·지표·기준)
 *  · 0점 항목은 기준 미달(서버 게이트와 같은 규칙) · 기준값 출처를 말한다 · 퇴실 구분 초기값 미선택
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'src/app/(main)/pacu/page.tsx'), 'utf8');
const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('PACU 화면', () => {
  it('재실 목록은 서버의 재실 EP 를 부른다', () => {
    expect(code).toContain("apiClient.get<{ data: PacuPatient[] }>('/api/v1/pacu/active')");
    expect(code).not.toContain("apiClient.get<{ data: PacuPatient[] }>('/api/v1/pacu')");
  });
  it('🔴 조회 실패를 "없음"으로 그리지 않는다', () => {
    expect(code).toMatch(/\{vitalsError \? \(/);
    expect(code).toMatch(/\{pendingError && \(/);
    expect(code).toMatch(/statsError \? <span/);
    expect(code).toMatch(/settingsError \? <T k="퇴실 기준을 불러오지 못했습니다/);
  });
  it('0점 항목은 총점과 관계없이 기준 미달 — 폼 표시와 퇴실 판단 모두', () => {
    expect(code).toMatch(/aldreteZeroSel\.length \? ' \(0점 항목 — 기준 미달\)'/);
    expect(code).toMatch(/\|\| zeroItems\.length > 0;/);
  });
  it('퇴실 구분은 미선택으로 시작하고, 고르기 전에는 퇴실 버튼이 잠긴다', () => {
    expect(code).toContain("useState('')");
    expect(code).not.toContain("useState('WARD')");
    expect(code).toMatch(/disabled=\{dischargeMut\.isPending \|\| !disposition \|\|/);
  });
});
