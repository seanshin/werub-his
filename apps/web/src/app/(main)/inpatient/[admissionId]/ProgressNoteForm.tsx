'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { composeSoapNote, EMPTY_SOAP, type SoapInput } from '@/lib/progress-note-soap';
import { T } from '@/components/ui/i18n-text';

/**
 * 입원 일일 경과기록(SOAP) 작성 폼 — 「경과 기록」 탭.
 *
 * 🔴 (2026-09-30) 쓰기 EP(`POST /inpatient/:id/progress-note`·DOCTOR)는 있었는데 **부르는 화면이 0**이었다 —
 *    탭은 읽기만 했다. 일일 SOAP 의 정본 저장소는 경과기록(ProgressNote) 하나다(회진 폼은 여기로 안내만 한다).
 *    본문 조립 규약: `lib/progress-note-soap.ts`. 초기값은 전부 빈칸(쓰기 폼은 미선택으로 시작한다).
 * 입원 초진기록(H&P)은 같은 원장에 **종류(noteType=ADMISSION)** 로 남긴다(2026-09-30 스키마 신설 — 본문 표지로 지어내지 않는다).
 */
export function ProgressNoteForm({ admissionId }: { admissionId: string }) {
  const qc = useQueryClient();
  const [soap, setSoap] = useState<SoapInput>(EMPTY_SOAP);
  const [noteType, setNoteType] = useState<'PROGRESS' | 'ADMISSION'>('PROGRESS');
  const [saveError, setSaveError] = useState<string | null>(null);
  const content = composeSoapNote(soap);

  const saveMut = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/inpatient/${admissionId}/progress-note`, { content, noteType }),
    onSuccess: () => {
      setSaveError(null);
      setSoap(EMPTY_SOAP);
      // 목록은 입원 상세 응답(progressNotes)에 실려 온다 — 그 조회를 다시 부른다
      qc.invalidateQueries({ queryKey: ['admission-detail', admissionId] });
      toast.success(noteType === 'ADMISSION' ? '입원 초진기록이 저장되었습니다.' : '경과기록이 저장되었습니다.');
      setNoteType('PROGRESS');
    },
    // 🔴 서버 거부 사유를 그대로 보여준다(권한·검증 실패를 "오류가 발생했습니다"로 뭉개지 않는다)
    onError: (e: unknown) => setSaveError(extractErrorMessage(e)),
  });

  const field = (key: keyof SoapInput, label: string) => (
    <div>
      <label htmlFor={`pn-${key}`} className="block text-xs font-medium text-gray-500 mb-1"><T k={label} /></label>
      <textarea id={`pn-${key}`} value={soap[key]} onChange={e => setSoap({ ...soap, [key]: e.target.value })}
        rows={3} className="w-full px-3 py-2 border rounded-lg text-sm" data-testid={`pn-${key}`} />
    </div>
  );

  return (
    <div className="bg-white border border-blue-200 rounded-2xl shadow-sm p-5 space-y-3" data-testid="progress-note-form">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900"><T k="오늘 경과기록 작성 (SOAP)" /></h3>
        {/* 기록 종류 — 입원 초진기록(H&P)은 입원 시 한 번(보험 심사·기록 완결성의 근거) */}
        <div className="flex gap-1" data-note-type>
          {([{ v: 'PROGRESS' as const, l: '경과기록' }, { v: 'ADMISSION' as const, l: '입원 초진기록(H&P)' }]).map((o) => (
            <button key={o.v} type="button" onClick={() => setNoteType(o.v)} aria-pressed={noteType === o.v}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-medium ${noteType === o.v ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}>
              <T k={o.l} />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {field('subjective', 'S — 환자 호소/주관적 증상')}
        {field('objective', 'O — 객관적 소견')}
        {field('assessment', 'A — 평가/진단')}
        {field('plan', 'P — 치료 계획')}
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2" data-testid="progress-note-error">
          <T k="경과기록 저장 실패" /> — {saveError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => saveMut.mutate()} disabled={!content || saveMut.isPending}
          className="min-h-[44px] px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          data-testid="progress-note-save">
          {saveMut.isPending ? <T k="저장 중..." /> : <T k="경과기록 저장" />}
        </button>
        {!content && <span className="text-[11px] text-gray-400"><T k="한 칸 이상 입력하면 저장할 수 있습니다." /></span>}
      </div>
    </div>
  );
}
