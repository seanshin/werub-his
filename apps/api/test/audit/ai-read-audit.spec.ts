/**
 * 🔴 환자 지목 AI 조회의 열람 감사 — 2026-08-20 신설.
 *
 * 실측 배경: 환자 지목 AI GET 21개 중 **20개가 개통 이래 감사행 0** 이었다.
 * `PHI_READ_PATTERNS` 는 `/api/v1/lab/results/<uuid>` 는 알아도
 * `/api/v1/lab/orders/<uuid>/ai-interpret` 는 모르고, 쿼리에 patientId 도 없다.
 * 운영 `audit_logs` 의 AI 열람 기록은 `AiPatientContext` 91행뿐이었다.
 *
 * 전제(사람 결정): AI 서버는 **원내**(WeRU.B) — 이 감사는 국외이전이 아니라 **접근기록**이다.
 *
 * 재주입: 컨트롤러에서 `@AuditAiRead` 를 떼면 아래 구조 가드가 실패한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { of } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import { AuditInterceptor } from '../../src/modules/audit/audit.interceptor';
import { AI_READ_KEY } from '../../src/modules/audit/no-audit.decorator';

const PAT = '3b9f0e1c-7d2a-4c58-9f10-0a1b2c3d4e5f';
const ZERO = '00000000-0000-0000-0000-000000000000';

function ctx(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u-1' }, headers: {}, ip: '10.0.0.1', params: {}, query: {}, ...req }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as any;
}

describe('AI 조회 열람 감사 — 감사되지 않던 자리', () => {
  let audit: { log: any; logReadOnce: any };
  let interceptor: AuditInterceptor;
  const next = (data?: unknown) => ({ handle: () => of(data) }) as any;
  const mkReflector = (aiName?: string) => ({
    getAllAndOverride: vi.fn((key: string) => (key === AI_READ_KEY ? aiName : undefined)),
  });
  const run = (req: Record<string, unknown>, res: unknown) =>
    new Promise((r) => interceptor.intercept(ctx(req), next(res)).subscribe({ complete: () => r(undefined) }));

  beforeEach(() => {
    audit = { log: vi.fn().mockResolvedValue(null), logReadOnce: vi.fn().mockResolvedValue(undefined) };
  });

  const LAB = '/api/v1/lab/orders/8f14e45f-ceea-467a-9b3a-1a1b2c3d4e5f/ai-interpret';

  it('🔴 데코레이터가 없으면 감사되지 않는다 — 이것이 고치기 전의 상태다', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector(undefined) as any);
    await run({ method: 'GET', path: LAB }, { data: { patientId: PAT } });
    expect(audit.logReadOnce).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('데코레이터가 있으면 READ 로 남고 resourceType 은 선언한 이름이다', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector('AiLabInterpret') as any);
    await run({ method: 'GET', path: LAB }, { data: { patientId: PAT } });
    const e = audit.logReadOnce.mock.calls[0][0];
    expect(e).toMatchObject({ userId: 'u-1', action: 'READ', resourceType: 'AiLabInterpret', resourceId: PAT });
  });

  it('응답에 환자가 있으면 그 환자에 귀속하고 via 를 남긴다', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector('AiLabInterpret') as any);
    await run({ method: 'GET', path: LAB }, { data: { patientId: PAT } });
    expect(audit.logReadOnce.mock.calls[0][0].changes.egress.new).toContain('patientBound=true;via=response');
  });

  it('라우트 파라미터의 환자도 귀속한다', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector('AiLabTrend') as any);
    await run({ method: 'GET', path: `/api/v1/lab/patients/${PAT}/ai-trend`, params: { patientId: PAT } }, { data: [] });
    const e = audit.logReadOnce.mock.calls[0][0];
    expect(e.resourceId).toBe(PAT);
    expect(e.changes.egress.new).toContain('via=param');
  });

  it('🔴 환자를 못 찾으면 못 찾았다고 적는다 — 다른 ID 를 patientId 인 척 넣지 않는다', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector('AiSurgeryRisk') as any);
    await run({ method: 'GET', path: '/api/v1/surgery/8f14e45f-ceea-467a-9b3a-1a1b2c3d4e5f/ai-risk' }, { data: { risk: 'LOW' } });
    const e = audit.logReadOnce.mock.calls[0][0];
    expect(e.resourceId).toBe(ZERO);
    expect(e.changes.egress.new).toContain('patientBound=false;via=none');
  });

  it('스킬 품질 집계를 오염시키지 않는다(resourceType 이 Outcome 으로 끝나지 않는다)', async () => {
    interceptor = new AuditInterceptor(audit as any, mkReflector('AiLabInterpret') as any);
    await run({ method: 'GET', path: LAB }, { data: { patientId: PAT } });
    expect(audit.logReadOnce.mock.calls[0][0].resourceType.endsWith('Outcome')).toBe(false);
  });
});

describe('구조 가드 — 환자 지목 AI GET 은 전부 @AuditAiRead 를 단다', () => {
  const SRC = path.join(__dirname, '..', '..', 'src', 'modules');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (e.name.endsWith('.controller.ts')) out.push(f);
    }
    return out;
  };
  /** 비환자 식별자(코드·잡 ID)만 받는 EP — 열람 감사 대상이 아니다 */
  const NON_PATIENT = /:(code|jobId|id)\b(?![\s\S]*ai-)/;
  const ALLOW = new Set([
    'drug-master/:code', 'drug-substitution/:code', 'meeting/job/:id',
    'lists/ai-draft/:jobId', 'ai/jobs/:jobId',
    'patient-context/:patientId', // 핸들러가 직접 audit.log 를 부른다(이중 기록 방지)
  ]);

  it('🔴 데코레이터가 빠진 환자 지목 AI GET 이 없다', () => {
    const missing: string[] = [];
    for (const f of walk(SRC)) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/@Get\(\s*['"]([^'"]*)['"]\s*\)/g)) {
        const sub = m[1];
        if (!/(^|[/\-])ai([/\-]|$)/.test(sub)) continue;
        if (!sub.includes(':')) continue;
        if (ALLOW.has(sub)) continue;
        if (NON_PATIENT.test(sub) && !/ai-/.test(sub)) continue;
        const before = s.slice(Math.max(0, m.index! - 260), m.index!);
        if (!before.includes('@AuditAiRead(')) missing.push(`${path.basename(f)} ${sub}`);
      }
    }
    expect(missing, `환자 지목 AI GET 인데 @AuditAiRead 가 없다:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});

/**
 * 🔴 2026-08-27 신설 — 감사는 남는데 **환자에 귀속되지 않던 것**.
 *
 * 운영 실측: `@AuditAiRead` 23 EP 중 실제로 불린 4개에서 **2개가 `patientBound=false`**
 * (`resource_id = 00000000-…`). 인터셉터는 응답/라우트에서만 환자를 찾으므로,
 * 서비스가 `patientId` 를 실어 보내지 않으면 그 열람은 **환자별 접근이력에서 영원히 빠진다.**
 * 정적 판정은 운영 4건과 4/4 일치했다(예측 true 2 / false 2).
 *
 * 재주입: 아무 AI 서비스 메서드의 반환에서 `patientId` 를 지우면 이 가드가 실패한다.
 */
describe('구조 가드 — AI 열람 응답은 환자에 귀속된다', () => {
  const SRC = path.join(__dirname, '..', '..', 'src', 'modules');
  const walkTs = (d: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walkTs(f, out);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(f);
    }
    return out;
  };

  /** `{` 부터 짝이 맞는 `}` 까지 */
  function block(src: string, from: number): string {
    const j = src.indexOf('{', from);
    if (j < 0) return '';
    let depth = 0;
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return src.slice(j, k + 1);
    }
    return src.slice(j);
  }

  /** 중첩 함수(화살표·function)의 본문을 걷어낸다 — `.map(d => { return … })` 의 반환은 메서드의 반환이 아니다 */
  function stripNested(body: string): string {
    let out = body;
    for (;;) {
      const m = /(=>|function\s*\([^)]*\))\s*\{/.exec(out);
      if (!m) return out;
      const b = block(out, m.index + m[0].length - 1);
      if (!b) return out;
      out = out.slice(0, m.index) + ' /*nested*/ ' + out.slice(m.index + m[0].length - 1 + b.length);
    }
  }

  /** 메서드 본문의 **최상위 반환 객체**들 — 하나라도 patientId 가 없으면 그 이름을 돌려준다 */
  function unboundReturns(methodBody: string): string[] {
    const flat = stripNested(methodBody);
    const bad: string[] = [];
    for (const m of flat.matchAll(/\breturn\s*\{/g)) {
      const obj = block(flat, m.index! + 'return'.length);
      if (!/\bpatientId\b/.test(obj)) bad.push(obj.replace(/\s+/g, ' ').slice(0, 80));
    }
    return bad;
  }

  /** 컨트롤러에서 (EP 경로, 서비스 메서드명) 을 기계 추출한다 — 목록을 손으로 적지 않는다 */
  function aiReadEndpoints() {
    const eps: Array<{ file: string; name: string; route: string; method: string }> = [];
    for (const f of walkTs(SRC).filter((x) => x.endsWith('.controller.ts'))) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/@AuditAiRead\(\s*['"]([^'"]+)['"]\s*\)([\s\S]{0,900}?)\n  \}/g)) {
        const seg = m[2];
        const route = /@Get\(\s*['"]([^'"]*)['"]\s*\)/.exec(seg)?.[1] ?? '';
        const call = /this\.[A-Za-z0-9_]+\.([A-Za-z0-9_]+)\(/.exec(seg.split('async ')[1] ?? seg)?.[1] ?? '';
        eps.push({ file: path.basename(f), name: m[1], route, method: call });
      }
    }
    return eps;
  }

  it('🔴 모든 @AuditAiRead EP 의 응답이 환자에 귀속된다 (라우트 `:patientId` 는 면제)', () => {
    const eps = aiReadEndpoints();
    // 표본이 사라지면 가드가 조용히 통과한다 — 하한을 건다(현재 23)
    // 2026-08-27 실측 23. 하한을 걸어두지 않으면 추출이 0이 됐을 때 가드가 조용히 통과한다.
    expect(eps.length, '@AuditAiRead EP 추출 실패').toBeGreaterThanOrEqual(23);

    const files = walkTs(SRC).filter((f) => !f.endsWith('.controller.ts'));
    const problems: string[] = [];
    for (const ep of eps) {
      if (ep.route.includes(':patientId')) continue; // 인터셉터가 라우트 파라미터로 귀속한다
      if (!ep.method) { problems.push(`${ep.name}: 서비스 메서드를 못 찾음`); continue; }
      const re = new RegExp(`\\n\\s+(?:public\\s+|private\\s+)?(?:async\\s+)?${ep.method}\\s*\\(`);
      const hit = files.map((f) => ({ f, s: fs.readFileSync(f, 'utf8') })).find((x) => re.test(x.s));
      if (!hit) { problems.push(`${ep.name}: ${ep.method}() 정의를 못 찾음`); continue; }
      const body = block(hit.s, re.exec(hit.s)!.index + re.exec(hit.s)![0].length);
      const bad = unboundReturns(body);
      if (bad.length) problems.push(`${ep.name} (${ep.method}): patientId 없는 반환 ${bad.length}건 — ${bad[0]}`);
    }
    expect(problems, `AI 열람이 환자에 귀속되지 않는다(환자별 접근이력에서 빠진다):\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  it('대조군 — 판정 함수가 실제로 결함을 잡는다(무조건 통과가 아니다)', () => {
    const bound = ' { const x = 1; return { orderId, patientId, review: null }; } ';
    const unbound = ' { const x = 1; return { orderId, review: null }; } ';
    // 중첩 함수 안의 반환은 메서드의 반환이 아니다 — 오탐으로 세지 않는다
    const nestedOnly = ' { const per = list.map((d) => { return { diagnosis: d }; }); return { encounterId, patientId, per }; } ';
    expect(unboundReturns(bound)).toEqual([]);
    expect(unboundReturns(unbound).length).toBe(1);
    expect(unboundReturns(nestedOnly)).toEqual([]);
  });
});

/**
 * 🔴 직원 JWT FHIR 열람 감사 — 2026-08-27 신설.
 *
 * 운영 실측: 급양 계정이 `GET /fhir/R4/Patient` 로 **환자 873명**(성명·MRN·생년월일·전화·주소)을
 * 받았는데 `audit_logs` 에 그 열람 행이 **0건**이었다. SMART 토큰은 `SmartAccessLog` 로 남는데
 * **직원 JWT 경로만 아무 데도 안 남았다**(`PHI_READ_PATTERNS` 가 `/fhir/R4/Patient` 를 모른다).
 *
 * 재주입: 인터셉터의 `fhirRead` 판정을 빼면 아래가 전부 실패한다.
 */
describe('FHIR 열람 감사 — 직원 JWT', () => {
  let svc: any;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    svc = { log: vi.fn().mockResolvedValue(undefined), logReadOnce: vi.fn().mockResolvedValue(undefined), logSmartAccess: vi.fn() };
    interceptor = new AuditInterceptor(svc, { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as any);
  });

  const run = async (req: Record<string, unknown>, body: unknown) => {
    const obs = interceptor.intercept(ctx(req), { handle: () => of(body) } as any);
    await new Promise<void>((res) => obs.subscribe({ complete: () => res() }));
  };

  it('🔴 환자 검색(번들)이 원장에 남고, 몇 명이 나갔는지 함께 적는다', async () => {
    await run({ method: 'GET', path: '/fhir/R4/Patient' }, { resourceType: 'Bundle', total: 873, entry: [] });
    expect(svc.log).toHaveBeenCalledTimes(1);
    const e = svc.log.mock.calls[0][0];
    expect(e.action).toBe('READ');
    expect(e.resourceType).toBe('FhirPatient');
    expect(e.resourceId).toBe(ZERO);                       // 환자 지목이 아니다 — 지어내지 않는다
    expect(e.changes.egress.new).toContain('patientBound=false');
    expect(e.changes.egress.new).toContain('returned=873'); // 규모를 남긴다
  });

  it('환자 단건 조회는 그 환자에 귀속된다', async () => {
    await run({ method: 'GET', path: `/fhir/R4/Patient/${PAT}`, params: { id: PAT } }, { resourceType: 'Patient', id: PAT });
    const e = svc.log.mock.calls[0][0];
    expect(e.resourceId).toBe(PAT);
    expect(e.changes.egress.new).toContain('patientBound=true');
    expect(e.changes.egress.new).toContain('returned=1');
  });

  it('🔴 반복 인출을 억제하지 않는다 — 억제하면 규모가 사라진다', async () => {
    await run({ method: 'GET', path: '/fhir/R4/Patient' }, { resourceType: 'Bundle', total: 873 });
    await run({ method: 'GET', path: '/fhir/R4/Patient' }, { resourceType: 'Bundle', total: 873 });
    expect(svc.log).toHaveBeenCalledTimes(2);
    expect(svc.logReadOnce).not.toHaveBeenCalled();
  });

  it('🔴 건수를 모르면 0 이 아니라 unknown 이라 적는다', async () => {
    await run({ method: 'GET', path: '/fhir/R4/Observation' }, 'not-a-bundle');
    expect(svc.log.mock.calls[0][0].changes.egress.new).toContain('returned=unknown');
  });

  it('대조군 — FHIR 가 아닌 목록 조회는 이 분기로 남지 않는다', async () => {
    await run({ method: 'GET', path: '/api/v1/patients' }, { data: [] });
    expect(svc.log).not.toHaveBeenCalled();
  });
});
