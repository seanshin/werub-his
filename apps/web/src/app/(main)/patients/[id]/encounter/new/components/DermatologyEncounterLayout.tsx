'use client';

import type { ReactNode } from 'react';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import BodyMapDiagram, { type Lesion } from '@/components/specialty/BodyMapDiagram';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DermatologyEncounterLayoutProps {
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

interface LesionForm {
  location: string;
  morphology: string;
  size: string;
  color: string;
  border: string;
  distribution: string;
  surface: string;
  abcde: { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean };
  dermoscopy: { pattern: string; colors: string; structures: string };
  diagnosis: string;
  treatmentType: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MORPHOLOGIES = [
  'Papule', 'Macule', 'Patch', 'Plaque', 'Nodule',
  'Vesicle', 'Bulla', 'Pustule', 'Wheal', 'Cyst',
  'Ulcer', 'Erosion', 'Excoriation', 'Lichenification',
];

const COLORS = ['피부색', '홍색', '갈색', '흑갈색', '백색', '자색', '황색'];
const BORDERS = ['규칙적', '불규칙적', '경계 불명확', '명확'];
const DISTRIBUTIONS = ['국소', '전신', '대칭', '비대칭', '선형', '군집'];
const SURFACE_TYPES = ['매끄러움', '거칠음', '비늘', '가피', '습윤', '건조'];
const TREATMENT_TYPES = ['경과관찰', '외용제', '냉동치료', '레이저', '절제', '생검', '광선치료'];

const defaultLesionForm: LesionForm = {
  location: '',
  morphology: '',
  size: '',
  color: '',
  border: '',
  distribution: '국소',
  surface: '',
  abcde: { a: false, b: false, c: false, d: false, e: false },
  dermoscopy: { pattern: '', colors: '', structures: '' },
  diagnosis: '',
  treatmentType: '',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DermatologyEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: DermatologyEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [bodyView, setBodyView] = useState<'front' | 'back'>('front');
  const [form, setForm] = useState<LesionForm>(defaultLesionForm);
  const [savedLesions, setSavedLesions] = useState<Lesion[]>([]);
  const [soapOpen, setSoapOpen] = useState(false);
  const [soapCombined, setSoapCombined] = useState({ so: '', ap: '' });

  // Fetch existing lesions
  const { data: lesionData } = useQuery({
    queryKey: ['dermatology-lesions', patientId],
    queryFn: () => apiClient.get<{ data: Lesion[] }>(`/api/v1/dermatology/lesions/${patientId}`),
    enabled: !!patientId,
  });
  const _rawLesions = lesionData?.data;
  const existingLesions: Lesion[] = Array.isArray(_rawLesions)
    ? _rawLesions
    : (_rawLesions as Record<string, unknown> | undefined)?.data as Lesion[] ?? [];

  const allLesions = [...existingLesions, ...savedLesions];

  // Save lesion mutation
  const saveMutation = useMutation({
    mutationFn: (data: LesionForm) =>
      apiClient.post<{ data: Lesion }>('/api/v1/dermatology/lesions', {
        ...data,
        patientId,
        encounterId,
        soap: soapCombined,
      }),
    onSuccess: (res) => {
      toast.success('병변이 저장되었습니다.');
      const newLesion = (res.data as unknown as Record<string, unknown>)?.data as Lesion | undefined;
      if (newLesion) {
        setSavedLesions((prev) => [...prev, newLesion]);
      } else {
        setSavedLesions((prev) => [...prev, {
          id: `temp-${Date.now()}`,
          bodyRegion: form.location,
          morphology: form.morphology,
          size: form.size,
        }]);
      }
      setForm(defaultLesionForm);
    },
    onError: () => toast.error('병변 저장에 실패했습니다.'),
  });

  const handleRegionClick = (region: string) => {
    setForm((prev) => ({ ...prev, location: region }));
  };

  const handleSaveLesion = () => {
    if (!form.location || !form.morphology) {
      toast.warning('부위와 형태를 선택해주세요.');
      return;
    }
    saveMutation.mutate(form);
  };

  const abcdeScore = Object.values(form.abcde).filter(Boolean).length;

  const updateField = (field: keyof LesionForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleAbcde = (key: 'a' | 'b' | 'c' | 'd' | 'e') => {
    setForm((prev) => ({ ...prev, abcde: { ...prev.abcde, [key]: !prev.abcde[key] } }));
  };

  const updateDermoscopy = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, dermoscopy: { ...prev.dermoscopy, [field]: value } }));
  };

  const selectCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 placeholder:text-gray-300';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = () => ({ subjective: soapCombined.so || undefined, assessment: soapCombined.ap || undefined });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Body Map */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
              </svg>
              <T k="바디맵" />
            </h3>
            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
              <button
                onClick={() => setBodyView('front')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${bodyView === 'front' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                <T k="앞면" />
              </button>
              <button
                onClick={() => setBodyView('back')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${bodyView === 'back' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                <T k="뒷면" />
              </button>
            </div>
          </div>

          <BodyMapDiagram
            lesions={allLesions}
            onRegionClick={handleRegionClick}
            view={bodyView}
            mode={encounterId ? 'edit' : 'view'}
          />

          {/* Existing lesions list */}
          {allLesions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                병변 목록 ({allLesions.length}건)
              </p>
              <div className="space-y-1">
                {allLesions.map((l, i) => (
                  <div key={l.id || i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-700">
                      <span className="font-medium">#{i + 1}</span> {l.bodyRegion} — {l.morphology} {l.size && `(${l.size})`}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 whitespace-nowrap">
                      {l.morphology}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Lesion Detail Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            <T k="병변 상세" />
          </h3>

          {!form.location && (
            <p className="text-sm text-gray-400 text-center py-8"><T k="바디맵에서 부위를 클릭하여 새 병변을 추가하세요." /></p>
          )}

          {form.location && (
            <div className="space-y-3">
              {/* Location */}
              <div className="bg-blue-50 rounded-xl px-4 py-2.5">
                <span className="text-sm font-semibold text-blue-700">부위: {form.location}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}><T k="형태" /></label>
                  <select value={form.morphology} onChange={(e) => updateField('morphology', e.target.value)} disabled={!encounterId} className={selectCls}>
                    <option value=""><T k="선택..." /></option>
                    {MORPHOLOGIES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><T k="크기" /></label>
                  <input type="text" value={form.size} onChange={(e) => updateField('size', e.target.value)} placeholder={tAttr("예: 0.5cm")} disabled={!encounterId} className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}><T k="색상" /></label>
                  <select value={form.color} onChange={(e) => updateField('color', e.target.value)} disabled={!encounterId} className={selectCls}>
                    <option value=""><T k="선택..." /></option>
                    {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><T k="경계" /></label>
                  <select value={form.border} onChange={(e) => updateField('border', e.target.value)} disabled={!encounterId} className={selectCls}>
                    <option value=""><T k="선택..." /></option>
                    {BORDERS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}><T k="분포" /></label>
                  <select value={form.distribution} onChange={(e) => updateField('distribution', e.target.value)} disabled={!encounterId} className={selectCls}>
                    {DISTRIBUTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><T k="표면" /></label>
                  <select value={form.surface} onChange={(e) => updateField('surface', e.target.value)} disabled={!encounterId} className={selectCls}>
                    <option value=""><T k="선택..." /></option>
                    {SURFACE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* ABCDE */}
              <div>
                <p className="text-xs font-bold text-gray-700 mb-2">
                  ABCDE Score
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${abcdeScore >= 3 ? 'bg-red-100 text-red-700' : abcdeScore >= 1 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {abcdeScore}점
                  </span>
                </p>
                <div className="flex gap-3">
                  {[
                    { key: 'a' as const, label: 'A (비대칭)' },
                    { key: 'b' as const, label: 'B (경계 불규칙)' },
                    { key: 'c' as const, label: 'C (색상 불균일)' },
                    { key: 'd' as const, label: 'D (직경>6mm)' },
                    { key: 'e' as const, label: 'E (변화)' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={form.abcde[key]}
                        onChange={() => toggleAbcde(key)}
                        disabled={!encounterId}
                        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      <span className="text-[10px] text-gray-600">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dermoscopy */}
              <div>
                <p className="text-xs font-bold text-gray-700 mb-2"><T k="더모스코피" /></p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}><T k="패턴" /></label>
                    <input type="text" value={form.dermoscopy.pattern} onChange={(e) => updateDermoscopy('pattern', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}><T k="색상" /></label>
                    <input type="text" value={form.dermoscopy.colors} onChange={(e) => updateDermoscopy('colors', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}><T k="구조" /></label>
                    <input type="text" value={form.dermoscopy.structures} onChange={(e) => updateDermoscopy('structures', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                </div>
              </div>

              {/* Diagnosis + Treatment */}
              <div>
                <label className={labelCls}><T k="진단" /></label>
                <input type="text" value={form.diagnosis} onChange={(e) => updateField('diagnosis', e.target.value)} placeholder={tAttr("예: 지루성 각화증")} disabled={!encounterId} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="치료" /></label>
                <select value={form.treatmentType} onChange={(e) => updateField('treatmentType', e.target.value)} disabled={!encounterId} className={selectCls}>
                  <option value=""><T k="선택..." /></option>
                  {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Save */}
              <button
                onClick={handleSaveLesion}
                disabled={!encounterId || !form.morphology || saveMutation.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
              >
                {saveMutation.isPending ? '저장중...' : '병변 저장'}
              </button>
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            병변 {allLesions.length}건
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
