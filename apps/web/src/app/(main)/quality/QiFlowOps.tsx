'use client';

/**
 * 질관리 운영 패널(QI-FLOW-001 · 2026-10-08) — 사람 결정 현황 · 월 마감 · 분모(재원일수·기구일수) · 보고서.
 *
 *  · 결정 현황 — 값을 바꾸는 길은 위원회 의결뿐이다. 이 화면은 "정해졌다/아무도 정하지 않아 기본값/읽기 실패"를 가른다.
 *  · 월 마감 — 공급원 지표 자동 기록(수기 행은 덮지 않는다) · 판정 · 미달/미입력 알림. 🔴 결과를 "산출 불가 N" 까지 그대로.
 *  · 재원일수 — 덮은 날 수를 함께(덮지 못한 달은 사고율을 내지 않는다)
 *  · 기구일수 — 결정이 MANUAL 일 때만 입력이 열린다 · 폼은 미선택으로 시작
 *  · 보고서 — 만들 때의 본문과 읽은 측정 행을 보존(sha256) · 위원회 제출은 안건이 된다
 */
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QI_DEVICE_TYPES, QI_DEVICE_TYPE_LABEL, QI_FLOW_SETTING_KEYS, QI_SUPPLY_UNAVAILABLE_TEXT, type QiDeviceType } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { lastClosedPeriod } from './QiFlowPanel';
import AccreditationSection from './AccreditationSection';

export interface QiFlowSettings {
  rows: { key: string; decisionKey: string; value: unknown; source: 'db' | 'default' | 'env' | 'unset' | 'error'; provenance?: { by: 'ENACTED' | 'DIRECT' | 'SEED' | 'UNKNOWN'; at: string | null; decisionNo?: string | null; registryKey?: string | null } }[];
  harmLevels: string[] | null;
  accreditationFrameworks: string[];
  /** 기구 원장 전수 기록 시작일(운영 사실 · 설정) */
  deviceLedgerCoverage?: { value: unknown; source: 'db' | 'default' | 'env' | 'unset' | 'error' };
}

export function useQiFlowSettings(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['qi-flow-settings'],
    queryFn: () => apiClient.get<{ data: QiFlowSettings }>('/api/v1/quality-flow/settings').then((r) => r.data),
  });
}

/** 설정 값 하나 — 읽기 실패면 null 이 아니라 undefined(모름) */
export function settingValue(s: QiFlowSettings | undefined, key: string): unknown {
  const r = s?.rows?.find((x) => x.key === key);
  if (!r || r.source === 'error') return undefined;
  return r.value;
}

function SettingsStrip() {
  const q = useQiFlowSettings();
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="h-10 animate-pulse rounded-lg bg-gray-100" />;
  return (
    <div className="grid gap-1.5 text-[11px] sm:grid-cols-2 lg:grid-cols-4" data-qi-flow-settings>
      {QI_FLOW_SETTING_KEYS.map((k) => {
        const r = q.data.rows.find((x) => x.key === k.key);
        const decided = r?.source === 'db' || r?.source === 'env';
        return (
          <div key={k.key} className={`rounded-lg border px-2 py-1.5 ${r?.source === 'error' ? 'border-red-200 bg-red-50' : decided ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`} data-qi-setting={k.key} data-source={r?.source ?? 'missing'}>
            <p className="text-gray-500"><T k={k.label} /></p>
            <p className="font-semibold text-gray-900">
              {r?.source === 'error' ? <T k="읽기 실패" />
                : r?.value == null ? <T k="미정" />
                  : String(r.value)}
              {!decided && r?.source !== 'error' && <span className="ml-1 font-normal text-amber-700">(<T k={r?.value == null ? '결정 전' : '아무도 정하지 않아 기본값'} />)</span>}
            </p>
            {r?.provenance && (
              // 🔴 관리자가 범용 설정 화면에서 바꾼 값을 위원회 의결처럼 그리지 않는다
              <p className={`text-[10px] ${r.provenance.by === 'DIRECT' ? 'text-amber-700' : 'text-gray-500'}`} data-qi-setting-provenance={r.provenance.by}>
                {r.provenance.by === 'ENACTED'
                  ? <><T k="위원회 의결 반영" />{r.provenance.decisionNo ? ` ${r.provenance.decisionNo}` : ''}</>
                  : r.provenance.by === 'DIRECT'
                    ? <T k="관리자 직접 변경 — 위원회 의결 아님" />
                    : r.provenance.by === 'SEED'
                      ? <T k="개발 시드 — 위원회 의결 아님" />
                      : <T k="반영 경로 확인 불가" />}
                {r.provenance.at && <> · <KDate value={r.provenance.at} /></>}
              </p>
            )}
            <p className="font-mono text-[9px] text-gray-400">{k.decisionKey}</p>
          </div>
        );
      })}
      {q.data.deviceLedgerCoverage && (
        <div className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 sm:col-span-2" data-qi-setting="qi.deviceLedger.coverageFrom" data-source={q.data.deviceLedgerCoverage.source}>
          <p className="text-gray-500"><T k="기구 원장 전수 기록 시작일" /></p>
          <p className="font-semibold text-gray-900">
            {q.data.deviceLedgerCoverage.source === 'error' ? <T k="읽기 실패" /> : q.data.deviceLedgerCoverage.value == null ? <T k="미정" /> : String(q.data.deviceLedgerCoverage.value)}
          </p>
          <p className="text-[10px] text-gray-400"><T k="결정이 아니라 감염관리실이 선언하는 운영 사실 — 이 날 이후 달만 원장 기구일수를 냅니다." /></p>
        </div>
      )}
      <p className="text-[10px] text-gray-500 sm:col-span-2 lg:col-span-4">
        <T k="이 값들은 위원회가 결정 등록부에서 의결하면 바뀝니다 — 이 화면에는 바꾸는 버튼이 없습니다." />{' '}
        <Link href="/admin/decisions" className="text-blue-700 underline"><T k="사람 결정 화면" /></Link>
      </p>
    </div>
  );
}

interface MonthCloseResult {
  period: string;
  recorded: { indicatorId: string; name: string; numerator: number; denominator: number }[];
  existing: { indicatorId: string; name: string }[];
  unavailable: { indicatorId: string; name: string; reason: string }[];
  cpoe: { key: string; status: string; reason?: string }[];
  manualMissing: { indicatorId: string; name: string }[];
  targetMissed: { indicatorId: string; name: string; value: number; target: number }[];
  strata?: { indicatorId: string; name: string; recorded: number; existing: number; unassignedIncidents: number; reason: string | null }[];
}

function MonthClose() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useHasRole();
  const [period, setPeriod] = useState(lastClosedPeriod());
  const [result, setResult] = useState<MonthCloseResult | null>(null);
  const run = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error(tAttr('월 마감은 관리자가 합니다.'));
      return apiClient.post<{ data: MonthCloseResult }>('/api/v1/quality-flow/month-close', { period }).then((r) => r.data);
    },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['qi-dashboard'] }); toast.success(tAttr('월 마감을 실행했습니다 — 결과를 확인하십시오.')); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('월 마감을 실행하지 못했습니다.')),
  });
  const cpoeRecorded = result?.cpoe.filter((c) => c.status === 'RECORDED').length ?? 0;
  return (
    <div className="space-y-2 text-xs" data-qi-month-close>
      <p className="text-[11px] text-gray-600"><T k="공급원이 있는 지표는 원장에서 다시 세어 '자동 산출'로 기록합니다(수기 값은 덮지 않습니다). 그 달 정본 값으로 판정해 미달은 담당·질향상위원회에, 수기 지표 미입력은 입력 담당에게 알립니다." /></p>
      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('마감할 달')} />
          <button type="button" onClick={() => run.mutate()} disabled={run.isPending} data-qi-month-close-run className="min-h-[44px] rounded-lg bg-gray-900 px-4 font-semibold text-white disabled:opacity-40">
            <T k="월 마감 실행" />
          </button>
          <span className="text-[10px] text-gray-400"><T k="끝난 달만 · 다시 실행해도 같은 달 자동 값은 한 번만 남습니다" /></span>
        </div>
      ) : <p className="text-[11px] text-gray-400"><T k="월 마감은 관리자가 실행합니다." /></p>}
      {result && (
        <div className="space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-2" data-qi-month-close-result={result.period}>
          <p><Tf k="자동 기록 {a} · 이미 있음 {b} · 셀 수 없음 {c} · 처방 지표 기록 {d} · 수기 미입력 {e} · 목표 미달 {f}" params={{ a: result.recorded.length, b: result.existing.length, c: result.unavailable.length, d: cpoeRecorded, e: result.manualMissing.length, f: result.targetMissed.length }} /></p>
          {result.unavailable.length > 0 && (
            <ul className="list-disc pl-4 text-amber-800" data-qi-close-unavailable>
              {result.unavailable.map((u) => <li key={u.indicatorId}>{u.name} — <T k={QI_SUPPLY_UNAVAILABLE_TEXT[u.reason] ?? u.reason} /></li>)}
            </ul>
          )}
          {result.targetMissed.length > 0 && (
            <ul className="list-disc pl-4 text-red-700" data-qi-close-missed>
              {result.targetMissed.map((m) => <li key={m.indicatorId}>{m.name} — <Tf k="값 {v} · 목표 {t}" params={{ v: m.value, t: m.target }} /></li>)}
            </ul>
          )}
          {(result.strata ?? []).length > 0 && (
            <ul className="list-disc pl-4 text-gray-600" data-qi-close-strata>
              {result.strata!.map((st) => (
                <li key={st.indicatorId}>
                  {st.name} — {st.reason
                    ? <T k={QI_SUPPLY_UNAVAILABLE_TEXT[st.reason] ?? st.reason} />
                    : <Tf k="병동별 기록 {a} · 이미 있음 {b}" params={{ a: st.recorded, b: st.existing }} />}
                  {st.unassignedIncidents > 0 && <span className="ml-1 text-amber-700"><Tf k="(병동 없는 사고 {n}건은 어느 병동에도 넣지 않았습니다)" params={{ n: st.unassignedIncidents }} /></span>}
                </li>
              ))}
            </ul>
          )}
          {result.manualMissing.length > 0 && (
            <p className="text-gray-600" data-qi-close-manual-missing><T k="수기 미입력" />: {result.manualMissing.map((m) => m.name).join(' · ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface PatientDaysSummary { from: string; to: string; coveredDays: number; total: number; byWard: { wardKey: string; wardName: string | null; patientDays: number }[] }

function monthBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}`, days: last };
}

function PatientDays() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useHasRole();
  const [period, setPeriod] = useState(lastClosedPeriod());
  const b = monthBounds(period);
  const q = useQuery({
    queryKey: ['qi-patient-days', period],
    queryFn: () => apiClient.get<{ data: PatientDaysSummary }>(`/api/v1/quality-flow/patient-days?from=${b.from}&to=${b.to}`).then((r) => r.data),
  });
  const rebuild = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error(tAttr('재계산은 관리자가 합니다.'));
      return apiClient.post('/api/v1/quality-flow/patient-days/rebuild', { from: b.from, to: b.to });
    },
    onSuccess: () => { toast.success(tAttr('재원일수를 다시 셌습니다.')); qc.invalidateQueries({ queryKey: ['qi-patient-days', period] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('재원일수를 다시 세지 못했습니다.')),
  });
  return (
    <div className="space-y-2 text-xs" data-qi-patient-days>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('기간')} />
        {isAdmin && (
          <button type="button" onClick={() => rebuild.mutate()} disabled={rebuild.isPending} data-qi-patient-days-rebuild className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-gray-700 disabled:opacity-40">
            <T k="이 달 다시 세기" />
          </button>
        )}
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !q.data ? <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          : (
            <div data-covered={q.data.coveredDays} data-days={b.days}>
              <p className={q.data.coveredDays < b.days ? 'text-amber-700' : 'text-gray-800'}>
                <Tf k="덮은 날 {c}/{d}일 · 재원일수 합 {n}" params={{ c: q.data.coveredDays, d: b.days, n: q.data.total }} />
                {q.data.coveredDays < b.days && <span className="ml-1">— <T k="다 덮지 못한 달은 재원일수 기준 사고율을 내지 않습니다." /></span>}
              </p>
              {q.data.byWard.length > 0 && (
                <p className="text-[11px] text-gray-500">
                  {q.data.byWard.map((w) => `${w.wardKey ? (w.wardName ?? w.wardKey) : tAttr('병동 미상')} ${w.patientDays}`).join(' · ')}
                </p>
              )}
              <p className="text-[10px] text-gray-400"><T k="매일 자정 재원 환자 수(취소 입원 제외) · 병동은 그 시점 병상 배정 이력 — 이력이 없으면 '병동 미상'으로 둡니다." /></p>
            </div>
          )}
    </div>
  );
}

interface DeviceDayList { period: string; source: string | null; accepting: boolean; wards: { id: string; name: string }[]; rows: { id: string; wardKey: string; deviceType: string; days: number; enteredBy: string; updatedAt?: string }[] }

function DeviceDays() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const canWrite = useHasRole('NURSE');
  const [period, setPeriod] = useState(lastClosedPeriod());
  // 🔴 쓰기 폼은 미선택으로 시작한다
  const [form, setForm] = useState({ wardKey: '', deviceType: '' as QiDeviceType | '', days: '' });
  const q = useQuery({
    queryKey: ['qi-device-days', period],
    queryFn: () => apiClient.get<{ data: DeviceDayList }>(`/api/v1/quality-flow/device-days?period=${period}`).then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: () => {
      if (!canWrite) throw new Error(tAttr('기구일수는 간호사·관리자가 입력합니다.'));
      return apiClient.put('/api/v1/quality-flow/device-days', { period, deviceType: form.deviceType, days: Number(form.days), ...(form.wardKey ? { wardKey: form.wardKey } : {}) });
    },
    onSuccess: () => { toast.success(tAttr('기구일수를 저장했습니다.')); setForm({ wardKey: '', deviceType: '', days: '' }); qc.invalidateQueries({ queryKey: ['qi-device-days', period] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('기구일수를 저장하지 못했습니다.')),
  });
  const d = q.data;
  const wardName = (k: string) => (k ? d?.wards.find((w) => w.id === k)?.name ?? k : tAttr('병원 전체'));
  return (
    <div className="space-y-2 text-xs" data-qi-device-days>
      <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('기간')} />
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !d ? <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          : (
            <>
              {!d.accepting && (
                d.source === 'DEVICE_LEDGER' ? (
                  <p className="rounded-lg bg-sky-50 px-2 py-1.5 text-sky-800" data-qi-device-days-ledger>
                    <T k="기구일수는 입원 화면의 삽입 기구 원장에서 자정 기준으로 셉니다 — 수기 입력은 닫혀 있습니다(전수 기록 시작일 이후 달만)." />
                  </p>
                ) : (
                  <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800" data-qi-device-days-closed>
                    <T k={d.source === 'NONE' ? '기구일수를 산출하지 않기로 했습니다(건수만) — 입력이 닫혀 있습니다.' : '기구일수 원천이 정해지지 않았습니다(결정 qi.deviceDays.source) — 정해지기 전에는 입력이 닫혀 있고 기구 관련 감염률은 계산하지 않습니다.'} />
                  </p>
                )
              )}
              {d.rows.length === 0
                ? <p className="text-gray-400"><T k="이 달 입력 없음" /></p>
                : (
                  <ul className="space-y-0.5">
                    {d.rows.map((r) => <li key={r.id}>{wardName(r.wardKey)} · <T k={QI_DEVICE_TYPE_LABEL[r.deviceType as QiDeviceType] ?? r.deviceType} /> · <b className="tabular-nums">{r.days}</b><T k="일" /></li>)}
                  </ul>
                )}
              {d.accepting && canWrite && (
                <div className="flex flex-wrap items-center gap-2" data-qi-device-days-form>
                  <select value={form.wardKey} onChange={(e) => setForm({ ...form, wardKey: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('병동')}>
                    <option value="">{tAttr('병원 전체')}</option>
                    {d.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value as QiDeviceType | '' })} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('기구')}>
                    <option value="">{tAttr('기구 선택')}</option>
                    {QI_DEVICE_TYPES.map((t) => <option key={t} value={t}>{tAttr(QI_DEVICE_TYPE_LABEL[t])}</option>)}
                  </select>
                  <input inputMode="numeric" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} aria-label={tAttr('기구일수')} placeholder={tAttr('기구일수')} className="w-24 rounded-lg border border-gray-200 px-2 py-1" />
                  <button type="button" disabled={!form.deviceType || !/^\d+$/.test(form.days) || save.isPending} onClick={() => save.mutate()} data-qi-device-days-save
                    className="min-h-[44px] rounded-lg bg-gray-900 px-3 font-semibold text-white disabled:opacity-40">
                    <T k="저장" />
                  </button>
                </div>
              )}
            </>
          )}
    </div>
  );
}

interface ReportRow { id: string; period: string; title: string; status: string; createdAt: string; submittedAt: string | null; agendaId: string | null; sha256: string | null }

function Reports() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const isAdmin = useHasRole();
  const [period, setPeriod] = useState(lastClosedPeriod());
  const [note, setNote] = useState('');
  const q = useQuery({
    queryKey: ['qi-reports'],
    queryFn: () => apiClient.get<{ data: ReportRow[] }>('/api/v1/quality-flow/reports').then((r) => r.data ?? []),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!isAdmin) throw new Error(tAttr('보고서는 관리자가 만듭니다.'));
      return apiClient.post('/api/v1/quality-flow/reports', { period });
    },
    onSuccess: () => { toast.success(tAttr('보고서를 만들었습니다 — 본문과 읽은 측정 행이 보존됩니다.')); qc.invalidateQueries({ queryKey: ['qi-reports'] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('보고서를 만들지 못했습니다.')),
  });
  const submit = useMutation({
    mutationFn: (id: string) => {
      if (!isAdmin) throw new Error(tAttr('위원회 제출은 관리자가 합니다.'));
      return apiClient.post(`/api/v1/quality-flow/reports/${id}/submit`, note.trim() ? { note: note.trim() } : {});
    },
    onSuccess: () => { toast.success(tAttr('질향상위원회(QPS) 안건으로 올렸습니다.')); setNote(''); qc.invalidateQueries({ queryKey: ['qi-reports'] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('안건으로 올리지 못했습니다.')),
  });
  return (
    <div className="space-y-2 text-xs" data-qi-reports>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('보고 기간')} />
          <button type="button" onClick={() => create.mutate()} disabled={create.isPending} data-qi-report-create className="min-h-[44px] rounded-lg bg-gray-900 px-3 font-semibold text-white disabled:opacity-40">
            <T k="보고서 만들기" />
          </button>
          <input value={note} onChange={(e) => setNote(e.target.value)} aria-label={tAttr('제안 사유')} placeholder={tAttr('위원회 제출 시 제안 사유(선택)')} className="min-w-[14rem] flex-1 rounded-lg border border-gray-200 px-2 py-1" />
        </div>
      )}
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !q.data ? <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          : q.data.length === 0 ? <p className="text-gray-400"><T k="만든 보고서가 없습니다." /></p>
            : (
              <ul className="space-y-1">
                {q.data.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5" data-qi-report={r.id} data-status={r.status}>
                    <b>{r.period}</b>
                    <span className="text-gray-500"><KDate value={r.createdAt} mode="datetimeShort" /></span>
                    <span className={`rounded px-1.5 text-[10px] ${r.status === 'SUBMITTED' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                      <T k={r.status === 'SUBMITTED' ? '위원회 제출됨' : '초안'} />
                    </span>
                    {r.sha256 && <span className="font-mono text-[10px] text-gray-400">sha256 {r.sha256.slice(0, 12)}…</span>}
                    <Link href={`/print/qi-report/${r.id}`} className="text-blue-700 underline" target="_blank"><T k="인쇄" /></Link>
                    {isAdmin && r.status !== 'SUBMITTED' && (
                      <button type="button" onClick={() => submit.mutate(r.id)} disabled={submit.isPending} data-qi-report-submit={r.id}
                        className="ml-auto min-h-[36px] rounded-lg bg-indigo-600 px-3 font-semibold text-white disabled:opacity-40">
                        <T k="위원회에 올리기" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
    </div>
  );
}

export default function QiFlowOps() {
  const [tab, setTab] = useState<'settings' | 'close' | 'pd' | 'device' | 'reports' | 'accreditation' | null>(null);
  const tabs: Array<[NonNullable<typeof tab>, string]> = [
    ['settings', '사람 결정 현황'], ['close', '월 마감'], ['pd', '재원일수'], ['device', '기구일수'], ['reports', '보고서'], ['accreditation', '인증 자체 평가'],
  ];
  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-qi-flow-ops>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="mr-2 text-xs font-bold text-gray-700"><T k="질관리 흐름" /></p>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(tab === k ? null : k)} data-qi-ops-tab={k}
            className={`rounded-lg px-2.5 py-1 text-[11px] ${tab === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={label} />
          </button>
        ))}
      </div>
      {tab && (
        <div className="mt-3">
          {tab === 'settings' && <SettingsStrip />}
          {tab === 'close' && <MonthClose />}
          {tab === 'pd' && <PatientDays />}
          {tab === 'device' && <DeviceDays />}
          {tab === 'reports' && <Reports />}
          {tab === 'accreditation' && <AccreditationSection />}
        </div>
      )}
    </section>
  );
}
