'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate, Duration } from '@/components/ui/display';
import PatientSelector from '@/components/ui/PatientSelector';

/**
 * 복약지도(복약상담) — 🔴 고아 EP 회수(2026-08-26).
 *
 * 서버에는 `POST /pharmacy/counsel` · `GET /pharmacy/counsel/patient/:patientId` ·
 * `GET /pharmacy/counsel/dispensing/:id` 가 개통 이래 있었는데 **부르는 화면이 0** 이었다.
 * 운영 `dispensing_counsels` 3행은 전부 2026-05-28 시드 — 사람이 남긴 기록은 **0건**이다.
 *
 * 등록이 막혀 있던 진짜 이유는 화면 부재만이 아니었다: 등록 EP 가 `dispensingId` 를
 * 요구하는데 **환자의 조제 목록을 주는 EP 가 없었다**(조제 UUID 를 외워 타이핑할 수는 없다).
 * 그래서 후보 EP(`counsel/candidates/:patientId`)를 함께 만들었다.
 */

interface CounselCandidate {
  id: string;
  status: string;
  careType: string;
  createdAt: string;
  dispensedAt: string | null;
  issuedAt: string | null;
  medications: string[];
  counselCount: number;
}

interface CounselRecord {
  id: string;
  counselType: string;
  content: string;
  drugInteractions: string | null;
  sideEffects: string | null;
  foodInteractions: string | null;
  storageInstructions: string | null;
  duration: number | null;
  counseledAt: string;
  pharmacist?: { familyName?: string | null; givenName?: string | null } | null;
}

const COUNSEL_TYPE_LABEL: Record<string, string> = {
  INITIAL: '초회', REFILL: '재조제', DISCHARGE: '퇴원',
};

const CARE_TYPE_LABEL: Record<string, string> = {
  OUTPATIENT: '외래', INPATIENT: '입원', DISCHARGE: '퇴원',
};

function unwrap<T>(res: unknown): T | undefined {
  const r = res as Record<string, unknown> | undefined;
  return (r?.data ?? r) as T | undefined;
}

function staffName(p: CounselRecord['pharmacist']): string | null {
  if (!p) return null;
  const n = `${p.familyName ?? ''}${p.givenName ?? ''}`.trim();
  return n.length ? n : null;
}

/** 빈 초기값 — 🔴 쓰기 폼은 미선택으로 시작한다(상담 종류를 화면이 대신 고르지 않는다). */
const EMPTY_FORM = {
  dispensingId: '',
  counselType: '',
  content: '',
  drugInteractions: '',
  sideEffects: '',
  foodInteractions: '',
  storageInstructions: '',
  duration: '',
};

export default function CounselTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const history = useQuery({
    queryKey: ['pharmacy-counsels', patientId],
    // 🔴 queryFn 안에서 .catch(()=>[]) 를 쓰지 않는다 — 조회 실패가 "상담 기록 없음"이 되면
    //    약사는 이미 한 지도를 다시 하거나, 안 한 지도를 했다고 믿는다.
    queryFn: () => apiClient.get<{ data: CounselRecord[] }>(`/api/v1/pharmacy/counsel/patient/${patientId}`),
    enabled: !!patientId,
  });

  const candidates = useQuery({
    queryKey: ['pharmacy-counsel-candidates', patientId],
    queryFn: () => apiClient.get<{ data: CounselCandidate[] }>(`/api/v1/pharmacy/counsel/candidates/${patientId}`),
    enabled: !!patientId && showForm,
  });

  const create = useMutation({
    // 🔴 스프레드로 보내지 않는다 — 전역 whitelist:true 가 DTO 에 없는 키를 조용히 지운다.
    //    DTO(`CreateCounselDto`) 필드 이름을 그대로 명시한다.
    mutationFn: () => apiClient.post('/api/v1/pharmacy/counsel', {
      dispensingId: form.dispensingId,
      patientId,
      counselType: form.counselType || undefined,
      content: form.content,
      drugInteractions: form.drugInteractions.trim() || undefined,
      sideEffects: form.sideEffects.trim() || undefined,
      foodInteractions: form.foodInteractions.trim() || undefined,
      storageInstructions: form.storageInstructions.trim() || undefined,
      // 재지 않은 상담 시간은 보내지 않는다(0분은 다른 사실이다)
      duration: form.duration.trim() === '' ? undefined : Number(form.duration),
    }),
    onSuccess: () => {
      toast.success('복약지도 기록 완료');
      qc.invalidateQueries({ queryKey: ['pharmacy-counsels', patientId] });
      qc.invalidateQueries({ queryKey: ['pharmacy-counsel-candidates', patientId] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? '복약지도 기록 실패'),
  });

  const records = unwrap<CounselRecord[]>(history.data) ?? [];
  const candidateList = unwrap<CounselCandidate[]>(candidates.data) ?? [];
  const canSubmit = !!form.dispensingId && !!form.counselType && form.content.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <label className="block text-xs font-medium text-gray-600"><T k="환자" /></label>
        <PatientSelector value={patientId} onChange={(id) => { setPatientId(id); setShowForm(false); }}
          placeholder={tAttr('환자 검색 (이름·MRN·전화번호)')} />
        {patientId && (
          <div className="flex justify-end">
            <button onClick={() => { setShowForm((v) => !v); setForm({ ...EMPTY_FORM }); }}
              className="min-h-[44px] px-4 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700">
              <T k={showForm ? '작성 취소' : '+ 복약지도 기록'} />
            </button>
          </div>
        )}
      </div>

      {/* 등록 폼 */}
      {patientId && showForm && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-900"><T k="복약지도 기록" /></h3>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="대상 조제 *" /></label>
            {candidates.isError ? (
              <QueryErrorFallback error={candidates.error} onRetry={candidates.refetch} />
            ) : candidates.isLoading ? (
              <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
            ) : candidateList.length === 0 ? (
              // 🔴 "조제가 없다"와 "조회를 못 했다"는 다른 사실이다 — 위 분기가 갈라 놓는다
              <p className="text-xs text-gray-500 py-2"><T k="이 환자의 조제 기록이 없습니다 — 복약지도를 붙일 대상이 없습니다." /></p>
            ) : (
              // 라디오 목록 — 날짜는 정본(`<KDate>`·`ui.dateStyle`)으로 그린다.
              // `<option>` 안에서는 컴포넌트를 쓸 수 없어 목록 형태로 둔다.
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {candidateList.map((c) => (
                  <li key={c.id}>
                    <label className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer min-h-[44px] ${
                      form.dispensingId === c.id ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 hover:bg-gray-50'
                    }`}>
                      <input type="radio" name="counsel-dispensing" value={c.id} checked={form.dispensingId === c.id}
                        onChange={() => setForm((f) => ({ ...f, dispensingId: c.id }))} className="mt-1" />
                      <span className="flex-1 text-xs">
                        <span className="font-medium text-gray-900">
                          {c.medications.length ? c.medications.join(', ') : '품목 미기재'}
                        </span>
                        <span className="block text-gray-500">
                          <T k={CARE_TYPE_LABEL[c.careType] ?? c.careType} /> · <KDate value={c.createdAt} />
                          {/* 이미 남긴 지도가 있으면 그렇게 말한다 — 0 은 진짜 0(행을 셌다) */}
                          {c.counselCount > 0 && <span className="text-amber-700"> <T k="· 기존 지도" /> {c.counselCount}<T k="건" /></span>}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상담 종류 *" /></label>
              <select value={form.counselType} onChange={(e) => setForm((f) => ({ ...f, counselType: e.target.value }))}
                className="w-full border rounded-xl px-3 py-2 text-sm">
                <option value="">{tAttr('선택하세요')}</option>
                {Object.entries(COUNSEL_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상담 시간(분)" /></label>
              <input value={form.duration} onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                type="number" min={1} className="w-full border rounded-xl px-3 py-2 text-sm" />
              <p className="text-[11px] text-gray-400 mt-1"><T k="재지 않았으면 비워 둡니다" /></p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상담 내용 *" /></label>
            <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={3} className="w-full border rounded-xl px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {([
              ['drugInteractions', '약물 상호작용'],
              ['sideEffects', '부작용 안내'],
              ['foodInteractions', '음식 상호작용'],
              ['storageInstructions', '보관 방법'],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k={label} /></label>
                <textarea value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" />
              </div>
            ))}
          </div>

          <button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}
            className="w-full min-h-[44px] bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
            <T k={create.isPending ? '기록 중...' : '복약지도 기록'} />
          </button>
        </div>
      )}

      {/* 이력 */}
      {!patientId ? (
        <EmptyState title="환자를 선택하세요" hint="선택한 환자의 복약지도 이력을 보여줍니다" />
      ) : history.isError ? (
        <QueryErrorFallback error={history.error} onRetry={history.refetch} />
      ) : history.isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-5 bg-gray-100 rounded animate-pulse" />)}
        </div>
      ) : records.length === 0 ? (
        <EmptyState title="복약지도 기록 없음" hint="이 환자에게 남긴 복약지도가 없습니다" />
      ) : (
        <div className="space-y-3">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  <T k={COUNSEL_TYPE_LABEL[r.counselType] ?? r.counselType} />
                </span>
                <span className="text-xs text-gray-500"><KDate value={r.counseledAt} mode="datetime" /></span>
                {/* 기록자를 모르면 이름을 지어내지 않는다 */}
                <span className="text-xs text-gray-500">{staffName(r.pharmacist) ?? '기록자 미상'}</span>
                {r.duration != null && (
                  <span className="text-xs text-gray-400"><Duration minutes={r.duration} /></span>
                )}
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.content}</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['drugInteractions', '상호작용'],
                  ['sideEffects', '부작용'],
                  ['foodInteractions', '음식'],
                  ['storageInstructions', '보관'],
                ] as const).map(([key, label]) => r[key] ? (
                  <div key={key} className="text-xs">
                    <span className="text-gray-400"><T k={label} /></span>
                    <p className="text-gray-700 whitespace-pre-wrap">{r[key]}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
