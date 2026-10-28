'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { claimCounts } from '@/lib/claims-summary';

// 서버는 groupBy 배열을 준다 — 평면 키(draft/submitted)로 읽으면 실제 청구가 있어도 전 칸 0(P11·2026-08-13)
export default function ClaimsWidget() {
  return <ApiStatsWidget widgetId="claims" endpoint="/api/v1/claims/summary" transform={claimCounts}
    stats={[
      { key: 'pending', label: '미청구', color: 'text-blue-600' },
      { key: 'reviewing', label: '제출됨', color: 'text-amber-600' }, // P4-4: 전송 채널이 없어 '심사중'이 아니다
      { key: 'approved', label: '인정', color: 'text-emerald-600' },
      { key: 'rejected', label: '반려', color: 'text-red-600' },
      { key: 'paid', label: '지급', color: 'text-indigo-600' },
      { key: 'totalClaimed', label: '총 청구액', format: (v: number) => `${Number(v ?? 0).toLocaleString()}원` },
    ]} />;
}
