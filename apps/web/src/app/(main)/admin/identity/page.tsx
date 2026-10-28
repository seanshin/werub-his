'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface StaffUser { id: string; familyName: string; givenName: string; email: string; role: string; department?: string }
interface Row { [k: string]: any }

const TABS = [
  { key: 'dashboard', label: '대시보드', icon: '📊' },
  { key: 'staff360', label: '직원 360°', icon: '👤' },
  { key: 'policy', label: '정책', icon: '⚙️' },
  { key: 'approvals', label: '승인 큐', icon: '✅' },
  { key: 'recovery', label: '복구 큐', icon: '🔑' },
] as const;

const GROUPS = [
  { key: 'ADMIN', label: '관리자', roles: ['ADMIN'], dot: 'bg-violet-500', text: 'text-violet-700', soft: 'bg-violet-50' },
  { key: 'DOCTOR', label: '의사', roles: ['DOCTOR'], dot: 'bg-blue-500', text: 'text-blue-700', soft: 'bg-blue-50' },
  { key: 'NURSE', label: '간호', roles: ['NURSE'], dot: 'bg-emerald-500', text: 'text-emerald-700', soft: 'bg-emerald-50' },
  { key: 'PHARM', label: '약무', roles: ['PHARMACIST'], dot: 'bg-amber-500', text: 'text-amber-700', soft: 'bg-amber-50' },
  { key: 'LAB', label: '검사/영상', roles: ['LAB_TECH'], dot: 'bg-cyan-500', text: 'text-cyan-700', soft: 'bg-cyan-50' },
  { key: 'CRM', label: '행정/CRM', roles: ['CRM_MANAGER', 'CRM_STAFF'], dot: 'bg-rose-500', text: 'text-rose-700', soft: 'bg-rose-50' },
  { key: 'ETC', label: '기타', roles: [], dot: 'bg-gray-400', text: 'text-gray-600', soft: 'bg-gray-50' },
] as const;
const groupOf = (role: string) => GROUPS.find((g) => (g.roles as readonly string[]).includes(role)) ?? GROUPS[GROUPS.length - 1];

const fmt = (s?: string) => (s ?kdate(s, 'datetime') : '-');
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200', REENROLL_DUE: 'bg-amber-50 text-amber-700 ring-amber-200',
  EXPIRED: 'bg-gray-100 text-gray-500 ring-gray-200', REVOKED: 'bg-red-50 text-red-600 ring-red-200',
  SUSPENDED: 'bg-orange-50 text-orange-700 ring-orange-200', REPLACED: 'bg-gray-100 text-gray-400 ring-gray-200',
  PENDING: 'bg-blue-50 text-blue-700 ring-blue-200', APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  LOCKED: 'bg-red-50 text-red-600 ring-red-200',
};
const Badge = ({ s }: { s: string }) => (
  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ring-1 ${STATUS_COLOR[s] ?? 'bg-gray-100 text-gray-600 ring-gray-200'}`}>{s}</span>
);
const Section = ({ title, icon, count, children }: { title: string; icon?: string; count?: number; children: React.ReactNode }) => (
  <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
    <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">{icon && <span>{icon}</span>}<T k={title} />{count !== undefined && <span className="text-gray-400 font-normal">({count})</span>}</h3>
    <div className="space-y-1.5">{children}</div>
  </section>
);
const Empty = ({ msg = '없음' }: { msg?: string }) => <p className="text-xs text-gray-400 py-3 text-center"><T k={msg} /></p>;
const Btn = ({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: 'danger' | 'primary' }) => (
  <button onClick={onClick}
    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition whitespace-nowrap ${tone === 'danger' ? 'text-red-600 hover:bg-red-50' : tone === 'primary' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>{children}</button>
);

export default function IdentityConsolePage() {
  const [tab, setTab] = useState<string>('dashboard');
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">🛡️</span>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900"><T k="인증 관리 콘솔" /></h1>
      </div>
      <p className="text-sm text-gray-500 mb-5"><T k="직원 인증·디바이스·인증서·세션·복구 통합 관리" /></p>
      <div className="flex gap-1.5 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap transition ${tab === t.key ? 'bg-gray-900 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <span className="mr-1.5">{t.icon}</span><T k={t.label} />
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <Dashboard onGo={setTab} />}
      {tab === 'staff360' && <Staff360 />}
      {tab === 'policy' && <PolicyTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'recovery' && <RecoveryTab />}
    </div>
  );
}

function Dashboard({ onGo }: { onGo: (t: string) => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [anom, setAnom] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    apiClient.get<{ data: Row }>('/api/v1/admin/identity/dashboard').then((r) => setD(r.data)).catch((e) => setErr(e?.message ?? '조회 실패'));
    apiClient.get<{ data: Row }>('/api/v1/admin/identity/anomalies').then((r) => setAnom(r.data)).catch(() => {});
  }, []);
  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!d) return <Loading />;
  const Card = ({ label, value, accent, onClick }: { label: string; value: number; accent?: string; onClick?: () => void }) => (
    <button onClick={onClick} disabled={!onClick}
      className={`text-left rounded-2xl border border-gray-100 bg-white shadow-sm p-4 transition ${onClick ? 'hover:shadow-md hover:-translate-y-0.5' : 'cursor-default'}`}>
      <div className={`text-3xl font-bold ${accent ?? 'text-gray-900'}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500 mt-1"><T k={label} /></div>
    </button>
  );
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div><h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2"><T k={title} /></h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div></div>
  );
  return (
    <div className="space-y-6">
      <Group title="직원 등록">
        <Card label="전체 직원" value={d.staff.total} />
        <Card label="활성 기기 보유" value={d.staff.withActiveDevice} accent="text-emerald-600" />
        <Card label="미등록 직원" value={d.staff.unregistered} accent={d.staff.unregistered ? 'text-amber-600' : undefined} />
      </Group>
      <Group title="디바이스">
        <Card label="재등록 필요" value={d.devices.reEnrollDue} accent={d.devices.reEnrollDue ? 'text-amber-600' : undefined} />
        <Card label="만료" value={d.devices.expired} accent="text-gray-500" />
        <Card label="분실 신고" value={d.devices.lost} accent={d.devices.lost ? 'text-red-600' : undefined} />
      </Group>
      <Group title="인증서">
        <Card label="활성" value={d.certs.active} accent="text-emerald-600" />
        <Card label="만료 임박" value={d.certs.expiringSoon} accent={d.certs.expiringSoon ? 'text-amber-600' : undefined} />
        <Card label="폐기됨" value={d.certs.revoked} accent="text-gray-500" />
        {/* 🔴 분모를 말한다(S12) — 이 수는 HIS 인증서 원장(blockchain_certificates · 직원 · ACTIVE)이고,
            전자서명 인증서 화면(/admin/blockchain-cert)의 「직원 (n/전체)」는 전체 사용자 계정 중 sign serial 보유를 센다 — 세는 대상이 다르다. */}
        <p data-testid="cert-denominator" className="col-span-full text-[11px] text-gray-400"><T k="HIS 인증서 원장(직원 · 상태 ACTIVE) 기준 — 전자서명 인증서 화면의 「sign serial 보유 수」(전체 사용자 계정 · 비활성 포함)와는 세는 대상이 다르다." /></p>
      </Group>
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2"><T k="처리 대기" /></h3>
        <div className="grid grid-cols-2 gap-3">
          <Card label="승인 대기(4-eyes)" value={d.pending.approvals} accent={d.pending.approvals ? 'text-blue-600' : undefined} onClick={() => onGo('approvals')} />
          <Card label="복구 대기" value={d.pending.recovery} accent={d.pending.recovery ? 'text-blue-600' : undefined} onClick={() => onGo('recovery')} />
        </div>
      </div>
      {anom && (anom.bruteForce.length > 0 || anom.offHours.length > 0) ? (
        <div>
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">⚠️ <T k="이상 로그인" /></h3>
          <div className="space-y-1.5">
            {anom.bruteForce.map((b: Row) => (
              <div key={b.email} className="flex items-center gap-2 text-xs border border-red-200 bg-red-50 rounded-xl px-3 py-2.5">
                <span className="font-semibold text-red-700"><T k="연속 실패" /> {b.fails}<Unit>회</Unit></span>
                <span className="text-gray-600">{b.email}</span>{b.locked && <Badge s="LOCKED" />}
              </div>
            ))}
            {anom.offHours.slice(0, 5).map((o: Row, i: number) => (
              <div key={i} className="text-xs border border-amber-200 bg-amber-50 rounded-xl px-3 py-2.5">
                🌙 <T k="심야 로그인" /> — <span className="font-medium">{o.name}</span> · {fmt(o.at)}
              </div>
            ))}
          </div>
        </div>
      ) : anom ? (
        <div className="text-xs text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2.5 inline-block">✓ <T k="이상 로그인 징후 없음" /></div>
      ) : null}
    </div>
  );
}

function Staff360() {
  const tAttr = useTAttr();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [sel, setSel] = useState<StaffUser | null>(null);
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [enroll, setEnroll] = useState<{ code?: string; qrUrl?: string; qrDataUrl?: string; staffName?: string; expiresAt?: string } | null>(null);

  useEffect(() => { apiClient.get<{ data: StaffUser[] }>('/api/v1/users').then((r) => setUsers(r.data)).catch(() => {}); }, []);

  const startOnboard = async () => {
    if (!sel) return;
    setMsg('');
    try {
      const r = await apiClient.post<{ data: { enroll?: { code?: string; qrUrl?: string; qrDataUrl?: string; staffName?: string; expiresAt?: string } } }>(`/api/v1/admin/credential/onboard/${sel.id}`, { deviceName: '신규 기기' });
      const e = r.data?.enroll;
      if (e) setEnroll({ ...e, staffName: e.staffName ?? `${sel.familyName}${sel.givenName}` });
      else setMsg('등록 세션 발급 실패');
      await load(sel);
    } catch (e: any) { setMsg(e?.message ?? '온보딩 실패'); }
  };

  const load = useCallback(async (u: StaffUser) => {
    setSel(u); setLoading(true); setData(null); setMsg('');
    try { const r = await apiClient.get<{ data: Row }>(`/api/v1/admin/identity/staff/${u.id}`); setData(r.data); }
    catch (e: any) { setMsg(e?.message ?? '조회 실패'); } finally { setLoading(false); }
  }, []);

  const act = async (fn: () => Promise<any>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { const r = await fn(); setMsg(r?.data?.message ?? '완료'); if (sel) await load(sel); }
    catch (e: any) { setMsg(e?.message ?? '실패'); }
  };

  const grouped = useMemo(() => {
    const base = users.filter((u) => {
      if (q && !`${u.familyName}${u.givenName}${u.email}${u.role}${u.department ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (groupFilter !== 'ALL' && groupOf(u.role).key !== groupFilter) return false;
      return true;
    });
    return GROUPS.map((g) => ({ g, items: base.filter((u) => groupOf(u.role).key === g.key) })).filter((x) => x.items.length > 0);
  }, [users, q, groupFilter]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const u of users) m.set(groupOf(u.role).key, (m.get(groupOf(u.role).key) ?? 0) + 1); return m; }, [users]);

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* 좌: 직원 리스트 */}
      <aside className="lg:col-span-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`🔍 ${tAttr('직원 검색')}`}
          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm mb-3 focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none" />
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip active={groupFilter === 'ALL'} onClick={() => setGroupFilter('ALL')} label="전체" count={users.length} />
          {GROUPS.filter((g) => (counts.get(g.key) ?? 0) > 0).map((g) => (
            <Chip key={g.key} active={groupFilter === g.key} onClick={() => setGroupFilter(g.key)} label={g.label} count={counts.get(g.key) ?? 0} dot={g.dot} />
          ))}
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm max-h-[70vh] overflow-y-auto">
          {grouped.map(({ g, items }) => (
            <div key={g.key}>
              <div className="sticky top-0 z-10 bg-white/90 backdrop-blur px-4 py-1.5 border-b border-gray-100 flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} /><span className={`text-xs font-semibold ${g.text}`}><T k={g.label} /></span><span className="text-[11px] text-gray-400">{items.length}</span>
              </div>
              {items.map((u) => {
                const active = sel?.id === u.id; const grp = groupOf(u.role);
                return (
                  <button key={u.id} onClick={() => load(u)}
                    className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-gray-50 transition ${active ? `${grp.soft}` : 'hover:bg-gray-50'}`}>
                    <span className={`flex-shrink-0 w-9 h-9 rounded-full ${grp.soft} ${grp.text} grid place-items-center text-sm font-bold`}>{(u.familyName || '?').charAt(0)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900 truncate">{u.familyName}{u.givenName}<span className="ml-1.5 text-[11px] font-normal text-gray-400">{u.role}</span></div>
                      <div className="text-[11px] text-gray-400 truncate">{u.department ?? u.email}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {!grouped.length && <Empty msg="직원 없음" />}
        </div>
      </aside>

      {/* 우: 360 상세 */}
      <main className="lg:col-span-3">
        {!sel ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-16 text-center"><div className="text-4xl mb-3">👈</div><p className="text-sm text-gray-400"><T k="직원을 선택하세요" /></p></div>
        ) : (
          <div className="space-y-4">
            <div className={`rounded-2xl ${groupOf(sel.role).soft} p-5 flex items-center gap-4`}>
              <span className={`w-14 h-14 rounded-2xl bg-white ${groupOf(sel.role).text} grid place-items-center text-xl font-bold shadow-sm`}>{(sel.familyName || '?').charAt(0)}</span>
              <div className="flex-1">
                <div className="text-lg font-bold text-gray-900">{sel.familyName}{sel.givenName}</div>
                <div className="text-xs text-gray-500 mt-0.5"><span className={`font-medium ${groupOf(sel.role).text}`}><T k={groupOf(sel.role).label} /></span> · {sel.role} · {sel.department ?? '-'}</div>
              </div>
              <div className="flex gap-1.5">
                <Btn onClick={startOnboard}><T k="온보딩" /></Btn>
                <Btn tone="danger" onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/staff/${sel.id}/deprovision`, { reason: prompt('오프보딩 사유') || '퇴사' }), '오프보딩 — 자격증명·세션 전체 폐기(4-eyes)?')}><T k="오프보딩" /></Btn>
              </div>
            </div>

            {msg && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2"><T k={msg} /></div>}
            {loading && <Loading />}
            {data && (
              <>
                <Section title="디바이스" icon="📱" count={data.devices.length}>
                  {data.devices.map((d: Row) => (
                    <div key={d.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-3.5 py-2.5">
                      <div><span className="text-sm font-semibold">{d.deviceName}</span> <Badge s={d.status} /> <span className="text-[11px] text-gray-400 ml-1"><T k="최근" /> {fmt(d.lastUsedAt)}</span></div>
                      <div className="flex gap-1">
                        <Btn onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/devices/${d.id}/force-reenroll`), '강제 재등록?')}><T k="재등록" /></Btn>
                        <Btn tone="danger" onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/devices/${d.id}/report-lost`, { reason: prompt('분실 사유') || '분실' }), '분실 신고(인증수단 폐기)?')}><T k="분실" /></Btn>
                        <Btn tone="danger" onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/devices/${d.id}/unenroll`, { reason: '관리자 해제' }), '등록 해제?')}><T k="해제@기기" /></Btn>
                      </div>
                    </div>
                  ))}
                  {!data.devices.length && <Empty />}
                </Section>

                <Section title="패스키" icon="🔑" count={data.passkeys.length}>
                  {data.passkeys.map((p: Row) => (
                    <div key={p.id} className="flex justify-between border border-gray-100 rounded-xl px-3.5 py-2.5 text-sm">
                      <span><T k={p.deviceName ?? '패스키'} /> <Badge s={p.status} /> {p.backedUp && <span className="text-[10px] text-blue-500 ml-1"><T k="동기화" /></span>}</span>
                      <span className="text-[11px] text-gray-400"><T k="최근" /> {fmt(p.lastUsedAt)}</span>
                    </div>
                  ))}
                  {!data.passkeys.length && <Empty />}
                </Section>

                <Section title="인증서" icon="📜" count={data.certs.length}>
                  {data.certs.map((c: Row) => (
                    <div key={c.id} className="flex items-center justify-between border border-gray-100 rounded-xl px-3.5 py-2.5">
                      <div><span className="font-mono text-xs">{c.serialNumber}</span> <Badge s={c.status} /> <span className="text-[11px] text-gray-400 ml-1"><T k="만료" /> {fmt(c.expiresAt)}</span></div>
                      {c.status === 'ACTIVE' && (
                        <div className="flex gap-1">
                          <Btn onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/certs/${c.id}/suspend`, { reason: '관리자 정지' }), '인증서 정지?')}><T k="정지" /></Btn>
                          <Btn tone="danger" onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/certs/${c.id}/revoke`, { reason: prompt('폐기 사유') || '폐기' }), '인증서 폐기 요청(4-eyes)?')}><T k="폐기" /></Btn>
                        </div>
                      )}
                      {c.status === 'SUSPENDED' && <Btn onClick={() => act(() => apiClient.post(`/api/v1/admin/credential/certs/${c.id}/restore`))}><T k="복원" /></Btn>}
                    </div>
                  ))}
                  {!data.certs.length && <Empty />}
                </Section>

                <Section title={data.sessions.active ? '세션 · 활성' : '세션'} icon="🖥️" count={data.sessions.count}>
                  {data.sessions.sessions.map((s: Row) => (
                    <div key={s.sessionId} className="flex justify-between border border-gray-100 rounded-xl px-3.5 py-2 text-xs"><span className="font-mono text-gray-500">{s.sessionId.slice(0, 12)}…</span><span className="text-gray-400"><T k="로그인" /> {fmt(s.createdAt)}</span></div>
                  ))}
                  {data.sessions.count > 0 ? <Btn tone="danger" onClick={() => act(() => apiClient.post(`/api/v1/admin/identity/sessions/${sel.id}/logout`), '모든 세션 강제 로그아웃?')}><T k="강제 로그아웃(SLO)" /></Btn> : <Empty />}
                </Section>

                <Section title="감사" icon="📋" count={data.audit.length}>
                  {data.audit.slice(0, 10).map((a: Row) => (
                    <div key={a.id} className="flex justify-between text-xs border-b border-gray-50 py-1.5"><span className="text-gray-600">{a.action} · {a.resourceType}</span><span className="text-gray-400">{fmt(a.timestamp)}</span></div>
                  ))}
                </Section>
              </>
            )}
          </div>
        )}
      </main>

      {/* 기기 등록 QR 모달 — 보안담당자 화면을 직원 스마트폰으로 스캔 */}
      {enroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEnroll(null)}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900"><T k="기기 등록 · 생체 인증" /></h3>
            <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
              {enroll.staffName ? <b className="text-gray-700">{enroll.staffName}</b> : '직원'} 님의 스마트폰으로 아래 QR을 스캔한 뒤, 인증번호를 입력해 생체(패스키)를 등록합니다.
            </p>
            {enroll.qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enroll.qrDataUrl} alt={tAttr('기기 등록 QR')} className="w-52 h-52 mx-auto rounded-2xl border border-gray-100 p-2" />
            ) : (
              <div className="w-52 h-52 mx-auto rounded-2xl border border-dashed border-gray-200 flex items-center justify-center text-xs text-gray-400"><T k="QR 생성 실패 — 아래 링크 사용" /></div>
            )}
            <div className="mt-4 bg-blue-50 border border-blue-100 rounded-2xl p-3">
              <p className="text-[11px] text-blue-500 mb-1"><T k="인증번호" /></p>
              <p className="font-mono text-3xl font-bold tracking-[0.3em] text-blue-700 pl-[0.3em]">{enroll.code ?? '------'}</p>
            </div>
            {enroll.qrUrl && (
              <button onClick={() => { navigator.clipboard?.writeText(enroll.qrUrl!); setMsg('등록 링크 복사됨'); }} className="mt-2 w-full text-[10px] text-gray-400 hover:text-gray-600 break-all px-2" title={tAttr('링크 복사')}>{enroll.qrUrl}</button>
            )}
            <p className="text-[10px] text-gray-400 mt-3"><T k="QR·인증번호는 일정 시간 후 만료됩니다. 화면을 직원에게 직접 보여주세요." /></p>
            <button onClick={() => setEnroll(null)} className="w-full mt-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyTab() {
  const [list, setList] = useState<Row[]>([]);
  const [form, setForm] = useState({ reEnrollDays: 180, idleExpireDays: 60, certValidityDays: 365, expiryWarnDays: 14, maxDevices: 3 });
  const [preview, setPreview] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  const reload = () => apiClient.get<{ data: Row[] }>('/api/v1/admin/credential/policy').then((r) => setList(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);
  const save = async () => { try { await apiClient.put('/api/v1/admin/credential/policy', { scope: 'GLOBAL', ...form }); setMsg('✓ GLOBAL 정책 저장됨'); reload(); } catch (e: any) { setMsg(e?.message ?? '실패'); } };
  const doPreview = async () => { try { const r = await apiClient.post<{ data: Row }>('/api/v1/admin/credential/policy/preview', { scope: 'GLOBAL', ...form }); setPreview(r.data); } catch (e: any) { setMsg(e?.message ?? '실패'); } };
  return (
    <div className="max-w-2xl space-y-4">
      {msg && <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3 py-2"><T k={msg} /></div>}
      <Section title="기본(GLOBAL) 정책" icon="⚙️">
        <div className="grid grid-cols-2 gap-3">
          {([['reEnrollDays', '재등록 주기(일)'], ['idleExpireDays', '미사용 만료(일)'], ['certValidityDays', '인증서 유효(일)'], ['expiryWarnDays', '만료 임박 알림(일)'], ['maxDevices', '최대 기기 수']] as const).map(([k, label]) => (
            <label key={k} className="text-sm"><span className="text-gray-600 text-xs"><T k={label} /></span>
              <input type="number" value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 mt-1 focus:ring-2 focus:ring-blue-100 outline-none" />
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Btn onClick={doPreview}><T k="영향 미리보기" /></Btn>
          <Btn tone="primary" onClick={save}><T k="GLOBAL 정책 저장" /></Btn>
        </div>
        {preview && <div className="text-sm bg-blue-50 rounded-xl p-3 mt-2">영향: 직원 <b>{preview.affectedUsers}</b>명 · 기기 <b>{preview.affectedDevices}</b>개 · 즉시 만료대상 <b>{preview.wouldExpireNow}</b> (실효 재등록 {preview.effective?.reEnrollDays}<Unit>일</Unit>)</div>}
      </Section>
      <BulkOps />
      <Section title="적용 정책" icon="📑">
        {list.map((p) => (
          <div key={p.id} className="text-xs border border-gray-100 rounded-xl px-3 py-2"><b>{p.scope}</b>{p.scope !== 'GLOBAL' && `:${p.scopeRef}`} — 재등록 {p.reEnrollDays}<Unit>일</Unit> · 미사용 {p.idleExpireDays}<Unit>일</Unit> · 인증서 {p.certValidityDays}<Unit>일</Unit></div>
        ))}
        {!list.length && <Empty />}
      </Section>
    </div>
  );
}

function BulkOps() {
  const tAttr = useTAttr();
  const [scope, setScope] = useState('ROLE');
  const [scopeRef, setScopeRef] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (path: 'preview' | 'reenroll' | 'expiry-check') => {
    try { const body = path === 'expiry-check' ? {} : { scope, scopeRef }; const r = await apiClient.post<{ data: Row }>(`/api/v1/admin/credential/bulk/${path}`, body); setMsg(JSON.stringify(r.data)); } catch (e: any) { setMsg(e?.message ?? '실패'); }
  };
  return (
    <Section title="일괄 작업" icon="📦">
      <div className="flex gap-2 items-center">
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"><option value="ROLE">{tAttr('역할')}</option><option value="DEPARTMENT">{tAttr('부서')}</option></select>
        <input value={scopeRef} onChange={(e) => setScopeRef(e.target.value)} placeholder={scope === 'ROLE' ? 'DOCTOR/NURSE…' : tAttr('내과/외과…')} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 outline-none focus:ring-2 focus:ring-blue-100" />
      </div>
      <div className="flex gap-2 mt-2">
        <Btn onClick={() => run('preview')}><T k="미리보기" /></Btn>
        <Btn onClick={() => { if (confirm('그룹 강제 재등록(4-eyes)?')) run('reenroll'); }}><T k="강제 재등록" /></Btn>
        <Btn onClick={() => run('expiry-check')}><T k="만료 일괄 점검" /></Btn>
      </div>
      {msg && <div className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-1 font-mono break-all">{msg}</div>}
    </Section>
  );
}

function ApprovalsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  const reload = () => apiClient.get<{ data: Row[] }>('/api/v1/admin/credential/approvals?status=PENDING').then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { reload(); }, []);
  const decide = async (id: string, action: 'approve' | 'reject') => {
    try { await apiClient.post(`/api/v1/admin/credential/approvals/${id}/${action}`, action === 'reject' ? { reason: prompt('반려 사유') || '' } : {}); setMsg('처리됨'); reload(); } catch (e: any) { setMsg(e?.message ?? '실패(요청자=승인자 불가)'); }
  };
  return (
    <div className="max-w-3xl space-y-2">
      {msg && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2"><T k={msg} /></div>}
      {!rows.length && <Section title="승인 대기"><Empty msg="대기 중인 승인이 없습니다" /></Section>}
      {rows.map((a) => (
        <div key={a.id} className="flex items-center justify-between bg-white border border-gray-100 shadow-sm rounded-2xl px-4 py-3">
          <div><div className="text-sm font-semibold flex items-center gap-2">{a.action} <Badge s={a.status} /></div><div className="text-[11px] text-gray-400 mt-0.5"><T k="대상" /> {a.targetId?.slice(0, 12)} · {a.reason ?? ''} · {fmt(a.requestedAt)}</div></div>
          <div className="flex gap-1.5"><Btn tone="primary" onClick={() => decide(a.id, 'approve')}><T k="승인" /></Btn><Btn tone="danger" onClick={() => decide(a.id, 'reject')}><T k="반려" /></Btn></div>
        </div>
      ))}
      <p className="text-[11px] text-gray-400 mt-1"><T k="⚠️ 요청자 본인은 승인할 수 없습니다(4-eyes)." /></p>
    </div>
  );
}

function RecoveryTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState('');
  const reload = () => apiClient.get<{ data: Row[] }>('/api/v1/admin/credential/recovery').then((r) => setRows(r.data)).catch((e) => setMsg(e?.message ?? ''));
  useEffect(() => { reload(); }, []);
  const approve = async (id: string) => { try { await apiClient.post(`/api/v1/admin/credential/recovery/${id}/approve`, {}); setMsg('승인됨'); reload(); } catch (e: any) { setMsg(e?.message ?? '실패'); } };
  return (
    <div className="max-w-3xl space-y-2">
      {msg && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2"><T k={msg} /></div>}
      {!rows.length && <Section title="복구 대기"><Empty msg="복구 요청이 없습니다" /></Section>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between bg-white border border-gray-100 shadow-sm rounded-2xl px-4 py-3">
          <div><div className="text-sm font-semibold flex items-center gap-2"><T k="복구 요청" /> <Badge s={r.status} /></div><div className="text-[11px] text-gray-400 mt-0.5">{r.reason ?? ''} · {fmt(r.requestedAt)}</div></div>
          <Btn tone="primary" onClick={() => approve(r.id)}><T k="승인" /></Btn>
        </div>
      ))}
    </div>
  );
}

function Chip({ active, onClick, label, count, dot }: { active: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${active ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : dot}`} />}<T k={label} /><span className={active ? 'text-gray-300' : 'text-gray-400'}>{count}</span>
    </button>
  );
}
const Loading = () => <div className="flex items-center gap-2 text-sm text-gray-400 py-6"><span className="animate-spin">⏳</span> <T k="로딩 중..." /></div>;
