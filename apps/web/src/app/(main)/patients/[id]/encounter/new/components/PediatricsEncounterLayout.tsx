'use client';
import { ageInMonths } from '@hospital-run/shared';

import type { ReactNode } from 'react';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import GrowthCurveChart, { type GrowthDataPoint, type GrowthSex } from '@/components/specialty/GrowthCurveChart';
import { devOverallResult } from '@/lib/specialty/pediatrics-views';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PediatricsEncounterLayoutProps {
  /** 처방 열(페이지가 넘긴다) — 서명 바 위에 그린다. 종전엔 진료과 레이아웃에 처방 입력이 없었다 */
  rxSlot?: ReactNode;
  patientId: string;
  encounterId: string | null;
  onStartEncounter: () => void;
  /** `gender` = 환자 원장의 등록 성별(MALE/FEMALE/OTHER/UNKNOWN). 성장곡선 참조선 선택에 쓴다. */
  patient: { familyName?: string; givenName?: string; mrn?: string; gender?: string; dateOfBirth?: string | null };
  onSaveDraft: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  onSignAndBill: (data?: { subjective?: string; objective?: string; assessment?: string; plan?: string }) => void;
  isSaving: boolean;
  isSigning: boolean;
}

type DevDomain = 'GROSS_MOTOR' | 'FINE_MOTOR' | 'LANGUAGE' | 'SOCIAL';
type DevResult = 'NORMAL' | 'SUSPECT' | 'DELAYED' | '';

interface ImmunizationItem {
  done: boolean;
  /** 접종일 — **비어 있으면 저장하지 않는다.** 오늘로 기본값을 넣으면 실제로 안 한 접종을 오늘 한 것으로 기록한다. */
  date: string;
  lotNumber: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEV_DOMAINS: { key: DevDomain; label: string; description: string }[] = [
  { key: 'GROSS_MOTOR', label: '대근육 운동', description: '걷기, 뛰기, 계단 오르기' },
  { key: 'FINE_MOTOR', label: '소근육 운동', description: '잡기, 그리기, 블록 쌓기' },
  { key: 'LANGUAGE', label: '언어', description: '말하기, 이해력, 표현력' },
  { key: 'SOCIAL', label: '사회성', description: '상호작용, 감정 표현' },
];

const DEV_RESULTS: { value: DevResult; label: string; color: string }[] = [
  { value: '', label: '미평가', color: 'bg-gray-100 text-gray-500' },
  { value: 'NORMAL', label: '정상', color: 'bg-green-100 text-green-700' },
  { value: 'SUSPECT', label: '의심', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'DELAYED', label: '지연', color: 'bg-red-100 text-red-700' },
];

/**
 * 🔴 백신명·차수를 **레이블 문자열에서 파싱하지 않는다** — 서버 `CreateImmunizationDto` 는
 *    `vaccineName` 과 `doseNumber` 를 따로 받고, 문자열을 쪼개면 '수두'·'인플루엔자' 같은 무차수 항목에서 어긋난다.
 *    `vaccineName` 은 서버 표준일정표(`IMMUNIZATION_SCHEDULE`) 키와 맞춘다 — 안 맞으면 간격·차수 검증이 조용히 꺼진다.
 */
const IMMUNIZATION_LIST: { label: string; vaccineName: string; doseNumber: number }[] = [
  { label: 'BCG', vaccineName: 'BCG', doseNumber: 1 },
  { label: 'B형간염 1차', vaccineName: 'HepB', doseNumber: 1 },
  { label: 'B형간염 2차', vaccineName: 'HepB', doseNumber: 2 },
  { label: 'B형간염 3차', vaccineName: 'HepB', doseNumber: 3 },
  { label: 'DTaP 1차', vaccineName: 'DTaP', doseNumber: 1 },
  { label: 'DTaP 2차', vaccineName: 'DTaP', doseNumber: 2 },
  { label: 'DTaP 3차', vaccineName: 'DTaP', doseNumber: 3 },
  { label: 'DTaP 4차', vaccineName: 'DTaP', doseNumber: 4 },
  { label: 'DTaP 5차', vaccineName: 'DTaP', doseNumber: 5 },
  { label: 'IPV 1차', vaccineName: 'IPV', doseNumber: 1 },
  { label: 'IPV 2차', vaccineName: 'IPV', doseNumber: 2 },
  { label: 'IPV 3차', vaccineName: 'IPV', doseNumber: 3 },
  { label: 'MMR 1차', vaccineName: 'MMR', doseNumber: 1 },
  { label: 'MMR 2차', vaccineName: 'MMR', doseNumber: 2 },
  { label: '수두', vaccineName: 'VAR', doseNumber: 1 },
  { label: '일본뇌염 1차', vaccineName: '일본뇌염', doseNumber: 1 },
  { label: '일본뇌염 2차', vaccineName: '일본뇌염', doseNumber: 2 },
  { label: 'Hib 1차', vaccineName: 'Hib', doseNumber: 1 },
  { label: 'Hib 2차', vaccineName: 'Hib', doseNumber: 2 },
  { label: 'Hib 3차', vaccineName: 'Hib', doseNumber: 3 },
  { label: 'PCV 1차', vaccineName: 'PCV', doseNumber: 1 },
  { label: 'PCV 2차', vaccineName: 'PCV', doseNumber: 2 },
  { label: 'PCV 3차', vaccineName: 'PCV', doseNumber: 3 },
  { label: 'A형간염 1차', vaccineName: 'HepA', doseNumber: 1 },
  { label: 'A형간염 2차', vaccineName: 'HepA', doseNumber: 2 },
  { label: '인플루엔자', vaccineName: 'Influenza', doseNumber: 1 },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PediatricsEncounterLayout({
  patientId,
  encounterId,
  onStartEncounter: _onStartEncounter,
  patient,
  onSaveDraft,
  onSignAndBill,
  isSaving,
  isSigning,
  rxSlot,
}: PediatricsEncounterLayoutProps) {
  const tAttr = useTAttr();
  // 🔴 (2026-10-10) 월령은 **아는 값**이다 — 생년월일이 있으면 오늘 기준으로 채운다(서버도 생년월일과 대조한다) · 모르면 빈칸
  const birthMonths = patient?.dateOfBirth ? ageInMonths(patient.dateOfBirth) : null;
  const [ageMonths, setAgeMonths] = useState(birthMonths != null ? String(birthMonths) : '');
  // 🔴 성별은 **아는 값**이다 — 원장에서 프리필하고, OTHER/UNKNOWN/부재는 '미지정'으로 둔다.
  //    종전엔 무조건 '남아'로 시작해, 확인 없이 여아를 남아 백분위 곡선 위에 그렸다(2026-08-26).
  const registeredSex: GrowthSex = patient?.gender === 'MALE' ? 'male' : patient?.gender === 'FEMALE' ? 'female' : null;
  const [gender, setGender] = useState<GrowthSex>(registeredSex);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [headCirc, setHeadCirc] = useState('');
  const [chartType, setChartType] = useState<'weight' | 'height' | 'bmi'>('weight');

  const [devAssessment, setDevAssessment] = useState<Record<DevDomain, DevResult>>({
    GROSS_MOTOR: '', FINE_MOTOR: '', LANGUAGE: '', SOCIAL: '',
  });

  const [immunizations, setImmunizations] = useState<ImmunizationItem[]>(
    IMMUNIZATION_LIST.map(() => ({ done: false, date: '', lotNumber: '' })),
  );

  const [findings, setFindings] = useState('');

  // Auto-calculate BMI
  const bmi = useMemo(() => {
    const w = parseFloat(weight);
    const h = parseFloat(height);
    if (!w || !h || h === 0) return null;
    return (w / ((h / 100) * (h / 100))).toFixed(1);
  }, [weight, height]);

  // Growth data for chart
  const growthData: GrowthDataPoint[] = useMemo(() => {
    const age = parseInt(ageMonths, 10);
    // `!age` 로 막으면 **월령 0(신생아)** 가 곡선에서 사라진다 — 0 은 유효한 값이다.
    if (!Number.isFinite(age) || age < 0) return [];
    const w = parseFloat(weight);
    const h = parseFloat(height);
    return [{
      ageMonths: age,
      weight: Number.isFinite(w) ? w : undefined,
      height: Number.isFinite(h) ? h : undefined,
    }];
  }, [ageMonths, weight, height]);

  const toggleImmunization = (idx: number) => {
    setImmunizations((prev) => prev.map((item, i) => (i === idx ? { ...item, done: !item.done } : item)));
  };
  const setImmunField = (idx: number, key: 'date' | 'lotNumber', v: string) => {
    setImmunizations((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: v } : item)));
  };

  /**
   * 🔴 종전 이 폼은 `POST /api/v1/pediatrics/exams` 를 불렀는데 **그 라우트가 없다**
   *    (컨트롤러 전수 + 전 저장소 grep 으로 확인 — 이 한 줄에만 존재했다).
   *    소아 진료의 계측·접종·발달 입력이 **개통 이래 한 번도 저장된 적이 없다.**
   *    거울상으로 서버의 `POST growth|immunizations|developmental` 3개는 FE 소비처가 0이었다.
   *    → 새 라우트를 만들지 않고 **이미 있는 정본 3개에 배선**한다(모델·DTO·접종 검증이 이미 그쪽에 있다).
   *
   * 규칙:
   * - **스프레드로 보내지 않는다** — DTO 에 없는 키는 전역 `whitelist:true` 가 조용히 지운다
   *   (종전 payload 의 `gender`·`headCircumference`·`findings` 는 어차피 버려질 이름이었다).
   * - **입력하지 않은 것은 보내지 않는다** — 계측이 하나도 없으면 성장기록을 만들지 않는다.
   * - **부분 실패를 성공으로 말하지 않는다** — 어느 부분이 저장됐고 어느 부분이 실패했는지 그대로 말한다.
   */
  const saveMutation = useMutation({
    mutationFn: async () => {
      const age = parseInt(ageMonths, 10);
      const w = parseFloat(weight);
      const h = parseFloat(height);
      const hc = parseFloat(headCirc);
      const saved: string[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];

      const reason = (e: unknown) => (e as { message?: string })?.message || '알 수 없는 오류';

      /* ① 성장 계측 — 월령은 필수(x축), 계측값이 하나도 없으면 빈 기록을 만들지 않는다 */
      const hasMeasurement = Number.isFinite(w) || Number.isFinite(h) || Number.isFinite(hc);
      if (!Number.isFinite(age)) {
        if (hasMeasurement) skipped.push('성장 계측(월령 미입력)');
      } else if (!hasMeasurement) {
        skipped.push('성장 계측(측정값 없음)');
      } else {
        try {
          await apiClient.post('/api/v1/pediatrics/growth', {
            patientId,
            ageMonths: age,
            ...(Number.isFinite(w) ? { weight: w } : {}),
            ...(Number.isFinite(h) ? { height: h } : {}),
            // DTO 필드명은 `headCirc` — 종전 `headCircumference` 는 whitelist 가 지웠을 이름이다
            ...(Number.isFinite(hc) ? { headCirc: hc } : {}),
            // BMI 는 서버가 체중·신장에서 계산한다(2026-10-10) — 화면 계산값은 미리보기일 뿐 보내지 않는다
          });
          saved.push('성장 계측');
        } catch (e) {
          failed.push(`성장 계측: ${reason(e)}`);
        }
      }

      /* ② 발달 평가 — 서버는 4영역+종합을 모두 요구한다. 일부만 평가했으면 **지어내지 않고 건너뛴다**. */
      const devValues = DEV_DOMAINS.map((d) => devAssessment[d.key]);
      const overall = devOverallResult(devValues);
      if (devValues.some((v) => v !== '')) {
        if (overall == null || !Number.isFinite(age)) {
          skipped.push(`발달 평가(${overall == null ? '4개 영역 중 미평가 있음' : '월령 미입력'})`);
        } else {
          try {
            await apiClient.post('/api/v1/pediatrics/developmental', {
              patientId,
              ageMonths: age,
              tool: 'DENVER_II',
              grossMotor: devAssessment.GROSS_MOTOR,
              fineMotor: devAssessment.FINE_MOTOR,
              language: devAssessment.LANGUAGE,
              socialPersonal: devAssessment.SOCIAL,
              overallResult: overall,
            });
            saved.push('발달 평가');
          } catch (e) {
            failed.push(`발달 평가: ${reason(e)}`);
          }
        }
      }

      /* ③ 예방접종 — **접종일이 있는 항목만** 기록한다.
       *    체크만으로 오늘 날짜를 찍으면 실제로 하지 않은 접종을 오늘 시행한 것으로 원장에 남긴다.
       *    한 건씩 보내는 이유: 서버가 중복·간격·차수를 건별로 판정하므로 성패도 건별이다. */
      const checked = immunizations
        .map((item, idx) => ({ ...item, def: IMMUNIZATION_LIST[idx] }))
        .filter((i) => i.done);
      const undated = checked.filter((i) => !i.date.trim());
      if (undated.length) skipped.push(`예방접종 ${undated.length}건(접종일 미입력)`);
      let immunOk = 0;
      for (const i of checked.filter((c) => c.date.trim())) {
        try {
          await apiClient.post('/api/v1/pediatrics/immunizations', {
            patientId,
            vaccineName: i.def.vaccineName,
            doseNumber: i.def.doseNumber,
            givenAt: new Date(`${i.date}T00:00:00`).toISOString(),
            ...(i.lotNumber.trim() ? { lotNumber: i.lotNumber.trim() } : {}),
          });
          immunOk += 1;
        } catch (e) {
          failed.push(`${i.def.label}: ${reason(e)}`);
        }
      }
      if (immunOk) saved.push(`예방접종 ${immunOk}건`);

      if (!saved.length && !failed.length && !skipped.length) {
        throw new Error('저장할 내용이 없습니다 — 계측·발달평가·예방접종 중 하나를 입력하세요.');
      }
      return { saved, skipped, failed };
    },
    onSuccess: ({ saved, skipped, failed }) => {
      if (saved.length) toast.success(`저장: ${saved.join(' · ')}`);
      if (skipped.length) toast.info(`저장하지 않음 — ${skipped.join(' · ')}`);
      // 🔴 일부라도 실패하면 실패라고 말한다. 성공 토스트만 띄우면 유실을 못 본다.
      if (failed.length) toast.error(`저장 실패 — ${failed.join(' / ')}`);
    },
    onError: (e: unknown) => toast.error((e as { message?: string })?.message || '저장에 실패했습니다.'),
  });

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50';
  const labelCls = 'block text-[11px] font-medium text-gray-500 mb-1';

  const buildSoap = (): { subjective?: string; objective?: string; assessment?: string; plan?: string } => ({
    objective: findings || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Growth Measurement */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
            </svg>
            <T k="성장 계측" />
          </h3>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}><T k="월령 (개월)" /></label>
              <input type="number" value={ageMonths} onChange={(e) => setAgeMonths(e.target.value)} disabled={!encounterId} className={inputCls} placeholder={tAttr("개월")} data-peds-age-months />
              {birthMonths != null
                ? <p className="mt-0.5 text-[10px] text-gray-500" data-peds-age-source="birth"><T k="생년월일로 계산한 오늘 월령입니다" />{String(birthMonths) !== ageMonths && <span className="text-amber-700"> · <T k="생년월일 계산과 다릅니다" /></span>}</p>
                : <p className="mt-0.5 text-[10px] text-gray-400" data-peds-age-source="none"><T k="생년월일이 없어 직접 입력합니다" /></p>}
            </div>
            <div>
              <label className={labelCls}><T k="성별" /> <span className="text-gray-400"><T k="(성장곡선 참조선)" /></span></label>
              <select
                value={gender ?? ''}
                onChange={(e) => setGender(e.target.value === '' ? null : (e.target.value as 'male' | 'female'))}
                disabled={!encounterId}
                className={inputCls}
              >
                <option value=""><T k="미지정" /></option>
                <option value="male"><T k="남아" /></option>
                <option value="female"><T k="여아" /></option>
              </select>
              {registeredSex == null && (
                <p className="mt-1 text-[10px] text-amber-700"><T k="환자 원장에 성별이 등록돼 있지 않습니다 — 참조곡선은 지정해야 표시됩니다." /></p>
              )}
            </div>
          </div>

          {/* Measurements */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}><T k="체중 (kg)" /></label>
              <input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} disabled={!encounterId} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><T k="신장 (cm)" /></label>
              <input type="number" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} disabled={!encounterId} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}><T k="두위 (cm)" /></label>
              <input type="number" step="0.1" value={headCirc} onChange={(e) => setHeadCirc(e.target.value)} disabled={!encounterId} className={inputCls} />
            </div>
          </div>

          {/* Auto BMI */}
          {bmi && (
            <div className="bg-blue-50 rounded-xl px-4 py-2.5">
              <span className="text-sm font-semibold text-blue-700">BMI: {bmi} kg/m2</span>
            </div>
          )}

          {/* Growth Chart */}
          <div className="pt-2 border-t border-gray-100">
            <div className="flex gap-2 justify-center mb-2">
              {(['weight', 'height', 'bmi'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={`px-3 py-1 text-xs rounded-lg ${chartType === t ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-500'}`}
                >
                  {t === 'weight' ? '체중' : t === 'height' ? '신장' : 'BMI'}
                </button>
              ))}
            </div>
            <GrowthCurveChart data={growthData} type={chartType} gender={gender} />
          </div>

          {/* Developmental Assessment */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="발달 평가" /></p>
            <div className="space-y-2">
              {DEV_DOMAINS.map((domain) => (
                <div key={domain.key} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-xs font-medium text-gray-700">{domain.label}</span>
                    <span className="text-[10px] text-gray-400 ml-2">{domain.description}</span>
                  </div>
                  <div className="flex gap-1">
                    {DEV_RESULTS.filter((r) => r.value !== '').map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setDevAssessment((prev) => ({ ...prev, [domain.key]: prev[domain.key] === r.value ? '' : r.value }))}
                        disabled={!encounterId}
                        className={`px-2 py-0.5 text-[10px] rounded-full font-medium transition-colors disabled:opacity-50 ${
                          devAssessment[domain.key] === r.value ? r.color : 'bg-white text-gray-400 border border-gray-200'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Immunization + Findings */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <T k="예방접종 기록" />
          </h3>
          <p className="text-[11px] text-gray-500 -mt-2">
            체크한 항목은 <b>접종일을 입력한 것만</b> 접종 기록으로 저장됩니다(로트번호는 리콜 추적용 — 선택).
          </p>

          <div className="grid grid-cols-2 gap-1.5 max-h-[400px] overflow-y-auto pr-1">
            {immunizations.map((item, idx) => (
              <div
                key={idx}
                className={`px-3 py-2 rounded-lg transition-colors ${
                  item.done ? 'bg-green-50 border border-green-200' : 'bg-white border border-gray-100 hover:bg-gray-50'
                }`}
              >
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggleImmunization(idx)}
                    disabled={!encounterId}
                    className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                  />
                  <span className={`text-xs ${item.done ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                    {IMMUNIZATION_LIST[idx].label}
                  </span>
                </label>
                {/* 🔴 체크만으로는 저장하지 않는다 — 접종일은 법정 기록이고, 오늘로 기본값을 넣으면
                    실제로 하지 않은 접종을 오늘 시행한 것으로 원장에 남긴다. 비워두면 그 항목은 저장되지 않는다. */}
                {item.done && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <input
                      type="date"
                      value={item.date}
                      onChange={(e) => setImmunField(idx, 'date', e.target.value)}
                      disabled={!encounterId}
                      aria-label={`${IMMUNIZATION_LIST[idx].label} 접종일`}
                      className="flex-1 min-w-0 px-1.5 py-1 border border-gray-200 rounded text-[10px] bg-white"
                    />
                    <input
                      type="text"
                      value={item.lotNumber}
                      onChange={(e) => setImmunField(idx, 'lotNumber', e.target.value)}
                      disabled={!encounterId}
                      aria-label={`${IMMUNIZATION_LIST[idx].label} 로트번호`}
                      placeholder={tAttr("로트번호")}
                      className="w-20 px-1.5 py-1 border border-gray-200 rounded text-[10px] bg-white placeholder:text-gray-300"
                    />
                  </div>
                )}
                {item.done && !item.date.trim() && (
                  <p className="mt-1 text-[10px] text-amber-700"><T k="접종일을 입력해야 기록됩니다" /></p>
                )}
              </div>
            ))}
          </div>

          {/* Findings */}
          <div className="pt-4 border-t border-gray-100">
            <label className={labelCls}><T k="소견" /></label>
            <textarea
              rows={4}
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
            {ageMonths ? `${ageMonths}개월` : '월령 미입력'} | {gender === 'male' ? '남아' : gender === 'female' ? '여아' : '성별 미지정'}
            {bmi && ` | BMI ${bmi}`}
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
