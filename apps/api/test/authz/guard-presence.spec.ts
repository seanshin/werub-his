import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * 🔴 W8/A2·A3·A6 — "가드가 빠진 자리"를 소스에서 붙잡는다.
 *
 * 이 저장소의 반복 함정: `@Roles` 만 붙이고 `RolesGuard` 를 빼면 **아무도 막히지 않는다**.
 * 데코레이터가 있다는 사실은 통제의 증거가 아니다 — 가드가 등록돼 있어야 통제다.
 */
describe('가드 존재 (RolesGuard 누락 재발 방지)', () => {
  it('🔴 전문과별 진료건수는 로그인만으로 열리지 않는다 (민감 진료과 이용 사실 = PHI)', () => {
    const src = read('modules/specialty-counts/specialty-counts.controller.ts');
    // 원 결함: @UseGuards(JwtAuthGuard) 뿐 — RolesGuard 가 없어 전 14역할이 임의 환자 조회 가능
    expect(src).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard\)/);
    expect(src).toMatch(/@Roles\(UserRole\.DOCTOR,\s*UserRole\.NURSE\)/);
  });

  it('🔴 외부 Clinic ShareSpace 문서 생성은 관리자만 (병원 이름으로 외부에 남는 기록)', () => {
    const src = read('modules/clinic-integration/clinic-integration.controller.ts');
    const post = src.slice(src.indexOf("@Post('wiki/page')"));
    const decorator = post.slice(0, post.indexOf('async '));
    expect(decorator).toMatch(/@UseGuards\(JwtAuthGuard,\s*RolesGuard\)/);
    expect(decorator).toContain('UserRole.ADMIN');
  });

  it('🔴 차트 템플릿의 읽기·롤백·복제는 전부 호출자를 넘긴다 (남의 개인 템플릿 = 404)', () => {
    const src = read('modules/chart-template/chart-template.controller.ts');
    // userId 를 서비스에 넘기지 않으면 소유 검증이 통째로 무력화된다(형제 update 만 막던 반쪽 보호)
    for (const call of [
      /this\.svc\.findById\(id,\s*userId\)/,
      /this\.svc\.getVersionHistory\(id,\s*userId\)/,
      /this\.svc\.getVersion\(id,\s*versionId,\s*userId\)/,
      /this\.svc\.rollbackToVersion\(id,\s*versionId,\s*userId\)/,
      /this\.svc\.clone\(id,\s*userId\)/,
    ]) {
      expect(src).toMatch(call);
    }
  });
});

/**
 * 🔴 W8/A5 — nav 와 API 가 서로 다른 말을 하던 것(dead-menu / 역방향 dead-menu).
 * nav 는 접근을 주지 않는다. 그래서 여기서 지키는 것은 "메뉴가 API 와 같은 말을 하는가" 뿐이다.
 */
describe('nav ↔ API 정합 (dead-menu 재발 방지)', () => {
  const nav = fs.readFileSync(path.resolve(__dirname, '../../../web/src/components/layout/Sidebar.tsx'), 'utf8');
  const navRolesFor = (href: string): string[] => {
    const i = nav.indexOf(`href: '${href}'`);
    expect(i, `nav 에 ${href} 항목이 없다`).toBeGreaterThan(-1);
    const line = nav.slice(i, nav.indexOf('\n', i));
    const m = /roles:\s*\[([^\]]*)\]/.exec(line);
    expect(m, `${href} 의 roles 가 인라인 배열이 아니다(상수면 이 단언을 갱신할 것)`).toBeTruthy();
    return (m as RegExpExecArray)[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  };

  it('VoC 메뉴가 API(ADMIN·CRM_MANAGER·CRM_STAFF)와 같은 역할을 연다', () => {
    const api = read('modules/voc/voc-admin.controller.ts');
    expect(api).toMatch(/@Roles\(UserRole\.ADMIN,\s*UserRole\.CRM_MANAGER,\s*UserRole\.CRM_STAFF\)/);
    expect(navRolesFor('/admin/voc').sort()).toEqual(['ADMIN', 'CRM_MANAGER', 'CRM_STAFF']);
  });

  it('통계/분석 메뉴는 executive.console 를 여는 역할에게만 보인다 (DOCTOR 는 전 패널 403 이었다)', () => {
    expect(navRolesFor('/admin/analytics').sort()).toEqual(['ADMIN', 'EXECUTIVE']);
  });
});
