import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EVERY_STAFF_ROLE, USER_ROLE_LABEL } from '@hospital-run/shared';

import { SAFETY_REVIEW_API_ROLES } from '../../src/app/(main)/safety/safety-access';
import { DEPT_QUEUES, MY_QUEUE_ROLES } from '../../src/app/(main)/clinic-queue/queue-access';
import { JOURNEY_BOARD_ROLES, COMMAND_CENTER_ROLES } from '../../src/app/(main)/command-center/journey-access';

/**
 * 화면 역할 게이트 ↔ 서버 `@Roles` 기계 대조 (2026-08-27)
 *
 * 🔴 실측: nav 는 화면을 여는데 그 화면이 부르는 EP 가 403 이라 **사용자가 자기 계정을
 *    고장난 것으로 읽는** 자리가 있었다. `/safety`(통계 5종)·`/clinic-queue`(부서 큐 3종+내 대기열)·
 *    `/command-center`(여정 보드). 판정 규칙은 **"EP 를 여는 것이 항상 답은 아니다"** — 화면이 접는다.
 *
 * 🔴 그러면 화면에 서버 역할 목록의 **사본**이 생긴다. 사본은 갈라진다(v4.6.0: FE 에 지어낸 어휘가
 *    서버와 교집합 0 이었고 내 가드가 내 어휘를 테스트해 통과했다). 그래서 이 가드는 FE 상수를
 *    **컨트롤러 소스에서 파싱한 실제 `@Roles`** 와 대조한다 — 한쪽만 바뀌면 실패한다.
 *
 * 재주입 검증:
 *   · FE 목록에 역할을 추가하거나 빼면 → 해당 대조가 실패
 *   · 서버 `@Roles` 를 바꾸면 → 같은 대조가 실패
 *   · 파서가 아무것도 못 찾으면 → "파싱 자체가 실패" it 이 먼저 실패(빈 집합끼리 통과 방지)
 */

const API = path.join(__dirname, '..', '..', '..', 'api', 'src', 'modules');
const read = (rel: string) => fs.readFileSync(path.join(API, rel), 'utf8');

/** `@Roles(UserRole.A, UserRole.B)` → ['A','B'] */
function parseRoles(decorator: string): string[] {
  return Array.from(decorator.matchAll(/UserRole\.([A-Z_]+)/g)).map((m) => m[1]);
}

/** 클래스 레벨 `@Roles(...)` — `@Controller(` 바로 앞에 붙은 것 */
function classRoles(source: string): string[] {
  const idx = source.indexOf('@Controller(');
  expect(idx).toBeGreaterThan(-1);
  const head = source.slice(0, idx);
  const m = head.match(/@Roles\(([^)]*)\)\s*$/m) ?? head.match(/@Roles\(([^)]*)\)[^@]*$/);
  return m ? parseRoles(m[0]) : [];
}

/** `@Get('<route>')` 핸들러에 붙은 `@Roles(...)`; 없으면 null(=클래스 레벨 적용) */
function handlerRoles(source: string, route: string): string[] | null {
  const at = source.indexOf(`@Get('${route}')`);
  expect(at).toBeGreaterThan(-1);
  // 데코레이터 블록 = @Get 다음부터 `async `/`  <이름>(` 까지
  const after = source.slice(at, at + 600);
  const body = after.split(/\n\s*(?:async\s+)?[a-zA-Z_]+\s*\(/)[0];
  const m = body.match(/@Roles\(([^)]*)\)/);
  return m ? parseRoles(m[0]) : null;
}

const sorted = (a: readonly string[]) => [...a].sort();

describe('/safety — 전담인력 탭이 부르는 EP 의 역할 게이트', () => {
  const src = read('patient-safety/patient-safety.controller.ts');

  it('파서가 실제로 무언가를 읽었다(빈 집합끼리 통과 방지)', () => {
    expect(classRoles(src).length).toBeGreaterThan(0);
  });

  it('FE 판정 목록 = 컨트롤러 클래스 레벨 @Roles', () => {
    expect(sorted(SAFETY_REVIEW_API_ROLES)).toEqual(sorted(classRoles(src)));
  });

  it('통계·RCA 5종은 핸들러 @Roles 로 넓히지 않는다(클래스 레벨이 곧 게이트)', () => {
    for (const route of ['incidents/stats', 'identification-check/stats', 'read-back/pending', 'restraints/active', 'rca']) {
      const h = handlerRoles(src, route);
      // null = 클래스 레벨 적용. 핸들러가 따로 선언했다면 클래스 레벨과 같아야 한다.
      if (h !== null) expect(sorted(h)).toEqual(sorted(classRoles(src)));
    }
  });
});

describe('/clinic-queue — 부서 큐·내 대기열', () => {
  const files: Record<string, string> = {
    lab: read('lab/lab.controller.ts'),
    imaging: read('imaging/imaging.controller.ts'),
    pharmacy: read('pharmacy/pharmacy.controller.ts'),
  };

  it('파서가 실제로 무언가를 읽었다', () => {
    for (const src of Object.values(files)) expect(classRoles(src).length).toBeGreaterThan(0);
  });

  it('FE 부서 큐 역할 사본 = 각 컨트롤러의 실제 게이트', () => {
    for (const d of DEPT_QUEUES) {
      const src = files[d.key];
      const server = handlerRoles(src, 'queue') ?? classRoles(src);
      expect(sorted(d.roles), `${d.key}/queue`).toEqual(sorted(server));
    }
  });

  it('FE `queue/my` 역할 사본 = waiting-queue 컨트롤러의 핸들러 @Roles', () => {
    const src = read('waiting-queue/waiting-queue.controller.ts');
    const server = handlerRoles(src, 'my');
    expect(server).not.toBeNull();
    expect(sorted(MY_QUEUE_ROLES)).toEqual(sorted(server!));
  });
});

describe('/command-center — 여정 보드', () => {
  const src = read('journey-console/journey-console.controller.ts');

  it('FE 판정 목록 = journey-console 클래스 레벨 @Roles(경영 관제)', () => {
    const server = classRoles(src);
    expect(server.length).toBeGreaterThan(0);
    expect(sorted(JOURNEY_BOARD_ROLES)).toEqual(sorted(server));
  });

  it('board 핸들러가 클래스 게이트를 넓히지 않는다', () => {
    expect(handlerRoles(src, 'board')).toBeNull();
  });
});

describe('/admin/access-control — 역할 목록 정본', () => {
  const SRC = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'admin', 'access-control', 'page.tsx');
  const page = fs.readFileSync(SRC, 'utf8');
  /** 주석은 제외하고 본다 — "예전에 이랬다"는 설명이 위반으로 잡히면 안 된다 */
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 시스템 역할을 손으로 나열하지 않는다 — shared 정본을 쓴다', () => {
    expect(page).toContain('EVERY_STAFF_ROLE');
    expect(page).toContain('USER_ROLE_LABEL');
    // 재주입: 종전 5역할 하드코딩이 되살아나면 실패한다
    expect(code).not.toMatch(/\[\s*'ADMIN',\s*'DOCTOR',\s*'NURSE',\s*'PHARMACIST',\s*'LAB_TECH'/);
    // 로컬 역할 라벨표 재정의 금지(FE 표현 단위 규약)
    expect(code).not.toContain('FROLE_LABEL');
  });

  it('🔴 레거시 `dept.*` 항목을 지우지 않는다(운영 데이터가 그 키로 저장돼 있다)', () => {
    expect(code).toContain('LEGACY_DEPT_ROLES');
    for (const d of ['원무과', '행정과', '급양과', '의무기록과', '경영진']) {
      expect(page).toContain(`dept.${d}`);
    }
    // 서버 응답에만 있는 dept.* 키도 살려 낸다(하드코딩 5개가 전부라고 가정하지 않는다)
    expect(page).toMatch(/startsWith\('dept\.'\)/);
  });

  it('대조군: shared 정본 자체가 14역할이고 라벨과 집합이 같다', () => {
    expect(EVERY_STAFF_ROLE.length).toBe(14);
    expect(sorted(EVERY_STAFF_ROLE)).toEqual(sorted(Object.keys(USER_ROLE_LABEL)));
  });
});


describe('/command-center 자체 — 대시보드의 병원 상황 요약·상황판 링크 게이트(2026-10-02)', () => {
  const src = read('command-center/command-center.controller.ts');
  it('FE 목록 = 상황판 컨트롤러 클래스 레벨 @Roles(못 여는 역할에게 길을 내지 않는다)', () => {
    expect(classRoles(src).length).toBeGreaterThan(0);
    expect(sorted(COMMAND_CENTER_ROLES)).toEqual(sorted(classRoles(src)));
  });
  it('nav 의 상황판 역할도 같은 집합이다', () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'layout', 'Sidebar.tsx'), 'utf8');
    const m = nav.match(/href: '\/command-center',[^\n]*roles: \[([^\]]*)\]/);
    expect(m, 'nav 항목을 찾지 못했다').not.toBeNull();
    const navRoles = Array.from(m![1].matchAll(/'([A-Z_]+)'/g)).map((x) => x[1]);
    expect(sorted(navRoles)).toEqual(sorted(COMMAND_CENTER_ROLES));
  });
});
