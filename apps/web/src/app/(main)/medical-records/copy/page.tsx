'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { T, useTAttr } from '@/components/ui/i18n-text';

const copySchema = z.object({
  patientId: z.string().min(1, '환자 ID를 입력하세요'),
  requestedBy: z.string().min(1, '신청자명을 입력하세요'),
  requestorRelation: z.string().min(1),
  purpose: z.string().min(1, '발급목적을 입력하세요'),
  recordTypes: z.array(z.string()).min(1, '기록 유형을 선택하세요'),
  copyCount: z.coerce.number().min(1),
  notes: z.string().optional(),
});
type CopyForm = z.infer<typeof copySchema>;

const RECORD_TYPES = [
  { value: 'encounter', label: '진료기록' },
  { value: 'discharge_summary', label: '퇴원요약' },
  { value: 'lab_result', label: '검사결과' },
  { value: 'nursing_note', label: '간호기록' },
];
const RELATIONS = ['본인', '배우자', '직계존비속', '법정대리인', '기관'];
/** 미리보기를 만들 수 있는 유형 — 🔴 (B6) 간호기록은 서버 생성기가 없어 늘 404 였다(선택지에서 뺀다) */
const PREVIEW_TYPES = RECORD_TYPES.filter((t) => t.value !== 'nursing_note');

export default function MedicalRecordCopyPage() {
  const tAttr = useTAttr();
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<CopyForm>({
    resolver: zodResolver(copySchema),
    defaultValues: { patientId: '', requestedBy: '', requestorRelation: '본인', purpose: '', recordTypes: [], copyCount: 1, notes: '' },
  });
  const recordTypes = watch('recordTypes');

  const [pdfForm, setPdfForm] = useState({ recordType: 'encounter', recordId: '' });

  const copyMut = useMutation({
    mutationFn: (d: CopyForm) => apiClient.post('/api/v1/medical-record-copies', d),
  });

  // 🔴 (2026-10-13 결함 발굴 B6) 종전엔 결과(HTML)를 어디에도 쓰지 않았다 — 버튼을 눌러도 아무것도 안 나왔다.
  //    새 창 미리보기로 연다 · 발급이 아니다(번호·진위확인 없음) · 실패는 말한다.
  const pdfMut = useMutation({
    mutationFn: (d: { recordType: string; recordId: string }) => apiClient.fetch<string>('/api/v1/medical-records/generate-pdf', {
      method: 'POST', body: JSON.stringify(d), headers: { 'Content-Type': 'application/json' },
    }),
    onSuccess: (html) => {
      const text = typeof html === 'string' ? html : String((html as { data?: unknown })?.data ?? '');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
      window.open(url, '_blank', 'noopener');
    },
  });

  const toggleRecordType = (t: string) => {
    const current = recordTypes;
    setValue('recordTypes', current.includes(t) ? current.filter(r => r !== t) : [...current, t]);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900"><T k="의무기록 사본발급" /></h1>

      <div className="grid grid-cols-2 gap-6">
        {/* PDF 미리보기 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="text-lg font-semibold"><T k="PDF 생성" /></h3>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="기록 유형" /></label>
            <select value={pdfForm.recordType} onChange={e => setPdfForm(f => ({ ...f, recordType: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              {PREVIEW_TYPES.map(t => <option key={t.value} value={t.value}>{tAttr(t.label)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="기록 ID (UUID)" /></label>
            <input value={pdfForm.recordId} onChange={e => setPdfForm(f => ({ ...f, recordId: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Encounter/Admission UUID" />
          </div>
          <p className="text-xs text-amber-700" data-copy-preview-note><T k="미리보기 — 발급 아님(번호·진위확인 없음)" /></p>
          <button onClick={() => pdfMut.mutate(pdfForm)} disabled={pdfMut.isPending || !pdfForm.recordId} data-copy-preview className="w-full py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <T k="미리보기 열기" />
          </button>
          {pdfMut.isError && <p className="text-xs text-red-600" data-copy-preview-error>{extractErrorMessage(pdfMut.error)}</p>}
        </div>

        {/* 사본발급 이력 */}
        <form onSubmit={handleSubmit((d) => copyMut.mutate(d))} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="text-lg font-semibold"><T k="사본 발급 이력 수기 기록(문서 발급 아님)" /></h3>
          {/* 🔴 (B6) 이 폼은 문서를 만들지 않는다 — 종전엔 "발급 완료!"라 말했다(P16) */}
          <p className="text-xs text-gray-600"><T k="서류 발급은 서류 접수·발급 화면에서 합니다 — 여기는 이력만 남깁니다." /> <Link href="/workstation/documents" className="text-blue-600 underline">/workstation/documents</Link></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="환자 ID" /></label>
              <input {...register('patientId')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              {errors.patientId && <p className="text-xs text-red-500 mt-0.5">{errors.patientId.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="신청자명" /></label>
              <input {...register('requestedBy')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              {errors.requestedBy && <p className="text-xs text-red-500 mt-0.5">{errors.requestedBy.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="관계" /></label>
              <select {...register('requestorRelation')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {RELATIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="부수" /></label>
              <input type="number" min={1} {...register('copyCount')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="발급목적" /></label>
            <input {...register('purpose')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('보험청구, 법적 제출 등')} />
            {errors.purpose && <p className="text-xs text-red-500 mt-0.5">{errors.purpose.message}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1"><T k="기록 유형" /></label>
            <div className="flex gap-2 flex-wrap">
              {RECORD_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => toggleRecordType(t.value)} className={`px-3 py-1.5 text-xs rounded-lg ${recordTypes.includes(t.value) ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}><T k={t.label} /></button>
              ))}
            </div>
            {errors.recordTypes && <p className="text-xs text-red-500 mt-0.5">{errors.recordTypes.message}</p>}
          </div>
          <button type="submit" disabled={copyMut.isPending} className="w-full py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {copyMut.isSuccess ? <T k="기록됨 — 문서는 발급되지 않았습니다" /> : <T k="이력 기록" />}
          </button>
        </form>
      </div>
    </div>
  );
}
