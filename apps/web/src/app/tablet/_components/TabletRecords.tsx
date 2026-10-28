'use client';
import { useState } from 'react';
import { usePatientEncounters } from '@/hooks/useEncounters';
import { NursingRecordTab } from '@/app/(main)/patients/[id]/components/NursingRecordTab';
import { OrderTrackingTab } from '@/app/(main)/patients/[id]/components/OrderTrackingTab';

type EncRow = { id: string; createdAt?: string; status?: string; assessment?: string; subjective?: string; doctor?: { familyName?: string; givenName?: string } };

const SUBS = [
  { key: 'nursing', label: '간호기록' },
  { key: 'encounters', label: '진료이력' },
  { key: 'orders', label: '오더추적' },
] as const;

function EncounterList({ patientId }: { patientId: string }) {
  const { data, isLoading } = usePatientEncounters(patientId);
  const list = ((data?.data ?? []) as EncRow[]).filter((e) => e.status !== 'DRAFT' || e.subjective || e.assessment);
  if (isLoading) return <div className="p-4 text-gray-400">불러오는 중…</div>;
  if (!list.length) return <div className="p-4 text-gray-400">진료 이력 없음</div>;
  return (
    <ul className="space-y-2 p-1">
      {list.map((e) => (
        <li key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-gray-800">{(e.createdAt ?? '').slice(0, 10)}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${e.status === 'SIGNED' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{e.status === 'SIGNED' ? '완료' : e.status === 'DRAFT' ? '작성중' : (e.status ?? '')}</span>
          </div>
          {(e.assessment || e.subjective) && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{e.assessment || e.subjective}</p>}
          {e.doctor && <p className="mt-1 text-xs text-gray-400">{e.doctor.familyName}{e.doctor.givenName}</p>}
        </li>
      ))}
    </ul>
  );
}

/** 기록 세그먼트 — 간호기록·진료이력·오더추적(서브 토글). */
export default function TabletRecords({ patientId }: { patientId: string }) {
  const [sub, setSub] = useState<string>('nursing');
  return (
    <div className="p-3">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-3 w-fit">
        {SUBS.map((s) => (
          <button key={s.key} onClick={() => setSub(s.key)}
            className={`min-h-[40px] px-4 rounded-lg text-sm font-semibold ${sub === s.key ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'nursing' && <NursingRecordTab patientId={patientId} />}
      {sub === 'encounters' && <EncounterList patientId={patientId} />}
      {sub === 'orders' && <OrderTrackingTab patientId={patientId} />}
    </div>
  );
}
