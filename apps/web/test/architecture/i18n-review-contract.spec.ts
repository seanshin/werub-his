import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  I18N_REVIEW_EP,
  REVIEW_FILTERS as FE_FILTERS,
} from '../../src/app/(main)/admin/ui-locale/review/contract';

/**
 * 🔴 언어팩 사람 검수 — **FE ↔ 서버 계약 기계 대조**(정본 `i18n-human-review.plan.md`).
 *
 * 이 저장소에서 반복된 사고는 전부 "타입은 맞는데 사실이 아닌" 것들이었다:
 *   · `{data:{balanceDue}}` 를 최상위에서 읽어 퇴원 게이트 무발동
 *   · 없는 EP 를 부르는 배지가 개통 이래 사망(전자서명)
 *   · 서버에 없는 이름(`type`/`amount`)으로 읽어 간호 I/O 가 늘 0
 * tsc 는 **FE 안에서만** 일관되면 통과한다 — 그래서 서버 소스에서 파생해 대조한다.
 *
 * 🔴 **수기 목록을 만들지 않는다.** 컨트롤러 데코레이터·DTO 클래스·서비스 인터페이스를 파싱한다.
 *    파싱이 비면(정규식이 형식 변화를 못 따라가면) 가드는 아무것도 보증하지 않으므로,
 *    각 대조 앞에 "스캔이 비면 실패"를 둔다.
 */

const API = join(process.cwd(), '..', 'api', 'src', 'modules', 'i18n-review');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p: string) => stripComments(readFileSync(p, 'utf8'));

const CONTROLLER = read(join(API, 'i18n-review.controller.ts'));
const SERVICE = read(join(API, 'i18n-review.service.ts'));
const DTO = read(join(API, 'dto', 'i18n-review.dto.ts'));
const FE_PAGE = read(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'page.tsx'));
const FE_PARTS = read(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'parts.tsx'));

/* ── 파서 ────────────────────────────────────────────────────────────────────── */

/** `start` 위치의 여는 괄호부터 짝이 맞는 닫는 괄호까지 */
function balanced(src: string, from: number, open = '{', close = '}'): string {
  const s = src.indexOf(open, from);
  if (s < 0) return '';
  let depth = 0;
  for (let i = s; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(s + 1, i);
    }
  }
  return '';
}

/**
 * 객체 리터럴/인터페이스 본문의 **최상위** 키 이름.
 * 🔴 `total: number;` 의 `number` 를 키로 세지 않는다 — 첫 판에 그렇게 세어 타입 이름이
 *    "서버에 없는 필드"로 보고됐다(내 도구가 먼저 거짓말한 자리).
 */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  let afterColon = false;
  for (const ch of body) {
    if ('{(['.includes(ch)) {
      depth++;
      continue;
    }
    if ('})]'.includes(ch)) {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (ch === ':') {
      if (!afterColon) {
        const m = token.match(/([A-Za-z_$][\w$]*)[!?]?\s*$/);
        if (m) keys.push(m[1]);
      }
      afterColon = true;
      token = '';
    } else if (ch === ',' || ch === ';' || ch === '\n') {
      // 축약 프로퍼티(`{ locale, area }`)도 키다
      if (!afterColon) {
        const t = token.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(t)) keys.push(t);
      }
      afterColon = false;
      token = '';
    } else token += ch;
  }
  return [...new Set(keys)];
}

/** `export interface X {` 의 필드 이름 */
function interfaceFields(src: string, name: string): string[] {
  const at = src.search(new RegExp(`export interface ${name}\\s*\\{`));
  if (at < 0) return [];
  return topLevelKeys(balanced(src, at));
}

/** `export class X {` 의 프로퍼티 이름(데코레이터 뒤) */
function dtoFields(src: string, name: string): { all: string[]; required: string[] } {
  const at = src.search(new RegExp(`export class ${name}\\s*\\{`));
  if (at < 0) return { all: [], required: [] };
  const body = balanced(src, at);
  const all: string[] = [];
  const required: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/([A-Za-z_$][\w$]*)([!?])\s*:/);
    if (!m) continue;
    all.push(m[1]);
    if (m[2] === '!' && !line.includes('@IsOptional')) required.push(m[1]);
  }
  return { all, required };
}

/* ── 1. 경로·메서드 ───────────────────────────────────────────────────────────── */

const prefix = CONTROLLER.match(/@Controller\('([^']+)'\)/)?.[1] ?? '';
/** 서버가 실제로 여는 경로 → 메서드 집합 */
const serverRoutes = (() => {
  const m = new Map<string, Set<string>>();
  for (const mm of CONTROLLER.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
    const method = mm[1].toLowerCase();
    const sub = mm[2] ?? '';
    const path = `/${[prefix, sub].filter(Boolean).join('/')}`;
    if (!m.has(path)) m.set(path, new Set());
    m.get(path)!.add(method);
  }
  return m;
})();

/** FE 가 선언한 경로(함수형 EP 는 `:id` 로 정규화) */
const fePaths: Record<string, string> = {
  overrides: I18N_REVIEW_EP.overrides,
  review: I18N_REVIEW_EP.review,
  stats: I18N_REVIEW_EP.stats,
  export: I18N_REVIEW_EP.export,
  rejectKey: I18N_REVIEW_EP.rejectKey,
  approve: I18N_REVIEW_EP.approve(':id'),
  reject: I18N_REVIEW_EP.reject(':id'),
  merged: I18N_REVIEW_EP.merged(':id'),
};

describe('🔴 i18n 검수 — FE 가 부르는 경로가 서버에 실제로 있다', () => {
  it('스캔이 비면 가드가 아니다 — 컨트롤러에서 경로를 실제로 읽었다', () => {
    expect(prefix, '@Controller 프리픽스를 못 읽었다').toBe('api/v1/i18n');
    expect(serverRoutes.size, '컨트롤러에서 라우트를 하나도 못 읽었다').toBeGreaterThanOrEqual(7);
  });

  it('FE 경로 = 서버 경로 (양방향 — 없는 EP 를 부르지도, 있는 EP 를 놓치지도 않는다)', () => {
    const server = [...serverRoutes.keys()].sort();
    const fe = [...new Set(Object.values(fePaths))].sort();
    expect(fe, `서버: ${server.join(' , ')}`).toEqual(server);
  });

  it('메서드까지 같다 — 화면이 실제로 호출하는 형태로 대조한다', () => {
    /** `apiClient.get<…>(I18N_REVIEW_EP.review` / `…post<…>(I18N_REVIEW_EP.approve(` */
    const calls = [...FE_PAGE.matchAll(/apiClient\.(get|post|put|patch|delete)<[^>]*>?\(\s*\n?\s*I18N_REVIEW_EP\.(\w+)/g)].map(
      (m) => ({ method: m[1], key: m[2] }),
    );
    // 삼항으로 두 EP 중 하나를 고르는 자리(승인/반려)도 센다
    for (const m of FE_PAGE.matchAll(/apiClient\.(get|post)<[^>]*>?\(\s*\n?\s*v\.to === 'approve' \? I18N_REVIEW_EP\.(\w+) : I18N_REVIEW_EP\.(\w+)/g)) {
      calls.push({ method: m[1], key: m[2] }, { method: m[1], key: m[3] });
    }
    expect(calls.length, '화면에서 API 호출을 하나도 못 읽었다 — 정규식이 낡았다').toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      const path = fePaths[c.key];
      expect(path, `FE EP 키 '${c.key}' 가 계약 미러에 없다`).toBeTruthy();
      expect([...(serverRoutes.get(path) ?? [])], `${c.method.toUpperCase()} ${path}`).toContain(c.method);
    }
  });

  it('🔴 일괄 승인 EP 가 없다 — 건별 승인만(기획서 §2.3)', () => {
    for (const p of serverRoutes.keys()) {
      expect(p, `일괄 승인처럼 보이는 경로: ${p}`).not.toMatch(/approve-all|bulk|batch/i);
    }
    expect(FE_PAGE).not.toMatch(/approveAll|bulkApprove|일괄 승인하기/);
    // 승인 경로는 `:id` 하나를 받는다(배열·ids 를 받는 순간 일괄이 된다)
    expect([...serverRoutes.keys()].filter((p) => p.endsWith('/approve'))).toEqual([`/${prefix}/review/:id/approve`]);
  });
});

/* ── 2. 요청 필드 ─────────────────────────────────────────────────────────────── */

describe('🔴 i18n 검수 — 요청 필드가 DTO 와 같다(전역 whitelist 가 모르는 키를 조용히 지운다)', () => {
  it('필터 어휘가 서버 REVIEW_FILTERS 와 정확히 같다', () => {
    const raw = DTO.match(/export const REVIEW_FILTERS\s*=\s*\[([^\]]+)\]/)?.[1] ?? '';
    const server = [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(server.length, 'DTO 에서 필터 목록을 못 읽었다').toBeGreaterThan(5);
    expect([...FE_FILTERS].sort()).toEqual([...server].sort());
  });

  it('교정 제안 본문이 ProposeDto 필드만 보낸다 · 필수는 빠뜨리지 않는다', () => {
    const dto = dtoFields(DTO, 'ProposeDto');
    expect(dto.all, 'ProposeDto 필드를 못 읽었다').toContain('value');
    // 🔴 GET 목록도 같은 EP 를 쓴다 — **POST 호출**을 겨눈다(첫 판에 GET 의 질의 키를 제안 본문으로 읽었다)
    const at = FE_PAGE.search(/apiClient\.post<\{ data: ProposeResult \}>\(I18N_REVIEW_EP\.review, \{/);
    expect(at, '화면의 제안(POST) 호출을 못 찾았다').toBeGreaterThan(0);
    // 제네릭(`<{ data: ProposeResult }>`)이 아니라 **인자 객체**에서 읽는다
    const sent = topLevelKeys(balanced(FE_PAGE, FE_PAGE.indexOf('I18N_REVIEW_EP.review, {', at)));
    expect(sent.length).toBeGreaterThan(2);
    for (const k of sent) expect(dto.all, `서버 DTO 에 없는 키를 보낸다: ${k}`).toContain(k);
    for (const k of dto.required) expect(sent, `필수 필드를 안 보낸다: ${k}`).toContain(k);
  });

  it('판정 본문이 DecisionDto 필드만 보낸다(사유는 선택 — 강제하지 않는다)', () => {
    const dto = dtoFields(DTO, 'DecisionDto');
    expect(dto.all).toEqual(['reason']);
    expect(dto.required, '사유를 필수로 강제하면 아무 값이나 골라 거짓 데이터가 된다').toEqual([]);
    // 화면이 보내는 판정 본문은 `{ reason }` 뿐이다
    for (const m of FE_PAGE.matchAll(/\{\s*reason:\s*[^}]+\}\s*:\s*\{\}/g)) expect(m[0]).toContain('reason');
    expect(FE_PAGE).toMatch(/reason:\s*v\.reason\.trim\(\)/);
  });

  it('🔴 "번역하지 않음" 본문이 RejectKeyDto 와 같다 · **사유는 여기서만 필수**다', () => {
    const dto = dtoFields(DTO, 'RejectKeyDto');
    expect(dto.all, 'RejectKeyDto 를 못 읽었다').toEqual(expect.arrayContaining(['locale', 'key', 'reason']));
    // 🔴 교정값이 없어 사유가 곧 판정의 내용이다(§2.1) — 서버가 필수로 선언했는지 소스에서 확인
    expect(dto.required, '서버가 reason 을 필수로 선언하지 않았다').toContain('reason');
    const at = FE_PAGE.search(/apiClient\.post<\{ data: RejectKeyResult \}>\(I18N_REVIEW_EP\.rejectKey, \{/);
    expect(at, '화면의 reject-key 호출을 못 찾았다').toBeGreaterThan(0);
    const sent = topLevelKeys(balanced(FE_PAGE, FE_PAGE.indexOf('I18N_REVIEW_EP.rejectKey, {', at)));
    expect([...sent].sort()).toEqual([...dto.all].sort());
  });

  it('🔴 화면이 사유 없이 부르지 않는다 — 서버 400 을 눌러 보고 알게 하지 않는다', () => {
    // `!reason` 이 아니라 정본 `reasonFilled`(공백만도 빈 것으로 판정)를 쓴다
    expect(FE_PAGE).toMatch(/reasonFilled\(reason\)\s*&&\s*rejectKeyM\.mutate/);
    expect(FE_PAGE).toMatch(/from '@\/lib\/reason-presets'/);
  });

  it('워크리스트 질의 파라미터가 ReviewQueryDto 필드 안에 있다', () => {
    const dto = dtoFields(DTO, 'ReviewQueryDto');
    expect(dto.all).toContain('locale');
    const at = FE_PAGE.indexOf('apiClient.get<ReviewListResponse>(I18N_REVIEW_EP.review, {');
    expect(at, '워크리스트 호출을 못 찾았다').toBeGreaterThan(0);
    const sent = topLevelKeys(balanced(FE_PAGE, at));
    expect(sent).toContain('locale');
    for (const k of sent) expect(dto.all, `ReviewQueryDto 에 없는 질의 키: ${k}`).toContain(k);
  });
});

/* ── 3. 응답 모양 ─────────────────────────────────────────────────────────────── */

describe('🔴 i18n 검수 — 응답을 서버가 보내는 모양 그대로 읽는다', () => {
  const serverRow = interfaceFields(SERVICE, 'ReviewRow');
  const feRow = interfaceFields(
    stripComments(readFileSync(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'contract.ts'), 'utf8')),
    'ReviewRow',
  );

  it('스캔이 비면 가드가 아니다 — 양쪽 인터페이스를 실제로 읽었다', () => {
    expect(serverRow.length, '서버 ReviewRow 를 못 읽었다').toBeGreaterThan(20);
    expect(feRow.length, 'FE ReviewRow 를 못 읽었다').toBeGreaterThan(20);
  });

  it('FE 가 읽는 행 필드가 전부 서버에 있다(유령 필드 0)', () => {
    const phantom = feRow.filter((f) => !serverRow.includes(f));
    expect(phantom, `서버 ReviewRow 에 없는 이름: ${phantom.join(', ')}`).toEqual([]);
  });

  it('출처·상태·안전·문맥·사용처 — 화면이 반드시 읽어야 하는 필드가 서버에 있다', () => {
    for (const f of ['effectiveOrigin', 'effectiveValue', 'status', 'safetyKey', 'contextGap', 'usedIn', 'selfApproved', 'baseChanged', 'noTranslate']) {
      expect(serverRow, `서버가 ${f} 를 보내지 않는다`).toContain(f);
      expect(feRow, `FE 가 ${f} 를 읽지 않는다`).toContain(f);
    }
  });

  it('권한 필드가 서버 ReviewPermission 과 같다(못 하는 이유를 화면이 그대로 말한다)', () => {
    const server = interfaceFields(SERVICE, 'ReviewPermission');
    const fe = interfaceFields(
      stripComments(readFileSync(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'contract.ts'), 'utf8')),
      'ReviewPermission',
    );
    expect(server.length).toBeGreaterThan(4);
    expect([...fe].sort()).toEqual([...server].sort());
    expect(server).toContain('reason');
  });

  it('목록 meta 키가 서비스가 만드는 그대로다(자른 사실·분모·미산출 사유)', () => {
    const at = SERVICE.indexOf('      meta: {');
    expect(at, '서비스 review() 의 meta 블록을 못 찾았다').toBeGreaterThan(0);
    const serverMeta = topLevelKeys(balanced(SERVICE, at));
    const fe = interfaceFields(
      stripComments(readFileSync(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'contract.ts'), 'utf8')),
      'ReviewMeta',
    );
    expect(serverMeta.length).toBeGreaterThan(8);
    const phantom = fe.filter((f) => !serverMeta.includes(f));
    expect(phantom, `서버 meta 에 없는 이름: ${phantom.join(', ')}`).toEqual([]);
    for (const f of ['truncated', 'total', 'catalogTotal', 'contextGapAvailable', 'usage', 'permission']) {
      expect(serverMeta).toContain(f);
      expect(fe).toContain(f);
    }
  });

  it('통계 필드가 서비스 stats() 가 만드는 그대로다(분모 병기·산출 불가)', () => {
    const at = SERVICE.indexOf('const cov = localeCoverage(locale);');
    expect(at, 'stats() 의 반환 블록을 못 찾았다').toBeGreaterThan(0);
    const serverStats = topLevelKeys(balanced(SERVICE, SERVICE.indexOf('return {', at)));
    const fe = interfaceFields(
      stripComments(readFileSync(join(process.cwd(), 'src', 'app', '(main)', 'admin', 'ui-locale', 'review', 'contract.ts'), 'utf8')),
      'ReviewStats',
    );
    expect(serverStats.length).toBeGreaterThan(10);
    const phantom = fe.filter((f) => !serverStats.includes(f));
    expect(phantom, `서버 stats 에 없는 이름: ${phantom.join(', ')}`).toEqual([]);
    for (const f of ['catalogTotal', 'reviewedRatio', 'contextGaps', 'approvedNotInCode']) {
      expect(serverStats).toContain(f);
      expect(fe).toContain(f);
    }
  });

  /**
   * 🔴 "번역하지 않기로 함"과 "실제로 그 번역이 안 나간다"는 **다른 사실**이다.
   *    반려는 코드 카탈로그의 AI 초안을 지우지 않으므로, 초안이 남아 있으면 화면에는 그 초안이
   *    계속 나간다. 서버가 그 몫을 세어 주는데 화면이 안 그리면 "N건 번역 안 함"이라 말하면서
   *    화면은 번역을 보여주는 P17 이 된다. **어휘는 서버가 준 것을 쓴다**(지어내면 갈라진다).
   */
  it('🔴 기록 ≠ 적용 어휘를 서버가 준 이름 그대로 읽는다(codeStillShows · noTranslateButCodeStillShows)', () => {
    const at = SERVICE.indexOf('const cov = localeCoverage(locale);');
    const serverStats = topLevelKeys(balanced(SERVICE, SERVICE.indexOf('return {', at)));
    for (const f of ['noTranslate', 'noTranslateButCodeStillShows']) {
      expect(serverStats, `서버 stats 가 ${f} 를 세지 않는다`).toContain(f);
      expect(FE_PARTS, `화면이 ${f} 를 읽지 않는다 — 판정만 그리고 적용 여부를 감춘다`).toContain(`stats.${f}`);
    }
    // 반려 응답의 3어휘 — 서버가 만들고 화면이 그대로 쓴다
    const rk = SERVICE.slice(SERVICE.indexOf('async rejectKey('), SERVICE.indexOf('private async runRejectKeyTx('));
    for (const f of ['codeStillShows', 'codeValue', 'appliedNote']) {
      expect(rk, `서버 rejectKey 가 ${f} 를 돌려주지 않는다`).toContain(f);
    }
    // 🔴 `codeStillShows` 를 무시하고 "적용됨"으로 그리면 안 된다 — 분기를 실제로 읽는지 본다
    expect(FE_PAGE, 'codeStillShows 를 보지 않고 성공이라 말한다').toMatch(/r\.data\.codeStillShows/);
    expect(FE_PARTS, '행이 "번역하지 않음"의 적용 여부를 말하지 않는다').toMatch(/row\.noTranslate/);
  });

  it('🔴 봉투(envelope)를 뒤집어 읽지 않는다 — 목록은 {data, meta}, 쓰기는 {data}', () => {
    expect(CONTROLLER).toMatch(/return \{ data: r\.rows, meta: r\.meta \}/);
    expect(FE_PAGE).toMatch(/listQ\.data\?\.data/);
    expect(FE_PAGE).toMatch(/listQ\.data\?\.meta/);
    // 쓰기 응답은 meta 가 없다 — `r.meta.…` 로 읽으면 undefined 를 사실인 척 쓰게 된다
    expect(CONTROLLER).toMatch(/async propose\([^)]*\)[^{]*\{\s*return \{ data: await this\.svc\.propose/);
    expect(FE_PAGE, '쓰기 응답에서 meta 를 읽는다 — 서버는 보내지 않는다').not.toMatch(/r\.meta\./);
  });
});

/* ── 4. 정직성 규약(이 화면에 한정) ───────────────────────────────────────────── */

describe('🔴 i18n 검수 화면 — 실패를 없음으로 번역하지 않는다', () => {
  it("queryFn 안에 `.catch(() => 기본값)` 이 없다", () => {
    // 있으면 isError 가 영원히 false 가 되어 QueryErrorFallback 이 도달 불가 코드가 된다
    expect(FE_PAGE).not.toMatch(/queryFn[\s\S]{0,400}?\.catch\(/);
  });

  it('조회 실패에 QueryErrorFallback 이 실제로 붙어 있다(도달 가능한 코드)', () => {
    expect(FE_PAGE).toMatch(/listQ\.isError \?[\s\S]{0,200}QueryErrorFallback/);
    expect(FE_PAGE).toMatch(/statsQ\.isError \?[\s\S]{0,200}QueryErrorFallback/);
  });

  it('로딩과 없음을 가른다 — 로딩 중을 "없음"으로 말하지 않는다', () => {
    expect(FE_PAGE).toMatch(/listQ\.isLoading/);
    expect(FE_PAGE).toMatch(/rows && rows\.length === 0/);
  });

  it('폴링 주기를 숫자 리터럴로 박지 않는다(SystemConfig ui.*)', () => {
    expect(FE_PAGE).toMatch(/refetchInterval: pollMs\(/);
    expect(FE_PAGE).not.toMatch(/refetchInterval:\s*\d+/);
  });
});
