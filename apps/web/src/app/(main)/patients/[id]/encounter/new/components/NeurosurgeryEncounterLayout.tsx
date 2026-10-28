'use client';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import DermatomeMap, { type MotorExamEntry } from '@/components/specialty/DermatomeMap';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NeurosurgeryEncounterLayoutProps {
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

/** 미평가 = '' / null — 정상값(3mm·반응+)으로 시작하지 않는다(2026-10-10) */
interface PupilExam {
  sizeL: string;
  sizeR: string;
  reactiveL: boolean | null;
  reactiveR: boolean | null;
}

interface ReflexEntry {
  name: string;
  left: string;
  right: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GCS_EYE = [
  { value: 4, label: '4 - 자발적 개안' },
  { value: 3, label: '3 - 음성 자극' },
  { value: 2, label: '2 - 통증 자극' },
  { value: 1, label: '1 - 개안 없음' },
];

const GCS_VERBAL = [
  { value: 5, label: '5 - 지남력 정상' },
  { value: 4, label: '4 - 혼동된 대화' },
  { value: 3, label: '3 - 부적절한 단어' },
  { value: 2, label: '2 - 이해불가 소리' },
  { value: 1, label: '1 - 언어 반응 없음' },
];

const GCS_MOTOR = [
  { value: 6, label: '6 - 명령 수행' },
  { value: 5, label: '5 - 통증 부위 인지' },
  { value: 4, label: '4 - 도피 반응' },
  { value: 3, label: '3 - 이상 굴곡' },
  { value: 2, label: '2 - 이상 신전' },
  { value: 1, label: '1 - 운동 반응 없음' },
];

const SPINAL_LEVELS = ['C5', 'C6', 'C7', 'C8', 'T1', 'L2', 'L3', 'L4', 'L5', 'S1'];
const MOTOR_GRADES = ['0', '1', '2', '3', '4', '5'];

const DTR_OPTIONS = ['0', '1+', '2+', '3+', '4+'];
const DTR_REFLEXES = ['이두근', '삼두근', '요골', '슬개건', '아킬레스건'];

const PUPIL_SIZES = ['1', '2', '3', '4', '5', '6', '7', '8'];

/** 동공 한쪽 — 크기·반응 중 하나라도 평가했을 때만(크기는 숫자) */
export function pupilPayload(size: string, reactive: boolean | null): { size?: number; reactive?: boolean } | null {
  const n = size !== '' && Number.isFinite(Number(size)) ? Number(size) : null;
  if (n == null && reactive == null) return null;
  return { ...(n != null ? { size: n } : {}), ...(reactive != null ? { reactive } : {}) };
}

/** 하단 요약 — 🔴 반응을 고르지 않았는데 `(-)`(무반응)로 그리던 것 → 평가하지 않은 칸은 — */
export function pupilSummary(size: string, reactive: boolean | null): string {
  const sz = size !== '' ? `${size}mm` : '—';
  const re = reactive == null ? '—' : reactive ? '+' : '-';
  return `${sz}(${re})`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NeurosurgeryEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient: _patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: NeurosurgeryEncounterLayoutProps) {
  const tAttr = useTAttr();
  // 🔴 (2026-10-10) 쓰기 폼은 미선택으로 시작 — 종전 E4 V5 M6(=15, 명료)로 시작해 고르지 않고 저장하면 "정상 의식"이 기록됐다
  const [gcsEye, setGcsEye] = useState<number | null>(null);
  const [gcsVerbal, setGcsVerbal] = useState<number | null>(null);
  const [gcsMotor, setGcsMotor] = useState<number | null>(null);
  // NIHSS(뇌졸중)·ASIA(척수 손상) — 서버 원장 칸은 있었는데 입력 칸이 없어 이 화면으로는 기록된 적이 없다. 해당 환자에게만 적는다(미선택 시작)
  const [nihss, setNihss] = useState('');
  const [asiaScale, setAsiaScale] = useState('');
  const nihssValue = /^\d{1,2}$/.test(nihss.trim()) && Number(nihss) <= 42 ? Number(nihss) : null;
  const nihssInvalid = nihss.trim() !== '' && nihssValue == null;

  // 🔴 (2026-10-10) 동공 3mm·반응+ · 근력 전 분절 5 · DTR 2+ · Babinski 음성으로 시작해, 고르지 않고 저장하면
  //    보지 않은 항목이 "정상 신경학적 소견"으로 원장에 남았다 — 전부 미평가로 시작하고 고른 항목만 보낸다
  const [pupil, setPupil] = useState<PupilExam>({ sizeL: '', sizeR: '', reactiveL: null, reactiveR: null });

  const [motorExam, setMotorExam] = useState<Record<string, { left: number | null; right: number | null }>>(
    Object.fromEntries(SPINAL_LEVELS.map((l) => [l, { left: null, right: null }])),
  );

  const [reflexes, setReflexes] = useState<ReflexEntry[]>(
    DTR_REFLEXES.map((name) => ({ name, left: '', right: '' })),
  );
  const [babinski, setBabinski] = useState<{ left: '+' | '-' | null; right: '+' | '-' | null }>({ left: null, right: null });

  const [findings, setFindings] = useState('');

  // 세 항목이 다 골라졌을 때만 총점 — 일부만 고르면 합계를 지어내지 않는다(삽관 환자 V 미측정 등)
  const gcsTotal = useMemo(() => (gcsEye != null && gcsVerbal != null && gcsMotor != null ? gcsEye + gcsVerbal + gcsMotor : null), [gcsEye, gcsVerbal, gcsMotor]);

  const gcsLabel = useMemo(() => {
    if (gcsTotal == null) return { label: '미측정', color: 'text-gray-500 bg-gray-100' };
    if (gcsTotal <= 8) return { label: '중증', color: 'text-red-600 bg-red-50' };
    if (gcsTotal <= 12) return { label: '중등도', color: 'text-yellow-600 bg-yellow-50' };
    return { label: '경미', color: 'text-green-600 bg-green-50' };
  }, [gcsTotal]);

  // Dermatome map data
  const dermatomeData: MotorExamEntry[] = useMemo(
    () => SPINAL_LEVELS.map((level) => ({
      level,
      left: motorExam[level].left,
      right: motorExam[level].right,
    })),
    [motorExam],
  );

  const updateMotor = (level: string, side: 'left' | 'right', grade: number | null) => {
    setMotorExam((prev) => ({
      ...prev,
      [level]: { ...prev[level], [side]: grade },
    }));
  };

  const updateReflex = (idx: number, side: 'left' | 'right', value: string) => {
    setReflexes((prev) => prev.map((r, i) => (i === idx ? { ...r, [side]: value } : r)));
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      // 🔴 GCS 와 동공 소견이 **중첩 키**로 나가 서버 DTO(whitelist)에서 통째로 버려지고 있었다 —
      //    신경외과에서 의식수준·동공은 악화를 판단하는 값이라 유실이 곧 경과 관찰 단절이다.
      //    정본은 평탄화된 컬럼(gcsEye·gcsVerbal·gcsMotor·gcsTotal·pupilLeft·pupilRight).
      //    anisocoria 는 화면에 입력란이 없어 보내지 않는다(크기 차이로 추정하지 않는다).
      //    소견(findings)은 SOAP objective 로 저장된다(buildSoap).
      apiClient.post('/api/v1/neurosurgery/exams', {
        patientId,
        encounterId,
        // 고른 것만 보낸다 — null 을 0 이나 정상값으로 접지 않는다
        ...(gcsEye != null ? { gcsEye } : {}),
        ...(gcsVerbal != null ? { gcsVerbal } : {}),
        ...(gcsMotor != null ? { gcsMotor } : {}),
        ...(gcsTotal != null ? { gcsTotal } : {}),
        ...(nihssValue != null ? { nihss: nihssValue } : {}),
        ...(asiaScale ? { asiaScale } : {}),
        // 동공 크기는 숫자로(읽는 화면이 number 만 크기로 읽는다 — 종전 문자열 '3' 은 부서 화면에서 '-' 였다)
        ...(pupilPayload(pupil.sizeL, pupil.reactiveL) ? { pupilLeft: pupilPayload(pupil.sizeL, pupil.reactiveL) } : {}),
        ...(pupilPayload(pupil.sizeR, pupil.reactiveR) ? { pupilRight: pupilPayload(pupil.sizeR, pupil.reactiveR) } : {}),
        ...(dermatomeData.some((e) => e.left != null || e.right != null) ? { motorExam: dermatomeData.filter((e) => e.left != null || e.right != null) } : {}),
        ...(reflexes.some((r) => r.left || r.right) ? { reflexes: reflexes.filter((r) => r.left || r.right) } : {}),
        ...(babinski.left || babinski.right ? { babinski } : {}),
      }),
    onSuccess: () => toast.success('신경외과 검사가 저장되었습니다.'),
    onError: () => toast.error('저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => ({
    objective: findings || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: GCS + Pupil + Motor */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0" />
            </svg>
            <T k="신경학적 검사" />
          </h3>

          {/* GCS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">GCS (Glasgow Coma Scale)</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-gray-800">{gcsTotal ?? '—'}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${gcsLabel.color} whitespace-nowrap`}>
                  {gcsLabel.label}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className={labelCls}>Eye (E: 1-4)</label>
                <select value={gcsEye ?? ''} onChange={(e) => setGcsEye(e.target.value === '' ? null : parseInt(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value="">{tAttr('— 선택 —')}</option>
                  {GCS_EYE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Verbal (V: 1-5)</label>
                <select value={gcsVerbal ?? ''} onChange={(e) => setGcsVerbal(e.target.value === '' ? null : parseInt(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value="">{tAttr('— 선택 —')}</option>
                  {GCS_VERBAL.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Motor (M: 1-6)</label>
                <select value={gcsMotor ?? ''} onChange={(e) => setGcsMotor(e.target.value === '' ? null : parseInt(e.target.value))} disabled={!encounterId} className={inputCls}>
                  <option value="">{tAttr('— 선택 —')}</option>
                  {GCS_MOTOR.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Pupil */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="동공 반사" /></p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600 text-center"><T k="좌 (L)" /></p>
                <div>
                  <label className={labelCls}><T k="크기 (mm)" /></label>
                  <select value={pupil.sizeL} onChange={(e) => setPupil((p) => ({ ...p, sizeL: e.target.value }))} disabled={!encounterId} className={inputCls} data-pupil-size="L">
                    <option value="">{tAttr('— 평가 안 함 —')}</option>
                    {PUPIL_SIZES.map((s) => <option key={s} value={s}>{s}mm</option>)}
                  </select>
                </div>
                <label className="block">
                  <span className={labelCls}><T k="대광 반사" /></span>
                  <select value={pupil.reactiveL == null ? '' : pupil.reactiveL ? '+' : '-'} data-pupil-reactive="L"
                    onChange={(e) => setPupil((p) => ({ ...p, reactiveL: e.target.value === '' ? null : e.target.value === '+' }))}
                    disabled={!encounterId} className={inputCls}>
                    <option value="">{tAttr('— 평가 안 함 —')}</option>
                    <option value="+">{tAttr('반응 (+)')}</option>
                    <option value="-">{tAttr('무반응 (-)')}</option>
                  </select>
                </label>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-600 text-center"><T k="우 (R)" /></p>
                <div>
                  <label className={labelCls}><T k="크기 (mm)" /></label>
                  <select value={pupil.sizeR} onChange={(e) => setPupil((p) => ({ ...p, sizeR: e.target.value }))} disabled={!encounterId} className={inputCls} data-pupil-size="R">
                    <option value="">{tAttr('— 평가 안 함 —')}</option>
                    {PUPIL_SIZES.map((s) => <option key={s} value={s}>{s}mm</option>)}
                  </select>
                </div>
                <label className="block">
                  <span className={labelCls}><T k="대광 반사" /></span>
                  <select value={pupil.reactiveR == null ? '' : pupil.reactiveR ? '+' : '-'} data-pupil-reactive="R"
                    onChange={(e) => setPupil((p) => ({ ...p, reactiveR: e.target.value === '' ? null : e.target.value === '+' }))}
                    disabled={!encounterId} className={inputCls}>
                    <option value="">{tAttr('— 평가 안 함 —')}</option>
                    <option value="+">{tAttr('반응 (+)')}</option>
                    <option value="-">{tAttr('무반응 (-)')}</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          {/* Motor Exam */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="근력 검사 (C5-S1)" /></p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-center px-2 py-2 font-medium text-gray-500 w-12"><T k="레벨" /></th>
                    <th className="text-center px-2 py-2 font-medium text-gray-500 w-16"><T k="좌 (L)" /></th>
                    <th className="text-center px-2 py-2 font-medium text-gray-500 w-16"><T k="우 (R)" /></th>
                  </tr>
                </thead>
                <tbody>
                  {SPINAL_LEVELS.map((level) => (
                    <tr key={level} className="border-t border-gray-100">
                      <td className="text-center px-2 py-1.5 font-medium text-gray-700">{level}</td>
                      <td className="text-center px-2 py-1.5">
                        <select
                          value={motorExam[level].left ?? ''}
                          onChange={(e) => updateMotor(level, 'left', e.target.value === '' ? null : parseInt(e.target.value))}
                          disabled={!encounterId}
                          className="w-12 px-1 py-1 border border-gray-200 rounded text-center text-xs focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                        >
                          <option value="">—</option>
                          {MOTOR_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td className="text-center px-2 py-1.5">
                        <select
                          value={motorExam[level].right ?? ''}
                          onChange={(e) => updateMotor(level, 'right', e.target.value === '' ? null : parseInt(e.target.value))}
                          disabled={!encounterId}
                          className="w-12 px-1 py-1 border border-gray-200 rounded text-center text-xs focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                        >
                          <option value="">—</option>
                          {MOTOR_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reflexes */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="심부건 반사 (DTR)" /></p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 font-medium text-gray-500"><T k="반사" /></th>
                    <th className="text-center px-2 py-2 font-medium text-gray-500 w-16">좌</th>
                    <th className="text-center px-2 py-2 font-medium text-gray-500 w-16">우</th>
                  </tr>
                </thead>
                <tbody>
                  {reflexes.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-1.5 text-gray-700">{r.name}</td>
                      <td className="text-center px-2 py-1.5">
                        <select value={r.left} onChange={(e) => updateReflex(i, 'left', e.target.value)} disabled={!encounterId} className="w-14 px-1 py-1 border border-gray-200 rounded text-center text-xs disabled:bg-gray-50">
                          <option value="">—</option>
                          {DTR_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="text-center px-2 py-1.5">
                        <select value={r.right} onChange={(e) => updateReflex(i, 'right', e.target.value)} disabled={!encounterId} className="w-14 px-1 py-1 border border-gray-200 rounded text-center text-xs disabled:bg-gray-50">
                          <option value="">—</option>
                          {DTR_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Babinski */}
            <div className="flex items-center gap-4 mt-2">
              <span className="text-xs font-medium text-gray-700">Babinski:</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">좌</span>
                <button
                  // 미평가 → 음성 → 양성 → 미평가
                  onClick={() => setBabinski((p) => ({ ...p, left: p.left == null ? '-' : p.left === '-' ? '+' : null }))}
                  disabled={!encounterId}
                  className={`px-2 py-1 text-xs rounded-lg font-medium ${
                    babinski.left === '+' ? 'bg-red-100 text-red-700' : babinski.left === '-' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  } disabled:opacity-50`}
                  data-babinski="left"
                >
                  {babinski.left ?? '—'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">우</span>
                <button
                  // 미평가 → 음성 → 양성 → 미평가
                  onClick={() => setBabinski((p) => ({ ...p, right: p.right == null ? '-' : p.right === '-' ? '+' : null }))}
                  disabled={!encounterId}
                  className={`px-2 py-1 text-xs rounded-lg font-medium ${
                    babinski.right === '+' ? 'bg-red-100 text-red-700' : babinski.right === '-' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  } disabled:opacity-50`}
                  data-babinski="right"
                >
                  {babinski.right ?? '—'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dermatome Map + Findings */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3" />
            </svg>
            <T k="근력 맵" />
          </h3>

          <DermatomeMap motorExam={dermatomeData} />

          {/* NIHSS · ASIA — 해당 환자에게만(빈 칸 = 평가하지 않음) */}
          <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>NIHSS (0-42)</label>
              <input inputMode="numeric" value={nihss} onChange={(e) => setNihss(e.target.value)} disabled={!encounterId} data-nihss-input
                className={`${inputCls} ${nihssInvalid ? 'border-red-400' : ''}`} aria-invalid={nihssInvalid} />
              {nihssInvalid && <p className="mt-1 text-[10px] text-red-600"><T k="0~42 사이 정수만 기록할 수 있습니다" /></p>}
            </div>
            <div>
              <label className={labelCls}><T k="ASIA 손상 척도" /></label>
              <select value={asiaScale} onChange={(e) => setAsiaScale(e.target.value)} disabled={!encounterId} className={inputCls} data-asia-select>
                <option value="">{tAttr('— 평가 안 함 —')}</option>
                {['A', 'B', 'C', 'D', 'E'].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* Findings */}
          <div className="pt-4 border-t border-gray-100">
            <label className={labelCls}><T k="소견" /></label>
            <textarea
              rows={4}
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              placeholder={tAttr("신경학적 소견을 입력하세요...")}
              disabled={!encounterId}
              className="w-full px-3 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none disabled:bg-gray-50 placeholder:text-gray-300"
            />
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={!encounterId || saveMutation.isPending || nihssInvalid}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {saveMutation.isPending ? '저장중...' : '검사 기록 저장'}
          </button>
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
            GCS: E{gcsEye ?? '-'}V{gcsVerbal ?? '-'}M{gcsMotor ?? '-'} = {gcsTotal ?? '—'} ({gcsLabel.label})
            | 동공: <span data-pupil-summary>L{pupilSummary(pupil.sizeL, pupil.reactiveL)} R{pupilSummary(pupil.sizeR, pupil.reactiveR)}</span>
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
