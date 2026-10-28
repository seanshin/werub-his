'use client';

import { useEffect, useState } from 'react';
import { sanctionedPrint } from '@/components/print/PrintGuard';
import { useParams, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Card, TRACK_UI, type TItem, type TrackType } from '@/components/record-timeline/record-card';
import { toFocusLink } from '@/lib/focus-link';
import { RecordDetailPrint } from '@/components/record-timeline/RecordPrintBody';

/**
 * 기록 단건 상세 — 시계열 카드의 '자료 ↗'가 여는 **초점 창**((main) 레이아웃 밖·사이드바 없음).
 * 종전엔 차트 전체 화면을 열어 그 항목이 아니라 목록 전체가 보였다. 여기서는 **그 기록만** 보여주고,
 * 필요할 때만 하단 링크로 전체 목록(원본 화면)으로 넘어간다.
 */
export default function RecordDetailWindow() {
  const params = useParams();
  const search = useSearchParams();
  const type = String(params?.type ?? '').toUpperCase() as TrackType;
  const id = decodeURIComponent(String(params?.id ?? ''));
  const patientId = search.get('patientId') ?? '';

  const [ready, setReady] = useState(false);
  const [item, setItem] = useState<TItem | null>(null);
  const [patient, setPatient] = useState<{ name: string; mrn?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 새 창 인증 — URL 해시 auth=TOKEN 복원((main) 밖이라 자체 처리)
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
    if (!ready || !patientId || !type || !id) return;
    apiClient.get<{ data: TItem }>(`/api/v1/patients/${patientId}/record-timeline/${type}/${encodeURIComponent(id)}`)
      .then((r) => setItem(r.data))
      .catch(() => setError('기록을 불러올 수 없습니다(권한 또는 삭제 여부를 확인하세요).'));
    apiClient.get<{ data: { familyName?: string; givenName?: string; mrn?: string } }>(`/api/v1/patients/${patientId}`)
      .then((p) => { if (p?.data) setPatient({ name: `${p.data.familyName ?? ''}${p.data.givenName ?? ''}`.trim(), mrn: p.data.mrn }); })
      .catch(() => {});
  }, [ready, patientId, type, id]);

  const label = TRACK_UI[type]?.label ?? type;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b px-5 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-base font-bold text-gray-900">{label} 상세</div>
          {/* 환자 신원 고정 표기 — 어느 환자의 기록인지 창만 봐도 알 수 있게 */}
          <div className="text-xs text-gray-500 truncate">
            {patient ? `${patient.name}${patient.mrn ? ` (${patient.mrn})` : ''}` : patientId || '환자 미지정'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => sanctionedPrint()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">인쇄</button>
          <button onClick={() => window.close()} className="px-3 py-1.5 text-sm border rounded-lg text-gray-600">닫기</button>
        </div>
      </div>

      <div className="p-5 max-w-3xl mx-auto">
        {error ? <p className="text-sm text-rose-600">{error}</p>
        : !item ? <p className="text-sm text-gray-400">불러오는 중…</p>
        : (
          <>
            {/* 상세는 기본 펼침 — 이 창의 목적이 '그 기록 전체를 보는 것'이므로 */}
            <Card it={item} defaultOpen />
            {/* 인쇄는 화면을 찍지 않고 기록 인쇄본으로(2026-10-12 — 종전엔 빈 종이) */}
            <RecordDetailPrint item={item} patient={patient} patientId={patientId} />
            {item.link && (
              <div className="mt-4 text-center">
                {/* 이 창 안에서 그대로 이동 — 창을 또 띄우지 않는다(상세 창이 곧 열람 창).
                    🔴 초점 모드로 연다 — 초점 창에서 눌렀는데 사이드바 달린 전체 앱이 나오면
                       "그 기록만 본다"는 이 창의 목적이 깨진다(2026-08-25 사람 신고). */}
                <a href={toFocusLink(item.link)} className="text-xs text-gray-500 underline hover:text-gray-700">
                  전체 목록·원본 화면에서 보기
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
