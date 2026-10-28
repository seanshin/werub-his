'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

interface Batch { id: string; form: string; programId: string | null; faceValue: number; quantity: number; status: string; createdAt: string }
interface VoucherRow {
  serial: string; batchId: string; form: string; faceValue: number; balance: number; status: string;
  currentOwnerType: string; currentOwnerId: string | null; ownerName?: string | null; ownerManagementNo?: string | null; boundPatientId: string | null; expiresAt: string | null; createdAt: string;
}
interface ListResult { total: number; page: number; limit: number; pages: number; items: VoucherRow[] }

const STATUSES = ['ISSUED', 'ALLOCATED', 'SOLD', 'ACTIVE', 'REDEEMED', 'REFUNDED', 'REVOKED', 'EXPIRED'];
const VST: Record<string, string> = { ISSUED: 'bg-gray-100 text-gray-600', ALLOCATED: 'bg-blue-50 text-blue-600', SOLD: 'bg-indigo-50 text-indigo-600', ACTIVE: 'bg-emerald-50 text-emerald-600', REDEEMED: 'bg-teal-50 text-teal-600', REFUNDED: 'bg-red-50 text-red-500', REVOKED: 'bg-gray-100 text-gray-400', EXPIRED: 'bg-gray-100 text-gray-400' };
// 🔴 값 문자열이 곧 카탈로그 키다 — Record 를 지우거나 화면에서 재정의하지 않고 `<T k={값}>` 으로 넘긴다
const OWNER: Record<string, string> = { HOSPITAL: '병원', DISTRIBUTOR: '딜러', PATIENT: '환자' };
const won = (n: number) => (n ?? 0).toLocaleString();

export default function VoucherListPage() {
  const tAttr = useTAttr();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [status, setStatus] = useState('');
  const [batchId, setBatchId] = useState('');
  const [serial, setSerial] = useState('');
  const [ownerType, setOwnerType] = useState<'' | 'HOSPITAL' | 'DISTRIBUTOR'>('');
  const [dealer, setDealer] = useState('');
  const [issuedFrom, setIssuedFrom] = useState(''); const [issuedTo, setIssuedTo] = useState('');
  const [expiresFrom, setExpiresFrom] = useState(''); const [expiresTo, setExpiresTo] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);

  // 시리얼·딜러명은 ref로 보관 — 키스트로크마다 API 호출하지 않도록(검색은 버튼/Enter)
  const serialRef = useRef(''); const dealerRef = useRef('');
  useEffect(() => { serialRef.current = serial; }, [serial]);
  useEffect(() => { dealerRef.current = dealer; }, [dealer]);

  // URL 쿼리(ownerType/dealer/status)로 초기 필터 — 딜러 관리에서 '검진권 목록 보기' 진입
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const dl = sp.get('dealer') || ''; const st = sp.get('status') || ''; const ot = sp.get('ownerType') || '';
    if (dl) { dealerRef.current = dl; setDealer(dl); }
    if (st) setStatus(st);
    if (ot === 'HOSPITAL' || ot === 'DISTRIBUTOR') setOwnerType(ot);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiClient.get<{ data: Batch[] }>('/api/v1/voucher/batches').then((r) => setBatches(r.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback((p: number) => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (batchId) qs.set('batchId', batchId);
    if (ownerType) qs.set('ownerType', ownerType);
    if (issuedFrom) qs.set('issuedFrom', issuedFrom);
    if (issuedTo) qs.set('issuedTo', issuedTo);
    if (expiresFrom) qs.set('expiresFrom', expiresFrom);
    if (expiresTo) qs.set('expiresTo', expiresTo);
    const s = serialRef.current.trim();
    if (s) qs.set('serial', s);
    const dl = dealerRef.current.trim();
    if (dl) qs.set('dealer', dl);
    qs.set('page', String(p)); qs.set('limit', '50');
    apiClient.get<{ data: ListResult }>(`/api/v1/voucher/vouchers?${qs.toString()}`)
      .then((r) => { setRes(r.data); setPage(r.data.page); })
      .catch(() => toast.error(tAttr('검진권 목록 실패')))
      .finally(() => setLoading(false));
  }, [status, batchId, ownerType, issuedFrom, issuedTo, expiresFrom, expiresTo, tAttr]); // serial·dealer는 ref 경유 → 의존성 제외

  // 상태·배치 변경 시 자동 1페이지 조회. 시리얼 변경은 자동조회 안 함(버튼/Enter로).
  useEffect(() => { load(1); }, [load]);

  return (
    <div className="w-full p-4 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="검진권 목록" /></h1>
        <p className="text-sm text-gray-500"><T k="보유(병원/딜러)·상태·배치·시리얼·딜러명으로 개별 검진권 검색·추적" /></p>
      </div>

      {/* 필터 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        {/* 보유 탭: 전체 / 병원 / 딜러 */}
        <div className="flex gap-1 mb-3">
          {([['', '전체'], ['HOSPITAL', '병원'], ['DISTRIBUTOR', '딜러']] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setOwnerType(v); if (v !== 'DISTRIBUTOR') setDealer(''); }} className={`px-3 py-1.5 text-sm rounded-lg border ${ownerType === v ? 'bg-blue-50 border-blue-200 text-blue-600 font-medium' : 'border-gray-100 text-gray-500'}`}><T k={l} /></button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {ownerType === 'DISTRIBUTOR' && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-400"><T k="딜러명 / 관리번호" /></span>
              <input value={dealer} onChange={(e) => setDealer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(1); }} placeholder={tAttr('딜러명 또는 WGD-…')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg min-w-[200px]" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="상태" /></span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">
              <option value="">{tAttr('전체')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="배치" /></span>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg min-w-[220px]">
              <option value="">{tAttr('전체 배치')}</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.form} · {won(b.faceValue)}<Unit>원</Unit> · {b.quantity}매 · {b.createdAt.slice(0, 10)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="시리얼 검색" /></span>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(1); }} placeholder="WGC-…" className="px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono min-w-[200px]" />
          </label>
          <button onClick={() => load(1)} disabled={loading} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k={loading ? '검색 중…' : '검색'} /></button>
          {(status || batchId || serial || ownerType || dealer || issuedFrom || issuedTo || expiresFrom || expiresTo) && (
            <button onClick={() => { setStatus(''); setBatchId(''); setSerial(''); setOwnerType(''); setDealer(''); setIssuedFrom(''); setIssuedTo(''); setExpiresFrom(''); setExpiresTo(''); }} className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg"><T k="초기화" /></button>
          )}
        </div>
        {/* 발행일 · 만료일 범위 */}
        <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-gray-50">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="발행일" /></span>
            <div className="flex items-center gap-1">
              <input type="date" value={issuedFrom} onChange={(e) => setIssuedFrom(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600" />
              <span className="text-gray-300 text-xs">~</span>
              <input type="date" value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400"><T k="만료일" /></span>
            <div className="flex items-center gap-1">
              <input type="date" value={expiresFrom} onChange={(e) => setExpiresFrom(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600" />
              <span className="text-gray-300 text-xs">~</span>
              <input type="date" value={expiresTo} onChange={(e) => setExpiresTo(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600" />
            </div>
          </div>
        </div>
      </div>

      {/* 결과 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">{res ? `총 ${won(res.total)}건` : '—'}</span>
          {res && res.pages > 1 && (
            <span className="flex items-center gap-2 text-sm">
              <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} className="px-2 py-1 rounded-lg border border-gray-200 disabled:opacity-40"><T k="이전" /></button>
              <span className="text-gray-500">{page} / {res.pages}</span>
              <button onClick={() => load(page + 1)} disabled={page >= res.pages || loading} className="px-2 py-1 rounded-lg border border-gray-200 disabled:opacity-40"><T k="다음" /></button>
            </span>
          )}
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] text-gray-400">
              <tr>
                <th className="text-left px-4 py-2 font-medium"><T k="시리얼" /></th>
                <th className="text-left px-3 py-2 font-medium"><T k="유형" /></th>
                <th className="text-right px-3 py-2 font-medium"><T k="액면" /></th>
                <th className="text-right px-3 py-2 font-medium"><T k="잔액" /></th>
                <th className="text-left px-3 py-2 font-medium"><T k="상태" /></th>
                <th className="text-left px-3 py-2 font-medium"><T k="보유" /></th>
                <th className="text-left px-3 py-2 font-medium"><T k="만료" /></th>
                <th className="text-left px-3 py-2 font-medium"><T k="발행일" /></th>
              </tr>
            </thead>
            <tbody>
              {res?.items.map((v) => (
                <tr key={v.serial} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">{v.serial}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs"><T k={v.form === 'AMOUNT' ? '금액권' : '프로그램'} /></td>
                  <td className="px-3 py-2 text-right text-gray-600">{won(v.faceValue)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{won(v.balance)}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${VST[v.status] ?? 'bg-gray-100 text-gray-500'}`}>{v.status}</span></td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {v.currentOwnerType === 'DISTRIBUTOR'
                      ? <span><span className="text-[9px] px-1 py-0.5 rounded bg-sky-50 text-sky-600 border border-sky-100 mr-1"><T k="딜러" /></span>{v.ownerName ?? tAttr('딜러')}{v.ownerManagementNo ? <span className="text-gray-300 ml-1">{v.ownerManagementNo}</span> : null}</span>
                      : <span className="text-gray-500"><T k={OWNER[v.currentOwnerType] ?? v.currentOwnerType} /></span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{v.expiresAt ? v.expiresAt.slice(0, 10) : '-'}</td>
                  <td className="px-3 py-2 text-gray-400 text-xs">{v.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
              {res && res.items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400"><T k="조건에 맞는 검진권이 없습니다" /></td></tr>
              )}
              {!res && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400"><T k="불러오는 중…" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
