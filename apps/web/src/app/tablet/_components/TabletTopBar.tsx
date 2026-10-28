'use client';
import { useRouter } from 'next/navigation';
import PatientSwitcher from './PatientSwitcher';
import { ageOf as sharedAgeOf } from '@hospital-run/shared';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';

function ageOf(dob?: string) {
  if (!dob) return '?';
  const d = new Date(dob);
  if (isNaN(d.getTime())) return '?';
  return String(sharedAgeOf(d) ?? '?');
}

/** 타블렛 상단 컨텍스트 바 — 환자 요약·뒤로·데스크탑 복귀. */
export default function TabletTopBar({ patient, patientId, onBack }: {
  patient?: { familyName?: string; givenName?: string; gender?: string; dateOfBirth?: string; mrn?: string; bloodType?: string; allergies?: unknown[] } | null;
  patientId?: string;
  onBack?: () => void;
}) {
  const router = useRouter();
  const name = patient ? `${patient.familyName ?? ''}${patient.givenName ?? ''}` : '';
  const sex = patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : '';
  const hasAllergy = Array.isArray(patient?.allergies) && patient!.allergies.length > 0;
  return (
    <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-3 h-14 flex items-center gap-3">
      <button onClick={() => (onBack ? onBack() : router.push('/tablet'))} className="min-h-[44px] min-w-[44px] -ml-1 rounded-xl text-gray-600 inline-flex items-center justify-center text-2xl" aria-label="뒤로">‹</button>
      {patient ? (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="font-bold text-lg text-gray-900 truncate">{name}</span>
          <span className="text-sm text-gray-500">{ageOf(patient.dateOfBirth)}세 · {sex}</span>
          {patient.bloodType && <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{patient.bloodType}</span>}
          {/* 🔴 종전엔 빈 목록을 초록 `NKDA` 로 그렸다 — 같은 타블렛의 TabletSummary 는 그러지 않는데
              상단바만 단언하고 있었다. patientId 를 모르면 배지를 그리지 않는다(모르는 것을 안전하다 말하지 않는다). */}
          {patientId ? (
            <AllergyStatusBadge patientId={patientId} allergyCount={Array.isArray(patient?.allergies) ? patient!.allergies.length : undefined} />
          ) : hasAllergy ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">알레르기</span>
          ) : null}
          <span className="text-xs text-gray-400 hidden sm:inline">{patient.mrn}</span>
        </div>
      ) : (
        <span className="flex-1 font-bold text-lg">타블렛 차트</span>
      )}
      <PatientSwitcher />
      <button onClick={() => window.dispatchEvent(new Event('tablet:lock'))} className="min-h-[44px] min-w-[44px] rounded-xl text-gray-600 border border-gray-200 inline-flex items-center justify-center" aria-label="화면 잠금" title="화면 잠금">🔒</button>
      {patientId && (
        <button onClick={() => router.push(`/patients/${patientId}`)} className="min-h-[44px] px-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 inline-flex items-center gap-1 hidden sm:inline-flex" aria-label="데스크탑으로">⤢ 데스크탑</button>
      )}
    </header>
  );
}
