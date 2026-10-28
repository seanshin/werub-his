'use client';

import { useEffect, useState } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { RecordTimelineView } from '@/components/record-timeline/RecordTimelineView';

/**
 * 임상 기록 통합 시계열 — 독립 새 창((main) 레이아웃 밖·인쇄 대상).
 * 표현·조회는 공용 RecordTimelineView 가 담당하고, 이 페이지는 인증 복원과 창 크롬만 맡는다.
 */
export default function RecordTimelineWindow() {
  const params = useParams();
  const patientId = String(params?.patientId ?? '');
  const [ready, setReady] = useState(false);
  const [patient, setPatient] = useState<{ name: string; mrn?: string } | null>(null);

  // 새 창 인증 — URL 해시 auth=TOKEN 복원((main) 레이아웃 밖이라 자체 처리)
  useEffect(() => {
    const m = window.location.hash.match(/auth=([^&]+)/);
    if (m) {
      const t = decodeURIComponent(m[1]);
      if (t && t.length > 20) { localStorage.setItem('accessToken', t); apiClient.setToken(t); }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      const t = localStorage.getItem('accessToken'); if (t) apiClient.setToken(t);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !patientId) return;
    apiClient.get<{ data: { familyName?: string; givenName?: string; mrn?: string } }>(`/api/v1/patients/${patientId}`)
      .then((p) => { if (p?.data) setPatient({ name: `${p.data.familyName ?? ''}${p.data.givenName ?? ''}`.trim(), mrn: p.data.mrn }); })
      .catch(() => {});
  }, [ready, patientId]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b px-5 py-3 flex items-center justify-between">
        <div>
          <div className="text-base font-bold text-gray-900">임상 기록 통합 시계열</div>
          <div className="text-xs text-gray-500">{patient ? `${patient.name} ${patient.mrn ? `(${patient.mrn})` : ''}` : patientId}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => sanctionedPrint()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">인쇄</button>
          <button onClick={() => window.close()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">닫기</button>
        </div>
      </div>
      {ready && <RecordTimelineView patientId={patientId} print={{ scopeLabel: '임상 기록 통합 시계열', subject: patient }} />}
    </div>
  );
}
