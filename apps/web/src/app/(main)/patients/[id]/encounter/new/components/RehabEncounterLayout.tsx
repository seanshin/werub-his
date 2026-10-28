'use client';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface RehabEncounterLayoutProps {
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다. 종전엔 진료과 레이아웃에 처방 입력이 없었다 */
  rxSlot?: ReactNode;
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  patient: { familyName?: string; givenName?: string; mrn?: string };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
}

type TabKey = 'soap' | 'functional' | 'plan' | 'progress';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'soap', label: 'SOAP' },
  { key: 'functional', label: '기능 평가' },
  { key: 'plan', label: '치료 계획' },
  { key: 'progress', label: '경과' },
];

const BARTHEL_ITEMS = [
  { key: 'feeding', label: '식사', max: 10 },
  { key: 'bathing', label: '목욕', max: 5 },
  { key: 'grooming', label: '위생', max: 5 },
  { key: 'dressing', label: '옷 입기', max: 10 },
  { key: 'bowels', label: '대변 조절', max: 10 },
  { key: 'bladder', label: '소변 조절', max: 10 },
  { key: 'toilet', label: '화장실 사용', max: 10 },
  { key: 'transfer', label: '이동', max: 15 },
  { key: 'mobility', label: '보행', max: 15 },
  { key: 'stairs', label: '계단', max: 10 },
];

const MMT_GRADES = ['0', '1', '2', '3', '4', '5'];
const MUSCLE_GROUPS = [
  '어깨 굴곡 (L)', '어깨 굴곡 (R)',
  '팔꿈치 굴곡 (L)', '팔꿈치 굴곡 (R)',
  '손목 신전 (L)', '손목 신전 (R)',
  '고관절 굴곡 (L)', '고관절 굴곡 (R)',
  '무릎 신전 (L)', '무릎 신전 (R)',
  '발목 배굴 (L)', '발목 배굴 (R)',
];

const ROM_JOINTS = [
  '경추', '어깨 (L)', '어깨 (R)', '팔꿈치 (L)', '팔꿈치 (R)',
  '고관절 (L)', '고관절 (R)', '무릎 (L)', '무릎 (R)', '발목 (L)', '발목 (R)',
];

const THERAPY_TYPES = ['물리치료 (PT)', '작업치료 (OT)', '언어치료 (ST)', '재활운동'];

interface RehabSession {
  id: string;
  date: string;
  type: string;
  therapist: string;
  notes: string;
  rating: number;
}

interface TherapyPlan {
  id: string;
  type: string;
  frequency: number;
  duration: number;
  goals: string;
}

export function RehabEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: RehabEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TabKey>('soap');

  // SOAP
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });

  // Functional Assessment
  const [barthelScores, setBarthelScores] = useState<Record<string, number>>(
    Object.fromEntries(BARTHEL_ITEMS.map((b) => [b.key, 0])),
  );
  const [fimScore, setFimScore] = useState('');
  const [mmtGrades, setMmtGrades] = useState<Record<string, string>>(
    Object.fromEntries(MUSCLE_GROUPS.map((g) => [g, ''])),
  );
  const [romValues, setRomValues] = useState<Record<string, string>>(
    Object.fromEntries(ROM_JOINTS.map((j) => [j, ''])),
  );

  const barthelTotal = useMemo(() => Object.values(barthelScores).reduce((sum, v) => sum + v, 0), [barthelScores]);

  // Plan
  const [plans, setPlans] = useState<TherapyPlan[]>([]);
  const [newPlan, setNewPlan] = useState({ type: THERAPY_TYPES[0], frequency: 3, duration: 30, goals: '' });

  const addPlan = () => {
    if (!newPlan.goals.trim()) return;
    setPlans((prev) => [...prev, { ...newPlan, id: `plan-${Date.now()}` }]);
    setNewPlan({ type: THERAPY_TYPES[0], frequency: 3, duration: 30, goals: '' });
  };

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/rehab/exams', {
      patientId, encounterId, soap,
      functionalAssessment: { barthelScores, barthelTotal, fimScore, mmtGrades, romValues },
      therapyPlans: plans,
    }),
    onSuccess: () => toast.success('재활의학 진료 기록이 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  // Progress
  const [sessions, setSessions] = useState<RehabSession[]>([]);
  const [newSession, setNewSession] = useState({ type: THERAPY_TYPES[0], therapist: '', notes: '', rating: 3 });

  const addSession = () => {
    if (!newSession.notes.trim()) return;
    setSessions((prev) => [
      { ...newSession, id: `s-${Date.now()}`, date: new Date().toISOString() },
      ...prev,
    ]);
    setNewSession({ type: THERAPY_TYPES[0], therapist: '', notes: '', rating: 3 });
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-3">
        <div className="flex gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* SOAP */}
      {activeTab === 'soap' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900"><T k="SOAP 기록" /></h3>
          {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
            <div key={field}>
              <label className={labelCls}>
                {field === 'subjective' ? 'S (주관적)' : field === 'objective' ? 'O (객관적)' : field === 'assessment' ? 'A (평가)' : 'P (계획)'}
              </label>
              <textarea
                rows={3}
                value={soap[field]}
                onChange={(e) => setSoap((s) => ({ ...s, [field]: e.target.value }))}
                disabled={!encounterId}
                className={`${inputCls} resize-none`}
                placeholder={`${field === 'subjective' ? '환자 호소, 통증 부위/정도' : field === 'objective' ? '이학적 소견, ROM, MMT' : field === 'assessment' ? '기능 수준 평가' : '재활 치료 계획'}을 입력하세요...`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Functional Assessment */}
      {activeTab === 'functional' && (
        <div className="space-y-4">
          {/* Barthel Index */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Barthel Index</h3>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                barthelTotal >= 80 ? 'bg-green-100 text-green-700' : barthelTotal >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
              }`}>
                합계: {barthelTotal}/100
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {BARTHEL_ITEMS.map((item) => (
                <div key={item.key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-gray-700">{item.label} (0-{item.max})</span>
                  <input
                    type="number"
                    min={0}
                    max={item.max}
                    value={barthelScores[item.key]}
                    onChange={(e) => {
                      const val = Math.min(item.max, Math.max(0, Number(e.target.value) || 0));
                      setBarthelScores((prev) => ({ ...prev, [item.key]: val }));
                    }}
                    disabled={!encounterId}
                    className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center disabled:bg-gray-100"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* FIM */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-3">FIM Score</h3>
            <div>
              <label className={labelCls}><T k="FIM 총점 (18-126)" /></label>
              <input type="number" min={18} max={126} value={fimScore} onChange={(e) => setFimScore(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="18-126" />
            </div>
          </div>

          {/* MMT */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
            <h3 className="font-semibold text-gray-900"><T k="MMT (도수근력검사)" /></h3>
            <div className="grid grid-cols-2 gap-2">
              {MUSCLE_GROUPS.map((group) => (
                <div key={group} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-gray-700">{group}</span>
                  <select
                    value={mmtGrades[group]}
                    onChange={(e) => setMmtGrades((prev) => ({ ...prev, [group]: e.target.value }))}
                    disabled={!encounterId}
                    className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-center disabled:bg-gray-100"
                  >
                    <option value="">-</option>
                    {MMT_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* ROM */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
            <h3 className="font-semibold text-gray-900"><T k="ROM (관절가동범위)" /></h3>
            <div className="grid grid-cols-2 gap-2">
              {ROM_JOINTS.map((joint) => (
                <div key={joint} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs font-medium text-gray-700">{joint}</span>
                  <input
                    value={romValues[joint]}
                    onChange={(e) => setRomValues((prev) => ({ ...prev, [joint]: e.target.value }))}
                    disabled={!encounterId}
                    className="w-24 px-2 py-1 border border-gray-200 rounded text-sm text-center disabled:bg-gray-100"
                    placeholder={tAttr("예: 0-120")}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Plan */}
      {activeTab === 'plan' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="치료 계획" /></h3>

          {/* New Plan */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}><T k="치료 유형" /></label>
                <select value={newPlan.type} onChange={(e) => setNewPlan((p) => ({ ...p, type: e.target.value }))} disabled={!encounterId} className={inputCls}>
                  {THERAPY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="빈도 (주 N회)" /></label>
                <input type="number" min={1} max={7} value={newPlan.frequency} onChange={(e) => setNewPlan((p) => ({ ...p, frequency: Number(e.target.value) }))} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="시간 (분)" /></label>
                <input type="number" min={10} step={5} value={newPlan.duration} onChange={(e) => setNewPlan((p) => ({ ...p, duration: Number(e.target.value) }))} disabled={!encounterId} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}><T k="치료 목표" /></label>
              <textarea
                rows={2}
                value={newPlan.goals}
                onChange={(e) => setNewPlan((p) => ({ ...p, goals: e.target.value }))}
                disabled={!encounterId}
                className={`${inputCls} resize-none`}
                placeholder={tAttr("치료 목표를 입력하세요...")}
              />
            </div>
            <button
              onClick={addPlan}
              disabled={!encounterId || !newPlan.goals.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              <T k="계획 추가" />
            </button>
          </div>

          {/* Plan List */}
          {plans.length === 0 ? (
            <EmptyState icon="📋" title="등록된 치료 계획이 없습니다" />
          ) : (
            <div className="space-y-2">
              {plans.map((p) => (
                <div key={p.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{p.type}</span>
                    <span className="text-xs text-gray-500">주 {p.frequency}<Unit>회</Unit> / {p.duration}<Unit>분</Unit></span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{p.goals}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {activeTab === 'progress' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="재활 치료 기록" /></h3>

          {/* New Session */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}><T k="치료 유형" /></label>
                <select value={newSession.type} onChange={(e) => setNewSession((s) => ({ ...s, type: e.target.value }))} disabled={!encounterId} className={inputCls}>
                  {THERAPY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="치료사" /></label>
                <input value={newSession.therapist} onChange={(e) => setNewSession((s) => ({ ...s, therapist: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("치료사명")} />
              </div>
            </div>
            <div>
              <label className={labelCls}><T k="치료 내용" /></label>
              <textarea
                rows={2}
                value={newSession.notes}
                onChange={(e) => setNewSession((s) => ({ ...s, notes: e.target.value }))}
                disabled={!encounterId}
                className={`${inputCls} resize-none`}
                placeholder={tAttr("치료 내용을 기록하세요...")}
              />
            </div>
            <div>
              <label className={labelCls}><T k="진행 평가" /></label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setNewSession((s) => ({ ...s, rating: star }))}
                    disabled={!encounterId}
                    className={`w-8 h-8 rounded text-sm transition-colors disabled:opacity-50 ${
                      star <= newSession.rating ? 'bg-yellow-100 text-yellow-500' : 'bg-gray-100 text-gray-300'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={addSession}
              disabled={!encounterId || !newSession.notes.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              <T k="기록 추가" />
            </button>
          </div>

          {/* Session List */}
          {sessions.length === 0 ? (
            <EmptyState icon="📝" title="재활 치료 기록이 없습니다" />
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{s.type}</span>
                      {s.therapist && <span className="text-xs text-gray-400">({s.therapist})</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-yellow-500">{'★'.repeat(s.rating)}{'☆'.repeat(5 - s.rating)}</span>
                      <span className="text-[11px] text-gray-400 font-mono">
                        {kdate(new Date(s.date))}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{s.notes}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Barthel: {barthelTotal}/100</span>
            {fimScore && <span>| FIM: {fimScore}</span>}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { saveMutation.mutate(); onSaveDraft(soap); }}
              disabled={!encounterId || isSaving || saveMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
            </button>
            <button
              onClick={() => onSignAndBill(soap)}
              disabled={!encounterId || isSigning}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
