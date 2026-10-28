'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { BRADEN_ITEMS, BRADEN_INPUT_CONFIG_KEY, BRADEN_RISK_LABEL, bradenInputModeOf, bradenRiskLevel, bradenTotalOf, type BradenSubscores } from '@hospital-run/shared';

/**
 * 🔴 **사정 척도의 '값'은 배선하지 않는다** — 활동정도(독립보행…침상안정)·영양상태(양호…중증 불량)·
 *    피부상태(정상…욕창 있음)·Braden 위험등급(정상/경미/중등도/고위험)은 **등급이 곧 임상 판단**이라
 *    오역이 낙상·욕창 판정을 바꾼다. 게다가 이 문자열들은 그대로 저장되는 값이다(표시=저장).
 *    항목 **이름**(의식수준·활동정도·영양상태·피부상태·통증)만 카탈로그를 타고, 값은 한국어 원문 그대로 나간다.
 */
const CONSCIOUSNESS = ['Alert', 'Verbal', 'Pain', 'Unresponsive'];
const MOBILITY = ['독립보행', '보조기구 사용', '부분 도움', '전적 도움', '침상안정'];
const NUTRITION = ['양호', '경도 불량', '중등도 불량', '중증 불량'];
const SKIN = ['정상', '건조', '부종', '발적', '욕창 위험', '욕창 있음'];

/**
 * Braden 등급 — shared 정본(≤12 고 · 13–14 중 · ≥15 저 · 6~23 밖은 등급 없음).
 * 🔴 (2026-10-10) 종전 이 화면만 4단(≥19 '정상'·≥15 '경미 위험')으로 그려 재평가·위험 추이와 같은 점수를 다르게 말했다.
 */
function getBradenRisk(score: number | null | undefined): { label: string; color: string; bg: string } {
  const lv = bradenRiskLevel(score);
  if (lv == null) return { label: score == null ? '-' : '범위 밖', color: 'text-gray-500', bg: 'bg-gray-100' };
  if (lv === 'HIGH') return { label: BRADEN_RISK_LABEL.HIGH, color: 'text-red-700', bg: 'bg-red-50' };
  if (lv === 'MODERATE') return { label: BRADEN_RISK_LABEL.MODERATE, color: 'text-orange-700', bg: 'bg-orange-50' };
  return { label: BRADEN_RISK_LABEL.LOW, color: 'text-emerald-700', bg: 'bg-emerald-50' };
}

/** 자동 일정 결과 — 서버가 만든/건너뛴 유형(만들지 않은 이유) */
type AutoSchedules = { enabled: boolean; created: string[]; skipped: Array<{ type: string; reason: 'NO_SCORE' | 'EXISTS' }> };
const SCHEDULE_TYPE_LABEL: Record<string, string> = { FALL_RISK: '낙상', PRESSURE_ULCER: '욕창' };

export default function NursingAssessmentPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const tAttr = useTAttr();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nursing-assessment', admissionId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/admissions/${admissionId}/nursing-assessment`),
    retry: false,
  });

  /**
   * 🔴 쓰기 폼의 초기값은 **미선택**이다(임상 UX 규약 · 시드 흐름 검토 9단계).
   *    종전 초기값은 `명료·독립보행·통증0·영양양호·피부정상` 이었다 —
   *    아무것도 건드리지 않고 「평가 저장」을 누르면 **다섯 항목 전부 '정상'인 법정 간호기록**이
   *    그대로 남는다. 표시보다 저장이 더 위험하다: 이 값은 낙상·욕창·간호과정 판정의 입력이다.
   *    통증도 `0`(통증 없음)이 아니라 **미평가**에서 시작한다.
   */
  const [form, setForm] = useState({
    consciousness: '', mobility: '', painScore: null as number | null, painLocation: '',
    nutritionStatus: '', skinIntegrity: '', bradenScore: null as number | null,
    allergyConfirmed: false,
  });
  const missing = [
    !form.consciousness && '의식수준',
    !form.mobility && '활동정도',
    form.painScore == null && '통증점수',
    !form.nutritionStatus && '영양상태',
    !form.skinIntegrity && '피부상태',
  ].filter(Boolean) as string[];

  /**
   * Braden 입력 방식 — 원내 결정(설정 `nursing.initialAssessment.bradenInput`).
   * 🔴 조회 중·실패를 "총점 방식"으로 접지 않는다 — 서버는 SUBSCORES 일 때 총점만 받은 저장을 거부한다.
   *    모르면 Braden 칸을 닫고(다른 항목은 저장 가능) 이유를 말한다.
   */
  const inputMode = useQuery({
    queryKey: ['config', BRADEN_INPUT_CONFIG_KEY],
    queryFn: () => apiClient.get<{ data: unknown }>(`/api/v1/config/${encodeURIComponent(BRADEN_INPUT_CONFIG_KEY)}`),
    retry: false,
  });
  const bradenMode = inputMode.isSuccess ? bradenInputModeOf((inputMode.data as { data?: unknown } | undefined)?.data) : null;
  const [bradenSub, setBradenSub] = useState<Partial<BradenSubscores>>({});
  const subTotal = bradenTotalOf(bradenSub);
  const subAnswered = BRADEN_ITEMS.filter((i) => typeof bradenSub[i.key] === 'number').length;
  /** 하위 항목을 고르다 만 상태 — 부분 합은 Braden 점수가 아니므로 저장을 막는다(Braden 을 아예 안 하면 막지 않는다) */
  const bradenPartial = bradenMode === 'SUBSCORES' && subAnswered > 0 && subTotal == null;

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => apiClient.post<{ data?: { autoSchedules?: AutoSchedules } }>(`/api/v1/admissions/${admissionId}/nursing-assessment`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nursing-assessment', admissionId] }),
  });
  const autoResult: AutoSchedules | null = (() => {
    const r = createMutation.data as { data?: { autoSchedules?: AutoSchedules }; autoSchedules?: AutoSchedules } | undefined;
    return r?.data?.autoSchedules ?? r?.autoSchedules ?? null;
  })();
  /** 저장 본문 — 방식별로 Braden 을 하나만 보낸다(모를 땐 보내지 않는다) */
  const payload = (): Record<string, unknown> => {
    const { bradenScore, ...rest } = form;
    if (bradenMode === 'SUBSCORES') return subTotal != null ? { ...rest, bradenSubscores: bradenSub } : rest;
    if (bradenMode === 'TOTAL') return { ...rest, bradenScore };
    return rest;
  };

  const assessment = data?.data as (Record<string, unknown> & {
    fallRiskAssessment?: { riskLevel?: string; score?: number };
    nurse?: { familyName?: string; givenName?: string };
    assessedAt?: string;
  }) | undefined;

  if (isLoading) return (
    <div className="max-w-4xl space-y-6">
      <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
      <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />
        ))}
      </div>
    </div>
  );

  const bradenRisk = assessment ? getBradenRisk(assessment.bradenScore as number | null) : null;
  /**
   * 🔴 **미평가 통증을 0(=통증 없음)으로 접지 않는다**(2026-09-02).
   *    같은 파일의 **쓰기** 쪽은 이미 `painScore: null` 초기값·'미평가' 라벨·미선택 저장 차단으로
   *    이 함정을 막고 있는데(P12: 같은 사실에 정본이 둘), 읽기만 `?? 0` 으로 되돌려
   *    한 번도 평가하지 않은 환자에게 초록 **0/10** 게이지를 그렸다. 옆의 Braden 은 `-` 로 옳게 처리한다.
   */
  const painScore = assessment && assessment.painScore != null ? Number(assessment.painScore) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/inpatient" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="입원 목록" />
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="간호초기평가" /></h1>
        <Link href={`/inpatient/${admissionId}/nursing/care-plan`} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm rounded-lg hover:bg-indigo-100"><T k="간호과정 (ADPIE)" /> →</Link>
      </div>

      {/* 방금 저장한 초기평가의 재평가 일정 자동 생성 결과(결정 켜짐일 때만) — 만들지 않은 유형은 이유와 함께 */}
      {autoResult?.enabled && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-900 space-y-0.5" data-auto-schedule-result>
          {autoResult.created.length > 0 && (
            <p><T k="재평가 일정을 자동으로 만들었습니다" />: {autoResult.created.map((t) => tAttr(SCHEDULE_TYPE_LABEL[t] ?? t)).join(' · ')}</p>
          )}
          {autoResult.skipped.map((sk) => (
            <p key={sk.type} data-auto-schedule-skip={`${sk.type}:${sk.reason}`}>
              {tAttr(SCHEDULE_TYPE_LABEL[sk.type] ?? sk.type)} — {sk.reason === 'EXISTS' ? <T k="이미 열린 재평가 일정이 있어 만들지 않았습니다" /> : <T k="점수가 없어 일정을 만들지 않았습니다" />}
            </p>
          ))}
          <Link href="/admin/risk-reassessment" className="inline-flex min-h-[44px] items-center underline"><T k="재평가 관리로" /></Link>
        </div>
      )}
      {assessment ? (
        <div className="space-y-6">
          {/* 2x3 Assessment Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* 의식수준 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium"><T k="의식수준" /></p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{String(assessment.consciousness ?? '-')}</p>
            </div>

            {/* 이동 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium"><T k="활동정도" /></p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{String(assessment.mobility ?? '-')}</p>
            </div>

            {/* 통증 NRS */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${painScore == null ? 'bg-gray-100' : painScore >= 7 ? 'bg-red-50' : painScore >= 4 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                  <svg className={`w-4 h-4 ${painScore == null ? 'text-gray-400' : painScore >= 7 ? 'text-red-600' : painScore >= 4 ? 'text-amber-600' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium"><T k="통증 (NRS)" /></p>
              </div>
              <p className={`text-lg font-semibold ${painScore == null ? 'text-gray-400' : painScore >= 7 ? 'text-red-600' : painScore >= 4 ? 'text-amber-600' : 'text-gray-900'}`}>
                {painScore == null ? <T k="미평가" /> : `${painScore}/10`}
              </p>
              {/* NRS Bar */}
              <div className="mt-2 flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-full ${
                      painScore != null && i < painScore
                        ? i < 4 ? 'bg-emerald-400' : i < 7 ? 'bg-amber-400' : 'bg-red-500'
                        : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-gray-400">0</span>
                <span className="text-[9px] text-gray-400">10</span>
              </div>
              {assessment.painLocation ? (
                <p className="text-[11px] text-gray-500 mt-1"><T k="부위" />: {String(assessment.painLocation)}</p>
              ) : null}
            </div>

            {/* 영양 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium"><T k="영양상태" /></p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{String(assessment.nutritionStatus ?? '-')}</p>
            </div>

            {/* 피부 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium"><T k="피부상태" /></p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{String(assessment.skinIntegrity ?? '-')}</p>
            </div>

            {/* Braden Score */}
            <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 ${bradenRisk ? `ring-2 ${bradenRisk.color === 'text-red-700' ? 'ring-red-200' : bradenRisk.color === 'text-orange-700' ? 'ring-orange-200' : 'ring-transparent'}` : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bradenRisk?.bg ?? 'bg-gray-100'}`}>
                  <svg className={`w-4 h-4 ${bradenRisk?.color ?? 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                </div>
                <p className="text-xs text-gray-400 font-medium">Braden Score</p>
              </div>
              <div className="flex items-baseline gap-2">
                <p className={`text-lg font-semibold ${bradenRisk?.color ?? 'text-gray-900'}`}>
                  {assessment.bradenScore != null ? String(assessment.bradenScore) : '-'}
                </p>
                {bradenRisk && assessment.bradenScore != null && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${bradenRisk.bg} ${bradenRisk.color}`}>
                    {bradenRisk.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 알레르기 확인 */}
          <div className={`rounded-xl p-3 ${assessment.allergyConfirmed ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`text-sm font-medium ${assessment.allergyConfirmed ? 'text-emerald-700' : 'text-red-700'}`}>
              <T k={assessment.allergyConfirmed ? '알레르기 확인 완료' : '알레르기 미확인'} />
            </p>
          </div>

          {/* 낙상위험 */}
          {assessment.fallRiskAssessment && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-sm font-medium text-amber-700">
                <T k="낙상위험" />: {assessment.fallRiskAssessment.riskLevel} (<T k="점수" />: {assessment.fallRiskAssessment.score})
              </p>
            </div>
          )}

          {/* 평가자 + 재사정 */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              <T k="평가자" />: {assessment.nurse?.familyName}{assessment.nurse?.givenName} | {assessment.assessedAt?.split('T')[0]}
            </p>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['nursing-assessment', admissionId] })}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 transition-colors"
            >
              <T k="재사정" />
            </button>
          </div>
        </div>
      ) : (
        /**
         * 🔴 조회 **실패**(500·네트워크)를 "아직 없습니다"로 그리고 작성 폼까지 열면,
         *    이미 평가가 있는 환자에게 간호사가 **중복 법정기록**을 쓰게 된다(2026-09-02).
         *    404(진짜 없음)와 그 밖의 실패를 가른다.
         */
        isError && !/404|찾을 수 없|not found/i.test(String((error as { message?: string })?.message ?? '')) ? (
          <QueryErrorFallback error={error} onRetry={() => refetch()} />
        ) : error ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-indigo-50 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </div>
            <div>
              <p className="text-gray-900 font-semibold"><T k="간호초기평가가 아직 없습니다" /></p>
              <p className="text-sm text-gray-500 mt-1"><T k="환자 입원 시 간호초기평가를 작성해주세요." /></p>
            </div>
            {/* Inline form below */}
          </div>
        ) : null
      )}

      {/* 평가 작성 폼: assessment가 없을 때 */}
      {!assessment && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900"><T k="간호초기평가 작성" /></h3>
          <div className="grid grid-cols-2 gap-4">
            <Select label="의식수준" value={form.consciousness} options={CONSCIOUSNESS} onChange={v => setForm(f => ({ ...f, consciousness: v }))} />
            <Select label="활동정도" value={form.mobility} options={MOBILITY} onChange={v => setForm(f => ({ ...f, mobility: v }))} />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="통증점수 (NRS 0-10)" /></label>
              {/* 🔴 슬라이더가 0 에 놓여 있으면 "통증 없음"을 이미 평가한 것처럼 보인다 — 누르기 전엔 미평가다 */}
              <input type="range" min={0} max={10} value={form.painScore ?? 0} onChange={e => setForm(f => ({ ...f, painScore: +e.target.value }))} className="w-full" />
              <div className="flex gap-0.5 mt-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-full ${
                      form.painScore != null && i < form.painScore
                        ? i < 4 ? 'bg-emerald-400' : i < 7 ? 'bg-amber-400' : 'bg-red-500'
                        : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
              {form.painScore == null ? (
                <div className="flex items-center justify-center gap-2 mt-1">
                  <p className="text-center text-sm font-medium text-amber-700"><T k="미평가" /></p>
                  <button type="button" onClick={() => setForm(f => ({ ...f, painScore: 0 }))}
                    className="text-[11px] px-2 py-0.5 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"><T k="통증 없음(0) 확인" /></button>
                </div>
              ) : (
                <p className={`text-center text-sm font-medium mt-1 ${form.painScore >= 7 ? 'text-red-600' : form.painScore >= 4 ? 'text-amber-600' : 'text-gray-900'}`}>{form.painScore}/10</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="통증부위" /></label>
              <input value={form.painLocation} onChange={e => setForm(f => ({ ...f, painLocation: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <Select label="영양상태" value={form.nutritionStatus} options={NUTRITION} onChange={v => setForm(f => ({ ...f, nutritionStatus: v }))} />
            <Select label="피부상태" value={form.skinIntegrity} options={SKIN} onChange={v => setForm(f => ({ ...f, skinIntegrity: v }))} />
            {bradenMode !== 'SUBSCORES' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Braden Score</label>
                {bradenMode === 'TOTAL' ? (
                  <>
                    <input type="number" min={6} max={23} value={form.bradenScore ?? ''} onChange={e => setForm(f => ({ ...f, bradenScore: e.target.value ? +e.target.value : null }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="6-23" />
                    {form.bradenScore != null && (
                      <p className={`text-xs mt-1 font-medium ${getBradenRisk(form.bradenScore).color}`}>
                        {getBradenRisk(form.bradenScore).label}
                      </p>
                    )}
                  </>
                ) : inputMode.isLoading ? (
                  <p className="text-xs text-gray-400" data-braden-mode="loading"><T k="불러오는 중…" /></p>
                ) : (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-braden-mode="unknown">
                    <T k="Braden 입력 방식(원내 결정)을 확인하지 못해 Braden 칸을 닫았습니다 — 다른 항목은 저장할 수 있습니다." />{' '}
                    <button type="button" onClick={() => inputMode.refetch()} className="min-h-[44px] underline"><T k="다시 시도" /></button>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={form.allergyConfirmed} onChange={e => setForm(f => ({ ...f, allergyConfirmed: e.target.checked }))} className="rounded" />
              <label className="text-sm text-gray-700"><T k="알레르기 확인 완료" /></label>
            </div>
          </div>
          {bradenMode === 'SUBSCORES' && (
            <div className="rounded-xl border border-gray-200 p-3 space-y-2" data-braden-mode="subscores">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-gray-600">Braden Scale <span className="text-gray-400">· <T k="하위 6항목(원내 결정) — 총점은 합" /></span></p>
                {subTotal != null ? (
                  <p className={`text-sm font-semibold ${getBradenRisk(subTotal).color}`} data-braden-total>{subTotal} · {getBradenRisk(subTotal).label}</p>
                ) : (
                  <p className="text-xs text-gray-500"><Tf k="전 항목 선택 필요 ({n}/{total})" params={{ n: subAnswered, total: BRADEN_ITEMS.length }} /></p>
                )}
              </div>
              {BRADEN_ITEMS.map((it) => (
                <div key={it.key} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-24 text-xs text-gray-700"><T k={it.label} /></span>
                  {Array.from({ length: it.max }, (_, i) => i + 1).map((v) => (
                    <button key={v} type="button" aria-pressed={bradenSub[it.key] === v} data-braden-pick={`${it.key}:${v}`}
                      onClick={() => setBradenSub((b) => ({ ...b, [it.key]: v }))}
                      className={`min-h-[44px] min-w-[44px] rounded-lg border text-sm ${bradenSub[it.key] === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300'}`}>
                      {v}
                    </button>
                  ))}
                </div>
              ))}
              {subAnswered > 0 && (
                <button type="button" onClick={() => setBradenSub({})} className="min-h-[44px] text-xs text-gray-500 underline"><T k="Braden 선택 지우기(평가하지 않음)" /></button>
              )}
            </div>
          )}
          {bradenPartial && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-braden-partial>
              <T k="Braden 을 고르다 말았습니다 — 6항목을 모두 고르거나 선택을 지우세요(부분 합은 Braden 점수가 아닙니다)." />
            </p>
          )}
          {missing.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <T k="아직 평가하지 않은 항목:" /> <b>{missing.map((m) => tAttr(m)).join(' · ')}</b> <T k="— 기본값으로 저장하지 않습니다." />
            </p>
          )}
          {createMutation.isError && (
            <p className="text-xs text-red-700" data-save-error><T k="저장하지 못했습니다" />{(createMutation.error as { message?: string })?.message ? ` — ${(createMutation.error as { message: string }).message}` : ''}</p>
          )}
          <button onClick={() => createMutation.mutate(payload())} disabled={createMutation.isPending || missing.length > 0 || bradenPartial} className="min-h-[44px] px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {createMutation.isPending ? <T k="저장중..." /> : missing.length > 0 ? `${tAttr('미평가')} ${missing.length}${tAttr('항목')}` : <T k="평가 저장" />}
          </button>
        </div>
      )}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const tAttr = useTAttr();
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1"><T k={label} /></label>
      {/* 🔴 첫 옵션은 '미선택' — 열자마자 정상값이 골라져 있지 않게 한다 */}
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`w-full px-3 py-2 border rounded-lg text-sm ${value ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40 text-gray-500'}`}>
        <option value="">{tAttr('선택하세요')}</option>
        {/* 🔴 척도 값은 번역하지 않는다(등급=임상 판단·값이 곧 저장값) — 파일 상단 주석 참조 */}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
