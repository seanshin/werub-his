import { describe, it, expect } from 'vitest';
import { dosageRouteIssues, hasDosageRouteConflict } from '../src/dosage-route';

/**
 * 🔴 진료과 코드 카탈로그 실측 오염 — 화면 실사용 점검 W7(2026-08-14).
 * 이 값들은 개인 약속처방에 등재돼 **CPOE 처방 검색의 기본값을 프리필**한다.
 */
describe('제형↔경로 정합성', () => {
  it('🔴 주사제를 경구(PO)로 지정하면 잡는다 — 실측: 덱사메타손 주사 5mg / 1C PO 28일', () => {
    const issues = dosageRouteIssues({ dosageForm: '주사', defaultRoute: 'PO', defaultDosage: '1C' });
    expect(issues.map((i) => i.code)).toContain('NON_ORAL_FORM_ORAL_ROUTE');
    expect(issues[0].message).toContain('주사');
  });

  it('🔴 혈액제제를 1정 경구로 지정하면 두 가지를 다 잡는다 — 실측: FFP 200mL / 1T PO 30일', () => {
    const codes = dosageRouteIssues({ dosageForm: '혈액제제', defaultRoute: 'PO', defaultDosage: '1T' })
      .map((i) => i.code);
    expect(codes).toContain('NON_ORAL_FORM_ORAL_ROUTE');
    expect(codes).toContain('NON_SOLID_FORM_SOLID_UNIT');
  });

  it('정상 조합은 경고하지 않는다 — 아스피린프로텍트정(장용정) 1T PO', () => {
    expect(dosageRouteIssues({ dosageForm: '장용정', defaultRoute: 'PO', defaultDosage: '1T' })).toEqual([]);
    expect(dosageRouteIssues({ dosageForm: '캡슐', defaultRoute: 'PO', defaultDosage: '1C' })).toEqual([]);
  });

  it('🔴 제형이 비어 있으면 경고하지 않는다 — 모르는 것을 모순이라 하지 않는다', () => {
    expect(dosageRouteIssues({ dosageForm: null, defaultRoute: 'PO', defaultDosage: '1T' })).toEqual([]);
    expect(dosageRouteIssues({ dosageForm: '', defaultRoute: 'PO', defaultDosage: '1T' })).toEqual([]);
  });

  it('등재되지 않은 제형도 경고하지 않는다(거짓 경보가 진짜 경보를 죽인다)', () => {
    expect(dosageRouteIssues({ dosageForm: '기타', defaultRoute: 'PO', defaultDosage: '1T' })).toEqual([]);
  });

  it('주사제를 IV 로 지정한 것은 정상', () => {
    expect(dosageRouteIssues({ dosageForm: '주사', defaultRoute: 'IV', defaultDosage: '5mg' })).toEqual([]);
  });

  it('용량 단위 판정이 mg 를 정제로 오인하지 않는다', () => {
    expect(dosageRouteIssues({ dosageForm: '주사', defaultRoute: 'IV', defaultDosage: '100mg' })).toEqual([]);
  });

  it('경로 표기가 한글이어도 잡는다', () => {
    expect(hasDosageRouteConflict({ dosageForm: '앰플', defaultRoute: '경구', defaultDosage: '1A' })).toBe(true);
  });
});
