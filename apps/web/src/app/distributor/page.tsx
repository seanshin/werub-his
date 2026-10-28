'use client';

// 딜러 별도 포털 — staff/portal과 완전 분리(독립 인증, typ=distributor 토큰).
// staff apiClient 미사용: 자체 fetch + 딜러 토큰.
import { useState, useCallback } from 'react';
import { Unit } from '@/components/ui/display';

interface Dealer { id: string; name: string; tier: string; currency: string }
interface Voucher { serial: string; form: string; faceValue: number; balance: number; status: string; expiresAt: string | null }
interface Inv { counts: Record<string, number>; vouchers: Voucher[] }
interface Sale { id: string; serial?: string; buyerName?: string | null; salePrice: number; commissionAmount: number; currency: string; soldAt: string }
interface Alloc { id: string; quantity: number; supplyPrice: number; paymentRef?: string | null; status: string; createdAt: string }
interface Settlement { id: string; periodStart: string; periodEnd: string; grossSales: number; commissionTotal: number; refundClawback: number; netPayable: number; currency: string; status: string }
interface Summary { stock: number; sold: number; grossSales: number; commission: number; unsettled: number }
interface Child { id: string; name: string; tier: string; currency: string }

type Tab = 'summary' | 'recv' | 'inv' | 'alloc' | 'settle' | 'sub' | 'account';
interface PendingV { serial: string; form: string; faceValue: number; status: string }

async function api(path: string, opts: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string>) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(path, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 🔴 상태코드를 잃지 않는다 — 401(세션 만료)과 그 밖의 실패는 사용자가 할 일이 다르다
    const e = new Error(json?.error?.message || json?.message || 'Request failed') as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return json.data;
}
const num = (n: number) => (n ?? 0).toLocaleString();
/** 🔴 401 은 다른 사실이다 — "데이터 없음"이 아니라 "세션이 끝났다"이고, 사용자가 할 일이 다르다 */
const HTTP_UNAUTHORIZED = 401;

// 테스트 계정은 소스 하드코딩 금지 — 빌드 시 NEXT_PUBLIC_DEALER_TEST_ACCOUNTS(JSON)로만 주입(운영 미설정=노출 없음)
type TestAccount = { kind: string; label: string; email: string; password: string; meta?: string };
const TEST_ACCOUNTS: TestAccount[] = (() => {
  try { const raw = process.env.NEXT_PUBLIC_DEALER_TEST_ACCOUNTS; const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; }
})();

export default function DistributorPortal() {
  const [token, setToken] = useState<string | null>(null);
  const [dealer, setDealer] = useState<Dealer | null>(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'setup'>('login');
  const [setupF, setSetupF] = useState({ email: '', code: '', password: '' });
  const [tab, setTab] = useState<Tab>('summary');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [inv, setInv] = useState<Inv | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [pending, setPending] = useState<PendingV[]>([]);
  const [recvCodes, setRecvCodes] = useState('');
  const [recvResult, setRecvResult] = useState<{ confirmed: number; failed: string[]; total: number } | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  // sell form
  const [sf, setSf] = useState({ serial: '', buyerName: '', buyerContact: '', salePrice: '' });
  // sub-alloc form
  const [subf, setSubf] = useState({ toDistributorId: '', quantity: '', supplyPrice: '', paymentRef: '' });
  // password form
  const [pf, setPf] = useState({ oldPassword: '', newPassword: '' });
  // MFA(TOTP)
  const [mfa, setMfa] = useState<{ token: string } | null>(null); // 로그인 2단계 대기
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSetupNeeded, setMfaSetupNeeded] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<{ enabled: boolean; enrolled: boolean } | null>(null);
  const [mfaEnroll, setMfaEnroll] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [mfaEnrollCode, setMfaEnrollCode] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  /** 이번 조회에서 실패한 항목 — 비어 있는 화면이 "없음"으로 읽히지 않게 그대로 말한다 */
  const [loadFailed, setLoadFailed] = useState<string[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);

  /**
   * 대시보드 재조회.
   *
   * 🔴 종전엔 여덟 개 조회가 전부 `.catch(() => null/[])` 였다 — **실패가 "없음"으로 번역**됐다.
   *    딜러 화면에는 재고·판매·정산·수령대기가 모두 0으로 보이고, 그것이 조회 실패인지
   *    진짜 0인지 알 방법이 없었다(세션이 끊겨도 화면은 그냥 텅 빈 채 로그인 상태로 남는다).
   *    실패는 지우지 않고 **무엇이 실패했는지 모아** 화면이 그대로 말하게 한다.
   */
  const refresh = useCallback(async (t: string) => {
    const failed: string[] = [];
    let expired = false;
    const load = async <T,>(label: string, path: string, empty: T): Promise<T> => {
      try {
        return (await api(path, { token: t })) as T;
      } catch (e) {
        if ((e as { status?: number }).status === HTTP_UNAUTHORIZED) expired = true;
        failed.push(label);
        return empty;
      }
    };
    setSummary(await load('요약', '/api/v1/distributor/summary', null));
    setInv(await load('재고', '/api/v1/distributor/inventory', null));
    setSales(await load('판매', '/api/v1/distributor/sales', []));
    setAllocs(await load('배분', '/api/v1/distributor/allocations', []));
    setSettlements(await load('정산', '/api/v1/distributor/settlements', []));
    setChildren(await load('하위 딜러', '/api/v1/distributor/children', []));
    setPending(await load('수령 대기', '/api/v1/distributor/vouchers/pending-receipt', []));
    setMfaStatus(await load('보안(MFA)', '/api/v1/distributor/account/mfa', null));
    setLoadFailed(failed);
    setSessionExpired(expired);
  }, []);

  const onLoggedIn = async (d: { token: string; distributor: Dealer; mfaSetupRequired?: boolean }) => {
    setToken(d.token); setDealer(d.distributor); setMfa(null); setMfaCode('');
    setMfaSetupNeeded(!!d.mfaSetupRequired);
    await refresh(d.token);
  };
  const login = async (e?: string, p?: string) => {
    setErr('');
    const em = e ?? email; const pw = p ?? password;
    if (e) setEmail(e); if (p) setPassword(p);
    try {
      const d = await api('/api/v1/distributor/auth/login', { method: 'POST', body: JSON.stringify({ email: em, password: pw }) });
      if (d.mfaRequired) { setMfa({ token: d.mfaToken }); setMfaCode(''); return; } // 2단계 TOTP 요구
      await onLoggedIn(d);
    } catch (err) { setErr((err as Error).message); }
  };
  const loginMfa = async () => {
    if (!mfa) return; setErr('');
    try {
      const d = await api('/api/v1/distributor/auth/login-mfa', { method: 'POST', body: JSON.stringify({ mfaToken: mfa.token, code: mfaCode.trim() }) });
      await onLoggedIn(d);
    } catch (err) { setErr((err as Error).message); }
  };
  /** 🔴 실패를 "MFA 미설정"으로 보이게 하지 않는다 — 조회 실패는 실패라고 말한다 */
  const loadMfaStatus = async () => {
    if (!token) return;
    try {
      setMfaStatus(await api('/api/v1/distributor/account/mfa', { token }));
      setLoadFailed((f) => f.filter((x) => x !== '보안(MFA)'));
    } catch (e) {
      if ((e as { status?: number }).status === HTTP_UNAUTHORIZED) setSessionExpired(true);
      setLoadFailed((f) => (f.includes('보안(MFA)') ? f : [...f, '보안(MFA)']));
    }
  };
  const mfaSetup = async () => {
    if (!token) return; setErr(''); setMsg('');
    try { const r = await api('/api/v1/distributor/account/mfa/setup', { method: 'POST', token }); setMfaEnroll({ qrDataUrl: r.qrDataUrl, secret: r.secret }); }
    catch (err) { setErr((err as Error).message); }
  };
  const mfaEnable = async () => {
    if (!token) return; setErr(''); setMsg('');
    try { await api('/api/v1/distributor/account/mfa/enable', { method: 'POST', token, body: JSON.stringify({ code: mfaEnrollCode.trim() }) });
      setMsg('MFA가 활성화되었습니다'); setMfaEnroll(null); setMfaEnrollCode(''); setMfaSetupNeeded(false); await loadMfaStatus(); }
    catch (err) { setErr((err as Error).message); }
  };
  const mfaDisable = async () => {
    if (!token) return; setErr(''); setMsg('');
    try { await api('/api/v1/distributor/account/mfa/disable', { method: 'POST', token, body: JSON.stringify({ code: mfaDisableCode.trim() }) });
      setMsg('MFA가 해제되었습니다'); setMfaDisableCode(''); await loadMfaStatus(); }
    catch (err) { setErr((err as Error).message); }
  };
  const sell = async () => {
    if (!token) return; setMsg(''); setErr('');
    try {
      const r = await api('/api/v1/distributor/sales', {
        method: 'POST', token,
        body: JSON.stringify({ serial: sf.serial.trim(), buyerType: 'PATIENT', buyerName: sf.buyerName || undefined, buyerContact: sf.buyerContact || undefined, salePrice: Number(sf.salePrice), idempotencyKey: `sell-${sf.serial}-${Date.now()}` }),
      });
      setMsg(`Sold ${sf.serial} · commission ${num(r.commissionAmount)} ${r.currency}`);
      setSf({ serial: '', buyerName: '', buyerContact: '', salePrice: '' }); await refresh(token);
    } catch (e) { setErr((e as Error).message); }
  };
  const confirmReceipt = async () => {
    if (!token) return; setMsg(''); setErr(''); setRecvResult(null);
    const codes = recvCodes.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
    if (!codes.length) { setErr('활성화코드를 입력하세요'); return; }
    try {
      const r = await api('/api/v1/distributor/vouchers/confirm-receipt', { method: 'POST', token, body: JSON.stringify({ activationCodes: codes }) });
      setRecvResult(r); setMsg(`수령확인 ${r.confirmed}/${r.total}건 — 판매 가능`); setRecvCodes(''); await refresh(token);
    } catch (e) { setErr((e as Error).message); }
  };
  const subAllocate = async () => {
    if (!token) return; setMsg(''); setErr('');
    try {
      const r = await api('/api/v1/distributor/sub-allocations', {
        method: 'POST', token,
        body: JSON.stringify({ toDistributorId: subf.toDistributorId, quantity: Number(subf.quantity), supplyPrice: Number(subf.supplyPrice), paymentRef: subf.paymentRef.trim() || undefined, idempotencyKey: `sub-${subf.toDistributorId}-${Date.now()}` }),
      });
      setMsg(`Sub-allocated ${r.quantity} vouchers`); setSubf({ toDistributorId: '', quantity: '', supplyPrice: '', paymentRef: '' }); await refresh(token);
    } catch (e) { setErr((e as Error).message); }
  };
  const changePw = async () => {
    if (!token) return; setMsg(''); setErr('');
    try {
      await api('/api/v1/distributor/account/password', { method: 'POST', token, body: JSON.stringify(pf) });
      setMsg('Password changed'); setPf({ oldPassword: '', newPassword: '' });
    } catch (e) { setErr((e as Error).message); }
  };
  // 초기설정 — 이메일로 받은 인증코드로 비밀번호 등록
  const doSetup = async () => {
    setMsg(''); setErr('');
    if (!setupF.email.trim() || !setupF.code.trim() || setupF.password.length < 8) { setErr('이메일·인증코드·비밀번호(8자+)를 입력하세요'); return; }
    try {
      await api('/api/v1/distributor/auth/setup', { method: 'POST', body: JSON.stringify({ email: setupF.email.trim(), code: setupF.code.trim(), password: setupF.password }) });
      setMsg('비밀번호가 등록되었습니다 — 로그인하세요'); setEmail(setupF.email.trim()); setAuthMode('login'); setSetupF({ email: '', code: '', password: '' });
    } catch (e) { setErr((e as Error).message); }
  };

  // ── 로그인 ──
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Distributor Portal</h1>
          <p className="text-xs text-gray-400 mb-5">WERUBYHOSP Health Checkup Voucher</p>
          {err && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600">{err}</div>}
          {msg && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-emerald-50 text-emerald-600">{msg}</div>}
          {mfa ? (
            <>
              <p className="text-[11px] text-gray-500 mb-2">인증 앱(Google Authenticator 등)의 <b>6자리 코드</b>를 입력하세요.</p>
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" onKeyDown={(e) => e.key === 'Enter' && loginMfa()} className="w-full mb-4 px-3 py-2.5 text-sm border border-gray-200 rounded-lg font-mono tracking-widest text-center" autoFocus />
              <button onClick={loginMfa} className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">인증</button>
              <button onClick={() => { setMfa(null); setMfaCode(''); setErr(''); }} className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-blue-600">← 로그인으로</button>
            </>
          ) : authMode === 'login' ? (
            <>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full mb-2 px-3 py-2.5 text-sm border border-gray-200 rounded-lg" />
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" onKeyDown={(e) => e.key === 'Enter' && login()} className="w-full mb-4 px-3 py-2.5 text-sm border border-gray-200 rounded-lg" />
              <button onClick={() => login()} className="w-full py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">Sign in</button>
              <button onClick={() => { setAuthMode('setup'); setErr(''); setMsg(''); }} className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-blue-600">초기 설정 / 비밀번호 등록 (이메일 인증코드)</button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 mb-2">관리자 등록 시 <b>이메일로 받은 인증코드</b>로 비밀번호를 등록하세요.</p>
              <input value={setupF.email} onChange={(e) => setSetupF({ ...setupF, email: e.target.value })} placeholder="딜러 이메일" className="w-full mb-2 px-3 py-2.5 text-sm border border-gray-200 rounded-lg" />
              <input value={setupF.code} onChange={(e) => setSetupF({ ...setupF, code: e.target.value })} placeholder="인증코드 (이메일)" className="w-full mb-2 px-3 py-2.5 text-sm border border-gray-200 rounded-lg font-mono" />
              <input value={setupF.password} onChange={(e) => setSetupF({ ...setupF, password: e.target.value })} type="password" placeholder="새 비밀번호 (8자+)" onKeyDown={(e) => e.key === 'Enter' && doSetup()} className="w-full mb-4 px-3 py-2.5 text-sm border border-gray-200 rounded-lg" />
              <button onClick={doSetup} className="w-full py-2.5 text-sm font-semibold text-white bg-violet-600 rounded-lg hover:bg-violet-700">비밀번호 등록</button>
              <button onClick={() => { setAuthMode('login'); setErr(''); }} className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-blue-600">← 로그인으로</button>
            </>
          )}
          {!mfa && TEST_ACCOUNTS.length > 0 && (
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Test accounts (dev)</p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {TEST_ACCOUNTS.map((a) => (
                <button key={a.email} onClick={() => login(a.email, a.password)} className="w-full text-left px-3 py-2 rounded-lg bg-gray-50 hover:bg-blue-50 border border-gray-100 transition">
                  <span className="flex items-center gap-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${a.kind === '국내' ? 'bg-violet-50 text-violet-600 border-violet-100' : 'bg-sky-50 text-sky-600 border-sky-100'}`}>{a.kind}</span>
                    <span className="text-xs font-medium text-gray-700">{a.label}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{a.meta}</span>
                  </span>
                  <span className="block text-[11px] text-gray-400 font-mono mt-0.5">{a.email}</span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    );
  }

  const TABS: [Tab, string][] = [['summary', 'Summary'], ['recv', `수령확인${pending.length ? ` (${pending.length})` : ''}`], ['inv', 'Inventory & Sell'], ['alloc', 'Purchases'], ['settle', 'Settlements'], ...(dealer?.tier === 'MASTER' ? [['sub', 'Sub-allocate'] as [Tab, string]] : []), ['account', 'Account']];
  const ST: Record<string, string> = { ALLOCATED: 'text-blue-600 bg-blue-50', SOLD: 'text-indigo-600 bg-indigo-50', ACTIVE: 'text-emerald-600 bg-emerald-50', REDEEMED: 'text-gray-400 bg-gray-50' };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div><h1 className="text-base font-bold text-gray-900">Distributor Portal</h1><p className="text-[11px] text-gray-400">{dealer?.name} · {dealer?.tier} · {dealer?.currency}</p></div>
        <button onClick={() => { setToken(null); setDealer(null); }} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5">Logout</button>
      </header>
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex flex-wrap gap-1 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
          {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3.5 py-2 text-sm rounded-lg ${tab === k ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}>{l}</button>)}
        </div>

        {/* 🔴 조회 실패 고지 — 실패를 "없음"으로 보이게 하지 않는다 */}
        {loadFailed.length > 0 && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
            {sessionExpired ? (
              <>
                <b>세션이 만료되었습니다.</b> 다시 로그인해야 최신 정보를 볼 수 있습니다 — 아래 숫자는 신뢰할 수 없습니다.
                <button onClick={() => { setToken(null); setDealer(null); }} className="ml-2 font-bold underline">다시 로그인</button>
              </>
            ) : (
              <>{loadFailed.join(' · ')} 정보를 불러오지 못했습니다. 아래가 비어 있어도 <b>&ldquo;없음&rdquo;이 아닙니다.</b>
                <button onClick={() => token && refresh(token)} className="ml-2 font-bold underline">다시 시도</button>
              </>
            )}
          </div>
        )}

        {mfaSetupNeeded && tab !== 'account' && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
            <span>🔐 보안 강화 — 2단계 인증(MFA)이 설정되지 않았습니다.</span>
            <button onClick={() => setTab('account')} className="font-bold underline">지금 설정</button>
          </div>
        )}
        {msg && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-emerald-50 text-emerald-600">{msg}</div>}
        {err && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600">{err}</div>}

        {/* Summary */}
        {tab === 'summary' && summary && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[['Stock', num(summary.stock)], ['Sold', num(summary.sold)], ['Gross', num(summary.grossSales)], ['Commission', num(summary.commission)], ['Unsettled', num(summary.unsettled)]].map(([l, v]) => (
              <div key={l} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4"><div className="text-[11px] text-gray-400">{l}</div><div className="text-xl font-bold text-gray-900">{v}</div></div>
            ))}
          </div>
        )}

        {/* 수령확인(채널분리) */}
        {tab === 'recv' && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <h2 className="text-sm font-bold text-gray-800 mb-1">수령확인 (활성화코드 입력)</h2>
              <p className="text-[12px] text-gray-500 mb-3">병원이 발송한 검진권은 <b>이메일로 받은 활성화코드</b>를 입력해 수령확인해야 <b>판매 가능</b>합니다. 코드를 줄바꿈/쉼표로 구분해 붙여넣으세요.</p>
              <textarea value={recvCodes} onChange={(e) => setRecvCodes(e.target.value)} rows={4} placeholder={'DZ8SGLZ99K\nABCDE12345\n...'} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono" />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={confirmReceipt} disabled={!recvCodes.trim()} className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">수령확인</button>
                {recvResult && <span className="text-xs text-gray-600">확인 {recvResult.confirmed}/{recvResult.total}{recvResult.failed.length ? ` · 실패 ${recvResult.failed.length}` : ''}</span>}
              </div>
              {recvResult?.failed?.length ? <div className="mt-2 text-[11px] text-red-500">매칭 실패(본인 보유·미확인 아님): {recvResult.failed.slice(0, 5).join(', ')}{recvResult.failed.length > 5 ? ' …' : ''}</div> : null}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3">수령확인 대기 ({pending.length}<Unit>건</Unit>)</h2>
              <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                {pending.map((v) => (
                  <div key={v.serial} className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 text-sm">
                    <span className="font-mono text-gray-700">{v.serial}</span>
                    <span className="text-gray-500">{v.form} · {num(v.faceValue)} · <span className="text-amber-600 text-[10px]">미확인</span></span>
                  </div>
                ))}
                {!pending.length && <p className="text-xs text-gray-400 py-4 text-center">대기 중인 검진권 없음 — 모두 수령확인됨</p>}
              </div>
            </div>
          </>
        )}

        {/* Inventory & Sell */}
        {tab === 'inv' && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3">Sell voucher</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <input value={sf.serial} onChange={(e) => setSf({ ...sf, serial: e.target.value })} placeholder="Serial" className="px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono" />
                <input value={sf.buyerName} onChange={(e) => setSf({ ...sf, buyerName: e.target.value })} placeholder="Buyer name" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                <input value={sf.buyerContact} onChange={(e) => setSf({ ...sf, buyerContact: e.target.value })} placeholder="Contact / email" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                <div className="flex gap-2">
                  <input value={sf.salePrice} onChange={(e) => setSf({ ...sf, salePrice: e.target.value })} type="number" placeholder="Price" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                  <button onClick={sell} disabled={!sf.serial || !sf.salePrice} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Sell</button>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-3"><h2 className="text-sm font-bold text-gray-800">Inventory</h2>{inv && Object.entries(inv.counts).map(([s, n]) => <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{s} {n}</span>)}</div>
              <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                {(inv?.vouchers ?? []).map((v) => (
                  <button key={v.serial} onClick={() => setSf({ ...sf, serial: v.serial })} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-blue-50 text-sm text-left">
                    <span className="font-mono text-gray-700">{v.serial}</span>
                    <span className="text-gray-500">{v.form} · {num(v.balance)} · <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${ST[v.status] ?? ''}`}>{v.status}</span></span>
                  </button>
                ))}
                {!inv?.vouchers?.length && <p className="text-xs text-gray-400 py-4 text-center">No vouchers</p>}
              </div>
            </div>
          </>
        )}

        {/* Purchases (allocations received) + Sales */}
        {tab === 'alloc' && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3">Purchases (allocations received)</h2>
              {allocs.map((a) => <div key={a.id} className="flex justify-between px-3 py-2 rounded-lg bg-gray-50 text-sm"><span className="text-gray-600">{new Date(a.createdAt).toLocaleDateString()} · qty {a.quantity} @ {num(a.supplyPrice)}</span><span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">{a.status}</span></div>)}
              {!allocs.length && <p className="text-xs text-gray-400 py-3 text-center">No purchases</p>}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3">Sales</h2>
              {sales.map((s) => <div key={s.id} className="flex justify-between px-3 py-2 rounded-lg bg-gray-50 text-sm"><span className="text-gray-600">{new Date(s.soldAt).toLocaleDateString()} · {s.buyerName || '—'}</span><span className="text-gray-700">{num(s.salePrice)} {s.currency} · comm {num(s.commissionAmount)}</span></div>)}
              {!sales.length && <p className="text-xs text-gray-400 py-3 text-center">No sales</p>}
            </div>
          </div>
        )}

        {/* Settlements */}
        {tab === 'settle' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3">Settlements</h2>
            {settlements.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 text-sm mb-1">
                <span className="text-gray-600">{s.periodStart?.slice(0, 10)}~{s.periodEnd?.slice(0, 10)}</span>
                <span className="text-gray-700">gross {num(s.grossSales)} − comm {num(s.commissionTotal)} − claw {num(s.refundClawback)} = <b>{num(s.netPayable)} {s.currency}</b></span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-600' : s.status === 'PAID' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>{s.status}</span>
              </div>
            ))}
            {!settlements.length && <p className="text-xs text-gray-400 py-3 text-center">No settlements</p>}
          </div>
        )}

        {/* Sub-allocate (MASTER) */}
        {tab === 'sub' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <h2 className="text-sm font-bold text-gray-800 mb-3">Sub-allocate to a sub-dealer (prepaid)</h2>
            {children.length === 0 ? <p className="text-xs text-gray-400">No active sub-dealers under your account.</p> : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <select value={subf.toDistributorId} onChange={(e) => setSubf({ ...subf, toDistributorId: e.target.value })} className="px-2 py-2 text-sm border border-gray-200 rounded-lg">
                  <option value="">Sub-dealer…</option>
                  {children.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
                </select>
                <input value={subf.quantity} onChange={(e) => setSubf({ ...subf, quantity: e.target.value })} type="number" placeholder="Qty" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                <input value={subf.supplyPrice} onChange={(e) => setSubf({ ...subf, supplyPrice: e.target.value })} type="number" placeholder="Supply price" className="px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                <button onClick={subAllocate} disabled={!subf.toDistributorId || !subf.quantity} className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50">Allocate</button>
              </div>
            )}
          </div>
        )}

        {/* Account */}
        {tab === 'account' && (
          <div className="space-y-4 max-w-md">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-bold text-gray-800 mb-3">Change password</h2>
              <input value={pf.oldPassword} onChange={(e) => setPf({ ...pf, oldPassword: e.target.value })} type="password" placeholder="Current password" className="w-full mb-2 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              <input value={pf.newPassword} onChange={(e) => setPf({ ...pf, newPassword: e.target.value })} type="password" placeholder="New password (8+)" className="w-full mb-3 px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              <button onClick={changePw} disabled={!pf.oldPassword || pf.newPassword.length < 8} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Update</button>
            </div>

            {/* MFA(TOTP) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800">2단계 인증(MFA)</h2>
                {mfaStatus && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${mfaStatus.enrolled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{mfaStatus.enrolled ? '활성' : '미설정'}</span>}
              </div>
              <p className="text-[11px] text-gray-500 mb-3">자금 포털 보안을 위해 인증 앱(Google Authenticator·Authy 등) 기반 TOTP 2단계 인증을 권장합니다.</p>

              {mfaStatus && !mfaStatus.enrolled && !mfaEnroll && (
                <button onClick={mfaSetup} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">MFA 설정 시작</button>
              )}

              {mfaEnroll && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">① 인증 앱으로 QR을 스캔하세요(또는 키 직접 입력).</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mfaEnroll.qrDataUrl} alt="MFA QR" className="w-40 h-40 border rounded-lg" />
                  <p className="text-[11px] text-gray-400 font-mono break-all">{mfaEnroll.secret}</p>
                  <p className="text-xs text-gray-600">② 앱에 표시된 6자리 코드를 입력해 활성화하세요.</p>
                  <div className="flex gap-2">
                    <input value={mfaEnrollCode} onChange={(e) => setMfaEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono tracking-widest text-center" />
                    <button onClick={mfaEnable} disabled={mfaEnrollCode.length !== 6} className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">활성화</button>
                  </div>
                  <button onClick={() => { setMfaEnroll(null); setMfaEnrollCode(''); }} className="text-xs text-gray-400 hover:text-gray-600">취소</button>
                </div>
              )}

              {mfaStatus?.enrolled && (
                <div className="flex gap-2 items-center">
                  <input value={mfaDisableCode} onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="현재 코드" className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono tracking-widest text-center" />
                  <button onClick={mfaDisable} disabled={mfaDisableCode.length !== 6} className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">해제</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
