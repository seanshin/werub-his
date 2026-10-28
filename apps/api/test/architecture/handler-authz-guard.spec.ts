import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanHandlerAuthz, openToEveryStaffRole, authzKey, stripComments } from './handler-authz-scan';

/**
 * 🔴 (2026-09-21 I) 스캐너와 **독립**으로 센 컨트롤러 파일 수 — 분모의 바깥 대조군이다.
 *    스캔이 쓰는 walk·정규식을 쓰지 않는다(같은 함정을 두 번 통과하지 않게).
 */
function countControllerFiles(dir = join(process.cwd(), 'src')): number {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) { n += countControllerFiles(f); continue; }
    if (!e.endsWith('.controller.ts')) continue;
    if (readFileSync(f, 'utf8').includes('@Controller(')) n++;
  }
  return n;
}

/**
 * 🔴 **과다 개방 축**(2026-09-16 D4) — "이 EP 를 **누가** 부를 수 있는가".
 *
 * 기존 `role-endpoint-*` 가드는 **nav(화면)에서 출발**해 "화면은 열렸는데 EP 가 닫혀 403"만 본다.
 * 그 스캔에서 `@Roles` 가 아예 없는 핸들러는 `roles.length === 0 → 통과`로 **정상 취급**된다 —
 * 반대 방향(너무 열린 EP)은 구조적으로 보이지 않는다. 그래서 원격진료 컨트롤러의 역할 누락 13개가
 * 모든 가드를 통과한 채 운영에 올라갔다(2026-09-15 M2). 이 가드가 그 반대 방향을 동결한다.
 *
 * 🔴 판정 규칙 §5 — **여는 것이 답인 EP 도 있다**(본인 프로필·내 기기·내 메뉴·공용 코드 마스터).
 *    그래서 "0 이어야 한다"가 아니라 **정확값 동결**이다: 새로 생기면 실패하고, 고치면 기준선을 줄이는 커밋을 강제한다.
 * 🔴 이 목록은 "역할로 막지 않는다"는 사실만 말한다 — 서비스 안에서 주체를 좁히는 것(예: i18n 검수자 명부)은
 *    이 스캔이 보지 못한다. 목록에 있다고 전부 결함이 아니고, 없다고 전부 안전한 것도 아니다.
 */
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'test/architecture/handler-authz.baseline.json'), 'utf8'),
) as { openToEveryStaffRole: string[]; unauthenticated: string[] };

describe('🔴 인증된 전 직원에게 열린 핸들러 — 정확값 동결', () => {
  const rows = scanHandlerAuthz();

  it('대조군 — 스캔이 실제로 돌았다(분모 하한)', () => {
    // 컨트롤러가 통째로 안 잡히면 "위반 0" 이 거짓이 된다 — 분모부터 본다
    // 🔴 (2026-09-21 I) 하한을 실측(3,302 핸들러·309 파일) 가까이 끌어올렸다. 종전 3,000/250 은
    //    **컨트롤러 7파일·핸들러 32개가 통째로 빠져 있어도 통과**했다(실제로 빠져 있었다).
    //    여유를 두면 신규 사각을 흡수한다 — 늘어나면 기준선과 함께 올린다.
    expect(rows.length).toBeGreaterThan(3290);
    expect(new Set(rows.map((r) => r.file)).size).toBeGreaterThan(305);
    // `@Controller` 선언 수와 파일 수는 다른 지표다 — 파일 기준 분모가 소스와 어긋나지 않는지 본다
    expect(new Set(rows.map((r) => r.file)).size).toBe(countControllerFiles());
  });

  /**
   * 🔴 (2026-09-21 I) **스캐너 자신을 픽스처로 검사하는 대조군 ①** — 경로 없는 `@Controller()`.
   *    종전 정규식 `@Controller\(\s*'([^']*)'\s*\)` 는 인자 없는 선언을 아예 못 봐
   *    컨트롤러 4파일(핸들러 21개)이 분모에서 사라졌다 — 그 안에 역할 미지정 6·무인증 6 이 있었다.
   *    "역할 미지정 101" 은 그 6을 **본 적이 없는 수**였다.
   */
  it('🔴 경로 없는 `@Controller()` 컨트롤러를 분모에서 잃지 않는다', () => {
    // 픽스처 — 스캐너의 정규식을 직접 겨눈다(소스가 바뀌어도 이 규약은 남는다)
    expect(/@Controller\(\s*(?:'([^']*)')?\s*\)/.test('@Controller()')).toBe(true);
    // 실파일 대조 — 이 저장소의 네 곳(라우트 전문을 핸들러가 갖는 꼴)
    for (const f of [
      'modules/clinic-schedule/clinic-schedule.controller.ts',
      'modules/mobile/aasa.controller.ts',
      'modules/clinic-integration/sso.controller.ts',
    ]) {
      const hits = rows.filter((r) => r.file === f);
      expect(hits.length, `${f} 가 스캔에 없다 — 경로 없는 @Controller() 를 다시 놓친다`).toBeGreaterThan(0);
      expect(hits.every((r) => r.prefix === '/')).toBe(true);
    }
    // 대조군 — 경로 있는 컨트롤러의 프리픽스는 그대로다(`/` 로 뭉개지 않았다)
    expect(gated('modules/code-master/code-master.controller.ts', 'GET diagnosis').prefix).toBe('/api/v1/codes');
  });

  /**
   * 🔴 (2026-09-21 I) **대조군 ②** — `src/modules` 밖의 컨트롤러.
   *    walk 가 `src/modules` 만 훑어 `src/sentinel`·`src/common` 3파일(핸들러 11개)이 분모에 없었다.
   *    그중 `GET /api/v1/mode` 는 역할 미지정인데 동결 목록 어디에도 없었다.
   */
  it('🔴 `src/modules` 밖의 컨트롤러도 센다(sentinel·common)', () => {
    for (const f of [
      'sentinel/sentinel.controller.ts',
      'common/his-mode/his-mode.controller.ts',
      'common/crypto/envelope-key.controller.ts',
    ]) {
      expect(rows.filter((r) => r.file === f).length, `${f} 가 스캔에 없다`).toBeGreaterThan(0);
    }
    // 이 셋은 전부 인증돼 있다(무인증 목록으로 새지 않았다)
    expect(rows.filter((r) => !r.file.startsWith('modules/') && !r.authed)).toEqual([]);
  });

  /**
   * 🔴 (2026-09-16 I1) 기준선 키는 **충돌하면 안 된다**. 종전 키 `<file>|<METHOD path>` 는
   *    한 파일에 `@Controller` 가 둘이면 서로 다른 EP 가 같은 키를 갖는다(실측 10쌍 · 인증/무인증 혼재 5쌍).
   *    한쪽이 공개→인증, 다른 쪽이 인증→공개로 뒤집혀도 두 목록의 **값이 그대로**라 동결이 거짓 안심이 된다.
   */
  it('🔴 동결 키가 유일하다 — 서로 다른 EP 가 같은 키를 쓰지 않는다', () => {
    const keys = rows.map(authzKey);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect([...new Set(dup)], '같은 키를 쓰는 EP 가 있다 — prefix 를 키에 넣어야 한다').toEqual([]);
    // 대조군 — 프리픽스를 뺀 옛 키였다면 실제로 충돌한다(이 가드가 무엇을 막는지 못박는다)
    const oldKeys = rows.map((r) => `${r.file}|${r.ep}`);
    expect(oldKeys.filter((k, i) => oldKeys.indexOf(k) !== i).length).toBeGreaterThan(0);
  });

  it('과다 개방 목록이 기준선과 정확히 같다(늘면 신규 위반 · 줄면 기준선을 줄여라)', () => {
    expect(openToEveryStaffRole()).toEqual(BASELINE.openToEveryStaffRole);
  });

  it('무인증(공개) 핸들러 목록도 정확값 동결 — 공개 표면이 조용히 늘지 않는다', () => {
    const unauth = rows.filter((r) => !r.authed).map(authzKey).sort();
    expect(unauth).toEqual(BASELINE.unauthenticated);
  });

  /**
   * 🔴 D4 에서 실제로 고친 것들 — 되돌아오면 여기서 잡힌다.
   *    (클래스 `@Roles` 기본값 · 핸들러 `@Roles` · FHIR 정본 가드 교체)
   */
  /**
   * 🔴 (2026-09-16 I1) `find` 는 **첫 일치**를 준다 — 한 파일에 `@Controller` 가 둘이면
   *    같은 `file|ep` 가 서로 다른 EP 를 가리켜 **엉뚱한 쪽을 판정**한다(실측 10쌍 · 그중 5쌍은 인증/무인증 혼재).
   *    그래서 여기서 모호하면 통과시키지 않고 실패한다 — 필요하면 prefix 를 받아 좁힌다.
   */
  const gated = (file: string, ep: string, prefix?: string) => {
    const hits = rows.filter((x) => x.file === file && x.ep === ep && (prefix ? x.prefix === prefix : true));
    expect(hits.length, `${file} ${ep} 핸들러를 찾지 못했다 — 옮겼으면 이 가드를 고친다`).toBeGreaterThan(0);
    expect(hits.length, `${file} ${ep} 가 ${hits.length}개다(프리픽스 ${hits.map((h) => h.prefix).join(', ')}) — prefix 를 지정해 좁혀라`).toBe(1);
    return hits[0];
  };

  it.each([
    ['modules/cancer-registry/cancer-registry.controller.ts', 'GET patient/:patientId', '암등록 환자별 원부'],
    ['modules/cancer-registry/cancer-registry.controller.ts', 'GET report/kccr/preview', 'KCCR 법정 보고 미리보기'],
    ['modules/remote-consultation/remote-consultation.controller.ts', 'GET :id/prescriptions', '비대면 처방 조회'],
    ['modules/remote-consultation/remote-consultation.controller.ts', 'PATCH config/departments', '비대면 진료과 정책 변경'],
    ['modules/pre-order/pre-order.controller.ts', 'GET patient/:patientId', '환자별 사전오더'],
    ['modules/mdt/mdt.controller.ts', 'GET patient/:patientId', '다학제 환자 이력'],
    ['modules/care-team/care-team.controller.ts', 'GET doctor/:doctorId', '의사별 진료팀'],
    ['modules/workgroup/workgroup.controller.ts', 'POST medication/:medicationId/administer', '투약 실시 기록'],
    ['modules/workgroup/workgroup.controller.ts', 'GET ward/patients/:doctorId', '병동 환자 목록'],
    ['modules/surgery/surgery-advanced.controller.ts', 'GET :surgeryId/checklist', '수술안전 체크리스트'],
    ['modules/cost-analysis/cost-analysis.controller.ts', 'GET analytics/profitability', '부서 수익성'],
    ['modules/triage/triage.controller.ts', 'POST evaluate', 'KTAS 분류 판정'],
    ['modules/gld/governance.controller.ts', 'GET decisions', '거버넌스 결정 목록'],
    ['modules/access-control/access-control.controller.ts', 'GET pacs/permissions', 'PACS 권한 설정'],
    ['modules/fhir/fhir.controller.ts', 'POST Patient', 'FHIR 환자 생성'],
    ['modules/fhir/fhir.controller.ts', 'GET CarePlan', 'FHIR 케어플랜'],
    ['modules/fhir-full/fhir-full.controller.ts', 'GET Observation/smoking-status/:patientId', 'FHIR 흡연상태'],
    // ── E3(2026-09-16): D4 가 남긴 122 를 한 건씩 판정해 20 을 닫았다 ──
    ['modules/document/document.controller.ts', 'GET pdf/:issueNo', '발급 문서 PDF(진단서 등 PHI)'],
    ['modules/order/order.controller.ts', 'GET', '전 환자 오더 목록'],
    ['modules/waiting-queue/waiting-queue.controller.ts', 'GET', '대기열(환자 식별)'],
    ['modules/waiting-queue/waiting-queue.controller.ts', 'GET stats', '대기 통계'],
    ['modules/waiting-queue/waiting-queue.controller.ts', 'SSE events', '대기열 실시간 신호'],
    ['modules/floor/floor.controller.ts', 'GET entities/:floorId', '층별 동선 개체'],
    ['modules/floor/floor.controller.ts', 'GET history/:entityId', '개체 이동 이력'],
    ['modules/floor/floor.controller.ts', 'SSE events/:floorId', '동선 실시간 스트림'],
    ['modules/metaverse/metaverse.controller.ts', 'SSE stream', '위치 스트림(형제 GET 은 임상 3역할)'],
    // ── H3(2026-09-16): E3 가 남긴 102 를 한 건씩 판정 ──
    ['modules/concierge/concierge.controller.ts', 'PATCH sessions/:sessionId/rate', '만족도 평가(형제 close 는 4역할인데 혼자 누락 · ADMIN 지표로 집계된다)'],
  ])('%s %s — %s 는 전 직원 개방이 아니다', (file, ep) => {
    expect(gated(file, ep).openToEveryStaffRole).toBe(false);
  });

  it('🔴 대조군 — 일부러 연 자기 스코프 EP 는 여전히 열려 있다(막는 가드가 아니라 동결 가드다)', () => {
    // 본인 프로필·내 기기 토큰은 전 직원이 부르는 것이 답이다(§5)
    expect(gated('modules/auth/auth.controller.ts', 'GET me').openToEveryStaffRole).toBe(true);
    expect(gated('modules/mobile/push-token.controller.ts', 'PUT staff/push-token').openToEveryStaffRole).toBe(true);
  });

  /**
   * 🔴 E3 대조군 — **닫는 것이 답이 아닌 것**까지 닫지 않았다.
   *    사이드바(전 직원이 자기 메뉴를 그린다)·공용 코드 마스터(오더·처방·간호기록 입력)·인쇄 감사(자기 행위 기록)는
   *    닫으면 전 직군의 화면이 403 을 본다. 서비스가 주체를 좁히는 것(자격=본인만·i18n 검수자 명부)도 그대로 둔다.
   */
  it.each([
    ['modules/access-control/access-control.controller.ts', 'GET menu-overrides', '사이드바가 부른다'],
    ['modules/access-control/access-control.controller.ts', 'GET dept-access', '사이드바가 부른다'],
    ['modules/code-master/code-master.controller.ts', 'GET medication', '공용 약품 코드'],
    ['modules/code-master/code-master.controller.ts', 'GET diagnosis', '공용 진단 코드'],
    ['modules/audit/audit.controller.ts', 'POST print-event', '자기 인쇄 시도 기록'],
    ['modules/staff-qualification/staff-qualification.controller.ts', 'GET credentials', '서비스가 비ADMIN=본인만'],
    ['modules/i18n-review/i18n-review.controller.ts', 'GET review', '서비스가 검수자 명부로 쓰기만 막는다'],
    ['modules/terminal/terminal.controller.ts', 'GET draft', '내 스냅샷'],
    // ── I(2026-09-21): 분모 결손으로 **판정된 적 없던** 자리. 근거를 적고 연 채로 둔다 ──
    // 🔴 `@Roles` 를 걸면 최소 권한 직군이 **모든 화면에서** 403 배너를 본다(컨트롤러 머리말에 그 근거가 있다).
    //    담기는 것은 운영 모드 이름뿐이고 PHI 가 아니다. 변경(PUT)은 ADMIN.
    ['common/his-mode/his-mode.controller.ts', 'GET', '운영 모드 조회 — 전 화면 크롬이 읽는다'],
    // 🔴 진료표·휴진은 의사 이름·과·시간대뿐이다(`select: id/familyName/givenName/role` · 환자 데이터 없음).
    //    접수·간호·외래·전광판이 전부 부른다. **환자가 실리는 형제**(`clinic-closure/affected/:date`
    //    = 휴진이 닿는 기존 예약)만 ADMIN·RECEPTIONIST 로 이미 좁혀져 있다 — 성격이 갈린 자리다.
    ['modules/clinic-schedule/clinic-schedule.controller.ts', 'GET api/v1/clinic-schedule', '전체 진료표'],
    ['modules/clinic-schedule/clinic-schedule.controller.ts', 'GET api/v1/clinic-schedule/today', '오늘 진료 의사'],
    ['modules/clinic-schedule/clinic-schedule.controller.ts', 'GET api/v1/clinic-schedule/week', '주간 진료표'],
    ['modules/clinic-schedule/clinic-schedule.controller.ts', 'GET api/v1/clinic-closure', '휴진 목록'],
  ])('%s %s — %s 는 열린 채로 둔다', (file, ep) => {
    expect(gated(file, ep).openToEveryStaffRole).toBe(true);
  });

  /**
   * 🔴 (2026-09-21 I) 같은 컨트롤러에서 **환자가 실리는 형제**는 계속 좁혀져 있다 —
   *    "진료표는 열고 그 휴진에 걸린 예약은 닫는다"가 이 자리의 판정이다. 대조군이 없으면
   *    나중에 `affected` 의 `@Roles` 가 사라져도 위 목록은 그대로 통과한다.
   */
  it('🔴 대조군 — 휴진이 닿는 예약(환자 명단)은 열려 있지 않다', () => {
    const r = gated('modules/clinic-schedule/clinic-schedule.controller.ts', 'GET api/v1/clinic-closure/affected/:date');
    expect(r.openToEveryStaffRole).toBe(false);
    expect(r.roles).toContain('RECEPTIONIST');
  });

  /**
   * 🔴 ERP 핸드오프 **두 경로**는 역할 데코레이터가 아니라 **본문 게이트**로 좁힌다.
   *    종전 token 방식은 화면이 버튼을 숨기는 것이 전부였고 서버 게이트를 지나지 않아, 허용 역할 밖(NURSE)도
   *    ERP 계정이 만들어졌다(상대 팀 실호출). 면제를 이름으로만 적어 두면 **좁히는 코드를 지워도 초록**이라,
   *    여기서 그 코드가 실제로 있는지 본다(동작 판정은 `test/auth/erp-sso-handoff.spec.ts`).
   */
  it('🔴 ERP 핸드오프 2경로 — 같은 본문 게이트를 지난다(대조 코드 확인)', () => {
    for (const ep of ['POST erp-sso', 'POST erp-sso-token']) {
      expect(gated('modules/auth/auth.controller.ts', ep).openToEveryStaffRole).toBe(true);
    }
    const src = stripComments(readFileSync(join(process.cwd(), 'src/modules/auth/auth.controller.ts'), 'utf8'));
    const calls = src.match(/await this\.assertErpAccess\(/g) ?? [];
    expect(calls.length, 'ERP 접근 게이트 호출이 두 경로에 다 있지 않다').toBe(2);
  });

  /**
   * 🔴 H3 — **역할로는 안 막고 서비스가 소유로 좁히는** 자리. 이 목록에 남아 있는 것이 맞다(역할 게이트가 답이 아니다).
   *    다만 "목록에 있으니 안전하다"고 읽지 않도록 못박는다 — 소유 대조가 **실제로 동작하는지**는
   *    `test/authz/h3-self-scope-ownership.spec.ts` 가 목으로 본다(조건을 지우면 그쪽이 실패한다).
   *    E3 는 이 셋을 "D2 축" 이라며 넘겼고, 넘긴 자리에서 남의 설치키 폐기·남의 QR 세션 열람이 나왔다.
   */
  it.each([
    ['modules/mobile/app-key/app-key.controller.ts', 'GET :appKeyId/status'],
    ['modules/mobile/app-key/app-key.controller.ts', 'DELETE :appKeyId'],
    ['modules/qr/qr.controller.ts', 'GET sessions/:id'],
  ])('%s %s — 역할이 아니라 소유로 좁힌다(동작 가드는 별도 스펙)', (file, ep) => {
    expect(gated(file, ep).openToEveryStaffRole).toBe(true);
  });

  /**
   * 🔴 I1 — **한 파일에 `@Controller` 가 둘 이상**인 경우. 종전 스캐너는 `@Controller` 앞 800자 고정 창을
   *    클래스 데코레이터로 읽어 **앞 클래스의 `@UseGuards`·`@Roles` 를 뒤 클래스에 붙였다**.
   *    실측 피해: 공개 문진표 3EP(무인증 쓰기 2 포함)와 ERP 정산 회신이 "인증됨"으로 오판돼
   *    무인증 동결 목록에서 통째로 빠져 있었다 — 140 은 실제로 144 였다
   *    (그리고 2026-09-21 I 에서 **151** 이 됐다 — 같은 기전이 두 번 더 있었다).
   *    이 세션에서 같은 함정이 네 번 났다(D2 71→55 · E2 동명 핸들러 · G2 표식 스캔 · H2 throttle 판정).
   */
  it('🔴 뒤 클래스가 앞 클래스의 가드를 주워 인증된 척하지 않는다(문진표 공개 클래스)', () => {
    const pub = rows.filter((r) => r.prefix === '/api/v1/questionnaires');
    expect(pub.length).toBe(3);
    for (const r of pub) {
      expect(r.authed, `${r.ep} 가 인증된 것으로 잡혔다 — 앞 클래스의 @UseGuards 를 주웠다`).toBe(false);
      expect(r.roles, `${r.ep} 가 앞 클래스의 @Roles 를 주웠다`).toBe('');
    }
    // 같은 파일의 앞 클래스는 계속 인증된 것으로 잡힌다(대조군 — 되감기를 너무 좁혀 가드를 잃지 않았다)
    const authed = rows.filter((r) => r.file.includes('questionnaire.controller') && r.prefix === '/api/v1');
    expect(authed.length).toBeGreaterThan(0);
    for (const r of authed) expect(r.authed).toBe(true);
  });

  it('🔴 대조군 — 주석이 낀 클래스 데코레이터를 잃지 않는다(`@UseGuards` → JSDoc → `@Roles` → `@Controller`)', () => {
    // 주석을 걷으면 데코레이터 사이에 빈 줄이 남는다. 빈 줄에서 되감기를 멈추면
    // 인증된 컨트롤러 수십 개가 한꺼번에 "공개"로 뒤집힌다(실측: 무인증 140 → 296).
    const r = gated('modules/cancer-registry/cancer-registry.controller.ts', 'GET stats');
    expect(r.authed).toBe(true);
    expect(r.roles).toContain('ADMIN');
  });

  it('클래스 @Roles 를 핸들러 @Roles 가 덮는 런타임 규약을 그대로 읽는다', () => {
    // RolesGuard: handlerRoles ?? classRoles — 핸들러 선언이 있으면 클래스는 보지 않는다
    const r = gated('modules/mdt/mdt.controller.ts', 'PATCH attendees/:id');
    expect(r.roles).toContain('NURSE'); // 클래스(ADMIN·DOCTOR)가 아니라 핸들러 선언이 유효하다
  });
});

/**
 * 🔴 스캐너 자신에 대한 가드 — 분모가 틀리면 결론이 통째로 거짓이 된다.
 *
 * 실측(2026-09-16): 종전 정규식 주석 제거기는 `fhir.controller.ts` 의 설명 문자열 안에 있는 `(system/*)` 를
 * 주석 시작으로 읽고 다음 JSDoc 종료까지 **9,057자를 지웠다** — `/fhir/R4/Patient` 4개 라우트가 분모에서 사라졌다.
 * 같은 함수를 쓰는 `role-endpoint-scan.ts` 도 이 구간을 보지 못한다.
 */
describe('🔴 주석 제거기는 문자열 안의 `/*` 를 주석으로 읽지 않는다', () => {
  it('문자열 안 `/*` 뒤의 코드가 살아남는다', () => {
    const src = [
      "const d = 'scope (system/*) 설명';",
      '/** 진짜 JSDoc */',
      "@Get('Patient')",
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain("@Get('Patient')");
    expect(out).not.toContain('진짜 JSDoc');
  });

  it('실파일 대조 — FHIR Patient 4개 라우트가 스캔에 잡힌다', () => {
    const eps = scanHandlerAuthz()
      .filter((r) => r.file === 'modules/fhir/fhir.controller.ts' && /Patient/.test(r.ep))
      .map((r) => r.ep)
      .sort();
    expect(eps).toEqual(['GET Patient', 'GET Patient/:id', 'POST Patient', 'PUT Patient/:id']);
  });

  it('줄 주석·블록 주석은 계속 걷힌다(대조군)', () => {
    expect(stripComments('// @Roles(UserRole.ADMIN)\nconst a = 1;')).not.toContain('@Roles');
    expect(stripComments('/* @Roles(UserRole.ADMIN) */\nconst a = 1;')).not.toContain('@Roles');
  });
});
