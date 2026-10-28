'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { kstToday } from '@/lib/kst-today';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { CONFIG_SOURCE_TEXT, HIS_MODE_META, type ConfigSource, type HisMode } from '@hospital-run/shared';

interface ConfigEntry { key: string; value: unknown; source?: ConfigSource }

/** 🔴 이 화면이 읽고 쓰는 키 정본 — 요약과 저장이 서로 다른 목록을 보면 갈라진다 */
const ERP_CONFIG_KEYS = [
  'erp.enabled', 'erp.url', 'erp.ssoPath', 'erp.handoff',
  'erp.webhookEnabled', 'erp.webhookUrl', 'erp.integrationKey',
] as const;
interface OutboxStats {
  byStatus: Record<string, number>;
  byDomain: { domain: string; status: string; count: number }[];
  liveness?: { event: string; count: number; lastSentAt: string | null; staleDays: number | null }[];
  failed: { id: string; domain: string; event: string; ref: string; attempts: number; lastError?: string; createdAt: string }[];
  /**
   * 🔴 서버(`integration-outbox.service.ts adminStats()`)가 **함께 내려주는 보류 사실** — 2026-09-23 까지 이 타입이 두 필드를
   *    빠뜨려 리허설에서 보류된 PENDING 이 화면에선 그냥 "밀려 있음"으로 읽혔다.
   *    구 서버라 없으면 **모른다**로 두고 그리지 않는다(없음을 "보류 아님"으로 번역하지 않는다).
   */
  mode?: HisMode;
  outboundHeldByMode?: boolean;
}
interface Coverage { domain: string; mapped: number; total: number }

/**
 * 기준 주소에 경로가 들어 있는가 — 서버 코드가 그 뒤에 `/api/v1/…` 를 붙인다
 * (아웃박스 `/api/v1/integrations/his/<도메인>/webhook` · ESS `/api/v1/integration/hr/*` · 청구 `/api/v1/integration/billing/invoice`).
 * URL 로 읽히지 않으면 모른다(false) — 경고를 지어내지 않는다. 막지도 않는다(리버스 프록시 접두어일 수 있다).
 */
function webhookBaseHasPath(u: string): boolean {
  try { return new URL(u).pathname.replace(/\/+$/, '') !== ''; } catch { return false; }
}

export default function ErpSettingsPage() {
  const tAttr = useTAttr();
  const [enabled, setEnabled] = useState(true);
  const [url, setUrl] = useState('/erp');
  const [ssoPath, setSsoPath] = useState('/api/v1/auth/sso/his');
  const [handoff, setHandoff] = useState<'token' | 'cookie'>('token');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [integrationKey, setIntegrationKey] = useState('');
  const [loading, setLoading] = useState(true);
  // 🔴 조회 실패를 조용히 삼키면 화면의 **초기값**이 실제 설정인 척한다 — 그대로 저장하면 실 설정을 덮는다
  //    (이 저장소가 접근정책 화면에서 이미 겪은 모양이다). 실패는 말하고, 저장은 막는다.
  const [loadFailed, setLoadFailed] = useState(false);
  /** 각 키의 출처 — 서버가 말해준다(`meta`/`source`). 모르면 넣지 않는다(지어내지 않는다) */
  const [sources, setSources] = useState<Record<string, ConfigSource>>({});
  const [testResult, setTestResult] = useState('');
  const [outbox, setOutbox] = useState<OutboxStats | null>(null);
  const [coverage, setCoverage] = useState<Coverage[]>([]);

  const loadMonitor = () => {
    apiClient.get<{ data: OutboxStats }>('/api/v1/integration/admin/outbox').then(r => setOutbox(r.data)).catch(() => {});
    apiClient.get<{ data: Coverage[] }>('/api/v1/integration/admin/mapping-coverage').then(r => setCoverage(r.data ?? [])).catch(() => {});
  };
  useEffect(() => { loadMonitor(); const t = setInterval(loadMonitor, 20000); return () => clearInterval(t); }, []);
  const retryFailed = async () => { await apiClient.post('/api/v1/integration/admin/outbox/retry', {}).catch(() => {}); toast.success(tAttr('실패 건 재시도 큐잉')); loadMonitor(); };
  const exportMapping = async () => {
    try {
      const r = await apiClient.get<{ data: { domain: string; his_code: string; his_name: string; attr: string; erp_code: string }[] }>('/api/v1/integration/admin/mapping-export');
      const rows = r.data ?? [];
      const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['domain,his_code,his_name,attr,erp_code', ...rows.map(x => [x.domain, x.his_code, x.his_name, x.attr, x.erp_code].map(esc).join(','))].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `erp-mapping-${kstToday()}.csv`; a.click();
      toast.success(`${tAttr('매핑표')} ${rows.length}${tAttr('행 내려받기')}`);
    } catch { toast.error(tAttr('export 실패')); }
  };

  const loadConfig = () => {
    setLoadFailed(false);
    setLoading(true);
    apiClient.get<{ data: ConfigEntry[] }>('/api/v1/config?category=integration').then((r) => {
      const entries = r.data ?? [];
      setSources(Object.fromEntries(entries.filter((c) => c.source).map((c) => [c.key, c.source as ConfigSource])));
      const m = new Map(entries.map((c) => [c.key, c.value]));
      if (m.has('erp.enabled')) setEnabled(m.get('erp.enabled') !== false);
      if (m.get('erp.url')) setUrl(m.get('erp.url') as string);
      if (m.get('erp.ssoPath')) setSsoPath(m.get('erp.ssoPath') as string);
      if (m.get('erp.handoff')) setHandoff(m.get('erp.handoff') as 'token' | 'cookie');
      if (m.has('erp.webhookEnabled')) setWebhookEnabled(m.get('erp.webhookEnabled') === true);
      if (m.get('erp.webhookUrl')) setWebhookUrl(m.get('erp.webhookUrl') as string);
      if (m.get('erp.integrationKey')) setIntegrationKey(m.get('erp.integrationKey') as string);
    }).catch(() => setLoadFailed(true)).finally(() => setLoading(false));
  };
  useEffect(() => { loadConfig(); }, []);

  const save = async () => {
    // 🔴 무엇이 저장돼 있는지 모르는 채로 덮어쓰지 않는다 — **막되, 왜 막는지 말한다.**
    //    버튼을 비활성으로만 두면 이유가 전달되지 않고, 게이트가 실제로 도는지도 확인할 수 없다.
    if (loadFailed) { toast.error(tAttr('현재 설정을 불러오지 못해 저장할 수 없습니다 — 다시 시도한 뒤 저장하세요.')); return; }
    try {
      await Promise.all([
        apiClient.put('/api/v1/config/erp.enabled', { value: enabled }),
        apiClient.put('/api/v1/config/erp.url', { value: url.trim() }),
        apiClient.put('/api/v1/config/erp.ssoPath', { value: ssoPath.trim() }),
        apiClient.put('/api/v1/config/erp.handoff', { value: handoff }),
        apiClient.put('/api/v1/config/erp.webhookEnabled', { value: webhookEnabled }),
        apiClient.put('/api/v1/config/erp.webhookUrl', { value: webhookUrl.trim() }),
        apiClient.put('/api/v1/config/erp.integrationKey', { value: integrationKey.trim() }),
      ]);
      toast.success(tAttr('ERP 설정이 저장되었습니다.'));
    } catch (e) { toast.error((e as { message?: string })?.message ?? tAttr('저장 실패')); }
  };

  // 연결 테스트 — SSO 수신 경로에 잘못된 토큰 → 401(도달) 기대
  const test = async () => {
    setTestResult(tAttr('테스트 중...'));
    try {
      const res = await fetch(`${url.trim()}${ssoPath.trim()}?token=__test__`, { method: 'GET', redirect: 'manual' });
      // 401(인증 거부) 또는 302/opaqueredirect = ERP 도달 성공
      if (res.status === 401 || res.status === 302 || res.type === 'opaqueredirect' || res.status === 0) {
        setTestResult(`✅ ${tAttr('ERP 도달 성공')} (${tAttr('응답')} ${res.status || 'redirect'}) — ${tAttr('SSO 수신 정상')}`);
      } else if (res.status === 404) {
        setTestResult(`❌ ${tAttr('404 — 경로/프록시 확인 필요 (nginx /erp 라우트, ERP 기동)')}`);
      } else {
        setTestResult(`⚠️ ${tAttr('응답')} ${res.status} — ${tAttr('경로/ERP 상태 확인')}`);
      }
    } catch (e) {
      setTestResult(`❌ ${tAttr('연결 실패')}: ${(e as Error).message} (${tAttr('CORS/네트워크/프록시 확인')})`);
    }
  };

  // 🔴 서버가 출처를 말해주지 않은 키는 세지 않는다 — 모르는 것을 '기본값'으로 단정하지 않는다
  const defaultBackedKeys = ERP_CONFIG_KEYS.filter((k) => sources[k] === 'default');

  if (loading) return <div className="p-6 text-sm text-gray-400"><T k="불러오는 중..." /></div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-1">ERP <T k="접근 설정" /></h1>
      <p className="text-sm text-gray-500 mb-5"><T k="사이드바 ERP 바로가기(SSO 자동 로그인)의 활성화·주소·접근 역할을 설정합니다." /></p>

      {loadFailed && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start justify-between gap-3">
          <span><T k="현재 설정을 불러오지 못했습니다 — 저장하면 화면의 초기값이 실제 설정을 덮어씁니다." /></span>
          <button type="button" onClick={loadConfig} className="shrink-0 px-3 py-1.5 rounded-lg bg-white border border-red-200 text-xs font-semibold text-red-700"><T k="다시 시도" /></button>
        </div>
      )}

      {/* 🔴 "설정돼 있다"와 "아무도 정한 적 없다"는 다른 사실이다 — 분모를 함께 적는다(막지는 않는다) */}
      {!loadFailed && defaultBackedKeys.length > 0 && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <span className="font-medium"><T k="아직 아무도 정한 적 없는 값(코드 기본값)" /></span>
          <span className="ml-1 text-gray-400">{defaultBackedKeys.length} / {ERP_CONFIG_KEYS.length}</span>
          <div className="mt-1 font-mono text-[11px] text-gray-500">{defaultBackedKeys.join(' · ')}</div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
        {/* 활성화 */}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-gray-800">ERP <T k="바로가기 활성화" /></span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ERP <T k="접근 URL" /></label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tAttr('/erp 또는 https://erp.example.com')}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
          <p className="text-[11px] text-gray-400 mt-1"><T k="동일 호스트는 상대경로" />(<code>/erp</code>) <T k="권장 — 쿠키/SameSite 문제 없음. 외부면 전체 URL." /></p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">SSO <T k="전달 방식" /></label>
          <div className="flex gap-2">
            {([['token', 'URL 토큰 전달'], ['cookie', '동일호스트 쿠키(권장·안전)']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setHandoff(v)}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium ${handoff === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k={l} /></button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1"><T k={handoff === 'cookie' ? 'HIS가 /erp 스코프 단기 httpOnly 쿠키(his_sso)를 발급 → ERP가 읽음. URL에 토큰 노출 없음. (ERP 측 쿠키 수신 지원 필요)' : 'URL ?token= 으로 전달(기존). ERP 리시버 GET 수신.'} /></p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">SSO <T k="수신 경로" /> {handoff === 'cookie' && <span className="text-gray-400">(<T k="token 방식에만 사용" />)</span>}</label>
          <input value={ssoPath} onChange={(e) => setSsoPath(e.target.value)} placeholder="/api/v1/auth/sso/his"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2"><T k="접근 허용 역할" /></label>
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-xs text-gray-500">
            <T k="접근 허용 역할은" /> <a href="/admin/access-control" className="text-blue-600 underline font-medium"><T k="접근 권한 관리 → 외부 시스템 접근" /></a> <T k="탭에서 일원화 관리합니다. (같은 설정이라 자동 동기화)" />
          </div>
        </div>

        {/* 재고 연동 (CSSD ↔ ERP) */}
        <div className="pt-4 mt-2 border-t border-gray-100">
          <h3 className="text-sm font-bold text-gray-800 mb-1"><T k="재고 연동 (CSSD ↔ ERP)" /></h3>
          <p className="text-xs text-gray-400 mb-3"><T k="ERP가 입고를 HIS로 전송(인바운드 키)하고, HIS 재고 변동을 ERP 웹훅으로 통보합니다." /></p>
          <label className="block text-xs font-medium text-gray-500 mb-1"><T k="연동 키 (인바운드 입고 API 인증)" /></label>
          <input value={integrationKey} onChange={(e) => setIntegrationKey(e.target.value)} placeholder={tAttr('강한 임의 키')} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-3 font-mono" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500"><T k="재고 변동 웹훅 전송" /></span>
            <button type="button" role="switch" aria-checked={webhookEnabled} onClick={() => setWebhookEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${webhookEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${webhookEnabled ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
            </button>
          </div>
          <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://erp.example" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          <p className="text-[11px] text-gray-400 mt-1"><T k="기준 주소는 호스트까지만 적습니다 — 경로는 코드가 붙입니다 (아웃박스 /api/v1/integrations/his/<도메인>/webhook · ESS /api/v1/integration/hr/… · 청구 /api/v1/integration/billing/invoice)" /></p>
          {webhookUrl && webhookBaseHasPath(webhookUrl) && (
            <p data-testid="webhook-base-path-warning" className="text-[11px] text-amber-700 mt-1">⚠ <T k="주소에 경로가 들어 있습니다 — 코드가 그 뒤에 /api/v1/… 를 붙이므로, 리버스 프록시 접두어가 아니라면 호스트까지만 적으세요." /></p>
          )}
          <p className="text-[11px] text-gray-400 mt-2">ERP <T k="인바운드" />: <span className="font-mono">POST /api/v1/integration/cssd/supply</span> (<T k="헤더" /> X-Integration-Key) · <T k="읽기" />: <span className="font-mono">GET /api/v1/integration/cssd/stock</span></p>
        </div>

        {/* 연동 모니터 */}
        <div className="pt-4 mt-2 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-800"><T k="연동 모니터 (outbox)" /></h3>
            <div className="flex gap-2 text-xs">
              {outbox && Object.entries(outbox.byStatus).map(([s, n]) => (
                <span key={s} className={`px-2 py-1 rounded-full ${s === 'SENT' ? 'bg-emerald-50 text-emerald-700' : s === 'FAILED' ? 'bg-red-50 text-red-700' : s === 'CANCELLED' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`} title={s === 'CANCELLED' ? tAttr('발송 직전 확인에서 보내지 않기로 한 건(예: 결재 결과가 바뀌었거나 이미 전달됨) — 실패가 아니다') : undefined}>{s} {n}</span>
              ))}
              {!!outbox?.failed.length && <button onClick={retryFailed} className="px-2 py-1 rounded-lg bg-red-600 text-white"><T k="실패 재시도" /></button>}
            </div>
          </div>
          {/* 🔴 리허설·개발 모드의 PENDING 은 "밀린 것"이 아니라 "보내지 않은 것"이다 — 서버가 말해주는 사실(outboundHeldByMode)을 그대로 그린다.
              mode 가 없으면(구 서버) 모른다 — 그리지 않는다. PENDING 수는 서버 groupBy 전수라 키가 없으면 진짜 0 이다. */}
          {outbox?.outboundHeldByMode && outbox.mode && (
            <div data-testid="outbox-held-by-mode" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
              {/* 자리표시자 이름이 ASCII 인 이유 — 미배선 스캐너(i18n-unwired-scan)의 이 파일 기준선이 5 로 정확 동결돼 있고,
                  이 파일에서는 스캐너의 큰따옴표 짝이 63행 템플릿 리터럴부터 어긋나 있어 여기 한글 식별자(`모드:`)가 잔여로 세어진다(선례 `{n}`·`{LOT}`). */}
              <Tf k="{mode} 모드 — 대외 발송 보류 중: PENDING {count}건은 밀린 것이 아니라 보내지 않은 것입니다. 실운영으로 전환하면 그대로 나갑니다(보낼지 버릴지는 결정 등록부 ops.rehearsalOutboxAtCutover)." params={{ mode: tAttr(HIS_MODE_META[outbox.mode]?.label ?? outbox.mode), count: outbox.byStatus.PENDING ?? 0 }} />
            </div>
          )}
          {!!outbox?.byDomain.length && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {outbox.byDomain.map((d, i) => <span key={i} className="text-[11px] bg-gray-50 border border-gray-100 px-2 py-0.5 rounded text-gray-600">{d.domain}·{d.status} {d.count}</span>)}
            </div>
          )}
          {!!outbox?.liveness?.length && (
            <div className="mb-2">
              <p className="text-[11px] font-medium text-gray-500 mb-1"><T k="이벤트별 마지막 발송 (경과일 — 오래된 순)" /></p>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                {outbox.liveness.map((e) => (
                  <div key={e.event} className="flex items-center justify-between px-2 py-1 text-[11px]">
                    <span className="font-mono text-gray-600">{e.event}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-gray-400">{e.lastSentAt ? String(e.lastSentAt).slice(0, 10) : '-'}</span>
                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                        e.staleDays == null ? 'bg-gray-100 text-gray-500'
                        : e.staleDays >= 30 ? 'bg-amber-100 text-amber-700'
                        : e.staleDays >= 7 ? 'bg-sky-50 text-sky-600'
                        : 'bg-emerald-50 text-emerald-600'
                      }`}>{e.staleDays == null ? '-' : <>{e.staleDays}<T k="일@단위" /></>}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1"><T k="저빈도 이벤트는 경과일이 커도 정상일 수 있습니다(ERP 라이브니스 회신 2026-07). 색은 참고용." /></p>
            </div>
          )}
          {!!outbox?.failed.length && (
            <div className="bg-red-50/50 rounded-lg p-2 text-[11px] text-red-700 max-h-28 overflow-y-auto">
              {outbox.failed.map(f => <div key={f.id}>⚠ {f.domain}/{f.event} ({f.attempts}<Unit>회</Unit>) — {f.lastError}</div>)}
            </div>
          )}
          {(!outbox || (!outbox.byDomain.length && !Object.keys(outbox.byStatus).length)) && <p className="text-xs text-gray-400"><T k="전송 내역 없음 (웹훅 미설정 또는 변동 없음)" /></p>}
        </div>

        {/* 매핑 현황 */}
        <div className="pt-4 mt-2 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-gray-800">ERP <T k="코드 매핑 현황" /></h3>
            <button onClick={exportMapping} className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-white">📥 <T k="매핑표" /> CSV</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {coverage.map(c => {
              const pct = c.total ? Math.round((c.mapped / c.total) * 100) : 0;
              return (
                <div key={c.domain} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className={`text-lg font-bold ${pct === 100 ? 'text-emerald-600' : pct > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{c.mapped}/{c.total}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{c.domain}</div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-2"><T k="ERP가 코드 회신(매핑 API) 시 자동 증가. 100% 목표." /></p>
        </div>

        <div className="flex items-center gap-2 pt-4 mt-2 border-t border-gray-100">
          <button onClick={save} aria-disabled={loadFailed} className={`px-4 py-2 rounded-xl text-white text-sm font-semibold ${loadFailed ? 'bg-gray-300' : 'bg-blue-600 hover:bg-blue-700'}`}><T k="저장" /></button>
          <button onClick={test} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"><T k="연결 테스트" /></button>
          {testResult && <span className="text-xs text-gray-600 ml-1">{testResult}</span>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-4">ⓘ <T k="ERP는 별도 시스템입니다. SSO는 HIS 로그인 토큰을 ERP 수신 경로로 전달해 자동 로그인합니다. 외부 노출" />(nginx <code>/erp</code>)<T k="·ERP 기동이 선행되어야 합니다." /></p>
    </div>
  );
}
