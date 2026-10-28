import { redirect } from 'next/navigation';

// 생체 승인은 스태프 생체포털(/staff/approvals·폰 컨텍스트)로 이전됨.
// 기존 링크/FCM 알림 호환을 위해 리다이렉트 유지.
export default function ApprovalsRedirect() {
  redirect('/staff/approvals');
}
