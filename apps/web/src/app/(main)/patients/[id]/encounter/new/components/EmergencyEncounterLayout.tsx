'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface EmergencyEncounterLayoutProps {
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

type TabKey = 'triage' | 'initial' | 'treatment' | 'progress' | 'disposition';

interface ProgressNote {
  id: string;
  timestamp: string;
  note: string;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'triage', label: '트리아지' },
  { key: 'initial', label: '초기 평가' },
  { key: 'treatment', label: '처치' },
  { key: 'progress', label: '경과' },
  { key: 'disposition', label: '처분' },
];

const KTAS_LEVELS = [
  { level: 1, label: 'KTAS 1 - 소생', color: 'bg-red-600 text-white', border: 'border-red-600', ring: 'ring-red-500' },
  { level: 2, label: 'KTAS 2 - 긴급', color: 'bg-orange-500 text-white', border: 'border-orange-500', ring: 'ring-orange-400' },
  { level: 3, label: 'KTAS 3 - 응급', color: 'bg-yellow-400 text-gray-900', border: 'border-yellow-400', ring: 'ring-yellow-300' },
  { level: 4, label: 'KTAS 4 - 준응급', color: 'bg-green-500 text-white', border: 'border-green-500', ring: 'ring-green-400' },
  { level: 5, label: 'KTAS 5 - 비응급', color: 'bg-blue-500 text-white', border: 'border-blue-500', ring: 'ring-blue-400' },
];

const ABCDE_ITEMS = [
  { key: 'airway', label: 'Airway (기도)', desc: '기도 개방 여부' },
  { key: 'breathing', label: 'Breathing (호흡)', desc: '호흡수, 양상, SpO2' },
  { key: 'circulation', label: 'Circulation (순환)', desc: '맥박, 혈압, 피부색' },
  { key: 'disability', label: 'Disability (의식)', desc: 'GCS, 동공 반응' },
  { key: 'exposure', label: 'Exposure (노출)', desc: '체온, 외상 확인' },
];

export function EmergencyEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: EmergencyEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TabKey>('triage');

  // Triage state
  const [ktasLevel, setKtasLevel] = useState<number | null>(null);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [arrivalMode, setArrivalMode] = useState('');
  const [onsetTime, setOnsetTime] = useState('');

  // Initial assessment state
  const [abcde, setAbcde] = useState<Record<string, boolean>>({});
  const [abcdeDetail, setAbcdeDetail] = useState<Record<string, string>>({});
  const [gcsEye, setGcsEye] = useState(4);
  const [gcsVerbal, setGcsVerbal] = useState(5);
  const [gcsMotor, setGcsMotor] = useState(6);
  const [vitals, setVitals] = useState({ bp: '', hr: '', rr: '', spo2: '', temp: '' });

  // Treatment state
  const [treatmentRecord, setTreatmentRecord] = useState('');
  const [medicationLog, setMedicationLog] = useState('');
  const [procedureLog, setProcedureLog] = useState('');

  // Progress state
  const [progressNotes, setProgressNotes] = useState<ProgressNote[]>([]);
  const [newNote, setNewNote] = useState('');

  // Disposition state
  const [disposition, setDisposition] = useState('');
  const [observationHours, setObservationHours] = useState('');
  const [dischargeInstructions, setDischargeInstructions] = useState('');

  const gcsTotal = gcsEye + gcsVerbal + gcsMotor;

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/emergency/exams', {
      patientId, encounterId,
      triage: { ktasLevel, chiefComplaint, arrivalMode, onsetTime },
      assessment: { abcde, abcdeDetail, gcs: { eye: gcsEye, verbal: gcsVerbal, motor: gcsMotor, total: gcsTotal }, vitals },
      treatment: { treatmentRecord, medicationLog, procedureLog },
      progressNotes, disposition: { type: disposition, observationHours, dischargeInstructions },
    }),
    onSuccess: () => toast.success('응급 진료 기록이 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const addProgressNote = () => {
    if (!newNote.trim()) return;
    setProgressNotes((prev) => [
      { id: `pn-${Date.now()}`, timestamp: new Date().toISOString(), note: newNote.trim() },
      ...prev,
    ]);
    setNewNote('');
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => {
    const objective = [treatmentRecord, procedureLog, medicationLog]
      .filter((s) => s && s.trim())
      .join('\n') || undefined;
    return {
      subjective: chiefComplaint.trim() || undefined,
      objective,
      assessment: disposition || undefined,
      plan: dischargeInstructions.trim() || undefined,
    };
  };

  // 응급 환자는 활력징후(혈압·맥박) 필수 — 미입력 시 트리아지 탭으로 이동·차단
  const handleSign = () => {
    if (!vitals.bp.trim() || !vitals.hr.trim()) {
      setActiveTab('triage');
      toast.error('응급 환자는 활력징후(혈압·맥박)가 필수입니다. 트리아지 탭에서 입력하세요.');
      return;
    }
    onSignAndBill(buildSoap());
  };

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

      {/* Tab Content */}
      {activeTab === 'triage' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="트리아지 (KTAS)" /></h3>

          {/* KTAS Level */}
          <div>
            <label className={labelCls}><T k="KTAS 단계" /></label>
            <div className="grid grid-cols-5 gap-2 mt-1">
              {KTAS_LEVELS.map((k) => (
                <button
                  key={k.level}
                  onClick={() => setKtasLevel(k.level)}
                  disabled={!encounterId}
                  className={`px-3 py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50 ${
                    ktasLevel === k.level
                      ? `${k.color} ring-2 ${k.ring} shadow-md scale-105`
                      : `bg-white border-2 ${k.border} text-gray-700 hover:opacity-80`
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {/* Chief Complaint */}
          <div>
            <label className={labelCls}><T k="주호소 (Chief Complaint)" /></label>
            <textarea
              rows={3}
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("환자의 주요 증상을 기술하세요...")}
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Arrival Mode */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}><T k="내원 수단" /></label>
              <div className="flex gap-2 mt-1">
                {['도보', '구급차', '전원'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setArrivalMode(mode)}
                    disabled={!encounterId}
                    className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                      arrivalMode === mode
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}><T k="발생 시각" /></label>
              <input
                type="datetime-local"
                value={onsetTime}
                onChange={(e) => setOnsetTime(e.target.value)}
                disabled={!encounterId}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'initial' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="초기 평가 (Primary Survey)" /></h3>

          {/* ABCDE */}
          <div>
            <label className={labelCls}><T k="ABCDE 평가" /></label>
            <div className="space-y-2 mt-1">
              {ABCDE_ITEMS.map((item) => (
                <label
                  key={item.key}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors ${
                    abcde[item.key] ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={abcde[item.key] || false}
                    onChange={() => setAbcde((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                    disabled={!encounterId}
                    className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-800">{item.label}</span>
                    <span className="text-xs text-gray-400 ml-2">{item.desc}</span>
                    {abcde[item.key] && (
                      <input
                        value={abcdeDetail[item.key] ?? ''}
                        onChange={(e) => setAbcdeDetail(p => ({ ...p, [item.key]: e.target.value }))}
                        placeholder={`${item.label} 세부 소견...`}
                        disabled={!encounterId}
                        className="mt-1 w-full px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white disabled:bg-gray-50"
                      />
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* GCS Calculator */}
          <div className="border border-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700">GCS (Glasgow Coma Scale)</span>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                gcsTotal <= 8 ? 'bg-red-100 text-red-700' : gcsTotal <= 12 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
              }`}>
                합계: {gcsTotal}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Eye (1-4)</label>
                <select value={gcsEye} onChange={(e) => setGcsEye(Number(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value={1}>1 - 무반응</option>
                  <option value={2}>2 - 통증에 개안</option>
                  <option value={3}>3 - 음성에 개안</option>
                  <option value={4}>4 - 자발적 개안</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Verbal (1-5)</label>
                <select value={gcsVerbal} onChange={(e) => setGcsVerbal(Number(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value={1}>1 - 무반응</option>
                  <option value={2}>2 - 이해불가 소리</option>
                  <option value={3}>3 - 부적절한 단어</option>
                  <option value={4}>4 - 혼돈 대화</option>
                  <option value={5}>5 - 지남력 정상</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Motor (1-6)</label>
                <select value={gcsMotor} onChange={(e) => setGcsMotor(Number(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value={1}>1 - 무반응</option>
                  <option value={2}>2 - 신전 반응</option>
                  <option value={3}>3 - 굴곡 반응</option>
                  <option value={4}>4 - 회피 반응</option>
                  <option value={5}>5 - 통증 국소화</option>
                  <option value={6}>6 - 명령 수행</option>
                </select>
              </div>
            </div>
          </div>

          {/* Vitals */}
          <div>
            <label className={labelCls}><T k="바이탈 사인" /> <span className="text-[10px] font-semibold text-red-600"><T k="· 필수(응급)" /></span></label>
            <div className="grid grid-cols-5 gap-3 mt-1">
              <div>
                <label className="text-[10px] text-gray-400"><T k="혈압 (mmHg)" /></label>
                <input value={vitals.bp} onChange={(e) => setVitals((v) => ({ ...v, bp: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder="SBP/DBP" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400"><T k="심박수 (bpm)" /></label>
                <input type="number" value={vitals.hr} onChange={(e) => setVitals((v) => ({ ...v, hr: e.target.value }))} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-gray-400"><T k="호흡수 (/min)" /></label>
                <input type="number" value={vitals.rr} onChange={(e) => setVitals((v) => ({ ...v, rr: e.target.value }))} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-gray-400">SpO2 (%)</label>
                <input type="number" value={vitals.spo2} onChange={(e) => setVitals((v) => ({ ...v, spo2: e.target.value }))} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] text-gray-400"><T k="체온 (C)" /></label>
                <input type="number" step="0.1" value={vitals.temp} onChange={(e) => setVitals((v) => ({ ...v, temp: e.target.value }))} disabled={!encounterId} className={inputCls} />
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'treatment' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="처치 기록" /></h3>
          <div>
            <label className={labelCls}><T k="처치 내용" /></label>
            <textarea
              rows={4}
              value={treatmentRecord}
              onChange={(e) => setTreatmentRecord(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("시행한 처치를 기록하세요...")}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div>
            <label className={labelCls}><T k="투약 기록" /></label>
            <textarea
              rows={3}
              value={medicationLog}
              onChange={(e) => setMedicationLog(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("투약 내역을 기록하세요 (약물명, 용량, 경로, 시간)...")}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div>
            <label className={labelCls}><T k="시술 기록" /></label>
            <textarea
              rows={3}
              value={procedureLog}
              onChange={(e) => setProcedureLog(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("시술 내역을 기록하세요...")}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>
      )}

      {activeTab === 'progress' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="경과 기록" /></h3>

          {/* Add new note */}
          <div className="flex gap-3">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("경과 기록을 입력하세요...")}
              className={`${inputCls} flex-1`}
              onKeyDown={(e) => e.key === 'Enter' && addProgressNote()}
            />
            <button
              onClick={addProgressNote}
              disabled={!encounterId || !newNote.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <T k="추가" />
            </button>
          </div>

          {/* Timeline */}
          {progressNotes.length === 0 ? (
            <EmptyState icon="📝" title="경과 기록이 없습니다" />
          ) : (
            <div className="space-y-3">
              {progressNotes.map((pn) => (
                <div key={pn.id} className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-400" />
                  <div className="flex-1 bg-gray-50 rounded-xl px-4 py-3">
                    <span className="text-[11px] text-gray-400 font-mono">
                      {kdate(pn.timestamp, 'time')}
                    </span>
                    <p className="text-sm text-gray-700 mt-0.5">{pn.note}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'disposition' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="처분" /></h3>

          <div>
            <label className={labelCls}><T k="처분 결정" /></label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {[
                { value: 'admit', label: '입원' },
                { value: 'transfer', label: '전원' },
                { value: 'discharge', label: '귀가' },
                { value: 'death', label: '사망' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDisposition(opt.value)}
                  disabled={!encounterId}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                    disposition === opt.value
                      ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}><T k="관찰 시간 (시간)" /></label>
            <input
              type="number"
              value={observationHours}
              onChange={(e) => setObservationHours(e.target.value)}
              disabled={!encounterId}
              className={inputCls}
              placeholder={tAttr("응급실 체류 시간")}
            />
          </div>

          <div>
            <label className={labelCls}><T k="퇴원 시 주의사항" /></label>
            <textarea
              rows={4}
              value={dischargeInstructions}
              onChange={(e) => setDischargeInstructions(e.target.value)}
              disabled={!encounterId}
              placeholder={tAttr("환자에게 전달할 퇴원 지시사항...")}
              className={`${inputCls} resize-none`}
            />
          </div>
        </div>
      )}

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            {ktasLevel && (
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${KTAS_LEVELS[ktasLevel - 1].color}`}>
                KTAS {ktasLevel}
              </span>
            )}
            {arrivalMode && <span>내원: {arrivalMode}</span>}
            <span>GCS: {gcsTotal}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { saveMutation.mutate(); onSaveDraft(buildSoap()); }}
              disabled={!encounterId || isSaving || saveMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              {saveMutation.isPending ? '저장중...' : '저장 (임시)'}
            </button>
            <button
              onClick={handleSign}
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
