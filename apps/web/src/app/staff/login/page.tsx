'use client';

import { useState, useEffect } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { loginWithPasskey, passkeySupported } from '@/lib/passkey';
import { isInAppBrowser } from '@/lib/browser';
import { TestAccountPanel } from '@/lib/dev-test-accounts';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

function destForRole(role: string, dept: string): string {
  const isCrm = role === 'CRM_MANAGER' || role === 'CRM_STAFF' || dept === 'CRM';
  const isCheckup = dept.startsWith('건강검진센터');
  const isWorkstation =
    dept.startsWith('검사실') || dept.startsWith('영상실') || dept.startsWith('기초검사') ||
    dept.startsWith('영상의학과(') || dept.startsWith('치료실');
  return isCrm ? '/crm' : isCheckup ? '/his-checkup' : isWorkstation ? '/workstation' : '/dashboard';
}

export default function StaffLoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);
  const [inApp, setInApp] = useState(false);
  // 생체/비밀번호 로그인 직후 당일 PIN 발급·표시 인터스티셜
  const [pinStage, setPinStage] = useState(false);
  const [dest, setDest] = useState('/dashboard');
  const [nextPath, setNextPath] = useState<string | null>(null); // return-to (예: /staff/approvals)
  const [timedOut, setTimedOut] = useState(false); // 유휴 타임아웃 로그아웃 안내
  const [dailyPin, setDailyPin] = useState<{ pin: string; expiresAt: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [attendance, setAttendance] = useState<{ type: string; method: string; at: string }[]>([]);
  // 🔴 문구만 로케일을 탄다 — 인증·리다이렉트 로직과 입력값(아이디·비밀번호)은 손대지 않는다
  const tAttr = useTAttr();

  const fillTest = (email: string, password: string) => {
    setIdentifier(email);
    setPassword(password);
    setShowPassword(true); // 테스트 계정은 패스키 미등록 → 비밀번호 폴백
  };

  useEffect(() => {
    setSupported(passkeySupported());
    setInApp(isInAppBrowser());
    // return-to: ?next=/staff/... (내부 경로만 허용 — 오픈 리다이렉트 방지)
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get('next');
    if (p && p.startsWith('/') && !p.startsWith('//')) setNextPath(p);
    if (sp.get('timeout') === '1') setTimedOut(true);
  }, []);

  // 로그인 성공 → 당일 PIN 발급 인터스티셜 표시(곧바로 대시보드로 가지 않음).
  const afterAuth = async () => {
    const dept = useAuthStore.getState().user?.department ?? '';
    const role = useAuthStore.getState().user?.role ?? '';
    setDest(nextPath ?? destForRole(role, dept));
    setPinStage(true);
    setPinBusy(true);
    setPinError('');
    try {
      const res = await apiClient.post<{ data: { pin: string; expiresAt: string } }>('/api/v1/terminal/daily-pin', {});
      setDailyPin(res.data);
    } catch {
      setPinError(tAttr('데일리 PIN 발급에 실패했습니다. 건너뛰고 계속할 수 있습니다.'));
    } finally {
      setPinBusy(false);
    }
    void loadAttendance(); // 출근(PIN 발급 시 자동 기록) 포함 근태 이력 로드
  };

  const loadAttendance = async () => {
    try {
      const res = await apiClient.get<{ data: { type: string; method: string; at: string }[] }>('/api/v1/ess/attendance');
      setAttendance(res.data ?? []);
    } catch { /* 근태 로드 실패 — 무시(인터스티셜은 계속) */ }
  };

  const doClockOut = async (early: boolean) => {
    if (typeof window !== 'undefined' && !window.confirm(early ? tAttr('조퇴로 퇴근 처리하시겠습니까?') : tAttr('퇴근 처리하시겠습니까?'))) return;
    setPinBusy(true);
    setPinError('');
    try {
      await apiClient.post('/api/v1/ess/attendance/clock', { type: 'CLOCK_OUT', method: 'BIO' });
      await loadAttendance();
    } catch {
      setPinError(tAttr('퇴근 처리에 실패했습니다.'));
    } finally {
      setPinBusy(false);
    }
  };

  const reissuePin = async () => {
    setPinBusy(true);
    setPinError('');
    try {
      const res = await apiClient.post<{ data: { pin: string; expiresAt: string } }>('/api/v1/terminal/daily-pin', {});
      setDailyPin(res.data);
    } catch {
      setPinError(tAttr('재발급에 실패했습니다.'));
    } finally {
      setPinBusy(false);
    }
  };

  const handlePasskey = async () => {
    setError('');
    setBusy(true);
    try {
      const { accessToken } = await loginWithPasskey(identifier || undefined);
      apiClient.setToken(accessToken);
      await useAuthStore.getState().loadProfile();
      await afterAuth();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'NO_CREDENTIAL') {
        setError(tAttr('이 기기에 등록된 패스키가 없습니다. 비밀번호로 로그인하거나 관리자에게 기기 등록을 요청하세요.'));
      } else if (code === 'SIGN_COUNT_REGRESS') {
        setError(tAttr('보안 점검이 필요한 기기입니다. 관리자에게 문의하세요.'));
      } else {
        setError(tAttr('패스키 인증에 실패했습니다. 비밀번호로 시도해보세요.'));
      }
      setShowPassword(true);
    } finally {
      setBusy(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(identifier, password);
      await afterAuth();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || tAttr('로그인에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  // 문장 한가운데 끼는 강조 — 보간 부품(<Tf>)에 노드로 넘긴다(어순은 번역문이 정한다)
  const safariOpen = <b>"<T k="Safari로 열기" />"</b>;
  const hisHost = <b>his.example.org</b>;

  // 로그인 직후 — 근태 상태 인지 허브 + 당일 PIN
  if (pinStage) {
    const u = useAuthStore.getState().user;
    const fmtT = (s: string) =>kdate(s, 'time');
    const sorted = attendance; // desc
    const latest = sorted[0];
    const working = latest?.type === 'CLOCK_IN'; // 가장 최근 기록이 출근 = 근무 중
    const openIn = working ? latest : undefined;
    const now = new Date();
    const todayStr = now.toDateString();
    const overnight = !!(working && openIn && new Date(openIn.at).toDateString() !== todayStr); // 자정 넘겨 근무
    const nightShift = !!(working && (now.getHours() >= 22 || now.getHours() < 6)); // 야간대
    const todayOut = sorted.find((a) => a.type === 'CLOCK_OUT' && new Date(a.at).toDateString() === todayStr);
    // 일자별 출퇴근(최근 3일)
    const byDay = new Map<string, { date: Date; in?: string; out?: string }>();
    for (const a of sorted) {
      const k = new Date(a.at).toDateString();
      const e = byDay.get(k) ?? { date: new Date(a.at) };
      if (a.type === 'CLOCK_IN') e.in = a.at; // desc 순회 → 마지막=가장 이른 출근
      else if (a.type === 'CLOCK_OUT' && !e.out) e.out = a.at; // 첫=가장 늦은 퇴근
      byDay.set(k, e);
    }
    const days = [...byDay.values()].sort((x, y) => y.date.getTime() - x.date.getTime()).slice(0, 3);
    const todayMid = new Date().setHours(0, 0, 0, 0);
    const dayLabel = (d: Date) => {
      const diff = Math.round((todayMid - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
      return diff === 0 ? tAttr('오늘') : diff === 1 ? tAttr('어제') : diff === 2 ? tAttr('그제') : `${d.getMonth() + 1}.${d.getDate()}`;
    };
    const badge = !working
      ? (todayOut ? { t: '퇴근 완료', c: 'bg-gray-100 text-gray-500' } : { t: '출근 전', c: 'bg-gray-100 text-gray-500' })
      : overnight ? { t: '연장·철야 근무 중', c: 'bg-amber-100 text-amber-700' }
      : nightShift ? { t: '야간 근무 중', c: 'bg-indigo-100 text-indigo-700' }
      : { t: '근무 중', c: 'bg-emerald-100 text-emerald-700' };

    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-8 sm:py-10 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <main className="w-full max-w-sm bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 p-6 sm:p-7">
          <div className="text-center mb-4">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-9 mx-auto mb-3" />
            <h1 className="text-lg font-bold text-gray-900"><T k={working ? '출근 완료' : '로그인 완료'} /></h1>
            <p className="text-xs text-gray-400 mt-1">{(u?.familyName ?? '') + (u?.givenName ?? '')}{u?.department ? ` · ${u.department}` : ''}</p>
            <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${badge.c}`}><T k={badge.t} /></span>
          </div>

          {/* 근태 현황 */}
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-center">
              <p className="text-[11px] text-emerald-600 mb-0.5"><T k="출근" />{overnight ? <> <T k="(전일)" /></> : ''}</p>
              <p className="text-base font-bold text-emerald-700">{openIn ? fmtT(openIn.at) : (days[0]?.in ? fmtT(days[0].in) : '—')}</p>
            </div>
            <div className="rounded-2xl bg-gray-50 border border-gray-100 p-3 text-center">
              <p className="text-[11px] text-gray-400 mb-0.5"><T k="퇴근" /></p>
              <p className="text-base font-bold text-gray-500">{working ? <T k="근무 중" /> : (todayOut ? fmtT(todayOut.at) : '—')}</p>
            </div>
          </div>

          {/* 데일리 PIN */}
          {pinBusy && !dailyPin ? (
            <div className="py-5 flex items-center justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" /></div>
          ) : dailyPin ? (
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-1 text-center">
              <p className="text-[11px] font-medium text-blue-500 mb-1"><T k="오늘의 데일리 PIN" /></p>
              <p className="font-mono text-3xl font-bold tracking-[0.3em] text-blue-700 pl-[0.3em]">{dailyPin.pin}</p>
              <p className="text-[11px] text-gray-400 mt-1.5"><Tf k="자정까지 유효 · 화면잠금/승인 시 입력 · {표시}" params={{ 표시: <b><T k="1회만 표시" /></b> }} /></p>
            </div>
          ) : (
            <p className="text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 mb-1 text-center">{pinError || <T k="PIN 발급 실패" />}</p>
          )}
          <button onClick={reissuePin} disabled={pinBusy} className="w-full text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-50 mb-4"><T k="PIN 재발급" /></button>

          {/* 일자별 근태(최근 3일) */}
          {days.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-medium text-gray-400 mb-1.5"><T k="최근 근태" /></p>
              <ul className="space-y-1">
                {days.map((d, i) => (
                  <li key={i} className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-gray-50">
                    <span className="font-medium text-gray-600">{dayLabel(d.date)}</span>
                    <span className="text-gray-400 tabular-nums"><Tf k="출근 {출근} · 퇴근 {퇴근}" params={{ 출근: d.in ? fmtT(d.in) : '—', 퇴근: d.out ? fmtT(d.out) : '—' }} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => router.push(dest)} className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-sm shadow-md shadow-blue-600/25 hover:opacity-95 active:scale-[0.99] transition">
            {nextPath === '/staff/approvals' ? <T k="승인 화면으로 이동" /> : nextPath === '/staff' ? <>🏠 <T k="내부포털" /></> : nextPath ? <T k="계속하기" /> : 'HIS Login'}
          </button>
          {/* 내부포털 — 모바일 셀프서비스(급여·근태·알림) 진입 */}
          {dest !== '/staff' && (
            <button onClick={() => router.push('/staff')} className="w-full mt-2 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1.5">
              <span aria-hidden>🏠</span> <T k="내부포털" />
            </button>
          )}
          {/* 승인 처리 화면 — 폰에서 HIS(PC) 고위험 작업 승인 요청을 확인·승인 */}
          <button onClick={() => router.push('/staff/approvals')} className="w-full mt-2 py-2.5 rounded-xl border border-blue-200 bg-blue-50/50 text-blue-700 text-sm font-medium hover:bg-blue-50 flex items-center justify-center gap-1.5">
            <span aria-hidden>🔐</span> <T k="승인 처리 화면" />
          </button>
          {/* 다음 흐름 — 근무 중일 때만 */}
          {working && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={() => doClockOut(false)} disabled={pinBusy} className="py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"><T k="퇴근" /></button>
              <button onClick={() => doClockOut(true)} disabled={pinBusy} className="py-2 rounded-xl border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-50 disabled:opacity-50"><T k="조퇴" /></button>
              <button onClick={() => router.push('/ess')} className="py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-medium hover:bg-gray-50"><T k="외출·휴가" /></button>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-8 sm:py-10 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <main className="w-full max-w-sm bg-white rounded-3xl shadow-xl shadow-blue-900/5 border border-gray-100 p-6 sm:p-7">
        <div className="text-center mb-6">
          <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-10 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-gray-900">위루비병원 내부포털</h1>
          <p className="text-sm text-gray-500 mt-1"><T k="생체인증으로 간편하게 로그인하세요" /></p>
        </div>

        {timedOut && (
          <div role="alert" className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            ⏱️ <Tf k="일정 시간 활동이 없어 {로그아웃}되었습니다. 보안을 위해 다시 로그인해 주세요." params={{ 로그아웃: <b><T k="자동 로그아웃" /></b> }} />
          </div>
        )}

        {inApp && (
          <div role="alert" className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            ⚠️ <Tf k="인앱 브라우저(텔레그램·카카오톡 등)에서는 {경고}." params={{ 경고: <b><T k="생체인증(패스키)이 동작하지 않습니다" /></b> }} /><br />
            <Tf k="우측 상단 {메뉴} → {열기} 또는 기본 브라우저(Safari·Chrome)에서 {주소} 로 접속하세요. (비밀번호 로그인은 가능)" params={{ 메뉴: <b>···</b>, 열기: safariOpen, 주소: hisHost }} />
          </div>
        )}

        <label htmlFor="identifier" className="block text-sm font-medium text-gray-700 mb-1">
          <T k="이메일 / 사번" />
        </label>
        <input
          id="identifier"
          type="text"
          autoComplete="username webauthn"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-sm mb-4"
          placeholder="name@hospital.example.org"
        />

        {supported && (
          <button
            onClick={handlePasskey}
            disabled={busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold text-sm shadow-md shadow-blue-600/25 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <span aria-hidden>🔐</span> {busy ? <T k="인증 중…" /> : <T k="지문·얼굴로 로그인" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="w-full mt-3 text-xs text-gray-500 hover:text-gray-700"
          aria-expanded={showPassword}
        >
          <T k="비밀번호로 로그인" /> ▾
        </button>

        {showPassword && (
          <form onSubmit={handlePassword} className="mt-3 space-y-3">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
              placeholder={tAttr('비밀번호')}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-gray-800 text-white font-medium text-sm hover:bg-gray-900 disabled:opacity-60"
            >
              <T k="비밀번호로 로그인" />
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="mt-5 text-center text-xs text-gray-400">
          <T k="패스키가 없나요?" /> <span className="text-gray-600"><T k="관리자에게 기기 등록을 요청하세요" /></span>
        </p>
      </main>

      {TestAccountPanel && <TestAccountPanel variant="chips" onPick={fillTest} />}
    </div>
  );
}
