import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenCalls, scanMismatches, gatedCalls } from './role-endpoint-scan';

/**
 * 🔴 **화면↔서버 역할 드리프트 — 전수 가드의 두 사각** (2026-09-16 · 갈래 K3).
 *
 * 전수 스캐너(`role-endpoint-scan.ts`)는 2026-08-30 부터 있었는데, J2 가 찾은 5자리와 I3 이 찾은
 * 접수 dead-button 을 **하나도 잡지 못했다.** 이유가 둘이었다:
 *
 *   ① **비재귀 수집** — `readdirSync(dir)` 가 그 폴더의 `.tsx` 만 읽어 `components/` 하위의 호출을
 *      통째로 놓쳤다. 실측 15화면·EP 238개가 보이지 않았고, `/reception`·`/ess`·`/imaging`·
 *      `/admin/chart-editor` 는 **EP 0개**로 잡혀 스캔 대상 자체가 아니었다.
 *   ② **화면 단위 자기게이팅 제외** — 버튼 하나만 역할로 감싸면 그 화면의 EP 가 전부 빠졌다.
 *      실측: `/billing` 은 예치금 버튼 한 줄(`useHasRole('RECEPTIONIST','CHECKUP')`) 때문에 7EP 가
 *      빠져 있었다 — 그래서 수납 드리프트가 **세 번** 재발하는 동안 이 가드는 조용했다.
 *
 * 그리고 반대편 도구(실로그인 프로브 `scripts/probe-least-privilege.mjs`)는 **쓰기를 부르지 않는다.**
 * 🔴 두 도구가 반대 방향으로 눈이 멀어 **접수 화면의 쓰기 5종**(자격조회·본인확인·신분증 OCR·
 *    접수 챗봇 2)이 아무에게도 보이지 않았다 — 접수 데스크의 주 사용자인 원무가 전부 403 이었다.
 */
describe('🔴 K3 ① 스캐너가 하위 폴더의 호출을 본다', () => {
  it('/reception 의 components/ 호출이 잡힌다(종전 0개)', () => {
    const eps = screenCalls('/reception').map((c) => c.ep);
    expect(eps.length, '하위 폴더를 못 읽으면 0 이 된다').toBeGreaterThan(15);
    // 본인확인 모달은 reception/components/EligibilityVerifyModal.tsx 에 있다
    expect(eps).toContain('POST /api/v1/eligibility/verify-identity');
    expect(eps).toContain('POST /api/v1/ai/id-ocr');
  });

  it('대조군 — 하위 *라우트*(자체 page.tsx)는 빨아들이지 않는다(그 화면의 역할로 따로 대조된다)', () => {
    // /patients 아래 /patients/new·/patients/register/foreign 은 별도 nav 화면이다
    const eps = screenCalls('/patients').map((c) => c.ep);
    expect(eps).not.toContain('DELETE /api/v1/patients/foreign/:x');
  });
});

describe('🔴 K3 ② 게이트 판정이 화면 단위가 아니라 호출 단위다', () => {
  it('/billing — 예치금 버튼 한 줄이 화면 전체를 가리지 않는다', () => {
    const calls = screenCalls('/billing');
    expect(calls.length).toBeGreaterThan(5);
    // 게이트가 달리지 않은 호출이 남아 있어야 대조가 일어난다(종전엔 전부 빠졌다)
    expect(calls.some((c) => !c.gated), '화면의 모든 호출이 게이트로 분류됐다 — 화면 단위 제외로 되돌아갔다').toBe(true);
  });

  it('게이트 달린 호출은 목록으로 드러난다(숨기지 않는다)', () => {
    const g = gatedCalls();
    expect(g.length).toBeGreaterThan(100);
    expect(g.every((x) => x.split('|').length === 3)).toBe(true);
  });
});

/**
 * 🔴 K3 봉합 — 접수 데스크(원무)가 자기 화면의 핵심 행위를 부를 수 있다.
 *    `/reception` nav = ADMIN·NURSE·RECEPTIONIST 인데 아래 EP 들이 원무를 빼고 있었다.
 */
describe('🔴 K3 접수 화면의 주 사용자(원무)가 접수 행위를 부를 수 있다', () => {
  const api = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  /**
   * 🔴 고정 길이로 자르면 **다음 핸들러까지 넘어간다** — 첫 판에서 `:id/complete` 창이 그 아래
   *    `:id/cancel`(원무 포함)을 읽어 대조군이 거짓 실패했다. 다음 HTTP 데코레이터에서 끊는다.
   */
  const after = (src: string, anchor: string) => {
    const i = src.indexOf(anchor);
    expect(i, `${anchor} 를 찾지 못했다 — 옮겼으면 이 가드를 고친다`).toBeGreaterThan(-1);
    const rest = src.slice(i + anchor.length);
    const next = rest.search(/@(Get|Post|Put|Patch|Delete|Sse)\(/);
    return anchor + (next > -1 ? rest.slice(0, next) : rest.slice(0, 400));
  };

  it('자격조회·본인확인 — 주석이 "원무/임상"이라 적고 코드가 어기던 자리', () => {
    const src = api('modules/eligibility/eligibility.controller.ts');
    expect(after(src, '@Controller(', 0) !== null).toBe(true);
    const head = src.slice(0, src.indexOf('export class'));
    expect(head).toMatch(/@Roles\([^)]*UserRole\.RECEPTIONIST/);
  });

  it('신분증 OCR — 접수 데스크의 행위다', () => {
    expect(after(api('modules/medical-ai/medical-ai.controller.ts'), "@Post('id-ocr')"))
      .toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('접수 AI 상담(HIS_RECEPTION 채널) 세션·메시지', () => {
    const src = api('modules/agent-session/agent-session.controller.ts');
    expect(after(src, "@Post('session')")).toMatch(/UserRole\.RECEPTIONIST/);
    expect(after(src, "@Post('session/:sessionId/message')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('미방문 처리 — 바로 위 취소는 원무에게 열려 있었다(짝이 맞는다)', () => {
    const src = api('modules/waiting-queue/waiting-queue.controller.ts');
    expect(after(src, "@Patch(':id/no-show')")).toMatch(/UserRole\.RECEPTIONIST/);
    expect(after(src, "@Patch(':id/cancel')")).toMatch(/UserRole\.RECEPTIONIST/);
  });

  it('🔴 대조군 — 임상 행위까지 열지 않았다(진료 시작·완료는 의사·관리자)', () => {
    const src = api('modules/waiting-queue/waiting-queue.controller.ts');
    expect(after(src, "@Patch(':id/start')"), '진료 시작까지 원무에게 열렸다').not.toMatch(/UserRole\.RECEPTIONIST/);
    expect(after(src, "@Patch(':id/complete')"), '진료 완료까지 원무에게 열렸다').not.toMatch(/UserRole\.RECEPTIONIST/);
  });
});

describe('🔴 K3 — 임상 행위 버튼은 화면이 감춘다(서버를 넓히지 않는다)', () => {
  const page = readFileSync(
    join(process.cwd(), '..', 'web', 'src', 'app', '(main)', 'clinic-queue', 'page.tsx'), 'utf8');

  it("'진료 시작'은 의사에게만 그린다", () => {
    expect(page).toMatch(/const canStartConsult = useHasRole\('DOCTOR'\)/);
    expect(page).toMatch(/status === 'CALLED' && canStartConsult/);
  });

  it("'취소'는 원무·간호에게만 그린다(서버 주석: 접수 취소도 원무·간호·관리자)", () => {
    expect(page).toMatch(/const canCancelQueue = useHasRole\('NURSE', 'RECEPTIONIST'\)/);
    expect(page).toMatch(/\{canCancelQueue && \(/);
  });
});

describe('대조군 — 스캐너가 살아 있다', () => {
  it('미스매치 집합이 비어 있지 않다(0 이면 스캐너가 죽은 것이다)', () => {
    expect(scanMismatches().length).toBeGreaterThan(50);
  });
});
