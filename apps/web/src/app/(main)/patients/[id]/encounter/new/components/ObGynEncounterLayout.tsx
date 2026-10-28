'use client';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import FetalGrowthChart, { type FetalGrowthDataPoint } from '@/components/specialty/FetalGrowthChart';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ObGynEncounterLayoutProps {
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

type ExamType = 'PRENATAL' | 'GYNECOLOGY' | 'LABOR' | 'POSTPARTUM';

interface PrenatalForm {
  gestationalWeeks: string;
  gestationalDays: string;
  gravida: string;
  para: string;
  weight: string;
  bpSystolic: string;
  bpDiastolic: string;
  urineProtein: string;
  urineGlucose: string;
  fundalHeight: string;
  fhr: string;
  edema: string;
}

interface UltrasoundForm {
  bpd: string;
  fl: string;
  ac: string;
  efw: string;
  afi: string;
  placenta: string;
  presentation: string;
}

interface GynecologyForm {
  papSmear: string;
  hpv: string;
  cervixFindings: string;
  uterusSize: string;
  adnexa: string;
  discharge: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: 'PRENATAL', label: '산전 검진' },
  { value: 'GYNECOLOGY', label: '부인과' },
  { value: 'LABOR', label: '분만' },
  { value: 'POSTPARTUM', label: '산후' },
];

const URINE_OPTIONS = ['(-)', '(+/-)', '(+)', '(++)', '(+++)'];
const EDEMA_OPTIONS = ['없음', '경미', '중등도', '심함'];
const PAP_RESULTS = ['정상', 'ASC-US', 'LSIL', 'HSIL', 'AGC', 'SCC'];
const HPV_RESULTS = ['음성', '양성 (고위험)', '양성 (저위험)', '미검사'];
const PRESENTATIONS = ['두위', '둔위', '횡위', '미확인'];
const PLACENTA_POSITIONS = ['전벽', '후벽', '저위', '전치', '미확인'];

const defaultPrenatal: PrenatalForm = {
  gestationalWeeks: '', gestationalDays: '', gravida: '', para: '',
  weight: '', bpSystolic: '', bpDiastolic: '',
  urineProtein: '(-)', urineGlucose: '(-)', fundalHeight: '', fhr: '', edema: '없음',
};

const defaultUltrasound: UltrasoundForm = {
  bpd: '', fl: '', ac: '', efw: '', afi: '', placenta: '미확인', presentation: '미확인',
};

const defaultGynecology: GynecologyForm = {
  papSmear: '', hpv: '미검사', cervixFindings: '', uterusSize: '', adnexa: '', discharge: '',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ObGynEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: ObGynEncounterLayoutProps) {
  const tAttr = useTAttr();
  const [examType, setExamType] = useState<ExamType>('PRENATAL');
  const [prenatal, setPrenatal] = useState<PrenatalForm>(defaultPrenatal);
  const [ultrasound, setUltrasound] = useState<UltrasoundForm>(defaultUltrasound);
  const [gynecology, setGynecology] = useState<GynecologyForm>(defaultGynecology);
  const [nstResult, setNstResult] = useState('');
  const [fetalMetric, setFetalMetric] = useState<'bpd' | 'fl' | 'ac' | 'efw'>('efw');
  const [findings, setFindings] = useState('');
  // 🔴 분만·산후 입력 20칸은 값이 어디에도 담기지 않아 서명하면 전부 사라졌다(비제어 입력 · 저장 경로 없음 · 2026-09-30).
  //    전용 컬럼이 없으므로 부인과 내진 소견처럼 진료기록 O(객관 소견)에 남긴다. 초기값은 전부 '미선택'.
  const [labor, setLabor] = useState<Record<string, string>>({});
  const [postpartum, setPostpartum] = useState<Record<string, string>>({});
  const bindLabor = (k: string) => ({ value: labor[k] ?? '', onChange: (e: { target: { value: string } }) => setLabor((p) => ({ ...p, [k]: e.target.value })) });
  const bindPp = (k: string) => ({ value: postpartum[k] ?? '', onChange: (e: { target: { value: string } }) => setPostpartum((p) => ({ ...p, [k]: e.target.value })) });

  const fetalData: FetalGrowthDataPoint[] = useMemo(() => {
    const week = parseInt(prenatal.gestationalWeeks);
    if (!week || week < 12 || week > 42) return [];
    return [{
      gestationalWeek: week,
      bpd: parseFloat(ultrasound.bpd) || undefined,
      fl: parseFloat(ultrasound.fl) || undefined,
      ac: parseFloat(ultrasound.ac) || undefined,
      efw: parseFloat(ultrasound.efw) || undefined,
    }];
  }, [prenatal.gestationalWeeks, ultrasound]);

  const updatePrenatal = (field: keyof PrenatalForm, value: string) => {
    setPrenatal((prev) => ({ ...prev, [field]: value }));
  };

  const updateUltrasound = (field: keyof UltrasoundForm, value: string) => {
    setUltrasound((prev) => ({ ...prev, [field]: value }));
  };

  const updateGynecology = (field: keyof GynecologyForm, value: string) => {
    setGynecology((prev) => ({ ...prev, [field]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      // 🔴 산전·부인과 입력을 **폼 객체 통째로** 보내서 서버 DTO(whitelist)가 전부 버렸다 —
      //    저장된 것은 examType 뿐이었고, 화면은 "저장되었습니다"라고 말했다.
      //    정본은 평탄화된 컬럼(gestationalAge·bloodPressure·fetalHeartRate …)이다.
      //    내진 소견(자궁경부·자궁·부속기·분비물)은 컬럼이 없어 SOAP objective 로 넘긴다(buildSoap).
      apiClient.post('/api/v1/obgyn/exams', {
        patientId,
        encounterId,
        examType,
        ...(examType === 'PRENATAL' ? {
          gestationalAge: prenatal.gestationalWeeks
            ? `${parseInt(prenatal.gestationalWeeks)}W${parseInt(prenatal.gestationalDays) || 0}D`
            : undefined,
          gravida: prenatal.gravida ? parseInt(prenatal.gravida) : undefined,
          para: prenatal.para ? parseInt(prenatal.para) : undefined,
          currentWeight: prenatal.weight ? parseFloat(prenatal.weight) : undefined,
          bloodPressure: prenatal.bpSystolic && prenatal.bpDiastolic
            ? `${prenatal.bpSystolic}/${prenatal.bpDiastolic}` : undefined,
          urineProtein: prenatal.urineProtein || undefined,
          urineGlucose: prenatal.urineGlucose || undefined,
          edema: prenatal.edema || undefined,
          fundalHeight: prenatal.fundalHeight ? parseFloat(prenatal.fundalHeight) : undefined,
          fetalHeartRate: prenatal.fhr ? parseInt(prenatal.fhr) : undefined,
          ultrasound: ultrasoundPayload,
          // NST 는 화면이 자유 문구 하나만 받는다 — 없는 구조(baseline·variability …)를 지어내지 않는다
          nst: nstResult ? { result: nstResult } : undefined,
        } : {
          papSmear: gynecology.papSmear || undefined,
          hpvTest: gynecology.hpv || undefined,
        }),
      }),
    onSuccess: () => toast.success('산부인과 검사가 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  /** 초음파 계측 — 하나도 입력하지 않았으면 빈 객체를 저장하지 않는다(표본 부재는 null 이다). */
  const ultrasoundPayload = (() => {
    const u = {
      bpd: ultrasound.bpd ? parseFloat(ultrasound.bpd) : undefined,
      fl: ultrasound.fl ? parseFloat(ultrasound.fl) : undefined,
      ac: ultrasound.ac ? parseFloat(ultrasound.ac) : undefined,
      efw: ultrasound.efw ? parseFloat(ultrasound.efw) : undefined,
      afi: ultrasound.afi ? parseFloat(ultrasound.afi) : undefined,
      // 조회 화면(`obgynUltrasoundRows`)이 읽는 정본 키 이름 — placenta 가 아니라 placentaLocation
      placentaLocation: ultrasound.placenta && ultrasound.placenta !== '미확인' ? ultrasound.placenta : undefined,
      presentation: ultrasound.presentation && ultrasound.presentation !== '미확인' ? ultrasound.presentation : undefined,
    };
    return Object.values(u).some((v) => v !== undefined) ? u : undefined;
  })();

  /** 컬럼이 없는 부인과 내진 소견은 진료기록(SOAP objective)에 남긴다 — 버리지 않는다. */
  const gynObjective = () => {
    const parts = [
      gynecology.cervixFindings && `자궁경부: ${gynecology.cervixFindings}`,
      gynecology.uterusSize && `자궁: ${gynecology.uterusSize}`,
      gynecology.adnexa && `부속기: ${gynecology.adnexa}`,
      gynecology.discharge && `분비물: ${gynecology.discharge}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '';
  };

  /** 분만·산후 — 입력된 칸만 '라벨: 값' 으로(빈 칸을 '정상'으로 채우지 않는다) */
  const recordLines = (rec: Record<string, string>, labels: [string, string, string?][]) =>
    labels.map(([k, label, unit]) => (rec[k]?.trim() ? `${label}: ${rec[k].trim()}${unit ?? ''}` : null)).filter(Boolean).join(' · ');
  const laborObjective = () => {
    const t = recordLines(labor, [['method', '분만 방식'], ['deliveredAt', '분만 일시'], ['babyWeight', '신생아 체중', 'g'], ['apgar1', 'Apgar 1분'], ['apgar5', 'Apgar 5분'], ['placenta', '태반 만출'], ['ebl', '출혈량', 'ml'], ['perineum', '회음부'], ['cordPh', '제대혈 pH'], ['course', '경과/합병증']]);
    return t ? `[분만] ${t}` : '';
  };
  const postpartumObjective = () => {
    const t = recordLines(postpartum, [['days', '산후', '일'], ['uterus', '자궁 수축'], ['lochia', '오로'], ['feeding', '수유'], ['temp', '체온', '°C'], ['bp', '혈압'], ['pulse', '맥박', '/분'], ['wound', '회음부/수술 부위'], ['mood', '정서 상태'], ['memo', '메모']]);
    return t ? `[산후] ${t}` : '';
  };

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => {
    const gyn = examType === 'GYNECOLOGY' ? gynObjective() : examType === 'LABOR' ? laborObjective() : examType === 'POSTPARTUM' ? postpartumObjective() : '';
    const objective = [findings, gyn].filter(Boolean).join('\n');
    return { objective: objective || undefined };
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
            <T k="산부인과 검사" />
          </h3>

          {/* Exam Type Selector */}
          <div>
            <label className={labelCls}><T k="검사 유형" /></label>
            <div className="flex gap-2">
              {EXAM_TYPES.map((et) => (
                <button
                  key={et.value}
                  onClick={() => setExamType(et.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    examType === et.value
                      ? 'bg-pink-100 text-pink-700 font-medium'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {et.label}
                </button>
              ))}
            </div>
          </div>

          {/* PRENATAL Section */}
          {examType === 'PRENATAL' && (
            <div className="space-y-3">
              {/* Gestational Age & G/P */}
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className={labelCls}><T k="임신주수" /></label>
                  <div className="flex gap-1 items-center">
                    <input type="number" value={prenatal.gestationalWeeks} onChange={(e) => updatePrenatal('gestationalWeeks', e.target.value)} disabled={!encounterId} className={inputCls} placeholder="주" />
                    <span className="text-xs text-gray-400">+</span>
                    <input type="number" value={prenatal.gestationalDays} onChange={(e) => updatePrenatal('gestationalDays', e.target.value)} disabled={!encounterId} className={inputCls} placeholder="일" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}><T k="G (임신횟수)" /></label>
                  <input type="number" value={prenatal.gravida} onChange={(e) => updatePrenatal('gravida', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}><T k="P (분만횟수)" /></label>
                  <input type="number" value={prenatal.para} onChange={(e) => updatePrenatal('para', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}><T k="체중 (kg)" /></label>
                  <input type="number" value={prenatal.weight} onChange={(e) => updatePrenatal('weight', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
              </div>

              {/* Vital Signs */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}><T k="혈압 (mmHg)" /></label>
                  <div className="flex gap-1 items-center">
                    <input type="number" value={prenatal.bpSystolic} onChange={(e) => updatePrenatal('bpSystolic', e.target.value)} disabled={!encounterId} className={inputCls} placeholder="SBP" />
                    <span className="text-xs text-gray-400">/</span>
                    <input type="number" value={prenatal.bpDiastolic} onChange={(e) => updatePrenatal('bpDiastolic', e.target.value)} disabled={!encounterId} className={inputCls} placeholder="DBP" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}><T k="자궁저 높이 (cm)" /></label>
                  <input type="number" value={prenatal.fundalHeight} onChange={(e) => updatePrenatal('fundalHeight', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}><T k="태아심박수 (bpm)" /></label>
                  <input type="number" value={prenatal.fhr} onChange={(e) => updatePrenatal('fhr', e.target.value)} disabled={!encounterId} className={inputCls} />
                </div>
              </div>

              {/* Urine & Edema */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}><T k="소변 단백" /></label>
                  <select value={prenatal.urineProtein} onChange={(e) => updatePrenatal('urineProtein', e.target.value)} disabled={!encounterId} className={inputCls}>
                    {URINE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><T k="소변 당" /></label>
                  <select value={prenatal.urineGlucose} onChange={(e) => updatePrenatal('urineGlucose', e.target.value)} disabled={!encounterId} className={inputCls}>
                    {URINE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}><T k="부종" /></label>
                  <select value={prenatal.edema} onChange={(e) => updatePrenatal('edema', e.target.value)} disabled={!encounterId} className={inputCls}>
                    {EDEMA_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>

              {/* Ultrasound */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="초음파 계측" /></p>
                <div className="grid grid-cols-5 gap-2">
                  <div>
                    <label className={labelCls}>BPD (mm)</label>
                    <input type="number" value={ultrasound.bpd} onChange={(e) => updateUltrasound('bpd', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>FL (mm)</label>
                    <input type="number" value={ultrasound.fl} onChange={(e) => updateUltrasound('fl', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>AC (mm)</label>
                    <input type="number" value={ultrasound.ac} onChange={(e) => updateUltrasound('ac', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>EFW (g)</label>
                    <input type="number" value={ultrasound.efw} onChange={(e) => updateUltrasound('efw', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>AFI (cm)</label>
                    <input type="number" value={ultrasound.afi} onChange={(e) => updateUltrasound('afi', e.target.value)} disabled={!encounterId} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className={labelCls}><T k="태위" /></label>
                    <select value={ultrasound.presentation} onChange={(e) => updateUltrasound('presentation', e.target.value)} disabled={!encounterId} className={inputCls}>
                      {PRESENTATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}><T k="태반 위치" /></label>
                    <select value={ultrasound.placenta} onChange={(e) => updateUltrasound('placenta', e.target.value)} disabled={!encounterId} className={inputCls}>
                      {PLACENTA_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* NST */}
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="NST (비자극검사)" /></p>
                <textarea
                  rows={2}
                  value={nstResult}
                  onChange={(e) => setNstResult(e.target.value)}
                  placeholder={tAttr("Reactive / Non-reactive, 소견...")}
                  disabled={!encounterId}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
                />
              </div>
            </div>
          )}

          {/* GYNECOLOGY Section */}
          {examType === 'GYNECOLOGY' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Pap smear</label>
                  <select value={gynecology.papSmear} onChange={(e) => updateGynecology('papSmear', e.target.value)} disabled={!encounterId} className={inputCls}>
                    <option value=""><T k="선택..." /></option>
                    {PAP_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>HPV</label>
                  <select value={gynecology.hpv} onChange={(e) => updateGynecology('hpv', e.target.value)} disabled={!encounterId} className={inputCls}>
                    {HPV_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}><T k="자궁경부 소견" /></label>
                <input type="text" value={gynecology.cervixFindings} onChange={(e) => updateGynecology('cervixFindings', e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("소견 입력...")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}><T k="자궁 크기" /></label>
                  <input type="text" value={gynecology.uterusSize} onChange={(e) => updateGynecology('uterusSize', e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("예: 정상 크기")} />
                </div>
                <div>
                  <label className={labelCls}><T k="부속기" /></label>
                  <input type="text" value={gynecology.adnexa} onChange={(e) => updateGynecology('adnexa', e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("예: 양측 정상")} />
                </div>
              </div>
              <div>
                <label className={labelCls}><T k="분비물" /></label>
                <input type="text" value={gynecology.discharge} onChange={(e) => updateGynecology('discharge', e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("양, 색, 냄새...")} />
              </div>
            </div>
          )}

          {/* LABOR — 분만 기록 */}
          {examType === 'LABOR' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}><T k="분만 방식" /></label>
                  <select {...bindLabor('method')} disabled={!encounterId} className={inputCls}>
                    <option value=""><T k="선택" /></option><option><T k="자연분만(NSVD)" /></option><option><T k="제왕절개(C/S)" /></option><option><T k="유도분만" /></option><option><T k="흡인분만" /></option><option><T k="겸자분만" /></option>
                  </select></div>
                <div><label className={labelCls}><T k="분만 일시" /></label>
                  <input type="datetime-local" {...bindLabor('deliveredAt')} disabled={!encounterId} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}><T k="신생아 체중 (g)" /></label><input type="number" {...bindLabor('babyWeight')} disabled={!encounterId} className={inputCls} /></div>
                <div><label className={labelCls}><T k="Apgar 1분" /></label><input type="number" {...bindLabor('apgar1')} disabled={!encounterId} className={inputCls} placeholder="0~10" min={0} max={10} /></div>
                <div><label className={labelCls}><T k="Apgar 5분" /></label><input type="number" {...bindLabor('apgar5')} disabled={!encounterId} className={inputCls} placeholder="0~10" min={0} max={10} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}><T k="태반 만출" /></label>
                  <select {...bindLabor('placenta')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="완전" /></option><option><T k="불완전" /></option><option><T k="유착태반" /></option></select></div>
                <div><label className={labelCls}><T k="출혈량 (ml)" /></label><input type="number" {...bindLabor('ebl')} disabled={!encounterId} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}><T k="회음부" /></label>
                  <select {...bindLabor('perineum')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="정상" /></option><option><T k="1도 열상" /></option><option><T k="2도 열상" /></option><option><T k="3도 열상" /></option><option><T k="4도 열상" /></option><option><T k="회음절개" /></option></select></div>
                <div><label className={labelCls}><T k="제대혈 pH" /></label><input type="number" step="0.01" {...bindLabor('cordPh')} disabled={!encounterId} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}><T k="분만 경과 / 합병증" /></label>
                <textarea rows={2} {...bindLabor('course')} disabled={!encounterId} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none disabled:bg-gray-50" placeholder={tAttr("분만 경과, 합병증 기록...")} /></div>
            </div>
          )}

          {/* POSTPARTUM — 산후 관리 */}
          {examType === 'POSTPARTUM' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}><T k="산후 일수" /></label><input type="number" {...bindPp('days')} disabled={!encounterId} className={inputCls} /></div>
                <div><label className={labelCls}><T k="자궁 수축" /></label>
                  <select {...bindPp('uterus')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="양호" /></option><option><T k="부드러움" /></option><option><T k="이완" /></option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}><T k="오로 (Lochia)" /></label>
                  <select {...bindPp('lochia')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="적색 (Rubra)" /></option><option><T k="장액성 (Serosa)" /></option><option><T k="백색 (Alba)" /></option><option><T k="악취" /></option></select></div>
                <div><label className={labelCls}><T k="모유수유" /></label>
                  <select {...bindPp('feeding')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="완전 모유" /></option><option><T k="혼합 수유" /></option><option><T k="분유 수유" /></option><option><T k="수유 곤란" /></option></select></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}><T k="체온 (°C)" /></label><input type="number" step="0.1" {...bindPp('temp')} disabled={!encounterId} className={inputCls} /></div>
                <div><label className={labelCls}><T k="혈압" /></label><input type="text" {...bindPp('bp')} disabled={!encounterId} className={inputCls} placeholder="SBP/DBP" /></div>
                <div><label className={labelCls}><T k="맥박" /></label><input type="number" {...bindPp('pulse')} disabled={!encounterId} className={inputCls} placeholder={tAttr("회/분")} /></div>
              </div>
              <div><label className={labelCls}><T k="회음부/수술 부위" /></label>
                <select {...bindPp('wound')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="정상 치유" /></option><option><T k="부종" /></option><option><T k="감염 의심" /></option><option><T k="혈종" /></option></select></div>
              <div><label className={labelCls}><T k="정서 상태 (산후우울 선별)" /></label>
                <select {...bindPp('mood')} disabled={!encounterId} className={inputCls}><option value=""><T k="선택" /></option><option><T k="양호" /></option><option>Baby blues</option><option><T k="우울감 호소" /></option><option><T k="EPDS 시행 필요" /></option></select></div>
              <div><label className={labelCls}><T k="산후 경과 메모" /></label>
                <textarea rows={2} {...bindPp('memo')} disabled={!encounterId} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none disabled:bg-gray-50" placeholder={tAttr("산후 경과, 주의사항...")} /></div>
            </div>
          )}

          {/* Findings */}
          <div>
            <label className={labelCls}><T k="소견" /></label>
            <textarea
              rows={3}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder={tAttr("진료 소견을 입력하세요...")}
              disabled={!encounterId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={!encounterId || saveMutation.isPending}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-pink-600 text-white text-sm font-medium rounded-xl hover:bg-pink-700 transition-colors disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 기록 저장'}
          </button>
        </div>

        {/* Right: Fetal Growth Chart (prenatal only) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
            </svg>
            <T k="태아 성장 차트" />
          </h3>

          {examType === 'PRENATAL' ? (
            <>
              <div className="flex gap-2 justify-center">
                {(['bpd', 'fl', 'ac', 'efw'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setFetalMetric(m)}
                    className={`px-3 py-1 text-xs rounded-lg ${fetalMetric === m ? 'bg-pink-100 text-pink-700 font-medium' : 'bg-gray-100 text-gray-500'}`}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
              <FetalGrowthChart data={fetalData} metric={fetalMetric} />
              {fetalData.length === 0 && (
                <p className="text-center text-xs text-gray-400"><T k="임신주수와 초음파 계측값을 입력하면 차트에 표시됩니다." /></p>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-gray-400 text-sm"><T k="산전 검진 모드에서 태아 성장 차트가 표시됩니다." /></div>
          )}
        </div>
      </div>

      {rxSlot}

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.15)] border border-gray-100 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            {EXAM_TYPES.find((e) => e.value === examType)?.label}
            {examType === 'PRENATAL' && prenatal.gestationalWeeks && ` | ${prenatal.gestationalWeeks}주 ${prenatal.gestationalDays || 0}일`}
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
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-pink-600 text-white text-sm font-medium rounded-xl hover:bg-pink-700 transition-colors disabled:opacity-40"
            >
              {isSigning ? '처리중...' : '서명 완료'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
