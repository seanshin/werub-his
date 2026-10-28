'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { IoBalancePanel, ioBalanceKey } from '@/components/nursing/IoBalancePanel';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { safeFormat as format } from '@/lib/safe-date';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface IoRecord {
  id: string;
  recordedAt: string;
  intakeType?: string | null;
  intakeAmount?: number | null;
  intakeDetail?: string | null;
  outputType?: string | null;
  outputAmount?: number | null;
  outputDetail?: string | null;
  nurse?: { familyName?: string | null; givenName?: string | null } | null;
  /** 원장 — IO(I/O 원장) · FLOWSHEET(플로시트 칸 · 종전 입력 경로) */
  ledger?: 'IO' | 'FLOWSHEET';
}

interface IoSummary {
  totalIntake: number;
  totalOutput: number;
  balance: number;
}

interface IoFormData {
  /** 측정 시각(ISO) — 고른 경우에만 · 비우면 서버가 저장 시각을 넣는다(화면이 그렇게 말한다) */
  recordedAt?: string;
  intakeType?: string;
  intakeAmount?: number;
  intakeDetail?: string;
  outputType?: string;
  outputAmount?: number;
  outputDetail?: string;
}

const INTAKE_TYPES = [{ value: 'ORAL', label: '경구' }, { value: 'IV', label: '정맥(IV)' }, { value: 'OTHER', label: '기타' }];
const OUTPUT_TYPES = [{ value: 'URINE', label: '소변' }, { value: 'DRAIN', label: '배액' }, { value: 'EMESIS', label: '구토' }, { value: 'OTHER', label: '기타' }];

const INTAKE_LABEL: Record<string, string> = { ORAL: '경구', IV: '정맥(IV)', OTHER: '기타' };
const OUTPUT_LABEL: Record<string, string> = { URINE: '소변', DRAIN: '배액', EMESIS: '구토', OTHER: '기타' };

export default function IntakeOutputPage({ params }: { params: Promise<{ admissionId: string }> }) {
  const { admissionId } = use(params);
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'intake' | 'output'>('intake');

  const { data: records, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['io-records', admissionId, dateFilter],
    queryFn: () => apiClient.get<{ data: IoRecord[] | { data: IoRecord[] } }>(`/api/v1/admissions/${admissionId}/intake-outputs`, { date: dateFilter }),
  });

  const { data: summaryData } = useQuery({
    queryKey: ['io-summary', admissionId, dateFilter],
    queryFn: () => apiClient.get<{ data: IoSummary | { data: IoSummary } }>(`/api/v1/admissions/${admissionId}/intake-outputs/summary`, { date: dateFilter }),
    enabled: !!dateFilter,
  });

  // 쓰기 폼은 미선택으로 시작(2026-10-10) — 유형을 고르지 않고 저장하면 '경구'·'소변'으로 기록됐다
  const [form, setForm] = useState({ intakeType: '', intakeAmount: '', intakeDetail: '', outputType: '', outputAmount: '', outputDetail: '', recordedAtLocal: '' });

  const createMutation = useMutation({
    mutationFn: (d: IoFormData) => apiClient.post(`/api/v1/admissions/${admissionId}/intake-outputs`, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['io-records', admissionId] });
      qc.invalidateQueries({ queryKey: ['io-summary', admissionId] });
      qc.invalidateQueries({ queryKey: ioBalanceKey(String(admissionId)) });
      setShowForm(false);
    },
  });

  const summary: IoSummary | undefined = summaryData?.data
    ? ((summaryData.data as { data: IoSummary })?.data ?? summaryData.data) as IoSummary
    : undefined;
  const _ioRaw = records?.data;
  const ioList: IoRecord[] = Array.isArray(_ioRaw) ? _ioRaw : (_ioRaw as { data: IoRecord[] })?.data ?? [];

  // Sort by time
  const sortedIoList = [...ioList].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const amountText = formMode === 'intake' ? form.intakeAmount : form.outputAmount;
  const amountValid = /^\d+$/.test(String(amountText ?? '').trim()) && !!(formMode === 'intake' ? form.intakeType : form.outputType);
  const handleSubmit = () => {
    if (!amountValid) return;
    const data: IoFormData = {};
    if (formMode === 'intake') {
      data.intakeType = form.intakeType;
      // 🔴 (2026-10-07) 빈 칸이 0 mL 로 저장됐다 — 측정 안 함과 실제 0 을 가를 수 없었다. 양이 없으면 저장 버튼이 막힌다
      data.intakeAmount = parseInt(form.intakeAmount, 10);
      data.intakeDetail = form.intakeDetail;
    } else {
      data.outputType = form.outputType;
      data.outputAmount = parseInt(form.outputAmount, 10);
      data.outputDetail = form.outputDetail;
    }
    if (form.recordedAtLocal) { const d = new Date(form.recordedAtLocal); if (!Number.isNaN(d.getTime())) data.recordedAt = d.toISOString(); }
    createMutation.mutate(data);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/inpatient" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        <T k="입원 목록" />
      </Link>
      <h1 className="text-2xl font-bold text-gray-900"><T k="I/O 기록" /></h1>

      {/* 근무조·24시간 수지와 배설 공백(2026-10-10 · 서버 계산) */}
      <IoBalancePanel admissionId={String(admissionId)} />

      {/* Summary Cards */}
      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              <p className="text-xs text-blue-500 font-medium"><T k="총 섭취량" /></p>
            </div>
            <p className="text-2xl font-bold text-blue-700">{summary.totalIntake.toLocaleString()}<span className="text-sm ml-1">mL</span></p>
          </div>
          <div className="bg-amber-50 rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              <p className="text-xs text-amber-500 font-medium"><T k="총 배출량" /></p>
            </div>
            <p className="text-2xl font-bold text-amber-700">{summary.totalOutput.toLocaleString()}<span className="text-sm ml-1">mL</span></p>
          </div>
          <div className={`rounded-xl p-4 text-center ${summary.balance >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <svg className={`w-4 h-4 ${summary.balance >= 0 ? 'text-blue-500' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
              <p className={`text-xs font-medium ${summary.balance >= 0 ? 'text-blue-500' : 'text-red-500'}`}>Balance</p>
            </div>
            <p className={`text-2xl font-bold ${summary.balance >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
              {summary.balance > 0 ? '+' : ''}{summary.balance.toLocaleString()}<span className="text-sm ml-1">mL</span>
            </p>
          </div>
        </div>
      ) : !isLoading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 font-medium mb-1"><T k="총 섭취량" /></p>
            <p className="text-2xl font-bold text-gray-300">0<span className="text-sm ml-1">mL</span></p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 font-medium mb-1"><T k="총 배출량" /></p>
            <p className="text-2xl font-bold text-gray-300">0<span className="text-sm ml-1">mL</span></p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400 font-medium mb-1">Balance</p>
            <p className="text-2xl font-bold text-gray-300">0<span className="text-sm ml-1">mL</span></p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setFormMode('intake'); setShowForm(true); }} className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><T k="+ 섭취" /></button>
          <button onClick={() => { setFormMode('output'); setShowForm(true); }} className="min-h-[44px] px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700"><T k="+ 배출" /></button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h3 className="text-lg font-semibold"><T k={formMode === 'intake' ? '섭취량 입력' : '배출량 입력'} /></h3>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="측정 시각" /></label>
              <input type="datetime-local" value={form.recordedAtLocal} onChange={e => setForm(f => ({ ...f, recordedAtLocal: e.target.value }))} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" data-io-measured-at />
              <p className="mt-0.5 text-[10px] text-gray-500"><T k="비우면 저장한 시각으로 기록됩니다" /></p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="유형" /></label>
              <select value={formMode === 'intake' ? form.intakeType : form.outputType} onChange={e => setForm(f => formMode === 'intake' ? { ...f, intakeType: e.target.value } : { ...f, outputType: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                {/* 🔴 저장값은 `value`(코드) — 화면 문자열만 카탈로그를 탄다(원문 불변) */}
                <option value="">{tAttr('— 선택 —')}</option>
                {(formMode === 'intake' ? INTAKE_TYPES : OUTPUT_TYPES).map(t => <option key={t.value} value={t.value}>{tAttr(t.label)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="양 (mL)" /></label>
              <input type="number" value={formMode === 'intake' ? form.intakeAmount : form.outputAmount} onChange={e => setForm(f => formMode === 'intake' ? { ...f, intakeAmount: e.target.value } : { ...f, outputAmount: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1"><T k="상세" /></label>
              <input value={formMode === 'intake' ? form.intakeDetail : form.outputDetail} onChange={e => setForm(f => formMode === 'intake' ? { ...f, intakeDetail: e.target.value } : { ...f, outputDetail: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={tAttr('NS 1L, 물 200ml...')} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} disabled={createMutation.isPending || !amountValid} data-io-save className="min-h-[44px] px-6 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"><T k="저장" /></button>
            <button onClick={() => setShowForm(false)} className="min-h-[44px] px-6 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* Records - Time-based Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간" /></th>
              <th className="px-4 py-3 text-center text-xs font-medium text-blue-600 bg-blue-50/50" colSpan={3}><T k="섭취 (Intake)" /></th>
              <th className="px-1 py-3 text-center text-xs font-medium text-gray-300">|</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-amber-600 bg-amber-50/50" colSpan={3}><T k="배출 (Output)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="기록자" /></th>
            </tr>
            <tr className="border-t border-gray-100">
              <th className="px-4 py-2 text-left text-[11px] font-medium text-gray-400"></th>
              <th className="px-4 py-2 text-left text-[11px] font-medium text-blue-400 bg-blue-50/50"><T k="유형" /></th>
              <th className="px-4 py-2 text-right text-[11px] font-medium text-blue-400 bg-blue-50/50"><T k="양(mL)" /></th>
              <th className="px-4 py-2 text-left text-[11px] font-medium text-blue-400 bg-blue-50/50"><T k="상세" /></th>
              <th className="px-1 py-2"></th>
              <th className="px-4 py-2 text-left text-[11px] font-medium text-amber-400 bg-amber-50/50"><T k="유형" /></th>
              <th className="px-4 py-2 text-right text-[11px] font-medium text-amber-400 bg-amber-50/50"><T k="양(mL)" /></th>
              <th className="px-4 py-2 text-left text-[11px] font-medium text-amber-400 bg-amber-50/50"><T k="상세" /></th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3"><div className="h-4 w-12 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3 bg-blue-50/20"><div className="h-4 w-16 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3 bg-blue-50/20"><div className="h-4 w-10 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3 bg-blue-50/20"><div className="h-4 w-20 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-1 py-3"></td>
                  <td className="px-4 py-3 bg-amber-50/20"><div className="h-4 w-16 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3 bg-amber-50/20"><div className="h-4 w-10 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3 bg-amber-50/20"><div className="h-4 w-20 bg-gray-100 rounded animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="h-4 w-12 bg-gray-100 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : sortedIoList.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                      <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                    </div>
                    <div>
                      <p className="text-gray-900 font-medium"><T k="I/O 기록이 없습니다" /></p>
                      <p className="text-sm text-gray-500 mt-0.5"><T k='상단의 "+ 섭취" 또는 "+ 배출" 버튼으로 기록을 시작하세요.' /></p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              sortedIoList.map((r: IoRecord) => {
                // 🔴 (2026-10-10) 한 행에 섭취·배설이 함께 있으면(운영 80건) 종전엔 섭취만 그리고 배설을 버렸다 — 칸마다 따로 판단
                const hasIn = r.intakeType != null || r.intakeAmount != null;
                const hasOut = r.outputType != null || r.outputAmount != null;
                return (
                  <tr key={r.id} className="hover:bg-gray-50" data-io-row={r.id} data-io-ledger={r.ledger ?? 'IO'}>
                    <td className="px-4 py-2.5 text-gray-700 font-medium">
                      {format(new Date(r.recordedAt), 'HH:mm')}
                      {r.ledger === 'FLOWSHEET' && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600" title={tAttr('플로시트 칸에 적힌 섭취·배설입니다(종전 입력 경로).')}><T k="플로시트" /></span>}
                    </td>
                    {/* Intake columns */}
                    <td className="px-4 py-2.5 bg-blue-50/20 text-gray-600">{hasIn ? <T k={INTAKE_LABEL[r.intakeType!] ?? r.intakeType ?? ''} /> : ''}</td>
                    <td className="px-4 py-2.5 bg-blue-50/20 text-right font-medium text-blue-700">{hasIn ? r.intakeAmount : ''}</td>
                    <td className="px-4 py-2.5 bg-blue-50/20 text-gray-500 text-xs">{hasIn ? (r.intakeDetail || '-') : ''}</td>
                    <td className="px-1 py-2.5 text-center text-gray-200">|</td>
                    {/* Output columns */}
                    <td className="px-4 py-2.5 bg-amber-50/20 text-gray-600">{hasOut ? <T k={OUTPUT_LABEL[r.outputType!] ?? r.outputType ?? ''} /> : ''}</td>
                    <td className="px-4 py-2.5 bg-amber-50/20 text-right font-medium text-amber-700">{hasOut ? r.outputAmount : ''}</td>
                    <td className="px-4 py-2.5 bg-amber-50/20 text-gray-500 text-xs">{hasOut ? (r.outputDetail || '-') : ''}</td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{r.nurse?.familyName}{r.nurse?.givenName}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {/* Footer totals */}
          {!isLoading && sortedIoList.length > 0 && summary && (
            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr className="font-semibold">
                <td className="px-4 py-3 text-gray-700 text-xs"><T k="합계" /></td>
                <td className="px-4 py-3 bg-blue-50/30"></td>
                <td className="px-4 py-3 bg-blue-50/30 text-right text-blue-700">{summary.totalIntake.toLocaleString()}</td>
                <td className="px-4 py-3 bg-blue-50/30 text-xs text-blue-500">mL</td>
                <td className="px-1 py-3 text-center text-gray-200">|</td>
                <td className="px-4 py-3 bg-amber-50/30"></td>
                <td className="px-4 py-3 bg-amber-50/30 text-right text-amber-700">{summary.totalOutput.toLocaleString()}</td>
                <td className="px-4 py-3 bg-amber-50/30 text-xs text-amber-500">mL</td>
                <td className={`px-4 py-3 text-xs ${summary.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                  Balance: {summary.balance > 0 ? '+' : ''}{summary.balance.toLocaleString()} mL
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
