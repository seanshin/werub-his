'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { UNMEASURED_LABEL } from '@/lib/vital-flags';
import { Unit, Duration } from '@/components/ui/display';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';
import { vitalText } from '@/components/vitals/VitalSigns';
import { VITAL_SIGN_DEF, type VitalSignKey } from '@hospital-run/shared';

/**
 * 수술 후 회복(PACU) 워크스테이션 — **회복실 단말용 보드**.
 *
 * 🔴 2026-08-26 재배선. 종전 이 화면은 `/workstation/station/post-op/queue` 를 불렀는데
 *    서버에 `post-op` 스테이션 배선이 **없다**(`STATION_DEPT_MAP` 미등재 · `workstation_configs`
 *    행 없음) — 그래서 **개통 이래 목록이 구조적으로 항상 비어 있었다.** 게다가 표가 그리던
 *    `aldreteScore`·`vitals` 는 **그 EP 가 준 적 없는 필드**였고(항상 `-`), '퇴실 완료' 버튼은
 *    `orders` 행을 COMPLETED 로 바꿀 뿐이라 **PACU 퇴실 게이트(Aldrete/PADSS·사유·인계)를
 *    통째로 우회**했다. 같은 사실(퇴실)에 정본이 둘이었다.
 *
 *    → 회복실의 정본은 `pacu_records` 다. 이 화면은 그 정본을 **읽어서 보여주기만** 하고,
 *      기록·퇴실은 `/pacu` 한 곳에서만 한다(게이트가 있는 곳).
 */

interface LastVitals {
  time: string | null;
  bp: string | null;
  hr: number | null;
  rr: number | null;
  spo2: number | null;
  temp: number | null;
  consciousness: string | null;
  /** 기록 시점에 **서버가** 판정한 이상 여부 — 화면이 임계를 새로 적지 않는다 */
  abnormal: boolean;
  flags: string[];
}

interface PacuMonitoring {
  vitalsCount: number;
  lastVitalsAt: string | null;
  noVitalsYet: boolean;
  lastVitals: LastVitals | null;
  nextVitalsDueAt: string | null;
  vitalsOverdueMin: number | null;
  vitalsOverdue: boolean;
  stayMinutes: number;
  prolongedStay: boolean;
  lastTemp: number | null;
  hypothermia: boolean | null;
  hypothermiaSeverity: 'SEVERE' | 'MILD' | null;
  aldreteReady: boolean | null;
  padssReady: boolean | null;
  arrivalHandoffRecorded: boolean;
  dischargeHandoffRecorded: boolean;
}

interface PacuActiveRecord {
  id: string;
  patientId: string;
  arrivalTime: string;
  aldretScore: number | null;
  padssScore: number | null;
  painScore: number | null;
  ponvScore: number | null;
  oxygenTherapy: string | null;
  notes: string | null;
  monitoring?: PacuMonitoring;
  patient?: { id: string; mrn: string; familyName: string; givenName: string };
}

interface PendingSurgery {
  id: string;
  patientId: string;
  procedureName: string;
  endedAt: string;
  anesthesiaType?: string;
  patient?: { id: string; familyName: string; givenName: string; mrn: string };
}

interface PacuSettings {
  vitalsIntervalMin: number;
  prolongedStayMin: number;
  hypothermiaWarnC: number;
  source: 'CONFIG' | 'DEFAULT' | 'UNAVAILABLE';
  scales: {
    aldrete: { max: number; dischargeMin: number; items: number };
    padss: { max: number; dischargeMin: number; items: number };
  };
}

type Tab = 'ALL' | 'ATTENTION' | 'READY';

const hhmm = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : kdate(d, 'time');
};

/** 미측정은 `0`·정상이 아니라 **미측정**이라고 쓴다. `0` 은 값이므로 그대로 보인다 */
/** 활력 한 값 — 정본 자릿수·단위(`vitalText`)·미측정 표기. 이상 판정은 화면이 하지 않는다(기록 시점 서버 판정) */
const vt = (k: VitalSignKey, v: number | null | undefined) => {
  const text = vitalText(k, v);
  return text == null ? UNMEASURED_LABEL : `${text}${VITAL_SIGN_DEF[k].displayUnit ?? ''}`;
};

function ScoreCell({ score, max, ready }: { score: number | null; max?: number; ready: boolean | null }) {
  if (score == null) return <span className="text-gray-400"><T k="미평가" /></span>;
  return (
    <span className={`font-bold ${ready === true ? 'text-emerald-600' : 'text-amber-600'}`}>
      {score}
      {max != null && <span className="text-xs font-normal text-gray-400">/{max}</span>}
    </span>
  );
}

export default function PostOpWorkstationPage() {
  const [tab, setTab] = useState<Tab>('ALL');

  const { data: activeRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pacu-active-board'],
    queryFn: () => apiClient.get<{ data: PacuActiveRecord[] }>('/api/v1/pacu/active'),
    refetchInterval: pollMs('fast'),
  });

  const { data: settingsRes } = useQuery({
    queryKey: ['pacu-settings'],
    queryFn: () => apiClient.get<{ data: PacuSettings }>('/api/v1/pacu/settings'),
    staleTime: 5 * 60 * 1000,
  });
  const settings = settingsRes?.data;

  const { data: pendingRes } = useQuery({
    queryKey: ['pacu-pending'],
    queryFn: () => apiClient.get<{ data: PendingSurgery[] }>('/api/v1/pacu/pending-admissions'),
    refetchInterval: pollMs('normal'),
  });
  const pending = pendingRes?.data ?? [];

  const records = activeRes?.data ?? [];

  const needsAttention = (r: PacuActiveRecord) => {
    const m = r.monitoring;
    if (!m) return false;
    return m.vitalsOverdue || m.noVitalsYet || m.prolongedStay || m.hypothermia === true || m.lastVitals?.abnormal === true;
  };
  /** 퇴실 준비됨 = 병동 기준(Aldrete) **또는** 귀가 기준(PADSS) 충족. 미평가는 준비됨이 아니다 */
  const isReady = (r: PacuActiveRecord) => r.monitoring?.aldreteReady === true || r.monitoring?.padssReady === true;

  const attention = records.filter(needsAttention);
  const ready = records.filter(isReady);
  const filtered = tab === 'ATTENTION' ? attention : tab === 'READY' ? ready : records;

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL', label: '재실', count: records.length },
    { key: 'ATTENTION', label: '확인 필요', count: attention.length },
    { key: 'READY', label: '퇴실 기준 충족', count: ready.length },
  ];

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="수술 후 회복(PACU) 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">
            회복실 재실 현황 · 활력 재측정 관제
            {settings && (
              <span className="ml-1 text-xs text-gray-400">
                (재측정 <Duration minutes={settings.vitalsIntervalMin} /> · 재실 초과 <Duration minutes={settings.prolongedStayMin} /> · 저체온 {settings.hypothermiaWarnC}℃ 미만
                {settings.source === 'DEFAULT' && ' · 원내 정책 미설정'}
                {settings.source === 'UNAVAILABLE' && ' · 설정 조회 실패, 기본값 감시 중'})
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pacu" className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 whitespace-nowrap">
            <T k="회복실 기록·퇴실" />
          </Link>
          <Link href="/surgery" className="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 whitespace-nowrap">
            <T k="수술실 메인" />
          </Link>
        </div>
      </div>

      {/* 🔴 이 화면은 읽기 전용이라는 사실을 감추지 않는다 — 기록·퇴실 게이트는 /pacu 한 곳이다 */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="mt-0.5 text-slate-500">👁️</span>
        <p className="text-xs leading-relaxed text-slate-700">
          이 보드는 회복실 기록(<code className="rounded bg-slate-100 px-1">pacu_records</code>)을 <b>읽어서 보여줍니다.</b>
          {' '}활력 기록·Aldrete/PADSS 평가·퇴실은 <Link href="/pacu" className="font-semibold text-indigo-700 underline">회복실 화면</Link>에서 합니다
          {' '}— 퇴실 기준 게이트가 그곳에 있습니다.
        </p>
      </div>

      {/* 상단 지표 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium"><T k="재실" /></span>
          <span className="text-3xl font-bold text-gray-700">{records.length}</span>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-red-600 font-medium"><T k="확인 필요" /></span>
          <span className="text-3xl font-bold text-red-600">{attention.length}</span>
          <span className="text-[10px] text-red-400"><T k="측정 지연·재실 초과·저체온·이상 활력" /></span>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-emerald-600 font-medium"><T k="퇴실 기준 충족" /></span>
          <span className="text-3xl font-bold text-emerald-600">{ready.length}</span>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-amber-600 font-medium"><T k="입실 대기" /></span>
          <span className="text-3xl font-bold text-amber-600">{pending.length}</span>
          <span className="text-[10px] text-amber-400"><T k="수술 완료 · PACU 미입실" /></span>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-semibold rounded-t transition-colors ${
              tab === t.key ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* 표 */}
      {isLoading ? (
        <div className="py-20 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <T k="로딩 중..." />
        </div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <div className="text-4xl mb-3">🩹</div>
          <p>{tab === 'ALL' ? '회복실에 재실 중인 환자가 없습니다' : '해당 환자가 없습니다'}</p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="재실@체류시간" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="활력 재측정" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="마지막 활력" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="체온" /></th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">Aldrete</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">PADSS</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500"><T k="통증" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="인계@인수인계" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(r => {
                const m = r.monitoring;
                const lv = m?.lastVitals ?? null;
                return (
                  <tr key={r.id} className={needsAttention(r) ? 'bg-red-50/40' : ''}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{r.patient?.familyName}{r.patient?.givenName}</p>
                      <p className="text-xs text-gray-400">{r.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className={m?.prolongedStay ? 'font-bold text-red-600' : 'text-gray-600'}>
                        {m ? <Duration minutes={m.stayMinutes} /> : '-'}
                      </span>
                      <p className="text-[10px] text-gray-400">입실 {hhmm(r.arrivalTime)}</p>
                      {m?.prolongedStay && <p className="text-[10px] font-semibold text-red-500"><T k="재실 초과" /></p>}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {!m ? '-' : m.noVitalsYet ? (
                        <span className="font-bold text-amber-600"><T k="입실 후 미측정" /></span>
                      ) : m.vitalsOverdue ? (
                        <span className="font-bold text-red-600"><Duration minutes={m.vitalsOverdueMin} /> <T k="지연" /></span>
                      ) : (
                        <span className="text-gray-600">다음 {hhmm(m.nextVitalsDueAt)}</span>
                      )}
                      {m && !m.noVitalsYet && <p className="text-[10px] text-gray-400">마지막 {hhmm(m.lastVitalsAt)} · {m.vitalsCount}<Unit>회</Unit></p>}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {!lv ? <span className="text-gray-400">{UNMEASURED_LABEL}</span> : (
                        <>
                          <span className={lv.abnormal ? 'font-semibold text-red-600' : 'text-gray-700'}>
                            SpO₂ {vt('spo2', lv.spo2)} · BP {lv.bp ?? UNMEASURED_LABEL} · HR {vt('heartRate', lv.hr)}
                          </span>
                          {/* 이상 판정 근거는 기록 시점 서버 판정 그대로 */}
                          {lv.abnormal && !!lv.flags.length && (
                            <p className="text-[10px] text-red-500 max-w-[220px] truncate" title={lv.flags.join(', ')}>{lv.flags.join(', ')}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {m?.lastTemp == null ? <span className="text-gray-400">{UNMEASURED_LABEL}</span> : (
                        <span className={m.hypothermia ? 'font-bold text-sky-700' : 'text-gray-700'}>
                          {vt('temperature', m.lastTemp)}{m.hypothermia ? (m.hypothermiaSeverity === 'SEVERE' ? ' 저체온' : ' 경도 저체온') : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScoreCell score={r.aldretScore} max={settings?.scales.aldrete.max} ready={m?.aldreteReady ?? null} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScoreCell score={r.padssScore} max={settings?.scales.padss.max} ready={m?.padssReady ?? null} />
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {r.painScore == null ? <span className="text-gray-400">{UNMEASURED_LABEL}</span> : (
                        <span className={r.painScore >= 7 ? 'font-bold text-red-600' : r.painScore >= 4 ? 'font-semibold text-amber-600' : 'text-gray-700'}>
                          {r.painScore}<span className="text-gray-400">/10</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {m?.arrivalHandoffRecorded
                        ? <span className="text-gray-500"><T k="입실 인계 있음" /></span>
                        : <span className="font-semibold text-amber-600"><T k="입실 인계 없음" /></span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link href="/pacu" className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 whitespace-nowrap">
                        <T k="기록" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 입실 대기 — 수술은 끝났는데 아직 회복실 기록이 없는 환자 */}
      {pending.length > 0 && (
        <div className="bg-amber-50/70 rounded-xl border border-amber-100 p-4">
          <p className="text-sm font-bold text-amber-800 mb-2">입실 대기 (수술 완료 · 최근 24시간) · {pending.length}<Unit>건</Unit></p>
          <div className="flex flex-wrap gap-2">
            {pending.map(s => (
              <div key={s.id} className="bg-white rounded-lg border border-amber-100 px-3 py-2">
                <p className="text-xs font-semibold text-gray-800">
                  {s.patient?.familyName}{s.patient?.givenName} <span className="text-gray-400">{s.patient?.mrn}</span>
                </p>
                <p className="text-[10px] text-gray-400">{s.procedureName} · 종료 {hhmm(s.endedAt)}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-amber-700">
            입실 처리는 <Link href="/pacu" className="font-semibold underline">회복실 화면</Link>에서 인수인계와 함께 기록합니다.
          </p>
        </div>
      )}
    </div>
  );
}
