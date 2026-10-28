'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import DentalChartDiagram, { type ToothStatus } from '@/components/specialty/DentalChartDiagram';
import ToothSurfaceDiagram, { type SurfaceData } from '@/components/specialty/ToothSurfaceDiagram';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DentalEncounterLayoutProps {
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

interface TreatmentPlan {
  id: string;
  tooth: string;
  procedure: string;
  status: string;
}

interface TreatmentRecord {
  id?: string;
  tooth: string;
  procedure: string;
  surfaces: string[];
  material: string;
  anesthesia: string;
  xray: boolean;
  findings: string;
  completedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROCEDURES = [
  '복합레진 충전', '아말감 충전', '글래스아이오노머 충전',
  '근관치료 1차', '근관치료 2차', '근관치료 3차',
  '지르코니아 크라운', 'PFM 크라운', '골드 크라운',
  '단순 발치', '복잡 발치', '매복치 발치',
  '스케일링', '치주소파술', '치은절제술',
  '임플란트 1차', '임플란트 2차', '인레이', '온레이',
];

const MATERIALS = [
  '복합레진 A2', '복합레진 A3', '복합레진 B2',
  '아말감', '글래스아이오노머', 'MTA',
  '지르코니아', 'PFM', '골드',
];

const SURFACES = ['M', 'O', 'D', 'B', 'L'] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DentalEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: DentalEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [surfaceSelections, setSurfaceSelections] = useState<string[]>([]);
  const [procedure, setProcedure] = useState('');
  const [material, setMaterial] = useState('');
  const [anesthesia, setAnesthesia] = useState('');
  const [xray, setXray] = useState(false);
  const [findings, setFindings] = useState('');
  const [todayRecords, setTodayRecords] = useState<TreatmentRecord[]>([]);

  // Collapsible SOAP
  const [soapOpen, setSoapOpen] = useState(false);
  const [soapCombined, setSoapCombined] = useState({ so: '', ap: '' });

  // Fetch dental chart
  const { data: chartData } = useQuery({
    queryKey: ['dental-chart', patientId],
    queryFn: () => apiClient.get<{ data: { teeth: ToothStatus[] } }>(`/api/v1/dental/chart/${patientId}`),
    enabled: !!patientId,
  });
  const _rawChart = chartData?.data;
  const teethStatus: ToothStatus[] = Array.isArray(_rawChart)
    ? _rawChart
    : (_rawChart as Record<string, unknown> | undefined)?.teeth as ToothStatus[] ??
      (_rawChart as Record<string, unknown> | undefined)?.data as ToothStatus[] ?? [];

  // Fetch treatment plans
  const { data: plansData } = useQuery({
    queryKey: ['dental-plans', patientId],
    queryFn: () => apiClient.get<{ data: TreatmentPlan[] }>(`/api/v1/dental/plans/${patientId}`),
    enabled: !!patientId,
  });
  const _rawPlans = plansData?.data;
  const plans: TreatmentPlan[] = Array.isArray(_rawPlans)
    ? _rawPlans
    : (_rawPlans as Record<string, unknown> | undefined)?.data as TreatmentPlan[] ?? [];
  const incompletePlans = plans.filter((p) => p.status !== 'COMPLETED');

  // Save treatment record
  const saveMutation = useMutation({
    // 🔴 스프레드로 보내지 않는다 — 폼 키와 서버 DTO 키가 갈라져 있었고 whitelist 가 조용히 지웠다.
    //    ① `soap` 은 `dental_treatment_records` 에 컬럼이 없다 → 삭제됨. SOAP 은 buildSoap 으로
    //       진료기록(임시저장·서명)에 기록된다. 여기서 두 번 보내지 않는다.
    //    ② `xray`(폼) ≠ `xrayTaken`(DTO·DB 컬럼) → **방사선 촬영 여부가 저장된 적이 없다.**
    mutationFn: (record: Omit<TreatmentRecord, 'id' | 'completedAt'>) =>
      apiClient.post<{ data: TreatmentRecord }>('/api/v1/dental/records', {
        patientId,
        encounterId,
        tooth: record.tooth,
        procedure: record.procedure,
        surfaces: record.surfaces,
        material: record.material || undefined,
        anesthesia: record.anesthesia || undefined,
        xrayTaken: record.xray,
        findings: record.findings || undefined,
      }),
    onSuccess: (_res, variables) => {
      toast.success(`#${variables.tooth} 치료 기록이 저장되었습니다.`);
      setTodayRecords((prev) => [...prev, { ...variables, completedAt: new Date().toISOString() }]);
      resetForm();
    },
    onError: () => toast.error('치료 기록 저장에 실패했습니다.'),
  });

  const resetForm = () => {
    setSurfaceSelections([]);
    setProcedure('');
    setMaterial('');
    setAnesthesia('');
    setXray(false);
    setFindings('');
  };

  const handleSaveRecord = () => {
    if (!selectedTooth || !procedure) {
      toast.warning('치아와 시술을 선택해주세요.');
      return;
    }
    saveMutation.mutate({
      tooth: selectedTooth,
      procedure,
      surfaces: surfaceSelections,
      material,
      anesthesia,
      xray,
      findings,
    });
  };

  const handleToothClick = (tooth: string) => {
    setSelectedTooth(tooth);
    resetForm();
  };

  const toggleSurface = (s: string) => {
    setSurfaceSelections((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  // Surface data for ToothSurfaceDiagram
  const surfaceData: SurfaceData[] = SURFACES.map((s) => ({
    surface: s,
    status: surfaceSelections.includes(s) ? 'SELECTED' : 'NORMAL',
  }));

  const buildSoap = () => ({ subjective: soapCombined.so || undefined, objective: findings || undefined, assessment: soapCombined.ap || undefined });

  return (
    <div className="space-y-4">
      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Dental Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <T k="치아 차트" />
          </h3>

          <DentalChartDiagram
            teethStatus={teethStatus}
            selectedTooth={selectedTooth}
            onToothClick={handleToothClick}
            mode={encounterId ? 'edit' : 'view'}
          />

          {/* Tooth surface diagram */}
          {selectedTooth && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 mb-2">선택 치아: #{selectedTooth} — 면 선택</p>
              <ToothSurfaceDiagram
                tooth={selectedTooth}
                surfaces={surfaceData}
                onSurfaceClick={toggleSurface}
              />
            </div>
          )}

          {/* Incomplete treatment plans */}
          {incompletePlans.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                치료 계획 (미완료 {incompletePlans.length}건)
              </p>
              <div className="space-y-1">
                {incompletePlans.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-700">
                      <span className="font-medium">#{p.tooth}</span> {p.procedure}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
                      {p.status === 'PENDING' ? '대기' : p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Treatment Record Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            <T k="치료 기록 입력" />
          </h3>

          {!selectedTooth && (
            <p className="text-sm text-gray-400 text-center py-8"><T k="좌측 차트에서 치아를 선택해주세요." /></p>
          )}

          {selectedTooth && (
            <div className="space-y-3">
              {/* Selected tooth */}
              <div className="bg-blue-50 rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-blue-700">치아: #{selectedTooth}</span>
              </div>

              {/* Procedure */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="시술" /></label>
                <select
                  value={procedure}
                  onChange={(e) => setProcedure(e.target.value)}
                  disabled={!encounterId}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                >
                  <option value=""><T k="시술 선택..." /></option>
                  {PROCEDURES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Surfaces checkboxes */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">면</label>
                <div className="flex gap-2">
                  {SURFACES.map((s) => (
                    <label key={s} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={surfaceSelections.includes(s)}
                        onChange={() => toggleSurface(s)}
                        disabled={!encounterId}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-medium text-gray-700">{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Material */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="재료" /></label>
                <select
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  disabled={!encounterId}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                >
                  <option value=""><T k="재료 선택..." /></option>
                  {MATERIALS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Anesthesia */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="마취" /></label>
                <input
                  type="text"
                  value={anesthesia}
                  onChange={(e) => setAnesthesia(e.target.value)}
                  placeholder={tAttr("예: 리도카인 2% 1.8mL")}
                  disabled={!encounterId}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300"
                />
              </div>

              {/* X-ray */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={xray}
                  onChange={(e) => setXray(e.target.checked)}
                  disabled={!encounterId}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-xs font-medium text-gray-700"><T k="X-ray 촬영" /></label>
              </div>

              {/* Findings */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="소견" /></label>
                <textarea
                  rows={3}
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder={tAttr("치료 소견을 입력하세요...")}
                  disabled={!encounterId}
                  className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
                />
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveRecord}
                disabled={!encounterId || !procedure || saveMutation.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
              >
                {saveMutation.isPending ? '저장중...' : '치료 기록 저장'}
              </button>
            </div>
          )}

          {/* Today's completed treatments */}
          {todayRecords.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                오늘 치료 ({todayRecords.length}건)
              </p>
              <div className="space-y-1">
                {todayRecords.map((r, i) => (
                  <div key={i} className="flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-700">
                      <span className="font-medium">#{r.tooth}</span> {r.procedure}
                      {r.surfaces.length > 0 && <span className="text-gray-400 ml-1">({r.surfaces.join(',')})</span>}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">
                      <T k="완료" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible SOAP */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
        <button
          onClick={() => setSoapOpen(!soapOpen)}
          className="w-full flex items-center justify-between px-6 py-3"
        >
          <span className="text-sm font-semibold text-gray-700"><T k="SOAP 노트 (간소)" /></span>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${soapOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {soapOpen && (
          <div className="px-6 pb-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1"><T k="S + O (주관/객관)" /></label>
              <textarea
                rows={3}
                value={soapCombined.so}
                onChange={(e) => setSoapCombined({ ...soapCombined, so: e.target.value })}
                disabled={!encounterId}
                placeholder={tAttr("주관적 증상 및 객관적 소견...")}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1"><T k="A + P (평가/계획)" /></label>
              <textarea
                rows={3}
                value={soapCombined.ap}
                onChange={(e) => setSoapCombined({ ...soapCombined, ap: e.target.value })}
                disabled={!encounterId}
                placeholder={tAttr("진단 및 치료 계획...")}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
              />
            </div>
          </div>
        )}
      </div>

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            치료 {todayRecords.length}건
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSaveDraft(buildSoap())}
              disabled={!encounterId || isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              <T k="저장 (임시)" />
            </button>
            <button
              onClick={() => onSignAndBill(buildSoap())}
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
