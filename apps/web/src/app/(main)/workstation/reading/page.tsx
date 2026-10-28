'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { openPacsViewer } from '@/lib/pacs';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs } from '@/lib/ui-settings';
import { Duration, EmptyState, Unit, genderText } from '@/components/ui/display';
import { ageOf, AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

const FINDING_TEMPLATES = [
  'No significant abnormality.',
  'No active lung lesion.',
  'Degenerative change of spine.',
  'Fatty liver, mild.',
  'Simple renal cyst.',
  'Hepatic hemangioma.',
  'No evidence of acute intracranial pathology.',
];

const CONCLUSION_TEMPLATES = [
  'Within normal limits.',
  'No interval change compared with prior study.',
  'Clinically insignificant finding.',
  'Recommend follow-up study.',
  'Further evaluation with CT/MRI recommended.',
  'Correlate clinically.',
];

// ── WeRU.B 사전판독 ──
/**
 * 🔴 사전판독은 **지금 성립하지 않는다.** 되는 것처럼 보이게 만들지 않고, 화면이 그 사실을 말한다.
 *
 * 종전 코드는 `item.studyInstanceUid` 로 WADO URL 을 만들어 `POST /api/v1/ai/vision/analyze`
 * (image_url 방식)으로 보냈다. 실측(2026-08-18)로 확인된 것:
 *
 *  ① `ImagingResult` 에는 **StudyInstanceUID 컬럼 자체가 없다**(`schema.prisma` imaging_results).
 *     그래서 `item.studyInstanceUid` 는 항상 `undefined` → `studyUID=` 가 빈 채로 나갔다.
 *  ② 촬영 완료 EP(`workstation.acquireImaging`)는 body 의 `dicomStudyUid` 를 받기만 하고
 *     **어디에도 저장하지 않는다** → 영상을 지목할 수단이 원장에 없다.
 *  ③ 설령 UID 가 있어도 `/api/v1/pacs/wado` 는 HIS JWT + PACS_STUDY_VIEW 를 요구한다 →
 *     외부 AI 서버가 스스로 가져갈 수 없다(image_url 방식은 원리적으로 불가).
 *
 * 그런데도 버튼은 동작했고, AI 가 돌려준 문장이 `applyAiToForm` 으로 **판독보고서 소견란에
 * 그대로 들어갔다** — 보지 않은 영상에 대한 소견이 법정기록에 적힐 수 있는 경로였다(P15/P16).
 * 덤으로 외부 AI 에 환자 성명이 `clinical_info` 로 나가고 있었다(PHI 유출).
 *
 * 살리려면 필요한 것(보고만 한다 — 스키마는 코디네이터 소유):
 *   (a) `ImagingResult.studyInstanceUid`(+seriesInstanceUid) 컬럼 신설
 *   (b) `acquireImaging` 이 `dicomStudyUid` 를 실제로 저장(혹은 `DicomStudy.orderId` 배선)
 *   (c) 바이트 전달 — 이미 있는 경로를 쓴다: `pacs-proxy.fetchWadoImage()` →
 *       `POST /api/v1/ai/vision/medical/analyze`(multipart·`consent` 게이트·`patientId` 감사 귀속)
 *   (d) 이 화면의 외부 전송 동의 확인 UI(≡ `/admin/ai-vision`)
 */
const PRE_READ_UNAVAILABLE =
  `${AI_ORIGIN_TEXT} 사전판독 사용 불가 — 영상 식별자(StudyInstanceUID)가 HIS 에 기록되지 않아 AI 에 보낼 영상을 지목할 수 없습니다.`;

export default function ReadingQueuePage() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');
  const [reportTarget, setReportTarget] = useState<any>(null);
  const [form, setForm] = useState({ finding: '', conclusion: '', recommendation: '' });
  const { data: pendingRes, isLoading: pendingLoading, isError: pendingError, error: pendingErr, refetch: refetchPending } = useQuery({
    queryKey: ['ws-reading-pending'],
    queryFn: () => apiClient.get<any>('/api/v1/workstation/imaging/reading-queue'),
    refetchInterval: pollMs('fast'),
  });
  const pending = pendingRes?.data ?? [];

  const report = useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: any }) =>
      apiClient.post(`/api/v1/workstation/imaging/${orderId}/report`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-reading-pending'] });
      setReportTarget(null);
      toast.success('판독 완료');
    },
  });

  // 정본 계산 — 365.25 근사는 생일 경계에서 어긋난다
  const age = (dob: string) => ageOf(dob) ?? '-';
  const waitMin = (t: string) => t ? Math.round((Date.now() - new Date(t).getTime()) / 60000) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="📋 판독 대기열" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">대기 {pending.length}<Unit>건</Unit> · 10초 갱신</p>
        </div>
      </div>

      {/* 🔴 성립하지 않는 기능은 화면이 그 사실을 말한다(버튼 툴팁만으로는 아무도 못 읽는다) */}
      <p className="text-[11px] leading-snug text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        {PRE_READ_UNAVAILABLE}
      </p>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-100 pb-1">
        <button onClick={() => setTab('pending')}
          className={`px-3 py-1.5 text-xs font-medium rounded-t ${tab === 'pending' ? 'bg-gray-100 text-gray-800 border-b-2 border-gray-800' : 'text-gray-400'}`}>
          판독 대기 ({pending.length})
        </button>
      </div>

      {pendingLoading ? (
        <div className="py-16 text-center text-gray-400"><div className="animate-pulse text-3xl mb-2">📋</div><T k="로딩 중..." /></div>
      ) : pendingError ? (
        <QueryErrorFallback error={pendingErr} onRetry={refetchPending} />
      ) : pending.length === 0 ? (
        <EmptyState icon="📋" title="판독 대기 중인 영상이 없습니다" />
      ) : (
        <div className="space-y-2">
          {pending.map((item: any) => {
            const patient = item.order?.prescription?.encounter?.patient;
            const proc = item.order?.prescription?.procedureCode;
            const acqTime = item.acquiredAt || item.createdAt;
            return (
              <div key={item.id} className="bg-white border rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center text-sm font-bold">
                      {patient?.familyName}
                    </div>
                    <div>
                      <span className="font-semibold">{patient?.familyName}{patient?.givenName}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {genderText(patient?.gender)}/{age(patient?.dateOfBirth)}세 · {patient?.mrn}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">{proc?.nameKo ?? item.modality}</span>
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-semibold whitespace-nowrap">
                      <Duration minutes={waitMin(acqTime)} /> <T k="대기" />
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button type="button" onClick={() => openPacsViewer()}
                    className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-xl text-xs font-medium hover:bg-indigo-200">
                    <T k="PACS 뷰어" />
                  </button>
                  {/* 🔴 성립하지 않는 기능을 눌리게 두지 않는다 — 왜 안 되는지는 툴팁이 아니라 화면에 쓴다 */}
                  <button type="button" disabled title={PRE_READ_UNAVAILABLE}
                    className="px-3 py-1.5 bg-gray-100 text-gray-400 rounded-xl text-xs font-medium cursor-not-allowed">
                    {AI_ORIGIN_TEXT} 사전판독 (사용 불가)
                  </button>
                  <button onClick={() => {
                    setReportTarget(item);
                    setForm({ finding: '', conclusion: '', recommendation: '' });
                  }}
                    className="px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-medium hover:bg-violet-700 shadow-sm">
                    <T k="판독 소견 입력" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 판독 모달 */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setReportTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex-shrink-0">
              <h3 className="font-bold"><T k="판독 소견 입력" /></h3>
              <p className="text-sm text-gray-500">
                {reportTarget.order?.prescription?.procedureCode?.nameKo ?? reportTarget.modality}
                {' — '}
                {reportTarget.order?.prescription?.encounter?.patient?.familyName}
                {reportTarget.order?.prescription?.encounter?.patient?.givenName}
              </p>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              {/* 소견 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500"><T k="Findings (소견)" /></label>
                  <select className="text-[10px] border rounded px-1.5 py-0.5 text-gray-500"
                    onChange={(e) => { if (e.target.value) setForm({ ...form, finding: form.finding + (form.finding ? '\n' : '') + e.target.value }); e.target.value = ''; }}>
                    <option value="">{tAttr('템플릿 삽입...')}</option>
                    {FINDING_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm" rows={5} placeholder={tAttr('영상 소견을 기술하세요...')}
                  value={form.finding} onChange={(e) => setForm({ ...form, finding: e.target.value })} />
              </div>

              {/* 결론 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-500"><T k="Conclusion (결론)" /></label>
                  <select className="text-[10px] border rounded px-1.5 py-0.5 text-gray-500"
                    onChange={(e) => { if (e.target.value) setForm({ ...form, conclusion: e.target.value }); e.target.value = ''; }}>
                    <option value="">{tAttr('템플릿 삽입...')}</option>
                    {CONCLUSION_TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <textarea className="w-full border rounded-xl px-3 py-2.5 text-sm" rows={3} placeholder={tAttr('판독 결론...')}
                  value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} />
              </div>

              {/* 권고 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block"><T k="Recommendation (권고)" /></label>
                <input className="w-full border rounded-xl px-3 py-2.5 text-sm" placeholder={tAttr('추가 검사, 추적 등...')}
                  value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} />
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setReportTarget(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button onClick={() => report.mutate({ orderId: reportTarget.order?.id, body: form })}
                disabled={!form.finding || !form.conclusion}
                className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shadow-sm"><T k="판독 완료" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
