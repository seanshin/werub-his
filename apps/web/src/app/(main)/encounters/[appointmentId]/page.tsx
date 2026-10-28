'use client';

/**
 * [DEPRECATED · Track3 이중 시스템 통합] 구형 진료 작성 화면.
 * 정식 진료 작성은 /patients/[id]/encounter/new (ChartRenderer 25종 필드·전문과 레이아웃 16종·
 * 임상도구·처방·서명). 예약(appointment)을 해석해 해당 환자의 신형 화면으로 리다이렉트한다.
 */
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

export default function LegacyEncounterRedirectPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = use(params);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<{ data: { patientId?: string; patient?: { id?: string } } }>(`/api/v1/appointments/${appointmentId}`);
        const raw = res.data as { data?: { patientId?: string; patient?: { id?: string } } } | { patientId?: string; patient?: { id?: string } };
        const appt = (raw as { data?: unknown }).data ?? raw;
        const patientId = (appt as { patientId?: string }).patientId ?? (appt as { patient?: { id?: string } }).patient?.id;
        if (!cancelled && patientId) {
          router.replace(`/patients/${patientId}/encounter/new`);
          return;
        }
        if (!cancelled) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [appointmentId, router]);

  return (
    <div className="max-w-xl mx-auto mt-20 bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center space-y-3">
      <p className="text-3xl">🩺</p>
      {failed ? (
        <>
          <h1 className="text-lg font-bold text-gray-900"><T k="예약 정보를 찾을 수 없습니다" /></h1>
          <p className="text-sm text-gray-500"><T k="진료 작성은 진료실 대기 화면에서 환자를 선택해 시작하세요." /></p>
          <button onClick={() => router.replace('/clinic-queue')}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
            <T k="진료실 대기로 이동" />
          </button>
        </>
      ) : (
        <>
          <h1 className="text-lg font-bold text-gray-900"><T k="새 진료 작성 화면으로 이동 중…" /></h1>
          <p className="text-sm text-gray-500"><T k="진료 작성이 환자 차트 기반 화면으로 통합되었습니다." /></p>
        </>
      )}
    </div>
  );
}
