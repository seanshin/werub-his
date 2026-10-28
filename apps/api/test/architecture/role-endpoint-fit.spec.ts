import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanControllers, makeLookup } from './role-endpoint-scan';

/**
 * 🔴 **화면이 열려 있으면 그 화면이 부르는 EP 도 열려 있어야 한다** (2026-08-29 · 발굴 20회차).
 *
 * `RolesGuard` 는 역할과 권한을 **AND** 로 본다. 그래서 nav 가 화면을 열어도
 * EP 의 `@Roles` 에 그 역할이 없으면 **상시 403**이고, 화면은 오류만 그린다.
 *
 * 이번 회차는 nav(역할별 화면) × 화면이 부르는 EP × 컨트롤러 `@Roles`/`@RequirePermission`
 * 를 기계로 교차해 찾았고, **운영 실측 7/7** 로 스캐너를 대조한 뒤 확정했다.
 * (스캐너가 네 번 틀렸다: 핸들러 데코레이터 절단 · `...SPREAD` 미전개 ·
 *  HTTP 메서드 무시 · 권한 OR 를 AND 로 판정 · 그리고 **주석 안 문자열**을 코드로 읽음)
 *
 * 🔴 **여는 것이 항상 답은 아니다.** 이 가드는 "연 것"과 "일부러 닫아 둔 것"을 **둘 다** 고정한다.
 */
const api = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
/** 주석 안의 `@Roles(...)` 가 코드로 읽혀 판정을 뒤집은 적이 있다 — 걷어내고 본다 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 특정 핸들러 데코레이터 바로 아래 블록(다음 데코레이터/메서드까지) */
function blockAfter(src: string, decorator: string): string {
  const s = stripComments(src);
  const i = s.indexOf(decorator);
  expect(i, `${decorator} 를 찾지 못했다 — 핸들러가 옮겨졌으면 이 가드를 고친다`).toBeGreaterThan(-1);
  return s.slice(i, i + 400);
}

describe('🔴 직원 식수는 전 직원 것이다 — 지원부서 역할 재편이 빠뜨렸다', () => {
  const NUT = api('modules/nutrition/nutrition.controller.ts');
  const ADDED = ['RECEPTIONIST', 'ADMIN_STAFF', 'MEDICAL_RECORDS', 'CHECKUP', 'EXECUTIVE'];

  it('STAFF_MEAL_ROLES 에 2026-08 신설 지원직 5역할이 모두 있다', () => {
    const decl = stripComments(NUT).match(/const STAFF_MEAL_ROLES = \[([\s\S]*?)\] as const;/);
    expect(decl, 'STAFF_MEAL_ROLES 상수가 없다').not.toBeNull();
    for (const r of ADDED) expect(decl![1], `${r} 이 빠졌다`).toContain(`UserRole.${r}`);
  });

  for (const h of ["@Get('staff-menu')", "@Post('staff-meal/request')", "@Patch('staff-meal/:id/cancel')", "@Get('staff-meal/my')"]) {
    it(`${h} — 전 직원 집합을 쓴다`, () => {
      expect(blockAfter(NUT, h)).toMatch(/@Roles\(\.\.\.STAFF_MEAL_ROLES\)/);
    });
  }

  it('🔴 급양 마스터·정산까지 열지는 않았다(대조군 — 여는 것이 답은 아니다)', () => {
    for (const h of ["@Post('staff-menu')", "@Get('staff-meal/stats')"]) {
      expect(blockAfter(NUT, h), `${h} 까지 열렸다`).not.toMatch(/STAFF_MEAL_ROLES/);
    }
  });
});

describe('🔴 급식 워크스테이션은 임상 오더 EP 를 부르지 않는다', () => {
  const SVC = stripComments(api('modules/workstation/workstation.service.ts'));
  const web = (p: string) => stripComments(readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8'));
  const PAGE = web('app/(main)/workstation/nutrition/page.tsx');

  it('큐가 `orderId` 를 담지 않는다 — 그 이름이 임상 오더 EP 호출을 불렀다', () => {
    const q = SVC.slice(SVC.indexOf('getNutritionQueue'), SVC.indexOf('getNutritionQueue') + 1600);
    expect(q, 'MealOrder.id 를 orderId 로 담고 있다').not.toMatch(/\borderId:\s*m\.id/);
    expect(q).toMatch(/mealOrderId:\s*m\.id/);
  });

  it('배식 완료건도 담는다 — 안 담으면 화면의 완료 탭이 언제나 0건이다', () => {
    const q = SVC.slice(SVC.indexOf('getNutritionQueue'), SVC.indexOf('getNutritionQueue') + 1600);
    expect(q).toMatch(/'DELIVERED'/);
  });

  it('화면이 급식 상태 정본 EP 만 부른다', () => {
    expect(PAGE).toMatch(/\/api\/v1\/nutrition\/meals\/\$\{id\}\/status/);
    expect(PAGE, '임상 오더 전이 EP 를 아직 부른다').not.toMatch(/\/api\/v1\/workstation\/order\//);
  });

  it('화면이 급식 상태 어휘를 쓴다 — 임상 상태로는 버튼이 뜨지 않았다', () => {
    expect(PAGE).toMatch(/'PREPARED'/);
    expect(PAGE, "임상 상태 'IN_PROGRESS' 가 남아 있다").not.toMatch(/'IN_PROGRESS'/);
  });
});

describe('🔴 검진 데스크·경영진이 자기 화면의 EP 를 부를 수 있다', () => {
  it('수납 화면 — 검진 데스크가 계산·분납·예치금을 쓴다', () => {
    const B = api('modules/billing/billing.controller.ts');
    for (const h of ["@Get('billing/calculate/:encounterId')", "@Post('billings/:id/installment')", "@Get('billings/:id/installments')", "@Patch('billing/installments/:installmentId/pay')"]) {
      expect(blockAfter(B, h), `${h} 에 CHECKUP 없음`).toMatch(/UserRole\.CHECKUP/);
    }
    const D = api('modules/deposit/deposit.controller.ts');
    for (const h of ["@Post()", "@Get('patient/:patientId')"]) {
      expect(blockAfter(D, h), `deposit ${h} 에 CHECKUP 없음`).toMatch(/UserRole\.CHECKUP/);
    }
  });

  it('동선 모니터 — 검진 데스크가 구역 집계·타임라인을 본다', () => {
    const P = api('modules/patient-flow/patient-flow.controller.ts');
    for (const h of ["@Get('patient-flow/zone-stats')", "@Get('patient-flow/patient/:id/timeline')"]) {
      expect(blockAfter(P, h)).toMatch(/UserRole\.CHECKUP/);
    }
  });

  it('경영 관제 — 경영진이 장비 목록을 본다(등록·수정은 그대로)', () => {
    const E = api('modules/equipment/equipment.controller.ts');
    expect(blockAfter(E, '\n  @Get()')).toMatch(/UserRole\.EXECUTIVE/);
    expect(blockAfter(E, '\n  @Post()'), '장비 등록까지 열렸다').not.toMatch(/UserRole\.EXECUTIVE/);
  });

  it('스캔이 실제로 파일을 읽었다(대조군)', () => {
    expect(api('modules/nutrition/nutrition.controller.ts').length).toBeGreaterThan(2000);
    expect(api('modules/equipment/equipment.controller.ts').length).toBeGreaterThan(1000);
  });
});

describe('🔴 열지 않기로 한 자리는 화면이 숨긴다 — dead-button 금지', () => {
  const web = (p: string) => stripComments(readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8'));

  it('개원 관제 — 쓰기 UI 가 ADMIN 에게만 뜬다', () => {
    const P = web('app/(main)/admin/opening/page.tsx');
    expect(P).toMatch(/function useOpeningCanWrite\(\)/);
    expect(P).toMatch(/canWrite && <button onClick=\{\(\) => setCustomForm/);
    expect(P.match(/if \(!canWrite\) return null;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('Go-Live 관제 — 승인·편집이 ADMIN 에게만 뜬다', () => {
    const P = web('app/(main)/admin/go-live/page.tsx');
    expect(P).toMatch(/canWrite && <button onClick=\{approve\}/);
    expect(P).toMatch(/읽기 전용/);
  });

  it('여정 관제 — 경영진에게 개별 환자 청구 상세를 부르지 않는다', () => {
    const P = web('app/(main)/journey-console/page.tsx');
    expect(P).toMatch(/enabled: !!card\.encounterId && !isExecutive/);
    expect(P).toMatch(/\{card\.encounterId && !isExecutive && \(/);
  });

  it('검진 마스터 화면은 nav 에서도 ADMIN 전용이다', () => {
    const S = web('components/layout/Sidebar.tsx');
    for (const href of ['/his-checkup/questionnaires', '/his-checkup/programs']) {
      const line = S.split('\n').find(l => l.includes(`href: '${href}'`));
      expect(line, `${href} 항목이 사라졌다`).toBeTruthy();
      expect(line, `${href} 가 아직 CHECKUP 에게 보인다`).not.toMatch(/CHECKUP/);
    }
  });
});

/**
 * 🔴 2026-09-02 실측 — CRM_MANAGER·CRM_STAFF 로 실제 로그인하니 `/api/v1/ess/*`·`/api/v1/hr/me` 가
 *    전부 403 이었다. 세 컨트롤러가 역할을 손으로 나열하며 나중에 생긴 CRM 두 직군만 빠뜨렸다.
 *    정본(`EVERY_STAFF_ROLE`)으로 수렴시켰고, 여기서는 **스캐너가 그 정본 파생 상수를 실제로 푸는지**를
 *    함께 본다 — 못 풀면 기준선이 "실제로는 더 열린 EP"를 미스매치로 둔갑시킨다(스캐너 7번째 교정).
 */
describe('🔴 직원 자기 서비스는 CRM 직군도 쓴다 — 정본 파생 상수를 스캐너가 푼다', () => {
  const lookup = makeLookup(scanControllers());

  const SELF_EPS = [
    'GET /api/v1/ess/attendance',
    'POST /api/v1/ess/attendance/clock',
    'GET /api/v1/ess/payslip',
    'GET /api/v1/ess/leave/balance',
    'GET /api/v1/ess/approvals/inbox',
    'GET /api/v1/hr/me',
    'GET /api/v1/education/programs',
  ];

  it.each(SELF_EPS)('%s — CRM_MANAGER·CRM_STAFF 가 포함된다', (ep) => {
    const v = lookup(ep);
    expect(v, `${ep} 핸들러를 못 찾았다 — 경로가 바뀌면 이 가드는 헛돈다`).toBeTruthy();
    expect(v!.roles.join(','), '정본 파생 상수를 못 풀었다(UNRESOLVED)').not.toContain('__UNRESOLVED');
    expect(v!.roles).toContain('CRM_MANAGER');
    expect(v!.roles).toContain('CRM_STAFF');
  });

  it('대조군: 인사 마스터 목록은 여전히 ADMIN 전용(여는 방향으로만 움직였다)', () => {
    expect(lookup('GET /api/v1/hr/staff')?.roles).toEqual(['ADMIN']);
  });
});
