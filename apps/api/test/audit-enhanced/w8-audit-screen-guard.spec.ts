import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * W8 화면 가드 — **두 감사 화면이 같은 분모를 말한다.**
 *
 * 🔴 원 결함: W7 에서 감사 대시보드(`/admin/audit-dashboard`)만 SMART 앱 접근을 합산하도록 고쳤고,
 *    감사 로그 화면(`/admin/audit`)은 `/api/v1/audit/stats` 를 계속 봐서
 *    ① SMART 접근 27,102건을 통째로 누락한 값을 '전체 로그'라 부르고
 *    ② 리소스 유형을 상위 10종만 받아 "10"이라 표시했다(실제 104종 — 94종은 필터조차 불가).
 *    **한 곳만 고치면 갈라진다** — 두 화면이 같은 엔드포인트(정본)를 쓰게 고정한다.
 *
 * 🔴 VIP 정본도 같은 이유로 고정한다 — 화면(patient_flags)과 이상탐지(vip_patients)가 갈라져
 *    "VIP 로 찍었는데 접근 경보가 절대 안 걸리는" 상태였다.
 */
const WEB = join(__dirname, '../../../web/src/app/(main)/admin');
const API = join(__dirname, '../../src/modules');
const code = (p: string) =>
  readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('W8 가드 — 감사 화면 분모 / VIP 정본', () => {
  const auditPage = join(WEB, 'audit/page.tsx');

  it('가드 대상 화면이 실제로 존재한다(경로가 바뀌면 조용히 통과하지 않도록)', () => {
    expect(existsSync(auditPage)).toBe(true);
  });

  it('🔴 감사 로그 화면은 대시보드와 같은 정본 엔드포인트를 쓴다', () => {
    const src = code(auditPage);
    expect(src).toContain('/api/v1/audit/dashboard');
    expect(src).not.toContain('/api/v1/audit/stats'); // 두 번째 정본 금지
  });

  it('🔴 화면이 내부 감사만 세고 "전체"라 부르지 않는다 — 양 채널 합산 값을 쓴다', () => {
    const src = code(auditPage);
    expect(src).toContain('totalAccessAllChannels');
    expect(src).toContain('last24hAllChannels');
  });

  it('🔴 VIP 를 읽는 서버 코드는 정본 조건식(vip-canonical) 하나만 쓴다', () => {
    for (const f of ['audit-enhanced/vip-patient.service.ts', 'audit-enhanced/anomaly-detection.service.ts']) {
      const src = code(join(API, f));
      expect(src).toContain('vipFlagWhere');
      expect(src).not.toMatch(/prisma\.vipPatient\b/); // 폐지된 정본
    }
  });

  it('🔴 VIP 접근 감지가 실제로 배선돼 있다 — 정의만 되고 호출되지 않던 통제', () => {
    const src = code(join(API, 'audit-enhanced/anomaly-detection.service.ts'));
    expect(src).toMatch(/runPeriodicCheck[\s\S]*detectVipAccess\(/);
  });
});
