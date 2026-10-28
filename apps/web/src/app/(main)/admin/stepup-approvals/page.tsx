'use client';

import { useCallback, useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 고위험 작업(차트 서명·처방) 2차 인증 승인 오버사이트 — 감사·품질관리.
// 위변조 방지: 각 승인은 AuditLog(해시체인 + 시간당 blockchain 앵커)에도 기록됨.
interface Ctx { patient: string; mrn: string; note: string | null }
interface Row {
  id: string; userId: string; staff: string; department: string | null;
  action: string; status: string; method: string | null;
  resourceId: string | null; createdAt: string; approvedAt: string | null;
  context: Ctx | null;
}
interface Doctor { id: string; familyName: string; givenName: string; role: string; department?: string }

const ACTION_LABEL: Record<string, string> = {
  ENCOUNTER_SIGN: '진료 기록 서명', PRESCRIPTION_CREATE: '처방 작성', PRESCRIPTION_SIGN: '처방 서명',
};
const STATUS_META: Record<string, { t: string; c: string }> = {
  APPROVED: { t: '승인', c: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  CONSUMED: { t: '승인·사용', c: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  DENIED: { t: '거부', c: 'bg-red-50 text-red-700 border-red-100' },
  EXPIRED: { t: '만료', c: 'bg-gray-100 text-gray-400 border-gray-200' },
  PENDING: { t: '대기', c: 'bg-amber-50 text-amber-700 border-amber-100' },
};
const METHOD_LABEL: Record<string, string> = { BIO: '🔐 생체', PIN: '🔢 PIN', DENY: '거부' };
const PERIODS = [{ k: '1', label: '오늘' }, { k: '7', label: '7일' }, { k: '30', label: '30일' }, { k: '', label: '전체' }];
const PAGE = 50;

export default function StepUpApprovalsAuditPage() {
  const tAttr = useTAttr();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  // 필터
  const [period, setPeriod] = useState('30');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');

  useEffect(() => {
    apiClient.get<{ data: Doctor[] }>('/api/v1/users').then((r) => setDoctors((r.data ?? []).filter((d) => d.role === 'DOCTOR'))).catch(() => {});
  }, []);

  const fromIso = useCallback(() => {
    if (!period) return undefined;
    const d = new Date(); d.setDate(d.getDate() - (Number(period) - 1)); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [period]);

  const load = useCallback(async (off: number, append: boolean) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = { limit: PAGE, offset: off };
      const f = fromIso(); if (f) params.from = f;
      if (userId) params.userId = userId;
      if (status) params.status = status;
      if (method) params.method = method;
      const res = await apiClient.get<{ data: { total: number; rows: Row[] } }>('/api/v1/auth/step-up/push/admin/approvals', params);
      setTotal(res.data.total);
      setRows((prev) => append ? [...prev, ...res.data.rows] : res.data.rows);
      setOffset(off);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [fromIso, userId, status, method]);

  useEffect(() => { load(0, false); }, [load]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['시각', '의사', '부서', '작업', '환자', 'MRN', '방식', '상태'];
    const lines = rows.map((r) => [
      kdate(r.approvedAt ?? r.createdAt, 'datetimeSec'),
      r.staff, r.department ?? '', ACTION_LABEL[r.action] ?? r.action,
      r.context?.patient ?? '', r.context?.mrn ?? '',
      METHOD_LABEL[r.method ?? ''] ?? (r.method ?? ''), STATUS_META[r.status]?.t ?? r.status,
    ].map(esc).join(','));
    const csv = '﻿' + [head.map(esc).join(','), ...lines].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `stepup-approvals-${kstToday()}.csv`;
    a.click();
  };

  const fmt = (s: string) =>kdate(s, 'datetimeShort');

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900"><T k="승인 감사 (고위험 작업 2차 인증)" /></h2>
        <p className="text-sm text-gray-500 mt-1"><T k="차트 서명·처방의 스마트폰 생체/PIN 승인 내역입니다. 각 승인은 AuditLog 해시체인 + 블록체인 앵커로 위변조가 방지됩니다." /></p>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="기간" /></label>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button key={p.k} onClick={() => setPeriod(p.k)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${period === p.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={p.label} /></button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="의사" /></label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
            <option value="">{tAttr('전체')}</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.familyName}{d.givenName}{d.department ? ` · ${d.department}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="상태" /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
            <option value="">{tAttr('전체')}</option><option value="CONSUMED">{tAttr('승인·사용')}</option><option value="APPROVED">{tAttr('승인')}</option><option value="DENIED">{tAttr('거부')}</option><option value="EXPIRED">{tAttr('만료')}</option><option value="PENDING">{tAttr('대기')}</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="방식" /></label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
            <option value="">{tAttr('전체')}</option><option value="BIO">{tAttr('🔐 생체')}</option><option value="PIN">{tAttr('🔢 PIN')}</option><option value="DENY">{tAttr('거부')}</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">{total}<Unit>건</Unit></span>
          <button onClick={exportCsv} disabled={!rows.length} className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-white disabled:opacity-40">📥 CSV</button>
        </div>
      </div>

      {/* 표 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left font-medium px-4 py-2.5"><T k="시각" /></th>
                <th className="text-left font-medium px-4 py-2.5"><T k="의사" /></th>
                <th className="text-left font-medium px-4 py-2.5"><T k="작업" /></th>
                <th className="text-left font-medium px-4 py-2.5"><T k="환자" /></th>
                <th className="text-left font-medium px-4 py-2.5"><T k="방식" /></th>
                <th className="text-left font-medium px-4 py-2.5"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => {
                const m = STATUS_META[r.status] ?? STATUS_META.PENDING;
                return (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap tabular-nums">{fmt(r.approvedAt ?? r.createdAt)}</td>
                    <td className="px-4 py-2.5"><span className="font-medium text-gray-800">{r.staff}</span>{r.department && <span className="text-[11px] text-gray-400"> · {r.department}</span>}</td>
                    <td className="px-4 py-2.5 text-gray-700"><T k={ACTION_LABEL[r.action] ?? r.action} /></td>
                    <td className="px-4 py-2.5">{r.context ? <span className="text-gray-700">{r.context.patient} <span className="text-gray-400 text-xs">{r.context.mrn}</span></span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-gray-600">{METHOD_LABEL[r.method ?? ''] ? <T k={METHOD_LABEL[r.method ?? '']} /> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${m.c}`}><T k={m.t} /></span></td>
                  </tr>
                );
              })}
              {!rows.length && !loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm"><T k="내역이 없습니다." /></td></tr>}
            </tbody>
          </table>
        </div>
        {rows.length < total && (
          <div className="p-3 text-center border-t border-gray-50">
            <button onClick={() => load(offset + PAGE, true)} disabled={loading} className="text-xs px-4 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              {loading ? <T k="불러오는 중…" /> : <><T k="더보기" /> ({rows.length}/{total})</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
