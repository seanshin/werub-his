'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import {
  UNIVERSAL_NURSING_NOTE_TYPES, UNIVERSAL_NURSING_SEVERITIES,
  hasUniversalNursingBody, type UniversalNursingContextType,
} from '@hospital-run/shared';
import { kdate } from '@/lib/ui-settings';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';

/**
 * 🔴 이 화면은 **범용 간호기록(UniversalNursingNote)** 전용이다.
 *    재원(입원) 환자의 간호기록 정본은 `NursingNote`(`/admissions/:id/nursing-notes`) —
 *    `contextType` 이 shared 정본으로 좁혀져 있어 여기로 입원 기록을 보낼 수 없다.
 * 🔴 보내는 키는 **서버 DTO 와 같은 이름**이어야 한다. 예전엔 `spiSituation`… 을 보냈고,
 *    전역 `whitelist:true` 가 그 키를 조용히 지워 **본문 없는 빈 기록**이 200 과 함께 저장됐다.
 *    (기계 대조 가드: apps/api/test/nursing-note/nursing-note-canon.guard.spec.ts)
 */
interface NursingNotePanelProps {
  patientId: string;
  contextType: UniversalNursingContextType;
  contextId: string;
  patientName?: string;
  compact?: boolean;
}

interface VitalSigns {
  bp?: string;
  hr?: number;
  rr?: number;
  spo2?: number;
  bt?: number;
  pain?: number;
}

/** 서버 응답 모양(UniversalNursingNote) 그대로 — 화면이 제 이름을 지어내지 않는다 */
interface NursingNote {
  id: string;
  noteType: string;
  severity?: string | null;
  content?: string | null;
  situation?: string | null;
  background?: string | null;
  assessment?: string | null;
  recommendation?: string | null;
  vitalSigns?: VitalSigns | null;
  nurse?: { familyName?: string | null; givenName?: string | null } | null;
  recordedAt?: string | null;
  createdAt: string;
}

/** 기록 시각 — 임상 시각(recordedAt)이 정본, 없으면 생성 시각 */
const noteAt = (n: NursingNote) => n.recordedAt ?? n.createdAt;
const nurseNameOf = (n: NursingNote) =>
  `${n.nurse?.familyName ?? ''}${n.nurse?.givenName ?? ''}`.trim() || null;
/** SBAR 로 쓰였는가 — 서버에 `mode` 칸이 없다. 채워진 칸으로 판정한다(없는 필드를 읽지 않는다) */
const isSbar = (n: NursingNote) => !!(n.situation || n.background || n.assessment || n.recommendation);

// 어휘 정본은 shared — 화면이 목록을 따로 들고 있으면 시드·DTO 와 조용히 갈라진다
const NOTE_TYPE_LABELS: Record<string, string> = {
  OBSERVATION: '경과 관찰', TREATMENT: '처치', MEDICATION: '투약',
  EDUCATION: '교육', HANDOFF: '인수인계', ASSESSMENT: '평가', INCIDENT: '이상 보고',
};
const NOTE_TYPES = UNIVERSAL_NURSING_NOTE_TYPES.map((value) => ({ value, label: NOTE_TYPE_LABELS[value] ?? value }));

const SEVERITY_LABELS: Record<string, { label: string; dot: string }> = {
  NORMAL: { label: '정상', dot: 'bg-green-500' },
  CAUTION: { label: '주의', dot: 'bg-yellow-400' },
  WARNING: { label: '경고', dot: 'bg-orange-500' },
  CRITICAL: { label: '위급', dot: 'bg-red-600' },
};
const SEVERITY_OPTIONS = UNIVERSAL_NURSING_SEVERITIES.map((value) => ({ value, ...SEVERITY_LABELS[value] }));

const SEVERITY_DOT: Record<string, string> = Object.fromEntries(
  Object.entries(SEVERITY_LABELS).map(([k, v]) => [k, v.dot]),
);

const NOTE_TYPE_LABEL: Record<string, string> = NOTE_TYPE_LABELS;

function formatNoteTime(dt: string) {
  return kdate(new Date(dt), 'time');
}

export default function NursingNotePanel({
  patientId,
  contextType,
  contextId,
  patientName,
  compact = false,
}: NursingNotePanelProps) {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [noteType, setNoteType] = useState('OBSERVATION');
  const [mode, setMode] = useState<'SBAR' | 'FREE'>('FREE');
  const [severity, setSeverity] = useState('NORMAL');
  const [content, setContent] = useState('');
  const [sbar, setSbar] = useState({ situation: '', background: '', assessment: '', recommendation: '' });
  const [vitals, setVitals] = useState({ bp: '', hr: '', rr: '', spo2: '', bt: '', pain: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const queryKey = ['nursing-notes', contextType, contextId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiClient.get<{ data: NursingNote[] }>(`/api/v1/nursing-notes/context/${contextType}/${contextId}`),
    refetchInterval: 10000,
  });

  const _raw = data?.data;
  const notes: NursingNote[] = Array.isArray(_raw) ? _raw : (_raw as unknown as Record<string, unknown>)?.data as NursingNote[] ?? [];
  const sortedNotes = [...notes].sort((a, b) => new Date(noteAt(b)).getTime() - new Date(noteAt(a)).getTime());
  const displayNotes = compact ? sortedNotes.slice(0, 5) : sortedNotes;

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient.post('/api/v1/nursing-notes', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      resetForm();
      setShowModal(false);
    },
    // 🔴 실패를 삼키지 않는다 — 저장 안 된 기록을 저장된 것처럼 두지 않는다
    onError: (e: unknown) => setFormError((e as { message?: string })?.message || tAttr('간호기록 저장에 실패했습니다.')),
  });

  const resetForm = () => {
    setNoteType('OBSERVATION');
    setMode('FREE');
    setSeverity('NORMAL');
    setContent('');
    setSbar({ situation: '', background: '', assessment: '', recommendation: '' });
    setVitals({ bp: '', hr: '', rr: '', spo2: '', bt: '', pain: '' });
    setFormError(null);
  };

  const handleSubmit = () => {
    const vitalSigns: Record<string, unknown> = {};
    if (vitals.bp) vitalSigns.bp = vitals.bp;
    if (vitals.hr) vitalSigns.hr = Number(vitals.hr);
    if (vitals.rr) vitalSigns.rr = Number(vitals.rr);
    if (vitals.spo2) vitalSigns.spo2 = Number(vitals.spo2);
    if (vitals.bt) vitalSigns.bt = Number(vitals.bt);
    if (vitals.pain) vitalSigns.pain = Number(vitals.pain);

    // 🔴 키 이름은 서버 DTO 와 동일해야 한다 — 다르면 whitelist 가 지우고 빈 기록이 저장된다
    const body = mode === 'SBAR'
      ? {
          situation: sbar.situation.trim() || undefined,
          background: sbar.background.trim() || undefined,
          assessment: sbar.assessment.trim() || undefined,
          recommendation: sbar.recommendation.trim() || undefined,
        }
      : { content: content.trim() || undefined };

    // 본문이 비면 보내지 않는다(서버도 400 으로 막지만, 화면이 먼저 말한다)
    if (!hasUniversalNursingBody(body)) {
      setFormError(tAttr('본문을 입력하세요 — SBAR 은 최소 한 칸, 자유 텍스트는 내용이 필요합니다.'));
      return;
    }
    setFormError(null);

    const payload: Record<string, unknown> = {
      patientId,
      contextType,
      contextId,
      noteType,
      severity,
      ...body,
      ...(Object.keys(vitalSigns).length > 0 ? { vitalSigns } : {}),
    };

    createMutation.mutate(payload);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide"><T k="간호 기록" /></h4>
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1 text-[11px] font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + <T k="간호 노트 추가" />
        </button>
      </div>

      {/* Note List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="bg-gray-50 rounded-lg px-3 py-4 border border-dashed border-gray-300 text-center text-xs text-gray-400">
            <T k="로딩 중..." />
          </div>
        ) : displayNotes.length === 0 ? (
          <EmptyState icon="🩺" title="간호 기록이 없습니다" className="bg-gray-50 rounded-lg border border-dashed border-gray-300" />
        ) : (
          displayNotes.map((note) => (
            <div key={note.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5 shadow-sm">
              {/* Header row */}
              <div className="flex items-center gap-2 mb-1">
                {/* 🔴 색만으로 중증도를 말하지 않는다(§4.6) — 의미는 note.severity 에서 가져오고,
                    미기재는 '정상'으로 접지 않는다(미상은 미상으로 말한다) */}
                <span
                  aria-label={`중증도 ${SEVERITY_LABELS[note.severity ?? '']?.label ?? '미기재'}`}
                  title={`중증도 ${SEVERITY_LABELS[note.severity ?? '']?.label ?? '미기재'}`}
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[note.severity ?? ''] || 'bg-gray-400'}`}
                />
                <span className="text-[11px] text-gray-400 font-mono">{formatNoteTime(noteAt(note))}</span>
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">
                  {NOTE_TYPE_LABEL[note.noteType] || note.noteType}
                </span>
                {nurseNameOf(note) && (
                  <span className="text-[10px] text-gray-400 ml-auto">{nurseNameOf(note)}</span>
                )}
              </div>

              {/* SBAR content */}
              {isSbar(note) ? (
                <div className="space-y-1 text-xs">
                  {([
                    ['S', 'text-rose-600', note.situation],
                    ['B', 'text-amber-600', note.background],
                    ['A', 'text-blue-600', note.assessment],
                    ['R', 'text-green-600', note.recommendation],
                  ] as const).map(([k, color, v]) => v ? (
                    <div key={k} className="flex gap-1.5">
                      <span className={`text-[10px] font-bold ${color} w-4 flex-shrink-0`}>{k}</span>
                      <span className="text-gray-700 whitespace-pre-wrap">{v}</span>
                    </div>
                  ) : null)}
                </div>
              ) : note.content ? (
                <p className="text-xs text-gray-700 whitespace-pre-wrap">{note.content}</p>
              ) : (
                // 🔴 본문 없는 기록은 '빈 칸'으로 넘기지 않는다 — 있었던 사실(소실)을 화면이 말한다
                <p className="text-[11px] text-amber-700"><T k="본문이 비어 있는 기록입니다(저장 시 유실 가능성)." /></p>
              )}

              {/* Inline vitals */}
              {note.vitalSigns && (
                // 표시 부품 정본 — truthy 검사가 측정된 0 을 지우던 것 · bp 문자열/hr/bt 별칭은 부품이 읽는다
                <VitalSignsStrip vitals={note.vitalSigns as Record<string, unknown>} keys={['spo2', 'systolicBp', 'heartRate', 'temperature']} className="mt-1.5 text-[10px]" />
              )}
            </div>
          ))
        )}

        {compact && sortedNotes.length > 5 && (
          <p className="text-[10px] text-center text-gray-400">
            외 {sortedNotes.length - 5}건 더 있음
          </p>
        )}
      </div>

      {/* Create Note Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-[520px] max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-base font-bold text-gray-900 mb-1"><T k="간호 노트 추가" /></h3>
            {patientName && (
              <p className="text-sm text-gray-500 mb-4">
                <T k="환자:" /> <span className="font-medium text-gray-900">{patientName}</span>
              </p>
            )}

            {/* Note Type */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block"><T k="기록 유형" /></label>
              <div className="flex flex-wrap gap-1.5">
                {NOTE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setNoteType(t.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      noteType === t.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Toggle */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block"><T k="작성 방식" /></label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('SBAR')}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${
                    mode === 'SBAR' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  SBAR
                </button>
                <button
                  onClick={() => setMode('FREE')}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${
                    mode === 'FREE' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <T k="자유 텍스트" />
                </button>
              </div>
            </div>

            {/* Content */}
            {mode === 'SBAR' ? (
              <div className="space-y-3 mb-4">
                {[
                  { key: 'situation', label: 'S (Situation) — 상황', color: 'border-l-rose-400' },
                  { key: 'background', label: 'B (Background) — 배경', color: 'border-l-amber-400' },
                  { key: 'assessment', label: 'A (Assessment) — 평가', color: 'border-l-blue-400' },
                  { key: 'recommendation', label: 'R (Recommendation) — 권고', color: 'border-l-green-400' },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-gray-600 mb-1 block"><T k={field.label} /></label>
                    <textarea
                      value={sbar[field.key as keyof typeof sbar]}
                      onChange={(e) => setSbar((s) => ({ ...s, [field.key]: e.target.value }))}
                      className={`w-full text-sm border border-gray-200 border-l-4 ${field.color} rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200`}
                      rows={2}
                      placeholder={`${field.label} 내용 입력...`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-600 mb-1 block"><T k="내용" /></label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                  rows={4}
                  placeholder={tAttr('간호 기록 내용을 입력하세요...')}
                />
              </div>
            )}

            {/* Vitals (optional) */}
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block"><T k="활력징후 (선택)" /></label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-gray-400">BP (mmHg)</label>
                  <input
                    value={vitals.bp}
                    onChange={(e) => setVitals((v) => ({ ...v, bp: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    placeholder="120/80"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">HR (bpm)</label>
                  <input
                    value={vitals.hr}
                    onChange={(e) => setVitals((v) => ({ ...v, hr: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    placeholder={tAttr('회/분')}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">RR (/min)</label>
                  <input
                    value={vitals.rr}
                    onChange={(e) => setVitals((v) => ({ ...v, rr: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    placeholder={tAttr('회/분')}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">SpO2 (%)</label>
                  <input
                    value={vitals.spo2}
                    onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    placeholder="%"
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">BT (C)</label>
                  <input
                    value={vitals.bt}
                    onChange={(e) => setVitals((v) => ({ ...v, bt: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    type="number"
                    step="0.1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">Pain (0-10)</label>
                  <input
                    value={vitals.pain}
                    onChange={(e) => setVitals((v) => ({ ...v, pain: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    placeholder="0~10"
                    type="number"
                    min="0"
                    max="10"
                  />
                </div>
              </div>
            </div>

            {/* Severity */}
            <div className="mb-5">
              <label className="text-xs font-medium text-gray-600 mb-1.5 block"><T k="중증도" /></label>
              <div className="flex gap-2">
                {SEVERITY_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSeverity(s.value)}
                    className={`flex items-center gap-1.5 flex-1 px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${
                      severity === s.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${severity === s.value ? 'bg-white' : s.dot}`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {formError && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { resetForm(); setShowModal(false); }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
              >
                <T k="취소" />
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || (mode === 'FREE'
                  ? !content.trim()
                  : !(sbar.situation.trim() || sbar.background.trim() || sbar.assessment.trim() || sbar.recommendation.trim()))}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
              >
                {createMutation.isPending ? <T k="저장 중..." /> : <T k="저장" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
