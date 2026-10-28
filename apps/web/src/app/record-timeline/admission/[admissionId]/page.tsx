'use client';

import { useEffect, useState } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { useParams, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { RecordTimelineView } from '@/components/record-timeline/RecordTimelineView';

/**
 * 입원 단위 시계열(scope=admission) — 그 입원 기간의 기록만 시간축으로.
 * 환자 전체 시계열과 달리 재원 중 경과(경과기록·간호·투약실행·활력·수술·퇴원요약)에 초점.
 * 기획 §3 [scope] 설계 반영.
 */
export default function AdmissionTimelineWindow() {
  const params = useParams();
  const search = useSearchParams();
  const admissionId = String(params?.admissionId ?? '');
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<{ patientId: string; name?: string; mrn?: string; admitDate?: string; dischargeDate?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 새 창 인증 — URL 해시 auth=TOKEN 복원((main) 레이아웃 밖)
  useEffect(() => {
    const m = window.location.hash.match(/auth=([^&]+)/);
    if (m) {
      const t = decodeURIComponent(m[1]);
      if (t && t.length > 20) { localStorage.setItem('accessToken', t); apiClient.setToken(t); }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      const t = localStorage.getItem('accessToken');
      if (t) apiClient.setToken(t);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !admissionId) return;
    // patientId 는 쿼리로 받거나 입원 조회로 보충(창을 URL 만으로 열 수 있게)
    const q = search.get('patientId');
    if (q) { setInfo({ patientId: q }); return; }
    apiClient.get<{ data: { patientId: string; admitDate?: string; dischargeDate?: string | null; patient?: { familyName?: string; givenName?: string; mrn?: string } } }>(`/api/v1/inpatient/${admissionId}`)
      .then((r) => {
        const d = r.data;
        setInfo({
          patientId: d.patientId,
          name: `${d.patient?.familyName ?? ''}${d.patient?.givenName ?? ''}`.trim() || undefined,
          mrn: d.patient?.mrn, admitDate: d.admitDate, dischargeDate: d.dischargeDate,
        });
      })
      .catch(() => setError('입원 정보를 불러올 수 없습니다(권한 또는 존재 여부 확인).'));
  }, [ready, admissionId, search]);

  const period = info?.admitDate
    ? `${info.admitDate.slice(0, 10)} ~ ${info.dischargeDate ? info.dischargeDate.slice(0, 10) : '재원 중'}`
    : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b px-5 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-base font-bold text-gray-900">입원 기간 기록 시계열</div>
          <div className="text-xs text-gray-500 truncate">
            {info?.name ? `${info.name}${info.mrn ? ` (${info.mrn})` : ''}` : admissionId}
            {period && <span className="ml-1.5 text-gray-400">· {period}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => sanctionedPrint()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">인쇄</button>
          <button onClick={() => window.close()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">닫기</button>
        </div>
      </div>
      {error && <p className="p-5 text-sm text-rose-600">{error}</p>}
      {info && <RecordTimelineView patientId={info.patientId} admissionId={admissionId}
        print={{ scopeLabel: '입원 기간 기록 시계열', subject: info.name ? { name: info.name, mrn: info.mrn } : null, period: period ? `입원 기간 ${period}` : null }} />}
    </div>
  );
}
