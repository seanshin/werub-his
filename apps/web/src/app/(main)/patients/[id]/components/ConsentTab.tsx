'use client';

import { RegistrationConsentCollector } from '@/components/consent/RegistrationConsentCollector';
import { useHasRole } from '@/hooks/use-admin-write';
import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { PatientConsentSignDialog } from '@/components/consent/PatientConsentSignDialog';
import type { MutationError } from '@hospital-run/shared';
import type { ConsentItem, ConsentTemplate } from './types';
import StatusBadge from '@/components/ui/StatusBadge';
import { kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 정본(consent)+세부 서명단계 확장(부분 오버라이드 패턴)
const CONSENT_SUBSTATE = {
  PATIENT_SIGNED: { label: '환자서명완료', bg: 'bg-blue-100', text: 'text-blue-700' },
  DOCTOR_SIGNED: { label: '의사서명완료', bg: 'bg-violet-100', text: 'text-violet-700' },
  WITNESS_REQUIRED: { label: '증인대기', bg: 'bg-amber-100', text: 'text-amber-700' },
};

const CONSENT_TYPES = [
  { value: 'SURGERY', label: '수술동의서' },
  { value: 'ANESTHESIA', label: '마취동의서' },
  { value: 'TREATMENT', label: '시술동의서' },
  { value: 'TRANSFUSION', label: '수혈동의서' },
  { value: 'RESEARCH', label: '연구참여동의서' },
  { value: 'DNR', label: 'DNR' },
  { value: 'GENERAL', label: '일반동의서' },
];



// 서명 요구사항
const SIGN_REQUIREMENTS: Record<string, string[]> = {
  SURGERY: ['환자', '의사', '증인'], ANESTHESIA: ['환자', '의사'],
  PROCEDURE: ['환자', '의사'], TRANSFUSION: ['환자', '간호사'],
  RESEARCH: ['환자', '의사', '증인'], DNR: ['환자', '의사', '증인'],
  TREATMENT: ['환자'], GENERAL: ['환자'],
};

type UnifiedConsent = { source: string; type: string; label: string; status: string; at: string | null };
const CONSENT_SOURCE_LABEL: Record<string, string> = {
  CLINICAL: '임상 동의서', PRIVACY: '개인정보', AI_TWIN: 'AI·트윈', CRM: '마케팅·알림', REGISTRATION: '등록 동의',
};
const CONSENT_STATUS: Record<string, { label: string; cls: string }> = {
  GRANTED: { label: '유효', cls: 'bg-emerald-100 text-emerald-700' },
  REVOKED: { label: '철회', cls: 'bg-red-100 text-red-700' },
  EXPIRED: { label: '만료', cls: 'bg-amber-100 text-amber-700' },
  PENDING: { label: '서명대기', cls: 'bg-blue-100 text-blue-700' },
  MISSING: { label: '미수집', cls: 'bg-gray-100 text-gray-500' },
};

export function ConsentTab({ patientId }: { patientId: string }) {
  const canCollectRegistration = useHasRole('ADMIN', 'NURSE', 'RECEPTIONIST', 'DOCTOR');
  const tAttr = useTAttr();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'SURGERY', templateName: '', risks: '', alternatives: '', content: '' });
  const qc = useQueryClient();

  const { data: consentsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-consents', patientId],
    queryFn: () => apiClient.get<{ data: ConsentItem[] }>(`/api/v1/patients/${patientId}/consents`),
  });

  const { data: templatesData } = useQuery({
    queryKey: ['consent-templates-list'],
    queryFn: () => apiClient.get<{ data: ConsentTemplate[] }>('/api/v1/consent-templates'),
    enabled: showForm,
  });

  // 🔴 A4: 통합 동의 현황 — 5원천 읽기 집계(임상·개인정보·AI·CRM·등록동의)
  const { data: unifiedData } = useQuery({
    queryKey: ['patient-consents-unified', patientId],
    queryFn: () => apiClient.get<{ data: { items: UnifiedConsent[]; counts: Record<string, number>; hasPortalAccount: boolean } }>(`/api/v1/patients/${patientId}/consents/unified`),
  });

  const createMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${patientId}/consents`, {
      type: form.type,
      templateName: form.templateName || `${CONSENT_TYPES.find(t => t.value === form.type)?.label ?? form.type}`,
      consentType: form.type,
      content: form.content ? JSON.parse(form.content) : { description: form.templateName },
      risks: form.risks || undefined,
      alternatives: form.alternatives || undefined,
    }),
    onSuccess: () => {
      toast.success('동의서가 생성되었습니다.');
      qc.invalidateQueries({ queryKey: ['patient-consents', patientId] });
      setShowForm(false);
      setForm({ type: 'SURGERY', templateName: '', risks: '', alternatives: '', content: '' });
    },
    onError: () => toast.error('동의서 생성에 실패했습니다.'),
  });

  // 🔴 (A1 2026-10-13) 환자 서명은 증거(서명패드 이미지·종이 스캔본)와 함께 — 이름 prompt 하나로 "서명 완료"가 되던 경로 제거
  const [signTarget, setSignTarget] = useState<{ id: string; title: string } | null>(null);

  const doctorSignMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/consent/${id}/doctor-sign`, {}),
    onSuccess: () => {
      toast.success('의사 서명 완료');
      qc.invalidateQueries({ queryKey: ['patient-consents', patientId] });
    },
    onError: () => toast.error('의사 서명 실패'),
  });

  const witnessSignMutation = useMutation({
    mutationFn: (id: string) => {
      const name = prompt('증인 이름을 입력하세요:');
      if (!name) throw new Error('취소');
      return apiClient.patch(`/api/v1/consent/${id}/witness-sign`, { witnessName: name });
    },
    onSuccess: () => {
      toast.success('증인 서명 완료');
      qc.invalidateQueries({ queryKey: ['patient-consents', patientId] });
    },
    onError: (e: MutationError) => { if (e?.message !== '취소') toast.error('증인 서명 실패'); },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/consent/${id}/resend-notification`, {}),
    // 🔴 결과를 확인하지 않고 "재전송했습니다"라고 말하던 것 — 화면 실사용 점검 W8(2026-08-14).
    //    서버가 이제 산출물(PatientNotification)을 확인해 `success:false` +
    //    `NO_PORTAL_ACCOUNT`/`NOTIFICATION_NOT_CREATED` 를 낸다. 화면이 그 값을 읽는다.
    onSuccess: (res: unknown) => {
      const d = (res as { data?: { success?: boolean; message?: string } })?.data;
      if (d?.success === false) toast.error(d.message ?? '재전송되지 않았습니다');
      else toast.success('서명 요청을 재전송했습니다');
    },
    onError: () => toast.error('재전송 실패'),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => {
      const reason = prompt('철회 사유를 입력하세요:');
      if (!reason) throw new Error('취소');
      return apiClient.patch(`/api/v1/consent/${id}/revoke`, { reason });
    },
    onSuccess: () => {
      toast.success('동의서가 철회되었습니다.');
      qc.invalidateQueries({ queryKey: ['patient-consents', patientId] });
    },
    onError: (e: MutationError) => { if (e?.message !== '취소') toast.error('철회 실패'); },
  });

  const consents = consentsData?.data ?? [];
  const templates = templatesData?.data ?? [];

  const unified = unifiedData?.data;

  return (
    <div className="space-y-4">
      {/* 초진 동의 10종 — 태블릿·환자 휴대폰·종이 스캔으로 환자에게 직접 받는다(2026-10-02) · 접수 창구 역할만(서버 @Roles 와 같다) */}
      {canCollectRegistration && <RegistrationConsentCollector patientId={patientId} />}
      {/* 🔴 A4: 통합 동의 현황 — 5원천을 병합하지 않고 읽기 집계(미수집을 유효로 그리지 않는다) */}
      {unified && unified.items.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900"><T k="통합 동의 현황" /></h4>
            <div className="flex gap-1.5">
              {(['GRANTED', 'PENDING', 'REVOKED', 'EXPIRED', 'MISSING'] as const).map((k) =>
                unified.counts[k] ? (
                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full ${CONSENT_STATUS[k].cls}`}>
                    {CONSENT_STATUS[k].label} {unified.counts[k]}
                  </span>
                ) : null,
              )}
            </div>
          </div>
          {!unified.hasPortalAccount && (
            <p className="mt-1 text-[11px] text-gray-400"><T k="포털 계정 없음 — 개인정보 동의(포털)는 대상 아님" /></p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {unified.items.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5">
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400"><T k={CONSENT_SOURCE_LABEL[c.source] ?? c.source} /></span>
                  <p className="truncate text-xs text-gray-700">{c.label}</p>
                </div>
                <span className={`ml-2 shrink-0 text-[11px] px-2 py-0.5 rounded-full ${CONSENT_STATUS[c.status]?.cls ?? 'bg-gray-100 text-gray-500'}`}>
                  {CONSENT_STATUS[c.status]?.label ?? c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900"><T k="동의서" /> ({consents.length}<Unit>건</Unit>)</h3>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
          {showForm ? <T k="취소" /> : <>+ <T k="동의서 생성" /></>}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-blue-200 p-6 space-y-4">
          <h4 className="text-sm font-bold text-gray-900"><T k="새 동의서 생성" /></h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="동의서 유형" /></label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm">
                {CONSENT_TYPES.map(t => <option key={t.value} value={t.value}>{tAttr(t.label)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="동의서 제목" /></label>
              <input value={form.templateName} onChange={e => setForm(f => ({ ...f, templateName: e.target.value }))}
                placeholder="예: 전신마취 하 슬관절 치환술 동의서"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            </div>
          </div>

          {/* Template Quick Select */}
          {templates.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="템플릿에서 선택 (선택사항)" /></label>
              <div className="flex gap-2 flex-wrap">
                {templates.map((t: ConsentTemplate) => (
                  <button key={t.id} type="button"
                    onClick={() => setForm(f => ({
                      ...f,
                      templateName: t.name,
                      type: t.type,
                      content: JSON.stringify(t.content ?? {}, null, 2),
                    }))}
                    className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="위험사항 및 부작용" /></label>
            <textarea value={form.risks} onChange={e => setForm(f => ({ ...f, risks: e.target.value }))}
              rows={2} placeholder={tAttr('수술/시술에 따른 위험사항을 기술합니다...')}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="대안적 치료 방법" /></label>
            <textarea value={form.alternatives} onChange={e => setForm(f => ({ ...f, alternatives: e.target.value }))}
              rows={2} placeholder={tAttr('대안적 치료 방법을 기술합니다...')}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none" />
          </div>

          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
            className="min-h-[44px] px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {createMutation.isPending ? <T k="생성중..." /> : <T k="동의서 생성" />}
          </button>
        </div>
      )}

      {/* Consent List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : consents.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm text-gray-400"><T k="등록된 동의서가 없습니다" /></p>
          <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">
            + <T k="동의서 생성하기" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {consents.map((c: ConsentItem) => (
            <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge domain="consent" config={CONSENT_SUBSTATE} status={c.status} className="text-[11px]" />
                  <span className="text-sm font-medium text-gray-900">
                    <T k={CONSENT_TYPES.find(t => t.value === (c.consentType ?? c.type))?.label ?? c.type} />
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {c.createdAt ? kdate(c.createdAt) : '-'}
                </span>
              </div>

              <p className="text-sm text-gray-700 mb-2">{c.templateName}</p>

              {c.risks && <p className="text-xs text-red-600 mb-1"><T k="위험사항" />: {c.risks.length > 60 ? c.risks.slice(0, 60) + '...' : c.risks}</p>}

              {c.signedAt && (
                <p className="text-xs text-emerald-600 mb-2">
                  <T k="서명" />: {c.patientSignedBy ?? c.signedBy} ({kdate(c.signedAt, 'datetime')})
                </p>
              )}

              {/* 서명 진행 상태 */}
              {(() => {
                const reqs = SIGN_REQUIREMENTS[c.consentType ?? c.type] ?? ['환자'];
                return (
                  <div className="flex items-center gap-3 mb-3 text-xs">
                    {reqs.map((r, idx) => {
                      const done = r === '환자' ? !!c.patientSignedAt
                        : r === '의사' || r === '간호사' ? !!c.doctorSignedAt
                        : !!c.witnessSignedAt;
                      return (
                        <div key={r} className="flex items-center gap-1">
                          {idx > 0 && <span className="text-gray-300 mx-1">→</span>}
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${done ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                            {done ? '✓' : idx + 1}
                          </span>
                          <span className={done ? 'text-emerald-600 font-medium' : 'text-gray-400'}><T k={r} /></span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 flex-wrap">
                {/* 환자 서명 (PENDING 상태) */}
                {c.status === 'PENDING' && !c.patientSignedAt && (
                  <button
                    type="button"
                    data-patient-sign-open
                    onClick={() => setSignTarget({ id: c.id, title: c.templateName ?? '' })}
                    className="min-h-[44px] px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                  >
                    <T k="환자 서명 받기" />
                  </button>
                )}

                {/* 의사/간호사 서명 (환자 서명 완료 후) */}
                {c.patientSignedAt && !c.doctorSignedAt && c.status !== 'SIGNED' && (
                  <button onClick={() => doctorSignMutation.mutate(c.id)} disabled={doctorSignMutation.isPending}
                    className="min-h-[44px] px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    <T k="의사 서명" />
                  </button>
                )}

                {/* 증인 서명 (의사 서명 완료 후, 필요한 경우) */}
                {c.doctorSignedAt && !c.witnessSignedAt && (SIGN_REQUIREMENTS[c.consentType ?? c.type] ?? []).includes('증인') && c.status !== 'SIGNED' && (
                  <button onClick={() => witnessSignMutation.mutate(c.id)} disabled={witnessSignMutation.isPending}
                    className="min-h-[44px] px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
                    <T k="증인 서명" />
                  </button>
                )}

                {/* 서명 요청 재전송 (PENDING 상태) */}
                {c.status === 'PENDING' && (
                  <button onClick={() => resendMutation.mutate(c.id)} disabled={resendMutation.isPending}
                    className="min-h-[44px] px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 disabled:opacity-50">
                    <T k="서명 요청 재전송" />
                  </button>
                )}

                {/* 철회 */}
                {(c.status === 'PENDING' || c.status === 'SIGNED') && (
                  <button onClick={() => revokeMutation.mutate(c.id)} disabled={revokeMutation.isPending}
                    className="min-h-[44px] px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-50">
                    <T k="철회" />
                  </button>
                )}

                {/* 인쇄 */}
                <a href={`/print/consent/${c.id}`} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  <T k="인쇄" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      {signTarget && (
        <PatientConsentSignDialog
          consentId={signTarget.id}
          title={signTarget.title}
          onClose={() => setSignTarget(null)}
          onSigned={() => {
            setSignTarget(null);
            toast.success(tAttr('서명 기록'));
            qc.invalidateQueries({ queryKey: ['patient-consents', patientId] });
          }}
        />
      )}
    </div>
  );
}
