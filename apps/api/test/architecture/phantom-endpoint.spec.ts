import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanPhantomEndpoints, serverRoutes, clientCalls, stripComments } from './phantom-endpoint-scan';

/**
 * 🔴 **화면이 서버에 없는 경로를 부르면 개통 이래 아무도 모른 채 죽어 있다** (2026-08-30 · 발굴 25회차).
 *
 * 전수 대조로 8종을 찾았고 **전부 운영에서 404 를 실측**했다
 * (`Cannot <METHOD> <path>` 로 "라우트 없음"과 "레코드 없음"을 갈랐다 —
 *  같은 날 `P2025`→404 매핑을 넣어 404 가 두 뜻이 됐기 때문):
 *   · 전자서명 상태 배지 2종 — `/document-sign/status` 는 없다(정본 `document/:type/:id`).
 *     배지가 **개통 이래 서명 상태를 한 번도 못 읽었다.**
 *   · 입원 인수인계 — `/inpatient/:id/handoffs` 는 없다. 서버에 `admissionId` 필터를 더했다.
 *   · 대기열 호출 — 주석이 "**정본 EP** `/waiting-queue/:id/call`" 이라 적어 뒀는데
 *     그 prefix 는 서버에 없다(실재 `/queue/:id/call`). **주석이 거짓말을 하고 있었다.**
 *   · 거버넌스 결정 등록부 · 정형외과 수술 이력 · 원가 코스트센터(PATCH↔PUT 메서드 불일치)
 *   · 포털 연간 영수증·연말정산 증빙 — 서버에 **아예 없다**.
 *     없는 기능을 버튼으로 두지 않고(누를 때마다 "실패했습니다") 정직한 안내로 바꿨다.
 */
/**
 * 🔴 (2026-09-13 실측) 전수 스캔 한 번이 단독 2.1~2.5초 — 기본 제한 5초에 스캔 두 번이 각자 걸려,
 *    병합 트리 API 전체 실행 + web 테스트 동시 실행에서 `판정 보류` 가 **시간초과로** 떨어졌다(단독 재실행은 통과).
 *    CPU 24배 과부하 재현에서 두 스캔 테스트가 5.5초·5.7초로 `Test timed out in 5000ms` — 판정 결함이 아니라 제한 문제.
 *    그래서 ① 스캔은 한 번만 하고(missing·pending 이 같은 결과를 본다) ② 파일 제한을 30초로 둔다.
 */
let scanned: ReturnType<typeof scanPhantomEndpoints> | undefined;
const scanOnce = () => (scanned ??= scanPhantomEndpoints());

describe('🔴 화면이 부르는 EP 는 서버에 존재한다', { timeout: 30_000 }, () => {
  it('스캔이 실제로 라우트·호출을 읽었다(대조군 — 0건이면 스캔이 죽은 것이다)', () => {
    expect(serverRoutes().length).toBeGreaterThan(3000);
    expect(clientCalls().length).toBeGreaterThan(2000);
  });

  it('🔴 문자열 안의 `/*` 가 파일을 삼키지 않는다 — FHIR 라우트가 통째로 사라졌던 자리', () => {
    const kept = stripComments(`const a = { text: 'scope (system/*) here' };\nconst b = 1;`);
    expect(kept, '문자열 안 /* 를 주석으로 읽어 뒤가 사라졌다').toContain('const b = 1');
    expect(stripComments('a /* real */ b'), '진짜 블록 주석은 지운다').not.toContain('real');
    // 실증: FHIR 컨트롤러의 뒤쪽 리소스 라우트가 표에 남아 있어야 한다
    const fhir = serverRoutes().filter((r) => r.p.startsWith('/fhir/R4/'));
    for (const res of ['Condition', 'AllergyIntolerance', 'MedicationRequest', 'Patient']) {
      expect(fhir.some((r) => r.p === `/fhir/R4/${res}`), `${res} 라우트가 표에서 빠졌다`).toBe(true);
    }
  });

  it('🔴 `@Controller()`(빈 prefix)도 읽는다 — clinic-schedule 10라우트가 빠졌던 자리', () => {
    const r = serverRoutes();
    expect(r.some((x) => x.p === '/api/v1/clinic-schedule/today')).toBe(true);
    expect(r.some((x) => x.p === '/api/v1/clinic-closure')).toBe(true);
  });

  it('🔴 `src/common` 컨트롤러도 읽는다(modules 밖)', () => {
    expect(serverRoutes().some((x) => x.p === '/api/v1/mode')).toBe(true);
  });

  /**
   * 🔴 `@Sse()` 는 **전송 방식**일 뿐 HTTP 메서드는 GET 이다.
   *    SSE 로 담으면 화면의 `fetch(...)`(GET)와 안 맞아 오탐이 된다(command-center 스트림).
   */
  it('@Sse 라우트를 GET 으로 담는다', () => {
    const r = serverRoutes();
    expect(r.some((x) => x.m === 'GET' && x.p === '/api/v1/command-center/stream'), 'SSE 를 GET 으로 안 담았다').toBe(true);
    expect(r.some((x) => x.m === 'SSE'), 'SSE 메서드가 표에 남아 있다').toBe(false);
  });

  /**
   * 🔴 **web 만 훑으면 절반이다** — 모바일 환자앱·홈페이지 앱도 같은 서버를 부르고,
   *    web 안에도 `apiClient` 를 안 쓰는 원시 `fetch()` 가 많다.
   */
  it('세 표면(web·mobile·homepage)을 모두 훑는다 — 표면이 빠지면 그쪽은 아무도 대조하지 않는다', () => {
    const files = new Set(clientCalls().map((c) => c.file));
    for (const [label, frag] of [['mobile', '/mobile/'], ['homepage', '/homepage/'], ['web', '/web/']] as const) {
      expect([...files].some((f) => f.includes(frag)), `${label} 표면이 스캔되지 않았다`).toBe(true);
    }
    // 원시 fetch 도 잡는다(apiClient 밖 호출이 90여 곳 있다)
    expect(clientCalls().some((c) => c.path === '/api/v1/command-center/stream'), '원시 fetch 호출을 못 봤다').toBe(true);
  });

  it('서버에 없는 경로를 부르는 호출이 없다', () => {
    const { missing } = scanOnce();
    expect(missing, [
      `🔴 서버에 없는 경로를 부르는 호출 ${missing.length}종 — 그 화면은 404 로 죽어 있다.`,
      `경로 오타·메서드 불일치인지, 아니면 기능 자체가 없는지 갈라서 고친다`,
      `(없으면 **지어내지 말고** 화면에서 내리거나 정직하게 밝힌다):`,
      ...missing,
    ].join('\n')).toEqual([]);
  });

  /**
   * 🔴 **경로만 맞추면 절반이다** — 서명 배지는 `{status,current,required}` 를 기대하는데
   *    정본 EP 는 `SignedDocument`(status·requiredSigners·completedSigners) 를 준다.
   *    경로만 바꾸면 **서명된 문서도 늘 '서명 필요'** 로 그린다(조용한 거짓말).
   */
  it('서명 배지가 정본의 실제 반환 모양을 매핑한다', () => {
    const web = (p: string) => readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8');
    for (const f of ['components/signature/SignatureBadge.tsx', 'components/signature/SignatureStatusIndicator.tsx']) {
      const s = web(f);
      expect(s, `${f}: 정본 경로를 쓰지 않는다`).toMatch(/document-sign\/document\/\$\{documentType\}\/\$\{documentId\}/);
      // 🔴 함수 **선언**만 보면 호출을 지워도 통과한다 — 재주입으로 확인했다. 호출을 겨눈다.
      expect(s, `${f}: 응답을 매핑하지 않고 그대로 읽는다`)
        .toMatch(/\.then\(\(r\) => toSignatureStatus\(r\.data\)\)/);
      expect(s, `${f}: 모델 필드를 읽어야 한다`).toMatch(/completedSigners/);
      expect(s, `${f}: 문서 없음(404)은 NONE 이다`).toMatch(/status: 'NONE' \} as SignatureStatus/);
    }
  });

  it('서버가 그 필드를 실제로 갖는다(대조군 — 내가 가정한 모양이 아니다)', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model SignedDocument'), schema.indexOf('model SignedDocument') + 1400);
    for (const f of ['status', 'requiredSigners', 'completedSigners']) {
      expect(model, `SignedDocument 에 ${f} 가 없다`).toContain(f);
    }
  });

  it('판정 보류(변수가 여러 세그먼트)는 목록으로 남긴다 — 조용히 늘지 않게', () => {
    const { pending } = scanOnce();
    expect(pending, `보류가 늘었다 — 눈으로 확인한다:\n${pending.join('\n')}`)
      .toEqual(['PATCH /api/v1/blood-bank/transfusions/:x']);
  });
});
