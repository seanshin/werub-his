'use client';

import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';
import { EmptyState, Unit, genderText } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';

interface CensusPatient {
  patient: { id: string; familyName: string; givenName: string; mrn: string; gender: string; dateOfBirth: string; photoUrl?: string };
  admission: { id: string; admitDate: string; ward: string; room: string; bed: string; dietType?: string; daysAdmitted: number; admitReason?: string };
  status: 'CRITICAL' | 'UNSTABLE' | 'NEW' | 'DC_PLAN' | 'STABLE';
  primaryDiagnosis: string | null;
  latestVitals: { systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; painScore?: number; recordedAt?: string } | null;
  vitalTrend: string;
  lastRoundAt: string | null;
  lastRoundType: string | null;
  pendingLabCount: number;
  pendingLabItems: string[];
  todayNursingNotes: number;
  activeRxCount: number;
  urgentAlerts: { type: string; message: string; severity: string; at: string }[];
}

interface CensusResponse {
  doctorInfo: { id: string; name: string; department?: string; specialty?: string } | null;
  totalPatients: number;
  byStatus: { critical: number; unstable: number; new: number; stable: number; dcPlan: number };
  patients: CensusPatient[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; border: string; dot: string; pulse?: boolean }> = {
  CRITICAL:  { label: '위급',   color: 'text-red-700 bg-red-100',       border: 'border-l-red-500',    dot: 'bg-red-500',    pulse: true },
  UNSTABLE:  { label: '불안정', color: 'text-orange-700 bg-orange-100', border: 'border-l-orange-400', dot: 'bg-orange-400' },
  NEW:       { label: '신규',   color: 'text-blue-700 bg-blue-100',     border: 'border-l-blue-400',   dot: 'bg-blue-400' },
  STABLE:    { label: '안정',   color: 'text-green-700 bg-green-100',   border: 'border-l-gray-200',   dot: 'bg-green-400' },
  DC_PLAN:   { label: '퇴원예정', color: 'text-purple-700 bg-purple-100', border: 'border-l-purple-300', dot: 'bg-purple-400' },
};

export default function MyCensusPanel() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-census'],
    queryFn: () => apiClient.get<{ data: CensusResponse }>('/api/v1/doctors/my-census'),
    refetchInterval: pollMs('normal'),
  });

  const census: CensusResponse | null = (data?.data as any)?.data ?? data?.data ?? null;

  if (isLoading) {
    return <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />;
  }
  // 🔴 종전: 조회 실패·빈 목록 모두 `null` — 위젯 틀 안이라 제목만 있는 빈 카드가 됐고, 실패가 "담당 없음"과 같은 모양이었다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (!census || census.totalPatients === 0) {
    return <EmptyState compact icon="🛏️" title="담당 입원 환자가 없습니다." />;
  }

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{census.totalPatients}<Unit><T k="명" /></Unit></span>
          {/* 상태 요약 인라인 */}
          <div className="flex gap-1.5 ml-2">
            {census.byStatus.critical > 0 && <StatusBadge status="CRITICAL" count={census.byStatus.critical} />}
            {census.byStatus.unstable > 0 && <StatusBadge status="UNSTABLE" count={census.byStatus.unstable} />}
            {census.byStatus.new > 0 && <StatusBadge status="NEW" count={census.byStatus.new} />}
            {census.byStatus.stable > 0 && <StatusBadge status="STABLE" count={census.byStatus.stable} />}
            {census.byStatus.dcPlan > 0 && <StatusBadge status="DC_PLAN" count={census.byStatus.dcPlan} />}
          </div>
        </div>
        <Link href="/rounds" className="text-xs text-blue-600 hover:text-blue-700 font-medium"><T k="회진 시작" /> →</Link>
      </div>

      {/* 환자 테이블형 목록 */}
      <div className="divide-y divide-gray-100">
        {census.patients.slice(0, 8).map(p => (
          <PatientCensusRow key={p.admission.id} patient={p} />
        ))}
      </div>

      {census.totalPatients > 8 && (
        <div className="mt-2 text-center">
          <Link href="/rounds" className="text-xs text-gray-500 hover:text-blue-600">+{census.totalPatients - 8}<Unit><T k="명" /></Unit> <T k="더 보기" /></Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, count }: { status: string; count: number }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.STABLE;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-px rounded-full ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      <T k={cfg.label} /> {count}
    </span>
  );
}

function PatientCensusRow({ patient: p }: { patient: CensusPatient }) {
  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.STABLE;

  // 🔴 (2026-09-30) "미확인 검사 N건"은 줄일 방법이 없는 숫자였다 — 확인 EP 를 부르는 화면이 없었다.
  //    이제 그 숫자가 검사결과 확인함(그 환자·같은 조건)으로 이어진다. 행 링크 안에 링크를 넣을 수 없어 형제로 둔다.
  return (
    <div className="flex items-center hover:bg-gray-50 transition-colors">
    <Link
      href={`/inpatient/${p.admission.id}`}
      className="flex flex-1 min-w-0 items-center gap-2 px-2 py-2"
    >
      {/* 상태 배지 */}
      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-px rounded-full ${cfg.color} whitespace-nowrap flex-shrink-0`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
        <T k={cfg.label} />
      </span>
      {/* 이름 */}
      <span className="text-[13px] font-bold text-gray-900 whitespace-nowrap">
        {p.patient.familyName}{p.patient.givenName}
      </span>
      {/* 성별/재원일 */}
      <span className="text-[11px] text-gray-400 whitespace-nowrap">
        ({genderText(p.patient.gender)}/{p.admission.daysAdmitted}일)
      </span>
      {/* 진단 */}
      <span className="text-xs text-gray-500 truncate min-w-0 flex-1">{p.primaryDiagnosis || '-'}</span>
      {/* 알림 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {p.activeRxCount > 0 && (
          <span className="text-[10px] text-gray-400 whitespace-nowrap"><T k="처방" /> {p.activeRxCount}<Unit><T k="건" /></Unit></span>
        )}
        {p.urgentAlerts.length > 0 && (
          <span className="text-[10px] text-red-600 font-medium whitespace-nowrap"><T k="긴급" /> {p.urgentAlerts.length}</span>
        )}
      </div>
      {/* 병실 */}
      <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0 ml-auto">
        {p.admission.ward} {p.admission.room}-{p.admission.bed}
      </span>
    </Link>
    {p.pendingLabCount > 0 && (
      <Link
        href={`/results-inbox?patientId=${p.patient.id}`}
        className="flex-shrink-0 px-2 py-2 text-[10px] font-medium text-amber-600 whitespace-nowrap hover:underline"
      >
        <T k="미확인 검사" /> {p.pendingLabCount}<Unit><T k="건" /></Unit> →
      </Link>
    )}
    </div>
  );
}
