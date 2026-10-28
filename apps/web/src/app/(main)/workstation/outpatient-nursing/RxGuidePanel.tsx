'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { DrugName, EmptyState } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 처방 설명 가이드(기획 outpatient-nurse-workflow #17) — 진료 후 간호사가 환자에게 약을 설명할 때 보는 자료.
 *
 * 🔴 처방·약품 마스터 **값 그대로**다. 용법·주의 문구를 만들지 않고, AI 교육자료를 부르지 않는다.
 *    마스터에 연결되지 않은 처방은 약 정보를 지어내지 않고 "마스터 미등록"으로 말한다.
 * 🔴 고위험(ISMP)·마약류 표시는 nursing 카탈로그 규약대로 **번역 미등재 원문**(오역이 안전사고가 되는 자리).
 */
interface RxGuideItem {
  prescriptionId: string;
  order: {
    dosage: string | null; frequency: string | null; durationDays: number | null; quantity: number | null;
    route: string | null; prescriberInstructions: string | null; priority: string; dispensingType: string;
  };
  medication: {
    code: string; nameKo: string; nameEn: string | null; ingredient: string | null; dosageForm: string | null;
    unit: string | null; storageCondition: string | null; highAlert: boolean; highAlertCategory: string | null;
    controlSchedule: string | null; narcoticType: string | null; pregnancyCategory: string | null;
    lasaGroup: string | null; masterActive: boolean;
  } | null;
}
interface RxGuide { encounterId: string; truncated: boolean; limit: number; items: RxGuideItem[] }

const dash = (v: string | number | null | undefined) => (v == null || v === '' ? '-' : String(v));

export function RxGuidePanel({ encounterId }: { encounterId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rx-guide', encounterId],
    queryFn: () => apiClient.get<{ data: RxGuide }>(`/api/v1/nurse-station/rx-guide/${encounterId}`),
  });
  if (isLoading) return <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />;
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;
  const guide = data?.data;
  if (!guide || guide.items.length === 0) {
    return <EmptyState compact title={<T k="이 진료에 약 처방이 없습니다" />} />;
  }
  return (
    <div className="space-y-2" data-testid="rx-guide">
      <p className="text-[11px] text-gray-500">
        <T k="처방·약품 마스터에 등록된 값 그대로입니다 — 용법·주의 문구는 만들지 않습니다" />
      </p>
      {guide.truncated && (
        <p className="text-[11px] text-amber-700"><Tf k="처방이 많아 앞의 {건수}건만 표시합니다" params={{ 건수: guide.limit }} /></p>
      )}
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {guide.items.map((it) => (
          <li key={it.prescriptionId} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {it.medication ? (
                <DrugName nameKo={it.medication.nameKo} nameEn={it.medication.nameEn} ingredient={it.medication.ingredient} code={it.medication.code} className="font-medium text-gray-900" />
              ) : (
                <span className="font-medium text-gray-500" data-testid="rx-no-master"><T k="마스터 미등록 처방" /></span>
              )}
              {it.medication?.highAlert && (
                <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold whitespace-nowrap" title="ISMP 고위험 약물">⛔고위험{it.medication.highAlertCategory ? ` ${it.medication.highAlertCategory}` : ''}</span>
              )}
              {(it.medication?.narcoticType || it.medication?.controlSchedule) && (
                <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded whitespace-nowrap">마약류 {dash(it.medication?.narcoticType ?? it.medication?.controlSchedule)}</span>
              )}
              {it.medication && !it.medication.masterActive && (
                <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"><T k="마스터 비활성" /></span>
              )}
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600 md:grid-cols-4">
              <div><dt className="inline text-gray-400"><T k="용량" /> </dt><dd className="inline">{dash(it.order.dosage)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="빈도" /> </dt><dd className="inline">{dash(it.order.frequency)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="일수" /> </dt><dd className="inline">{dash(it.order.durationDays)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="경로" /> </dt><dd className="inline">{dash(it.order.route)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="제형" /> </dt><dd className="inline">{dash(it.medication?.dosageForm)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="보관@약품" /> </dt><dd className="inline">{dash(it.medication?.storageCondition)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="임부 분류" /> </dt><dd className="inline">{dash(it.medication?.pregnancyCategory)}</dd></div>
              <div><dt className="inline text-gray-400"><T k="유사명칭 그룹" /> </dt><dd className="inline">{dash(it.medication?.lasaGroup)}</dd></div>
            </dl>
            {it.order.prescriberInstructions && (
              <p className="mt-1 text-xs text-gray-700"><span className="text-gray-400"><T k="처방의 지시(원문)" /> </span>{it.order.prescriberInstructions}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
