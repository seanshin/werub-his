import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **읽는 코드가 없는 설정** 기준선 동결 (2026-08-28 · 발굴 모드).
 *
 * 발단: `emr.locale`("시스템 언어" 드롭다운)이 저장은 되는데 **읽는 코드가 0개**였다.
 * 화면의 미배선 고지 목록(`UNWIRED_CONFIG_NOTE`)은 **손으로 관리**돼서 그 키가 빠져 있었다 —
 * 손 목록은 낡는다.
 *
 * 🔴 **이 가드가 하지 않는 것**: "미배선이면 실패"라고 하지 않는다.
 *    ① 리터럴 스캔은 **동적 조회**(`config.get(`${x}Kid`)`)를 놓친다 → 오탐이 생긴다.
 *    ② 미배선 자체가 결함이 아닌 경우가 있다(아직 안 쓰는 신규 키).
 *    그래서 **개수를 동결**한다 — 늘어나면 실패한다. **줄면 기준선을 낮춰라**고 말한다.
 *    (여유를 두면 신규 위반을 흡수한다 — 이 저장소가 겪은 함정)
 */
const API = join(process.cwd(), 'src');
const ROOTS = [API, join(process.cwd(), '../web/src'), join(process.cwd(), '../../packages/shared/src')];
const DEF = join(API, 'modules/config/config-runtime.service.ts');
const SETTINGS_PAGE = 'ai-settings/page.tsx';

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === 'dist') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.spec\.ts$/.test(e)) out.push(full);
  }
  return out;
}

const defSrc = readFileSync(DEF, 'utf8');
const KEYS = [...new Set([...defSrc.matchAll(/^\s*'([a-zA-Z0-9_.]+)':\s*\{\s*key:\s*'\1'/gm)].map((m) => m[1]))];

/**
 * 🔴 **주석을 벗기고 센다.** 벗기지 않으면 "이 키는 미배선이다"라고 **설명한 주석**이
 *    소비처로 잡혀 스캔이 헛돈다 — 실제로 이 가드가 그렇게 헛돌아 잡혔다
 *    (`password-policy.ts` 주석의 `security.password.minLength`).
 */
const stripComments = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 🔴 (2026-09-15) 결정 등록부 증분 파일(`decision.registry.batch-*.ts`)은 설정 키를 **설명 문장**(statusQuo·verifyHow)에 적는다 —
//    그 글자가 '읽는 코드'로 잡혀 `portal.telehealth.enabled` 를 배선으로 오판했다. 설정을 읽지 않는 문서 배열이라 스캔에서 뺀다.
const files = ROOTS.flatMap((r) => walk(r)).filter((f) => f !== DEF && !/decision\.registry\.batch-[^/]+\.ts$/.test(f));
const blobs = files.map((f) => [f, stripComments(readFileSync(f, 'utf8'))] as const);

/**
 * 🔴 **동적 조회도 배선이다.** `config.get(`voc.sla.${type}`)` 같은 템플릿을 못 보면
 *    실제로 쓰이는 키를 "미배선"이라 부른다 — 처음 이 가드는 그렇게 **19건을 잘못 셌다.**
 *
 * 🔴 **정규식 변환 순서에 함정이 있다**: 이스케이프를 먼저 하면 `\${type}` 의 백슬래시가
 *    치환 결과의 `[` 를 이스케이프해 `\[A-Za-z0-9_]+`(리터럴 대괄호)가 된다 —
 *    실제로 그렇게 만들어 **동적 배선 0건**이라는 답을 얻었다. 자리표시자를 먼저 박는다.
 *
 * 🔴 **자리표시자는 한 세그먼트만 먹는다**(`[A-Za-z0-9_]+`). 점을 허용하면
 *    `` `b${idx}` ``(리액트 key)가 `billing.*` 를 먹는다 — **거짓 안심 생성기**가 된다.
 *    여러 세그먼트를 담는 변수는 아래 손검증 목록에 **증거와 함께** 적는다.
 */
const PH = '\u0000SEG\u0000';
const dynRe: RegExp[] = [];
for (const [, c] of blobs) {
  for (const m of c.matchAll(/`([A-Za-z0-9_.]*\$\{[^}]+\}[A-Za-z0-9_.${} ]*)`/g)) {
    const t = m[1];
    if (!/[a-zA-Z]/.test(t.replace(/\$\{[^}]+\}/g, ''))) continue; // 순수 변수만이면 제외
    const rx = '^' + t.replace(/\$\{[^}]+\}/g, PH)
      .replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
      .split(PH).join('[A-Za-z0-9_]+') + '$';
    dynRe.push(new RegExp(rx));
  }
}

/** 🔴 코드를 읽어 확인한 동적 배선 — 느슨한 정규식 대신 사람이 본 증거를 적는다 */
const HAND_VERIFIED: Record<string, string> = {
  'mobile.patient.release': '`${key}.release` — mobile-config.controller.ts',
  'mobile.staff.release': '`${key}.release` — mobile-config.controller.ts',
};

/** 설정 화면(옵션표·미배선 고지)은 소비처로 세지 않는다 — 거기 있는 것은 "쓰는 것"이 아니다 */
const unwired = KEYS.filter(
  (k) =>
    !blobs.some(([f, c]) => !f.includes(SETTINGS_PAGE) && c.includes(k))
    && !dynRe.some((re) => re.test(k))
    && !HAND_VERIFIED[k],
);

/**
 * 🔴 실측 기준선(2026-08-28 · 설정 393개 = 리터럴 배선 326 + **동적 배선 19** + 미배선 **48**).
 *    50 → 48: 미수납 알림일수·멸균 유효기간을 **배선해서** 줄였다(신규 상담 정책 5키는 전부 배선).
 *
 * 🔴 **처음엔 `unwired.length` 로 계산해 두었다 — 그러면 절대 실패할 수 없는 가드다.**
 *    재주입에서 배선을 끊었는데 통과했고, 그래서 잡혔다("통과하는 테스트가 아무것도
 *    보증하지 않을 수 있다"). **수를 못박는다.**
 *    늘면 실패 · 줄면 이 수를 낮춘다(여유를 두면 신규 위반을 흡수한다).
 *
 * 48 → 42(2026-09-06 R9): 위급통보 게이트 2(vitals.criticalAlert·lab.criticalNotify)·
 *    세션 만료(session.timeoutMinutes)·비밀번호 하한(password.minLength 강화 전용)을 **배선**하고,
 *    requireSpecial(완화 스위치 성립 불가)·audit.retentionDays(RetentionPolicy 와 중복 정본)는 **키를 제거**했다.
 * 42 → 41(2026-09-06 ui-locale P0): emr.locale **키 제거**(소비처 0·중복 — 정본은
 *    hospital.defaultUiLocale + UserUiPreference.uiLocale, 신설 키는 스토어가 즉시 소비).
 * 41 → 42(2026-10-20 v4.100.0 종별 계산기): 🔴 새 미배선이 아니라 **가짜 소비처 회수**다 — `billing.fee.consultation.initial`(15,890)을
 *    읽는 곳은 /admin/billing-calc 요약 카드 하나였고, 그 카드가 실청구가 쓰지 않는 값을 "초진 진찰료"로 보였다.
 *    진찰료는 수가 마스터의 종별 코드로 청구된다 — 카드를 걷어내자 이 키가 원래 상태(미배선)로 드러났다. 키 제거는 설정 화면 정리 때.
 * 42 → 43(2026-10-22 v4.116.0 중간정산): 🔴 이것도 새 미배선이 아니라 **정본 두 개 중 하나를 회수**한 것 — `inpatient.insuranceRate`(건보 80%)는
 *   중간정산만 읽던 별도 급여율이었다. 중간정산이 퇴원 입원료 청구와 같은 자격 정본으로 바뀌어 소비처 0 — 설정 화면이 '쓰이지 않음'을 말한다.
 */
const BASELINE = 43;

describe('🔴 읽는 코드가 없는 설정이 조용히 늘지 않는다', () => {
  it('설정 키 정본을 실제로 읽어냈다 — 스캔이 헛돌면 이 가드는 아무것도 안 한다', () => {
    // 🔴 대조군: 파싱이 0건이면 아래 검사가 전부 자동 통과한다
    expect(KEYS.length).toBeGreaterThan(300);
    expect(files.length).toBeGreaterThan(500);
    // 배선된 키가 실제로 배선으로 잡히는지(스캐너가 작동하는지)
    expect(unwired).not.toContain('security.login.maxAttempts');
    expect(unwired).not.toContain('hospital.country');
    // 🔴 **동적 배선 대조군** — 이것이 미배선으로 잡히면 정규식 변환이 다시 깨진 것이다
    //    (`voc.sla.${type}` · `notification.patientPush.types.${type}` · `${scope}.targetAuthEnforce`)
    expect(unwired, 'voc.sla.* 는 동적 조회로 배선돼 있다').not.toContain('voc.sla.QUESTION');
    expect(unwired).not.toContain('notification.patientPush.types.CALLED');
    expect(unwired, 'IDOR 차단 게이트는 배선돼 있다').not.toContain('erp.targetAuthEnforce');
    expect(unwired).not.toContain('mobile.patient.release');
    // 🔴 **반대 대조군** — 자리표시자가 점을 먹으면 이것이 통과해 버린다(거짓 안심)
    expect(unwired, 'billing.defaultCopayRate 는 실제로 미배선이다').toContain('billing.defaultCopayRate');
  });

  it(`미배선 후보 수가 기준선(${BASELINE})을 넘지 않는다`, () => {
    expect(
      unwired.length,
      `미배선 설정이 늘었다. 새 설정을 만들었으면 읽는 코드까지가 한 벌이다.\n현재: ${unwired.join(', ')}`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it('🔴 화면이 미배선이라 고지한 키는 실제로 미배선이다 — 거짓 고지를 하지 않는다', () => {
    const page = readFileSync(join(process.cwd(), '../web/src/app/(main)/admin/ai-settings/page.tsx'), 'utf8');
    const noteBlock = page.slice(page.indexOf('const UNWIRED_CONFIG_NOTE'), page.indexOf('const GATE_ENUM_OPTIONS'));
    const noted = [...noteBlock.matchAll(/^\s*'([a-zA-Z0-9_.]+)':/gm)].map((m) => m[1]);
    expect(noted.length, '고지 목록을 읽어냈다').toBeGreaterThan(0);
    // 🔴 고지해 놓고 실제로는 배선된 것이 있으면, 화면이 기능을 **실제보다 못하다고** 말하는 것이다
    const wronglyNoted = noted.filter((k) => !unwired.includes(k));
    expect(wronglyNoted, '배선됐는데 "미배선"이라 고지 중').toEqual([]);
  });
});

/**
 * 🔴 비밀번호 최소 길이 정본 — 실측(2026-08-28): 같은 정책이 세 DTO 에 각자 적혀 있었고
 *    **재설정만 6** 이었다(생성·로그인 8). 관리자 초기화가 선언한 정책의 **뒷문**이었다.
 */
describe('🔴 비밀번호 정책은 정본 하나다', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  const POLICY = read('modules/auth/password-policy.ts');

  it('숫자 리터럴을 DTO 에 직접 적지 않는다 — 적으면 다시 갈라진다', () => {
    for (const d of ['modules/auth/dto/login.dto.ts', 'modules/user/dto/create-user.dto.ts', 'modules/user/dto/reset-password.dto.ts']) {
      expect(read(d), `${d} 에 숫자 리터럴 MinLength`).not.toMatch(/@MinLength\(\d+\)/);
    }
  });

  it('🔴 신규·변경 경로는 정본 길이(12)를 쓴다 — 선언 기준 아래로 새지 않는다', () => {
    expect(POLICY).toMatch(/PASSWORD_MIN_LENGTH = 12/);
    for (const d of ['modules/user/dto/create-user.dto.ts', 'modules/user/dto/reset-password.dto.ts']) {
      expect(read(d), d).toMatch(/@MinLength\(PASSWORD_MIN_LENGTH\)/);
    }
  });

  it('🔴 로그인은 정책이 아니라 입력 하한을 쓴다 — 올리면 기존 계정이 로그인 불가가 된다', () => {
    const login = read('modules/auth/dto/login.dto.ts');
    expect(login).toMatch(/@MinLength\(LOGIN_INPUT_MIN_LENGTH\)/);
    expect(login, '로그인에 신규 비밀번호 정책을 걸면 안 된다').not.toMatch(/@MinLength\(PASSWORD_MIN_LENGTH\)/);
  });

  it('🔴 운영 시드 비밀번호가 로그인 하한을 통과한다(대조군 — 잠기면 아무도 못 들어온다)', () => {
    const m = /LOGIN_INPUT_MIN_LENGTH = (\d+)/.exec(POLICY);
    expect(m, '입력 하한 상수를 찾았다').toBeTruthy();
    const min = Number(m![1]);
    for (const pw of ['staff1234!', 'patient1234!']) {
      expect(pw.length, `${pw} 가 로그인 하한(${min})에 걸린다`).toBeGreaterThanOrEqual(min);
    }
  });

  it('🔴 생성·초기화가 강도 검사를 실제로 부른다 — DTO 길이만으로는 복잡도가 안 걸린다', () => {
    const svc = read('modules/user/user.service.ts');
    expect((svc.match(/assertPasswordPolicy\(/g) ?? []).length, '정의 1 + 호출 2').toBeGreaterThanOrEqual(3);
  });

  it('강도 규칙이 정본 한 곳에만 있다 — auth.service 가 자기 규칙을 다시 적지 않는다', () => {
    const auth = read('modules/auth/auth.service.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(auth, '규칙을 복제하면 갈라진다').not.toMatch(/errors\.push\('대문자/);
    expect(auth).toMatch(/passwordPolicyViolations\(/);
  });
});
