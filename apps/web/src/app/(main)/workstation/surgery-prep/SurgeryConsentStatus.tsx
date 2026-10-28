'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { kdate } from '@/lib/ui-settings';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * 수술 전 필수 동의서(수술·마취·수혈) — **동의서 원장에서 읽은 실제 상태**.
 *
 * 🔴 여기는 세 동의서를 상수 "확인 필요"로 그리던 자리였다(P15 — 서명한 환자에게도, 동의서가 없는 환자에게도 같은 말).
 *    이제 서버(`GET /api/v1/consent/surgery-status`)가 판정하고 화면은 그대로 말한다:
 *      서명됨 · 서명 대기(작성됐으나 미서명) · 없음 · 조회 실패(3번째 상태 — 실패를 "없음"으로 바꾸지 않는다).
 *    대조 규칙 정본은 API `consent/surgery-consent-status.ts` — surgeryId 연결 우선, 없으면 같은 환자·같은 종류·최근 N일.
 *    느슨한 대조(PATIENT_WINDOW)로 찾은 것은 그 자리에서 밝힌다("이 수술의 동의서"라는 보증이 아니다).
 */

type ConsentState = 'SIGNED' | 'PENDING' | 'NONE';
interface ConsentItem {
  consentType: 'SURGERY' | 'ANESTHESIA' | 'TRANSFUSION';
  state: ConsentState;
  matchedBy: 'SURGERY_ID' | 'PATIENT_WINDOW' | null;
  consentId: string | null;
  signedAt: string | null;
  createdAt: string | null;
}
interface ConsentStatusResponse {
  rule: string;
  windowDays: number;
  items: ConsentItem[];
}

const TYPE_LABEL: Record<ConsentItem['consentType'], string> = {
  SURGERY: '수술 동의서',
  ANESTHESIA: '마취 동의서',
  TRANSFUSION: '수혈 동의서',
};

const STATE_VIEW: Record<ConsentState, { k: string; cls: string }> = {
  SIGNED: { k: '서명됨', cls: 'bg-emerald-100 text-emerald-700' },
  PENDING: { k: '서명 대기', cls: 'bg-amber-100 text-amber-700' },
  NONE: { k: '없음', cls: 'bg-red-100 text-red-700' },
};

export function SurgeryConsentStatus({ patientId, surgeryId }: { patientId?: string | null; surgeryId?: string | null }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['surgery-consent-status', patientId, surgeryId ?? null],
    queryFn: () => apiClient.get<{ data: ConsentStatusResponse }>('/api/v1/consent/surgery-status', {
      patientId: patientId!,
      ...(surgeryId ? { surgeryId } : {}),
    }),
    enabled: !!patientId,
  });
  const res = data?.data;
  const loose = res?.items.some((i) => i.matchedBy === 'PATIENT_WINDOW') ?? false;

  return (
    <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5" data-testid="surgery-consent-status">
      <p className="text-xs font-semibold text-indigo-700"><T k="필수 동의서 확인" /></p>
      {!patientId ? (
        // 환자 식별자가 없으면 대조할 수 없다 — "없음"이 아니라 "확인 불가"
        <p className="text-[11px] text-gray-600" data-state="no-patient"><T k="환자 식별 정보가 없어 동의서를 대조할 수 없습니다." /></p>
      ) : isLoading ? (
        <p className="text-[11px] text-gray-500" data-state="loading"><T k="동의서 조회 중..." /></p>
      ) : isError ? (
        <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2" data-state="error">
          <span className="text-[11px] text-red-700">
            <T k="동의서 조회 실패" /> — {extractErrorMessage(error)}
          </span>
          <button type="button" onClick={() => refetch()} className="min-h-[44px] px-3 text-[11px] font-medium text-indigo-700 underline">
            <T k="다시 시도" />
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {(res?.items ?? []).map((it) => {
              const v = STATE_VIEW[it.state];
              return (
                <div key={it.consentType} className="flex items-center justify-between bg-white rounded-lg px-3 py-2" data-state={it.state}>
                  <span className="text-xs text-gray-700"><T k={TYPE_LABEL[it.consentType]} /></span>
                  <span className="flex items-center gap-1.5">
                    {it.state === 'SIGNED' && it.signedAt && (
                      <span className="text-[10px] text-gray-400">{kdate(it.signedAt, 'datetimeShort')}</span>
                    )}
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${v.cls}`}><T k={v.k} /></span>
                  </span>
                </div>
              );
            })}
          </div>
          {loose && res && (
            <p className="text-[10px] text-indigo-700" data-testid="consent-loose-match">
              <Tf k="수술에 연결된 동의서가 없어 같은 환자·같은 종류·최근 {days}일 동의서로 대조했습니다(이 수술의 동의서라는 보증은 아닙니다)." params={{ days: res.windowDays }} />
            </p>
          )}
        </>
      )}
    </div>
  );
}
