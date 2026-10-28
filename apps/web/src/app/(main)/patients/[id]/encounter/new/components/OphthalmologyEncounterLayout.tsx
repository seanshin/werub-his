'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import EyeDiagram from '@/components/specialty/EyeDiagram';
import { AiAssistantPanel } from './AiAssistantPanel';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OphthalmologyEncounterLayoutProps {
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

interface EyeExamForm {
  vaOdUncorrected: string;
  vaOsUncorrected: string;
  vaOdCorrected: string;
  vaOsCorrected: string;
  refrOdSph: string;
  refrOdCyl: string;
  refrOdAxis: string;
  refrOsSph: string;
  refrOsCyl: string;
  refrOsAxis: string;
  iopOd: string;
  iopOs: string;
  iopMethod: string;
  slitLampOd: { conjunctiva: string; cornea: string; ac: string; iris: string; lens: string };
  slitLampOs: { conjunctiva: string; cornea: string; ac: string; iris: string; lens: string };
  fundusOd: { cdr: string; macula: string; vessels: string };
  fundusOs: { cdr: string; macula: string; vessels: string };
  diagnosis: string;
  plan: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const IOP_METHODS = ['NCT', 'GAT', 'Tono-Pen', 'iCare'];
const SLIT_LAMP_OPTIONS = ['정상', '충혈', '부종', '혼탁', '삼출', '이상'];
const FUNDUS_MACULA = ['정상', '부종', '출혈', '드루젠', '위축', '이상'];
const FUNDUS_VESSELS = ['정상', '협착', '출혈', '미세동맥류', '이상'];

const defaultForm: EyeExamForm = {
  vaOdUncorrected: '', vaOsUncorrected: '', vaOdCorrected: '', vaOsCorrected: '',
  refrOdSph: '', refrOdCyl: '', refrOdAxis: '', refrOsSph: '', refrOsCyl: '', refrOsAxis: '',
  iopOd: '', iopOs: '', iopMethod: 'NCT',
  slitLampOd: { conjunctiva: '정상', cornea: '정상', ac: '정상', iris: '정상', lens: '정상' },
  slitLampOs: { conjunctiva: '정상', cornea: '정상', ac: '정상', iris: '정상', lens: '정상' },
  fundusOd: { cdr: '', macula: '정상', vessels: '정상' },
  fundusOs: { cdr: '', macula: '정상', vessels: '정상' },
  diagnosis: '', plan: '',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function OphthalmologyEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: OphthalmologyEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [form, setForm] = useState<EyeExamForm>(defaultForm);
  const [soapOpen, setSoapOpen] = useState(false);
  const [soapCombined, setSoapCombined] = useState({ so: '', ap: '' });

  // Fetch previous exam
  const { data: prevExamData } = useQuery({
    queryKey: ['ophthalmology-exam', patientId],
    queryFn: () => apiClient.get<{ data: Partial<EyeExamForm> }>(`/api/v1/ophthalmology/exam/${patientId}`),
    enabled: !!patientId,
  });
  // We don't auto-fill -- previous exams are for reference only
  const _prevExam = prevExamData?.data;

  // Save exam
  const saveMutation = useMutation({
    mutationFn: (data: EyeExamForm) =>
      apiClient.post<{ data: unknown }>('/api/v1/ophthalmology/exam', {
        ...data,
        patientId,
        encounterId,
        soap: soapCombined,
      }),
    onSuccess: () => toast.success('안과 검사가 저장되었습니다.'),
    onError: () => toast.error('검사 저장에 실패했습니다.'),
  });

  const handleSaveExam = () => {
    if (!encounterId) return;
    saveMutation.mutate(form);
  };

  const updateField = (field: keyof EyeExamForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateSlitLamp = (eye: 'Od' | 'Os', field: string, value: string) => {
    const key = `slitLamp${eye}` as 'slitLampOd' | 'slitLampOs';
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const updateFundus = (eye: 'Od' | 'Os', field: string, value: string) => {
    const key = `fundus${eye}` as 'fundusOd' | 'fundusOs';
    setForm((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300';
  const selectCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = () => ({ subjective: soapCombined.so || undefined, assessment: soapCombined.ap || undefined });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
        {/* Left: Eye exam form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <T k="안과 검사" />
          </h3>

          {/* Visual Acuity */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="시력 (Visual Acuity)" /></p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={labelCls}><T k="OD 나안" /></label>
                <input type="text" value={form.vaOdUncorrected} onChange={(e) => updateField('vaOdUncorrected', e.target.value)} placeholder="20/" disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="OD 교정" /></label>
                <input type="text" value={form.vaOdCorrected} onChange={(e) => updateField('vaOdCorrected', e.target.value)} placeholder="20/" disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="OS 나안" /></label>
                <input type="text" value={form.vaOsUncorrected} onChange={(e) => updateField('vaOsUncorrected', e.target.value)} placeholder="20/" disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="OS 교정" /></label>
                <input type="text" value={form.vaOsCorrected} onChange={(e) => updateField('vaOsCorrected', e.target.value)} placeholder="20/" disabled={!encounterId} className={inputCls} />
              </div>
            </div>
          </div>

          {/* Refraction */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="굴절 (Refraction)" /></p>
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-3 items-center">
                <span className="text-xs font-medium text-gray-500">OD:</span>
                <div>
                  <label className={labelCls}>SPH</label>
                  <input type="text" value={form.refrOdSph} onChange={(e) => updateField('refrOdSph', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>CYL</label>
                  <input type="text" value={form.refrOdCyl} onChange={(e) => updateField('refrOdCyl', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>AXIS</label>
                  <input type="text" value={form.refrOdAxis} onChange={(e) => updateField('refrOdAxis', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 items-center">
                <span className="text-xs font-medium text-gray-500">OS:</span>
                <div>
                  <label className={labelCls}>SPH</label>
                  <input type="text" value={form.refrOsSph} onChange={(e) => updateField('refrOsSph', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>CYL</label>
                  <input type="text" value={form.refrOsCyl} onChange={(e) => updateField('refrOsCyl', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>AXIS</label>
                  <input type="text" value={form.refrOsAxis} onChange={(e) => updateField('refrOsAxis', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
              </div>
            </div>
          </div>

          {/* IOP */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="안압 (IOP)" /></p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>OD (mmHg)</label>
                <input type="text" value={form.iopOd} onChange={(e) => updateField('iopOd', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>OS (mmHg)</label>
                <input type="text" value={form.iopOs} onChange={(e) => updateField('iopOs', e.target.value)} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="방법" /></label>
                <select value={form.iopMethod} onChange={(e) => updateField('iopMethod', e.target.value)} disabled={!encounterId} className={selectCls}>
                  {IOP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Eye Diagram */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="안구 다이어그램" /></p>
            <div className="flex justify-center gap-6">
              <div className="text-center">
                <span className="text-[10px] font-semibold text-gray-500 mb-1 block"><T k="OD (우안)" /></span>
                <EyeDiagram od={{ va: form.vaOdCorrected || form.vaOdUncorrected, iop: Number(form.iopOd) || 0 }} os={{ va: '', iop: 0 }} />
              </div>
              <div className="text-center">
                <span className="text-[10px] font-semibold text-gray-500 mb-1 block"><T k="OS (좌안)" /></span>
                <EyeDiagram od={{ va: '', iop: 0 }} os={{ va: form.vaOsCorrected || form.vaOsUncorrected, iop: Number(form.iopOs) || 0 }} />
              </div>
            </div>
          </div>

          {/* Slit Lamp */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="세극등 (Slit Lamp)" /></p>
            {(['Od', 'Os'] as const).map((eye) => {
              const key = `slitLamp${eye}` as 'slitLampOd' | 'slitLampOs';
              return (
                <div key={eye} className="mb-2">
                  <span className="text-[10px] font-semibold text-gray-500">{eye === 'Od' ? 'OD (우안)' : 'OS (좌안)'}</span>
                  <div className="grid grid-cols-5 gap-2 mt-1">
                    {(['conjunctiva', 'cornea', 'ac', 'iris', 'lens'] as const).map((part) => (
                      <div key={part}>
                        <label className="block text-[10px] text-gray-400 mb-0.5">
                          {part === 'conjunctiva' ? '결막' : part === 'cornea' ? '각막' : part === 'ac' ? '전방' : part === 'iris' ? '홍채' : '수정체'}
                        </label>
                        <select
                          value={form[key][part as keyof typeof form.slitLampOd]}
                          onChange={(e) => updateSlitLamp(eye, part, e.target.value)}
                          disabled={!encounterId}
                          className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white disabled:bg-gray-50"
                        >
                          {SLIT_LAMP_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fundus */}
          <div>
            <p className="text-xs font-bold text-gray-700 mb-2"><T k="안저 (Fundus)" /></p>
            {(['Od', 'Os'] as const).map((eye) => {
              const key = `fundus${eye}` as 'fundusOd' | 'fundusOs';
              return (
                <div key={eye} className="mb-2">
                  <span className="text-[10px] font-semibold text-gray-500">{eye === 'Od' ? 'OD (우안)' : 'OS (좌안)'}</span>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5"><T k="시신경 CDR" /></label>
                      <input
                        type="text"
                        value={form[key].cdr}
                        onChange={(e) => updateFundus(eye, 'cdr', e.target.value)}
                                                disabled={!encounterId}
                        className="w-full px-2 py-1 border border-gray-200 rounded text-[11px] disabled:bg-gray-50 placeholder:text-gray-300"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5"><T k="황반" /></label>
                      <select value={form[key].macula} onChange={(e) => updateFundus(eye, 'macula', e.target.value)} disabled={!encounterId} className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white disabled:bg-gray-50">
                        {FUNDUS_MACULA.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 mb-0.5"><T k="혈관" /></label>
                      <select value={form[key].vessels} onChange={(e) => updateFundus(eye, 'vessels', e.target.value)} disabled={!encounterId} className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white disabled:bg-gray-50">
                        {FUNDUS_VESSELS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Diagnosis & Plan */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={labelCls}><T k="진단" /></label>
              <textarea rows={2} value={form.diagnosis} onChange={(e) => updateField('diagnosis', e.target.value)} disabled={!encounterId} placeholder={tAttr("진단명...")} className={`${inputCls} resize-none`} />
            </div>
            <div>
              <label className={labelCls}><T k="계획" /></label>
              <textarea rows={2} value={form.plan} onChange={(e) => updateField('plan', e.target.value)} disabled={!encounterId} placeholder={tAttr("치료 계획...")} className={`${inputCls} resize-none`} />
            </div>
          </div>

          {/* Save */}
          <button
            onClick={handleSaveExam}
            disabled={!encounterId || saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 저장'}
          </button>
        </div>

        {/* Right: AI Panel (collapsed by default) */}
        <div className="hidden lg:block">
          <AiAssistantPanel
            patientId={patientId}
            soap={{ subjective: '', objective: '', assessment: form.diagnosis, plan: form.plan }}
            encounterId={encounterId}
            onApplySoap={() => {}}
          />
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
              <textarea rows={3} value={soapCombined.so} onChange={(e) => setSoapCombined({ ...soapCombined, so: e.target.value })} disabled={!encounterId} placeholder={tAttr("주관적 증상 및 객관적 소견...")} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1"><T k="A + P (평가/계획)" /></label>
              <textarea rows={3} value={soapCombined.ap} onChange={(e) => setSoapCombined({ ...soapCombined, ap: e.target.value })} disabled={!encounterId} placeholder={tAttr("진단 및 치료 계획...")} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300" />
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <T k="안과 검사" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => onSaveDraft(buildSoap())} disabled={!encounterId || isSaving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40">
              <T k="저장 (임시)" />
            </button>
            <button onClick={() => onSignAndBill(buildSoap())} disabled={!encounterId || isSigning} className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40">
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
