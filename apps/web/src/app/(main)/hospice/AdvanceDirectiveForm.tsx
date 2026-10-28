'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 사전연명의료 문서 등록(2026-10-10) — 서버 EP(`POST hospice/directives`)는 있었는데 등록 화면이 없었다(운영 0건).
 *  · 연명의료계획서(POLST)는 의사만(서버도 막는다 · 작성 의사 = 로그인한 의사) · 사전연명의료의향서(AD)는 등록 직원
 *  · 🔴 쓰기 폼은 미선택으로 시작 — 고르지 않은 항목은 보내지 않는다(빈칸 = 문서에 그 항목이 없다 · '시행'으로 채우지 않는다)
 *  · 값은 저장 어휘 DNR(시행하지 않음 — 유보·중단)·DO(시행) — 카드가 같은 어휘를 읽는다
 */
export const DIRECTIVE_DECISIONS: Array<[string, string]> = [['DNR', '시행하지 않음(유보·중단)'], ['DO', '시행']];
export const DIRECTIVE_FIELDS: Array<[string, string]> = [
  ['cprDecision', '심폐소생술'], ['ventilatorDecision', '인공호흡기'], ['dialysisDecision', '혈액투석'],
  ['transfusionDecision', '수혈'], ['chemotherapyDecision', '항암제'],
];

export function AdvanceDirectiveForm({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isDoctor = role === 'DOCTOR' || role === 'ADMIN';
  const [docType, setDocType] = useState<'' | 'AD' | 'POLST'>('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [hospice, setHospice] = useState<'' | 'yes' | 'no'>('');
  const anyDecision = Object.values(vals).some(Boolean);
  const ready = !!docType && anyDecision && (docType !== 'POLST' || isDoctor);
  const save = useMutation({
    mutationFn: () => apiClient.post('/api/v1/hospice/directives', {
      patientId, documentType: docType,
      ...Object.fromEntries(Object.entries(vals).filter(([, v]) => v)),
      ...(hospice ? { hospiceConsent: hospice === 'yes' } : {}),
    }),
    onSuccess: () => {
      toast.success(tAttr('사전연명의료 문서를 등록했습니다.'));
      setDocType(''); setVals({}); setHospice('');
      qc.invalidateQueries({ queryKey: ['hospice-directives', patientId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('등록하지 못했습니다.')),
  });
  return (
    <div className="space-y-2 rounded-xl border border-dashed p-3 text-xs" data-directive-form>
      <p className="font-bold text-gray-800"><T k="사전연명의료 문서 등록" /></p>
      <p className="text-[11px] text-gray-500"><T k="문서에 적힌 항목만 고릅니다. 고르지 않은 항목은 비워 둡니다(시행으로 채우지 않습니다)." /></p>
      <label className="flex flex-col gap-1"><T k="문서 종류" />
        <select value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)} className="rounded-lg border px-2 py-1.5" data-directive-type>
          <option value="">{tAttr('— 선택 —')}</option>
          <option value="AD">{tAttr('사전연명의료의향서')}</option>
          <option value="POLST" disabled={!isDoctor}>{tAttr('연명의료계획서')}{!isDoctor ? ` (${tAttr('의사만')})` : ''}</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {DIRECTIVE_FIELDS.map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1"><T k={label} />
            <select value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className="rounded-lg border px-2 py-1.5" data-directive-field={k}>
              <option value="">{tAttr('— 문서에 없음 —')}</option>
              {DIRECTIVE_DECISIONS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1"><T k="호스피스 이용" />
          <select value={hospice} onChange={(e) => setHospice(e.target.value as typeof hospice)} className="rounded-lg border px-2 py-1.5" data-directive-hospice>
            <option value="">{tAttr('— 문서에 없음 —')}</option>
            <option value="yes">{tAttr('예')}</option>
            <option value="no">{tAttr('아니오')}</option>
          </select>
        </label>
      </div>
      {docType === 'POLST' && !isDoctor && <p className="text-amber-700"><T k="연명의료계획서는 의사가 작성·등록합니다" /></p>}
      <button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()} data-directive-submit
        className="min-h-[44px] w-full rounded-lg bg-indigo-600 px-3 font-semibold text-white disabled:opacity-40">
        <T k="문서 등록" />
      </button>
    </div>
  );
}
