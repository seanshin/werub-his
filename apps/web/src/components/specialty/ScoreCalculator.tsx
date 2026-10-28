'use client';

import { useState, useCallback, useEffect } from 'react';

import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ScoreType = 'cha2ds2vasc' | 'curb65' | 'child-pugh' | 'meld' | 'egfr' | 'qsofa' | 'das28';

interface ScoreCalculatorProps {
  type: ScoreType;
  onResult?: (result: { score: number; interpretation: string }) => void;
}

interface CalcResult {
  score: number;
  interpretation: string;
  riskLevel: 'low' | 'moderate' | 'high';
}

/* ------------------------------------------------------------------ */
/*  Risk level styling                                                 */
/* ------------------------------------------------------------------ */

const RISK_STYLES: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

const RISK_DOT: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
};

/* ------------------------------------------------------------------ */
/*  Score Titles                                                       */
/* ------------------------------------------------------------------ */

const SCORE_TITLES: Record<ScoreType, string> = {
  cha2ds2vasc: 'CHA2DS2-VASc Score',
  curb65: 'CURB-65 Score',
  'child-pugh': 'Child-Pugh Score',
  meld: 'MELD Score',
  egfr: 'eGFR (CKD-EPI)',
  qsofa: 'qSOFA Score',
  das28: 'DAS28-ESR Score',
};

/* ------------------------------------------------------------------ */
/*  CHA2DS2-VASc Calculator                                            */
/* ------------------------------------------------------------------ */

function CHA2DS2VASc({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [chf, setChf] = useState(false);
  const [htn, setHtn] = useState(false);
  const [age75, setAge75] = useState(false);
  const [dm, setDm] = useState(false);
  const [stroke, setStroke] = useState(false);
  const [vascular, setVascular] = useState(false);
  const [age65, setAge65] = useState(false);
  const [female, setFemale] = useState(false);

  const calculate = useCallback(() => {
    let score = 0;
    if (chf) score += 1;
    if (htn) score += 1;
    if (age75) score += 2;
    if (dm) score += 1;
    if (stroke) score += 2;
    if (vascular) score += 1;
    if (age65) score += 1;
    if (female) score += 1;

    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (score === 0) { interpretation = tfAttr('저위험 (연간 뇌졸중 위험 ~0%)', {}); riskLevel = 'low'; }
    else if (score === 1) { interpretation = tfAttr('중간위험 (연간 뇌졸중 위험 ~1.3%)', {}); riskLevel = 'moderate'; }
    else { interpretation = tfAttr('고위험 (점수 {점수}, 항응고 치료 권고)', { 점수: score }); riskLevel = 'high'; }

    onCalc({ score, interpretation, riskLevel });
  }, [chf, htn, age75, dm, stroke, vascular, age65, female, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  const items: { label: string; value: boolean; setter: (v: boolean) => void; points: string }[] = [
    { label: 'CHF (울혈성 심부전)', value: chf, setter: setChf, points: '+1' },
    { label: 'HTN (고혈압)', value: htn, setter: setHtn, points: '+1' },
    { label: 'Age >= 75세', value: age75, setter: setAge75, points: '+2' },
    { label: 'DM (당뇨)', value: dm, setter: setDm, points: '+1' },
    { label: 'Stroke/TIA (뇌졸중/일과성허혈)', value: stroke, setter: setStroke, points: '+2' },
    { label: 'Vascular disease (혈관질환)', value: vascular, setter: setVascular, points: '+1' },
    { label: 'Age 65-74세', value: age65, setter: setAge65, points: '+1' },
    { label: 'Sex category (여성)', value: female, setter: setFemale, points: '+1' },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <label key={item.label} className="flex items-center gap-3 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.value}
            onChange={(e) => item.setter(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 flex-1"><T k={item.label} /></span>
          <span className="text-xs text-gray-400 font-mono">{item.points}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CURB-65 Calculator                                                 */
/* ------------------------------------------------------------------ */

function CURB65({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [confusion, setConfusion] = useState(false);
  const [urea, setUrea] = useState(false);
  const [rr, setRr] = useState(false);
  const [bp, setBp] = useState(false);
  const [age65, setAge65] = useState(false);

  const calculate = useCallback(() => {
    const score = [confusion, urea, rr, bp, age65].filter(Boolean).length;
    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (score <= 1) { interpretation = tfAttr('저위험 (외래 치료 가능)', {}); riskLevel = 'low'; }
    else if (score === 2) { interpretation = tfAttr('중간위험 (단기 입원 고려)', {}); riskLevel = 'moderate'; }
    else { interpretation = tfAttr('고위험 (점수 {점수}, 입원/ICU 권고)', { 점수: score }); riskLevel = 'high'; }
    onCalc({ score, interpretation, riskLevel });
  }, [confusion, urea, rr, bp, age65, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  const items = [
    { label: 'Confusion (의식저하)', value: confusion, setter: setConfusion },
    { label: 'Urea > 7 mmol/L (BUN > 19 mg/dL)', value: urea, setter: setUrea },
    { label: 'Respiratory rate >= 30/min', value: rr, setter: setRr },
    { label: 'Blood pressure (SBP < 90 or DBP <= 60)', value: bp, setter: setBp },
    { label: 'Age >= 65세', value: age65, setter: setAge65 },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <label key={item.label} className="flex items-center gap-3 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.value}
            onChange={(e) => item.setter(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700"><T k={item.label} /></span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Child-Pugh Calculator                                              */
/* ------------------------------------------------------------------ */

function ChildPugh({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const tAttr = useTAttr();
  const [bilirubin, setBilirubin] = useState(1); // 1=<2, 2=2-3, 3=>3
  const [albumin, setAlbumin] = useState(1);     // 1=>3.5, 2=2.8-3.5, 3=<2.8
  const [inr, setInr] = useState(1);             // 1=<1.7, 2=1.7-2.3, 3=>2.3
  const [ascites, setAscites] = useState(1);     // 1=none, 2=mild, 3=moderate-severe
  const [encephalopathy, setEncephalopathy] = useState(1); // 1=none, 2=grade1-2, 3=grade3-4

  const calculate = useCallback(() => {
    const score = bilirubin + albumin + inr + ascites + encephalopathy;
    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (score <= 6) { interpretation = tfAttr('Class A ({점수}점) - 양호한 간기능', { 점수: score }); riskLevel = 'low'; }
    else if (score <= 9) { interpretation = tfAttr('Class B ({점수}점) - 중등도 간기능 저하', { 점수: score }); riskLevel = 'moderate'; }
    else { interpretation = tfAttr('Class C ({점수}점) - 중증 간기능 저하', { 점수: score }); riskLevel = 'high'; }
    onCalc({ score, interpretation, riskLevel });
  }, [bilirubin, albumin, inr, ascites, encephalopathy, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  const selects: { label: string; value: number; setter: (v: number) => void; options: { value: number; label: string }[] }[] = [
    { label: '빌리루빈 (mg/dL)', value: bilirubin, setter: setBilirubin, options: [{ value: 1, label: '< 2' }, { value: 2, label: '2 - 3' }, { value: 3, label: '> 3' }] },
    { label: '알부민 (g/dL)', value: albumin, setter: setAlbumin, options: [{ value: 1, label: '> 3.5' }, { value: 2, label: '2.8 - 3.5' }, { value: 3, label: '< 2.8' }] },
    { label: 'INR', value: inr, setter: setInr, options: [{ value: 1, label: '< 1.7' }, { value: 2, label: '1.7 - 2.3' }, { value: 3, label: '> 2.3' }] },
    { label: '복수', value: ascites, setter: setAscites, options: [{ value: 1, label: '없음' }, { value: 2, label: '경도' }, { value: 3, label: '중등도-중증' }] },
    { label: '간성뇌증', value: encephalopathy, setter: setEncephalopathy, options: [{ value: 1, label: '없음' }, { value: 2, label: 'Grade 1-2' }, { value: 3, label: 'Grade 3-4' }] },
  ];

  return (
    <div className="space-y-3">
      {selects.map((s) => (
        <div key={s.label}>
          <label className="block text-sm text-gray-700 mb-1"><T k={s.label} /></label>
          <select
            value={s.value}
            onChange={(e) => s.setter(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {tAttr(o.label)} ({o.value}{tAttr('점')})
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MELD Calculator                                                    */
/* ------------------------------------------------------------------ */

function MELD({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [bilirubinVal, setBilirubinVal] = useState('');
  const [creatinineVal, setCreatinineVal] = useState('');
  const [inrVal, setInrVal] = useState('');
  const [naVal, setNaVal] = useState('');

  const calculate = useCallback(() => {
    const bili = Math.max(1, parseFloat(bilirubinVal) || 1);
    const cr = Math.min(4, Math.max(1, parseFloat(creatinineVal) || 1));
    const inr = Math.max(1, parseFloat(inrVal) || 1);
    const na = Math.min(137, Math.max(125, parseFloat(naVal) || 137));

    // MELD-Na formula
    const meld = 10 * (0.957 * Math.log(cr) + 0.378 * Math.log(bili) + 1.12 * Math.log(inr) + 0.643);
    const roundedMeld = Math.round(meld);
    const meldNa = Math.round(roundedMeld - na * (0.025 * roundedMeld) * (140 - na) / (140 - 125) + 140 * (0.025 * roundedMeld) * (140 - 137) / (140 - 125));
    const finalScore = Math.max(6, Math.min(40, isNaN(meldNa) ? roundedMeld : meldNa));

    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (finalScore < 10) { interpretation = tfAttr('MELD {점수} - 3개월 사망률 < 2%', { 점수: finalScore }); riskLevel = 'low'; }
    else if (finalScore < 20) { interpretation = tfAttr('MELD {점수} - 3개월 사망률 6-20%', { 점수: finalScore }); riskLevel = 'moderate'; }
    else { interpretation = tfAttr('MELD {점수} - 3개월 사망률 > 20%, 이식 고려', { 점수: finalScore }); riskLevel = 'high'; }
    onCalc({ score: finalScore, interpretation, riskLevel });
  }, [bilirubinVal, creatinineVal, inrVal, naVal, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="빌리루빈 (mg/dL)" /></label>
        <input type="number" step="0.1" value={bilirubinVal} onChange={(e) => setBilirubinVal(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="크레아티닌 (mg/dL)" /></label>
        <input type="number" step="0.1" value={creatinineVal} onChange={(e) => setCreatinineVal(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">INR</label>
        <input type="number" step="0.1" value={inrVal} onChange={(e) => setInrVal(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="나트륨 Na (mEq/L)" /></label>
        <input type="number" step="1" value={naVal} onChange={(e) => setNaVal(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  eGFR Calculator (CKD-EPI)                                          */
/* ------------------------------------------------------------------ */

function EGFR({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [creatinine, setCreatinine] = useState('');
  const [age, setAge] = useState('');
  const [isFemale, setIsFemale] = useState(false);

  const calculate = useCallback(() => {
    const cr = parseFloat(creatinine) || 0;
    const ageVal = parseInt(age) || 0;
    if (cr <= 0 || ageVal <= 0) {
      onCalc({ score: 0, interpretation: '입력값을 확인하세요', riskLevel: 'low' });
      return;
    }

    // CKD-EPI 2021 formula (without race)
    const kappa = isFemale ? 0.7 : 0.9;
    const alpha = isFemale ? -0.241 : -0.302;
    const femaleMultiplier = isFemale ? 1.012 : 1.0;

    const minCrK = Math.min(cr / kappa, 1);
    const maxCrK = Math.max(cr / kappa, 1);

    const egfr = Math.round(
      142 * Math.pow(minCrK, alpha) * Math.pow(maxCrK, -1.2) * Math.pow(0.9938, ageVal) * femaleMultiplier
    );

    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (egfr >= 90) { interpretation = tfAttr('eGFR {값} - G1 정상 또는 높음', { 값: egfr }); riskLevel = 'low'; }
    else if (egfr >= 60) { interpretation = tfAttr('eGFR {값} - G2 경도 감소', { 값: egfr }); riskLevel = 'low'; }
    else if (egfr >= 45) { interpretation = tfAttr('eGFR {값} - G3a 경도-중등도 감소', { 값: egfr }); riskLevel = 'moderate'; }
    else if (egfr >= 30) { interpretation = tfAttr('eGFR {값} - G3b 중등도-중증 감소', { 값: egfr }); riskLevel = 'moderate'; }
    else if (egfr >= 15) { interpretation = tfAttr('eGFR {값} - G4 중증 감소', { 값: egfr }); riskLevel = 'high'; }
    else { interpretation = tfAttr('eGFR {값} - G5 신부전', { 값: egfr }); riskLevel = 'high'; }

    onCalc({ score: egfr, interpretation, riskLevel });
  }, [creatinine, age, isFemale, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="혈청 크레아티닌 (mg/dL)" /></label>
        <input type="number" step="0.01" value={creatinine} onChange={(e) => setCreatinine(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="나이 (세)" /></label>
        <input type="number" value={age} onChange={(e) => setAge(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <label className="flex items-center gap-3 py-1.5 cursor-pointer">
        <input type="checkbox" checked={isFemale} onChange={(e) => setIsFemale(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span className="text-sm text-gray-700"><T k="여성" /></span>
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  qSOFA Calculator                                                   */
/* ------------------------------------------------------------------ */

function QSOFA({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [mentalChange, setMentalChange] = useState(false);
  const [rrHigh, setRrHigh] = useState(false);
  const [bpLow, setBpLow] = useState(false);

  const calculate = useCallback(() => {
    const score = [mentalChange, rrHigh, bpLow].filter(Boolean).length;
    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (score <= 1) { interpretation = tfAttr('저위험 (일반 감시)', {}); riskLevel = 'low'; }
    else { interpretation = tfAttr('고위험 (qSOFA {점수}, 패혈증 의심 - SOFA 평가 권고)', { 점수: score }); riskLevel = 'high'; }
    onCalc({ score, interpretation, riskLevel });
  }, [mentalChange, rrHigh, bpLow, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  const items = [
    { label: '의식변화 (GCS < 15)', value: mentalChange, setter: setMentalChange },
    { label: '호흡수 >= 22/min', value: rrHigh, setter: setRrHigh },
    { label: '수축기혈압 <= 100 mmHg', value: bpLow, setter: setBpLow },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <label key={item.label} className="flex items-center gap-3 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.value}
            onChange={(e) => item.setter(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700"><T k={item.label} /></span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DAS28-ESR Calculator                                               */
/* ------------------------------------------------------------------ */

function DAS28({ onCalc }: { onCalc: (r: CalcResult) => void }) {
  const tfAttr = useTfAttr();
  const [tjc, setTjc] = useState('');
  const [sjc, setSjc] = useState('');
  const [esr, setEsr] = useState('');
  const [vas, setVas] = useState('');

  const calculate = useCallback(() => {
    const tjcVal = parseInt(tjc) || 0;
    const sjcVal = parseInt(sjc) || 0;
    const esrVal = parseFloat(esr) || 0;
    const vasVal = parseFloat(vas) || 0;

    if (tjcVal === 0 && sjcVal === 0 && esrVal === 0 && vasVal === 0) {
      onCalc({ score: 0, interpretation: '입력값을 확인하세요', riskLevel: 'low' });
      return;
    }

    // DAS28-ESR = 0.56*sqrt(TJC28) + 0.28*sqrt(SJC28) + 0.70*ln(ESR) + 0.014*VAS
    const score = parseFloat(
      (0.56 * Math.sqrt(tjcVal) + 0.28 * Math.sqrt(sjcVal) + 0.7 * Math.log(Math.max(esrVal, 1)) + 0.014 * vasVal).toFixed(2)
    );

    let interpretation: string;
    let riskLevel: 'low' | 'moderate' | 'high';
    if (score < 2.6) { interpretation = tfAttr('DAS28 {점수} - 관해 (Remission)', { 점수: score }); riskLevel = 'low'; }
    else if (score <= 3.2) { interpretation = tfAttr('DAS28 {점수} - 저활성도 (Low activity)', { 점수: score }); riskLevel = 'low'; }
    else if (score <= 5.1) { interpretation = tfAttr('DAS28 {점수} - 중등도 활성 (Moderate activity)', { 점수: score }); riskLevel = 'moderate'; }
    else { interpretation = tfAttr('DAS28 {점수} - 고활성도 (High activity)', { 점수: score }); riskLevel = 'high'; }
    onCalc({ score, interpretation, riskLevel });
  }, [tjc, sjc, esr, vas, onCalc, tfAttr]);

  useEffect(() => { calculate(); }, [calculate]);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="압통관절수 TJC (0-28)" /></label>
        <input type="number" min="0" max="28" value={tjc} onChange={(e) => setTjc(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="종창관절수 SJC (0-28)" /></label>
        <input type="number" min="0" max="28" value={sjc} onChange={(e) => setSjc(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">ESR (mm/h)</label>
        <input type="number" step="1" value={esr} onChange={(e) => setEsr(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1"><T k="환자 VAS (0-100 mm)" /></label>
        <input type="number" min="0" max="100" value={vas} onChange={(e) => setVas(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function ScoreCalculator({ type, onResult }: ScoreCalculatorProps) {
  const [result, setResult] = useState<CalcResult | null>(null);

  const handleCalc = useCallback(
    (r: CalcResult) => {
      setResult(r);
      onResult?.({ score: r.score, interpretation: r.interpretation });
    },
    [onResult],
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-bold text-gray-900 mb-4">{SCORE_TITLES[type]}</h3>

      {type === 'cha2ds2vasc' && <CHA2DS2VASc onCalc={handleCalc} />}
      {type === 'curb65' && <CURB65 onCalc={handleCalc} />}
      {type === 'child-pugh' && <ChildPugh onCalc={handleCalc} />}
      {type === 'meld' && <MELD onCalc={handleCalc} />}
      {type === 'egfr' && <EGFR onCalc={handleCalc} />}
      {type === 'qsofa' && <QSOFA onCalc={handleCalc} />}
      {type === 'das28' && <DAS28 onCalc={handleCalc} />}

      {/* Result display */}
      {result && (
        <div className={`mt-4 p-3 rounded-xl border ${RISK_STYLES[result.riskLevel]}`}>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${RISK_DOT[result.riskLevel]}`} />
            <span className="text-lg font-bold">{result.score}</span>
          </div>
          <p className="text-sm mt-1">{result.interpretation}</p>
        </div>
      )}
    </div>
  );
}
