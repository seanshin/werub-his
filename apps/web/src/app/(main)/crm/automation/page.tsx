'use client';

import { useCallback, useEffect, useState } from 'react';
import { KDate, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { Data, T, Tf } from '@/components/ui/i18n-text';

interface AutomationStatus {
  pendingReminders: number;
  upcomingFollowUps: number;
  churnRiskCount: number;
}

interface RfmData {
  // 🔴 avgScore 는 **점수 표본(crmScore 산출된 환자)이 없으면 `null`** 이다 — 0 은 최하 등급이라 다른 사실이다.
  rfmSegments: { segment: string; count: number; avgScore: number | null }[];
  churnDistribution: { risk: string; count: number }[];
  totalPatients: number;
  scoredPatients: number;
}

/** `GET /crm/automation/reminders` — 크론 정본(`crm-reminder-jobs.ts`)과 발송 기록 집계 */
interface ReminderJob {
  key: string; label: string; cron: string; logType: string; windowDays: number;
  tally: Record<string, number>; attempted: number; lastRecordedAt: string | null;
}
interface ReminderAutomation {
  jobs: ReminderJob[];
  lastRunAt: string | null;
  manualRun: { available: boolean; reason: string };
}

interface ChurnResult {
  highCount: number;
  mediumCount: number;
  lowCount: number;
  total: number;
}

const RFM_LABEL: Record<string, { label: string; color: string; desc: string }> = {
  CHAMPION: { label: '챔피언', color: 'bg-emerald-500', desc: '최근+자주+고액 — VIP 관리' },
  LOYAL: { label: '충성', color: 'bg-blue-500', desc: '최근+자주 방문 — 리워드' },
  POTENTIAL: { label: '잠재 충성', color: 'bg-indigo-500', desc: '최근+고액 — 재방문 유도' },
  AT_RISK: { label: '이탈 위험', color: 'bg-amber-500', desc: '자주 방문 → 감소 중' },
  CHURNED: { label: '이탈', color: 'bg-red-500', desc: '6개월+ 미방문 — 재활성화' },
  NEW: { label: '신규', color: 'bg-gray-400', desc: '1회 방문 — 환영 시퀀스' },
};

/**
 * 표시용 카탈로그 키 — 🔴 위 RFM_LABEL(원문 정본)은 그대로 두고 동음이의만 문맥 키로 가른다.
 * 무문맥 '이탈'은 checkup 카탈로그의 'Out of limit'(활력징후 이탈)이라 고객 이탈과 뜻이 다르다.
 */
const RFM_I18N: Record<string, string> = { CHURNED: '이탈@CRM' };
const rfmKey = (segment: string, label: string) => RFM_I18N[segment] ?? label;

const CHURN_COLOR: Record<string, string> = {
  HIGH: 'text-red-600', MEDIUM: 'text-amber-600', LOW: 'text-emerald-600',
};

/**
 * 🔴 (2026-09-14) 발송하는 크론(예약·검진·치과·해외환자)은 이 표에서 뺐다 — 화면에 한 벌 더 적은 사본이라
 *    해외환자 사후관리가 빠져 있었고, 모든 행에 확인하지 않은 '활성' 배지를 달았다. 발송 크론은 서버 정본
 *    (`crm-reminder-jobs.ts`)과 발송 기록 집계로 아래 '자동 연락' 카드가 그린다. 여기는 발송하지 않는 크론만.
 */
const CRON_JOBS = [
  { name: '세그먼트 자동 갱신', schedule: '매일 05:00', target: '모든 활성 세그먼트', channel: '-' },
  { name: '이탈 감지', schedule: '매주 월 06:00', target: '전체 환자 방문일 스캔', channel: '-' },
  { name: 'RFM 자동 계산', schedule: '매주 월 07:00', target: 'R/F/M 점수 → 세그먼트 분류', channel: '-' },
];

export default function AutomationPage() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [rfm, setRfm] = useState<RfmData | null>(null);
  const [reminders, setReminders] = useState<ReminderAutomation | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ChurnResult | null>(null);
  /** 조회에 실패한 조각 — 비어 있어야 화면이 완전하다 */
  const [failed, setFailed] = useState<string[]>([]);
  const [runError, setRunError] = useState<unknown>(null);

  // 🔴 종전에는 `Promise.all(...).catch(() => {})` 로 삼켰다. RFM 조회가 죽으면 세그먼트·이탈
  //    위험 분포가 **말없이 사라지고**, 현황 카드는 `-` 만 남아 "이탈 위험 환자가 없다"로 읽혔다.
  //    조각별로 반영하고 실패한 조각을 이름으로 말한다.
  const load = useCallback(async () => {
    const [s, r, m] = await Promise.allSettled([
      apiClient.fetch<{ data: AutomationStatus }>('/api/v1/crm/automation/status'),
      apiClient.fetch<{ data: RfmData }>('/api/v1/crm/dashboard/rfm'),
      apiClient.fetch<{ data: ReminderAutomation }>('/api/v1/crm/automation/reminders'),
    ]);
    const bad: string[] = [];
    if (s.status === 'fulfilled') setStatus(s.value.data); else { setStatus(null); bad.push('자동화 현황'); }
    if (m.status === 'fulfilled') setReminders(m.value.data); else { setReminders(null); bad.push('자동 연락 발송 기록'); }
    if (r.status === 'fulfilled') setRfm(r.value.data); else { setRfm(null); bad.push('RFM 세그먼트'); }
    setFailed(bad);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runChurnAnalysis = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await apiClient.fetch<{ data: ChurnResult }>('/api/v1/crm/automation/churn-analysis', { method: 'POST' });
      setResult(res.data);
      await load();
    } catch (e) {
      // 🔴 실행 실패를 삼키면 버튼만 원래대로 돌아와 "실행됐는데 바뀐 게 없다"로 읽힌다.
      setResult(null);
      setRunError(e);
    }
    setRunning(false);
  };

  const maxSegCount = Math.max(...(rfm?.rfmSegments?.map(s => s.count) ?? [1]), 1);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="자동화 + RFM 분석" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="Cron 리마인더, 이탈 감지, RFM 세그먼트 현황" /></p>
      </div>

      {/* 🔴 조회 실패는 빈 화면·`-` 로 사라지지 않고 이름을 말한다 */}
      {failed.length > 0 && (
        <QueryErrorFallback
          size="compact"
          error={new Error(`${failed.join('·')} 조회에 실패했습니다 — 값이 없는 것이 아니라 아래 화면이 불완전합니다.`)}
          onRetry={() => void load()}
        />
      )}

      {/* 현황 카드 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '예약 리마인더 (D-1)', value: status?.pendingReminders ?? '-', icon: '🔔', bg: 'bg-blue-50' },
          { label: '검진 추적 (2주내)', value: status?.upcomingFollowUps ?? '-', icon: '📋', bg: 'bg-amber-50' },
          { label: '이탈 위험 환자', value: status?.churnRiskCount ?? '-', icon: '⚠️', bg: 'bg-red-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl border border-gray-100 p-5`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{s.icon}</span>
              <span className="text-sm font-semibold text-gray-700"><T k={s.label} /></span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* RFM 세그먼트 분포 */}
      {rfm && rfm.rfmSegments.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-700"><T k="RFM 세그먼트 분포" /></h2>
            <span className="text-xs text-gray-400">{rfm.scoredPatients}/{rfm.totalPatients}<Unit>명</Unit> <T k="분석 완료" /></span>
          </div>
          <div className="space-y-3">
            {rfm.rfmSegments.map(seg => {
              const meta = RFM_LABEL[seg.segment ?? ''] ?? { label: seg.segment, color: 'bg-gray-300', desc: '' };
              const pct = Math.round((seg.count / maxSegCount) * 100);
              return (
                <div key={seg.segment} className="flex items-center gap-3">
                  <div className="w-24 text-right">
                    <span className="text-sm font-semibold text-gray-700"><T k={rfmKey(seg.segment, meta.label)} /></span>
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div className={`${meta.color} h-full rounded-full flex items-center justify-end pr-2 transition-all`}
                      style={{ width: `${Math.max(pct, 5)}%` }}>
                      <span className="text-[10px] font-bold text-white">{seg.count}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">{seg.avgScore != null ? `avg ${seg.avgScore}` : <T k="산출 불가" />}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {rfm.rfmSegments.map(seg => {
              const meta = RFM_LABEL[seg.segment ?? ''];
              return meta ? (
                <div key={seg.segment} className="text-[10px] text-gray-500">
                  <span className="font-bold"><T k={rfmKey(seg.segment, meta.label)} />:</span> <T k={meta.desc} />
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* 이탈 위험 분포 */}
      {rfm && rfm.churnDistribution.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="이탈 위험 분포" /></h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            {rfm.churnDistribution.map(c => (
              <div key={c.risk} className="bg-gray-50 rounded-xl p-4">
                <p className={`text-3xl font-bold ${CHURN_COLOR[c.risk ?? ''] ?? 'text-gray-600'}`}>{c.count}</p>
                <p className="text-xs text-gray-500 mt-1">{c.risk}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 자동 연락(발송 크론) — 서버 정본 + 발송 기록 집계 */}
      {reminders && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-1"><T k="자동 연락 크론 — 발송 기록" /></h2>
          <p className="text-xs text-gray-500 mb-1"><T k="기록은 발송 시도입니다 — 환자에게 도달했는지는 알 수 없습니다. SIMULATED 는 제공자가 없어 나가지 않은 건입니다." /></p>
          <p className="text-xs text-amber-700 mb-4"><T k="이 크론들은 설정 스위치·승인 없이 매일 돕니다(운영 모드가 리얼이 아니면 나가지 않음). 수동 실행은 제공하지 않습니다." /></p>
          <div className="space-y-2">
            {reminders.jobs.map((j) => (
              <div key={j.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div>
                  <p className="text-sm font-medium text-gray-900"><Data>{j.label}</Data></p>
                  <p className="text-xs text-gray-500 font-mono">{j.cron} · {j.key}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <Tf k="최근 {일}일 시도 {건수}" params={{ 일: j.windowDays, 건수: j.attempted }} />
                  {(['SENT', 'SIMULATED', 'FAILED'] as const).map((st) => (
                    <span key={st} className="font-mono">{st} {j.tally[st] ?? 0}</span>
                  ))}
                  <span className="text-gray-400">
                    {j.lastRecordedAt ? <><T k="마지막 발송 기록" /> <KDate value={j.lastRecordedAt} mode="datetime" /></> : <T k="발송 기록 없음" />}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3"><T k="마지막 실행 시각은 기록하지 않습니다(대상이 0건인 날은 발송 기록도 없습니다)." /></p>
        </div>
      )}

      {/* Cron 스케줄 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="자동화 Cron 스케줄" /></h2>
        <div className="space-y-2">
          {CRON_JOBS.map(j => (
            <div key={j.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div>
                <p className="text-sm font-medium text-gray-900"><T k={j.name} /></p>
                <p className="text-xs text-gray-500"><T k={j.target} /></p>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="font-mono"><T k={j.schedule} /></span>
                {j.channel !== '-' && <span>{j.channel}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 수동 실행 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-gray-700"><T k="수동 이탈 분석" /></h2>
          <button onClick={runChurnAnalysis} disabled={running}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 disabled:opacity-50">
            <T k={running ? '분석 중...' : '이탈 분석 실행'} />
          </button>
        </div>
        <p className="text-xs text-gray-500"><T k="전체 환자의 마지막 방문일을 기준으로 churnRisk를 재계산합니다." /></p>

        {runError != null && (
          <div className="mt-3"><QueryErrorFallback size="compact" error={runError} onRetry={runChurnAnalysis} /></div>
        )}

        {result && (
          <div className="bg-gray-50 rounded-xl p-4 mt-4 grid grid-cols-4 gap-4 text-center">
            <div><p className="text-2xl font-bold text-red-600">{result.highCount}</p><p className="text-xs text-gray-500">HIGH</p></div>
            <div><p className="text-2xl font-bold text-amber-600">{result.mediumCount}</p><p className="text-xs text-gray-500">MEDIUM</p></div>
            <div><p className="text-2xl font-bold text-emerald-600">{result.lowCount}</p><p className="text-xs text-gray-500">LOW</p></div>
            <div><p className="text-2xl font-bold text-gray-900">{result.total}</p><p className="text-xs text-gray-500"><T k="전체" /></p></div>
          </div>
        )}
      </div>
    </div>
  );
}
