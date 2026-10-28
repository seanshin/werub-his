import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanHandlerAuthz, authzKey } from './handler-authz-scan';

/**
 * 무인증(공개) **쓰기** 핸들러의 속도 한도 — 정확값 동결.
 *
 * 🔴 왜(2026-09-16 H2 실측): 공개 쓰기 폼은 형제들이 자기 한도를 적어 두는데
 *    (비회원 VoC 5회/분 "전역 600/분 override" · 만족도 설문 60 · 키오스크 10·5)
 *    `POST /api/v1/partner/apply` 만 아무것도 없어 **한 IP 가 분당 600건**을 만들 수 있었다.
 *    공개 신청 폼이 그러면 심사 큐가 스팸으로 막힌다 → `@Throttle 5/분` 을 붙였다.
 *
 * 🔴 **"한도 없음 37" 은 "결함 37" 이 아니다.** 대부분 연동키로 막힌 서버-서버(ERP·PACS·EMS·edu)이고,
 *    그쪽은 전역 기본(600/분)으로 충분하며 오히려 대량 동기화가 정상이다. 한 건씩 판정하지 않은 채
 *    "전부 붙여라"로 강제하면 정상 연동을 끊는다 — 그래서 **지키는 것은 "조용히 늘지 않는다" 하나**다.
 *    새 공개 쓰기가 한도 없이 생기면 이 목록이 늘어 실패한다.
 *
 * 🔴 (2026-09-16 I1) 36 → **37**. 늘었지만 새 위반이 아니다 — `voucher-settlement` 의 ERP 정산 회신이
 *    스캐너 오판(앞 클래스의 `@UseGuards` 를 주움)으로 **공개 쓰기 목록에 아예 없었다**. 연동키+본문 HMAC+
 *    타임스탬프 신선도로 막히는 서버-서버 회신이라 한도는 그대로 두고 **드러난 값**으로 동결한다.
 *
 * 🔴 (2026-09-21 I) 37 → **39**. 역시 새 위반이 아니라 **스캐너가 못 보던 자리**다 —
 *    경로 없는 `@Controller()` 컨트롤러가 분모에 통째로 없었다(`handler-authz-scan.ts` 참조).
 *    드러난 둘은 `POST /api/v1/sso/verify`(Clinic SSO 토큰 검증)·`POST /oauth2/token`(SMART OAuth).
 *    🔴 **한도를 지금 감으로 붙이지 않는다** — 둘 다 로그인 경로라 숫자가 낮으면 NAT 뒤 병원이
 *    통째로 막히고, 높으면 없는 것과 같다. 이 축의 규칙대로(임계값은 그 축의 과거 실측에서)
 *    **드러난 값으로 동결**하고 한도 산정은 사람 결정으로 남긴다.
 *
 * 🔴 구간 분해는 스캐너 정본(`scanHandlerAuthz`)에 맡긴다. 이 스펙의 첫 판은 직접 소스를 잘랐다가
 *    같은 파일의 **포털용 동명 핸들러**(`@Post('tickets')`)를 먼저 잡아 공개 VoC 를 "한도 없음"으로
 *    오판했고, 다중 클래스 파일의 `@SkipThrottle` 도 첫 클래스 것을 잘못 붙였다.
 */
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'test/architecture/public-write-throttle.baseline.json'), 'utf8'),
) as { unthrottledPublicWrites: string[] };

const WRITE = /^(POST|PUT|PATCH|DELETE)\b/;
const publicWrites = () => scanHandlerAuthz().filter((h) => !h.authed && WRITE.test(h.ep));

describe('🔴 무인증 공개 쓰기 — 속도 한도 정확값 동결', () => {
  const rows = publicWrites();

  it('대조군 — 스캔이 실제로 돌았다(공개 쓰기 분모 하한)', () => {
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.some((r) => r.file.includes('voc'))).toBe(true);
  });

  it('한도 없는 공개 쓰기 목록이 기준선과 정확히 같다(늘면 새 무한도 · 줄면 기준선을 줄여라)', () => {
    const unthrottled = rows.filter((r) => !r.throttled).map(authzKey).sort();
    expect(unthrottled).toEqual(BASELINE.unthrottledPublicWrites);
  });

  it('🔴 공개 신청 폼(partner/apply)은 형제 공개 폼처럼 자기 한도를 갖는다', () => {
    const r = rows.find((x) => x.file.includes('partner-request') && x.ep === 'POST partner/apply');
    expect(r, 'partner/apply 핸들러를 찾지 못했다 — 옮겼으면 이 가드를 고친다').toBeTruthy();
    expect(r!.throttled).toBe(true);
    expect(BASELINE.unthrottledPublicWrites).not.toContain(authzKey(r!));
  });

  /**
   * 🔴 I1 대조군 — **한 파일 다중 컨트롤러**. 문진표 공개 클래스는 바로 위 인증 클래스의 `@UseGuards` 를
   *    스캐너가 주워 "인증됨"으로 오판당했고, 그래서 이 목록에도 **아예 나타나지 않았다**.
   *    공개로 잡히는지 + 자기 한도가 있는지 둘 다 본다.
   */
  it('🔴 문진표 공개 쓰기 2개가 공개로 잡히고 자기 한도를 갖는다(앞 클래스 가드를 주워 숨지 않는다)', () => {
    const eps = rows.filter((r) => r.prefix === '/api/v1/questionnaires');
    expect(eps.map((r) => r.ep).sort()).toEqual(['POST :token/submit', 'PUT :token/save']);
    for (const r of eps) expect(r.throttled, `${r.ep} 에 자기 한도가 없다`).toBe(true);
  });

  it('대조군 — 비회원 VoC 는 자기 한도가 있다(동명 포털 핸들러를 잘못 잡지 않는다)', () => {
    const r = rows.find((x) => x.file.includes('voc/voc.controller') && x.ep === 'POST tickets');
    expect(r, '공개 VoC 핸들러를 찾지 못했다').toBeTruthy();
    expect(r!.prefix).toBe('/api/v1/voc');
    expect(r!.throttled).toBe(true);
  });
});
