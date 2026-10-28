'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { QrImage } from '@/components/ui/QrImage';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface StaffUser { id: string; familyName: string; givenName: string; email: string; role: string; department?: string }
interface EnrollSession { sessionId: string; code: string; enrollMode: string; qrUrl: string; expiresAt: string; staffName: string }
interface DeviceRow {
  id: string; deviceName: string; status: string; enrollMode: string; userId: string;
  verifiedAt: string; lastUsedAt?: string; expiresAt?: string; reEnrollDueAt?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || '';
// 🔴 등록 링크(토큰 포함)를 외부 QR API 의 URL 쿼리로 보내던 것 봉합 — QrImage 로컬 생성.
const fmt = (s?: string) => (s ?kdate(s, 'datetime') : '-');

// 역할 → 카테고리 그룹
const GROUPS = [
  { key: 'ADMIN', label: '관리자', roles: ['ADMIN'], dot: 'bg-violet-500', ring: 'ring-violet-200', text: 'text-violet-700', soft: 'bg-violet-50' },
  { key: 'DOCTOR', label: '의사', roles: ['DOCTOR'], dot: 'bg-blue-500', ring: 'ring-blue-200', text: 'text-blue-700', soft: 'bg-blue-50' },
  { key: 'NURSE', label: '간호', roles: ['NURSE'], dot: 'bg-emerald-500', ring: 'ring-emerald-200', text: 'text-emerald-700', soft: 'bg-emerald-50' },
  { key: 'PHARM', label: '약무', roles: ['PHARMACIST'], dot: 'bg-amber-500', ring: 'ring-amber-200', text: 'text-amber-700', soft: 'bg-amber-50' },
  { key: 'LAB', label: '검사/영상', roles: ['LAB_TECH'], dot: 'bg-cyan-500', ring: 'ring-cyan-200', text: 'text-cyan-700', soft: 'bg-cyan-50' },
  { key: 'CRM', label: '행정/CRM', roles: ['CRM_MANAGER', 'CRM_STAFF'], dot: 'bg-rose-500', ring: 'ring-rose-200', text: 'text-rose-700', soft: 'bg-rose-50' },
  { key: 'ETC', label: '기타', roles: [], dot: 'bg-gray-400', ring: 'ring-gray-200', text: 'text-gray-600', soft: 'bg-gray-50' },
] as const;
const groupOf = (role: string) => GROUPS.find((g) => (g.roles as readonly string[]).includes(role)) ?? GROUPS[GROUPS.length - 1];

const DEV_STATUS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: '활성', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  REENROLL_DUE: { label: '재등록 필요', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  EXPIRED: { label: '만료', cls: 'bg-gray-100 text-gray-500 ring-1 ring-gray-200' },
  REVOKED: { label: '해제됨', cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
  REPLACED: { label: '교체됨', cls: 'bg-gray-100 text-gray-400 ring-1 ring-gray-200' },
};

export default function StaffDevicesAdminPage() {
  const tAttr = useTAttr();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [sel, setSel] = useState<StaffUser | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [session, setSession] = useState<EnrollSession | null>(null);
  const [status, setStatus] = useState('');
  const [remain, setRemain] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const loadDevices = useCallback(async () => {
    try { const res = await apiClient.get<{ data: DeviceRow[] }>('/api/v1/admin/credential/devices'); setDevices(res.data); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => {
    apiClient.get<{ data: StaffUser[] }>('/api/v1/users').then((r) => setUsers(r.data)).catch(() => {});
    loadDevices();
    return () => abortRef.current?.abort();
  }, [loadDevices]);

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setRemain(s); if (s === 0) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [session]);

  const subscribe = useCallback((sessionId: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const token = apiClient.getToken();
    fetch(`${API}/api/v1/admin/staff-devices/enroll/${sessionId}/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, credentials: 'include', signal: ctrl.signal,
    }).then(async (res) => {
      const reader = res.body?.getReader(); if (!reader) return;
      const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const p of parts) {
          const line = p.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try { const pl = JSON.parse(line.slice(5).trim()); if (pl.status) setStatus(pl.status); if (pl.status === 'COMPLETED') loadDevices(); } catch { /* */ }
        }
      }
    }).catch(() => {});
  }, [loadDevices]);

  const startEnroll = async () => {
    if (!sel) return;
    const res = await apiClient.post<{ data: EnrollSession }>('/api/v1/admin/staff-devices/enroll/start', { staffUserId: sel.id, deviceName: deviceName || undefined });
    setSession(res.data); setStatus('PENDING'); subscribe(res.data.sessionId);
  };
  const confirmEnroll = async () => {
    if (!session) return;
    await apiClient.post(`/api/v1/admin/staff-devices/enroll/${session.sessionId}/confirm`, {});
    setStatus('COMPLETED'); loadDevices();
  };
  const revoke = async (id: string) => {
    const reason = window.prompt(tAttr('해제 사유(선택)')) ?? undefined;
    await apiClient.post(`/api/v1/admin/staff-devices/${id}/revoke`, { reason }); loadDevices();
  };
  const pick = (u: StaffUser) => { setSel(u); setSession(null); setStatus(''); setDeviceName(''); };

  const countByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of devices) if (d.status === 'ACTIVE') m.set(d.userId, (m.get(d.userId) ?? 0) + 1);
    return m;
  }, [devices]);

  // 검색 + 그룹필터 적용 후 카테고리별 그룹핑
  const grouped = useMemo(() => {
    const base = users.filter((u) => {
      if (q && !`${u.familyName}${u.givenName}${u.email}${u.role}${u.department ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (groupFilter !== 'ALL' && groupOf(u.role).key !== groupFilter) return false;
      return true;
    });
    return GROUPS.map((g) => ({
      g,
      items: base.filter((u) => groupOf(u.role).key === g.key)
        .sort((a, b) => (countByUser.get(b.id) ?? 0) - (countByUser.get(a.id) ?? 0) || `${a.familyName}${a.givenName}`.localeCompare(`${b.familyName}${b.givenName}`)),
    })).filter((x) => x.items.length > 0);
  }, [users, q, groupFilter, countByUser]);

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users) m.set(groupOf(u.role).key, (m.get(groupOf(u.role).key) ?? 0) + 1);
    return m;
  }, [users]);

  const myDevices = useMemo(() => (sel ? devices.filter((d) => d.userId === sel.id) : []), [devices, sel]);

  const statusLabel: Record<string, string> = {
    PENDING: '대기 중 — 직원이 인증번호 입력 대기', VERIFYING: '인증번호 일치 — 생체 등록 중',
    AWAITING_CONFIRM: '등록됨 — 관리자 확정 대기', COMPLETED: '✅ 등록 완료',
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="생체등록·기기 관리" /></h1>
      <p className="text-sm text-gray-500 mt-0.5 mb-6"><T k="직원을 선택해 디바이스를 등록·관리합니다" /></p>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* 좌: 직원 리스트 */}
        <aside className="lg:col-span-2">
          <div className="relative mb-3">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('직원 검색')}
              className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
          </div>

          {/* 카테고리 필터 칩 */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip active={groupFilter === 'ALL'} onClick={() => setGroupFilter('ALL')} label="전체" count={users.length} />
            {GROUPS.filter((g) => (groupCounts.get(g.key) ?? 0) > 0).map((g) => (
              <Chip key={g.key} active={groupFilter === g.key} onClick={() => setGroupFilter(g.key)} label={g.label} count={groupCounts.get(g.key) ?? 0} dot={g.dot} />
            ))}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm max-h-[72vh] overflow-y-auto">
            {grouped.map(({ g, items }) => (
              <div key={g.key}>
                <div className="sticky top-0 z-10 bg-white/90 backdrop-blur px-4 py-1.5 border-b border-gray-100 flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />
                  <span className={`text-xs font-semibold ${g.text}`}><T k={g.label} /></span>
                  <span className="text-[11px] text-gray-400">{items.length}</span>
                </div>
                {items.map((u) => {
                  const n = countByUser.get(u.id) ?? 0;
                  const active = sel?.id === u.id;
                  const grp = groupOf(u.role);
                  return (
                    <button key={u.id} onClick={() => pick(u)}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-gray-50 transition ${active ? `${grp.soft} ring-1 ${grp.ring} ring-inset` : 'hover:bg-gray-50'}`}>
                      <span className={`flex-shrink-0 w-9 h-9 rounded-full ${grp.soft} ${grp.text} grid place-items-center text-sm font-bold`}>
                        {(u.familyName || u.givenName || '?').charAt(0)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-900 truncate">{u.familyName}{u.givenName}
                          <span className="ml-1.5 text-[11px] font-normal text-gray-400">{u.role}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 truncate">{u.department ?? u.email}</div>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap font-medium ${n ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                        {n ? <><T k="기기" /> {n}</> : <T k="미등록" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!grouped.length && <p className="px-3 py-10 text-center text-sm text-gray-400"><T k="직원 없음" /></p>}
          </div>
        </aside>

        {/* 우: 선택 직원 디바이스 관리 */}
        <main className="lg:col-span-3">
          {!sel ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-16 text-center">
              <div className="text-4xl mb-3">👈</div>
              <p className="text-sm text-gray-400"><T k="왼쪽에서 직원을 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* 헤더 */}
              <div className={`rounded-2xl ${groupOf(sel.role).soft} p-5 flex items-center gap-4`}>
                <span className={`w-14 h-14 rounded-2xl bg-white ${groupOf(sel.role).text} grid place-items-center text-xl font-bold shadow-sm`}>
                  {(sel.familyName || '?').charAt(0)}
                </span>
                <div>
                  <div className="text-lg font-bold text-gray-900">{sel.familyName}{sel.givenName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    <span className={`font-medium ${groupOf(sel.role).text}`}><T k={groupOf(sel.role).label} /></span> · {sel.role} · {sel.department ?? '-'}
                  </div>
                  <div className="text-[11px] text-gray-400">{sel.email}</div>
                </div>
              </div>

              {/* 새 기기 등록 */}
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><span>📱</span> <T k="새 기기 등록" /></h2>
                <div className="flex gap-2">
                  <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={tAttr('기기 이름 (예: 아이폰)')}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
                  <button onClick={startEnroll} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm transition"><T k="QR 발급" /></button>
                </div>
                {session && (
                  <div className="mt-4 flex flex-col sm:flex-row gap-5 items-center bg-gradient-to-br from-slate-50 to-blue-50/40 rounded-2xl p-5 border border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <QrImage value={session.qrUrl} size={150} alt={tAttr('등록 QR')} className="rounded-xl bg-white p-2 shadow-sm" />
                    <div className="text-center sm:text-left">
                      <p className="text-xs text-gray-500">{session.staffName} 님 · <T k={session.enrollMode === 'IN_PERSON' ? '대면 등록' : '원격 등록'} /></p>
                      <p className="text-3xl font-mono font-bold tracking-[0.3em] text-gray-900 my-1.5">{session.code}</p>
                      <p className="text-xs text-gray-400"><T k="만료까지" /> {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, '0')}</p>
                      <p className="mt-2 text-sm font-semibold text-blue-700"><T k={statusLabel[status] ?? status} /></p>
                      {status === 'AWAITING_CONFIRM' && (
                        <button onClick={confirmEnroll} className="mt-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition"><T k="본인 확인 후 등록 확정" /></button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* 등록 디바이스 */}
              <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><span>🔐</span> <T k="등록 디바이스" /> <span className="text-sm font-normal text-gray-400">({myDevices.length})</span></h2>
                <div className="space-y-2">
                  {myDevices.map((d) => {
                    const st = DEV_STATUS[d.status] ?? { label: d.status, cls: 'bg-gray-100 text-gray-500' };
                    return (
                      <div key={d.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3 hover:border-gray-200 transition">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                            {d.deviceName}
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${st.cls}`}><T k={st.label} /></span>
                            <span className="text-[11px] text-gray-400"><T k={d.enrollMode === 'IN_PERSON' ? '대면' : '원격'} /></span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            <T k="등록" /> {fmt(d.verifiedAt)} · <T k="최근사용" /> {fmt(d.lastUsedAt)}{d.reEnrollDueAt ? <> · <T k="재등록예정" /> {fmt(d.reEnrollDueAt)}</> : ''}
                          </div>
                        </div>
                        {d.status !== 'REVOKED' && d.status !== 'EXPIRED' && (
                          <button onClick={() => revoke(d.id)} className="text-xs font-medium text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg whitespace-nowrap ml-2 transition"><T k="해제@기기" /></button>
                        )}
                      </div>
                    );
                  })}
                  {!myDevices.length && (
                    <div className="text-center py-8 text-gray-400">
                      <div className="text-2xl mb-1">📭</div>
                      <p className="text-sm"><T k="등록된 디바이스가 없습니다" /></p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${active ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : dot}`} />}
      <T k={label} />
      <span className={`${active ? 'text-gray-300' : 'text-gray-400'}`}>{count}</span>
    </button>
  );
}
