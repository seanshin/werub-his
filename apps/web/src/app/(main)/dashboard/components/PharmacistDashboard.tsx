'use client';

import { T } from '@/components/ui/i18n-text';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';

import { Unit, DrugName, PatientName } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pharmacyStageOf, PHARMACY_STAGE_LABEL, type PharmacyStage } from '@/lib/widget-summaries';

/**
 * 약사 업무 요약 — 조제 단계별 건수 + STAT 처방.
 *
 * 🔴 (2026-10-02 역할별 대시보드 재검토)
 *  - '검수 대기' 칸이 `order.status === 'DISPENSED'` 를 세어 **개통 이래 0**이었다 — 조제가 끝나면 오더는 COMPLETED 로
 *    닫히고 검수 대기는 조제 상태(dispensing.status)에 있다(실측 검수 대기 5건이 0). → 단계 판정 정본 `pharmacyStageOf`.
 *  - 재고 부족 칸이 `/api/v1/inventory`(일반 물품 · 관리자 전용)를 불러 **약사에게 늘 403** 이었다. 약품 재고는
 *    같은 배치의 '재고 부족' 위젯(약국 재고 정본 `/pharmacy/inventory/low-stock`)이 말한다 → 여기서는 뺐다.
 *  - 조제 대기 목록 8행을 같은 배치의 '조제 대기열' 위젯과 **두 번** 그렸다 → 목록은 위젯 하나, 여기는 단계 요약.
 *  - 대기열 조회 실패를 "대기 없음"으로 그렸다 → 실패는 실패로.
 */
interface PharmacyQueueItem {
  id: string;
  status: string;
  priority?: string;
  dispensing?: { status?: string } | null;
  prescription?: {
    priority?: string;
    medicationCode?: { nameKo?: string; nameEn?: string | null; ingredient?: string | null };
    encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } };
  };
}

const STAGES: PharmacyStage[] = ['ORDERED', 'IN_PROGRESS', 'VERIFY_WAIT', 'ISSUE_WAIT'];
const STAGE_TONE: Record<string, string> = {
  ORDERED: 'text-blue-700', IN_PROGRESS: 'text-amber-700', VERIFY_WAIT: 'text-emerald-700', ISSUE_WAIT: 'text-violet-700',
};

export default function PharmacistDashboard() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pharmacy-queue'],
    queryFn: () => apiClient.get<{ data: PharmacyQueueItem[] }>('/api/v1/pharmacy/queue'),
    refetchInterval: pollMs('fast'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;

  const raw = data?.data as unknown;
  const list: PharmacyQueueItem[] = Array.isArray(raw) ? raw : ((raw as { data?: PharmacyQueueItem[] })?.data ?? []);
  const count = (s: PharmacyStage) => list.filter((o) => pharmacyStageOf(o) === s).length;
  // 접수됨(RECEIVED)은 조제 착수 전 단계라 '접수 대기' 칸이 아니라 '조제 중' 칸에 함께 센다 — 약국 화면 탭과 같은 묶음은 아니므로 라벨에 밝힌다
  const stageCount = (s: PharmacyStage) => (s === 'IN_PROGRESS' ? count('IN_PROGRESS') + count('RECEIVED') : count(s));
  const statOrders = list.filter((o) => (o.prescription?.priority ?? o.priority) === 'STAT' && pharmacyStageOf(o) !== 'ISSUE_WAIT');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((s) => (
          <Link key={s} href="/pharmacy" data-pharmacy-stage={s} className="rounded-xl border border-gray-100 px-3 py-2.5 hover:border-slate-300">
            <p className="text-[11px] text-gray-500"><T k={PHARMACY_STAGE_LABEL[s]} />{s === 'IN_PROGRESS' && <span className="text-gray-400"> (<T k="접수됨 포함" />)</span>}</p>
            <p className={`text-2xl font-bold tabular-nums ${STAGE_TONE[s]}`}>{isLoading ? '…' : stageCount(s)}</p>
          </Link>
        ))}
      </div>
      {/* STAT 은 있을 때만 — 없는 것을 초록으로 칠하지 않는다 */}
      {statOrders.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="mb-1.5 text-xs font-bold text-red-800">STAT <T k="긴급 처방" /> {statOrders.length}<Unit><T k="건" /></Unit></p>
          {statOrders.slice(0, 3).map((o) => (
            <div key={o.id} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="font-medium text-gray-900">
                {o.prescription?.medicationCode ? <DrugName nameKo={o.prescription.medicationCode.nameKo} nameEn={o.prescription.medicationCode.nameEn} ingredient={o.prescription.medicationCode.ingredient} /> : <T k="약물" />}
              </span>
              <PatientName familyName={o.prescription?.encounter?.patient?.familyName} givenName={o.prescription?.encounter?.patient?.givenName} className="text-gray-500" showMrn={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
