'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { openPacsViewer } from '@/lib/pacs';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { canCallCode } from '@hospital-run/shared';
import { CodeCallModal } from '@/components/staff-call/CodeCallModal';

interface Tile {
  label: string;
  desc: string;
  icon: string;
  href?: string;
  onClick?: () => void;
  show: (role: string, dept: string) => boolean;
}
const isCrm = (r: string, d: string) => r === 'CRM_MANAGER' || r === 'CRM_STAFF' || d === 'CRM';
const isCheckup = (_r: string, d: string) => d.startsWith('건강검진센터');
const isWorkstation = (r: string, d: string) =>
  r === 'LAB_TECH' || d.startsWith('검사실') || d.startsWith('영상실') || d.startsWith('영상의학과(') || d.startsWith('치료실');

const isNurse = (r: string, d: string) => r === 'NURSE' || d.startsWith('간호') || d.includes('병동');

// 내부포털은 스마트폰·태블릿 진입 → 임상 타일은 모바일 전용 화면(/tablet·터치 최적화)으로 연결.
const TILES: Tile[] = [
  { label: '환자 차트(모바일)', desc: '환자 검색·차트 보기', icon: '👥', href: '/tablet', show: (r) => r !== 'CRM_STAFF' && r !== 'CRM_MANAGER' },
  { label: '간호 라운딩', desc: '병동 라운드·MAR·기록', icon: '💉', href: '/tablet/nursing', show: isNurse },
  { label: '배식·섭취', desc: '병동 배식·섭취 기록', icon: '🍚', href: '/tablet/nutrition', show: isNurse },
  { label: '수술 프로토콜', desc: '수술 전/중/후 체크', icon: '🗂', href: '/tablet/protocol', show: (r) => r === 'DOCTOR' || r === 'NURSE' },
  { label: 'PACS 뷰어', desc: '영상 판독', icon: '🩻', onClick: () => openPacsViewer(), show: (r, d) => r === 'DOCTOR' || isWorkstation(r, d) },
  { label: '급여 기초정보', desc: '급여명세·계좌·부양가족·서류', icon: '💳', href: '/staff/payroll', show: () => true },
  { label: '내 행정(ESS)', desc: '근태·휴가·증명서', icon: '🗂️', href: '/staff/ess', show: () => true },
  { label: '승인 대기', desc: '처방 등 생체 승인(Tier2)', icon: '✅', href: '/staff/approvals', show: (r) => r === 'DOCTOR' || r === 'ADMIN' },
  { label: '인수인계', desc: '받은 인계 확인(상번)', icon: '🔁', href: '/staff/handoffs', show: (r) => r === 'DOCTOR' || r === 'NURSE' || r === 'ADMIN' },
  { label: '팀 캘린더', desc: '부서 휴가·당직·위임(부서장)', icon: '📅', href: '/staff/team', show: () => true },
  { label: '진료 대시보드', desc: '오늘 진료·근무상태', icon: '🏥', href: '/staff/dashboard', show: () => true },
  { label: '워크스테이션', desc: '검사·영상 큐·결과', icon: '🔬', href: '/tablet/workstation', show: isWorkstation },
  // 데스크톱 전용 업무(모바일 미최적화) — 큰 화면 안내
  { label: '건강검진', desc: '검진 큐·도착·판정', icon: '🩺', href: '/tablet/checkup', show: isCheckup },
  { label: 'CRM', desc: 'PC 권장', icon: '📊', href: '/crm', show: isCrm },
  { label: '디바이스 등록', desc: '패스키 기기 관리', icon: '🔐', href: '/admin/staff-devices', show: (r) => r === 'ADMIN' },
];

interface PasskeyRow { id: string; deviceName?: string; status: string; lastUsedAt?: string }

export default function StaffLauncherPage() {
  const router = useRouter();
  const { user, isAuthenticated, loadProfile, logout } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [callOpen, setCallOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const tAttr = useTAttr();

  const loadPasskeys = useCallback(async () => {
    try {
      const r = await apiClient.get<{ data: PasskeyRow[] }>('/api/v1/auth/passkey');
      setPasskeys(r.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
      loadPasskeys();
    })();
  }, [isAuthenticated, user, loadProfile, router, loadPasskeys]);

  if (!ready || !user) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400"><T k="로딩 중…" /></div>;
  }
  const role = user.role ?? '';
  const dept = user.department ?? '';
  const canBroadcast = role === 'ADMIN' || role === 'DOCTOR';
  // 🔴 (2026-10-07) 코드 호출은 간호사도 — 서버 @Roles(ADMIN·DOCTOR·NURSE)와 같은 정본(shared CODE_CALL_ROLES)
  const canCode = canCallCode(role);

  const delPasskey = async (id: string) => {
    try { await apiClient.fetch(`/api/v1/auth/passkey/${id}`, { method: 'DELETE' }); loadPasskeys(); }
    catch (e: unknown) { setMsg((e as { message?: string })?.message || tAttr('삭제 실패')); }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f0f4f8]">
      {/* 헤더 */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-7" />
            <span className="font-bold text-gray-800"><T k="내부포털" /></span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-sm min-w-0">
            <span className="text-gray-600 truncate">
              {user.familyName}{user.givenName}
              <span className="hidden sm:inline">{' · '}{role}{dept ? ` · ${dept}` : ''}</span>
            </span>
            <button onClick={() => { logout(); router.replace('/staff/login'); }} className="text-gray-400 hover:text-gray-700 text-xs flex-shrink-0"><T k="로그아웃" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6 space-y-6">
        {/* 빠른 작업 */}
        <section className="flex flex-wrap gap-2">
          {/* 🔴 (2026-10-07) 코드 호출은 첫 버튼 — 종전엔 호출 창 안 'Code' 탭(의사·관리자만)이라 간호사는 호출할 길이 없었다 */}
          {canCode && (
            <button onClick={() => setCodeOpen(true)} data-staff-code-call className="min-h-[48px] px-5 py-2 rounded-xl bg-red-600 text-white text-sm font-bold shadow-sm">🚨 <T k="코드 호출" /></button>
          )}
          <button onClick={() => setCallOpen(true)} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium shadow-sm">📣 <T k="호출 보내기" /></button>
          <a href="/notifications" className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-700">🔔 <T k="알림" /></a>
        </section>

        {/* 시스템 타일 — 가로형 컴팩트 카드(줄 수 무관 균형) */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 mb-2"><T k="시스템" /></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {TILES.filter((t) => t.show(role, dept)).map((t) => {
              const inner = (
                <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 hover:shadow-md hover:border-blue-200 transition cursor-pointer h-full">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-xl">{t.icon}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800 text-sm truncate"><T k={t.label} /></div>
                    <div className="text-xs text-gray-400 truncate"><T k={t.desc} /></div>
                  </div>
                </div>
              );
              return t.href
                ? <a key={t.label} href={t.href} className="block">{inner}</a>
                : <button key={t.label} onClick={t.onClick} className="text-left block w-full">{inner}</button>;
            })}
          </div>
        </section>

        {/* 보안 — 패스키 (FR-12) — 등록은 관리자 입회(대면+이중확인) 필수, 셀프 등록 불가 */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-gray-800"><T k="내 보안 · 패스키" /></h2>
          </div>
          <p className="text-xs text-gray-400 mb-3"><Tf k="기기 등록·교체는 {입회}가 필요합니다. 변경이 필요하면 보안담당자에게 온보딩을 요청하세요." params={{ 입회: <b className="text-gray-500"><T k="관리자(보안담당) 입회" /></b> }} /></p>
          {msg && <p className="text-xs text-gray-500 mb-2">{msg}</p>}
          <ul className="divide-y divide-gray-100">
            {passkeys.map((p) => (
              <li key={p.id} className="py-2 flex items-center justify-between text-sm">
                <span>{p.deviceName || <T k="등록 기기" />} <span className={`ml-2 text-xs ${p.status === 'ACTIVE' ? 'text-emerald-600' : 'text-gray-400'}`}>{p.status}</span></span>
                <button onClick={() => delPasskey(p.id)} className="text-xs text-red-500 hover:underline"><T k="삭제" /></button>
              </li>
            ))}
            {passkeys.length === 0 && <li className="py-3 text-xs text-gray-400"><T k="등록된 패스키가 없습니다. 관리자에게 기기 등록(온보딩)을 요청하세요." /></li>}
          </ul>
        </section>
      </main>

      {callOpen && <CallModal onClose={() => setCallOpen(false)} canBroadcast={canBroadcast} />}
      {codeOpen && <CodeCallModal onClose={() => setCodeOpen(false)} />}
    </div>
  );
}

// ── 호출 보내기 모달 ──
function CallModal({ onClose, canBroadcast }: { onClose: () => void; canBroadcast: boolean }) {
  const [mode, setMode] = useState<'CALL' | 'BROADCAST' | 'CODE'>('CALL');
  const [targetKind, setTargetKind] = useState('ROLE');
  const [targetRef, setTargetRef] = useState('NURSE');
  const [message, setMessage] = useState('');
  const [codeType, setCodeType] = useState('CODE_BLUE');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();

  const send = async () => {
    setBusy(true); setDone('');
    try {
      if (mode === 'CALL') {
        const r = await apiClient.post<{ data: { delivered: number } }>('/api/v1/staff-calls', { targetKind, targetRef, message });
        setDone(tfAttr('전송됨 ({수}명)', { 수: r.data.delivered }));
      } else if (mode === 'BROADCAST') {
        const r = await apiClient.post<{ data: { delivered: number } }>('/api/v1/staff-calls/broadcast', { targetKind, targetRef: targetKind === 'ALL' ? undefined : targetRef, message, severity: 'URGENT' });
        setDone(tfAttr('긴급 전송됨 ({수}명)', { 수: r.data.delivered }));
      } else {
        const r = await apiClient.post<{ data: { delivered: number } }>('/api/v1/staff-calls/code', { targetKind: 'ALL', codeType, location });
        setDone('🚨 ' + tfAttr('Code 발신됨 ({수}명)', { 수: r.data.delivered }));
      }
    } catch (e: unknown) { setDone((e as { message?: string })?.message || tAttr('전송 실패')); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-3"><T k="호출 보내기" /></h3>
        <div className="flex gap-1 mb-4 text-xs">
          <button onClick={() => setMode('CALL')} className={`px-3 py-1.5 rounded-lg ${mode === 'CALL' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}><T k="호출@동작" /></button>
          {canBroadcast && <button onClick={() => setMode('BROADCAST')} className={`px-3 py-1.5 rounded-lg ${mode === 'BROADCAST' ? 'bg-amber-500 text-white' : 'bg-gray-100'}`}><T k="긴급" /></button>}
          {/* 코드 호출은 상단 '🚨 코드 호출' 하나로(두 길이면 갈라진다 · 2026-10-07) */}
        </div>

        {mode === 'CODE' ? (
          <div className="space-y-3">
            <select value={codeType} onChange={(e) => setCodeType(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-sm">
              <option value="CODE_BLUE">{tAttr('CODE BLUE (심정지)')}</option>
              <option value="CODE_RED">{tAttr('CODE RED (화재)')}</option>
              <option value="CODE_GRAY">{tAttr('CODE GRAY (폭력)')}</option>
            </select>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={tAttr('위치 (예: 본관 5층 503호)')} className="w-full px-3 py-2 rounded-lg border text-sm" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <select value={targetKind} onChange={(e) => setTargetKind(e.target.value)} className="px-3 py-2 rounded-lg border text-sm">
                <option value="ROLE">{tAttr('역할')}</option>
                <option value="DEPARTMENT">{tAttr('부서')}</option>
                {mode === 'BROADCAST' && <option value="ALL">{tAttr('전체')}</option>}
              </select>
              {targetKind !== 'ALL' && (
                targetKind === 'ROLE'
                  ? <select value={targetRef} onChange={(e) => setTargetRef(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border text-sm">
                      <option value="DOCTOR">{tAttr('의사')}</option><option value="NURSE">{tAttr('간호사')}</option>
                      <option value="PHARMACIST">{tAttr('약사')}</option><option value="LAB_TECH">{tAttr('검사@직군')}</option>
                    </select>
                  : <input value={targetRef} onChange={(e) => setTargetRef(e.target.value)} placeholder={tAttr('부서명')} className="flex-1 px-3 py-2 rounded-lg border text-sm" />
              )}
            </div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={tAttr('메시지 (환자 개인정보 입력 금지)')} rows={2} className="w-full px-3 py-2 rounded-lg border text-sm" />
          </div>
        )}

        {done && <p className="mt-3 text-sm text-blue-700">{done}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={send} disabled={busy} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-60">{busy ? <T k="전송 중…" /> : <T k="전송@버튼" />}</button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm"><T k="닫기" /></button>
        </div>
      </div>
    </div>
  );
}
