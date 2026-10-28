'use client';
import { NurseOnlyGuard } from '@/components/nursing/NurseOnlyGuard';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import NursingAiDraftPanel, { type NursingDraftProvenance } from '@/components/ai/NursingAiDraftPanel';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { useShiftBoundaries, shiftOf } from '@/lib/shift';

const SHIFT_LABEL: Record<string, { label: string; short: string; cls: string; border: string }> = {
  DAY: { label: 'D (주간)', short: 'Day', cls: 'bg-amber-50 text-amber-700', border: 'border-l-amber-400' },
  EVENING: { label: 'E (준야)', short: 'Evening', cls: 'bg-blue-50 text-blue-700', border: 'border-l-blue-400' },
  NIGHT: { label: 'N (심야)', short: 'Night', cls: 'bg-purple-50 text-purple-700', border: 'border-l-purple-400' },
};

const FOCUS_COLORS: Record<string, string> = {
  '통증': 'bg-red-100 text-red-700',
  '발열': 'bg-orange-100 text-orange-700',
  '수술': 'bg-violet-100 text-violet-700',
  '호흡': 'bg-cyan-100 text-cyan-700',
  '낙상': 'bg-amber-100 text-amber-700',
  '감염': 'bg-rose-100 text-rose-700',
  '영양': 'bg-green-100 text-green-700',
  '배뇨': 'bg-sky-100 text-sky-700',
  '피부': 'bg-pink-100 text-pink-700',
  '활력': 'bg-teal-100 text-teal-700',
};

function getFocusBadgeColor(focus: string): string {
  for (const [keyword, cls] of Object.entries(FOCUS_COLORS)) {
    if (focus.includes(keyword)) return cls;
  }
  return 'bg-indigo-100 text-indigo-700';
}

interface NursingNote {
  id: string;
  noteType: string;
  shiftType: string;
  focus?: string;
  data?: string;
  action?: string;
  response?: string;
  content?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  education?: string;
  recordedAt: string;
  status?: string;
  signedBy?: string;
  signedAt?: string;
  aiAssisted?: boolean;
  nurse?: { familyName: string; givenName: string };
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: '임시', cls: 'bg-gray-100 text-gray-500' },
  SIGNED: { label: '서명완료', cls: 'bg-emerald-100 text-emerald-700' },
  AMENDED: { label: '정정됨(이전본)', cls: 'bg-amber-100 text-amber-700' },
};

interface NursingNoteFormData {
  noteType: string;
  focus: string;
  data: string;
  action: string;
  response: string;
  content: string;
  shiftType: string;
}

interface NursingNoteListResponse {
  data: NursingNote[];
}

export default function NursingNotesPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [shiftFilter, setShiftFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nursing-notes', admissionId, dateFilter, shiftFilter],
    queryFn: () => apiClient.get<{ data: NursingNote[] }>(`/api/v1/admissions/${admissionId}/nursing-notes`, {
      date: dateFilter || undefined,
      shiftType: shiftFilter || undefined,
    }),
  });

  const [noteMode, setNoteMode] = useState<'DAR' | 'SBAR' | 'SOAP' | 'DARE'>('DAR');
  // 🔴 (2026-10-07) 근무조가 'DAY' 고정이라 밤번 기록이 주간으로 저장될 수 있었다 — 병원 근무조 경계(설정 정본)로 지금 근무조
  const shiftBoundaries = useShiftBoundaries();
  const nowShift = () => shiftOf(new Date(), shiftBoundaries);
  const [form, setForm] = useState({ noteType: 'DAR' as string, focus: '', data: '', action: '', response: '', content: '', shiftType: nowShift() as string, subjective: '', objective: '', assessment: '', plan: '', education: '' });

  const [amendId, setAmendId] = useState<string | null>(null);
  // AI 보조: 적용된 초안의 프로비넌스(있으면 저장 시 동봉·aiAssisted) + 검토확인 게이트
  const [aiProvenance, setAiProvenance] = useState<NursingDraftProvenance | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const resetForm = () => { setShowForm(false); setAmendId(null); setAiProvenance(null); setReviewConfirmed(false); setQa(null); setForm({ noteType: 'DAR', focus: '', data: '', action: '', response: '', content: '', shiftType: nowShift(), subjective: '', objective: '', assessment: '', plan: '', education: '' }); };

  // AI 초안 적용 — 반환 draft 키가 폼 필드명과 일치하므로 non-null 만 merge. 프로비넌스 보관·검토확인 초기화.
  const applyAiDraft = (draft: Record<string, string | null>, provenance: NursingDraftProvenance) => {
    setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) }));
    setAiProvenance(provenance);
    setReviewConfirmed(false);
  };

  const createMutation = useMutation({
    mutationFn: (d: NursingNoteFormData) => apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes`, { ...d, ...(aiProvenance ? { aiProvenance } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nursing-notes', admissionId] }); resetForm(); },
  });

  // F-4 작성 중 품질검사(저장 전·인라인·차단 아님). 게이트 OFF면 enabled=false → 미표시.
  const [qa, setQa] = useState<{ score: number; grade: string; issues: { level: string; code: string; field?: string; message: string }[] } | null>(null);
  const qaMutation = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes/qa-check`, form),
    onSuccess: (res) => {
      const d = ((res as { data?: { data?: { enabled: boolean; score: number; grade: string; issues: { level: string; code: string; field?: string; message: string }[] } } })?.data?.data) ?? (res as { data?: { enabled: boolean; score: number; grade: string; issues: { level: string; code: string; field?: string; message: string }[] } })?.data;
      setQa(d?.enabled ? { score: d.score, grade: d.grade, issues: d.issues } : null);
    },
  });

  // 서명: DRAFT → SIGNED
  const signMutation = useMutation({
    mutationFn: (noteId: string) => apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes/${noteId}/sign`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nursing-notes', admissionId] }),
  });
  // 정정: 원본 AMENDED + 정정본 SIGNED 신규
  const amendMutation = useMutation({
    mutationFn: (d: NursingNoteFormData) => apiClient.post(`/api/v1/admissions/${admissionId}/nursing-notes/${amendId}/amend`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nursing-notes', admissionId] }); resetForm(); },
  });

  // 정정 시작: 원본 내용 프리필 + 폼 열기
  const startAmend = (n: NursingNote) => {
    setAmendId(n.id);
    setNoteMode((n.noteType === 'SBAR' ? 'SBAR' : n.noteType === 'SOAP' ? 'SOAP' : n.noteType === 'DARE' ? 'DARE' : 'DAR') as 'DAR' | 'SBAR' | 'SOAP' | 'DARE');
    // 전체 필드 프리필(SOAP/DARE 구조화 필드 포함) — 이전 폼 잔여값 누출 방지(non-spread 명시 설정)
    setForm({ noteType: n.noteType, focus: n.focus ?? '', data: n.data ?? '', action: n.action ?? '', response: n.response ?? '', content: n.content ?? '', shiftType: n.shiftType, subjective: n.subjective ?? '', objective: n.objective ?? '', assessment: n.assessment ?? '', plan: n.plan ?? '', education: n.education ?? '' });
    setShowForm(true);
  };

  const _notesRaw = data?.data;
  const notes = Array.isArray(_notesRaw) ? _notesRaw : (_notesRaw as NursingNoteListResponse | undefined)?.data ?? [];

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/inpatient" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="입원 목록" />
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="간호일지" /></h1>
        <div className="flex gap-2">
          <Link href={`/inpatient/${admissionId}/nursing/handoff`} className="px-3 py-2 bg-amber-50 text-amber-700 text-sm rounded-lg hover:bg-amber-100"><T k="인수인계 (SBAR)" /></Link>
          <button onClick={() => (showForm ? resetForm() : setShowForm(true))} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            {showForm ? <T k="취소" /> : <>+ <T k="기록 작성" /></>}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        <div className="flex gap-1">
          {['', 'DAY', 'EVENING', 'NIGHT'].map(s => {
            const cfg = s ? SHIFT_LABEL[s] : null;
            return (
              <button key={s} onClick={() => setShiftFilter(s)} className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${shiftFilter === s ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                <T k={s ? (cfg?.label ?? '') : '전체'} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          {amendId && (
            <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              ✏️ <T k="정정 모드 — 원본은 '정정됨(이전본)'으로 보존되고, 수정 내용이 새 서명본으로 기록됩니다." />
            </div>
          )}
          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            {(['DAR', 'SOAP', 'DARE', 'SBAR'] as const).map(mode => (
              <button key={mode} onClick={() => { setNoteMode(mode); setForm(f => ({ ...f, noteType: mode })); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${noteMode === mode ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {mode}
              </button>
            ))}
            {/* SBAR은 4종 포맷 버튼에 포함됨 */}
          </div>

          {/* F-1 AI 근거기반 초안(WeRU.B) — 정정 모드 아닐 때만 */}
          {!amendId && (
            <NursingAiDraftPanel admissionId={admissionId} noteType={noteMode} onApply={applyAiDraft} />
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="근무조" /></label>
              <select value={form.shiftType} onChange={e => setForm(f => ({ ...f, shiftType: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="DAY">{tAttr('D (주간)')}</option>
                <option value="EVENING">{tAttr('E (준야)')}</option>
                <option value="NIGHT">{tAttr('N (심야)')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k={noteMode === 'DAR' ? 'Focus (초점)' : 'S - Situation (상황)'} /></label>
              <input value={form.focus} onChange={e => setForm(f => ({ ...f, focus: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                placeholder={tAttr(noteMode === 'DAR' ? '통증, 발열, 수술 후 관리...' : '환자 현재 상황 요약')} />
            </div>
          </div>

          {noteMode === 'SOAP' ? (
            <>
              <div><label className="block text-xs font-medium text-blue-600 mb-1"><T k="S (Subjective) - 주관적" /></label>
                <textarea value={form.subjective} onChange={e => setForm(f => ({ ...f, subjective: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-blue-50/30" placeholder={tAttr('환자가 호소하는 증상...')} /></div>
              <div><label className="block text-xs font-medium text-emerald-600 mb-1"><T k="O (Objective) - 객관적" /></label>
                <textarea value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm bg-emerald-50/30" placeholder={tAttr('바이탈, NRS, 관찰 소견...')} /></div>
              <div><label className="block text-xs font-medium text-amber-600 mb-1"><T k="A (Assessment) - 간호 판단" /></label>
                <textarea value={form.assessment} onChange={e => setForm(f => ({ ...f, assessment: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-amber-50/30" placeholder={tAttr('간호 판단...')} /></div>
              <div><label className="block text-xs font-medium text-purple-600 mb-1"><T k="P (Plan) - 간호 계획" /></label>
                <textarea value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-purple-50/30" placeholder={tAttr('계획 및 다음 조치...')} /></div>
            </>
          ) : noteMode === 'DARE' ? (
            <>
              <div><label className="block text-xs font-medium text-blue-600 mb-1"><T k="D (Data) - 상황/근거" /></label>
                <textarea value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-blue-50/30" placeholder={tAttr('처치 상황, 근거...')} /></div>
              <div><label className="block text-xs font-medium text-emerald-600 mb-1"><T k="A (Action) - 수행 내용" /></label>
                <textarea value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-sm bg-emerald-50/30" placeholder={tAttr('수행한 처치 내용...')} /></div>
              <div><label className="block text-xs font-medium text-amber-600 mb-1"><T k="R (Response) - 환자 반응" /></label>
                <textarea value={form.response} onChange={e => setForm(f => ({ ...f, response: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-amber-50/30" placeholder={tAttr('환자 반응...')} /></div>
              <div><label className="block text-xs font-medium text-purple-600 mb-1"><T k="E (Education) - 환자 교육" /></label>
                <textarea value={form.education} onChange={e => setForm(f => ({ ...f, education: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-purple-200 rounded-lg text-sm bg-purple-50/30" placeholder={tAttr('환자/보호자 교육 내용...')} /></div>
            </>
          ) : noteMode === 'DAR' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="D (Data) - 자료" /></label>
                <textarea value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('주관적/객관적 자료...')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="A (Action) - 간호중재" /></label>
                <textarea value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('시행한 간호중재...')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="R (Response) - 반응/평가" /></label>
                <textarea value={form.response} onChange={e => setForm(f => ({ ...f, response: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('환자 반응 및 평가...')} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="B (Background) - 배경" /></label>
                <textarea value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('진단명, 입원일, 주요 기왕력, 현재 치료...')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="A (Assessment) - 평가" /></label>
                <textarea value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('바이탈 변화, 의식 상태, 간호 판단...')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="R (Recommendation) - 제안" /></label>
                <textarea value={form.response} onChange={e => setForm(f => ({ ...f, response: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('필요한 처치, 검사, 의사 보고 사항...')} />
              </div>
            </>
          )}

          {/* F-4 품질검사(저장 전 권고·차단 아님) */}
          <div>
            <button type="button" onClick={() => qaMutation.mutate()} disabled={qaMutation.isPending}
              className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-xs hover:bg-amber-50 disabled:opacity-50">
              {qaMutation.isPending ? <T k="검사 중…" /> : <>✦ <T k="품질검사" /></>}
            </button>
            {qa && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800">품질 {qa.grade}등급 ({qa.score}<Unit>점</Unit>) {qa.issues.length === 0 && <>· <T k="권고 항목 없음" /> ✓</>}</p>
                {qa.issues.map((i, idx) => (
                  <p key={idx} className={`text-[11px] ${i.level === 'WARNING' ? 'text-rose-600' : 'text-gray-500'}`}>
                    {i.level === 'WARNING' ? '⚠' : 'ℹ'} {i.message}{i.field ? ` (${i.field})` : ''}
                  </p>
                ))}
                <p className="text-[10px] text-gray-400"><T k="권고일 뿐 저장을 막지 않습니다." /></p>
              </div>
            )}
          </div>

          {/* 검토확인 게이트 — AI 초안 적용 시 서명/저장 전 필수(JCI MOI.11.1.1 blind acceptance 차단) */}
          {aiProvenance && (
            <label className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 cursor-pointer">
              <input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} className="mt-0.5" />
              <span>위 기록({AI_ORIGIN_TEXT} 보조 초안 포함)을 검토했으며, <b>간호사 책임으로 작성·서명</b>합니다.</span>
            </label>
          )}

          <button
            onClick={() => (amendId ? amendMutation.mutate(form) : createMutation.mutate(form))}
            disabled={createMutation.isPending || amendMutation.isPending || (!!aiProvenance && !reviewConfirmed)}
            className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <T k={createMutation.isPending || amendMutation.isPending ? '저장중...' : amendId ? '정정 저장' : '저장'} />
          </button>
          {aiProvenance && !reviewConfirmed && (
            <p className="text-[11px] text-amber-600 mt-1">{AI_ORIGIN_TEXT} 보조 초안은 검토 확인 후 저장할 수 있습니다.</p>
          )}
        </div>
      )}

      {/* Notes List - Focus/DAR Card Style */}
      <div className="space-y-3">
        {isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse" />
                <div className="h-5 w-10 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                <div className="ml-auto h-4 w-24 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="space-y-2 pl-3">
                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-gray-100 rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>
          ))
        ) : notes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-16 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </div>
              <div>
                <p className="text-gray-900 font-semibold"><T k="간호 기록이 없습니다" /></p>
                <p className="text-sm text-gray-500 mt-1"><T k='상단의 "+ 기록 작성" 버튼으로 간호 기록을 시작하세요.' /></p>
                <p className="text-xs text-gray-400 mt-0.5"><T k="Focus Charting(DAR) 또는 SBAR 형식을 선택할 수 있습니다." /></p>
              </div>
            </div>
          </div>
        ) : (
          notes.map((n: NursingNote) => {
            const shift = SHIFT_LABEL[n.shiftType] ?? SHIFT_LABEL.DAY;
            const isDAR = n.noteType !== 'SBAR';
            const focusBadgeColor = n.focus ? getFocusBadgeColor(n.focus) : '';

            return (
              <div key={n.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden border-l-4 ${shift.border}`}>
                {/* Header */}
                <div className="px-5 pt-4 pb-2 flex items-center gap-2 flex-wrap">
                  {n.focus && (
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${focusBadgeColor}`}>
                      {isDAR ? n.focus : `S: ${n.focus}`}
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${n.noteType === 'SBAR' ? 'bg-rose-50 text-rose-700' : 'bg-gray-100 text-gray-600'}`}>
                    {n.noteType || 'DAR'}
                  </span>
                  {n.aiAssisted && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-amber-100 text-amber-700" title="WeRU.B AI 보조로 작성(검토·서명: 간호사)">✦ {AI_ORIGIN_TEXT} 보조</span>
                  )}
                  <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-400">
                    {n.status && STATUS_BADGE[n.status] && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_BADGE[n.status].cls}`}><T k={STATUS_BADGE[n.status].label} /></span>
                    )}
                    <span>{format(new Date(n.recordedAt), 'MM/dd HH:mm')}</span>
                    <span>{n.nurse?.familyName}{n.nurse?.givenName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${shift.cls}`}>{shift.short}</span>
                    {n.status === 'DRAFT' && (
                      <button onClick={() => signMutation.mutate(n.id)} disabled={signMutation.isPending} className="min-h-[44px] px-3 py-2 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"><T k="서명" /></button>
                    )}
                    {n.status === 'SIGNED' && (
                      <button onClick={() => startAmend(n)} className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-medium hover:bg-amber-600 whitespace-nowrap"><T k="정정" /></button>
                    )}
                  </div>
                </div>

                {/* SOAP / DAR / SBAR Content */}
                <div className="px-5 pb-4 space-y-1.5">
                  {n.noteType === 'SOAP' ? (
                    <>
                      {[['S', n.subjective, 'bg-blue-100 text-blue-700'], ['O', n.objective, 'bg-emerald-100 text-emerald-700'], ['A', n.assessment, 'bg-amber-100 text-amber-700'], ['P', n.plan, 'bg-purple-100 text-purple-700']]
                        .filter(([, v]) => v).map(([label, v, cls]) => (
                          <div key={label as string} className="flex gap-2">
                            <span className={`flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${cls}`}>{label}</span>
                            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{v}</p>
                          </div>
                        ))}
                    </>
                  ) : isDAR ? (
                    <>
                      {n.data && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">D</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.data}</p>
                        </div>
                      )}
                      {n.action && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center justify-center">A</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.action}</p>
                        </div>
                      )}
                      {n.response && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">R</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.response}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {n.data && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold flex items-center justify-center">B</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.data}</p>
                        </div>
                      )}
                      {n.action && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">A</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.action}</p>
                        </div>
                      )}
                      {n.response && (
                        <div className="flex gap-2">
                          <span className="flex-shrink-0 w-5 h-5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">R</span>
                          <p className="text-sm text-gray-700 leading-relaxed">{n.response}</p>
                        </div>
                      )}
                    </>
                  )}
                  {n.content && <p className="text-xs text-gray-500 mt-1 pl-7">{n.content}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
