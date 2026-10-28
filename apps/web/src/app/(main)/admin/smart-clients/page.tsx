'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { SMART_SCOPE_OPTIONS } from '@/lib/smart-scopes';

interface SmartClient {
  id: string;
  clientId: string;
  name: string;
  scopes: string[];
  redirectUris?: string[];
  /** EHR launch 진입점 — 등록된 앱만 차트 '외부 앱' 런처에 노출된다 */
  launchUrl?: string | null;
  isActive: boolean;
  lastUsedAt?: string;
  createdAt: string;
}

export default function SmartClientsPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', scopes: ['patient/*.read'], redirectUris: '', launchUrl: '' });
  // 발급 시크릿은 **1회만** 노출된다(DB는 해시 보관) → 잘라서 보여주면 전달 자체가 불가능하므로 전문을 띄운다
  const [issued, setIssued] = useState<{ name: string; clientId: string; clientSecret: string } | null>(null);
  const [editLaunch, setEditLaunch] = useState<{ id: string; value: string } | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['smart-clients'],
    queryFn: () => apiClient.get<{ data: SmartClient[] }>('/api/v1/smart-clients'),
  });
  const clients: SmartClient[] = (() => { const d = data?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/smart-clients', {
      name: form.name,
      scopes: form.scopes,
      redirectUris: form.redirectUris.split(/[\s,]+/).map(v => v.trim()).filter(Boolean),
      launchUrl: form.launchUrl.trim() || null,
    }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['smart-clients'] });
      const c = res?.data?.data ?? res?.data;
      setShowCreate(false);
      if (c?.clientSecret) setIssued({ name: c.name, clientId: c.clientId, clientSecret: c.clientSecret });
      else toast.success(tAttr('클라이언트 생성 완료'));
    },
    onError: (e: any) => toast.error(e?.message ?? tAttr('생성 실패')),
  });

  const saveLaunch = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      apiClient.patch(`/api/v1/smart-clients/${id}`, { launchUrl: value.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smart-clients'] });
      setEditLaunch(null);
      toast.success(tAttr('launch URL 저장'));
    },
    onError: (e: any) => toast.error(e?.message ?? tAttr('https URL 이어야 합니다')),
  });

  const toggleScope = (scope: string) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope],
    }));
  };

  // 🔴 표준 표기 정본은 lib/smart-scopes(r3 B8) — 비표준 표기는 서버 hasScope 가 인정하지 않아 권한이 0 이었다
  const AVAILABLE_SCOPES = SMART_SCOPE_OPTIONS;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SMART <T k="클라이언트" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">SMART-on-FHIR OAuth2 <T k="클라이언트 관리" /></p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><T k="+ 클라이언트 발급" /></button>
      </div>

      {isError ? <QueryErrorFallback error={error} onRetry={refetch} /> :
      isLoading ? <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div> :
      clients.length === 0 ? <EmptyState icon="🔑" title="발급된 클라이언트가 없습니다" hint="외부 앱이 FHIR 를 읽으려면 클라이언트를 발급하세요" /> : (
        <div className="space-y-2">
          {clients.map(c => (
            <div key={c.id} className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-bold text-gray-900">{c.name}</span>
                  <span className="ml-2 text-[10px] text-gray-400 font-mono">{c.clientId}</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${c.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  <T k={c.isActive ? '활성' : '비활성'} />
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {c.scopes.map(s => (
                  <span key={s} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-mono">{s}</span>
                ))}
              </div>
              {/* EHR launch — 등록돼 있으면 차트 '외부 앱' 런처에 뜬다(standalone 은 HIS 로그인·동의 경유) */}
              <div className="mb-2 flex items-center gap-2 text-[10px]">
                <span className="shrink-0 font-semibold text-gray-500">EHR launch</span>
                {editLaunch?.id === c.id ? (
                  <>
                    <input
                      value={editLaunch.value}
                      onChange={e => setEditLaunch({ id: c.id, value: e.target.value })}
                      placeholder="https://app.example/smart/launch"
                      className="flex-1 rounded border px-2 py-1 font-mono text-[10px]"
                    />
                    <button onClick={() => saveLaunch.mutate(editLaunch)} className="rounded bg-blue-600 px-2 py-1 font-semibold text-white"><T k="저장" /></button>
                    <button onClick={() => setEditLaunch(null)} className="rounded bg-gray-100 px-2 py-1"><T k="취소" /></button>
                  </>
                ) : (
                  <>
                    {c.launchUrl
                      ? <span className="flex-1 truncate font-mono text-gray-600">{c.launchUrl}</span>
                      : <span className="flex-1 text-gray-400"><T k="미등록 — 차트 런처에 표시되지 않음" /></span>}
                    <button onClick={() => setEditLaunch({ id: c.id, value: c.launchUrl ?? '' })} className="rounded bg-gray-100 px-2 py-1 font-medium">
                      <T k={c.launchUrl ? '변경' : '등록'} />
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span><T k="생성" />: {c.createdAt?.slice(0, 10)}</span>
                <span><T k="마지막 사용" />: {c.lastUsedAt?.slice(0, 10) ?? tAttr('없음')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <AccessReport />

      {issued && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold"><T k="발급 완료" /> — {issued.name}</h3>
            <p className="mb-4 text-xs text-red-600"><T k="client_secret 은" /> <b><T k="지금 한 번만" /></b> <T k="표시됩니다(서버는 해시만 보관). 분실 시 재발급만 가능합니다." /></p>
            <div className="space-y-2 text-xs">
              <div>
                <div className="mb-1 font-semibold text-gray-500">client_id</div>
                <div className="break-all rounded bg-gray-50 p-2 font-mono">{issued.clientId}</div>
              </div>
              <div>
                <div className="mb-1 font-semibold text-gray-500">client_secret</div>
                <div className="break-all rounded bg-gray-50 p-2 font-mono">{issued.clientSecret}</div>
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <button
                onClick={() => { navigator.clipboard?.writeText(`client_id=${issued.clientId}\nclient_secret=${issued.clientSecret}`); toast.success(tAttr('복사했습니다')); }}
                className="flex-1 rounded-xl bg-gray-100 py-2 text-sm"
              ><T k="복사" /></button>
              <button onClick={() => setIssued(null)} className="flex-1 rounded-xl bg-blue-600 py-2 text-sm font-medium text-white"><T k="닫기(다시 볼 수 없음)" /></button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">SMART <T k="클라이언트 발급" /></h3>
            <div className="space-y-3">
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={tAttr('클라이언트 이름 *')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Scope (<T k="접근 범위" />)</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {AVAILABLE_SCOPES.map(s => (
                    <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={form.scopes.includes(s)} onChange={() => toggleScope(s)} className="rounded" />
                      <span className="font-mono text-[10px]">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">redirect_uri (<T k="https·줄바꿈/쉼표 구분" />)</label>
                <textarea value={form.redirectUris} onChange={e => setForm({...form, redirectUris: e.target.value})} rows={2} placeholder="https://app.example/smart/callback" className="w-full rounded-lg border px-3 py-2 font-mono text-[11px]" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">EHR launch URL (<T k="선택·등록 시 차트 런처 노출" />)</label>
                <input value={form.launchUrl} onChange={e => setForm({...form, launchUrl: e.target.value})} placeholder="https://app.example/smart/launch" className="w-full rounded-lg border px-3 py-2 font-mono text-[11px]" />
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-gray-100 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={() => create.mutate()} disabled={!form.name} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-40"><T k="발급" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 외부 앱 접근 리포트 — "어떤 앱이 / 누가 무엇을 얼마나 읽었는가".
 * 기록은 SmartAccessLog(감사 인터셉터 적재). 사용자 없는 행은 system 단위 접근(client_credentials).
 */
function AccessReport() {
  const tAttr = useTAttr();
  const [days, setDays] = useState(7);
  const [pick, setPick] = useState<{ clientId?: string; userId?: string } | null>(null);
  const from = new Date(Date.now() - days * 86400000).toISOString();

  const { data: sum, isError: sumIsError, error: sumError, refetch: refetchSum } = useQuery({
    queryKey: ['smart-access-summary', days],
    queryFn: () => apiClient.get<any>(`/api/v1/smart-clients/access/summary?from=${encodeURIComponent(from)}`),
    refetchOnWindowFocus: false,
  });
  const s = sum?.data?.data ?? sum?.data ?? null;

  const { data: list, isError: listIsError, error: listError, refetch: refetchList } = useQuery({
    queryKey: ['smart-access-list', days, pick],
    enabled: !!pick,
    queryFn: () => {
      const q = new URLSearchParams({ from, limit: '50' });
      if (pick?.clientId) q.set('clientId', pick.clientId);
      if (pick?.userId) q.set('userId', pick.userId);
      return apiClient.get<any>(`/api/v1/smart-clients/access?${q}`);
    },
    refetchOnWindowFocus: false,
  });
  const rows = (list?.data?.data ?? list?.data)?.items ?? [];

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-900"><T k="외부 앱 접근 리포트" /></h2>
          <p className="mt-0.5 text-xs text-gray-500"><T k="FHIR 읽기 기록 — 클라이언트별·의료진별(감사로그 연계)" /></p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${days === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >{d === 1 ? <T k="24시간" /> : <>{d}<T k="일@단위" /></>}</button>
          ))}
        </div>
      </div>

      {sumIsError ? <QueryErrorFallback error={sumError} onRetry={refetchSum} /> :
       !s ? <EmptyState icon="📊" title="접근 기록을 불러올 수 없습니다" /> :
       s.total === 0 ? <EmptyState icon="📊" title="기간 내 외부 앱 접근이 없습니다" hint="외부 앱이 FHIR 를 읽으면 이 표에 집계됩니다" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-gray-500"><T k="앱별" /> ({s.total}<Unit><T k="건" /></Unit>)</div>
            <div className="space-y-1">
              {s.clients.map((c: any) => (
                <button key={c.clientId} onClick={() => setPick({ clientId: c.clientId })} className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-2.5 py-2 text-left hover:bg-gray-100">
                  <span className="truncate text-xs font-medium text-gray-900">{c.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-500">{c.requests}<Unit><T k="건" /></Unit> · <T k="환자" /> {c.patients}<Unit><T k="명" /></Unit> · {c.lastAt?.slice(5, 10)}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 mb-1.5 text-xs font-semibold text-gray-500"><T k="리소스별" /></div>
            <div className="flex flex-wrap gap-1">
              {s.resources.map((r: any) => (
                <span key={r.resourceType} className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">{r.resourceType} {r.requests}</span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-gray-500"><T k="의료진별(per-user launch)" /></div>
            <div className="space-y-1">
              {s.users.map((u: any) => (
                <button
                  key={u.userId ?? 'system'}
                  onClick={() => u.userId && setPick({ userId: u.userId })}
                  className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-2.5 py-2 text-left hover:bg-gray-100"
                >
                  <span className="truncate text-xs font-medium text-gray-900">
                    {u.systemLevel ? <T k="시스템 단위 접근(사용자 문맥 없음)" /> : `${u.name}${u.department ? ` · ${u.department}` : ''}`}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-500">{u.requests}<Unit><T k="건" /></Unit> · {u.lastAt?.slice(5, 10)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {pick && (
        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-600"><T k="최근 접근 50건" /></div>
            <button onClick={() => setPick(null)} className="rounded bg-gray-100 px-2 py-1 text-[10px]"><T k="닫기" /></button>
          </div>
          {listIsError ? <QueryErrorFallback error={listError} onRetry={refetchList} size="compact" /> :
           rows.length === 0 ? <EmptyState icon="🔍" title="해당 조건의 접근 기록이 없습니다" /> : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-white text-left text-gray-400">
                  <tr><th className="py-1"><T k="시각" /></th><th><T k="앱" /></th><th><T k="의료진" /></th><th><T k="리소스" /></th><th><T k="행위" /></th><th><T k="환자" /></th></tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 whitespace-nowrap text-gray-500">{r.at?.slice(5, 16).replace('T', ' ')}</td>
                      <td className="font-mono text-[10px]">{r.clientId}</td>
                      <td>{r.userName ?? <span className="text-gray-400"><T k="시스템" /></span>}</td>
                      <td className="font-mono text-[10px]">{r.resourceType}</td>
                      <td>{r.action}</td>
                      <td className="font-mono text-[10px] text-gray-400">{r.patientId?.slice(0, 8) ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
