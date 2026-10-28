import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanMismatches } from './role-endpoint-scan';
import { allGateIdentifiers, triggerGated } from '../../../../scripts/screen-call-gate.mjs';

/**
 * 🔴 **화면↔서버 역할 미스매치 150 을 한 건씩 판정했다** (2026-09-17 · 갈래 L3).
 *
 * K3 이 전수 가드의 사각 둘(비재귀 수집·화면 단위 제외)을 고치자 미스매치가 5 → **150** 이 됐다.
 * 그 150 은 결함 150 이 아니었다 — **가드가 게이트를 못 보는 자리가 대부분**이었다.
 *
 * ── 분해(150) ────────────────────────────────────────────────────────────────
 *  ① 화면이 **다른 층에서 이미 막는다** — 가드가 못 보던 자리. 59 (아래 정본 수정으로 회수)
 *     · 호출 자리 바로 위 `const canX = useHasRole(...)`  (`/icu` 퇴실·`/blood-bank` 입고·`/diagnostics`)
 *     · **JSX 트리거**에만 게이트  (`/inpatient` `{isNurse && <button onClick={() => handleTransfer(a)}`
 *       ·`/workstation/consent` `isDoctor ?`·`/workstation/documents` `canAuthor`·`/consultations` `canAct`
 *       ·`/chemo` `canOrder`·`/admin/triage` `canWrite`)
 *     · **컴포넌트 경계 밖** 게이트 — `/pathology` 는 `canDiagnose` 가 아니면 `ReportForm` 자체를
 *       렌더하지 않고 "판독 보고서 작성·서명은 병리의 권한입니다"라고 **말하기까지** 한다.
 *     · 역할별 레이아웃·탭 — `/dashboard`(역할별 기본 레이아웃 + 위젯 `roles` + `WidgetForbidden`)
 *       ·`/safety`(`safety-access.ts` 역할 AND 권한)·`/staff-meal`(403 조용히 숨김 + 관리 섹션 조기 반환)
 *  ② **화면은 조건 없이 부르는데 EP 가 그 역할을 뺐다** — 11 봉합(아래)
 *  ③ 사람 결정 — 15 (`/orders` 9·`/workstation/therapy` 4·`/his-checkup/ws` 2). 아래 주석에 근거.
 *  ④ 관리 화면 ADMIN 전용 쓰기(2026-08-30 보류분) — `/admin/opening` 8·`/consent/templates`·`/quality` 등.
 *
 * 🔴 **①을 "제외"가 아니라 "판정 근거"로 남긴다.** K3 이 화면 단위로 제외했다가 `/billing` 7EP 를
 *    통째로 가렸다 — 그래서 여기서는 정본(`screen-call-gate.mjs`)이 **게이트를 실제로 찾아** 세고,
 *    못 찾으면 미스매치로 남겨 사람이 판정하게 한다(하한 유지).
 */
const web = (p: string) => readFileSync(join(process.cwd(), '..', 'web', 'src', 'app', '(main)', p), 'utf8');

describe('🔴 L3 ① 정본이 "호출은 위·게이트는 JSX" 를 따라간다', () => {
  it('/inpatient 전동 — `{isNurse && <button onClick={() => handleTransfer(a)}` 를 게이트로 읽는다', () => {
    const src = web('inpatient/page.tsx');
    const i = src.indexOf('/api/v1/inpatient/${id}/transfer');
    expect(i, '전동 호출을 찾지 못했다').toBeGreaterThan(-1);
    expect(triggerGated(src, i), '트리거 게이트를 놓쳤다 — 이미 막힌 자리가 미스매치로 올라온다').toBeTruthy();
  });

  it('대조군 — 게이트 식별자가 없는 파일에서는 트리거 게이트를 만들어내지 않는다', () => {
    const fake = "const save = useMutation({ mutationFn: () => apiClient.post('/api/v1/x') });\n<button onClick={() => save.mutate()} />";
    expect(allGateIdentifiers(fake)).toEqual([]);
    expect(triggerGated(fake, fake.indexOf('/api/v1/x'))).toBeNull();
  });

  it('🔴 대조군 — 게이트가 **다른 컴포넌트**에 있으면 게이트로 읽지 않는다(하한 유지)', () => {
    // `/pathology` 는 canDiagnose 로 ReportForm 자체를 렌더하지 않지만, 호출은 다른 컴포넌트에 있다.
    // 가드는 그것을 "게이트 있음"이라 말하지 않는다 — 넓히면 결함이 조용히 빠진다.
    const src = web('pathology/page.tsx');
    const i = src.indexOf("'/api/v1/pathology/reports', payload");
    expect(i).toBeGreaterThan(-1);
    expect(triggerGated(src, i)).toBeNull();
  });
});

/**
 * 🔴 L3 ② 봉합 — **화면이 그 역할에게 그릴 수 없는 버튼을 그리던 자리** 11.
 *    방향은 전부 "화면이 감춘다" 다(§5 임상 정보는 화면이 부르지 않는 쪽) — 서버 `@Roles`·권한은
 *    그대로 둔다. 각 서버 판정은 이미 문서화된 것이라 **뒤집지 않았다.**
 */
describe('🔴 L3 ② 비대면진료 — 화상 제안·수락·상담 종료는 의사 행위다', () => {
  const src = web('remote-consult/page.tsx');
  it('canConduct = useHasRole(DOCTOR) 로 막는다(서버 @Roles(DOCTOR, ADMIN) 과 같은 집합)', () => {
    expect(src).toMatch(/const canConduct = useHasRole\('DOCTOR'\)/);
    expect((src.match(/\{canConduct && detail\.status !== 'COMPLETED'/g) ?? []).length).toBe(2);
  });
  it('대조군 — 답변(reply)까지 막지 않았다(간호 업무 · 서버도 열려 있다)', () => {
    expect(src).toContain('/reply');
    expect(src, '답변까지 의사 전용으로 좁혔다').not.toMatch(/canConduct[^\n]*replyMut/);
  });
});

describe('🔴 L3 ② 검사실 — 세포치료제 출하·유전상담은 의사 판단이다', () => {
  it('세포치료제 출하 승인이 canRelease 로 막힌다', () => {
    const src = web('lab/components/CellTherapyTab.tsx');
    expect(src).toMatch(/const canRelease = useHasRole\('DOCTOR'\)/);
    expect(src).toMatch(/\{canRelease && detail\.status === 'QC_TESTING'/);
  });
  it('대조군 — 제조·QC·환경기록은 그대로 검사기사 업무다', () => {
    const src = web('lab/components/CellTherapyTab.tsx');
    for (const ep of ['/qc', '/environment']) expect(src).toContain(ep);
    expect(src, 'QC 까지 의사 전용으로 좁혔다').not.toMatch(/canRelease[^\n]*qcMut/);
  });
  it('유전상담 기록이 canCounsel 로 막힌다(입력 폼·열기 버튼 모두)', () => {
    const src = web('lab/components/GenomicsTab.tsx');
    expect(src).toMatch(/const canCounsel = useHasRole\('DOCTOR'\)/);
    expect(src).toMatch(/\{canCounsel && !showCounselForm/);
    expect(src).toMatch(/\{canCounsel && showCounselForm/);
  });
});

describe('🔴 L3 ② 영상실 — AI 판독 실행은 판독 주체의 행위다', () => {
  const src = web('imaging/components/StudiesTab.tsx');
  it('AI 분석 버튼이 canRunAi 로 막힌다', () => {
    expect(src).toMatch(/const canRunAi = useHasRole\('DOCTOR'\)/);
    expect(src).toMatch(/\{canRunAi && <button onClick=\{\(\) => handleAiInference/);
  });
  it('대조군 — OHIF 뷰어 열기는 검사기사에게 그대로 열려 있다', () => {
    expect(src).toMatch(/<button onClick=\{\(\) => openOhif/);
    expect(src, '뷰어까지 막았다').not.toMatch(/canRunAi && <button onClick=\{\(\) => openOhif/);
  });
});

describe('🔴 L3 ② 응급 보호자 등록 — PatientContact 쓰기는 원무 권한이다', () => {
  const src = web('emergency/components/BedBoard.tsx');
  it('등록 버튼이 canRegisterGuardian(NURSE·RECEPTIONIST·ADMIN) 으로 막힌다', () => {
    expect(src).toMatch(/const canRegisterGuardian = useHasRole\('NURSE', 'RECEPTIONIST'\)/);
    expect(src).toMatch(/canRegisterGuardian \? \(/);
  });
  it('🔴 막되 사실은 남긴다 — 등록 권한이 없어도 "보호자 미등록"은 계속 보인다', () => {
    expect(src, '버튼만 지워 미등록 사실까지 사라졌다').toMatch(/<T k="보호자 미등록" \/>/);
  });
});

describe('🔴 L3 ② 검진 데스크 — 예약·접수·상태·추적은 검진 데스크 권한이다', () => {
  const canon = readFileSync(join(process.cwd(), '..', 'web', 'src', 'app', '(main)', 'his-checkup', 'checkup-access.ts'), 'utf8');

  it('정본이 서버와 같은 권한 쌍을 OR 로 본다(역할 사본을 화면에 적지 않는다)', () => {
    expect(canon).toContain("'patient:edit'");
    expect(canon).toContain("'checkup:manage'");
    expect(canon).toMatch(/byPatientEdit \|\| byCheckupManage/);
    const api = readFileSync(join(process.cwd(), 'src/modules/checkup/checkup.controller.ts'), 'utf8');
    expect(api, '서버가 이 쌍을 요구하지 않는다 — 정본이 갈라졌다')
      .toMatch(/@RequirePermission\(Permission\.PATIENT_EDIT, Permission\.CHECKUP_MANAGE\)/);
  });

  for (const [file, gate] of [
    ['his-checkup/schedule/page.tsx', /\{canManage && v\.status === 'RESERVED'/],
    ['his-checkup/waiting/page.tsx', /\{canManage && NEXT\[col\.key\]/],
    ['his-checkup/follow-ups/page.tsx', /: !canManage \? \(/],
  ] as const) {
    it(`${file} — 쓰기 버튼이 정본 판정으로 막힌다`, () => {
      const src = web(file);
      expect(src).toContain("useCanManageCheckupVisit");
      expect(src).toMatch(gate);
    });
  }

  it('🔴 조회는 막지 않았다 — 의사는 예약·진행 현황을 계속 본다(막으면 방치된다)', () => {
    const src = web('his-checkup/waiting/page.tsx');
    expect(src, '목록 조회까지 권한으로 막았다').not.toMatch(/canManage[^\n]*useQuery/);
  });

  it('예약 화면은 왜 버튼이 없는지 말한다(빈 자리는 "기능이 없다"로 읽힌다)', () => {
    expect(web('his-checkup/schedule/page.tsx')).toContain('CHECKUP_WRITE_NOTICE');
  });
});

/**
 * 🔴 L3 ③ **고치지 않고 사람 결정으로 남긴 것** — 근거를 여기 적어 다음 회차가 다시 파지 않게 한다.
 *  · ✅ (2026-09-29 해소 — 사람 결정 없이) `/orders` 비의사 입력: 진료를 **새로 열지 않고** 진행 중 진료(재원 입원 → 오늘 진료)에
 *    붙인다(`GET /patients/:id/order-encounter`). 담당의 귀속 질문(누구 이름으로 진료를 여는가)이 생기지 않는다 — 진료 개시는 의사 몫으로 그대로.
 *    아래 옛 서술은 이력으로 남긴다. 재활 세션 시작·완료는 사용자 요청("물리치료사 등도 각자 권한으로")으로 치료 직종에 열었다(직종 게이트 · 임상병리사는 불가).
 *  · (이력) `/orders` NURSE 9 — 화면 주석이 "간호사(구두처방 대리입력)·임상병리사(워크인 검사)가 **입력**은
 *    할 수 있다"고 선언하고 `usePrescriberDelegate`(책임 처방의 지정) 기계까지 배선돼 있다. 그런데
 *    그 흐름의 **첫 걸음**인 `POST /api/v1/encounters` 가 `@Roles(DOCTOR, ADMIN)` 이고, 그 핸들러는
 *    `@CurrentUser('id')` 를 **담당의로** 기록한다 — 간호사가 만들면 간호사가 담당의가 된다.
 *    → 화면을 좁히면 문서화된 설계를 뒤집고, 서버를 열면 담당의 귀속이 틀어진다. **사람 결정**이다
 *      (대리 생성 계약: 진료를 "누구의 이름으로" 만들 것인가).
 *  · `/workstation/therapy` LAB_TECH 4 — 투석·재활 세션 시작·완료가 `@Roles(DOCTOR, NURSE, ADMIN)`.
 *    nav 는 치료실을 ADMIN·NURSE·**LAB_TECH** 에 연다. 누가 치료를 시행·기록하는가는 원내 정책이다.
 *  · `/his-checkup/ws` LAB_TECH 2 — 검사실 허브(nav ADMIN·NURSE·LAB_TECH)의 도착·완료가
 *    `ENCOUNTER_EDIT` 를 요구하는데 LAB_TECH 는 그 권한이 없다. 검진 스테이션 시행자 정책이다.
 */
describe('🔴 L3 ③ 사람 결정으로 남긴 자리는 기준선에 남아 있다(조용히 사라지지 않는다)', () => {
  const current = scanMismatches();
  for (const key of [
    '/workstation/therapy|PATCH /api/v1/dialysis/sessions/:x/start|LAB_TECH',
    '/his-checkup/ws|POST /api/v1/checkup/ws/:x/arrive|LAB_TECH',
  ]) {
    it(`${key} — 사람 결정 대기(화면을 좁히지도 서버를 열지도 않았다)`, () => {
      expect(current, '사람 결정 자리가 기준선에서 사라졌다 — 누가 어느 방향으로 정했는지 적는다')
        .toContain(key);
    });
  }
});

describe('✅ /orders 비의사 입력 — 진료를 열지 않고 진행 중 진료에 붙는다(2026-09-29)', () => {
  const src = web('orders/page.tsx');
  it('비의사는 order-encounter 로 붙고, POST /encounters 는 의사·관리자 분기 안에만 있다', () => {
    expect(src).toMatch(/if \(isPrescriberRole\) \{\s*const res = await apiClient\.post<\{ data: \{ id: string \} \}>\('\/api\/v1\/encounters'/);
    expect(src).toContain('/order-encounter`');
  });
  it('비의사는 붙은 진료를 서명·수납하지 않는다(서명 버튼은 의사 분기)', () => {
    expect(src).toMatch(/\{isPrescriberRole \? \(\s*<button onClick=\{finish\}/);
  });
  it('기준선에서 간호사 진료 생성 미스매치가 사라졌다(되살아나면 비의사가 다시 403 에 막힌다)', () => {
    expect(scanMismatches().some((k) => k.startsWith('/orders|POST /api/v1/encounters|'))).toBe(false);
  });
});
