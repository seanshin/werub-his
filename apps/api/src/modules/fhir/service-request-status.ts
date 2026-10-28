import type { OrderStatus } from '@prisma/client';
import type { FhirServiceRequest } from './types/fhir-r4.types';

type SrStatus = NonNullable<FhirServiceRequest['status']>;

/**
 * HIS 오더 상태 → FHIR ServiceRequest.status — **응답 매퍼와 검색 필터가 이 표 하나에서 파생한다.**
 *
 * 🔴 종전엔 표가 둘이었다. 매퍼는 `ORDERED·RECEIVED·IN_PROGRESS → active`
 *    인데 검색은 `active → ORDERED` 하나만 걸렀다. LIS 는 `status=active&_lastUpdated=ge<직전 폴링>` 으로 폴링하므로,
 *    폴링 사이에 HIS 에서 **채혈(IN_PROGRESS)·접수(RECEIVED)가 먼저 되면 그 오더는 LIS 에 영영 가지 않았다**
 *    (응급 STAT 채혈이 전형). 같은 응답 안에서 "active 로 보이는 것"과 "active 로 찾히는 것"이 달랐다(P11·P12).
 *
 * `Record<OrderStatus, …>` 라 오더 상태가 늘면 tsc 가 여기서 멈춘다(어휘가 조용히 빠지지 않는다).
 */
export const ORDER_STATUS_TO_FHIR_SR: Record<OrderStatus, SrStatus> = {
  ORDERED: 'active',
  RECEIVED: 'active',
  IN_PROGRESS: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'revoked',
};

export function fhirServiceRequestStatus(orderStatus: string | null | undefined): SrStatus {
  return (orderStatus && (ORDER_STATUS_TO_FHIR_SR as Record<string, SrStatus>)[orderStatus]) || 'unknown';
}

/**
 * 검색 `status=` 값(쉼표 = OR) → 걸러야 할 HIS 오더 상태 집합. 위 표의 역상.
 *
 * 매핑되는 HIS 상태가 없는 코드(`draft`·`on-hold`·`entered-in-error`·오타 등)는 **빈 집합**이다 —
 * 종전처럼 필터를 버리고 전건을 돌려주면 `status=draft` 가 진행 중 오더 전체를 "draft" 검색 결과로 내놓는다.
 */
export function orderStatusesForFhirSrSearch(param: string): OrderStatus[] {
  const wanted = new Set(param.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return (Object.keys(ORDER_STATUS_TO_FHIR_SR) as OrderStatus[]).filter((k) => wanted.has(ORDER_STATUS_TO_FHIR_SR[k]));
}
