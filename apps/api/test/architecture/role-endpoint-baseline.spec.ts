import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHART_ACCESS_ROLES, CHART_CLINICAL_ROLES, TRANSFER_ACCESS_ROLES } from '@hospital-run/shared';
import { scanMismatches, scanControllers, makeLookup, scanNav, scanNavUnresolved, rolePerms, gatedCalls } from './role-endpoint-scan';

/**
 * 🔴 (2026-09-14) nav 항목의 전개식이 `'...CLINICAL'` 글자 그대로 담겨 19화면의 해당 역할이 대조에서 조용히 빠졌다.
 * 지키는 것: ① 전개식이 실제 역할로 풀린다(지역 상수·shared 정본) ② 글자 그대로의 `...` 역할이 하나도 없다
 *           ③ 풀지 못한 이름은 목록으로 동결(0 이어야 한다 — 늘면 그 화면의 역할은 아무도 대조하지 않는다)
 *           ④ 컨트롤러 `@Roles(...별칭)` 이 정책 파일 → shared 정본으로 풀린다(거짓 전 역할 미스매치 방지)
 */
describe('🔴 nav 전개식·컨트롤러 별칭을 실제 역할로 푼다', () => {
  const nav = scanNav();
  const rolesOf = (href: string) => [...(nav.find((i) => i.href === href)?.roles ?? [])].sort();

  it('① 전개식이 실제 역할로 풀린다', () => {
    expect(rolesOf('/patients')).toEqual([...CHART_ACCESS_ROLES].sort());
    expect(rolesOf('/patient-messages')).toEqual([...CHART_CLINICAL_ROLES].sort());
    expect(rolesOf('/transfer')).toEqual([...TRANSFER_ACCESS_ROLES].sort());
    expect(rolesOf('/clinic-queue')).toEqual(['ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST']);
  });

  it('② 글자 그대로의 전개식 역할이 없다', () => {
    const literal = nav.filter((i) => i.roles.some((r) => r.startsWith('...'))).map((i) => i.href);
    expect(literal).toEqual([]);
  });

  it('③ 풀지 못한 전개식 목록(동결 — 0)', () => {
    expect(scanNavUnresolved()).toEqual([]);
  });

  it('④ 컨트롤러 @Roles(...별칭) 이 shared 정본으로 풀린다', () => {
    const inbox = makeLookup(scanControllers())('GET /api/v1/patient-messages/inbox');
    expect(inbox, '핸들러를 못 찾았다').not.toBeNull();
    expect([...inbox!.roles].sort()).toEqual([...CHART_CLINICAL_ROLES].sort());
    expect(inbox!.roles.some((r) => r.startsWith('__UNRESOLVED_'))).toBe(false);
  });
});

/**
 * 🔴 **역할×화면×EP 기준선 동결** (2026-08-30 · 발굴 20회차 후속).
 *
 * 발굴 20회차가 nav × 화면 EP × 컨트롤러 교차로 실결함 4종을 찾았다(급양 워크스테이션 전건 404 ·
 * 직원 식수 5직군 403 · 검진 수납 6EP · P2025 전역 500). 고치고 남은 **잔여 후보**는 임상 직군에
 * 보이는 관리 화면의 ADMIN 전용 쓰기 버튼 등 **성격 판단이 필요한 것들**이라 일괄 개방하지 않았다.
 *
 * 이 가드는 그 잔여 집합을 **기준선으로 동결**한다:
 *   · 새 미스매치(화면은 여는데 EP 는 닫는 신규 코드) → **즉시 실패**
 *   · 미스매치를 고치면 → 기준선을 **줄이는 커밋을 강제**(여유를 두면 신규 위반을 흡수한다)
 *
 * 기준선 갱신: `ROLE_EP_BASELINE_WRITE=1 npx vitest run test/architecture/role-endpoint-baseline.spec.ts`
 * → 파일을 다시 쓰고, 그 diff 를 커밋에 담아 무엇이 늘고 줄었는지 리뷰 대상으로 만든다.
 */
const BASELINE_PATH = join(process.cwd(), 'test/architecture/role-endpoint-fit.baseline.json');
const SELF_GATED_PATH = join(process.cwd(), 'test/architecture/role-endpoint-fit.self-gated.json');

describe('🔴 스캐너 오라클 — 운영 실측과 일치해야 스캔을 믿는다', () => {
  const lookup = makeLookup(scanControllers());

  it('스캔이 실제로 컨트롤러·nav 를 읽었다(대조군)', () => {
    expect(scanControllers().length).toBeGreaterThan(250);
    expect(scanNav().length).toBeGreaterThan(250);
  });

  /** 2026-08-29 운영에서 실계정으로 눌러 확인한 사실들 — 스캐너 회귀를 여기에 묶는다 */
  const CASES: Array<[string, string, boolean]> = [
    ['GET /api/v1/nutrition/staff-menu', 'CHECKUP', true],    // 20회차에 열었다(200 실측)
    ['GET /api/v1/nutrition/staff-meal/my', 'EXECUTIVE', true],
    ['GET /api/v1/patient-flow/zone-stats', 'CHECKUP', true],
    ['GET /api/v1/checkup/visits', 'CHECKUP', true],          // CHECKUP_MANAGE 로 통과(OR ④)
    ['GET /api/v1/hospital-info', 'CHECKUP', false],          // 마스터 편집 — 일부러 닫아 둠(403 실측)
    ['GET /api/v1/nutrition/staff-meal/settlement', 'CHECKUP', false], // 급양과 정산 — 닫아 둠
    ['GET /api/v1/workstation/station/:x/queue', 'NUTRITION', true],   // 주석 오염(⑤) 회귀 감지
  ];
  for (const [ep, role, want] of CASES) {
    it(`${role} → ${ep} = ${want ? '허용' : '거부'}`, () => {
      const r = lookup(ep);
      expect(r, `${ep} 핸들러를 못 찾았다 — 스캐너나 라우트가 바뀌었다`).not.toBeNull();
      const rp = rolePerms(role);
      const roleOk = r!.roles.length === 0 || r!.roles.includes(role);
      const permOk = !r!.perm || rp === '*' ||
        (rp instanceof Set && [...r!.perm.matchAll(/Permission\.(\w+)/g)].some((x) => rp.has(x[1])));
      expect(roleOk && permOk, `roles=[${r!.roles}] perm=${r!.perm} @ ${r!.file}`).toBe(want);
    });
  }
});

/**
 * 🔴 **기준선의 수는 "결함 수"가 아니다.** 게이트 판정은 **호출 자리 문맥**(앞 10줄·뒤 8줄)만 본다 —
 *    호출이 핸들러 함수에 있고 게이트가 렌더 시점 JSX 에 있으면(예: `/patients` 의 CSV 반출은
 *    `{role === 'ADMIN' && …}` 안에 있다) 이 스캔은 그것을 보지 못하고 미스매치로 센다.
 *    그래서 기준선에는 **화면이 이미 감추는 자리**가 섞여 있다 — 판정은 `docs/04-report/screen-role-drift-2026-09-16.md`.
 *    지키는 것은 **늘지 않는다** 하나다.
 */
/**
 * 🔴 (2026-09-16 I1) **한 파일에 `@Controller` 가 둘 이상**일 때 클래스 `@Roles` 를 잘못 읽던 자리.
 *    종전 `at - 400` 고정 창은 앞 클래스의 본문까지 끌어와 **앞 클래스의 `@Roles` 를 뒤 클래스에 붙였다**
 *    (실측 8자리). 없는 역할 제한을 있다고 읽으면 이 스캐너의 판정("화면은 열렸는데 EP 는 닫혔다")이
 *    통째로 흔들린다 — 이 대조군이 없으면 고정 창으로 되돌려도 아무 가드가 실패하지 않는다(재주입으로 확인).
 */
describe('🔴 한 파일 다중 컨트롤러 — 뒤 클래스가 앞 클래스의 @Roles 를 주워오지 않는다', () => {
  // 같은 prefix 를 여러 파일이 쓴다(`/api/v1/patients` 는 6파일) — 파일까지 지정해 하나로 좁힌다
  const pick = (prefix: string, file: string) => {
    const hit = scanControllers().filter((c) => c.prefix === prefix && c.file.endsWith(file));
    expect(hit.length, `${prefix}(${file}) 컨트롤러를 찾지 못했다 — 옮겼으면 이 가드를 고친다`).toBe(1);
    return hit[0];
  };

  it.each([
    ['/api/v1/patients', 'modules/encounter/encounter.controller.ts'],
    ['/api/v1/questionnaires', 'modules/questionnaire/questionnaire.controller.ts'],
    ['/api/v1/admin/agency-integrations', 'modules/outbound-channel/outbound-channel.controller.ts'],
  ])('%s — 클래스 @Roles 가 없다(앞 클래스 것을 주워오면 실패)', (prefix, file) => {
    const c = pick(prefix, file);
    expect(c.classRoles, `${prefix} 가 앞 클래스의 @Roles 를 주웠다: ${c.classRoles.join(',')}`).toEqual([]);
  });

  it('대조군 — 자기 클래스 @Roles 는 그대로 읽는다', () => {
    expect(pick('/api/v1/cancer-registry', 'cancer-registry.controller.ts').classRoles.length).toBeGreaterThan(0);
  });
});

/**
 * 🔴 (2026-09-16 K3) **화면 단위 제외를 호출 단위로 바꿨다.**
 *    종전엔 버튼 하나만 역할로 감싸도 그 화면의 EP 가 전부 빠졌다 — 실측: `/billing` 은 예치금 버튼
 *    한 줄(`useHasRole('RECEPTIONIST','CHECKUP')`) 때문에 7개 EP 가 통째로 빠져 있었고, 그래서
 *    J2 가 실로그인으로 찾은 수납 드리프트(같은 자리 세 번째 재발)를 **이 전수 가드가 못 잡았다.**
 *    이제 빠지는 단위가 호출이라 **무엇이 빠졌는지** 목록으로 보인다.
 */
describe('🔴 대조에서 빠진 호출(게이트 달린 자리)도 동결한다 — 0쌍의 뜻을 정직하게 말한다', () => {
  it('게이트가 달려 대조에서 빠진 호출 집합이 기준선과 같다', () => {
    const current = gatedCalls();
    if (process.env.ROLE_EP_BASELINE_WRITE === '1') {
      writeFileSync(SELF_GATED_PATH, JSON.stringify(current, null, 2) + '\n');
      console.log(`게이트 달린 호출 ${current.length}개 기록`);
      return;
    }
    const baseline: string[] = JSON.parse(readFileSync(SELF_GATED_PATH, 'utf8'));
    const added = current.filter((x) => !baseline.includes(x));
    expect(added, [
      `🔴 대조에서 빠지는 호출이 ${added.length}개 늘었다 — 그 자리는 이제 아무도 대조하지 않는다.`,
      `게이트를 새로 달았다면 기준선을 갱신하고, 그 자리는 눈으로 확인한다:`,
      ...added,
    ].join('\n')).toEqual([]);
  });
});

describe('🔴 기준선 동결 — 새 미스매치를 만들지 않는다', () => {
  it('현재 미스매치 집합이 기준선과 정확히 같다(많아도 적어도 실패)', () => {
    const current = scanMismatches();

    if (process.env.ROLE_EP_BASELINE_WRITE === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
      console.log(`기준선 재생성: ${current.length}쌍 → ${BASELINE_PATH}`);
      return;
    }

    expect(existsSync(BASELINE_PATH), '기준선 파일이 없다 — ROLE_EP_BASELINE_WRITE=1 로 생성한다').toBe(true);
    const baseline: string[] = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const cur = new Set(current); const base = new Set(baseline);
    const added = current.filter((x) => !base.has(x));
    const removed = baseline.filter((x) => !cur.has(x));

    expect(added, [
      `🔴 새 미스매치 ${added.length}건 — 화면은 이 역할에 열려 있는데 EP 가 닫혀 있다.`,
      `EP 를 여는 것과 화면이 숨기는 것 중 성격에 맞는 쪽을 고른다(§규약 5). 목록:`,
      ...added,
    ].join('\n')).toEqual([]);

    expect(removed, [
      `기준선보다 ${removed.length}건 줄었다(고쳐졌다) — 여유를 남기면 신규 위반을 흡수한다.`,
      `ROLE_EP_BASELINE_WRITE=1 로 기준선을 줄여 커밋한다. 줄어든 항목:`,
      ...removed,
    ].join('\n')).toEqual([]);
  });
});
