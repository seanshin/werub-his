'use client';

import { useState } from 'react';
import { Unit, useDurationText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { canAckCriticalValue } from '@hospital-run/shared';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

interface CriticalAlert {
  id: string;
  testName: string;
  value: string;
  unit: string;
  reason: string;
  notifiedAt: string;
  /** 담당의 미지정(doctorId=NULL) 경보 — 종전엔 누구의 목록에도 뜨지 않던 고아 건 */
  unassigned?: boolean;
  /** 내가 통보 대상 담당의인가 — 아니면 대리 확인(사유 필수) */
  isMine?: boolean;
  /** PENDING | ESCALATED — 허용시간을 넘겨 크론이 상향 표시한 미확인 경보는 ESCALATED */
  status?: string;
  /** 상향 표시 시각 — 전이가 없었으면 null */
  escalatedAt?: string | null;
  patient?: { familyName: string; givenName: string; mrn: string } | null;
  /** 다른 담당의의 경보가 허용시간을 넘겨 상향돼 내 목록에 온 것(서버 판정) — 확인하면 대리 확인 */
  escalatedFromOther?: boolean;
  /** 통보 대상 담당의(남의 경보일 때만·이름을 모르면 null) */
  assignedDoctor?: { familyName: string; givenName: string } | null;
  /** 이 로그인 역할이 확인 EP 를 부를 수 있는가(서버 판정) — 간호·검사는 보되 확인은 의사·관리자 */
  canAcknowledge?: boolean;
}

type AckVars = {
  id: string;
  readBack: boolean;
  readBackValue?: string;
  responseAction: string;
  delegationReason?: string;
};

/**
 * 위급검사값(Critical Value) 알림 배너 — IPSG.2 / NPSG.02.03.01 복창(read-back).
 *
 * 🔴 2026-08-18 실체화. 종전 이 화면은 **복창 확인 수단이 없었다** — 버튼 하나가 늘 `readBack: true` 를
 *    보냈고 서버는 본문이 비어도 `?? true` 로 적었다. 즉 **아무도 복창하지 않았는데 복창했다고 기록**했고,
 *    품질지표 '복창 누락'은 구조적으로 영원히 0 이라 화면이 "누락 없음"이라고 안심시켰다(P17).
 *
 * 지금 이 화면이 하는 일:
 *  1. **되읽은 값을 직접 입력**시키고 서버가 통보값과 대조한다(불일치는 확인되지 않는다).
 *     🔴 값은 화면에도 보이므로 이 입력은 '구두 복창의 증거'가 아니라 **무심코 클릭해 넘기는 것을 막는 장치**다.
 *        구두로 복창을 받았다는 사실 자체는 아래 확인문(체크)이 진술한다 — 과장해 적지 않는다.
 *  2. **복창 없이 확인**하는 경로를 별도로 둔다(전화 없이 화면에서 인지한 경우). 이 건은 `readBack=false` 로
 *     정직하게 남아 품질지표의 분자가 된다 — 그래야 "복창 누락 0"이 진짜 0 이 된다.
 *  3. **담당의 미지정** 경보를 표시한다(종전엔 아무에게도 안 보였다).
 *  4. **대리 확인**(담당의 본인이 아님)이면 사유를 받는다 — 담당의 부재 시 위급값이 방치되지 않도록 열되,
 *     누가 왜 대신 확인했는지 기록에 남긴다.
 */
export function CriticalValueAlertBanner() {
  const queryClient = useQueryClient();
  /**
   * 🔴 이 배너는 `(main)` 레이아웃에 있어 **모든 직군의 모든 화면**에 렌더된다. 그런데 EP 는
   *    임상 역할 전용이라, 급양·원무·의무기록·검진·CRM·행정·경영·조회 계정은
   *    **모든 화면에서 "Forbidden resource" 빨간 배너**를 봤다(2026-08-21 사람 신고).
   *    위급검사값 read-back 은 임상 행위다 — EP 를 여는 것이 아니라 **부르지 않는 것**이 답이다.
   *    역할 목록은 shared 정본(`CRITICAL_VALUE_ACK_ROLES`)에서 온다(양쪽에 적으면 갈라진다).
   */
  const role = useAuthStore((s) => s.user?.role);
  const eligible = canAckCriticalValue(role);
  const durationText = useDurationText();
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [readBackValue, setReadBackValue] = useState('');
  const [readBackHeard, setReadBackHeard] = useState(false);
  const [delegationReason, setDelegationReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isError, error: queryError, refetch } = useQuery({
    queryKey: ['critical-values-pending'],
    queryFn: () => apiClient.get<{ data: CriticalAlert[] }>('/api/v1/lab/critical-values/pending'),
    refetchInterval: 30000,
    enabled: eligible,
  });
  const alerts = ((data?.data as { data?: CriticalAlert[] })?.data ?? data?.data ?? []) as CriticalAlert[];
  /** 서버 총수 — 목록은 상한(50)에서 잘린다. 자르면 자른다고 말한다 */
  const total = (data as { meta?: { total?: number } } | undefined)?.meta?.total ?? null;
  /**
   * 허용시간(상향 보고 기준) — 🔴 미설정이면 "상향 보고 안 함"을 그대로 말한다(30분 같은 값을 화면이 지어내지 않는다).
   * 조회 실패는 기준을 모르는 것이지 미설정이 아니다 — 두 문장을 가른다.
   */
  const policyQ = useQuery({
    queryKey: ['critical-values-escalation-policy'],
    queryFn: () => apiClient.get<{ data: { afterMinutes: number | null; invalid: boolean } }>('/api/v1/lab/critical-values/escalation-policy'),
    enabled: eligible && alerts.length > 0,
    staleTime: 300_000,
  });
  const policy = ((policyQ.data?.data as { data?: { afterMinutes: number | null; invalid: boolean } })?.data ?? policyQ.data?.data) as
    | { afterMinutes: number | null; invalid: boolean }
    | undefined;

  const reset = () => {
    setOpenId(null); setAction(''); setReadBackValue(''); setReadBackHeard(false);
    setDelegationReason(''); setError(null);
  };

  const ackMut = useMutation({
    mutationFn: (vars: AckVars) =>
      apiClient.patch(`/api/v1/lab/critical-values/${vars.id}/acknowledge`, {
        readBack: vars.readBack,
        // readBack=false 일 때는 되읽은 값을 보내지 않는다(보내면 '복창했다'는 인상을 남긴다)
        ...(vars.readBack ? { readBackValue: vars.readBackValue } : {}),
        ...(vars.delegationReason ? { delegationReason: vars.delegationReason } : {}),
        responseAction: vars.responseAction,
      }),
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ['critical-values-pending'] });
    },
    // 🔴 실패를 삼키지 않는다 — 복창 불일치·대리 사유 누락은 "확인되지 않았다"는 사실이다.
    onError: (e: unknown) => setError(e instanceof Error ? e.message : '확인에 실패했습니다'),
  });

  /**
   * 🔴 위급검사값 배너가 조회 실패로 **조용히 사라지면** "통보할 위급값이 없다"로 읽힌다.
   *    미확인 위급값이 있는지 자체를 모르는 상태이므로, 그 사실을 화면에 남긴다.
   */
  // 🔴 통보 대상이 아닌 직군에겐 이 배너 자체가 해당 사항이 아니다 — 오류로 그리지 않는다
  if (!eligible) return null;
  if (isError) {
    return (
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] w-[min(94vw,560px)] print:hidden">
        <div className="bg-white rounded-2xl shadow-2xl border border-red-300 overflow-hidden">
          <div className="px-4 py-2 text-xs font-bold text-red-700 bg-red-50">위급검사값 통보 현황을 불러오지 못했습니다</div>
          <QueryErrorFallback error={queryError} onRetry={refetch} size="compact" />
        </div>
      </div>
    );
  }
  if (!alerts.length) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] w-[min(94vw,560px)] print:hidden">
      <div className="bg-red-600 text-white rounded-2xl shadow-2xl border border-red-700 overflow-hidden animate-pulse-once">
        <div className="px-4 py-2.5 flex items-center gap-2 bg-red-700/40">
          <span className="text-base">🚨</span>
          <span className="text-sm font-bold">위급검사값 통보 {alerts.length}<Unit>건</Unit> — 복창(read-back) 확인 필요</span>
          {total != null && total > alerts.length && (
            <span className="text-[11px] font-semibold text-yellow-200">
              <Tf k="(전체 {전체}건 중 {표시}건 표시)" params={{ 전체: total, 표시: alerts.length }} />
            </span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-red-500/40">
          {alerts.map((a) => {
            const needsDelegation = !a.isMine && !a.unassigned;
            // 🔴 서버가 확인 권한을 판정한다 — 간호·검사 계정은 상향된 경보를 보되 확인 버튼은 없다(누르면 403)
            const canAck = a.canAcknowledge !== false;
            return (
            <div key={a.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {a.patient ? `${a.patient.familyName}${a.patient.givenName} · ${a.patient.mrn}` : '환자'}
                    {a.unassigned && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-300 text-amber-900 text-[10px] font-bold">담당의 미지정</span>
                    )}
                    {needsDelegation && (
                      <span className="px-1.5 py-0.5 rounded bg-white/25 text-white text-[10px] font-bold">대리 확인</span>
                    )}
                    {a.status === 'ESCALATED' && (
                      <span className="px-1.5 py-0.5 rounded bg-yellow-300 text-red-900 text-[10px] font-bold">허용시간 초과 · 상향 표시</span>
                    )}
                    {a.escalatedFromOther && (
                      <span className="px-1.5 py-0.5 rounded bg-white text-red-800 text-[10px] font-bold">
                        {a.assignedDoctor
                          ? <Tf k="다른 담당의({의사}) 경보" params={{ 의사: `${a.assignedDoctor.familyName}${a.assignedDoctor.givenName}` }} />
                          : <T k="다른 담당의 경보" />}
                      </span>
                    )}
                  </p>
                  {a.escalatedFromOther && (
                    <p className="text-[11px] text-yellow-100">
                      <T k="담당의가 허용시간 안에 확인하지 않아 상향된 경보입니다 — 담당의·당직의에게 연락하세요." />
                    </p>
                  )}
                  <p className="text-xs text-red-50">
                    {a.testName} <strong>{a.value}{a.unit}</strong> — {a.reason}
                  </p>
                </div>
                {!canAck && (
                  <span className="shrink-0 max-w-[10rem] text-right text-[10px] text-red-100">
                    <T k="확인은 의사·관리자만 할 수 있습니다" />
                  </span>
                )}
                {canAck && openId !== a.id && (
                  <button onClick={() => { reset(); setOpenId(a.id); }}
                    className="shrink-0 px-3 py-1.5 bg-white text-red-700 text-xs font-bold rounded-lg hover:bg-red-50">
                    📞 확인하기
                  </button>
                )}
              </div>
              {canAck && openId === a.id && (
                <div className="mt-2 space-y-2">
                  {needsDelegation && (
                    <div className="rounded-lg bg-red-700/40 p-2 space-y-1.5">
                      <p className="text-[11px] text-amber-100 font-semibold">
                        담당의 본인이 아닙니다 — 대리 확인 사유가 기록에 남습니다.
                      </p>
                      <input value={delegationReason} onChange={(e) => setDelegationReason(e.target.value)}
                        placeholder="대리 확인 사유 (예: 담당의 수술 중, 야간 당직 대응)"
                        className="w-full rounded-lg px-2.5 py-2 text-xs text-gray-800 placeholder:text-gray-400" />
                    </div>
                  )}

                  <div className="rounded-lg bg-white/10 p-2 space-y-1.5">
                    <label className="flex items-start gap-2 text-[11px] leading-snug text-red-50 cursor-pointer">
                      <input type="checkbox" checked={readBackHeard} onChange={(e) => setReadBackHeard(e.target.checked)}
                        className="mt-0.5 accent-white" />
                      <span>통보자와 <strong>구두로 값을 되읽어(read-back) 확인</strong>했습니다.</span>
                    </label>
                    {readBackHeard && (
                      <>
                        <input value={readBackValue} onChange={(e) => setReadBackValue(e.target.value)}
                          placeholder="되읽은 값을 입력 (숫자)"
                          className="w-full rounded-lg px-2.5 py-2 text-xs text-gray-800 placeholder:text-gray-400" />
                        <p className="text-[10px] text-red-100">
                          입력값이 통보값과 다르면 확인되지 않습니다 — 통보자와 값을 다시 맞추세요.
                        </p>
                      </>
                    )}
                  </div>

                  <input value={action} onChange={(e) => setAction(e.target.value)}
                    placeholder="조치 내용 (예: 주치의 구두보고 완료, KCl 교정 지시)"
                    className="w-full rounded-lg px-2.5 py-2 text-xs text-gray-800 placeholder:text-gray-400" />

                  {error && <p className="text-[11px] font-semibold text-amber-200">⚠ {error}</p>}

                  <div className="flex gap-2">
                    {readBackHeard ? (
                      <button onClick={() => { setError(null); ackMut.mutate({ id: a.id, readBack: true, readBackValue, responseAction: action, delegationReason: needsDelegation ? delegationReason : undefined }); }}
                        disabled={!action.trim() || !readBackValue.trim() || (needsDelegation && delegationReason.trim().length < 5) || ackMut.isPending}
                        className="flex-1 py-1.5 bg-white text-red-700 text-xs font-bold rounded-lg disabled:opacity-50">
                        복창 확인 완료
                      </button>
                    ) : (
                      <button onClick={() => { setError(null); ackMut.mutate({ id: a.id, readBack: false, responseAction: action, delegationReason: needsDelegation ? delegationReason : undefined }); }}
                        disabled={!action.trim() || (needsDelegation && delegationReason.trim().length < 5) || ackMut.isPending}
                        className="flex-1 py-1.5 bg-red-800 text-white text-xs font-bold rounded-lg border border-red-300/60 disabled:opacity-50">
                        복창 없이 확인 (복창 미시행으로 기록)
                      </button>
                    )}
                    <button onClick={reset} className="px-3 py-1.5 text-xs text-red-100">취소</button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
        <p className="px-4 py-1.5 text-[10px] text-red-100 bg-red-700/30">⚖️ JCI IPSG.2 · NPSG.02.03.01 — 위급값은 구두 복창(read-back) 확인 후 조치를 기록해야 합니다.</p>
        <p className="px-4 pb-1.5 text-[10px] text-red-100 bg-red-700/30">
          {policyQ.isError
            ? '허용시간(상향 보고 기준)을 불러오지 못했습니다 — 기준을 모르는 상태입니다.'
            : policy == null
              ? null
              : policy.afterMinutes == null
                ? policy.invalid
                  ? '허용시간 설정값을 해석할 수 없어 상향 보고를 하지 않고 있습니다(시스템 설정 확인 필요).'
                  : '허용시간(상향 보고 기준)이 설정되지 않아 상향 보고를 하지 않습니다.'
                : `허용시간 ${durationText(policy.afterMinutes)} — 넘기면 '상향 표시'됩니다(원내 알림 수신자 라우팅은 승인 전이라 목록 표시만).`}
        </p>
      </div>
    </div>
  );
}
