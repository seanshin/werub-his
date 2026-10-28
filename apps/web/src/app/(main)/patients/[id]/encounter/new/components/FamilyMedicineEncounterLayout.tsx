'use client';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface FamilyMedicineEncounterLayoutProps {
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

type TabKey = 'soap' | 'checkup' | 'lifestyle' | 'prevention';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'soap', label: 'SOAP + 진찰' },
  { key: 'checkup', label: '건강검진' },
  { key: 'lifestyle', label: '생활습관' },
  { key: 'prevention', label: '예방의학' },
];

const CANCER_SCREENINGS = [
  { key: 'gastric', label: '위암', method: '위내시경' },
  { key: 'colon', label: '대장암', method: '분변잠혈/대장내시경' },
  { key: 'liver', label: '간암', method: '초음파 + AFP' },
  { key: 'breast', label: '유방암', method: '유방촬영' },
  { key: 'cervical', label: '자궁경부암', method: '세포검사' },
  { key: 'lung', label: '폐암', method: 'LDCT' },
];

export function FamilyMedicineEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: FamilyMedicineEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TabKey>('soap');

  // SOAP state
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [vitalsDisplay, setVitalsDisplay] = useState({ bp: '', hr: '', temp: '', spo2: '' });

  // Checkup state
  const [checkup, setCheckup] = useState({
    height: '', weight: '', waist: '',
    bpSys: '', bpDia: '',
    visionL: '', visionR: '',
    hearingL: '', hearingR: '',
    bloodSummary: '', urineSummary: '', chestXray: '',
    grade: '' as '' | 'A' | 'B' | 'C',
  });

  const bmi = useMemo(() => {
    const h = parseFloat(checkup.height);
    const w = parseFloat(checkup.weight);
    if (!h || !w || h === 0) return null;
    return (w / ((h / 100) * (h / 100))).toFixed(1);
  }, [checkup.height, checkup.weight]);

  // Lifestyle state
  const [smoking, setSmoking] = useState({ status: '', packYears: '' });
  const [auditC, setAuditC] = useState({ q1: 0, q2: 0, q3: 0 });
  const [exercise, setExercise] = useState({ frequency: '', duration: '' });
  const [dietRating, setDietRating] = useState(0);
  const [sleep, setSleep] = useState({ hours: '', quality: '' });

  const auditCTotal = auditC.q1 + auditC.q2 + auditC.q3;

  // Prevention state
  const [screenings, setScreenings] = useState<Record<string, { lastDate: string; result: string; nextDue: string }>>(
    Object.fromEntries(CANCER_SCREENINGS.map((s) => [s.key, { lastDate: '', result: '', nextDue: '' }])),
  );

  const saveMutation = useMutation({
    mutationFn: () => apiClient.post('/api/v1/family-medicine/exams', {
      patientId, encounterId,
      // BMI 는 서버가 체중·신장에서 계산한다(2026-10-10) — 화면 값은 미리보기일 뿐 보내지 않는다
      soap, vitals: vitalsDisplay, checkup,
      lifestyle: { smoking, auditC: { ...auditC, total: auditCTotal }, exercise, dietRating, sleep },
      screenings,
    }),
    onSuccess: () => toast.success('가정의학 진료 기록이 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

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

      {/* SOAP + Vitals */}
      {activeTab === 'soap' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900"><T k="SOAP 기록" /></h3>
            {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
              <div key={field}>
                <label className={labelCls}>{field === 'subjective' ? 'S (주관적)' : field === 'objective' ? 'O (객관적)' : field === 'assessment' ? 'A (평가)' : 'P (계획)'}</label>
                <textarea
                  rows={3}
                  value={soap[field]}
                  onChange={(e) => setSoap((s) => ({ ...s, [field]: e.target.value }))}
                  disabled={!encounterId}
                  className={`${inputCls} resize-none`}
                  placeholder={`${field === 'subjective' ? '환자 호소' : field === 'objective' ? '이학적 소견, 검사 결과' : field === 'assessment' ? '진단 및 평가' : '치료 계획'}을 입력하세요...`}
                />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900"><T k="바이탈" /></h3>
            <div className="space-y-3">
              <div><label className={labelCls}><T k="혈압 (mmHg)" /></label><input value={vitalsDisplay.bp} onChange={(e) => setVitalsDisplay((v) => ({ ...v, bp: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder="SBP/DBP" /></div>
              <div><label className={labelCls}><T k="심박수 (bpm)" /></label><input value={vitalsDisplay.hr} onChange={(e) => setVitalsDisplay((v) => ({ ...v, hr: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              <div><label className={labelCls}><T k="체온 (C)" /></label><input value={vitalsDisplay.temp} onChange={(e) => setVitalsDisplay((v) => ({ ...v, temp: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              <div><label className={labelCls}>SpO2 (%)</label><input value={vitalsDisplay.spo2} onChange={(e) => setVitalsDisplay((v) => ({ ...v, spo2: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
            </div>
          </div>
        </div>
      )}

      {/* Checkup */}
      {activeTab === 'checkup' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="건강검진 결과" /></h3>

          {/* 신체계측 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="신체계측" /></p>
            <div className="grid grid-cols-4 gap-3">
              <div><label className={labelCls}><T k="신장 (cm)" /></label><input type="number" step="0.1" value={checkup.height} onChange={(e) => setCheckup((c) => ({ ...c, height: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              <div><label className={labelCls}><T k="체중 (kg)" /></label><input type="number" step="0.1" value={checkup.weight} onChange={(e) => setCheckup((c) => ({ ...c, weight: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              <div>
                <label className={labelCls}>BMI</label>
                <div className={`px-3 py-2 border border-gray-200 rounded-lg text-sm ${bmi ? 'bg-blue-50 font-semibold text-blue-700' : 'bg-gray-50 text-gray-400'}`}>
                  {bmi ?? '자동 계산'}
                </div>
              </div>
              <div><label className={labelCls}><T k="허리둘레 (cm)" /></label><input type="number" step="0.1" value={checkup.waist} onChange={(e) => setCheckup((c) => ({ ...c, waist: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
            </div>
          </div>

          {/* 혈압 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="혈압" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}><T k="수축기 (mmHg)" /></label><input type="number" value={checkup.bpSys} onChange={(e) => setCheckup((c) => ({ ...c, bpSys: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              <div><label className={labelCls}><T k="이완기 (mmHg)" /></label><input type="number" value={checkup.bpDia} onChange={(e) => setCheckup((c) => ({ ...c, bpDia: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
            </div>
          </div>

          {/* 시력 / 청력 */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="시력" /></p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>좌</label><input value={checkup.visionL} onChange={(e) => setCheckup((c) => ({ ...c, visionL: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
                <div><label className={labelCls}>우</label><input value={checkup.visionR} onChange={(e) => setCheckup((c) => ({ ...c, visionR: e.target.value }))} disabled={!encounterId} className={inputCls} /></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="청력" /></p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>좌</label><input value={checkup.hearingL} onChange={(e) => setCheckup((c) => ({ ...c, hearingL: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("정상")} /></div>
                <div><label className={labelCls}>우</label><input value={checkup.hearingR} onChange={(e) => setCheckup((c) => ({ ...c, hearingR: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("정상")} /></div>
              </div>
            </div>
          </div>

          {/* Lab summaries */}
          <div className="space-y-3">
            <div><label className={labelCls}><T k="혈액검사 요약" /></label><textarea rows={2} value={checkup.bloodSummary} onChange={(e) => setCheckup((c) => ({ ...c, bloodSummary: e.target.value }))} disabled={!encounterId} className={`${inputCls} resize-none`} placeholder={tAttr("주요 혈액검사 결과...")} /></div>
            <div><label className={labelCls}><T k="소변검사 요약" /></label><textarea rows={2} value={checkup.urineSummary} onChange={(e) => setCheckup((c) => ({ ...c, urineSummary: e.target.value }))} disabled={!encounterId} className={`${inputCls} resize-none`} placeholder={tAttr("주요 소변검사 결과...")} /></div>
            <div><label className={labelCls}><T k="흉부 X선" /></label><input value={checkup.chestXray} onChange={(e) => setCheckup((c) => ({ ...c, chestXray: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("소견...")} /></div>
          </div>

          {/* 판정 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="판정" /></p>
            <div className="flex gap-3">
              {([
                { value: 'A', label: '정상 A', color: 'bg-green-100 text-green-700 ring-green-400' },
                { value: 'B', label: '주의 B', color: 'bg-yellow-100 text-yellow-700 ring-yellow-400' },
                { value: 'C', label: '질환 C', color: 'bg-red-100 text-red-700 ring-red-400' },
              ] as const).map((g) => (
                <button
                  key={g.value}
                  onClick={() => setCheckup((c) => ({ ...c, grade: c.grade === g.value ? '' : g.value }))}
                  disabled={!encounterId}
                  className={`px-5 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${
                    checkup.grade === g.value ? `${g.color} ring-2` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Lifestyle */}
      {activeTab === 'lifestyle' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <h3 className="font-semibold text-gray-900"><T k="생활습관 평가" /></h3>

          {/* 흡연 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="흡연" /></p>
            <div className="flex gap-2 mb-2">
              {['비흡연', '과거 흡연', '현재 흡연'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSmoking((prev) => ({ ...prev, status: s }))}
                  disabled={!encounterId}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                    smoking.status === s ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {(smoking.status === '과거 흡연' || smoking.status === '현재 흡연') && (
              <div className="mt-2">
                <label className={labelCls}><T k="갑년 (Pack-years)" /></label>
                <input type="number" step="0.5" value={smoking.packYears} onChange={(e) => setSmoking((s) => ({ ...s, packYears: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("갑/일 x 년수")} />
              </div>
            )}
          </div>

          {/* 음주 (AUDIT-C) */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="음주 (AUDIT-C)" /></p>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Q1. 얼마나 자주 음주하십니까?</label>
                <select value={auditC.q1} onChange={(e) => setAuditC((a) => ({ ...a, q1: Number(e.target.value) }))} disabled={!encounterId} className={inputCls}>
                  <option value={0}>전혀 안 함 (0)</option>
                  <option value={1}>월 1회 이하 (1)</option>
                  <option value={2}>월 2-4회 (2)</option>
                  <option value={3}>주 2-3회 (3)</option>
                  <option value={4}>주 4회 이상 (4)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Q2. 한 번에 몇 잔 드십니까?</label>
                <select value={auditC.q2} onChange={(e) => setAuditC((a) => ({ ...a, q2: Number(e.target.value) }))} disabled={!encounterId} className={inputCls}>
                  <option value={0}>1-2잔 (0)</option>
                  <option value={1}>3-4잔 (1)</option>
                  <option value={2}>5-6잔 (2)</option>
                  <option value={3}>7-9잔 (3)</option>
                  <option value={4}>10잔 이상 (4)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Q3. 6잔 이상 음주 빈도</label>
                <select value={auditC.q3} onChange={(e) => setAuditC((a) => ({ ...a, q3: Number(e.target.value) }))} disabled={!encounterId} className={inputCls}>
                  <option value={0}>전혀 없음 (0)</option>
                  <option value={1}>월 1회 미만 (1)</option>
                  <option value={2}>월 1회 (2)</option>
                  <option value={3}>주 1회 (3)</option>
                  <option value={4}>거의 매일 (4)</option>
                </select>
              </div>
              <div className={`px-4 py-2 rounded-xl text-sm font-semibold ${
                auditCTotal >= 5 ? 'bg-red-50 text-red-700' : auditCTotal >= 3 ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'
              }`}>
                AUDIT-C 합계: {auditCTotal}점 {auditCTotal >= 5 ? '(위험 음주)' : auditCTotal >= 3 ? '(주의)' : '(저위험)'}
              </div>
            </div>
          </div>

          {/* 운동 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="운동" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}><T k="주 횟수" /></label><input type="number" value={exercise.frequency} onChange={(e) => setExercise((x) => ({ ...x, frequency: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("주 N회")} /></div>
              <div><label className={labelCls}><T k="1회 시간 (분)" /></label><input type="number" value={exercise.duration} onChange={(e) => setExercise((x) => ({ ...x, duration: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("N분")} /></div>
            </div>
          </div>

          {/* 식습관 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="식습관" /></p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setDietRating(star)}
                  disabled={!encounterId}
                  className={`w-10 h-10 rounded-lg text-lg transition-colors disabled:opacity-50 ${
                    star <= dietRating ? 'bg-yellow-100 text-yellow-500' : 'bg-gray-100 text-gray-300'
                  }`}
                >
                  ★
                </button>
              ))}
              <span className="self-center text-sm text-gray-500 ml-2">{dietRating > 0 ? `${dietRating}/5` : '미평가'}</span>
            </div>
          </div>

          {/* 수면 */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="수면" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}><T k="수면 시간" /></label><input type="number" step="0.5" value={sleep.hours} onChange={(e) => setSleep((s) => ({ ...s, hours: e.target.value }))} disabled={!encounterId} className={inputCls} placeholder={tAttr("시간")} /></div>
              <div>
                <label className={labelCls}><T k="수면의 질" /></label>
                <select value={sleep.quality} onChange={(e) => setSleep((s) => ({ ...s, quality: e.target.value }))} disabled={!encounterId} className={inputCls}>
                  <option value=""><T k="선택" /></option>
                  <option value="good"><T k="좋음" /></option>
                  <option value="fair"><T k="보통" /></option>
                  <option value="poor"><T k="불량" /></option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prevention */}
      {activeTab === 'prevention' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900"><T k="암 검진 체크리스트" /></h3>
          <div className="space-y-3">
            {CANCER_SCREENINGS.map((cs) => {
              const s = screenings[cs.key];
              return (
                <div key={cs.key} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-semibold text-gray-800">{cs.label}</span>
                      <span className="text-xs text-gray-400 ml-2">({cs.method})</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}><T k="최종 검사일" /></label>
                      <input
                        type="date"
                        value={s.lastDate}
                        onChange={(e) => setScreenings((prev) => ({ ...prev, [cs.key]: { ...prev[cs.key], lastDate: e.target.value } }))}
                        disabled={!encounterId}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}><T k="결과" /></label>
                      <input
                        value={s.result}
                        onChange={(e) => setScreenings((prev) => ({ ...prev, [cs.key]: { ...prev[cs.key], result: e.target.value } }))}
                        disabled={!encounterId}
                        className={inputCls}
                        placeholder={tAttr("정상/이상소견")}
                      />
                    </div>
                    <div>
                      <label className={labelCls}><T k="다음 예정일" /></label>
                      <input
                        type="date"
                        value={s.nextDue}
                        onChange={(e) => setScreenings((prev) => ({ ...prev, [cs.key]: { ...prev[cs.key], nextDue: e.target.value } }))}
                        disabled={!encounterId}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {checkup.grade && (
              <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                checkup.grade === 'A' ? 'bg-green-100 text-green-700' : checkup.grade === 'B' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
              }`}>
                판정: {checkup.grade}
              </span>
            )}
            {bmi && <span>BMI: {bmi}</span>}
            {auditCTotal > 0 && <span>AUDIT-C: {auditCTotal}</span>}
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
