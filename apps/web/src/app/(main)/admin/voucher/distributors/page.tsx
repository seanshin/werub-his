'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Dealer { id: string; managementNo?: string | null; name: string; tier: string; dealerType: string; country: string; currency: string; commissionRate: number; status: string; licenseNumber: string | null; contractRef?: string | null; taxId?: string | null; licenseExpiry?: string | null; bankInfo?: Record<string, unknown> | null; _count?: { sales: number } }
interface InvVoucher { serial: string; form: string; faceValue: number; balance: number; status: string; expiresAt: string | null }
interface AuditRow { id: string; action: string; changes?: Record<string, { old: unknown; new: unknown }>; timestamp: string; user?: { familyName?: string; givenName?: string; role?: string } }
const won = (n: number) => (n ?? 0).toLocaleString();

const ST: Record<string, string> = { PENDING: 'bg-amber-50 text-amber-600 border-amber-100', ACTIVE: 'bg-emerald-50 text-emerald-600 border-emerald-100', SUSPENDED: 'bg-gray-100 text-gray-500 border-gray-200', TERMINATED: 'bg-red-50 text-red-500 border-red-100' };
const TYPE_BADGE: Record<string, string> = { DOMESTIC: 'bg-violet-50 text-violet-600 border-violet-100', OVERSEAS: 'bg-sky-50 text-sky-600 border-sky-100' };
const TYPE_LABEL: Record<string, string> = { DOMESTIC: '국내', OVERSEAS: '해외' };

export default function VoucherDistributorsPage() {
  const tAttr = useTAttr();
  const router = useRouter();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [inv, setInv] = useState<{ counts: Record<string, number>; vouchers?: InvVoucher[] } | null>(null);
  const [detail, setDetail] = useState<(Dealer & { accounts?: { email: string; locale?: string; lastLoginAt?: string | null }[] }) | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [editF, setEditF] = useState<{ name: string; commissionRate: number; taxId: string; licenseNumber: string; contractRef: string; licenseExpiry: string; bankName: string; bankAccount: string; swift: string }>({ name: '', commissionRate: 0, taxId: '', licenseNumber: '', contractRef: '', licenseExpiry: '', bankName: '', bankAccount: '', swift: '' });
  const [typeFilter, setTypeFilter] = useState<'' | 'DOMESTIC' | 'OVERSEAS'>('');
  const [search, setSearch] = useState('');
  // 등록 폼
  const [f, setF] = useState({ name: '', tier: 'MASTER', dealerType: 'OVERSEAS', country: 'US', currency: 'USD', licenseNumber: '', contractRef: '', taxId: '', bankAccount: '', bankName: '', swift: '', licenseExpiry: '', commissionRate: 20, email: '', password: '' });
  // 배분 폼
  const [alloc, setAlloc] = useState({ quantity: 10, supplyPrice: 300000, paymentRef: '' });
  const isDomestic = f.dealerType === 'DOMESTIC';

  const load = () => apiClient.get<{ data: Dealer[] }>(`/api/v1/voucher/distributors${typeFilter ? `?type=${typeFilter}` : ''}`).then((r) => setDealers(r.data ?? [])).catch(() => toast.error('딜러 목록 실패'));
  useEffect(() => { load(); }, [typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadDetail = (id: string) => {
    apiClient.get<{ data: Dealer & { accounts?: { email: string; locale?: string; lastLoginAt?: string | null }[] } }>(`/api/v1/voucher/distributors/${id}`).then((r) => setDetail(r.data)).catch(() => setDetail(null));
    apiClient.get<{ data: { counts: Record<string, number>; vouchers?: InvVoucher[] } }>(`/api/v1/voucher/distributors/${id}/inventory`).then((r) => setInv(r.data)).catch(() => setInv(null));
    apiClient.get<{ data: AuditRow[] }>(`/api/v1/voucher/distributors/${id}/audit`).then((r) => setAudit(r.data ?? [])).catch(() => setAudit([]));
  };
  useEffect(() => { setEditing(false); if (sel) loadDetail(sel); else { setInv(null); setAudit([]); setDetail(null); } }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (d: Dealer) => {
    const bi = (d.bankInfo ?? {}) as { bank?: string; account?: string; swift?: string };
    setEditF({ name: d.name, commissionRate: d.commissionRate, taxId: d.taxId ?? '', licenseNumber: d.licenseNumber ?? '', contractRef: d.contractRef ?? '', licenseExpiry: d.licenseExpiry ? d.licenseExpiry.slice(0, 10) : '', bankName: bi.bank ?? '', bankAccount: bi.account ?? '', swift: bi.swift ?? '' });
    setEditing(true);
  };
  const saveEdit = async () => {
    if (!sel || !selDealer) return;
    try {
      const bankInfo = (editF.bankAccount || editF.bankName || editF.swift) ? { account: editF.bankAccount || undefined, bank: editF.bankName || undefined, swift: editF.swift || undefined } : undefined;
      const payload: Record<string, unknown> = { name: editF.name, commissionRate: editF.commissionRate, taxId: editF.taxId || undefined, licenseExpiry: editF.licenseExpiry || undefined, bankInfo };
      if (selDealer.dealerType === 'DOMESTIC') payload.licenseNumber = editF.licenseNumber || undefined;
      else payload.contractRef = editF.contractRef || undefined;
      await apiClient.patch(`/api/v1/voucher/distributors/${sel}`, payload);
      toast.success('딜러 정보 수정 — 감사 로그 기록'); setEditing(false); load(); loadDetail(sel);
    } catch (e) { toast.error((e as { message?: string })?.message ?? '수정 실패'); }
  };

  const register = async () => {
    if (!f.name || !f.email) { toast.error('딜러명·딜러 이메일 필수'); return; }
    if (isDomestic && !f.licenseNumber) { toast.error('국내 유치업자는 유치업 등록번호 필수'); return; }
    if (!isDomestic && !f.contractRef) { toast.error('해외 딜러는 제휴계약 참조 필수'); return; }
    try {
      const bankInfo = (f.bankAccount || f.bankName || f.swift) ? { account: f.bankAccount || undefined, bank: f.bankName || undefined, swift: f.swift || undefined } : undefined;
      // password 미지정 → 시스템이 랜덤 초기비번 + 인증코드 이메일 발송 → 딜러가 코드로 등록
      const common = { name: f.name, tier: f.tier, commissionRate: f.commissionRate, email: f.email, licenseExpiry: f.licenseExpiry || undefined, taxId: f.taxId || undefined, bankInfo };
      const payload = isDomestic
        ? { ...common, dealerType: 'DOMESTIC', licenseNumber: f.licenseNumber }
        : { ...common, dealerType: 'OVERSEAS', country: f.country, currency: f.currency, contractRef: f.contractRef };
      const r = await apiClient.post<{ data: { setup?: { emailedTo: string; channel: string; codeSent?: boolean } } }>('/api/v1/voucher/distributors', payload);
      const setup = r.data?.setup;
      // 🔴 배달 여부는 서버 판정(`codeSent`)을 쓴다 — 종전엔 화면이 'RESEND 아니면 시뮬'로 뭉개
      //    차단·실패까지 "발송했다"고 알렸다. 딜러는 인증코드를 못 받는데 등록은 성공으로 보였다.
      if (!setup) toast.success('딜러 등록(PENDING)');
      else if (setup.codeSent) toast.success('딜러 등록(PENDING) — 인증코드 메일 발송 → 딜러가 코드로 비밀번호 등록');
      else if (setup.channel === 'SIMULATION') toast.warning('딜러 등록(PENDING) — 인증코드는 모의 기록입니다(메일 미발송). 코드를 별도로 전달하세요');
      else toast.error(`딜러 등록(PENDING) — 인증코드 메일이 발송되지 않았습니다(${setup.channel}). 재발송이 필요합니다`);
      setF({ ...f, name: '', email: '', password: '', licenseNumber: '', contractRef: '', taxId: '', bankAccount: '', bankName: '', swift: '' }); load();
    } catch (e) { toast.error((e as { message?: string })?.message ?? '등록 실패'); }
  };
  const act = async (id: string, path: string, body?: unknown) => {
    try { await (body !== undefined ? apiClient.put(`/api/v1/voucher/distributors/${id}/${path}`, body) : apiClient.post(`/api/v1/voucher/distributors/${id}/${path}`, {})); toast.success('완료'); load(); if (sel) loadDetail(sel); }
    catch (e) { toast.error((e as { message?: string })?.message ?? '실패'); }
  };
  const doAllocate = async () => {
    if (!sel) return;
    try {
      const r = await apiClient.post<{ data: { quantity: number } }>('/api/v1/voucher/allocations', { toDistributorId: sel, quantity: alloc.quantity, supplyPrice: alloc.supplyPrice, paymentRef: alloc.paymentRef.trim() || undefined, idempotencyKey: `alloc-${sel}-${Date.now()}` });
      toast.success(`${r.data.quantity}건 배분(선결제)`); setSel(sel);
      apiClient.get<{ data: { counts: Record<string, number> } }>(`/api/v1/voucher/distributors/${sel}/inventory`).then((rr) => setInv(rr.data));
    } catch (e) { toast.error((e as { message?: string })?.message ?? '배분 실패(재고 부족 가능)'); }
  };

  const syncErp = async () => {
    try {
      const r = await apiClient.post<{ data: { enqueued: number } }>('/api/v1/voucher/distributors/sync-erp', {});
      toast.success(`ERP 거래처 동기화 ${r.data.enqueued}건 발행(미설정 시 생략)`);
    } catch (e) { toast.error((e as { message?: string })?.message ?? 'ERP 동기화 실패'); }
  };

  const selDealer = dealers.find((d) => d.id === sel);
  const shown = search.trim()
    ? dealers.filter((d) => `${d.managementNo ?? ''} ${d.name}`.toLowerCase().includes(search.trim().toLowerCase()))
    : dealers;

  return (
    <div className="w-full p-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="검진권 딜러 관리" /></h1>
          <p className="text-sm text-gray-500"><T k="국내 유치업자 / 해외 딜러 등록·심사·선결제 배분 (모두 외국인환자 한정 §27)" /></p>
        </div>
        <button onClick={syncErp} className="text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg px-3 py-2 hover:bg-indigo-50"><T k="ERP 거래처 동기화" /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 등록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3"><T k="딜러 등록" /></h2>
          <div className="space-y-2">
            {/* 유형 선택 */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg">
              {(['DOMESTIC', 'OVERSEAS'] as const).map((t) => (
                <button key={t} onClick={() => setF({ ...f, dealerType: t })} className={`py-1.5 text-xs font-medium rounded-md ${f.dealerType === t ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}>
                  <T k={t === 'DOMESTIC' ? '국내 유치업자' : '해외 딜러'} />
                </button>
              ))}
            </div>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={tAttr('딜러명')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            <div className="grid grid-cols-2 gap-2">
              <select value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} className="px-2 py-2 text-sm border border-gray-200 rounded-lg"><option value="MASTER">{tAttr('총판')}</option><option value="AGENT">{tAttr('대리점')}</option></select>
              <input type="number" value={f.commissionRate} onChange={(e) => setF({ ...f, commissionRate: Number(e.target.value) })} placeholder={tAttr('수수료%')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </div>
            {isDomestic ? (
              <>
                <div className="px-3 py-2 text-[11px] text-violet-600 bg-violet-50 rounded-lg"><T k="국내 유치업자 — 국가 KR · 통화 KRW 고정" /></div>
                <input value={f.licenseNumber} onChange={(e) => setF({ ...f, licenseNumber: e.target.value })} placeholder={tAttr('외국인환자 유치업 등록번호(L3) *')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase().slice(0, 2) })} placeholder={tAttr('국가(US)')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) })} placeholder={tAttr('통화(USD)')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                </div>
                <input value={f.contractRef} onChange={(e) => setF({ ...f, contractRef: e.target.value })} placeholder={tAttr('병원 제휴계약 참조 * (한국 유치업 등록 면제)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              </>
            )}
            <input type="date" value={f.licenseExpiry} onChange={(e) => setF({ ...f, licenseExpiry: e.target.value })} title={tAttr(isDomestic ? '유치업 등록 만료' : '제휴계약 만료')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500" />
            {/* 세무·송금(ERP AP 지급용) */}
            <input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} placeholder={tAttr(isDomestic ? '사업자번호 (원천징수·세금계산서)' : 'TIN (세무번호)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            <div className="grid grid-cols-2 gap-2">
              <input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} placeholder={tAttr(isDomestic ? '은행명' : 'Bank')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              <input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} placeholder={tAttr(isDomestic ? '계좌번호' : 'IBAN/Account')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </div>
            {!isDomestic && <input value={f.swift} onChange={(e) => setF({ ...f, swift: e.target.value })} placeholder={tAttr('SWIFT/BIC (해외 송금)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />}
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={tAttr('딜러 이메일 (포털 로그인·인증코드·활성화코드 수신)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            <p className="text-[11px] text-gray-500 -mt-1">비밀번호는 등록 시 <b>딜러 이메일로 발송되는 인증코드</b>로 딜러가 직접 설정합니다(관리자 미지정).</p>
            <button onClick={register} className="w-full py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><T k="등록" /></button>
          </div>
        </div>

        {/* 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-gray-800"><T k="딜러" /> ({shown.length}{search || typeFilter ? `/${dealers.length}` : ''})</h2>
            <div className="flex gap-1">
              {([['', '전체'], ['DOMESTIC', '국내'], ['OVERSEAS', '해외']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setTypeFilter(v)} className={`text-[10px] px-2 py-1 rounded-md border ${typeFilter === v ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-100 text-gray-400'}`}><T k={l} /></button>
              ))}
            </div>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAttr('관리번호 / 딜러명 검색 (WGD-…)')} className="w-full mb-3 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          <div className="space-y-1.5 max-h-[56vh] overflow-y-auto">
            {shown.map((d) => (
              <button key={d.id} onClick={() => setSel(d.id)} className={`w-full text-left px-3 py-2 rounded-xl border ${sel === d.id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[d.dealerType] ?? ''}`}><T k={TYPE_LABEL[d.dealerType] ?? d.dealerType} /></span>
                    {d.name}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${ST[d.status]}`}>{d.status}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5"><span className="font-mono text-gray-500">{d.managementNo ?? '—'}</span> · {d.tier} · {d.country}/{d.currency} · 수수료 {d.commissionRate}<Unit>%</Unit> · 판매 {d._count?.sales ?? 0}</div>
              </button>
            ))}
            {shown.length === 0 && <p className="text-xs text-gray-400 py-4 text-center"><T k={search ? '검색 결과 없음' : '등록된 딜러 없음'} /></p>}
          </div>
        </div>

        {/* 상세·배분 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          {!selDealer ? <div className="text-sm text-gray-400 text-center py-12"><T k="딜러를 선택하세요" /></div> : (
            <>
              <h2 className="text-sm font-bold text-gray-800 mb-1 flex items-center gap-1.5">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[selDealer.dealerType] ?? ''}`}><T k={TYPE_LABEL[selDealer.dealerType] ?? selDealer.dealerType} /></span>
                {selDealer.name}
              </h2>
              <p className="text-[11px] text-gray-400 mb-3">{selDealer.dealerType === 'DOMESTIC' ? `유치업 ${selDealer.licenseNumber ?? '—'}` : `제휴계약 ${selDealer.contractRef ?? '—'}`} · {selDealer.status}</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {selDealer.status === 'PENDING' && <button onClick={() => act(sel!, 'approve')} className="text-[11px] text-white bg-emerald-600 rounded-lg px-2.5 py-1"><T k={selDealer.dealerType === 'DOMESTIC' ? '승인(유치업)' : '승인(계약)'} /></button>}
                {selDealer.status === 'ACTIVE' && <button onClick={() => act(sel!, 'status', { status: 'SUSPENDED' })} className="text-[11px] text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1"><T k="정지" /></button>}
                {selDealer.status === 'SUSPENDED' && <button onClick={() => act(sel!, 'status', { status: 'ACTIVE' })} className="text-[11px] text-emerald-600 border border-emerald-200 rounded-lg px-2.5 py-1"><T k="재개" /></button>}
                {selDealer.status !== 'TERMINATED' && <button onClick={() => { if (confirm('해지 시 미판매 재고가 병원으로 회수됩니다.')) act(sel!, 'status', { status: 'TERMINATED' }); }} className="text-[11px] text-red-500 border border-red-100 rounded-lg px-2.5 py-1"><T k="해지(재고회수)" /></button>}
                <button onClick={() => (editing ? setEditing(false) : startEdit(selDealer))} className="text-[11px] text-blue-600 border border-blue-200 rounded-lg px-2.5 py-1"><T k={editing ? '수정 취소' : '정보 수정'} /></button>
                <button onClick={() => router.push(`/admin/voucher/list?ownerType=DISTRIBUTOR&dealer=${encodeURIComponent(selDealer.managementNo ?? selDealer.name)}`)} className="text-[11px] text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1"><T k="검진권 목록 →" /></button>
              </div>

              {/* 딜러 정보(읽기전용) — 수정 모드가 아니어도 전체 표시 */}
              {!editing && (() => {
                const D = detail ?? selDealer;
                const bi = (D.bankInfo ?? {}) as { bank?: string; account?: string; swift?: string };
                const acc = detail?.accounts?.[0];
                const rows: [string, string][] = [
                  ['관리번호', D.managementNo || '—'],
                  ['유형', `${tAttr(TYPE_LABEL[D.dealerType] ?? D.dealerType)} · ${D.tier}`],
                  ['상태', D.status],
                  ['수수료율', `${D.commissionRate}%`],
                  ['통화 · 국가', `${D.currency} · ${D.country}`],
                  ['사업자/세금번호', D.taxId || '—'],
                  [D.dealerType === 'DOMESTIC' ? '유치업 등록번호' : '제휴계약 참조', (D.dealerType === 'DOMESTIC' ? D.licenseNumber : D.contractRef) || '—'],
                  ['만료일', D.licenseExpiry ? D.licenseExpiry.slice(0, 10) : '—'],
                  ['은행', bi.bank || '—'],
                  [D.dealerType === 'DOMESTIC' ? '계좌번호' : 'IBAN/Account', bi.account || '—'],
                  ...(D.dealerType !== 'DOMESTIC' ? [['SWIFT/BIC', bi.swift || '—'] as [string, string]] : []),
                  ['딜러 이메일', acc?.email || '—'],
                  ['최근 로그인', acc?.lastLoginAt ? acc.lastLoginAt.slice(0, 16).replace('T', ' ') : tAttr('미접속')],
                  ['판매', `${selDealer._count?.sales ?? 0}건`],
                ];
                return (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-4 text-[12px]">
                    {rows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2 border-b border-gray-50 pb-1">
                        <span className="text-gray-400 shrink-0"><T k={k} /></span>
                        <span className="text-gray-700 text-right break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 정보 수정 폼 */}
              {editing && (
                <div className="border border-blue-100 bg-blue-50/40 rounded-xl p-3 mb-4 space-y-2">
                  <input value={editF.name} onChange={(e) => setEditF({ ...editF, name: e.target.value })} placeholder={tAttr('딜러명')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400"><T k="수수료율(%)" /></span><input type="number" value={editF.commissionRate} onChange={(e) => setEditF({ ...editF, commissionRate: Number(e.target.value) })} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" /></label>
                    <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400"><T k="사업자/세금번호" /></span><input value={editF.taxId} onChange={(e) => setEditF({ ...editF, taxId: e.target.value })} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" /></label>
                  </div>
                  {selDealer.dealerType === 'DOMESTIC'
                    ? <input value={editF.licenseNumber} onChange={(e) => setEditF({ ...editF, licenseNumber: e.target.value })} placeholder={tAttr('유치업 등록번호')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    : <input value={editF.contractRef} onChange={(e) => setEditF({ ...editF, contractRef: e.target.value })} placeholder={tAttr('제휴계약 참조')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />}
                  <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400"><T k={selDealer.dealerType === 'DOMESTIC' ? '유치업 등록' : '제휴계약'} /> <T k="만료일" /></span><input type="date" value={editF.licenseExpiry} onChange={(e) => setEditF({ ...editF, licenseExpiry: e.target.value })} className="px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600" /></label>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editF.bankName} onChange={(e) => setEditF({ ...editF, bankName: e.target.value })} placeholder={tAttr('Bank(은행)')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input value={editF.bankAccount} onChange={(e) => setEditF({ ...editF, bankAccount: e.target.value })} placeholder={tAttr(selDealer.dealerType === 'DOMESTIC' ? '계좌번호' : 'IBAN/Account')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  </div>
                  {selDealer.dealerType !== 'DOMESTIC' && <input value={editF.swift} onChange={(e) => setEditF({ ...editF, swift: e.target.value })} placeholder={tAttr('SWIFT/BIC (해외 송금)')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />}
                  <button onClick={saveEdit} className="w-full py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><T k="저장(감사 로그 기록)" /></button>
                </div>
              )}

              {inv && <div className="flex flex-wrap gap-1.5 mb-2">{Object.entries(inv.counts).map(([s, n]) => <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{s} {n}</span>)}{Object.keys(inv.counts).length === 0 && <span className="text-[11px] text-gray-400"><T k="재고 없음" /></span>}</div>}

              {/* 발급된 검진권 목록 */}
              {inv?.vouchers?.length ? (
                <div className="mb-4">
                  <h3 className="text-xs font-bold text-gray-600 mb-1.5"><T k="발급된 검진권" /> ({inv.vouchers.length})</h3>
                  <div className="max-h-56 overflow-auto rounded-lg border border-gray-100">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-gray-50 text-gray-400"><tr><th className="text-left px-2 py-1"><T k="시리얼" /></th><th className="text-right px-2 py-1"><T k="잔액" /></th><th className="text-left px-2 py-1"><T k="상태" /></th><th className="text-left px-2 py-1"><T k="만료" /></th></tr></thead>
                      <tbody>
                        {inv.vouchers.map((v) => (
                          <tr key={v.serial} className="border-t border-gray-50">
                            <td className="px-2 py-1 font-mono text-gray-600">{v.serial}</td>
                            <td className="px-2 py-1 text-right text-gray-600">{won(v.balance)}/{won(v.faceValue)}</td>
                            <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded-full text-[10px] ${ST[v.status] ?? 'bg-gray-100 text-gray-500'}`}>{v.status}</span></td>
                            <td className="px-2 py-1 text-gray-400">{v.expiresAt ? v.expiresAt.slice(0, 10) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {selDealer.status === 'ACTIVE' && (
                <div className="border-t pt-3">
                  <h3 className="text-xs font-bold text-gray-600 mb-2"><T k="선결제 배분(병원→딜러)" /></h3>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input type="number" value={alloc.quantity} onChange={(e) => setAlloc({ ...alloc, quantity: Number(e.target.value) })} placeholder={tAttr('수량')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                    <input type="number" value={alloc.supplyPrice} onChange={(e) => setAlloc({ ...alloc, supplyPrice: Number(e.target.value) })} placeholder={tAttr('공급단가')} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  </div>
                  <input value={alloc.paymentRef} onChange={(e) => setAlloc({ ...alloc, paymentRef: e.target.value })} placeholder={tAttr('결제 참조번호 — 입력 시 결제완료로 기록됩니다')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-2" />
                  <button onClick={doAllocate} className="w-full py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"><T k="배분(선결제 매입)" /></button>
                </div>
              )}

              {/* 수정/상태변경 감사 로그 */}
              <div className="border-t pt-3 mt-3">
                <h3 className="text-xs font-bold text-gray-600 mb-2"><T k="변경 이력" /> ({audit.length})</h3>
                <div className="space-y-1.5 max-h-56 overflow-auto">
                  {audit.map((a) => (
                    <div key={a.id} className="text-[11px] border border-gray-100 rounded-lg px-2.5 py-1.5">
                      <div className="flex items-center justify-between text-gray-400">
                        <span>{a.user ? `${a.user.familyName ?? ''}${a.user.givenName ?? ''}(${a.user.role ?? ''})` : tAttr('시스템')}</span>
                        <span>{a.timestamp?.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <div className="text-gray-600 mt-0.5">
                        {a.changes ? Object.entries(a.changes).map(([k, v]) => (
                          <span key={k} className="inline-block mr-2"><b>{k}</b>: <span className="text-gray-400 line-through">{String((v as { old: unknown }).old ?? '—')}</span> → <span className="text-gray-700">{String((v as { new: unknown }).new ?? '—')}</span></span>
                        )) : <span className="text-gray-400">{a.action}</span>}
                      </div>
                    </div>
                  ))}
                  {!audit.length && <p className="text-[11px] text-gray-400"><T k="변경 이력 없음" /></p>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
