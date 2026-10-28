'use client';

import { useQuery } from '@tanstack/react-query';
import { T } from '@/components/ui/i18n-text';
import { apiClient } from '@/lib/api-client';

interface CdssCheck {
  category: string;
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  recommendation?: string;
  conflictWith?: { name: string };
}

interface CdssResult {
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  passedChecks: number;
  totalChecks: number;
  checks: CdssCheck[];
}

interface CdssAlertBannerProps {
  patientId: string;
  medicationCodeId?: string;
  encounterId?: string;
  /** 기록 전용 진료 id — 판정 범위(DUR·진단 검사)는 켜지 않고 판정 기록만 이 진료에 남긴다(2026-10-21) */
  logEncounterId?: string | null;
  enabled?: boolean;
}

const LEVEL_STYLE: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  ERROR: { bg: 'bg-red-50', border: 'border-red-300', icon: '🚨', text: 'text-red-800' },
  WARNING: { bg: 'bg-amber-50', border: 'border-amber-300', icon: '⚠️', text: 'text-amber-800' },
  INFO: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'ℹ️', text: 'text-blue-800' },
  PASS: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: '✅', text: 'text-emerald-800' },
};

/**
 * CDSS 실시간 검증 배너.
 * 처방 입력 화면에서 약물 선택 시 자동으로 CDSS check를 호출하고
 * 결과를 인라인 알림으로 표시합니다.
 *
 * 사용: <CdssAlertBanner patientId={patientId} medicationCodeId={selectedMedId} encounterId={encounterId} />
 */
export function CdssAlertBanner({ patientId, medicationCodeId, encounterId, logEncounterId, enabled = true }: CdssAlertBannerProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['cdss-check', patientId, medicationCodeId, encounterId, logEncounterId],
    queryFn: () => apiClient.post<{ data: CdssResult }>('/api/v1/cdss/check', {
      patientId,
      medicationCodeId,
      encounterId,
      ...(logEncounterId && !encounterId ? { logEncounterId } : {}),
    }),
    enabled: enabled && !!patientId && !!medicationCodeId,
    staleTime: 30000,
  });

  const result = (data?.data as { data?: CdssResult })?.data ?? data?.data as CdssResult | undefined;

  if (!medicationCodeId || !enabled) return null;
  if (isLoading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center gap-2 animate-pulse">
        <div className="w-4 h-4 bg-gray-200 rounded-full" />
        <span className="text-xs text-gray-400">CDSS 검증 중...</span>
      </div>
    );
  }
  // 🔴 점검 실패를 "경고 없음"(아무것도 안 그림)으로 접지 않는다
  if (isError) {
    return (
      <div className="bg-gray-50 border border-gray-300 rounded-xl p-3 flex items-center gap-2" data-cdss-failed>
        <span className="text-xs text-gray-700"><T k="CDSS 점검을 하지 못했습니다 — 경고가 없다는 뜻이 아닙니다." /></span>
        <button type="button" onClick={() => refetch()} className="text-xs text-blue-700 underline"><T k="다시 점검" /></button>
      </div>
    );
  }
  if (!result) return null;

  const style = LEVEL_STYLE[result.level] ?? LEVEL_STYLE.PASS;
  const alerts = result.checks.filter(c => c.level !== 'PASS');

  if (result.level === 'PASS') {
    return (
      <div className={`${style.bg} border ${style.border} rounded-xl p-3 flex items-center gap-2`}>
        <span>{style.icon}</span>
        <span className={`text-xs font-medium ${style.text}`}>
          CDSS 검증 통과 ({result.passedChecks}/{result.totalChecks})
        </span>
      </div>
    );
  }

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-3 space-y-2`}>
      <div className="flex items-center gap-2">
        <span>{style.icon}</span>
        <span className={`text-xs font-bold ${style.text}`}>
          CDSS 검증 {result.level === 'ERROR' ? '오류' : '경고'} ({alerts.length}건)
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">{result.passedChecks}/{result.totalChecks} 통과</span>
      </div>
      <div className="space-y-1.5">
        {alerts.map((c, i) => (
          <div key={i} className={`text-xs ${style.text} bg-white/50 rounded-lg p-2`}>
            <p className="font-bold">{c.title}</p>
            <p className="text-[11px] mt-0.5">{c.message}</p>
            {c.recommendation && <p className="text-[10px] mt-1 italic">💡 {c.recommendation}</p>}
            {c.conflictWith && <p className="text-[10px] mt-0.5">충돌 약물: {c.conflictWith.name}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
