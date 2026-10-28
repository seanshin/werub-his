/**
 * 🔴 AI egress 목적지 검증 — **환자 임상 텍스트가 어디로 나가는지**를 fetch 직전에 한 번은 본다.
 *
 * 배경(2026-08-18 실측): `ai.server.url`(SystemConfig) 은 아무 검증 없이 그대로 fetch 되고 있었고,
 * 관리 화면의 범용 설정 PUT 으로 **임의 호스트로 재지정**할 수 있었다(INV-PHI-03 / INV-NET-01 FAIL).
 * 1차 방어는 설정 자체를 잠그는 것(`config-runtime.controller.ts` PROTECTED_KEYS)이고,
 * 이 파일은 **값이 어디서 오든** 나가기 직전에 보는 2차 방어다.
 *
 * 🔴 이 값을 읽는 AI 클라이언트는 **하나가 아니다**(2026-08-18 기준 9곳):
 *   medical-ai · i18n/translation · data-quality · portal/drug-explain · voc/voc-ai ·
 *   scribe/scribe-ai · voice-emr/stt-chunk · formulary · gld/governance
 *   → 새 클라이언트를 만들면 여기를 부른다. 검증 로직을 복사하지 않는다(정본이 둘이면 갈라진다).
 *
 * 판단 근거 — `allowPrivate: true` 인 이유:
 *   이 시스템이 **가야 할 목적지가 사설망(원내 GPU)** 이다. 사설 IP 를 SSRF 로 보고 막으면
 *   정작 폐쇄망 전환을 막는다. 여기서 막을 것은 내부망 접근이 아니라 **임의 외부 호스트로의 재지정**이다.
 *
 * 🔴 2026-09-09 (P0-A) — **fail-closed 로 바뀌었다.**
 *    종전: `AI_EGRESS_ALLOWED_HOSTS` 가 비어 있으면 호스트 제한이 걸리지 않고 **경고 1회**만 남겼다.
 *    그 상태에서 이 파일이 실제로 걸던 통제는 프로토콜·URL 자격증명 검사뿐이었고(allowPrivate:true 라
 *    사설 대역 차단도 아니다), 즉 **임의 외부 호스트로의 재지정이 열려 있었다**.
 *    이제 목록이 비어 있으면 **외부(공개) 호스트로는 나가지 않는다**(`AiEgressHostsUnsetError`).
 *
 *    단 하나의 예외: **원내 사설망/loopback 목적지**(10./172.16-31./192.168./127./localhost/ULA 등)는
 *    목록 없이도 종전대로 나간다. 이 시스템이 가야 할 곳이 원내 GPU 이고, 여기서 막을 것은
 *    내부망 접근이 아니라 **임의 외부 호스트로의 재지정**이기 때문이다(폐쇄망 전환을 막지 않는다).
 *    사설 여부 판정은 `safe-fetch` 정본에 되묻는다 — 대역 규칙 사본을 여기에 만들지 않는다.
 *
 * ⚠️ 그래서 **운영 서버에 이 env 를 넣지 않으면 외부 AI 전송은 전부 실패한다.** 그 사실은
 *    부팅 시 1회 ERROR 로 말한다(`reportNoAiEgressAllowlist` · `env.validation.ts` 가 부른다).
 */

import { Logger } from '@nestjs/common';
import { assertEgressUrl, EgressBlockedError } from './safe-fetch';

export const AI_EGRESS_ALLOWED_HOSTS_ENV = 'AI_EGRESS_ALLOWED_HOSTS';

/**
 * 🔴 차단 사유 코드 — 호출부가 "실패"를 3상태(`UNAVAILABLE`)로 접을 때 보는 키.
 * 사용자에게 나가는 계약은 기존과 같다(medical-ai 는 어떤 `EgressBlockedError` 든 503 `AI_EGRESS_BLOCKED`).
 * 이 코드는 **왜 막혔는가**(설정 미비 vs 목적지 위반)를 운영자가 구분하기 위한 것이다.
 */
export const AI_EGRESS_HOSTS_UNSET_CODE = 'AI_EGRESS_HOSTS_UNSET';

/** 사람이 무엇을 해야 하는지 그 자리에서 말한다 — 부팅 로그·예외 메시지가 같은 문장을 쓴다(정본 하나). */
export const AI_EGRESS_HOSTS_UNSET_MESSAGE =
  `AI 전송 목적지 허용 목록(${AI_EGRESS_ALLOWED_HOSTS_ENV})이 설정되지 않아 외부 호스트로는 전송하지 않습니다. ` +
  `서버 환경변수에 ${AI_EGRESS_ALLOWED_HOSTS_ENV} 를 쉼표 구분으로 지정한 뒤 API 를 재기동하세요` +
  `(예: ${AI_EGRESS_ALLOWED_HOSTS_ENV}=example.org — 현재 \`ai.server.url\` 의 호스트). ` +
  '원내 사설망/loopback 목적지(원내 GPU)는 이 목록 없이도 나갑니다.';

/** 미설정으로 막았다는 사실을 `code` 로 들고 다니는 차단 예외. `EgressBlockedError` 의 하위형이라 기존 호출부 계약(catch·instanceof)은 그대로다. */
export class AiEgressHostsUnsetError extends EgressBlockedError {
  readonly code = AI_EGRESS_HOSTS_UNSET_CODE;
  constructor(host: string) {
    super(`${AI_EGRESS_HOSTS_UNSET_MESSAGE} (목적지 호스트: ${host})`);
    this.name = 'AiEgressHostsUnsetError';
  }
}

/** 설정된 화이트리스트(비어 있으면 **외부 호스트 전면 차단** — 종전의 "제한 없음"이 아니다). */
export function aiEgressAllowedHosts(): string[] {
  return (process.env[AI_EGRESS_ALLOWED_HOSTS_ENV] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

const egressLogger = new Logger('AiEgressPolicy');
/** 프로세스당 1회만 말한다 — 매 요청 로그는 진짜 경보를 묻는다. */
let allowlistReported = false;

/**
 * 🔴 화이트리스트 미설정 사실을 **드러낸다**(감추지 않는다).
 * 이제 미설정은 "통제 없음"이 아니라 **외부 전송 차단**이므로 warn 이 아니라 ERROR 다 —
 * 배포 직후 AI 가 전부 UNAVAILABLE 이 되는데 아무도 이유를 모르는 상황을 만들지 않는다.
 * 부팅 시(`env.validation.ts`) 한 번, 그 뒤 첫 전송 시도에서 또 부르더라도 1회로 접힌다.
 */
export function reportNoAiEgressAllowlist(): void {
  if (allowlistReported) return;
  if (aiEgressAllowedHosts().length) return; // 설정돼 있으면 조용히 — 거짓 경보는 진짜 경보를 죽인다
  allowlistReported = true;
  egressLogger.error(`🔴 ${AI_EGRESS_HOSTS_UNSET_MESSAGE}`);
}

/**
 * 목적지가 **원내 사설망/loopback** 인가 — 미설정 시 예외적으로 허용되는 유일한 부류.
 * 🔴 판정은 `safe-fetch`(정본)에 되묻는다: 사설/loopback 이면 `allowPrivate:false` 로 거절당한다.
 *   대역 정규식을 여기에 복사하면 정본이 둘이 되어 갈라진다(2026-08-20 erp-eapproval 사본 사고).
 *   프로토콜·URL 유효성은 호출 시점에 이미 통과했으므로, 여기서의 예외 = 사설 대역 판정이다.
 *   ⚠️ 이름 호스트(`gpu.internal` 등)는 DNS 없이 사설임을 알 수 없다 → 공개로 본다(안전측).
 */
function isPrivateAiDestination(u: URL): boolean {
  try {
    assertEgressUrl(u.toString(), { allowPrivate: false });
    return false;
  } catch {
    return true;
  }
}

/**
 * AI 서버 URL 검증. 위반이면 `EgressBlockedError`(또는 그 하위형)를 던진다 — 삼키지 않는다.
 * 호출부는 이 예외를 503 등 사용자에게 정직한 실패로 바꿔야 한다. **빈 결과로 덮지 말 것.**
 */
export function assertAiServerUrl(raw: string): URL {
  const allowed = aiEgressAllowedHosts();
  const u = assertEgressUrl(raw, { allowedHosts: allowed, allowPrivate: true });
  // URL 에 박힌 자격증명(user:pass@host)은 로그·리다이렉트로 새어나간다 — 목적지 지정 수단으로 부적격.
  if (u.username || u.password) throw new EgressBlockedError('credentials in URL');
  // 🔴 fail-closed: 목록이 비면 외부 호스트로 나가지 않는다(원내 사설망은 종전대로 허용).
  if (!allowed.length && !isPrivateAiDestination(u)) {
    reportNoAiEgressAllowlist(); // 왜 막혔는지 로그에 한 번은 남는다
    throw new AiEgressHostsUnsetError(u.hostname);
  }
  return u;
}
