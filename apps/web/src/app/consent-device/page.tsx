'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ConsentSignView } from '@/components/signature/ConsentSignView';

const API = process.env.NEXT_PUBLIC_API_URL || '';
const UID_KEY = 'consent-device-uid';

interface DeviceState {
  registered: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  status?: 'IDLE' | 'DISPATCHED' | 'SIGNING';
  name?: string;
  currentToken?: string | null;
  active?: boolean;
}

const SECRET_KEY = 'consent-device-secret';

export default function ConsentDevicePage() {
  const [uid, setUid] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [fs, setFs] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // 전체화면 상태 동기화
  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 부트스트랩: deviceUid 확보 + URL의 ?code= 프리필
  useEffect(() => {
    let u = localStorage.getItem(UID_KEY);
    if (!u) { u = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`); localStorage.setItem(UID_KEY, u); }
    setUid(u);
    setSecret(localStorage.getItem(SECRET_KEY));
    const params = new URLSearchParams(window.location.search);
    const c = params.get('code');
    if (c) setCode(c);
  }, []);

  const refetch = useCallback(async (u: string) => {
    try {
      const s = localStorage.getItem(SECRET_KEY);
      const r = await fetch(`${API}/api/v1/consent-device/${u}${s ? `?secret=${encodeURIComponent(s)}` : ''}`);
      const body = await r.json().catch(() => ({}));
      setState((body?.data ?? body) as DeviceState);
    } catch { /* 네트워크 — 폴링이 재시도 */ }
  }, []);

  // 상태 폴링(백업) + 하트비트
  useEffect(() => {
    if (!uid) return;
    refetch(uid);
    const poll = setInterval(() => refetch(uid), 10_000);
    const hb = setInterval(() => { fetch(`${API}/api/v1/consent-device/${uid}/heartbeat`, { method: 'POST' }).catch(() => {}); }, 30_000);
    return () => { clearInterval(poll); clearInterval(hb); };
  }, [uid, refetch]);

  // SSE 실시간 (공개 — EventSource, secret 인가)
  useEffect(() => {
    if (!uid || !state?.registered || !secret) return;
    const es = new EventSource(`${API}/api/v1/consent-device/${uid}/stream?secret=${encodeURIComponent(secret)}`);
    esRef.current = es;
    es.onmessage = () => { refetch(uid); };
    es.onerror = () => { /* 자동 재연결 */ };
    return () => { es.close(); esRef.current = null; };
  }, [uid, state?.registered, secret, refetch]);

  const enroll = async () => {
    if (!uid || !name.trim()) { alert('기기 이름을 입력해주세요'); return; }
    setEnrolling(true);
    try {
      const r = await fetch(`${API}/api/v1/consent-device/enroll`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // 이미 등록된 기기의 재요청은 **소지 증명**(현재 secret)이나 직원 발급 코드가 있어야 secret 을 받는다
        body: JSON.stringify({ deviceUid: uid, name: name.trim(), code: code.trim() || undefined, secret: localStorage.getItem(SECRET_KEY) || undefined }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error?.message || body?.message || '등록에 실패했습니다');
      const d = (body?.data ?? body) as { deviceSecret?: string };
      if (d?.deviceSecret) { localStorage.setItem(SECRET_KEY, d.deviceSecret); setSecret(d.deviceSecret); }
      await refetch(uid);
    } catch (e) { alert(e instanceof Error ? e.message : '등록 실패'); }
    setEnrolling(false);
  };

  const onSigned = async () => {
    if (uid) {
      await fetch(`${API}/api/v1/consent-device/${uid}/signed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: localStorage.getItem(SECRET_KEY) }) }).catch(() => {});
      await refetch(uid);
    }
  };

  const resetDevice = () => { localStorage.removeItem(UID_KEY); localStorage.removeItem(SECRET_KEY); window.location.reload(); };

  // ── 전체화면(키오스크) ──
  const enterFs = () => { document.documentElement.requestFullscreen?.().catch(() => {}); };
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); else enterFs(); };

  const body = (() => {
    if (!uid || !state) return <Center><div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" /></Center>;

    // 서명 중 (디스패치됨) → 서명 화면
    if (state.registered && state.approvalStatus === 'APPROVED' && state.status === 'DISPATCHED' && state.currentToken) {
      return <ConsentSignView token={state.currentToken} onSigned={onSigned} />;
    }

    // 거부/해제됨
    if (state.registered && (state.approvalStatus === 'REJECTED' || state.active === false)) {
      return <Center><div className="text-center"><p className="text-4xl mb-3">🚫</p><p className="text-lg font-bold text-gray-900">등록이 해제된 기기입니다</p><button onClick={resetDevice} className="mt-4 px-5 py-2.5 bg-blue-600 text-white text-sm rounded-xl">다시 등록</button></div></Center>;
    }

    // 승인 대기
    if (state.registered && state.approvalStatus === 'PENDING') {
      return <Center>
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg font-bold text-gray-900">승인 대기 중...</p>
          <p className="text-sm text-gray-500 mt-1.5">{state.name} · 관리자 승인을 기다리고 있습니다.</p>
          <button onClick={resetDevice} className="mt-5 text-xs text-gray-400 underline">등록 취소</button>
        </div>
      </Center>;
    }

    // 대기 중(승인됨·상주)
    if (state.registered && state.approvalStatus === 'APPROVED') {
      return <Center>
        <div className="text-center">
          <div className="text-5xl mb-4">🏥</div>
          <p className="text-sm text-gray-400">위루비병원</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{state.name}</p>
          <p className="text-base text-gray-500 mt-4">서명 대기 중입니다</p>
          <p className="text-xs text-gray-400 mt-1">직원이 동의서를 보내면 자동으로 표시됩니다</p>
          <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> 온라인</div>
        </div>
      </Center>;
    }

    // 미등록 → 등록 폼
    return <Center>
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg p-7">
        <div className="text-center mb-5"><div className="text-4xl mb-2">🏥</div><p className="text-xs text-gray-400">위루비병원</p><h1 className="text-lg font-bold text-gray-900 mt-0.5">서명 기기 등록</h1></div>
        <label className="block text-xs font-medium text-gray-500 mb-1">기기 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 외래1 태블릿" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mb-3" />
        <label className="block text-xs font-medium text-gray-500 mb-1">인증코드 <span className="text-gray-300">(QR 스캔 시 자동 입력)</span></label>
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="관리자 화면의 6자리 코드" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-center text-lg tracking-widest font-bold mb-1" />
        <p className="text-[11px] text-gray-400 mb-4">인증코드를 입력하면 즉시 등록됩니다. 코드가 없으면 관리자 승인 후 사용됩니다.</p>
        <button onClick={() => { enterFs(); enroll(); }} disabled={enrolling || !name.trim()} className="w-full py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40">{enrolling ? '등록 중...' : '등록하기'}</button>
      </div>
    </Center>;
  })();

  return (
    <div className="relative">
      {body}
      {/* 전체화면(키오스크) 토글 — 우상단 고정 */}
      <button onClick={toggleFs} title={fs ? '전체화면 해제' : '전체화면'}
        className={`fixed top-3 right-3 z-50 w-11 h-11 flex items-center justify-center rounded-full shadow-md border border-gray-200 bg-white/90 backdrop-blur text-gray-600 hover:bg-white ${fs ? 'opacity-40 hover:opacity-100' : ''}`}>
        {fs ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V5m0 4H5m10 0V5m0 4h4M9 15v4m0-4H5m10 0v4m0-4h4" /></svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
        )}
      </button>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6" style={{ fontFamily: "'Pretendard Variable', -apple-system, system-ui, sans-serif" }}>{children}</div>;
}
