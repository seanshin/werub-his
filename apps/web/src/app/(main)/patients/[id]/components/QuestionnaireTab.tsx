'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';

interface QuestionnaireToken {
  id: string;
  token: string;
  status: string;
  sentVia: string | null;
  expiresAt: string;
  openedAt: string | null;
  completedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewer?: { familyName: string; givenName: string } | null;
  createdAt: string;
  formSchema: { name: string; category?: string };
  submission?: { id: string; submittedAt: string; data: Record<string, unknown> } | null;
}

export function QuestionnaireTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [selectedSubmission, setSelectedSubmission] = useState<{ id: string; submittedAt: string; data: Record<string, unknown> } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-questionnaires', patientId],
    queryFn: () => apiClient.get<{ data: QuestionnaireToken[] }>(`/api/v1/patients/${patientId}/questionnaires`),
  });
  const raw = data?.data;
  const tokens = (Array.isArray(raw) ? raw : (raw as unknown as { data?: QuestionnaireToken[] })?.data ?? []) as QuestionnaireToken[];

  // 🔴 (2026-09-14) 서버가 제출 전 문진표 검토를 409 로 거부하고 첫 검토자를 덮어쓰지 않는다 — 실패를 말없이 삼키지 않는다
  const reviewMutation = useMutation({
    mutationFn: (id: string) => apiClient.put<{ data: { alreadyReviewed: boolean } }>(`/api/v1/admin/questionnaire/review/${id}`),
    onSuccess: (r) => {
      if (r?.data?.alreadyReviewed) toast.info(tAttr('이미 다른 사람이 검토했습니다'));
      qc.invalidateQueries({ queryKey: ['patient-questionnaires', patientId] });
      qc.invalidateQueries({ queryKey: ['patient-questionnaires-encounter', patientId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('검토 완료 표시 실패')),
  });

  // 발송은 서버가 간호·관리자에게만 연다(POST admin/questionnaire/send) — 의사 화면에 버튼만 있고 늘 403 이었다(2026-09-30).
  // 환자에게 나가는 발신이라 권한을 넓히지 않고 버튼을 권한과 맞춘다. 실패는 조용히 삼키지 않는다.
  const canSend = useHasRole('NURSE');
  const sendMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admin/questionnaire/send`, { patientId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient-questionnaires', patientId] }),
    onError: (e) => toast.error((e as { message?: string })?.message ?? tAttr('문진표 발송에 실패했습니다')),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      SENT: { label: '발송됨', cls: 'bg-blue-100 text-blue-700' },
      OPENED: { label: '열람', cls: 'bg-indigo-100 text-indigo-700' },
      IN_PROGRESS: { label: '작성중', cls: 'bg-yellow-100 text-yellow-700' },
      COMPLETED: { label: '작성 완료', cls: 'bg-green-100 text-green-700' },
      EXPIRED: { label: '만료', cls: 'bg-red-100 text-red-700' },
    };
    const m = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${m.cls}`}>{m.label}</span>;
  };

  if (isLoading) return <div className="py-8 text-center text-gray-400"><T k="로딩 중..." /></div>;
  // 🔴 조회 실패를 "발송된 문진표가 없습니다"로 그리지 않는다(2026-09-02)
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      {/* 헤더 + 발송 버튼 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">문진표 ({tokens.length}<Unit>건</Unit>)</h3>
        {canSend ? (
          <button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            <T k="+ 문진표 발송" />
          </button>
        ) : (
          <span className="text-[11px] text-gray-400"><T k="문진표 발송은 간호·관리자가 합니다" /></span>
        )}
      </div>

      {/* 문진표 목록 */}
      {!tokens.length ? (
        <EmptyState icon="📋" title="발송된 문진표가 없습니다." className="bg-gray-50 rounded-xl" />
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{t.formSchema?.name}</span>
                  {statusBadge(t.status)}
                  {t.reviewedAt && <span className="text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded"><T k="검토됨" /></span>}
                </div>
                <span className="text-xs text-gray-400">{kdate(new Date(t.createdAt))}</span>
              </div>

              <div className="text-xs text-gray-500 space-y-0.5">
                {t.sentVia && <p>발송: {t.sentVia}</p>}
                {t.openedAt && <p>열람: {kdate(t.openedAt, 'datetime')}</p>}
                {t.completedAt && <p>작성 완료: {kdate(t.completedAt, 'datetime')}</p>}
              </div>

              {/* 작성 완료된 경우 — 응답 보기 + 검토 */}
              {t.status === 'COMPLETED' && t.submission && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <button onClick={() => setSelectedSubmission(selectedSubmission?.id === t.submission?.id ? null : t.submission ?? null)}
                    className="text-xs text-blue-600 hover:underline">
                    {selectedSubmission?.id === t.submission?.id ? '응답 접기' : '응답 보기'}
                  </button>

                  {selectedSubmission?.id === t.submission?.id && (
                    <SubmissionViewer data={t.submission.data} />
                  )}

                  {t.reviewedAt ? (
                    <p className="text-[11px] text-green-700">
                      <Tf k="검토 {검토자} · {시각}" params={{ 검토자: t.reviewer ? `${t.reviewer.familyName}${t.reviewer.givenName}` : tAttr('검토자 확인 불가'), 시각: kdate(t.reviewedAt, 'datetime') }} />
                    </p>
                  ) : (
                    <button onClick={() => reviewMutation.mutate(t.id)} disabled={reviewMutation.isPending}
                      className="text-xs px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50">
                      <T k="검토 완료" />
                    </button>
                  )}
                  <p className="text-[10px] text-gray-400"><T k="검토 완료는 응답을 읽었다는 표시이며 임상 기록 확정이 아닙니다" /></p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 문진표 응답 뷰어 */
function SubmissionViewer({ data }: { data: Record<string, unknown> }) {
  if (!data || typeof data !== 'object') return <p className="text-xs text-gray-400"><T k="응답 데이터 없음" /></p>;

  const entries = Object.entries(data);
  const labelMap: Record<string, string> = {
    chief_complaint: '주요 증상',
    duration: '증상 시작 시기',
    severity: '증상 정도',
    past_history: '과거 병력',
    current_meds: '현재 복용 약물',
    allergies: '알레르기',
    family_history: '가족력',
    additional: '기타 참고사항',
    smoking: '흡연',
    alcohol: '음주',
    symptom_change: '증상 변화',
    medication_compliance: '복약 순응도',
    side_effects: '부작용',
    prior_anesthesia: '마취 경험',
  };

  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <span className="text-gray-500 w-24 shrink-0 font-medium">{labelMap[key] ?? key}</span>
          <span className="text-gray-800">{(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')) || '-'}</span>
        </div>
      ))}
    </div>
  );
}
