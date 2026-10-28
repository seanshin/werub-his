'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { useDepartments } from '@/lib/use-departments';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 협진 **의뢰 등록**.
 *
 * 🔴 2026-08-26 사람 신고: "협진/의뢰 추가하는 기능은?"
 *    서버에는 `POST /api/v1/consultations` 가 진작 있었는데 **이 화면은 수락·회신·종결만** 했다.
 *    이 저장소 규약 — **EP 를 만들면 부르는 화면까지가 한 벌**이다.
 *
 * 🔴 협진은 **진료(Encounter)에 매달린다.** 환자만 고르면 서버 필수 `encounterId` 가 비어
 *    등록이 되지 않는다 — 그래서 환자를 고르면 그 환자의 진료를 불러 고르게 한다.
 */
const URGENCY = [
  { value: 'ROUTINE', label: '일반' },
  { value: 'URGENT', label: '긴급' },
  { value: 'EMERGENCY', label: '응급' },
];

type EncounterLite = { id: string; visitDate?: string; createdAt?: string; department?: string; chiefComplaint?: string };

export function NewConsultationForm() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 🔴 진료과는 마스터 정본 하나(`department_codes`) — 화면에 어휘를 지어 적지 않는다
  const { names: departments } = useDepartments({ category: 'CLINICAL' });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    patientId: '', encounterId: '', toDepartment: '', toDoctorId: '',
    reason: '', clinicalQuestion: '', urgency: 'ROUTINE',
  });

  /** 🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다 — 접으면 "진료 이력 없음"으로 보인다 */
  const encQ = useQuery({
    queryKey: ['consult-encounters', form.patientId],
    queryFn: () => apiClient.get<{ data: EncounterLite[] }>(`/api/v1/patients/${form.patientId}/encounters?limit=20`),
    enabled: !!form.patientId,
  });
  const encounters: EncounterLite[] = (() => {
    const raw = encQ.data?.data as unknown;
    return Array.isArray(raw) ? (raw as EncounterLite[]) : ((raw as { data?: EncounterLite[] })?.data ?? []);
  })();

  const createMut = useMutation({
    // 🔴 스프레드로 보내지 않는다 — 폼에만 있는 키(`patientId`)가 섞이면 whitelist 가 조용히 지운다
    mutationFn: () => apiClient.post('/api/v1/consultations', {
      encounterId: form.encounterId,
      toDepartment: form.toDepartment,
      toDoctorId: form.toDoctorId || undefined,
      reason: form.reason.trim(),
      clinicalQuestion: form.clinicalQuestion.trim() || undefined,
      urgency: form.urgency,
    }),
    onSuccess: () => {
      toast.success(tAttr('협진을 의뢰했습니다'));
      setForm({ patientId: '', encounterId: '', toDepartment: '', toDoctorId: '', reason: '', clinicalQuestion: '', urgency: 'ROUTINE' });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['consultations'] });
      qc.invalidateQueries({ queryKey: ['consultations-inbox'] });
    },
    // 🔴 실패 사유를 그대로 — "실패"만으로는 무엇을 고쳐야 할지 알 수 없다
    onError: (e: Error) => toast.error(e?.message || tAttr('협진 의뢰에 실패했습니다')),
  });

  const canSubmit = !!form.encounterId && !!form.toDepartment && form.reason.trim().length >= 2;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        + <T k="협진 의뢰" />
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/30 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800"><T k="새 협진 의뢰" /></p>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-[11px] text-gray-500"><T k="환자" /> *</label>
          <PatientSelector
            value={form.patientId}
            placeholder="환자 검색(이름·MRN)"
            onChange={(pid) => setForm({ ...form, patientId: pid, encounterId: '' })}
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500"><T k="근거 진료" /> *</label>
          <select
            value={form.encounterId}
            onChange={(e) => setForm({ ...form, encounterId: e.target.value })}
            disabled={!form.patientId}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm bg-white disabled:bg-gray-50"
          >
            <option value="">{tAttr(form.patientId ? '— 진료 선택 —' : '환자를 먼저 고르세요')}</option>
            {encounters.map((e) => (
              <option key={e.id} value={e.id}>
                {(e.visitDate ?? e.createdAt ?? '').slice(0, 10)} · {e.department ?? ''} {e.chiefComplaint ? `· ${e.chiefComplaint}` : ''}
              </option>
            ))}
          </select>
          {/* 🔴 못 읽은 것을 "없다"로 그리지 않는다 */}
          {encQ.isError && <p className="mt-0.5 text-[11px] text-rose-600"><T k="진료 이력을 불러오지 못했습니다 — 없다는 뜻이 아닙니다." /></p>}
          {form.patientId && !encQ.isLoading && !encQ.isError && encounters.length === 0 && (
            <p className="mt-0.5 text-[11px] text-gray-400"><T k="이 환자의 진료 기록이 없습니다 — 협진은 진료에 매달립니다." /></p>
          )}
        </div>

        <div>
          <label className="text-[11px] text-gray-500"><T k="의뢰 대상 진료과" /> *</label>
          <input
            list="consult-depts"
            value={form.toDepartment}
            onChange={(e) => setForm({ ...form, toDepartment: e.target.value })}
            placeholder={tAttr('예: 신경외과')}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
          <datalist id="consult-depts">
            {departments.map((d) => <option key={d} value={d} />)}
          </datalist>
        </div>
        <div>
          <label className="text-[11px] text-gray-500"><T k="긴급도" /></label>
          <select
            value={form.urgency}
            onChange={(e) => setForm({ ...form, urgency: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm bg-white"
          >
            {URGENCY.map((u) => <option key={u.value} value={u.value}>{tAttr(u.label)}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[11px] text-gray-500"><T k="의뢰 사유" /> *</label>
        <textarea
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          rows={2}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="text-[11px] text-gray-500"><T k="임상 질문" /> <span className="text-gray-400">— <T k="무엇을 답해 주기를 바라는가" /></span></label>
        <textarea
          value={form.clinicalQuestion}
          onChange={(e) => setForm({ ...form, clinicalQuestion: e.target.value })}
          rows={2}
          className="w-full resize-none rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600"><T k="취소" /></button>
        <button
          type="button"
          onClick={() => createMut.mutate()}
          disabled={!canSubmit || createMut.isPending}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          <T k={createMut.isPending ? '의뢰 중…' : '의뢰'} />
        </button>
      </div>
    </div>
  );
}
