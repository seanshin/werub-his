import { redirect } from 'next/navigation';

/**
 * 구 트리아지 워크스테이션은 존재하지 않는 엔드포인트(PATCH /triage/orders/:id/ktas,
 * /workstation/order/:id/complete)를 호출하고 큐가 KTAS 필드 없는 일반 오더를 반환해
 * 전체 비기능이었음. 작동하는 응급실 트리아지(/emergency)로 대체·리다이렉트.
 */
export default function TriageWorkstationRedirect() {
  redirect('/emergency');
}
