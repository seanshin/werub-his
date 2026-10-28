'use client';

import type { ReactNode } from 'react';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import ScoreCalculator from '@/components/specialty/ScoreCalculator';
import { ChartRenderer } from '@/components/chart/ChartRenderer';
import { ChartSaveNotice } from '@/components/chart/ChartSaveNotice';
import { applyChartValuesToSoap, type ChartSectionDef, type SoapSlot } from '@/components/chart/chart-values';
import { ChartTemplateSelector } from './ChartTemplateSelector';
import { buildInternalMedicineSoap, hba1cOf } from '@/lib/specialty/im-note';
import { IM_SUBSPECIALTIES } from '@hospital-run/shared';
import { vitalsIngestNotice, ingestOf } from '@/lib/vitals-ingest-notice';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InternalMedicineEncounterLayoutProps {
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
  requireVitals?: boolean; // 입원/응급=필수, 외래=권고
}

type TabKey = 'general' | 'lab' | 'chronic' | 'record';

/** 저장값은 정본 코드(shared `IM_SUBSPECIALTIES`)다 — 화면 표기만 한글 */
type Subspecialty = string;

interface ChronicCondition {
  key: string;
  label: string;
  checked: boolean;
  targetValue: string;
  currentValue: string;
  unit: string;
}

interface LabCard {
  key: string;
  label: string;
  value: string;
  unit: string;
  normalRange: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS: { key: TabKey; label: string }[] = [
  { key: 'general', label: '일반 진찰' },
  { key: 'lab', label: '검사 결과' },
  { key: 'chronic', label: '만성질환 관리' },
  { key: 'record', label: '내과 기록' },
];

// 🔴 종전엔 이 화면만 **한글**을 저장했다(`소화기내과`). 조회 화면·지표표는 코드(GASTRO …)로
//    필터하므로, 저장한 사람이 자기가 저장한 기록을 못 보는 상태였다 — 정본 코드로 저장한다.
const SUBSPECIALTIES = IM_SUBSPECIALTIES;

const INITIAL_LABS: LabCard[] = [
  { key: 'wbc', label: 'WBC', value: '', unit: '×10³/μL', normalRange: '4.0–10.0' },
  { key: 'hgb', label: 'Hgb', value: '', unit: 'g/dL', normalRange: '13.0–17.0' },
  { key: 'plt', label: 'PLT', value: '', unit: '×10³/μL', normalRange: '150–400' },
  { key: 'ast', label: 'AST', value: '', unit: 'U/L', normalRange: '0–40' },
  { key: 'alt', label: 'ALT', value: '', unit: 'U/L', normalRange: '0–41' },
  { key: 'bun', label: 'BUN', value: '', unit: 'mg/dL', normalRange: '7–20' },
  { key: 'cr', label: 'Cr', value: '', unit: 'mg/dL', normalRange: '0.6–1.2' },
  { key: 'totalChol', label: 'Total Chol', value: '', unit: 'mg/dL', normalRange: '<200' },
  { key: 'ldl', label: 'LDL', value: '', unit: 'mg/dL', normalRange: '<130' },
  { key: 'hdl', label: 'HDL', value: '', unit: 'mg/dL', normalRange: '>40' },
  { key: 'tg', label: 'TG', value: '', unit: 'mg/dL', normalRange: '<150' },
  { key: 'hba1c', label: 'HbA1c', value: '', unit: '%', normalRange: '<6.5' },
];

const INITIAL_CHRONIC: ChronicCondition[] = [
  { key: 'diabetes', label: '당뇨', checked: false, targetValue: '', currentValue: '', unit: 'HbA1c %' },
  { key: 'hypertension', label: '고혈압', checked: false, targetValue: '', currentValue: '', unit: 'mmHg' },
  { key: 'dyslipidemia', label: '고지혈증', checked: false, targetValue: '', currentValue: '', unit: 'LDL mg/dL' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isOutOfRange(value: string, normalRange: string): boolean {
  const v = parseFloat(value);
  if (isNaN(v)) return false;

  if (normalRange.startsWith('<')) {
    return v >= parseFloat(normalRange.slice(1));
  }
  if (normalRange.startsWith('>')) {
    return v <= parseFloat(normalRange.slice(1));
  }

  const parts = normalRange.split('–');
  if (parts.length === 2) {
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    return v < lo || v > hi;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function InternalMedicineEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  requireVitals = false,
  rxSlot,
}: InternalMedicineEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [useChartTemplate, setUseChartTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{ id: string; name: string; department: string; role: string; isPersonal?: boolean; sections?: unknown[]; layout?: string } | null>(null);
  const [chartValues, setChartValues] = useState<Record<string, unknown>>({});

  // -- General Exam --
  const [bp, setBp] = useState('');
  const [hr, setHr] = useState('');
  const [spo2, setSpo2] = useState('');
  const [temp, setTemp] = useState('');
  const [weight, setWeight] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [hpi, setHpi] = useState('');
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  // 🔴 E1/E2(내과 레이아웃도 같은 결함) — chartValues 가 어디에도 저장되지 않았고 SOAP 매핑은 대입이라
  //    같은 슬롯끼리 덮어썼다. 정본 합성기(chart-values)로 한 벌로 맞춘다.
  const chartComposedRef = useRef<Partial<Record<SoapSlot, string>>>({});
  const chartSections = ((selectedTemplate?.sections ?? []) as unknown as ChartSectionDef[]);

  const handleChartFieldChange = (fieldId: string, value: unknown) => {
    const nextValues = { ...chartValues, [fieldId]: value };
    setChartValues(nextValues);
    const { soap: nextSoap, composed } = applyChartValuesToSoap(
      soap, chartComposedRef.current, chartSections, nextValues, selectedTemplate?.name ?? '차트 템플릿',
    );
    chartComposedRef.current = composed;
    setSoap(nextSoap);
  };

  // -- Lab --
  const [labs, setLabs] = useState<LabCard[]>(INITIAL_LABS);

  // -- Chronic --
  const [conditions, setConditions] = useState<ChronicCondition[]>(INITIAL_CHRONIC);

  // -- Record --
  const [subspecialty, setSubspecialty] = useState<Subspecialty>('GASTRO');
  const [findings, setFindings] = useState('');
  const [showScoreCalc, setShowScoreCalc] = useState(false);

  const updateLab = (key: string, value: string) => {
    setLabs((prev) => prev.map((l) => (l.key === key ? { ...l, value } : l)));
  };

  const toggleCondition = (key: string) => {
    setConditions((prev) =>
      prev.map((c) => (c.key === key ? { ...c, checked: !c.checked } : c)),
    );
  };

  const updateConditionField = (key: string, field: 'targetValue' | 'currentValue', value: string) => {
    setConditions((prev) =>
      prev.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
    );
  };

  /**
   * 🔴 활력 정본 수렴 — 종전엔 exams 의 `vitals`(자유 JSON)로만 보냈고 DTO 에 그 필드가 없어
   * whitelist 가 조용히 폐기했다(입력이 어디에도 남지 않음). 이제 정본 PreVisitVitals 로 함께 기록해
   * 시계열·만성추이·NEWS2·이상치 알림에 반영시킨다. bp 는 "120/80" 문자열이라 수치로 분해.
   */
  const saveVitalsToCanonical = async () => {
    const [sysRaw, diaRaw] = (bp ?? '').split(/[\/\s]+/);
    const systolicBp = Number(sysRaw) || undefined;
    const diastolicBp = Number(diaRaw) || undefined;
    const payload = {
      patientId,
      encounterId,
      systolicBp,
      diastolicBp,
      heartRate: hr ? parseFloat(hr) : undefined,
      spo2: spo2 ? parseFloat(spo2) : undefined,
      temperature: temp ? parseFloat(temp) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
    };
    if (!systolicBp && !payload.heartRate && !payload.spo2 && !payload.temperature && !payload.weight) return;
    // 🔴 활력 저장 실패가 진료 저장을 막지는 않는다(그건 옳다). 다만 **조용히 삼키지는 않는다** —
    //    종전엔 실패해도, 중복·보류로 저장되지 않아도 의사는 활력이 기록된 줄 알았다.
    try {
      const res = await apiClient.post('/api/v1/vitals', payload);
      const n = vitalsIngestNotice(ingestOf(res));
      if (n && !n.stored) toast.warning(`활력은 저장되지 않았습니다 — ${n.text} (진료 기록은 저장됩니다)`);
      else if (n) toast.warning(n.text);
    } catch (e) {
      toast.warning(`활력 저장에 실패했습니다: ${(e as { message?: string })?.message ?? '알 수 없는 오류'} (진료 기록은 저장됩니다)`);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await saveVitalsToCanonical();
      // 🔴 종전엔 vitals·hpi·soap·labs·chronicConditions·findings 를 그대로 실어 보냈고,
      //    서버 DTO 에 없는 키라 전역 whitelist 가 **전부 조용히 버렸다**(응답은 201).
      //    저장 위치는 셋으로 갈린다 — 활력=`/api/v1/vitals`(위 saveVitalsToCanonical),
      //    HbA1c=exam 컬럼, 나머지 임상 기술·검사값·만성질환 목표=진료기록 SOAP(아래 handleSave).
      return apiClient.post('/api/v1/internal-medicine/exams', {
        patientId,
        encounterId,
        subspecialty,
        chiefComplaint,
        hba1c: hba1cOf(labs),
      });
    },
    onSuccess: () => toast.success('내과 검사가 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  /** 화면 입력(현병력·소견·검사값·만성질환)을 진료기록 문단으로 모은다 — 정본은 lib/specialty/im-note */
  const composedSoap = () => buildInternalMedicineSoap({ soap, hpi, findings, labs, conditions });

  // 활력징후 정책: 입원/응급=필수(혈압·맥박), 외래=권고(미입력 시 경고 후 진행)
  const handleSign = () => {
    const hasCore = bp.trim() !== '' && hr.trim() !== '';
    if (requireVitals && !hasCore) {
      toast.error('입원·응급 환자는 활력징후(혈압·맥박)가 필수입니다.');
      return;
    }
    if (!requireVitals && !bp.trim() && !hr.trim() && !spo2.trim() && !temp.trim() && !weight.trim()) {
      toast.info('활력징후 미입력 — 외래는 권고 항목입니다. 그대로 서명합니다.');
    }
    onSignAndBill(composedSoap());
  };

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-2 flex gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: 일반 진찰 */}
      {activeTab === 'general' && (
        <div className="space-y-4">
          {/* 차트 템플릿 선택기 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-3">
            <ChartTemplateSelector
              useTemplate={useChartTemplate}
              selectedTemplate={selectedTemplate}
              onToggle={() => setUseChartTemplate(!useChartTemplate)}
              onSelect={async (t) => {
                setSelectedTemplate(t as typeof selectedTemplate);
                setUseChartTemplate(true);
                setChartValues({});
                chartComposedRef.current = {};
                try { await apiClient.post(`/api/v1/chart-templates/${t.id}/use`, {}); } catch {}
              }}
              diagnosisCodes={soap.assessment ? (soap.assessment.match(/[A-Z]\d{2}(?:\.\d{1,2})?/g) ?? []) : undefined}
            />
          </div>

          {/* 차트 템플릿 모드 — 선택한 템플릿의 섹션을 동적 렌더링 */}
          {useChartTemplate && selectedTemplate && (selectedTemplate.sections ?? []).length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <ChartSaveNotice sections={chartSections} templateName={selectedTemplate.name} />
              <ChartRenderer
                sections={(selectedTemplate.sections ?? []) as React.ComponentProps<typeof ChartRenderer>['sections']}
                layout={selectedTemplate.layout ?? 'tabs'}
                values={chartValues}
                onChange={handleChartFieldChange}
                disabled={!encounterId}
              />
            </div>
          )}

          {/* 기본 SOAP 모드 — 템플릿 미사용 시 */}
          {!useChartTemplate && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Vital Signs */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              <T k="활력 징후 (Vital Signs)" />
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${requireVitals ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-gray-100 text-gray-400'}`}>
                {requireVitals ? '필수 (입원·응급)' : '권고 (외래)'}
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}><T k="혈압 (BP)" /></label>
                <input type="text" value={bp} onChange={(e) => setBp(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="SBP/DBP mmHg" />
              </div>
              <div>
                <label className={labelCls}><T k="맥박 (HR)" /></label>
                <input type="number" value={hr} onChange={(e) => setHr(e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("회/분")} />
              </div>
              <div>
                <label className={labelCls}><T k="산소포화도 (SpO2)" /></label>
                <input type="number" value={spo2} onChange={(e) => setSpo2(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="%" />
              </div>
              <div>
                <label className={labelCls}><T k="체온 (Temp)" /></label>
                <input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="°C" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}><T k="체중 (Weight)" /></label>
                <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={!encounterId} className={inputCls} placeholder="kg" />
              </div>
            </div>
          </div>

          {/* Chief Complaint + HPI + SOAP */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <T k="주소 및 병력" />
            </h3>
            <div>
              <label className={labelCls}><T k="주소 (Chief Complaint)" /></label>
              <input type="text" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("환자 주소를 입력하세요")} />
            </div>
            <div>
              <label className={labelCls}><T k="현병력 (HPI)" /></label>
              <textarea rows={3} value={hpi} onChange={(e) => setHpi(e.target.value)} disabled={!encounterId} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300" placeholder={tAttr("현병력을 상세히 기술하세요")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['subjective', 'objective', 'assessment', 'plan'] as const).map((field) => (
                <div key={field}>
                  <label className={labelCls}>{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                  <textarea
                    rows={2}
                    value={soap[field]}
                    onChange={(e) => setSoap((prev) => ({ ...prev, [field]: e.target.value }))}
                    disabled={!encounterId}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
                    placeholder={field}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
          )}
        </div>
      )}

      {/* Tab: 검사 결과 */}
      {activeTab === 'lab' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5" />
            </svg>
            <T k="검사 결과 요약" />
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {labs.map((lab) => {
              const outOfRange = isOutOfRange(lab.value, lab.normalRange);
              return (
                <div
                  key={lab.key}
                  className={`rounded-xl border p-3 space-y-1 transition-colors ${
                    outOfRange
                      ? 'border-red-300 bg-red-50'
                      : lab.value
                        ? 'border-green-200 bg-green-50'
                        : 'border-gray-100 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">{lab.label}</span>
                    {outOfRange && (
                      <span className="text-[10px] font-bold text-red-600 whitespace-nowrap"><T k="이상" /></span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={lab.value}
                    onChange={(e) => updateLab(lab.key, e.target.value)}
                    disabled={!encounterId}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                    placeholder="–"
                  />
                  <div className="text-[10px] text-gray-400">
                    {lab.unit} · 정상: {lab.normalRange}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: 만성질환 관리 */}
      {activeTab === 'chronic' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
            </svg>
            <T k="만성질환 관리" />
          </h3>
          <div className="space-y-3">
            {conditions.map((cond) => {
              const diff = cond.currentValue && cond.targetValue
                ? parseFloat(cond.currentValue) - parseFloat(cond.targetValue)
                : null;
              const overTarget = diff !== null && diff > 0;

              return (
                <div
                  key={cond.key}
                  className={`rounded-xl border p-4 transition-colors ${
                    cond.checked ? 'border-blue-200 bg-blue-50/50' : 'border-gray-100 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="checkbox"
                      checked={cond.checked}
                      onChange={() => toggleCondition(cond.key)}
                      disabled={!encounterId}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-semibold text-gray-800">{cond.label}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{cond.unit}</span>
                  </div>
                  {cond.checked && (
                    <div className="grid grid-cols-3 gap-3 ml-7">
                      <div>
                        <label className={labelCls}><T k="목표 수치" /></label>
                        <input
                          type="number"
                          step="0.1"
                          value={cond.targetValue}
                          onChange={(e) => updateConditionField(cond.key, 'targetValue', e.target.value)}
                          disabled={!encounterId}
                          className={inputCls}
                          placeholder={tAttr("목표")}
                        />
                      </div>
                      <div>
                        <label className={labelCls}><T k="현재 수치" /></label>
                        <input
                          type="number"
                          step="0.1"
                          value={cond.currentValue}
                          onChange={(e) => updateConditionField(cond.key, 'currentValue', e.target.value)}
                          disabled={!encounterId}
                          className={inputCls}
                          placeholder={tAttr("현재")}
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        {diff !== null && (
                          <span className={`text-sm font-bold ${overTarget ? 'text-red-600' : 'text-green-600'}`}>
                            {overTarget ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: 내과 기록 */}
      {activeTab === 'record' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
              </svg>
              <T k="세부 전문과 선택" />
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {SUBSPECIALTIES.map((sub) => (
                <button
                  key={sub.key}
                  onClick={() => setSubspecialty(sub.key)}
                  disabled={!encounterId}
                  className={`px-3 py-2.5 text-sm rounded-xl border font-medium transition-colors disabled:opacity-50 ${
                    subspecialty === sub.key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            <div>
              <label className={labelCls}><T k="소견" /></label>
              <textarea
                rows={5}
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                placeholder={tAttr("내과 소견을 입력하세요...")}
                disabled={!encounterId}
                className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>

            {/* 어디에 저장되는지 밝힌다 — 값이 사라진 것처럼 보이지 않게 */}
            <p className="text-[11px] text-gray-400">
              이 버튼은 활력징후(활력 기록)와 HbA1c·세부전문과(내과 검사 기록)를 저장합니다.
              현병력·소견·나머지 검사값·만성질환 목표는 <span className="text-gray-600">임시저장·서명</span> 시
              진료기록(SOAP)에 함께 저장됩니다 — 오더 없는 검사값을 검사 결과로 만들지 않습니다.
            </p>

            <button
              onClick={() => saveMutation.mutate()}
              disabled={!encounterId || saveMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
            >
              {saveMutation.isPending ? '저장중...' : '검사 기록 저장'}
            </button>
          </div>

          {/* Score Calculator */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" />
              </svg>
              <T k="임상 점수 계산기" />
            </h3>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => setShowScoreCalc(!showScoreCalc)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  showScoreCalc ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {showScoreCalc ? '계산기 닫기' : '계산기 열기'}
              </button>
            </div>
            {showScoreCalc && (
              <ScoreCalculator
                type="cha2ds2vasc"
                onResult={(result) => {
                  setFindings((prev) => prev + `\n[Score] ${result.interpretation} (${result.score}점)`);
                }}
              />
            )}
            {!showScoreCalc && (
              <div className="flex items-center justify-center h-40 text-gray-300 text-sm">
                <T k="계산기를 열어 CHA₂DS₂-VASc, CURB-65, MELD 등을 계산할 수 있습니다" />
              </div>
            )}
          </div>
        </div>
      )}

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            내과 · {subspecialty}
            {bp && ` · BP ${bp}`}
            {hr && ` · HR ${hr}`}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSaveDraft(composedSoap())}
              disabled={!encounterId || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
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
