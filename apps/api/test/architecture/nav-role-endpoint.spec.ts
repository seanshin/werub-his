import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **화면이 부르는 EP 를 그 화면의 역할이 부를 수 있어야 한다** (2026-08-29 · 발굴 14회차).
 *
 * 실측: `RECEPTIONIST` 로 **실제 로그인**해 접수 화면(`/reception`)이 부르는 EP 를 눌렀더니
 *  · `GET /api/v1/appointments` → **403**
 *  · `GET /api/v1/emergency/beds` → **403**
 * 즉 접수원이 자기 화면을 열면 예약 목록과 응급 도착 배너가 **상시 빨간 오류**였다.
 *
 * 🔴 **정적 분석이 놓친 자리다** — 클래스 `@Roles` 는 잘 적혀 있었고 tsc·테스트도 통과했다.
 *    같은 컨트롤러의 `call-patient` 에는 `RECEPTIONIST` 가 **이미 들어 있었다** —
 *    접수원이 쓴다는 것을 알고 있었는데 **목록·체크인만 빠뜨린** 것이다.
 *
 * 🔴 **여는 것이 항상 답은 아니다**(§규약 5). 성격을 구분했다:
 *    예약 명단·응급 배정 현황 = **접수 업무 자체** → 연다.
 *    임상 상세(진단·처방)는 화면이 부르지 않는 것이 답이다 → 열지 않았다.
 */
const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

describe('🔴 접수 화면이 부르는 EP 를 접수원이 부를 수 있다', () => {
  const SCHED = read('modules/schedule/schedule.controller.ts');
  const ER = read('modules/emergency/emergency.controller.ts');

  /** `@Get()`/`@Patch(':id/status')` 등 특정 핸들러 바로 아래 붙은 @Roles 를 읽는다 */
  const rolesAfter = (src: string, decorator: string): string => {
    const i = src.indexOf(decorator);
    expect(i, `${decorator} 를 찾지 못했다 — 핸들러가 옮겨졌으면 이 가드를 고친다`).toBeGreaterThan(-1);
    return src.slice(i, i + 700);
  };

  it('예약 목록(GET /appointments) — 접수원이 부를 수 있다', () => {
    expect(rolesAfter(SCHED, '\n  @Get()')).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('🔴 체크인(PATCH :id/status) — 접수원의 핵심 행위다', () => {
    expect(rolesAfter(SCHED, "@Patch(':id/status')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('응급 도착 배너(GET emergency/beds) — 접수원이 부를 수 있다', () => {
    expect(rolesAfter(ER, "@Get('beds')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('환자 호출(POST :id/call-patient) — 종전부터 열려 있었다(대조군)', () => {
    expect(rolesAfter(SCHED, "@Post(':id/call-patient')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('🔴 임상 쓰기까지 열지 않았다 — 여는 것이 항상 답은 아니다', () => {
    // 예약 **생성**은 진료 일정 결정이라 접수원 몫이 아니다(종전 그대로)
    expect(rolesAfter(SCHED, '\n  @Post()'), '예약 생성까지 열렸다').not.toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('스캔이 실제로 파일을 읽었다(대조군)', () => {
    expect(SCHED.length).toBeGreaterThan(1000);
    expect(ER.length).toBeGreaterThan(1000);
  });
});

/**
 * 🔴 **전용 화면의 주인이 자기 EP 를 부를 수 있어야 한다** (2026-08-29 · 발굴 17회차).
 *
 * 역할별 실로그인으로 **전용 화면**(그 역할에만 열린 화면)의 EP 를 눌러 찾았다:
 *  · 급양 → `/workstation/station/nutrition/queue` **403** (급양 워크스테이션 본체가 안 열린다)
 *  · 검사기사 → `/blood-bank/transfusions` **403** (혈액은행 화면의 주인인데)
 *
 * 🔴 **넓게 열지 않았다** — 성격을 구분했다:
 *  · 급양에게 `ORDER_VIEW` 를 주면 검사·영상 큐까지 열린다 → **급양 스테이션에 한해서만**
 *  · 수혈 목록은 혈액은행 검사기사 업무다(같은 컨트롤러의 **출고**는 이미 LAB_TECH 전용이었다)
 */
describe('🔴 전용 화면의 주인이 자기 EP 를 부를 수 있다', () => {
  const WS = readFileSync(join(process.cwd(), 'src/modules/workstation/workstation.controller.ts'), 'utf8');
  const BB = readFileSync(join(process.cwd(), 'src/modules/blood-bank/blood-bank.controller.ts'), 'utf8');
  const clean = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * 🔴 **`RolesGuard` 는 역할과 권한을 AND 로 본다**(2026-08-29 운영 실측).
   *    `@Roles` 에 급양을 넣어도 `@RequirePermission(ORDER_VIEW)` 가 남아 있으면 여전히 막힌다.
   *    🔴 **단위 테스트는 컨트롤러를 직접 불러 가드를 건너뛰므로 통과했다** —
   *    배포하고 운영에서 눌러보고서야 알았다. 가드는 **둘 다** 본다.
   */
  it('급양이 스테이션 대기열을 부를 수 있다 — 역할 + 권한요구 없음', () => {
    const c = clean(WS);
    expect(c).toMatch(/@Roles\([^)]*UserRole\.NUTRITION/);
    const i = c.indexOf("@Get('station/:stationId/queue')");
    expect(i).toBeGreaterThan(-1);
    const block = c.slice(i, i + 500);
    expect(block, 'ORDER_VIEW 요구가 남아 있으면 급양은 여전히 403 이다')
      .not.toMatch(/@RequirePermission\(Permission\.ORDER_VIEW\)/);
  });

  it('🔴 급양은 **급양 스테이션 밖으로 못 나간다** — 넓게 열지 않았다(대조군)', () => {
    const c = clean(WS);
    expect(c, '스테이션 범위 제한이 없다').toMatch(/role === UserRole\.NUTRITION && stationId !== 'nutrition'/);
    expect(c, '제한을 어기면 막는다').toMatch(/ForbiddenException/);
  });

  it('🔴 급양에게 ORDER_VIEW 권한 자체를 주지 않았다(대조군 — 주면 검사·영상까지 열린다)', () => {
    const perms = readFileSync(join(process.cwd(), 'src/modules/auth/rbac/permission.types.ts'), 'utf8');
    const block = perms.slice(perms.indexOf('[UserRole.NUTRITION]'), perms.indexOf('[UserRole.ADMIN_STAFF]'));
    expect(block, '급양이 ORDER_VIEW 를 갖게 됐다').not.toMatch(/Permission\.ORDER_VIEW/);
  });

  it('검사기사가 수혈 실행 목록을 부를 수 있다', () => {
    const i = BB.indexOf("@Get('transfusions')");
    expect(i).toBeGreaterThan(-1);
    expect(clean(BB.slice(i, i + 900))).toMatch(/UserRole\.LAB_TECH/);
  });
});

/**
 * 🔴 **수납 화면(`/billing`)은 검진 데스크에도 열려 있다** (2026-08-29 · 발굴 18회차).
 *
 * nav: `roles: ['ADMIN','NURSE','RECEPTIONIST','CHECKUP']`
 * 그런데 수납 목록·미수금 EP 는 셋만 받아 **CHECKUP 은 상시 403** 이었다.
 * 🔴 같은 컨트롤러 주석이 **같은 결함의 전례**를 기록하고 있다 —
 *    *"종전 NURSE/ADMIN 만이라 의사에겐 상시 403·빈 탭"*.
 *    그때 의사와 접수원은 넣으면서 **검진만 빠뜨렸다.**
 *
 * 🔴 **ERP 청구서 상세(`billing/erp-invoice`)는 열지 않았다** — 수납 목록과 성격이 다르다.
 */
describe('🔴 수납 화면의 역할과 EP 가 맞는다', () => {
  const BILL = readFileSync(join(process.cwd(), 'src/modules/billing/billing.controller.ts'), 'utf8');
  const strip2 = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const after = (dec: string) => {
    const i = strip2(BILL).indexOf(dec);
    expect(i, `${dec} 를 찾지 못했다`).toBeGreaterThan(-1);
    return strip2(BILL).slice(i, i + 400);
  };

  it('수납 목록을 검진 데스크가 부를 수 있다', () => {
    expect(after("@Get('billings')")).toMatch(/UserRole\.CHECKUP/);
  });

  it('미수금 현황을 검진 데스크가 부를 수 있다', () => {
    expect(after("@Get('billing/outstanding')")).toMatch(/UserRole\.CHECKUP/);
  });

  it('🔴 ERP 청구서 상세를 검진 데스크까지 열지 않았다(대조군 — 넓히지 않았다)', () => {
    expect(after("@Get('billing/erp-invoice')"), 'erp-invoice 까지 열렸다').not.toMatch(/UserRole\.CHECKUP/);
  });

  /**
   * 🔴 2026-09-16 J2: 위 대조군은 **CHECKUP 만** 막는다. 원무(RECEPTIONIST)는 그 판단 대상이 아니었고,
   *    실로그인 프로브에서 원무가 수납 상세마다 ERP 패널 실패 배너를 보는 것이 확인됐다(패널은 설계상
   *    "조용히 숨기면 금액이 없는 것처럼 보인다"며 실패를 그린다). 원무는 목록·상세·미수금·영수증·분납
   *    **모든 수납 EP** 에 들어 있다 — 이 자리만 빠져 있었다.
   */
  it('ERP 청구서 상세를 원무가 부를 수 있다(수납의 주 사용자)', () => {
    expect(after("@Get('billing/erp-invoice')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('접수원 권한은 그대로다(대조군 — 종전 것을 깨지 않았다)', () => {
    expect(after("@Get('billings')")).toMatch(/UserRole\.RECEPTIONIST/);
    expect(after("@Get('billing/outstanding')")).toMatch(/UserRole\.RECEPTIONIST/);
  });
});
