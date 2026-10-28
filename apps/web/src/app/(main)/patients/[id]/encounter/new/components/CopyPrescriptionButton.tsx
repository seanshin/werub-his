'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { MutationError } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

interface PastEncounter {
  id: string;
  createdAt: string;
  doctor?: { familyName: string; givenName: string };
  prescriptions?: { id: string }[];
}

interface CopyPrescriptionResponse {
  data: PastEncounter[];
  count: number;
}

interface PastEncounterListResponse {
  data: PastEncounter[];
}

export function CopyPrescriptionButton({ patientId, encounterId, onCopied }: { patientId: string; encounterId: string; onCopied: (count: number) => void }) {
  const [showModal, setShowModal] = useState(false);
  const { data: pastData } = useQuery({
    queryKey: ['past-encounters-copy', patientId],
    queryFn: () => apiClient.get<{ data: PastEncounter[] }>(`/api/v1/encounters`, { patientId, status: 'SIGNED' }),
    enabled: showModal,
  });
  const _pastCopyRaw = pastData?.data;
  const pastCopyList = Array.isArray(_pastCopyRaw) ? _pastCopyRaw : (_pastCopyRaw as PastEncounterListResponse | undefined)?.data ?? [];

  const handleCopy = async (sourceEncounterId: string) => {
    try {
      const res = await apiClient.post<CopyPrescriptionResponse>(`/api/v1/encounters/${encounterId}/prescriptions/copy`, { sourceEncounterId });
      onCopied(res.count);
      setShowModal(false);
    } catch (err: unknown) {
      const typedErr = err as MutationError;
      const details = typedErr?.details as Record<string, unknown> | undefined;
      if (details?.durWarnings) {
        // DUR ERROR 차단(dur.enforce) — 사유 입력 시 강제 복사(overrideDur 감사 기록)
        const warnings = details.durWarnings as { message: string }[];
        const reason = window.prompt(`DUR 위험 경고로 복사가 차단되었습니다:\n${warnings.map((w) => `· ${w.message}`).join('\n')}\n\n강제 복사하려면 사유를 입력하세요(약국·심사 추적).`);
        if (!reason?.trim()) return;
        try {
          const res = await apiClient.post<CopyPrescriptionResponse>(`/api/v1/encounters/${encounterId}/prescriptions/copy`, { sourceEncounterId, overrideDur: true, overrideReason: reason.trim() });
          onCopied(res.count);
          setShowModal(false);
          toast.success('강제 복사되었습니다(사유 기록).');
        } catch (err2: unknown) {
          toast.error((err2 as MutationError)?.message || '처방 복사 실패');
        }
        return;
      }
      toast.error(typedErr?.message || '처방 복사 실패');
    }
  };

  return (
    <>
      <button onClick={() => setShowModal(!showModal)}
        className="px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        <T k="이전처방 복사" />
      </button>
      {showModal && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4">
          <h4 className="text-sm font-bold text-emerald-900 mb-2"><T k="이전 처방 선택" /></h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {pastCopyList.length === 0 ? (
              <p className="text-xs text-emerald-400 py-2 text-center"><T k="이전 진료 기록이 없습니다" /></p>
            ) : pastCopyList.map((enc: PastEncounter) => (
              <div key={enc.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                <div>
                  <span className="text-xs text-gray-500">{enc.createdAt ?kdate(enc.createdAt, 'date') : '-'}</span>
                  <span className="text-xs text-gray-400 ml-2">{enc.doctor?.familyName}{enc.doctor?.givenName}</span>
                  {(enc.prescriptions?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-emerald-600 ml-2">처방 {enc.prescriptions?.length}<Unit>건</Unit></span>
                  )}
                </div>
                <button onClick={() => handleCopy(enc.id)} className="px-2 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700"><T k="복사" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setShowModal(false)} className="mt-2 text-xs text-emerald-600 hover:underline"><T k="닫기" /></button>
        </div>
      )}
    </>
  );
}
