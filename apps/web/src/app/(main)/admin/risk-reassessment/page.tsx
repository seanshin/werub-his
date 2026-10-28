'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Unit, useDurationText } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

// 🔴 원 결함(P11 FE↔서버 계약 불일치): 아래 필드명이 서버와 달랐다.
//    - 지연 목록에서 `scheduleId` 를 읽었으나 서버는 `id` 만 준다 → '지금 평가' 가 /schedules/undefined/assess → 400
//    - `riskLevel` 을 읽었으나 DB 컬럼은 `lastRiskLevel` → 위험도 칸이 영구 '-'
//    - `overdueMinutes` 는 서버가 아예 내려주지 않았다 → 지연 시간 공백
//    이제 DB 컬럼명을 정본으로 삼고, 파생값(overdueMinutes)만 서버가 계산해 내려준다.
interface RiskSchedule {
  id: string;
  assessmentType: string;
  toolName: string;
  intervalHours: number;
  nextDueAt: string;
  lastScore?: number | null;
  lastRiskLevel?: string | null;
  isActive: boolean;
  patient?: { familyName: string; givenName: string; mrn: string };
}

interface OverdueAlert {
  id: string;
  assessmentType: string;
  toolName: string;
  lastScore?: number | null;
  lastRiskLevel?: string | null;
  overdueMinutes: number;
  patient?: { familyName: string; givenName: string; mrn: string };
}

interface RiskStats {
  /** 활성 스케줄이 하나라도 있는가 — false 면 지연·분포는 0 이 아니라 '산출 불가' */
  hasSample: boolean;
  activeSchedules: number;
  overdueCount: number;
  neverAssessed: number;
  byType: Record<string, number>;
  riskDistribution: Record<string, number>;
  /** 일정 자동 생성 결정(2026-10-10) — null = 서버가 모름(꺼짐이 아니다) · 필드 없음 = 구 서버 */
  policy?: { onAssessment: boolean | null; onAdmission: boolean | null };
}

/** 결정 키 — 화면은 결정 화면으로 보낸다(여기서 켜지 않는다) */
const AUTO_SCHEDULE_DECISION_KEY = 'nursing.reassessment.autoScheduleOnAdmission';

/** 켜짐/꺼짐/모름 — 모름을 꺼짐으로 그리지 않는다 */
function PolicyState({ v }: { v: boolean | null | undefined }) {
  if (v === true) return <b className="text-emerald-700" data-policy-state="on"><T k="켜짐" /></b>;
  if (v === false) return <b className="text-gray-700" data-policy-state="off"><T k="꺼짐" /></b>;
  return <b className="text-amber-700" data-policy-state="unknown"><T k="확인 불가" /></b>;
}

type RiskTab = 'overdue' | 'schedules' | 'stats';

const RISK_LABEL: Record<string, string> = { LOW: '저위험', MODERATE: '중위험', HIGH: '고위험' };
const RISK_COLOR: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700',
  MODERATE: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-red-100 text-red-700',
};

// 🔴 원 결함: 키가 'FALL'/'PRESSURE' 였는데 서버·DB 값은 'FALL_RISK'/'PRESSURE_ULCER' 다.
//    라벨은 원문 노출로 떨어지고, 통계의 '낙상 평가'/'욕창 평가' 카운트는 영구 0 이었다.
const TYPE_LABEL: Record<string, string> = { FALL_RISK: '낙상', PRESSURE_ULCER: '욕창' };
const TYPE_KEYS = ['FALL_RISK', 'PRESSURE_ULCER'] as const;
const TOOL_LABEL: Record<string, string> = { MORSE: 'Morse Fall Scale', BRADEN: 'Braden Scale' };

// Morse Fall Scale items
const MORSE_ITEMS = [
  { key: 'fallHistory', label: '낙상력', options: [{ value: 0, label: '없음' }, { value: 25, label: '있음' }] },
  { key: 'secondaryDiagnosis', label: '2차 진단', options: [{ value: 0, label: '없음' }, { value: 15, label: '있음' }] },
  { key: 'ambulatoryAid', label: '보행 보조기', options: [{ value: 0, label: '없음/침상안정/간호사 보조' }, { value: 15, label: '목발/지팡이/워커' }, { value: 30, label: '가구 의지 보행' }] },
  { key: 'ivTherapy', label: 'IV 치료/헤파린 락', options: [{ value: 0, label: '없음' }, { value: 20, label: '있음' }] },
  { key: 'gait', label: '보행 능력', options: [{ value: 0, label: '정상/침상안정/부동' }, { value: 10, label: '허약' }, { value: 20, label: '장애' }] },
  { key: 'mentalStatus', label: '정신 상태', options: [{ value: 0, label: '자기능력 인지' }, { value: 15, label: '능력 과대평가/잊음' }] },
];

// Braden Scale items
const BRADEN_ITEMS = [
  { key: 'sensoryPerception', label: '감각 인지', options: [{ value: 1, label: '완전 제한' }, { value: 2, label: '매우 제한' }, { value: 3, label: '약간 제한' }, { value: 4, label: '장애 없음' }] },
  { key: 'moisture', label: '습기', options: [{ value: 1, label: '항상 축축' }, { value: 2, label: '매우 축축' }, { value: 3, label: '가끔 축축' }, { value: 4, label: '거의 건조' }] },
  { key: 'activity', label: '활동', options: [{ value: 1, label: '침상안정' }, { value: 2, label: '의자' }, { value: 3, label: '가끔 보행' }, { value: 4, label: '자주 보행' }] },
  { key: 'mobility', label: '이동성', options: [{ value: 1, label: '완전 부동' }, { value: 2, label: '매우 제한' }, { value: 3, label: '약간 제한' }, { value: 4, label: '제한 없음@브레이든' }] },
  { key: 'nutrition', label: '영양', options: [{ value: 1, label: '매우 불량' }, { value: 2, label: '부적절' }, { value: 3, label: '적절' }, { value: 4, label: '우수' }] },
  { key: 'frictionShear', label: '마찰/전단력', options: [{ value: 1, label: '문제 있음' }, { value: 2, label: '잠재적 문제' }, { value: 3, label: '문제 없음' }] },
];

// 아래 두 함수는 **입력 중 미리보기 전용**이다. 저장되는 위험등급의 정본은 서버
// (apps/api/src/modules/risk-reassessment/risk-reassessment.policy.ts) 하나뿐이며,
// 임계값(Morse 25/45 · Braden 12/14)이 서버와 동일해야 한다.
function getMorseRisk(score: number): string {
  if (score >= 45) return 'HIGH';
  if (score >= 25) return 'MODERATE';
  return 'LOW';
}

function getBradenRisk(score: number): string {
  if (score <= 12) return 'HIGH';
  if (score <= 14) return 'MODERATE';
  return 'LOW';
}

// 🔴 삭제됨: `getRiskInterval` — 재평가 주기 정본이 FE/BE 두 벌이었고 값이 서로 반대였다
//    (FE 고위험 4h vs BE 고위험 2h). FE 가 계산해 보낸 suggestedInterval 은 서버가 무시했으므로
//    화면에 안내한 주기와 실제로 잡힌 다음 평가 시각이 달랐다.
//    주기 정본 = risk-reassessment.policy.ts. FE 는 서버가 돌려준 intervalHours 만 표시한다.

export default function RiskReassessmentPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<RiskTab>('overdue');
  const [assessModalId, setAssessModalId] = useState<string | null>(null);
  const [assessTool, setAssessTool] = useState<string>('');
  // 🔴 (2026-10-10) 쓰기 폼은 미선택으로 시작한다 — 종전엔 Morse 전 항목 0(가장 안전)·Braden 전 항목 최고(23 = 저위험)로 열려
  //    아무것도 고르지 않고 '평가 기록'을 누르면 그 값이 평가로 남았다. 전 항목을 골라야 합계·등급이 나오고 저장된다.
  const [morseScores, setMorseScores] = useState<Record<string, number>>({});
  const [bradenScores, setBradenScores] = useState<Record<string, number>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['risk-schedules'],
    queryFn: () => apiClient.get<{ data: RiskSchedule[] }>('/api/v1/risk-reassessment/schedules'),
    refetchInterval: pollMs('normal'),
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ['risk-overdue'],
    queryFn: () => apiClient.get<{ data: OverdueAlert[] }>('/api/v1/risk-reassessment/overdue'),
    refetchInterval: pollMs('fast'),
  });

  // 상단 KPI 가 모든 탭에서 hasSample(표본 유무)을 알아야 하므로 탭과 무관하게 조회한다
  const { data: statsData } = useQuery({
    queryKey: ['risk-stats'],
    queryFn: () => apiClient.get<{ data: RiskStats }>('/api/v1/risk-reassessment/stats'),
    refetchInterval: pollMs('normal'),
  });

  // 서버 계약: { totalScore, scores } 만 보낸다. 위험등급·다음 주기는 서버가 산출한다(정본 단일).
  const assessMut = useMutation({
    mutationFn: ({ scheduleId, ...body }: { scheduleId: string; scores: Record<string, number>; totalScore: number }) =>
      apiClient.post(`/api/v1/risk-reassessment/schedules/${scheduleId}/assess`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risk-schedules'] });
      qc.invalidateQueries({ queryKey: ['risk-overdue'] });
      qc.invalidateQueries({ queryKey: ['risk-stats'] });
      toast.success(tAttr('평가 기록 완료'));
      setAssessModalId(null);
    },
    onError: (e: unknown) => toast.error(`${tAttr('평가 기록 실패')}${e instanceof Error && e.message ? ` — ${e.message}` : ''}`),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/risk-reassessment/schedules/${id}/deactivate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['risk-schedules'] }); toast.success(tAttr('비활성화 완료')); },
    onError: () => toast.error(tAttr('비활성화 실패')),
  });

  const _raw = data?.data;
  const allSchedules: RiskSchedule[] = Array.isArray(_raw) ? _raw : (_raw as unknown as Record<string, unknown>)?.data as RiskSchedule[] ?? [];
  const activeSchedules = allSchedules.filter(s => s.isActive);
  const overdueAlerts: OverdueAlert[] = (() => { const r = overdueData?.data; return Array.isArray(r) ? r : (r as unknown as Record<string, unknown>)?.data as OverdueAlert[] ?? []; })();
  const stats: RiskStats | null = (() => { const r = statsData?.data; if (!r) return null; return (r as unknown as Record<string, unknown>)?.data as RiskStats ?? r as unknown as RiskStats; })();

  // 🔴 표본 부재 판정 — 활성 스케줄이 0이면 "지연 0건"이 아니라 **지연 여부를 산출할 수 없다**.
  //    서버 stats.hasSample 을 1차 근거로, 아직 못 받았으면 목록으로 판정한다.
  //    (구 서버 응답에 hasSample 이 없을 수 있으므로 활성 스케줄 수로 폴백 — 있는 표본을 '없음'으로 말하지 않는다)
  const listLoaded = !isLoading;
  const hasSample = typeof stats?.hasSample === 'boolean'
    ? stats.hasSample
    : typeof stats?.activeSchedules === 'number'
      ? stats.activeSchedules > 0
      : listLoaded ? activeSchedules.length > 0 : true;
  const sampleKnown = !!stats || listLoaded;
  /** 표본이 없거나 아직 모르면 숫자 대신 '산출 불가'/'—' */
  const metric = (n: number | undefined) => (!sampleKnown ? '—' : !hasSample ? '산출 불가' : String(n ?? 0));

  const morseTotal = Object.values(morseScores).reduce((s, v) => s + v, 0);
  const bradenTotal = Object.values(bradenScores).reduce((s, v) => s + v, 0);
  const morseComplete = MORSE_ITEMS.every((i) => typeof morseScores[i.key] === 'number');
  const bradenComplete = BRADEN_ITEMS.every((i) => typeof bradenScores[i.key] === 'number');
  const assessComplete = assessTool === 'MORSE' ? morseComplete : bradenComplete;
  const assessAnswered = Object.keys(assessTool === 'MORSE' ? morseScores : bradenScores).length;
  const assessItemCount = (assessTool === 'MORSE' ? MORSE_ITEMS : BRADEN_ITEMS).length;

  const openAssessModal = (scheduleId: string, tool: string) => {
    setAssessModalId(scheduleId);
    setAssessTool(tool);
    if (tool === 'MORSE') setMorseScores({});
    else setBradenScores({});
  };

  const handleSubmitAssessment = () => {
    if (!assessModalId || !assessComplete) return;
    const isMorse = assessTool === 'MORSE';
    assessMut.mutate({
      scheduleId: assessModalId,
      scores: isMorse ? morseScores : bradenScores,
      totalScore: isMorse ? morseTotal : bradenTotal,
    });
  };

  // 지연 표기는 표시 정본 경유 — 재평가 지연이 며칠 단위로 벌어지면 시간으로만 보여선 안 된다
  const formatOverdue = useDurationText();

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900"><T k="낙상/욕창 재평가 관리" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="Morse Fall Scale / Braden Scale 자동 스케줄 관리" /></p>
      </div>

      {/* 일정 자동 생성 — 원내 결정(환자안전위원회 몫). 켜고 끄는 것은 결정 화면에서(여기서 바꾸지 않는다) */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-600" data-auto-schedule-policy>
          <span><T k="초기평가 저장 때 점수로 일정 자동 생성" />: <PolicyState v={stats.policy?.onAssessment} /></span>
          <span><T k="입원 순간 일정 자동 생성(저위험 주기)" />: <PolicyState v={stats.policy?.onAdmission} /></span>
          <Link href={`/admin/decisions/${encodeURIComponent(AUTO_SCHEDULE_DECISION_KEY)}`} className="ml-auto min-h-[44px] inline-flex items-center text-blue-600 underline"><T k="결정 화면에서 정하기" /></Link>
        </div>
      )}

      {/* 🔴 표본 부재 고지 — 스케줄이 0행이면 화면은 "지연 없음"이 아니라 "판정할 수 없음"이라고 말해야 한다 */}
      {sampleKnown && !hasSample && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="risk-no-sample-banner">
          <p className="text-sm font-bold text-amber-900"><T k="재평가 스케줄이 등록되지 않았습니다 — 지연 여부를 판정할 수 없습니다" /></p>
          <p className="text-xs text-amber-800 mt-1.5 leading-relaxed">
            <T k="현재 활성 스케줄" /> <b><T k="0건" /></b><T k="이므로 아래의 지연 건수·위험도 분포는" /> <b><T k="“0건”이 아니라 산출 불가" /></b><T k="입니다." />{' '}
            <T k="입원 시 자동 생성 배선은" /> <b><T k="연결되어 있으나 기본 꺼짐" /></b><T k="입니다 — 시스템 설정의" />{' '}
            <code className="font-mono">risk.reassessment.autoCreate</code> <T k="를 켜야 입원마다 낙상(Morse)·욕창(Braden) 스케줄이 생깁니다. 기본값이 꺼짐인 이유는 기능 미완성이 아니라" />
            <b> <T k="재평가 주기 표가 환자안전위원회 미확정 잠정값" /></b><T k="이기 때문입니다(확정 전에 켜면 잘못된 주기로 법정기록이 쌓입니다)." />{' '}
            <T k="켜기 전까지 재원 환자 재평가는 이 화면에서" /> <b><T k="추적되지 않습니다" /></b> <T k="— 병동 수기 절차로 관리 중인지 확인하십시오." />
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-blue-500 font-medium"><T k="활성 스케줄" /></p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{sampleKnown ? (stats?.activeSchedules ?? activeSchedules.length) : '—'}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs text-red-500 font-medium"><T k="지연 건수" /></p>
          <p className={`font-bold text-red-700 mt-1 ${hasSample && sampleKnown ? 'text-3xl' : 'text-lg pt-2'}`}>
            <T k={metric(stats?.overdueCount ?? overdueAlerts.length)} />
          </p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-xs text-amber-500 font-medium"><T k="낙상 평가" /></p>
          <p className={`font-bold text-amber-700 mt-1 ${hasSample && sampleKnown ? 'text-3xl' : 'text-lg pt-2'}`}>
            <T k={metric(stats?.byType?.FALL_RISK ?? activeSchedules.filter(s => s.assessmentType === 'FALL_RISK').length)} />
          </p>
        </div>
        <div className="bg-indigo-50 rounded-xl p-4">
          <p className="text-xs text-indigo-500 font-medium"><T k="욕창 평가" /></p>
          <p className={`font-bold text-indigo-700 mt-1 ${hasSample && sampleKnown ? 'text-3xl' : 'text-lg pt-2'}`}>
            <T k={metric(stats?.byType?.PRESSURE_ULCER ?? activeSchedules.filter(s => s.assessmentType === 'PRESSURE_ULCER').length)} />
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'overdue' as RiskTab, label: <><T k="지연 알림" />{overdueAlerts.length > 0 ? ` (${overdueAlerts.length})` : ''}</> },
          { key: 'schedules' as RiskTab, label: <T k="활성 스케줄" /> },
          { key: 'stats' as RiskTab, label: <T k="통계" /> },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* Assessment Modal */}
      {assessModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {assessTool === 'MORSE' ? 'Morse Fall Scale' : 'Braden Scale'} <T k="평가" />
              </h3>
              <button onClick={() => setAssessModalId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {assessTool === 'MORSE' ? (
              <div className="space-y-4">
                {MORSE_ITEMS.map(item => (
                  <div key={item.key}>
                    <p className="text-xs font-medium text-gray-700 mb-1.5"><T k={item.label} /></p>
                    <div className="space-y-1">
                      {item.options.map(opt => (
                        <button key={opt.value} onClick={() => setMorseScores(s => ({ ...s, [item.key]: opt.value }))}
                          className={`w-full text-left px-3 py-2 text-xs rounded-lg border transition-colors ${
                            morseScores[item.key] === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          {opt.value}<Unit>점</Unit> - <T k={opt.label} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 mt-4">
                  <span className="text-sm font-medium text-gray-700"><T k="합계" /></span>
                  <div className="flex items-center gap-2">
                    {morseComplete ? (
                      <>
                        <span className="text-xl font-bold text-gray-900">{morseTotal}<Unit>점</Unit></span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[getMorseRisk(morseTotal)]}`}>
                          <T k={RISK_LABEL[getMorseRisk(morseTotal)]} />
                        </span>
                      </>
                    ) : <span className="text-xs text-gray-500" data-assess-unscored><T k="미평가(전 항목 선택 전)" /></span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {BRADEN_ITEMS.map(item => (
                  <div key={item.key}>
                    <p className="text-xs font-medium text-gray-700 mb-1.5"><T k={item.label} /></p>
                    <div className="flex gap-1">
                      {item.options.map(opt => (
                        <button key={opt.value} onClick={() => setBradenScores(s => ({ ...s, [item.key]: opt.value }))}
                          className={`flex-1 px-2 py-1.5 text-[10px] rounded-lg border transition-colors ${
                            bradenScores[item.key] === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          {opt.value} - <T k={opt.label} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 mt-4">
                  <span className="text-sm font-medium text-gray-700"><T k="합계" /></span>
                  <div className="flex items-center gap-2">
                    {bradenComplete ? (
                      <>
                        <span className="text-xl font-bold text-gray-900">{bradenTotal}<Unit>점</Unit></span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[getBradenRisk(bradenTotal)]}`}>
                          <T k={RISK_LABEL[getBradenRisk(bradenTotal)]} />
                        </span>
                      </>
                    ) : <span className="text-xs text-gray-500" data-assess-unscored><T k="미평가(전 항목 선택 전)" /></span>}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmitAssessment} disabled={assessMut.isPending || !assessComplete} data-assess-submit
                className="flex-1 min-h-[44px] py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {assessMut.isPending ? <T k="기록 중..." /> : assessComplete ? <T k="평가 기록" /> : <Tf k="전 항목 선택 필요 ({n}/{total})" params={{ n: assessAnswered, total: assessItemCount }} />}
              </button>
              <button onClick={() => setAssessModalId(null)}
                className="px-4 py-2.5 text-sm font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Overdue Tab */}
      {tab === 'overdue' && (
        <div className="space-y-3">
          {overdueLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-red-50 rounded-2xl border border-red-200 p-4">
                <div className="h-4 bg-red-100 rounded animate-pulse mb-2" />
                <div className="h-3 bg-red-100 rounded animate-pulse w-2/3" />
              </div>
            ))
          ) : overdueAlerts.length === 0 ? (
            /* 🔴 원 결함(P17): 스케줄이 0행인데도 "지연된 재평가가 없습니다"라며 안심시켰다.
               표본이 없으면 '없음'이 아니라 '판정 불가'다. 표본이 있을 때만 '없음'이라고 말한다. */
            <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm" data-testid="risk-overdue-empty">
              {hasSample ? (
                <p className="text-sm text-gray-400"><T k="지연된 재평가가 없습니다" /></p>
              ) : (
                <>
                  <p className="text-sm font-medium text-amber-700"><T k="재평가 스케줄이 등록되지 않았습니다" /></p>
                  <p className="text-xs text-gray-400 mt-1"><T k="표본이 없어 지연 여부를 산출할 수 없습니다." /></p>
                </>
              )}
            </div>
          ) : overdueAlerts.map(alert => (
            <div key={alert.id} className="bg-red-50 rounded-2xl border border-red-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <p className="text-sm font-bold text-red-900">{alert.patient?.familyName}{alert.patient?.givenName}</p>
                  <span className="text-[10px] text-red-500">{alert.patient?.mrn}</span>
                </div>
                <span className="text-xs font-bold text-red-700">{formatOverdue(alert.overdueMinutes)} <T k="지연@재평가" /></span>
              </div>
              <div className="flex items-center gap-3 text-xs text-red-700 mb-3">
                <span><T k={TYPE_LABEL[alert.assessmentType] ?? alert.assessmentType} /></span>
                <span>{TOOL_LABEL[alert.toolName] ?? alert.toolName}</span>
                <span><T k="마지막 점수:" /> {alert.lastScore ?? <T k="평가 이력 없음" />}</span>
                {alert.lastRiskLevel && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[alert.lastRiskLevel]}`}>
                    <T k={RISK_LABEL[alert.lastRiskLevel] ?? alert.lastRiskLevel} />
                  </span>
                )}
              </div>
              <button onClick={() => openAssessModal(alert.id, alert.toolName)}
                className="px-4 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
                <T k="지금 평가" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Active Schedules Tab */}
      {tab === 'schedules' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="도구" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="주기(시간)" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="다음평가" /></th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500"><T k="마지막점수" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="위험도" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : activeSchedules.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center">
                  <p className="text-sm font-medium text-amber-700"><T k="재평가 스케줄이 등록되지 않았습니다" /></p>
                  <p className="text-xs text-gray-400 mt-1"><T k="입원 시 자동 생성이 배선되어 있지 않습니다 — 재원 환자의 낙상·욕창 재평가는 이 화면에서 추적되지 않습니다." /></p>
                </td></tr>
              ) : activeSchedules.map(sch => {
                const isOverdue = new Date(sch.nextDueAt) < new Date();
                return (
                  <tr key={sch.id} className={`border-b border-gray-50 ${isOverdue ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{sch.patient?.familyName}{sch.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{sch.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700">
                        <T k={TYPE_LABEL[sch.assessmentType] ?? sch.assessmentType} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700"><T k={TOOL_LABEL[sch.toolName] ?? sch.toolName} /></td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-gray-700">{sch.intervalHours}h</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={isOverdue ? 'text-red-600 font-bold' : 'text-gray-500'}>
                        {kdate(sch.nextDueAt, 'datetimeShort')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-gray-700">{sch.lastScore ?? '-'}</td>
                    <td className="px-4 py-3">
                      {sch.lastRiskLevel ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[sch.lastRiskLevel]}`}>
                          <T k={RISK_LABEL[sch.lastRiskLevel] ?? sch.lastRiskLevel} />
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400 whitespace-nowrap"><T k="미평가" /></span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openAssessModal(sch.id, sch.toolName)}
                          className="px-2.5 py-1 text-[10px] font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 whitespace-nowrap">
                          <T k="평가 기록" />
                        </button>
                        <button onClick={() => deactivateMut.mutate(sch.id)} disabled={deactivateMut.isPending}
                          className="px-2.5 py-1 text-[10px] font-medium bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300 whitespace-nowrap">
                          <T k="비활성화" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats Tab */}
      {tab === 'stats' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="활성 스케줄" /></p>
            <p className="text-4xl font-bold text-gray-900">{sampleKnown ? (stats?.activeSchedules ?? activeSchedules.length) : '—'}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="지연 건수" /></p>
            <p className={`font-bold text-red-700 ${hasSample && sampleKnown ? 'text-4xl' : 'text-base pt-3'}`}>
              <T k={metric(stats?.overdueCount ?? overdueAlerts.length)} />
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="유형별 분포" /></p>
            {!hasSample && sampleKnown ? (
              <p className="text-xs text-amber-700 font-medium mt-2"><T k="표본 없음 — 산출 불가" /></p>
            ) : (
              <div className="space-y-2 mt-2">
                {TYPE_KEYS.map(type => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700">
                      <T k={TYPE_LABEL[type]} />
                    </span>
                    <span className="text-sm font-bold text-gray-900">
                      {stats?.byType?.[type] ?? activeSchedules.filter(s => s.assessmentType === type).length}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-3"><T k="위험도 분포" /></p>
            {/* 🔴 원 결함: 서버가 riskDistribution 을 안 줬고 FE 폴백은 존재하지 않는 필드(riskLevel)로 세어
                항상 전건 0 이었다. 이제 서버 집계만 쓰고, 없으면 '산출 불가'라고 말한다. */}
            {!hasSample && sampleKnown ? (
              <p className="text-xs text-amber-700 font-medium mt-2"><T k="표본 없음 — 산출 불가" /></p>
            ) : !stats ? (
              <p className="text-xs text-gray-400 mt-2"><T k="불러오는 중…" /></p>
            ) : (
              <div className="space-y-2 mt-2">
                {['LOW', 'MODERATE', 'HIGH'].map(level => (
                  <div key={level} className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RISK_COLOR[level]}`}>
                      <T k={RISK_LABEL[level]} />
                    </span>
                    <span className="text-sm font-bold text-gray-900">{stats.riskDistribution?.[level] ?? 0}</span>
                  </div>
                ))}
                {stats.neverAssessed > 0 && (
                  <div className="flex items-center justify-between pt-1.5 border-t border-gray-100">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-600"><T k="미평가" /></span>
                    <span className="text-sm font-bold text-gray-500">{stats.neverAssessed}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
