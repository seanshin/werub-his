'use client';

import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import type { AllergyItem } from './types';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { T } from '@/components/ui/i18n-text';

const ALLERGY_TYPE_LABEL: Record<string, string> = {
  DRUG: '약물', FOOD: '식품', ENVIRONMENTAL: '환경', LATEX: '라텍스', OTHER: '기타',
};

const ALLERGY_SEV_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  MILD: { label: '경증', bg: 'bg-green-50', text: 'text-green-700' },
  MODERATE: { label: '중등', bg: 'bg-amber-50', text: 'text-amber-700' },
  SEVERE: { label: '중증', bg: 'bg-red-50', text: 'text-red-700' },
  LIFE_THREATENING: { label: '생명위협', bg: 'bg-red-100', text: 'text-red-800' },
};

const VERIFY_CONFIG: Record<string, { label: string; color: string }> = {
  CONFIRMED: { label: '확인됨', color: 'text-emerald-600' },
  UNCONFIRMED: { label: '미확인', color: 'text-amber-600' },
  REFUTED: { label: '반증됨', color: 'text-gray-400' },
  ENTERED_IN_ERROR: { label: '오류', color: 'text-red-400' },
};

export function AllergyTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-allergies', patientId],
    queryFn: () => apiClient.get<{ data: AllergyItem[] }>(`/api/v1/patients/${patientId}/allergies`, { isActive: 'true' }),
    enabled: !!patientId,
  });

  const _allergiesRaw = data?.data;
  const allergies: AllergyItem[] = Array.isArray(_allergiesRaw) ? _allergiesRaw : (_allergiesRaw as Record<string, unknown> | undefined)?.data as AllergyItem[] ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6"><T k="알레르기 / 약물이상반응" /></h3>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : allergies.length === 0 ? (
        /* 🔴 종전엔 등록 0건에 초록 `NKA (No Known Allergies)` 를 적었다 — 그것은 **사정 행위의 결과**이지
           목록이 비었다는 뜻이 아니다. 확인 기록이 있을 때만 그렇게 말한다. */
        <div className="text-center py-12">
          <p className="text-gray-400"><T k="등록된 알레르기가 없습니다" /></p>
          <div className="mt-2 inline-flex"><AllergyStatusBadge patientId={patientId} allergyCount={0} /></div>
        </div>
      ) : (
        <div className="space-y-3">
          {allergies.map((a: AllergyItem) => {
            const sevCfg = ALLERGY_SEV_CONFIG[a.severity] ?? ALLERGY_SEV_CONFIG.MODERATE;
            const verifyCfg = VERIFY_CONFIG[a.verificationStatus] ?? VERIFY_CONFIG.UNCONFIRMED;
            return (
              <div key={a.id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${sevCfg.bg} ${sevCfg.text}`}>
                        {sevCfg.label}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {ALLERGY_TYPE_LABEL[a.type] ?? a.type}
                      </span>
                      <span className={`text-[11px] font-medium ${verifyCfg.color}`}>
                        {verifyCfg.label}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">
                      {a.allergen}
                      {/* 표준 알레르겐 코드 — DB·응답에 있으나 화면에 없던 값(외부 연동·DUR 정합 확인용) */}
                      {a.allergenCode && (
                        <span className="ml-1.5 text-[11px] font-mono font-normal text-gray-400">{a.allergenCode}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      반응: {a.reaction}
                      {a.onsetDate && (() => { try { const d = new Date(a.onsetDate); return isNaN(d.getTime()) ? '' : ` | 발병일: ${format(d, 'yyyy-MM-dd')}`; } catch { return ''; } })()}
                    </p>
                  </div>
                  <p className="text-[11px] text-gray-400">보고: {a.reportedBy}</p>
                </div>
                {a.notes && <p className="text-xs text-gray-500 mt-2 pl-2 border-l-2 border-red-200">{a.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
