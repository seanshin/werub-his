'use client';

import { useDurationText } from '@/components/ui/display';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs, kdate } from '@/lib/ui-settings';
import { EMERGENCY_VISIT_STATUS_LABEL, ageOf } from '@hospital-run/shared';
import { KTAS_LEVEL_LABEL, KTAS_SOLID } from '@/lib/ktas';

/**
 * ER 베드사이드 디스플레이(P2·§4.3) — 베드 곁 태블릿/모니터 전체화면.
 * - 스태프 세션 필수(D5 — 익명 kiosk 토큰 없음). 데이터는 display EP 단일 호출(서버 마스킹·필드 필터).
 * - fixed inset-0 로 사이드바 위를 덮는 전용 레이아웃. 빈 베드는 상태 대형 표시(복도 식별용).
 */

interface DisplayData {
  bed: { id: string; zone: string; bedNumber: string; status: string };
  empty: boolean;
  visit?: {
    name: string; gender?: string | null; dateOfBirth?: string | null; mrn?: string | null;
    triageLevel: string; chiefComplaint?: string | null; arrivalAt: string; status: string;
    disposition?: string | null; onVentilator?: boolean; doctor?: string | null;
    allergies: { allergen: string; severity: string }[];
    fallRisk?: string | null;
    guardian?: { name: string; relationship: string; relationshipDetail?: string | null; phone: string } | null;
  };
}

const EMPTY_TONE: Record<string, { bg: string; label: string }> = {
  AVAILABLE: { bg: 'bg-emerald-600', label: '가용' },
  CLEANING: { bg: 'bg-amber-500', label: '청소 중' },
  MAINTENANCE: { bg: 'bg-gray-600', label: '정비 중' },
  ISOLATION: { bg: 'bg-purple-600', label: '격리 지정' },
  RESERVED: { bg: 'bg-sky-600', label: '예약됨' },
};
const REL_LABEL: Record<string, string> = { PARENT: '부모', SPOUSE: '배우자', CHILD: '자녀', SIBLING: '형제자매', GUARDIAN: '후견인', OTHER: '보호자' };

function age(dob?: string | null) {
  return ageOf(dob); // 만나이 정본(shared) — 365.25 근사 경계 오차 제거
}
function useElapsed() {
  const fmtDur = useDurationText(); // 표시 정본 — 24시간 이상은 일로 환산되고 단위어는 UI 언어를 따른다
  return (dt: string) => fmtDur(Math.floor((Date.now() - new Date(dt).getTime()) / 60000));
}

export default function BedDisplayPage({ params }: { params: Promise<{ bedId: string }> }) {
  const elapsed = useElapsed();
  const { bedId } = use(params);
  const q = useQuery({
    queryKey: ['er-bed-display', bedId],
    queryFn: () => apiClient.get<{ data: DisplayData }>(`/api/v1/emergency/beds/${bedId}/display`),
    refetchInterval: pollMs('fast'),
  });
  const d = q.data?.data;
  const clock =kdate(new Date(), 'time');

  if (!d) {
    return <div className="fixed inset-0 z-[100] bg-gray-950 flex items-center justify-center text-gray-500 text-2xl">불러오는 중…</div>;
  }

  const bedLabel = `${d.bed.zone}-${d.bed.bedNumber}`;

  if (d.empty || !d.visit) {
    const t = EMPTY_TONE[d.bed.status] ?? EMPTY_TONE.AVAILABLE;
    return (
      <div className={`fixed inset-0 z-[100] ${t.bg} flex flex-col items-center justify-center text-white`}>
        <p className="text-7xl font-black tracking-tight">{bedLabel}</p>
        <p className="text-4xl font-bold mt-6 opacity-90">{t.label}</p>
        <p className="absolute top-6 right-8 text-2xl font-semibold opacity-70 tabular-nums">{clock}</p>
      </div>
    );
  }

  const v = d.visit;
  return (
    <div className="fixed inset-0 z-[100] bg-gray-950 text-white flex flex-col p-10">
      {/* 상단 밴드 — 베드·KTAS·시계 */}
      <div className="flex items-center justify-between">
        <p className="text-5xl font-black tracking-tight">{bedLabel}</p>
        <span className={`text-3xl font-bold px-5 py-2 rounded-2xl ${KTAS_SOLID[v.triageLevel] ?? 'bg-gray-600'}`}>
          KTAS {KTAS_LEVEL_LABEL[v.triageLevel] ?? v.triageLevel}
        </span>
        <p className="text-3xl font-semibold text-gray-400 tabular-nums">{clock}</p>
      </div>

      {/* 환자 확인 */}
      <div className="mt-10">
        <p className="text-6xl font-black">
          {v.name}
          <span className="ml-5 text-3xl font-bold text-gray-400">
            {v.gender === 'MALE' ? 'M' : v.gender === 'FEMALE' ? 'F' : ''}{age(v.dateOfBirth) != null ? `/${age(v.dateOfBirth)}` : ''}
          </span>
          {v.mrn && <span className="ml-5 text-2xl font-mono text-gray-500">{v.mrn}</span>}
        </p>
        <p className="mt-4 text-3xl text-gray-300">
          {v.chiefComplaint && <>주호소: <span className="font-semibold text-white">{v.chiefComplaint}</span></>}
          <span className="ml-6 text-gray-400">체류 {elapsed(v.arrivalAt)}</span>
        </p>
      </div>

      {/* 안전 배지 — 있는 것만·대형 */}
      <div className="mt-10 flex gap-4 flex-wrap">
        {v.allergies.map((a) => (
          <span key={a.allergen} className="text-3xl font-bold px-5 py-3 rounded-2xl bg-rose-600/90">
            ⚠ 알레르기: {a.allergen}
          </span>
        ))}
        {v.fallRisk === 'HIGH' && <span className="text-3xl font-bold px-5 py-3 rounded-2xl bg-amber-500 text-gray-950">⚠ 낙상주의</span>}
        {v.onVentilator && <span className="text-3xl font-bold px-5 py-3 rounded-2xl bg-indigo-600">인공호흡기</span>}
      </div>

      {/* 하단 — 담당·상태·보호자 */}
      <div className="mt-auto space-y-3 text-2xl text-gray-300">
        {v.doctor && <p>담당의 <span className="font-bold text-white">{v.doctor}</span></p>}
        <p>
          진행: <span className="font-bold text-white">{EMERGENCY_VISIT_STATUS_LABEL[v.status] ?? v.status}</span>
          {v.disposition && <span className="ml-4 text-gray-400">처분 결정됨</span>}
        </p>
        {v.guardian && (
          <p className="text-xl text-gray-400">
            보호자 {v.guardian.name} ({v.guardian.relationshipDetail || REL_LABEL[v.guardian.relationship] || v.guardian.relationship}) · {v.guardian.phone}
          </p>
        )}
      </div>
    </div>
  );
}
