import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 비대면 진료 의사 차트 계약 가드 — 이연 회수 T2-4(2026-08-18).
 *
 * 종전 동작: 의사가 고른 **진단**과 입력한 **처방**이 컴포넌트 state 에만 쌓이고
 * **어디에도 전송되지 않았다**(저장 버튼도 없었다). 진료가 끝나면 사라졌고, 환자는 약을 받지 못한다.
 *
 * 규약:
 *  · 진단은 진료 기록(Encounter)에 붙는다.
 *  · 처방은 **정본 경로 `/encounters/:id/prescriptions`** 로만 만든다 — 그 경로에 DUR 점검이 걸려 있다.
 *    (telehealth 전용 우회 경로를 새로 만들면 안전 게이트를 지나치게 된다)
 */

const CHART = join(
  process.cwd(), 'src', 'app', '(main)', 'telehealth', '[sessionId]', '_components', 'DoctorChart.tsx',
);

describe('의사 차트는 진단·처방을 실제로 보낸다', () => {
  const src = readFileSync(CHART, 'utf8');

  it('진단을 진료 기록에 저장한다', () => {
    expect(src).toMatch(/apiClient\.put\(`\/api\/v1\/encounters\/\$\{encounterId\}`/);
    expect(src).toContain('diagnosisCodeId');
  });

  it('🔴 처방은 정본 경로(DUR 점검이 걸린 곳)로 만든다', () => {
    expect(src).toMatch(/apiClient\.post\(`\/api\/v1\/encounters\/\$\{encounterId\}\/prescriptions`/);
    expect(src).toContain('medicationCodeId');
  });

  it('🔴 telehealth 전용 처방 우회 경로를 만들지 않는다', () => {
    expect(src).not.toMatch(/telehealth\/sessions\/[^`'"]*\/prescription(?!s\b)/);
    expect(src).not.toMatch(/apiClient\.post\(`\/api\/v1\/prescriptions/);
  });

  it('진료 기록이 없으면 저장 버튼이 잠긴다(전송한 척하지 않는다)', () => {
    expect(src).toMatch(/disabled=\{!encounterId/);
  });
});
