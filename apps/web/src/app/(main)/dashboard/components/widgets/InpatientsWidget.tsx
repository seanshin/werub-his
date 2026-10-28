'use client';

import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';

interface InpatientItem {
  id: string;
  doctorId?: string;
  attendingDoctorId?: string;
  doctor?: { userId?: string };
  ward?: string | { name: string };
  bed?: { ward?: { name: string }; roomNumber: string; bedNumber: string };
  roomNumber?: string;
  bedNumber?: string;
  patient?: { familyName: string; givenName: string; id: string };
  admitReason?: string;
  diagnosis?: string;
  admitDate?: string;
  dietType?: string;
  diet?: string;
}

export default function InpatientsWidget({ settings }: { settings?: Record<string, unknown> }) {
  const { user } = useAuthStore();
  const maxItems = (settings?.maxItems as number) ?? 5;
  const showDiet = (settings?.showDiet as boolean) ?? false;

  // 🔴 종전 `.catch(() => ({ data: [] }))` — 조회 실패가 "담당 입원환자가 없습니다"로 둔갑했다(P17)
  const { data, isError } = useQuery({
    queryKey: ['doctor-inpatient'],
    queryFn: () => apiClient.get<{ data: InpatientItem[] }>('/api/v1/inpatient'),
    refetchInterval: pollMs('normal'),
  });

  const allInpatients: InpatientItem[] = Array.isArray(data?.data) ? data.data : [];
  const myInpatients = user?.role === 'NURSE'
    ? allInpatients
    : allInpatients.filter((p) => p.doctorId === user?.id || p.attendingDoctorId === user?.id || p.doctor?.userId === user?.id);

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {myInpatients.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{myInpatients.length}<Unit><T k="명" /></Unit></span>
          )}
        </div>
        <Link href="/inpatient" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="전체 보기" /> →</Link>
      </div>
      {isError ? (
        <p className="text-xs text-red-600 py-2 text-center"><T k="입원환자 조회 실패 — ‘0명’이 아니라" /> <b><T k="확인 불가" /></b></p>
      ) : myInpatients.length === 0 ? (
        <EmptyState compact icon="👤" title="담당 입원환자가 없습니다" />
      ) : (
        <div className="divide-y divide-gray-50">
          {myInpatients.slice(0, maxItems).map((p) => {
            const diet = p.dietType ?? p.diet ?? '';
            const dietColors: Record<string, string> = { '일반식': 'bg-gray-100 text-gray-600', '저염식': 'bg-blue-100 text-blue-700', '당뇨식': 'bg-amber-100 text-amber-700', '유동식': 'bg-violet-100 text-violet-700', '금식': 'bg-red-100 text-red-700' };
            return (
              <div key={p.id} className="flex items-center justify-between py-1.5 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-indigo-600 whitespace-nowrap">
                    {typeof p.ward === 'string' ? p.ward : p.ward?.name ?? p.bed?.ward?.name ?? ''} {p.roomNumber ?? p.bed?.roomNumber ?? ''}-{p.bedNumber ?? p.bed?.bedNumber ?? ''}
                  </span>
                  <span className="text-xs font-medium text-gray-900">
                    {p.patient?.familyName}{p.patient?.givenName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500 truncate max-w-[120px]">{p.admitReason ?? p.diagnosis ?? ''}</span>
                  {showDiet && diet && (
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${dietColors[diet] ?? 'bg-gray-100 text-gray-600'}`}><T k={diet} /></span>
                  )}
                  {p.admitDate && (
                    <span className="text-[10px] text-gray-400">
                      {kdate(p.admitDate, 'monthDay')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <Link href="/inpatient" className="mt-1.5 block text-center text-xs text-indigo-600 hover:text-indigo-700 font-medium py-1">
            <T k="회진 시작" /> →
          </Link>
        </div>
      )}
    </>
  );
}
