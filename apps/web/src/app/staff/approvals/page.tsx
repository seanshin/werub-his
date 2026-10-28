'use client';

import { useCallback, useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { getStepUpAssertion } from '@/lib/passkey';
import { useAuthStore } from '@/stores/auth-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import HrApprovalSection from './HrApprovalSection';

const LOGIN_RETURN = '/staff/login?next=/staff/approvals';

// 스태프 생체포털 — Tier2 푸시 생체승인(단말 제로트러스트 ②).
// 의사가 본인 스마트폰의 스태프 웹에서 PC가 시작한 고위험 작업을 생체(passkey)로 승인/거부.
// HIS 데스크톱 앱이 아니라 스태프 포털(/staff/*)에 위치 — 폰 컨텍스트.
interface ApprovalContext { patient: string; mrn: string; note: string | null }
interface PendingApproval {
  id: string;
  action: string;
  resourceId: string | null;
  createdAt: string;
  expiresAt: string;
  context: ApprovalContext | null;
}

interface HistoryApproval {
  id: string;
  action: string;
  resourceId: string | null;
  status: 'PENDING' | 'APPROVED' | 'CONSUMED' | 'DENIED' | 'EXPIRED';
  method: string | null;
  createdAt: string;
  approvedAt: string | null;
  context: ApprovalContext | null;
}

// 아이콘은 키 밖에 둔다(키=한국어 원문) — 표시 문자열은 종전과 한 글자도 다르지 않다
const METHOD_LABEL: Record<string, { icon: string; l: string }> = { BIO: { icon: '🔐 ', l: '생체' }, PIN: { icon: '🔢 ', l: 'PIN' }, DENY: { icon: '', l: '거부' } };

const ACTION_LABEL: Record<string, string> = {
  ENCOUNTER_SIGN: '진료 기록 서명',
  PRESCRIPTION_CREATE: '처방 작성',
  PRESCRIPTION_SIGN: '처방 서명',
};

const STATUS_META: Record<HistoryApproval['status'], { t: string; c: string }> = {
  PENDING: { t: '대기', c: 'bg-amber-50 text-amber-700 border-amber-100' },
  APPROVED: { t: '승인됨', c: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  CONSUMED: { t: '승인·사용', c: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  DENIED: { t: '거부', c: 'bg-red-50 text-red-700 border-red-100' },
  EXPIRED: { t: '만료', c: 'bg-gray-100 text-gray-400 border-gray-200' },
};

export default function StaffApprovalsPage() {
  const router = useRouter();
  const { user, isAuthenticated, loadProfile, logout } = useAuthStore();
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [history, setHistory] = useState<HistoryApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authErr, setAuthErr] = useState(false);
  // 승인 방식 선택 — PIN 입력 모드(해당 요청 id) + 입력값
  const [pinMode, setPinMode] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  // PIN 보기 — 생체 재인증 후 당일 PIN 재발급·표시(평문 미보관 → 재발급 의미)
  const [pin, setPin] = useState<{ pin: string; expiresAt: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  // 승인 로그 — 기간 필터 + 더보기
  const [histPeriod, setHistPeriod] = useState('7'); // '1'|'7'|'30'|''(전체)
  const [histLimit, setHistLimit] = useState(20);
  const tAttr = useTAttr();

  const revealPin = useCallback(async () => {
    setPinErr(null);
    setPinBusy(true);
    try {
      const response = await getStepUpAssertion(); // 생체(passkey) 재인증
      const res = await apiClient.post<{ data: { pin: string; expiresAt: string } }>('/api/v1/terminal/daily-pin/reveal', { response });
      setPin(res.data);
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : tAttr('생체 인증에 실패했습니다. 패스키 등록 여부를 확인하세요.'));
    } finally {
      setPinBusy(false);
    }
  }, [tAttr]);

  const load = useCallback(async () => {
    try {
      const histParams: Record<string, string | number> = { limit: histLimit };
      if (histPeriod) { const d = new Date(); d.setDate(d.getDate() - (Number(histPeriod) - 1)); d.setHours(0, 0, 0, 0); histParams.from = d.toISOString(); }
      const [pend, hist] = await Promise.all([
        apiClient.get<{ data: PendingApproval[] }>('/api/v1/auth/step-up/push/pending'),
        apiClient.get<{ data: HistoryApproval[] }>('/api/v1/auth/step-up/push/history', histParams),
      ]);
      setItems(pend.data);
      setHistory(hist.data);
      setAuthErr(false);
    } catch (e) {
      // 인증 오류 = 이 기기가 직원으로 로그인돼 있지 않음 → 빈 목록이 아니라 명시적 안내
      const code = String((e as { code?: string })?.code ?? '').toLowerCase();
      if (code.includes('unauthor') || code.includes('forbidden')) setAuthErr(true);
      /* 그 외 일시 오류는 다음 주기 재시도 */
    }
  }, [histPeriod, histLimit]);

  useEffect(() => {
    // 미인증(예: FCM 푸시로 바로 진입) → 직원 로그인으로 보내고 로그인 후 이 화면으로 복귀
    if (!isAuthenticated) { router.replace(LOGIN_RETURN); return; }
    if (!user) { void loadProfile().catch(() => router.replace(LOGIN_RETURN)); }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, isAuthenticated, user, loadProfile, router]);

  const approve = useCallback(async (id: string) => {
    setError(null);
    setBusy(id);
    try {
      const response = await getStepUpAssertion(); // 생체(passkey) assertion → 서버가 검증(생체 바인딩)
      await apiClient.post(`/api/v1/auth/step-up/push/${id}/approve`, { response });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : tAttr('승인에 실패했습니다. 패스키(생체) 등록 여부를 확인하세요.'));
    } finally {
      setBusy(null);
    }
  }, [tAttr]);

  // 데일리 PIN 승인(생체 대안)
  const approvePin = useCallback(async (id: string, pin: string) => {
    setError(null);
    setBusy(id);
    try {
      await apiClient.post(`/api/v1/auth/step-up/push/${id}/approve-pin`, { pin });
      setItems((prev) => prev.filter((x) => x.id !== id));
      setPinMode(null);
      setPinValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tAttr('PIN 승인에 실패했습니다. 오늘의 데일리 PIN을 확인하세요.'));
    } finally {
      setBusy(null);
    }
  }, [tAttr]);

  const deny = useCallback(async (id: string) => {
    setBusy(id);
    try {
      await apiClient.post(`/api/v1/auth/step-up/push/${id}/deny`);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* noop */
    } finally {
      setBusy(null);
    }
  }, []);

  // 문장 한가운데 끼는 링크 — 보간 부품(<Tf>)에 노드로 넘긴다(어순은 번역문이 정한다)
  const loginLink = <Link href={LOGIN_RETURN} className="underline font-medium"><T k="직원 로그인" /></Link>;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-6 sm:py-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <main className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-8 flex-shrink-0" />
            <span className="text-sm font-bold text-gray-900 truncate"><T k="생체 승인" /></span>
          </div>
          <Link href="/staff" className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"><T k="내 포털" /></Link>
        </div>

        {user && <HrApprovalSection />}

        {/* 로그인 상태 표시 */}
        {user && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl bg-white border border-gray-100 shadow-sm px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> <T k="로그인됨" />
              </span>
              <span className="text-sm font-semibold text-gray-800 truncate">{user.familyName}{user.givenName}</span>
              <span className="text-[11px] text-gray-400 truncate">· {user.role}{user.department ? ` · ${user.department}` : ''}</span>
            </div>
            <button
              onClick={async () => { try { await logout(); } catch { /* 로컬 정리됨 */ } router.replace('/staff/login'); }}
              className="flex-shrink-0 text-xs text-gray-400 hover:text-red-500"
            >
              <T k="로그아웃" />
            </button>
          </div>
        )}

        {/* 인증 안내 — 이 기기가 직원으로 로그인돼 있지 않으면 승인 요청이 보이지 않음 */}
        {authErr && (
          <div className="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
            <p className="font-semibold mb-1"><T k="로그인이 필요합니다" /></p>
            <p className="leading-relaxed"><Tf k="승인 요청은 {계정}으로 로그인한 기기에서만 보입니다. {로그인} 후 자동으로 이 화면으로 돌아옵니다." params={{ 계정: <b><T k="해당 의사 본인 계정" /></b>, 로그인: loginLink }} /></p>
          </div>
        )}

        {/* 데일리 PIN 보기 — 생체 재인증 후 표시 */}
        <button
          onClick={revealPin}
          disabled={pinBusy}
          className="w-full mb-4 py-3 rounded-2xl border border-blue-200 bg-white text-blue-700 text-sm font-semibold shadow-sm hover:bg-blue-50 active:scale-[0.99] transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <span aria-hidden>🔢</span> {pinBusy ? <T k="인증 중…" /> : <T k="데일리 PIN 번호 보기" />}
        </button>
        {pinErr && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-700">{pinErr}</div>}

        <div className="bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 p-5 sm:p-6">
          <h1 className="text-base font-bold text-gray-900"><T k="승인 대기" /></h1>
          <p className="mt-1 mb-4 text-xs text-gray-500 leading-relaxed"><Tf k="PC에서 요청한 고위험 작업(처방·서명)을 {방식}으로 승인합니다. 3초마다 자동 갱신됩니다." params={{ 방식: <b><T k="생체인증 또는 데일리 PIN" /></b> }} /></p>

          {error && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-700">{error}</div>}

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-xs text-gray-400">
              <T k="대기 중인 승인 요청이 없습니다." />
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((a) => (
                <li key={a.id} className="rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="mb-3">
                    <div className="text-sm font-semibold text-gray-900"><T k={ACTION_LABEL[a.action] ?? a.action} /></div>
                    {a.context && (
                      <div className="mt-1 text-xs text-gray-700">
                        <span className="font-medium">{a.context.patient}</span>
                        <span className="text-gray-400"> · {a.context.mrn}</span>
                        {a.context.note && <span className="block text-[11px] text-gray-500 mt-0.5 truncate">“{a.context.note}”</span>}
                      </div>
                    )}
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {kdate(a.createdAt, 'timeSec')}
                      {!a.context && a.resourceId ? ` · ${a.resourceId.slice(0, 8)}` : ''}
                    </div>
                  </div>
                  {pinMode === a.id ? (
                    /* PIN 승인 입력 모드 */
                    <div>
                      <p className="text-[11px] text-gray-500 mb-1.5"><T k="오늘의 데일리 PIN 6자리를 입력하세요." /></p>
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoFocus
                        value={pinValue}
                        onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••••"
                        className="w-full mb-2 px-3 py-2.5 rounded-xl border border-gray-200 text-center font-mono text-lg tracking-[0.4em] focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => { setPinMode(null); setPinValue(''); }} disabled={busy === a.id}
                          className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          <T k="취소" />
                        </button>
                        <button onClick={() => approvePin(a.id, pinValue)} disabled={busy === a.id || pinValue.length !== 6}
                          className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50">
                          {busy === a.id ? <T k="처리 중…" /> : <T k="PIN 승인" />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => { setError(null); setPinMode(a.id); setPinValue(''); }} disabled={busy === a.id}
                          className="rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                          🔢 <T k="PIN 승인" />
                        </button>
                        <button onClick={() => approve(a.id)} disabled={busy === a.id}
                          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50">
                          {busy === a.id ? <T k="처리 중…" /> : <>🔐 <T k="생체 승인" /></>}
                        </button>
                      </div>
                      <button onClick={() => deny(a.id)} disabled={busy === a.id}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                        <T k="거부@행위" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 승인 로그(이력) — HIS에서 올라온 요청을 확인·감사 */}
        <div className="mt-4 bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-gray-900"><T k="승인 로그" /></h2>
            <div className="flex gap-1">
              {[['1', '오늘'], ['7', '7일'], ['30', '30일'], ['', '전체']].map(([k, label]) => (
                <button key={k} onClick={() => { setHistPeriod(k); setHistLimit(20); }}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium ${histPeriod === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}><T k={label} /></button>
              ))}
            </div>
          </div>
          <p className="mt-1 mb-3 text-[11px] text-gray-400"><T k="처방·차트 서명 승인 이력 — 위변조 방지(블록체인 앵커) 보존됩니다." /></p>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
              <T k="처리 이력이 없습니다." />
            </div>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h) => {
                const m = STATUS_META[h.status] ?? STATUS_META.PENDING;
                const when = h.approvedAt ?? h.createdAt;
                return (
                  <li key={h.id} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50/70 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-700 truncate">
                        <T k={ACTION_LABEL[h.action] ?? h.action} />
                        {h.context && <span className="text-gray-500 font-normal"> · {h.context.patient} ({h.context.mrn})</span>}
                      </div>
                      {h.context?.note && <div className="text-[10px] text-gray-400 truncate">“{h.context.note}”</div>}
                      <div className="text-[10px] text-gray-400">
                        {kdate(when, 'datetimeShort')}
                        {h.method && METHOD_LABEL[h.method] ? <> · {METHOD_LABEL[h.method].icon}<T k={METHOD_LABEL[h.method].l} /></> : ''}
                        {!h.context && h.resourceId ? ` · ${h.resourceId.slice(0, 8)}` : ''}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${m.c}`}><T k={m.t} /></span>
                  </li>
                );
              })}
            </ul>
          )}
          {history.length >= histLimit && histLimit < 100 && (
            <button onClick={() => setHistLimit((n) => Math.min(n + 20, 100))} className="w-full mt-2 py-2 rounded-lg bg-gray-50 text-gray-500 text-xs hover:bg-gray-100"><T k="더보기" /></button>
          )}
        </div>
      </main>

      {/* 데일리 PIN 표시 모달 — 생체 재인증 성공 시 */}
      {pin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setPin(null)}>
          <div className="w-full max-w-xs bg-white rounded-3xl shadow-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-[11px] font-medium text-blue-500 mb-1"><T k="오늘의 데일리 PIN" /></p>
            <p className="font-mono text-4xl font-bold tracking-[0.3em] text-blue-700 pl-[0.3em] my-2">{pin.pin}</p>
            <p className="text-[11px] text-gray-400 leading-relaxed"><T k="자정까지 유효 · 화면잠금/승인 시 입력" /><br /><Tf k="보기 시 {재발급}되어 이전 PIN은 무효화됩니다." params={{ 재발급: <b><T k="새 PIN으로 재발급" /></b> }} /></p>
            <button onClick={() => setPin(null)} className="mt-4 w-full py-2.5 rounded-xl bg-gray-800 text-white text-sm font-medium hover:bg-gray-900"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
