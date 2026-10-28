'use client';

import { use, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import NursingAiDraftPanel, { type NursingDraftProvenance } from '@/components/ai/NursingAiDraftPanel';
import DictationButton from '@/app/tablet/_components/DictationButton';
import QuickPhraseChips from '@/app/tablet/_components/QuickPhraseChips';
import { apiClient } from '@/lib/api-client';
import { useShiftBoundaries, shiftOf } from '@/lib/shift';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

/**
 * 간호 타블렛 기록 작성기(P2) — 이동 중 침상 옆 작성.
 * 보조 우선(기획 §8): WeRU.B 초안은 콘텐츠만 제시 → 간호사가 음성/필기/타이핑으로 편집 → 검토확인 → 작성=서명.
 * 책임은 서명 간호사(의료법 §22·JCI MOI.11.1.1). 저장 시 default(=SIGNED).
 */
type NoteType = 'SOAP' | 'DAR' | 'NARRATIVE';
type FieldKey = 'subjective' | 'objective' | 'assessment' | 'plan' | 'focus' | 'data' | 'action' | 'response' | 'content';

const FIELDS: Record<NoteType, { key: FieldKey; label: string; phrase?: 'S' | 'O' | 'A' | 'P' }[]> = {
  SOAP: [
    { key: 'subjective', label: 'S 주관적 호소', phrase: 'S' },
    { key: 'objective', label: 'O 객관적 관찰', phrase: 'O' },
    { key: 'assessment', label: 'A 간호 판단', phrase: 'A' },
    { key: 'plan', label: 'P 간호 계획', phrase: 'P' },
  ],
  DAR: [
    { key: 'focus', label: 'Focus 초점' },
    { key: 'data', label: 'D 자료', phrase: 'O' },
    { key: 'action', label: 'A 간호중재', phrase: 'P' },
    { key: 'response', label: 'R 반응/평가', phrase: 'A' },
  ],
  NARRATIVE: [{ key: 'content', label: '서술 기록' }],
};

// 교대 판정은 정본(shiftOf)+config 경계 — 하드코딩 3곳이 따로 벌어지던 것 수렴

// qa-check(F-4) 응답 형태 — BE nursingNoteQaContent: { enabled, score, grade, issues:[{level,code,field,message}] }
type QaIssue = { level?: string; code?: string; field?: string; message: string };
type QaResult = { enabled?: boolean; score?: number; grade?: string; issues?: QaIssue[] };

export default function NurseTabletNoteWriter({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const shiftBoundaries = useShiftBoundaries();
  const currentShift = shiftOf(new Date(), shiftBoundaries);
  const [noteType, setNoteType] = useState<NoteType>('SOAP');
  const [form, setForm] = useState<Record<string, string>>({});
  const [aiProvenance, setAiProvenance] = useState<NursingDraftProvenance | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [qa, setQa] = useState<QaResult | null>(null);
  const [qaState, setQaState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const appendField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: `${f[k] ? `${f[k]} ` : ''}${v}` }));

  const switchType = (t: NoteType) => {
    setNoteType(t); setForm({}); setAiProvenance(null); setReviewConfirmed(false); setQa(null); setQaState('idle'); setErr('');
  };

  const applyAiDraft = (draft: Record<string, string | null>, provenance: NursingDraftProvenance) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) if (v) next[k] = v;
    setForm((f) => ({ ...f, ...next }));
    setAiProvenance(provenance); setReviewConfirmed(false);
  };

  const runQa = async () => {
    setQaState('loading');
    try {
      const r = await apiClient.post<{ data: QaResult }>(`/api/v1/admissions/${admissionId}/nursing-notes/qa-check`, { noteType, ...form });
      const d = ((r as { data?: { data?: QaResult } })?.data?.data ?? (r as { data?: QaResult })?.data) ?? null;
      // AI 보조 비활성 시 enabled:false(점수/issues 없음) → 미표시
      setQa(d?.enabled ? d : null);
      setQaState('done');
    } catch {
      setQa(null); setQaState('done');
    }
  };

  const fields = FIELDS[noteType];
  const hasContent = fields.some((f) => (form[f.key] ?? '').trim());
  const blockedByReview = !!aiProvenance && !reviewConfirmed;

  const save = async () => {
    if (!hasContent || blockedByReview) return;
    setSaving(true); setErr('');
    try {
      await apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes`, {
        noteType, shiftType: currentShift, ...form, ...(aiProvenance ? { aiProvenance } : {}),
      });
      // 작성 직후 환자 차트의 최근기록·보드 미서명 카운트가 stale 캐시로 누락되지 않도록 무효화
      qc.invalidateQueries({ queryKey: ['tablet-notes', admissionId] });
      qc.invalidateQueries({ queryKey: ['tablet-nursing-board'] });
      router.push(`/tablet/nursing/${admissionId}`);
    } catch (e) {
      setErr((e as { message?: string })?.message ?? '저장 실패. 다시 시도하세요.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <header className="sticky top-0 z-20 bg-white border-b px-4 h-14 flex items-center gap-2">
        <Link href={`/tablet/nursing/${admissionId}`} className="min-h-[44px] inline-flex items-center text-gray-500 text-sm">← 차트</Link>
        <span className="font-semibold text-gray-900 text-sm">간호기록 작성</span>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-400">{currentShift} 근무</span>
      </header>

      <div className="p-3 space-y-3">
        {/* 기록 형식 */}
        <div className="flex gap-1.5">
          {(['SOAP', 'DAR', 'NARRATIVE'] as NoteType[]).map((t) => (
            <button key={t} onClick={() => switchType(t)}
              className={`min-h-[40px] flex-1 rounded-xl text-sm font-medium border ${noteType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600'}`}>
              {t === 'NARRATIVE' ? '서술' : t}
            </button>
          ))}
        </div>

        {/* WeRU.B AI 초안(보조) */}
        <NursingAiDraftPanel admissionId={admissionId} noteType={noteType} onApply={applyAiDraft} />

        {/* 필드 */}
        {fields.map((fld) => (
          <div key={fld.key} className="rounded-2xl border bg-white p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600">{fld.label}</label>
              <DictationButton onText={(t) => appendField(fld.key, t)} />
            </div>
            <textarea
              value={form[fld.key] ?? ''}
              onChange={(e) => setField(fld.key, e.target.value)}
              rows={fld.key === 'focus' ? 1 : 3}
              placeholder="입력 또는 🎙 음성·✦ 초안 적용"
              className="w-full text-[15px] leading-relaxed rounded-lg border border-gray-200 p-2.5 focus:border-indigo-400 focus:outline-none resize-none"
            />
            {fld.phrase && <QuickPhraseChips field={fld.phrase} onInsert={(t) => appendField(fld.key, t)} />}
          </div>
        ))}

        {/* 품질검사(F-4) */}
        <div className="rounded-2xl border bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">기록 품질검사</span>
            <button onClick={runQa} disabled={qaState === 'loading' || !hasContent}
              className="min-h-[36px] px-3 rounded-lg bg-gray-100 text-gray-700 text-xs disabled:opacity-40">
              {qaState === 'loading' ? '검사 중…' : '검사'}
            </button>
          </div>
          {qaState === 'done' && qa && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold text-gray-600">품질 {qa.grade ?? '-'}등급 ({qa.score ?? 0}<Unit>점</Unit>){(qa.issues?.length ?? 0) === 0 && ' · 권고 항목 없음 ✓'}</p>
              <ul className="mt-1 space-y-1">
                {(qa.issues ?? []).map((it, i) => (
                  <li key={i} className={`text-[11px] flex gap-1.5 ${it.level === 'WARNING' ? 'text-rose-600' : 'text-gray-500'}`}>
                    <span>{it.level === 'WARNING' ? '⚠' : 'ℹ'}</span>
                    <span>{it.message}{it.field ? ` (${it.field})` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {qaState === 'done' && !qa && <p className="mt-2 text-[11px] text-gray-400">품질검사 보조 비활성 상태입니다.</p>}
        </div>

        {/* 검토확인 게이트(AI 적용 시) */}
        {aiProvenance && (
          <label className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 text-xs text-gray-700">
            <input type="checkbox" checked={reviewConfirmed} onChange={(e) => setReviewConfirmed(e.target.checked)} className="mt-0.5 w-5 h-5" />
            <span>위 기록({AI_ORIGIN_TEXT} 보조 초안 포함)을 검토했으며, <b>간호사 책임으로 작성·서명</b>합니다.</span>
          </label>
        )}
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
      </div>

      {/* 저장 바 */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t p-3 flex items-center gap-2">
        {blockedByReview && <span className="text-[11px] text-amber-600 flex-1">검토 확인 후 서명할 수 있습니다.</span>}
        {!blockedByReview && <span className="text-[11px] text-gray-400 flex-1">작성=서명(SIGNED). 책임: 간호사.</span>}
        <button onClick={save} disabled={saving || !hasContent || blockedByReview}
          className="min-h-[48px] px-6 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-40">
          {saving ? '저장 중…' : '서명 저장'}
        </button>
      </div>
    </div>
  );
}
