'use client';

import { useState, useMemo } from 'react';
import { dietTypeText, dietTextureText, nrs2002RiskLevel, nutritionRiskText } from '@hospital-run/shared';
import { Unit, KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import PatientSelector from '@/components/ui/PatientSelector';
import { pollMs, kdate } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';

/** 재원 목록 표시에 필요한 최소 형태 — 서버 응답 모양이 두 갈래라 둘 다 받는다 */
type AdmissionLite = {
  id: string; patientId: string; patientName?: string;
  wardName?: string; bedLabel?: string;
  patient?: { familyName?: string; givenName?: string };
  bed?: { ward?: { name?: string } };
};

type NutritionTab = 'worklist' | 'diet-orders' | 'special' | 'assessment' | 'counsel' | 'dashboard';

// 선택 UI 순서용 코드 목록 — **라벨은 shared 정본에서 가져온다**(로컬 재정의 금지)
const DIET_TYPES: { value: string; label: string }[] = [
  'REGULAR', 'LOW_SALT', 'DIABETIC', 'LOW_FAT', 'SOFT', 'LIQUID', 'CLEAR_LIQUID', 'NPO',
  'RENAL', 'HEPATIC', 'HIGH_PROTEIN', 'LOW_PROTEIN', 'LOW_RESIDUE', 'PUREED', 'TUBE_FEEDING', 'TPN',
].map((value) => ({ value, label: dietTypeText(value) }));

const RISK_COLOR: Record<string, string> = { HIGH: 'bg-red-100 text-red-700', MODERATE: 'bg-amber-100 text-amber-700', LOW: 'bg-emerald-100 text-emerald-700' };

/**
 * 🔴 위험등급 판정을 화면이 다시 정의하지 않는다 — 종전 로컬 `getRiskLevel` 은 `nrs>=3` 을
 *    HIGH 로 봤고 서버는 `>=5` 를 HIGH 로 봤다. 화면이 보낸 등급은 DTO 에 없어 whitelist 가
 *    지웠으므로 **원장에는 서버 판정이 남았다** — NRS 3~4 에서 배지는 "고위험", 원장·워크리스트는
 *    "중위험"이었다. 정본은 shared `nrs2002RiskLevel`(=서버가 쓰는 그 함수) 하나다.
 */
const RISK_LABEL: Record<string, string> = { HIGH: '고위험', MODERATE: '중위험', LOW: '저위험' };

export default function NutritionAdvanced() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 🔴 급양사는 '할 일'에서 시작한다 — 입력 화면을 먼저 열면 누구를 평가해야 하는지 알 수 없다
  const [tab, setTab] = useState<NutritionTab>('worklist');
  const [showDietForm, setShowDietForm] = useState(false);
  const [showAssessForm, setShowAssessForm] = useState(false);
  const [showCounselForm, setShowCounselForm] = useState(false);

  /**
   * 🔴 식이처방 폼(2026-08-26 사람 신고 "등록·관리 기능이 안 보임").
   *    종전 폼은 서버 필수 필드 **`admissionId`·`startDate` 를 아예 갖고 있지 않았고**,
   *    `calories`/`protein` 은 이름도 달라(`calorieTarget`/`proteinTarget`) whitelist 가 지웠다.
   *    → **등록이 항상 400** 이었다. 급양 축에서 "활성 식이처방 3건이 전부 퇴원환자(=시드)"로
   *    관측된 것과 정합한다 — 화면으로 만든 처방이 하나도 없었다는 뜻이다.
   */
  const [dietForm, setDietForm] = useState({
    admissionId: '', patientId: '', dietType: 'REGULAR',
    calorieTarget: '', proteinTarget: '', fluidLimit: '', texture: '',
    startDate: kstToday(), notes: '',
  });
  const [assessForm, setAssessForm] = useState({ patientId: '', height: '', weight: '', albumin: '', nrsNutrition: '', nrsDisease: '', nrsAge70: false, intakeStatus: '' });
  const [counselForm, setCounselForm] = useState({ patientId: '', topic: '', content: '', duration: '', followUpDate: '' });

  // Diet orders
  const { data: dietData, isLoading: dietLoading } = useQuery({
    queryKey: ['nutrition-diet-orders'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/nutrition/diet-orders'),
    enabled: tab === 'diet-orders' || tab === 'dashboard',
    refetchInterval: pollMs('normal'),
  });

  // Assessments
  const { data: assessData, isLoading: assessLoading } = useQuery({
    queryKey: ['nutrition-assessments'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/nutrition/assessments'),
    enabled: tab === 'assessment' || tab === 'dashboard',
  });

  // Counsels
  const { data: counselData, isLoading: counselLoading } = useQuery({
    queryKey: ['nutrition-counsels'],
    queryFn: () => apiClient.get<{ data: unknown[] }>('/api/v1/nutrition/counsels'),
    enabled: tab === 'counsel',
  });

  // Dashboard
  const { data: dashboardData } = useQuery({
    queryKey: ['nutrition-dashboard'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/nutrition/dashboard'),
    enabled: tab === 'dashboard',
    refetchInterval: pollMs('slow'),
  });

  /**
   * 재원 환자 목록 — 식이처방이 매달릴 입원 건.
   * 🔴 `queryFn` 안에서 실패를 기본값으로 접지 않는다 — 접으면 "재원 환자가 없다"로 보인다.
   */
  const admissionsQ = useQuery({
    queryKey: ['nutrition-admissions'],
    queryFn: () => apiClient.get<{ data: AdmissionLite[] }>('/api/v1/inpatient?status=ADMITTED&limit=200'),
    enabled: tab === 'diet-orders',
    staleTime: 60_000,
  });
  const admissionList: AdmissionLite[] = (() => {
    const raw = admissionsQ.data?.data as unknown;
    return Array.isArray(raw) ? (raw as AdmissionLite[]) : ((raw as { data?: AdmissionLite[] })?.data ?? []);
  })();

  const createDietMut = useMutation({
    // 🔴 스프레드로 보내지 않는다 — 폼에만 있는 키가 섞이면 whitelist 가 조용히 지운다.
    //    서버 DTO 이름 그대로 명시한다(`calorieTarget`/`proteinTarget`).
    mutationFn: () => apiClient.post('/api/v1/nutrition/diet-orders', {
      admissionId: dietForm.admissionId,
      patientId: dietForm.patientId,
      dietType: dietForm.dietType,
      startDate: dietForm.startDate,
      calorieTarget: dietForm.calorieTarget ? Number(dietForm.calorieTarget) : undefined,
      proteinTarget: dietForm.proteinTarget ? Number(dietForm.proteinTarget) : undefined,
      fluidLimit: dietForm.fluidLimit ? Number(dietForm.fluidLimit) : undefined,
      texture: dietForm.texture || undefined,
      notes: dietForm.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nutrition-diet-orders'] }); setShowDietForm(false); setDietForm({ admissionId: '', patientId: '', dietType: 'REGULAR', calorieTarget: '', proteinTarget: '', fluidLimit: '', texture: '', startDate: kstToday(), notes: '' }); toast.success('식이처방 등록 완료'); },
    // 🔴 실패 사유를 그대로 보여준다 — "등록 실패"만으로는 무엇을 고쳐야 할지 알 수 없다
    onError: (e: Error) => toast.error(e?.message || '식이처방 등록 실패'),
  });

  const createAssessMut = useMutation({
    mutationFn: () => {
      const nrsTotal = Number(assessForm.nrsNutrition) + Number(assessForm.nrsDisease) + (assessForm.nrsAge70 ? 1 : 0);
      const breakdown = `NRS-2002: 영양상태 ${assessForm.nrsNutrition} + 질병중증도 ${assessForm.nrsDisease}${assessForm.nrsAge70 ? ' + 연령≥70 1' : ''} = ${nrsTotal}`;
      return apiClient.post('/api/v1/nutrition/assessments', {
        patientId: assessForm.patientId,
        assessmentType: 'NRS_2002',
        height: Number(assessForm.height),
        weight: Number(assessForm.weight),
        albumin: assessForm.albumin ? Number(assessForm.albumin) : undefined,
        nrsScore: nrsTotal,
        // 🔴 등급은 보내지 않는다 — 서버가 nrsScore 에서 파생하는 것이 정본이다(보내도 whitelist 가 지웠다).
        intakeStatus: assessForm.intakeStatus || undefined,
        notes: breakdown,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nutrition-assessments'] }); setShowAssessForm(false); setAssessForm({ patientId: '', height: '', weight: '', albumin: '', nrsNutrition: '', nrsDisease: '', nrsAge70: false, intakeStatus: '' }); toast.success('영양평가 등록 완료'); },
    onError: () => toast.error('영양평가 등록 실패'),
  });

  const createCounselMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/nutrition/counsels', {
      ...counselForm,
      duration: counselForm.duration ? Number(counselForm.duration) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nutrition-counsels'] }); setShowCounselForm(false); setCounselForm({ patientId: '', topic: '', content: '', duration: '', followUpDate: '' }); toast.success('영양상담 등록 완료'); },
    onError: () => toast.error('영양상담 등록 실패'),
  });

  const extract = <T,>(raw: { data: unknown } | undefined): T => {
    const r = raw?.data;
    if (Array.isArray(r)) return r as T;
    const inner = (r as unknown as Record<string, unknown>)?.data;
    if (inner !== undefined) return inner as T;
    return r as T;
  };

  const dietOrders: Record<string, unknown>[] = extract<Record<string, unknown>[]>(dietData) ?? [];
  const assessments: Record<string, unknown>[] = extract<Record<string, unknown>[]>(assessData) ?? [];
  const counsels: Record<string, unknown>[] = extract<Record<string, unknown>[]>(counselData) ?? [];
  const dashboard: Record<string, unknown> | null = extract<Record<string, unknown>>(dashboardData) ?? null;

  const bmi = useMemo(() => {
    const h = Number(assessForm.height);
    const w = Number(assessForm.weight);
    if (h > 0 && w > 0) return (w / ((h / 100) ** 2)).toFixed(1);
    return '';
  }, [assessForm.height, assessForm.weight]);

  const nrsTotal = (Number(assessForm.nrsNutrition) || 0) + (Number(assessForm.nrsDisease) || 0) + (assessForm.nrsAge70 ? 1 : 0);
  // 저장 전 미리보기도 **서버가 쓰는 그 함수**로 판정한다 — 저장 전후로 배지가 달라지지 않게.
  /**
   * 🔴 **미판정을 `LOW`(저위험)로 접지 않는다** — 정본 `shared/nutrition-risk.ts` 가 명시적으로 금지한 것이다
   *    ("평가하지 않은 환자가 저위험 환자가 된다"). 서버도 `?? undefined` 로 두는데 화면만 접고 있었다(2026-09-02).
   *    스크리닝을 한 번도 만지지 않으면 총점 자체가 미상이다.
   */
  const nrsScored = assessForm.nrsNutrition !== '' && assessForm.nrsDisease !== '';
  const autoRisk = nrsScored ? nrs2002RiskLevel(nrsTotal) : null;

  // Dashboard computed
  const dietTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    dietOrders.forEach(o => {
      const dt = String(o.dietType ?? 'UNKNOWN');
      counts[dt] = (counts[dt] ?? 0) + 1;
    });
    return counts;
  }, [dietOrders]);

  const riskCounts = useMemo(() => {
    // 🔴 등급 미기록을 LOW 로 세지 않는다 — "저위험 N명"이 실제보다 부풀고 미평가가 사라진다.
    const counts: Record<string, number> = { HIGH: 0, MODERATE: 0, LOW: 0, UNKNOWN: 0 };
    assessments.forEach(a => {
      const risk = a.riskLevel ? String(a.riskLevel) : 'UNKNOWN';
      counts[risk] = (counts[risk] ?? 0) + 1;
    });
    return counts;
  }, [assessments]);

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900"><T k="영양 고급 관리" /></h3>
      </div>

      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'worklist' as NutritionTab, label: '할 일' },
          { key: 'diet-orders' as NutritionTab, label: '식이처방' },
          { key: 'special' as NutritionTab, label: '특수영양(EN·TPN)' },
          { key: 'assessment' as NutritionTab, label: '영양평가' },
          { key: 'counsel' as NutritionTab, label: '영양상담' },
          { key: 'dashboard' as NutritionTab, label: '대시보드' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* Diet Orders Tab */}
      {tab === 'worklist' && <DietitianWorklistTab />}
      {tab === 'special' && <SpecialNutritionTab />}

      {tab === 'diet-orders' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowDietForm(!showDietForm)}
              className="px-3 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700">+ <T k="식이처방" /></button>
          </div>

          {showDietForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <p className="text-xs font-bold text-gray-700"><T k="새 식이처방" /></p>
              <div className="grid grid-cols-3 gap-3">
                {/* 🔴 식이처방은 **입원에 매달린다** — 재원 건을 고르면 환자가 따라온다.
                    종전엔 환자만 고르게 해 서버 필수 `admissionId` 가 비었고 항상 400 이었다. */}
                <div className="col-span-2"><label className="text-[10px] text-gray-500"><T k="재원 환자" /> *</label>
                  <select
                    value={dietForm.admissionId}
                    onChange={e => {
                      const a = admissionList.find(x => x.id === e.target.value);
                      setDietForm({ ...dietForm, admissionId: e.target.value, patientId: a?.patientId ?? '' });
                    }}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                    <option value="">{tAttr('— 재원 환자 선택 —')}</option>
                    {admissionList.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.patientName ?? a.patient?.familyName ?? ''}{a.patient?.givenName ?? ''} · {a.wardName ?? a.bed?.ward?.name ?? ''} {a.bedLabel ?? ''}
                      </option>
                    ))}
                  </select>
                  {admissionsQ.isError && (
                    <p className="mt-0.5 text-[10px] text-rose-600"><T k="재원 목록을 불러오지 못했습니다 — 없다는 뜻이 아닙니다." /></p>
                  )}
                  {!admissionsQ.isLoading && !admissionsQ.isError && admissionList.length === 0 && (
                    <p className="mt-0.5 text-[10px] text-gray-400"><T k="재원 중인 환자가 없습니다." /></p>
                  )}
                </div>
                <div><label className="text-[10px] text-gray-500"><T k="식이유형" /> *</label>
                  <select value={dietForm.dietType} onChange={e => setDietForm({ ...dietForm, dietType: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                    {DIET_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select></div>
                <div><label className="text-[10px] text-gray-500"><T k="시작일" /> *</label>
                  <input type="date" value={dietForm.startDate} onChange={e => setDietForm({ ...dietForm, startDate: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div><label className="text-[10px] text-gray-500"><T k="열량 (kcal)" /></label>
                  <input type="number" value={dietForm.calorieTarget} onChange={e => setDietForm({ ...dietForm, calorieTarget: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div><label className="text-[10px] text-gray-500"><T k="단백질 (g)" /></label>
                  <input type="number" value={dietForm.proteinTarget} onChange={e => setDietForm({ ...dietForm, proteinTarget: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div><label className="text-[10px] text-gray-500"><T k="수분제한 (mL)" /></label>
                  <input type="number" value={dietForm.fluidLimit} onChange={e => setDietForm({ ...dietForm, fluidLimit: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div><label className="text-[10px] text-gray-500"><T k="질감" /></label>
                  <input value={dietForm.texture} onChange={e => setDietForm({ ...dietForm, texture: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('다진식, 갈은식...')} /></div>
                <div><label className="text-[10px] text-gray-500"><T k="비고" /></label>
                  <input value={dietForm.notes} onChange={e => setDietForm({ ...dietForm, notes: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowDietForm(false)} className="px-3 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-lg"><T k="취소" /></button>
                <button onClick={() => createDietMut.mutate()} disabled={!dietForm.admissionId || !dietForm.startDate || createDietMut.isPending}
                  className="px-4 py-1.5 text-xs font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                  {createDietMut.isPending ? <T k="등록중..." /> : <T k="등록" />}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="식이유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="열량" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="단백질" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="질감" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="비고" /></th>
              </tr></thead>
              <tbody>
                {dietLoading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
                : dietOrders.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="식이처방이 없습니다" /></td></tr>
                : dietOrders.map((o) => {
                  const patient = o.patient as Record<string, string> | undefined;
                  return (
                    <tr key={String(o.id)} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">{patient ? `${patient.familyName}${patient.givenName}` : String(o.patientId ?? '-')}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 whitespace-nowrap">{dietTypeText(String(o.dietType))}</span></td>
                      {/* 🔴 서버 필드명은 `calorieTarget`·`proteinTarget` 이다 — `calories`·`protein`
                           을 읽어 **열량·단백질이 항상 `-`** 였다(식이처방의 핵심 값인데). */}
                      <td className="px-4 py-3 text-xs text-gray-700">{o.calorieTarget ? `${o.calorieTarget} kcal` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{o.proteinTarget ? `${o.proteinTarget} g` : '-'}</td>
                      {/* 🔴 질감 라벨표가 아예 없어 `SOFT`·`REGULAR` 가 영문으로 떴다 */}
                      <td className="px-4 py-3 text-xs text-gray-500">{dietTextureText(o.texture as string | null | undefined)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[150px]">{String(o.notes ?? '-')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assessment Tab */}
      {tab === 'assessment' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAssessForm(!showAssessForm)}
              className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700">+ <T k="영양평가" /></button>
          </div>

          {showAssessForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <p className="text-xs font-bold text-gray-700"><T k="새 영양평가" /></p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] text-gray-500"><T k="환자 ID" /> *</label>
                  <PatientSelector value={assessForm.patientId} placeholder={tAttr('환자 검색(이름·MRN)')} onChange={pid => setAssessForm({ ...assessForm, patientId: pid })} /></div>
                <div><label className="text-[10px] text-gray-500"><T k="신장 (cm)" /> *</label>
                  <input type="number" value={assessForm.height} onChange={e => setAssessForm({ ...assessForm, height: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div><label className="text-[10px] text-gray-500"><T k="체중 (kg)" /> *</label>
                  <input type="number" value={assessForm.weight} onChange={e => setAssessForm({ ...assessForm, weight: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="BMI (자동계산)" /></label>
                  <div className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 text-gray-700">{bmi || '-'}</div>
                </div>
                <div><label className="text-[10px] text-gray-500"><T k="알부민 (g/dL)" /></label>
                  <input type="number" step="0.1" value={assessForm.albumin} onChange={e => setAssessForm({ ...assessForm, albumin: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="NRS 총점 (자동)" /></label>
                  <div className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 font-bold text-gray-800">{nrsTotal}<Unit>점</Unit> {nrsTotal >= 3 && <span className="text-red-600">· <T k="영양위험" /></span>}</div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="위험도 (자동)" /></label>
                  <div className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${autoRisk ? RISK_COLOR[autoRisk] : 'bg-gray-100 text-gray-500'}`}>
                      <T k={autoRisk ? RISK_LABEL[autoRisk] : '미평가'} />
                    </span>
                  </div>
                </div>
              </div>
              {/* NRS-2002 스크리닝 */}
              <div className="grid grid-cols-3 gap-3 p-2 bg-teal-50/50 rounded-lg">
                <div>
                  <label className="text-[10px] text-gray-500"><T k="영양상태 손상 (0-3)" /></label>
                  <select value={assessForm.nrsNutrition} onChange={e => setAssessForm({ ...assessForm, nrsNutrition: e.target.value })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] bg-white">
                    {/* 🔴 쓰기 폼의 초기값은 '미선택' — 정상으로 시작하면 만지지 않은 값이 원장에 남는다 */}
                    <option value="">{tAttr('선택 — 미평가')}</option>
                    <option value="0">{tAttr('0 · 정상')}</option>
                    <option value="1">{tAttr('1 · 3개월 5%↓ / 섭취 50-75%')}</option>
                    <option value="2">{tAttr('2 · 2개월 5%↓ / BMI 18.5-20.5 / 섭취 25-60%')}</option>
                    <option value="3">{tAttr('3 · 1개월 5%↓ / BMI<18.5 / 섭취 0-25%')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500"><T k="질병 중증도 (0-3)" /></label>
                  <select value={assessForm.nrsDisease} onChange={e => setAssessForm({ ...assessForm, nrsDisease: e.target.value })} className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[11px] bg-white">
                    {/* 🔴 쓰기 폼의 초기값은 '미선택' — 정상으로 시작하면 만지지 않은 값이 원장에 남는다 */}
                    <option value="">{tAttr('선택 — 미평가')}</option>
                    <option value="0">{tAttr('0 · 정상')}</option>
                    <option value="1">{tAttr('1 · 만성질환·고관절골절·COPD·투석·당뇨·종양')}</option>
                    <option value="2">{tAttr('2 · 대수술·뇌졸중·중증폐렴·혈액암')}</option>
                    <option value="3">{tAttr('3 · 두부손상·골수이식·중환자(APACHE>10)')}</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-600 pb-1.5">
                    <input type="checkbox" checked={assessForm.nrsAge70} onChange={e => setAssessForm({ ...assessForm, nrsAge70: e.target.checked })} />
                    <T k="연령 ≥70세 (+1)" />
                  </label>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500"><T k="섭취 상태" /></label>
                <input value={assessForm.intakeStatus} onChange={e => setAssessForm({ ...assessForm, intakeStatus: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('식사량 50% 이하, 구역감...')} />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAssessForm(false)} className="px-3 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-lg"><T k="취소" /></button>
                <button onClick={() => createAssessMut.mutate()} disabled={!assessForm.patientId || !assessForm.height || !assessForm.weight || !nrsScored || createAssessMut.isPending}
                  className="px-4 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                  {createAssessMut.isPending ? <T k="등록중..." /> : <T k="등록" />}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">BMI</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="알부민" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">NRS</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="위험도" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="섭취상태" /></th>
              </tr></thead>
              <tbody>
                {assessLoading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
                : assessments.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="영양평가 기록이 없습니다" /></td></tr>
                : assessments.map((a) => {
                  const patient = a.patient as Record<string, string> | undefined;
                  // 🔴 등급이 없는 기록을 'LOW'(초록)로 접지 않는다 — 미평가와 저위험은 다른 사실이다.
                  const risk = a.riskLevel ? String(a.riskLevel) : null;
                  return (
                    <tr key={String(a.id)} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">{patient ? `${patient.familyName}${patient.givenName}` : String(a.patientId ?? '-')}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 font-medium">{a.bmi ? String(a.bmi) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{a.albumin ? `${a.albumin} g/dL` : '-'}</td>
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">{String(a.nrsScore ?? '-')}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${(risk && RISK_COLOR[risk]) ?? 'bg-gray-100 text-gray-600'}`}>{nutritionRiskText(risk)}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]">{String(a.intakeStatus ?? '-')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Counsel Tab */}
      {tab === 'counsel' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCounselForm(!showCounselForm)}
              className="px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700">+ <T k="영양상담" /></button>
          </div>

          {showCounselForm && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <p className="text-xs font-bold text-gray-700"><T k="새 영양상담" /></p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] text-gray-500"><T k="환자 ID" /> *</label>
                  <PatientSelector value={counselForm.patientId} placeholder={tAttr('환자 검색(이름·MRN)')} onChange={pid => setCounselForm({ ...counselForm, patientId: pid })} /></div>
                <div><label className="text-[10px] text-gray-500"><T k="상담 주제" /> *</label>
                  <input value={counselForm.topic} onChange={e => setCounselForm({ ...counselForm, topic: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('당뇨식이, 체중관리...')} /></div>
                <div><label className="text-[10px] text-gray-500"><T k="상담시간 (분)" /></label>
                  <input type="number" value={counselForm.duration} onChange={e => setCounselForm({ ...counselForm, duration: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
              </div>
              <div><label className="text-[10px] text-gray-500"><T k="상담 내용" /> *</label>
                <textarea value={counselForm.content} onChange={e => setCounselForm({ ...counselForm, content: e.target.value })} rows={3}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs resize-none" placeholder={tAttr('상담 내용 기록...')} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-[10px] text-gray-500"><T k="추적 상담일" /></label>
                  <input type="date" value={counselForm.followUpDate} onChange={e => setCounselForm({ ...counselForm, followUpDate: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" /></div>
                <div />
                <div className="flex items-end gap-2 justify-end">
                  <button onClick={() => setShowCounselForm(false)} className="px-3 py-1.5 text-xs text-gray-500 bg-gray-100 rounded-lg"><T k="취소" /></button>
                  <button onClick={() => createCounselMut.mutate()} disabled={!counselForm.patientId || !counselForm.topic || !counselForm.content || createCounselMut.isPending}
                    className="px-4 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
                    {createCounselMut.isPending ? <T k="등록중..." /> : <T k="등록" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="주제" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="내용" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="추적일" /></th>
              </tr></thead>
              <tbody>
                {counselLoading ? Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
                : counsels.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="영양상담 기록이 없습니다" /></td></tr>
                : counsels.map((c) => {
                  const patient = c.patient as Record<string, string> | undefined;
                  return (
                    <tr key={String(c.id)} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-900">{patient ? `${patient.familyName}${patient.givenName}` : String(c.patientId ?? '-')}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap">{String(c.topic)}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[250px]">{String(c.content ?? '-')}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.duration ? `${c.duration}분` : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.followUpDate ? kdate(String(c.followUpDate), 'monthDay') : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          {/* Meal Distribution */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="오늘 식이유형별 현황" /></h4>
            {(() => {
              const dashCounts = (dashboard?.dietTypeCounts ?? dashboard?.mealDistribution) as Record<string, number> | undefined;
              const counts = dashCounts && Object.keys(dashCounts).length > 0 ? dashCounts : dietTypeCounts;
              const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
              const total = entries.reduce((sum, [, count]) => sum + count, 0);
              return entries.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4"><T k="데이터 없음" /></p>
              ) : (
                <div className="space-y-2">
                  {entries.map(([type, count]) => (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-24 truncate">{dietTypeText(type)}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                        <div className="h-5 rounded-full bg-orange-400 transition-all" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
                      </div>
                      <span className="text-xs font-bold text-gray-700 w-8 text-right">{count}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100">
                    <span className="text-gray-500"><T k="합계" /></span>
                    <span className="font-bold text-gray-900">{total}식</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Risk Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h4 className="text-sm font-bold text-gray-900 mb-3"><T k="영양 위험도 요약" /></h4>
            {(() => {
              const dashRisk = (dashboard?.riskSummary ?? dashboard?.riskCounts) as Record<string, number> | undefined;
              const counts = dashRisk && Object.keys(dashRisk).length > 0 ? dashRisk : riskCounts;
              return (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-red-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] font-medium text-red-600"><T k="고위험 (HIGH)" /></p>
                    <p className="text-3xl font-bold text-red-700 mt-1">{counts.HIGH ?? 0}</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] font-medium text-amber-600"><T k="중위험 (MODERATE)" /></p>
                    <p className="text-3xl font-bold text-amber-700 mt-1">{counts.MODERATE ?? 0}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4 text-center">
                    <p className="text-[10px] font-medium text-emerald-600"><T k="저위험 (LOW)" /></p>
                    <p className="text-3xl font-bold text-emerald-700 mt-1">{counts.LOW ?? 0}</p>
                  </div>
                  {/* 등급이 기록되지 않은 평가는 저위험 칸에 숨기지 않고 따로 센다 */}
                  {(counts.UNKNOWN ?? 0) > 0 && (
                    <div className="bg-gray-50 rounded-xl p-4 text-center">
                      <p className="text-[10px] font-medium text-gray-500"><T k="등급 미기록" /></p>
                      <p className="text-3xl font-bold text-gray-700 mt-1">{counts.UNKNOWN}</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 특수영양(경장 EN·정맥 TPN) 처방 탭 ──
function SpecialNutritionTab() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [f, setF] = useState({ admissionId: '', patientId: '', kind: 'ENTERAL', route: '', formula: '', targetCalories: '', volumeMl: '', rateMlHr: '', notes: '' });
  const list = useQuery({
    queryKey: ['special-nutrition', f.admissionId],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; kind: string; route?: string; formula?: string; targetCalories?: number; volumeMl?: number; rateMlHr?: number; status: string; startDate: string }> }>(`/api/v1/nutrition/special-nutrition?admissionId=${f.admissionId}`).then((r) => r.data),
    enabled: !!f.admissionId,
  });
  const createMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/nutrition/special-nutrition', {
      admissionId: f.admissionId, patientId: f.patientId, kind: f.kind, route: f.route || undefined, formula: f.formula || undefined,
      targetCalories: f.targetCalories ? Number(f.targetCalories) : undefined, volumeMl: f.volumeMl ? Number(f.volumeMl) : undefined, rateMlHr: f.rateMlHr ? Number(f.rateMlHr) : undefined, notes: f.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-nutrition', f.admissionId] }); setF({ ...f, formula: '', targetCalories: '', volumeMl: '', rateMlHr: '', notes: '' }); toast.success('특수영양 처방 등록'); },
    onError: () => toast.error('등록 실패'),
  });
  const isEN = f.kind === 'ENTERAL';
  const routeOpts = isEN ? ['NG', 'OG', 'PEG', 'JEJUNOSTOMY'] : ['CENTRAL', 'PERIPHERAL'];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
        <div className="flex gap-2">
          {(['ENTERAL', 'PARENTERAL'] as const).map((k) => (
            <button key={k} onClick={() => setF({ ...f, kind: k, route: '' })} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${f.kind === k ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600'}`}><T k={k === 'ENTERAL' ? '경장영양(EN)' : '정맥영양(TPN)'} /></button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2 sm:col-span-2">
            <label className="text-[10px] text-gray-500"><T k="환자 선택" /> *</label>
            <PatientSelector value={f.patientId} context="admission" showAdmitted placeholder={tAttr('입원 환자 검색(이름·MRN)')} onChange={async (pid) => {
              setF((s) => ({ ...s, patientId: pid, admissionId: '' }));
              try { const r = await apiClient.get<{ data: Array<{ id: string; status: string }> }>(`/api/v1/admissions/patient/${pid}/history`); const active = (r.data ?? []).find((a) => a.status === 'ADMITTED'); if (active) setF((s) => ({ ...s, admissionId: active.id })); } catch { /* */ }
            }} />
            {f.patientId && <p className="text-[10px] mt-0.5">{f.admissionId ? <span className="text-emerald-600">✓ <T k="입원 확인됨" /></span> : <span className="text-amber-600"><T k="활성 입원 없음 — 입원 환자만 특수영양 처방 가능" /></span>}</p>}
          </div>
          <div><label className="text-[10px] text-gray-500"><T k="경로" /></label>
            <select value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white"><option value="">{tAttr('선택')}</option>{routeOpts.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div><label className="text-[10px] text-gray-500"><T k={isEN ? '제제' : '조성 제제'} /></label><input value={f.formula} onChange={(e) => setF({ ...f, formula: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs" placeholder={isEN ? '그린비아/뉴케어' : '중심정맥영양백'} /></div>
          <div><label className="text-[10px] text-gray-500"><T k="목표 칼로리" /></label><input type="number" value={f.targetCalories} onChange={(e) => setF({ ...f, targetCalories: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs" /></div>
          <div><label className="text-[10px] text-gray-500"><T k="용량(ml/일)" /></label><input type="number" value={f.volumeMl} onChange={(e) => setF({ ...f, volumeMl: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs" /></div>
          <div><label className="text-[10px] text-gray-500"><T k="주입속도(ml/hr)" /></label><input type="number" value={f.rateMlHr} onChange={(e) => setF({ ...f, rateMlHr: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs" placeholder={isEN ? '50' : '80'} /></div>
          <div className="sm:col-span-4"><label className="text-[10px] text-gray-500"><T k="메모(증량스케줄·검사 모니터링)" /></label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="w-full px-2 py-1.5 border rounded-lg text-xs" placeholder={tAttr(isEN ? '25ml/hr 시작 → 12h마다 25 증량, 4h 잔여량 확인' : '전해질·중성지방·간기능 매일')} /></div>
        </div>
        <div className="flex justify-end">
          <button onClick={() => createMut.mutate()} disabled={!f.admissionId || !f.patientId || createMut.isPending} className="px-4 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg disabled:opacity-50">{createMut.isPending ? <T k="등록중..." /> : <T k="처방 등록" />}</button>
        </div>
      </div>
      {f.admissionId && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-gray-700 mb-2"><T k="처방 목록" /></p>
          <div className="space-y-1 text-xs">
            {(list.data ?? []).map((o) => (
              <div key={o.id} className="flex items-center justify-between border-b border-gray-50 pb-1">
                <span><T k={o.kind === 'ENTERAL' ? '경장' : '정맥'} /> · {o.formula ?? ''} {o.route ?? ''} · {o.targetCalories ?? '-'}kcal · {o.rateMlHr ?? '-'}ml/hr</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>{o.status}</span>
              </div>
            ))}
            {/* 🔴 조회 실패를 "처방 없음"으로 말하지 않는다 */}
            {list.isError && <QueryErrorFallback error={list.error} onRetry={list.refetch} size="compact" />}
            {!list.isError && (list.data ?? []).length === 0 && <span className="text-gray-400"><T k="처방 없음" /></span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 급양사 워크리스트 — 🔴 "오늘 무엇을 해야 하는가".
 *
 * 2026-08-21 실측: 입력 탭(식이처방·특수영양·영양평가·영양상담)은 다 있었는데
 * **"누구를 평가해야 하는가"가 어디에도 없었다.**
 *   · 재원 5명 중 영양평가 있는 환자 2명(3명 미평가) — 화면이 아무 말도 하지 않았다
 *   · 상담 후속일 도래 4건 — **저장만 하고 아무도 읽지 않았다**
 * 목록에서 시작하지 못하면 급양사는 환자를 기억으로 찾아야 한다.
 */
function DietitianWorklistTab() {
  const tAttr = useTAttr();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nutrition-worklist'],
    queryFn: () => apiClient.get<{ data: Worklist }>('/api/v1/nutrition/worklist').then((r) => r.data),
    refetchInterval: pollMs('slow'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading || !data) return <div className="py-12 text-center text-gray-400"><T k="불러오는 중…" /></div>;

  const N = data.admissions;
  return (
    <div className="space-y-4">
      {/* 🔴 기준값이 원내 정책인지 기본값인지 밝힌다 — 기본값을 정책인 척하지 않는다 */}
      {!data.policy.configured && data.policy.note && (
        <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">※ {data.policy.note}</p>
      )}

      <WorkSection
        title={tAttr('영양 스크리닝 미실시')}
        count={data.notScreened.length} total={N}
        hint={`입원 후 ${data.policy.screeningWithinHours}시간 안에 스크리닝합니다. 기한이 지난 환자는 붉게 표시됩니다.`}
        empty={tAttr('재원 환자 전원이 영양 스크리닝을 받았습니다.')}
      >
        {data.notScreened.map((r) => (
          <Row key={r.admissionId} r={r} right={
            <span className={r.overdue ? 'text-rose-700 font-bold' : 'text-gray-500'}>
              입원 후 {r.hoursSinceAdmit}시간{r.overdue ? ' · 기한 초과' : ''}
            </span>
          } />
        ))}
      </WorkSection>

      <WorkSection
        title={tAttr('재평가 대상')}
        count={data.reassess.length} total={N}
        hint={`마지막 평가가 ${data.policy.reassessDays}일을 넘긴 재원 환자입니다. 고위험군이 위로 옵니다.`}
        empty={tAttr('재평가 주기를 넘긴 환자가 없습니다.')}
      >
        {data.reassess.map((r) => (
          <Row key={r.admissionId} r={r} right={
            <span className={r.highRisk ? 'text-rose-700 font-bold' : 'text-gray-500'}>
              {r.highRisk ? '고위험 · ' : ''}{r.daysSinceAssessment}일 경과{r.nrsScore != null ? ` · NRS ${r.nrsScore}` : ''}
            </span>
          } />
        ))}
      </WorkSection>

      <WorkSection
        title={tAttr('상담 후속일 도래')}
        count={data.counselDue.length}
        hint={tAttr('영양상담에 적어 둔 후속 예정일이 지난 건입니다.')}
        empty={tAttr('후속 예정일이 도래한 상담이 없습니다.')}
      >
        {data.counselDue.map((c) => (
          <div key={c.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm">
            <span className="font-medium text-gray-900 w-28 truncate">{c.patient.familyName}{c.patient.givenName}</span>
            <span className="text-[11px] text-gray-400 w-20 truncate">{c.patient.mrn}</span>
            <span className="text-gray-700 flex-1 truncate">{c.topic}</span>
            <span className="text-[11px] text-amber-800"><T k="후속" /> <KDate value={c.followUpDate} /></span>
          </div>
        ))}
      </WorkSection>

      <WorkSection
        title={tAttr('저섭취(25% 이하)')}
        count={data.lowIntake.length}
        hint={tAttr('오늘 기록된 섭취율이 25% 이하인 식사입니다 — 중재 대상.')}
        empty={tAttr('오늘 저섭취로 기록된 식사가 없습니다.')}
      >
        {data.lowIntake.map((m, i) => (
          <div key={`${m.admissionId}-${m.mealType}-${i}`} className="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm">
            <span className="font-medium text-gray-900 w-28 truncate">{m.patient.familyName}{m.patient.givenName}</span>
            <span className="text-[11px] text-gray-400 w-20 truncate">{m.patient.mrn}</span>
            <span className="text-gray-600 flex-1 truncate">{dietTypeText(m.dietType)}{m.refusalReason ? ` · ${m.refusalReason}` : ''}</span>
            <span className="text-rose-700 font-bold text-[12px]">{m.intakePercent}%</span>
          </div>
        ))}
      </WorkSection>

      <WorkSection
        title={tAttr('특수영양(EN·TPN) 진행 중')}
        count={data.specialActive.length}
        hint={tAttr('모니터링 대상입니다.')}
        empty={tAttr('진행 중인 특수영양 처방이 없습니다.')}
      >
        {data.specialActive.map((sp) => (
          <div key={sp.id} className="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm">
            <span className="font-medium text-gray-900 w-28 truncate">{sp.patient.familyName}{sp.patient.givenName}</span>
            <span className="text-[11px] text-gray-400 w-20 truncate">{sp.patient.mrn}</span>
            <span className="text-gray-700 flex-1 truncate">
              <T k={sp.kind === 'ENTERAL' ? '경장(EN)' : sp.kind === 'PARENTERAL' ? '정맥(TPN)' : sp.kind} />
              {sp.route ? ` · ${sp.route}` : ''}{sp.formula ? ` · ${sp.formula}` : ''}
            </span>
            <span className="text-[11px] text-gray-500"><T k="시작" /> <KDate value={sp.startDate} /></span>
          </div>
        ))}
      </WorkSection>
    </div>
  );
}

function WorkSection({ title, count, total, hint, empty, children }: {
  title: string; count: number; total?: number; hint: string; empty: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {/* 🔴 분모와 함께 — 수만 내면 많은지 적은지 알 수 없다 */}
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
          {count}{total != null ? <span className="font-medium">/{total}</span> : null}
        </span>
      </div>
      <p className="text-[11px] text-gray-400 mb-2">{hint}</p>
      {count === 0 ? <p className="text-xs text-gray-400 py-2">{empty}</p> : <div>{children}</div>}
    </div>
  );
}

function Row({ r, right }: { r: { name: string; mrn: string; ward: string | null; bed: string | null }; right: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm">
      <span className="font-medium text-gray-900 w-28 truncate">{r.name}</span>
      <span className="text-[11px] text-gray-400 w-20 truncate">{r.mrn}</span>
      <span className="text-[11px] text-gray-500 flex-1 truncate">{r.ward ?? '-'}{r.bed ? ` · ${r.bed}` : ''}</span>
      <span className="text-[11px]">{right}</span>
    </div>
  );
}

interface WorklistRow { admissionId: string; patientId: string; mrn: string; name: string; ward: string | null; bed: string | null }
interface Worklist {
  admissions: number;
  policy: { screeningWithinHours: number; reassessDays: number; configured: boolean; note: string | null };
  notScreened: (WorklistRow & { hoursSinceAdmit: number; overdue: boolean })[];
  reassess: (WorklistRow & { daysSinceAssessment: number; highRisk: boolean; nrsScore: number | null; riskLevel: string | null })[];
  counselDue: { id: string; topic: string; followUpDate: string; patient: { mrn: string; familyName: string; givenName: string } }[];
  lowIntake: { admissionId: string; mealType: string; intakePercent: number; dietType: string; refusalReason: string | null; patient: { mrn: string; familyName: string; givenName: string } }[];
  specialActive: { id: string; kind: string; route: string | null; formula: string | null; startDate: string; patient: { mrn: string; familyName: string; givenName: string } }[];
}
