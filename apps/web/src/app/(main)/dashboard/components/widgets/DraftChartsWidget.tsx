'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';

interface DraftEncounter {
  id: string;
  patientId: string;
  patient?: { familyName: string; givenName: string };
  chiefComplaint?: string | null;
  /** 🔴 (2026-10-02) 종전엔 응답에 없는 `date` 를 읽어 **모든 행의 날짜가 '-'** 였다 — 진료 기록 시작 시각은 createdAt */
  createdAt?: string;
}

export default function DraftChartsWidget() {
  const { data, isError } = useQuery({
    queryKey: ['encounters-draft-my'],
    queryFn: () => apiClient.get<{ data: DraftEncounter[]; pagination?: { total?: number } }>('/api/v1/encounters?status=DRAFT&limit=10&mine=true'),
    // 🔴 조회 실패를 빈 목록으로 접지 않는다 — "미완료 없음"은 다른 사실이다(아래 isError 분기)
    refetchInterval: pollMs('fast'),
  });

  // 서버 정본은 `{ data: Encounter[], pagination }` 이다(encounter.service.findAll).
  // 🔴 `as any` 로 두 모양을 다 받으면 계약이 바뀌어도 조용히 빈 목록이 된다 — 한 모양만 읽는다.
  const draftEncounters: DraftEncounter[] = data?.data ?? [];
  // 🔴 (2026-10-02) 배지가 받아 온 한 쪽(10건)을 셌다 — 실측 47건이 "10건". 전체 수는 서버 pagination.total
  const total = data?.pagination?.total ?? draftEncounters.length;

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        {total > 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" data-draft-total={total}>
            {total}<Unit><T k="건" /></Unit>
          </span>
        )}
        {total > 5 && <span className="text-[10px] text-gray-400"><Tf k="최근 {표시}건" params={{ 표시: 5 }} /></span>}
      </div>
      {isError ? (
        <p className="text-xs text-rose-500 py-2 text-center"><T k="미완료 차트를 불러오지 못했습니다" /></p>
      ) : draftEncounters.length === 0 ? (
        <p className="text-xs text-gray-400 py-2 text-center"><T k="없음" /></p>
      ) : (
        <div className="divide-y divide-gray-50">
          {draftEncounters.slice(0, 5).map((enc) => (
            <Link
              key={enc.id}
              // 🔴 `encounterId` 가 없으면 진료 화면이 **무조건 새 DRAFT 를 만든다**(빈 DRAFT 누적).
              //    쓰던 것을 이어받게 그 id 를 넘긴다.
              href={`/patients/${enc.patientId}/encounter/new?encounterId=${enc.id}`}
              className="flex items-center justify-between py-1.5 px-1 hover:bg-amber-50 transition-colors"
            >
              <span className="min-w-0 truncate text-xs font-medium text-gray-900">
                {enc.patient?.familyName}{enc.patient?.givenName}
                {enc.chiefComplaint && <span className="ml-1.5 font-normal text-gray-400">{enc.chiefComplaint}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-gray-400">
                {enc.createdAt ? kdate(enc.createdAt, 'monthDay') : '-'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
