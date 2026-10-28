'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAdminWrite } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

import { EmptyState, KDate, Unit } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { summarizePull, type PullResult } from './pull-summary';

interface Candidate { insuranceCode: string; productName: string; manufacturer?: string; spec?: string; score?: number; }
interface MatchRow {
  hisCode: string;
  name: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  best: (Candidate & { specMatch?: boolean; makerMatch?: boolean }) | null;
  candidates?: Candidate[];
  applied?: boolean;
}

const CONF_STYLE: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-orange-100 text-orange-700',
  NONE: 'bg-gray-100 text-gray-500',
};

/** GET /api/v1/billing/unpriced-codes 응답 — `note`·`truncated` 는 서버가 낸 사실이므로 화면이 그대로 옮긴다 */
interface UnpricedResp {
  note: string;
  summary: {
    medicationsWithoutPrice: number;
    medicationsWithoutPriceButInsuranceListed: number;
    proceduresWithoutPrice: number;
    truncated: boolean;
  };
  medications: { code: string; nameKo: string; insuranceCode: string | null; isActive: boolean }[];
  procedures: { code: string; nameKo: string; insuranceCovered: boolean | null; isActive: boolean }[];
}

interface AltItem { code: string; name: string; note?: string }
// WeRU.B 서버 응답 형태가 유동적이라 방어적으로 대체품/저가약 배열을 추출
function extractAlts(res: unknown): AltItem[] {
  const root = ((res as { data?: unknown })?.data ?? res) as Record<string, unknown> | undefined;
  if (!root) return [];
  const arrs = [root.alternatives, root.cheaper, root.eligible, root.substitutes, root.matches]
    .filter(Array.isArray) as Record<string, unknown>[][];
  const seen = new Set<string>();
  const out: AltItem[] = [];
  for (const a of arrs.flat()) {
    const code = String(a.insuranceCode ?? a.code ?? a.productCode ?? a.standardCode ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      // WeRU.B 응답 필드: drug-substitution=product, drug-master=product_name/상품명
      name: String(a.product ?? a.productName ?? a.product_name ?? a.name ?? a.itemName ?? a.ingredient ?? '').trim(),
      note: [a.manufacturer, a.atc, a.price != null ? `${a.price}원` : null, a.eligible ? '장려금대상' : null].filter(Boolean).join(' · ') || undefined,
    });
  }
  return out;
}

export default function DrugMappingPage() {
  /** 🔴 확정 약가 일괄 반영은 서버가 `@Roles(ADMIN)` — 약사에게는 조회 화면이다 */
  const canPull = useAdminWrite();
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const qc = useQueryClient();
  const [manual, setManual] = useState<Record<string, string>>({});
  const [aiAlts, setAiAlts] = useState<Record<string, AltItem[]>>({});
  /** 마지막 'ERP 확정분 받기' 결과 — 🔴 미반영 건은 사라지는 토스트가 아니라 화면에 남는 목록으로(§23) */
  const [lastPull, setLastPull] = useState<{ at: Date; result: PullResult } | null>(null);

  const aiLookupMut = useMutation({
    mutationFn: async (vars: { hisCode: string; code: string }) => {
      const [sub, master] = await Promise.allSettled([
        apiClient.get(`/api/v1/ai/drug-substitution/${encodeURIComponent(vars.code)}`),
        apiClient.get(`/api/v1/ai/drug-master/${encodeURIComponent(vars.code)}`),
      ]);
      const alts = [
        ...(sub.status === 'fulfilled' ? extractAlts(sub.value) : []),
        ...(master.status === 'fulfilled' ? extractAlts(master.value) : []),
      ];
      return { hisCode: vars.hisCode, alts };
    },
    onSuccess: (res) => {
      setAiAlts((m) => ({ ...m, [res.hisCode]: res.alts }));
      if (res.alts.length > 0) toast.success(`${AI_ORIGIN_TEXT} 대체품/표준코드 ${res.alts.length}건`);
    },
    onError: () => toast.error(`${AI_ORIGIN_TEXT} ${tAttr('대체품 조회 실패(서버 연결 확인)')}`),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['drug-mapping-match'],
    queryFn: () => apiClient.get<{ data: { total: number; applied: number; results: MatchRow[] } }>('/api/v1/billing/drug-mapping/match'),
  });

  /**
   * 🔴 W8-R8 — `GET /api/v1/billing/unpriced-codes` 는 **부르는 화면이 없었다**.
   *   "EP 를 만들면 부르는 화면까지가 한 벌". 보험코드 매핑과 같은 도메인·같은 권한
   *   (ADMIN·ADMIN_STAFF·PHARMACIST)이라 여기에 붙인다.
   *   약가 미등재 = 금액을 **모르는** 상태다 — 0원 청구·"급여 0원" 표시 위험. `note` 를 그대로 옮긴다.
   */
  const { data: unpricedRes, isError: unpricedErr } = useQuery({
    queryKey: ['billing-unpriced-codes'],
    queryFn: () => apiClient.get<{ data: UnpricedResp }>('/api/v1/billing/unpriced-codes?limit=50'),
    staleTime: 300_000,
  });
  const unpricedRaw = unpricedRes?.data as UnpricedResp | { data?: UnpricedResp } | undefined;
  const unpriced: UnpricedResp | undefined =
    unpricedRaw && 'summary' in unpricedRaw ? unpricedRaw : (unpricedRaw as { data?: UnpricedResp })?.data;

  const confirmMut = useMutation({
    mutationFn: (body: { hisCode: string; insuranceCode: string }) => apiClient.post<{ data: { ok: boolean; reason?: string } }>('/api/v1/billing/drug-mapping/confirm', body),
    onSuccess: (res, vars) => {
      if (res.data.ok) { toast.success(`${vars.hisCode} 보험코드 확정`); qc.invalidateQueries({ queryKey: ['drug-mapping-match'] }); }
      else toast.error(res.data.reason === 'INVALID_INSURANCE_CODE' ? tAttr('보험코드 형식 오류(8~13자리 숫자)') : tAttr('확정 실패'));
    },
    onError: () => toast.error(tAttr('확정 실패')),
  });

  const applyMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { applied: number } }>('/api/v1/billing/drug-mapping/match/apply', {}),
    onSuccess: (res) => { toast.success(`HIGH 신뢰도 ${res.data.applied}건 자동 확정`); qc.invalidateQueries({ queryKey: ['drug-mapping-match'] }); },
  });

  /**
   * 🔴 (2026-09-23 · 생태계 인바운드 §23 회수) 종전 토스트는 **반영된 수만** 말했다(`ERP 확정 N건 백필`).
   *    서버가 낸 `notFound` 는 안 읽었고 `rejected` 는 서버가 버렸다 — 분모(`received`)와 미반영 갈래
   *    (형식 거부·키 누락·HIS 미존재)를 함께 말하고, 코드 목록은 아래 패널에 남긴다.
   *    `reason` 이 있으면 "당기지 못한 것"이지 "0건 반영"이 아니다.
   */
  const pullMut = useMutation({
    mutationFn: () => apiClient.post<{ data: PullResult }>('/api/v1/billing/drug-mapping/pull-confirmed', {}),
    onSuccess: (res) => {
      const r = res.data;
      setLastPull({ at: new Date(), result: r });
      qc.invalidateQueries({ queryKey: ['drug-mapping-match'] });
      const s = summarizePull(r);
      if (s.reason) { toast.error(tfAttr('ERP 확정코드를 당기지 못했습니다 ({사유})', { 사유: s.reason })); return; }
      const head = tfAttr('ERP 확정 {반영}/{수신}건 백필', { 반영: s.updated, 수신: s.denom ?? '?' });
      if (s.unapplied === 0) { toast.success(head); return; }
      toast.warning(`${head} · ${tfAttr('미반영 {건수}건 — 형식 거부 {거부} · 키 누락 {누락} · HIS 미존재 {미존재}', { 건수: s.unapplied, 거부: s.rejected, 누락: s.malformed, 미존재: s.notFound })}`);
    },
    onError: () => toast.error(tAttr('ERP 확정분 받기 실패')),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const d = data?.data;
  const rows = d?.results ?? [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="약품 보험코드 매핑 (약제팀)" /></h1>
          <p className="text-sm text-gray-500"><T k="미채움 약품의 HIRA 약가마스터 후보를 확정합니다. 실제 원내 재고 제품을 선택하세요." /></p>
        </div>
        <div className="flex gap-2">
          {canPull && <button onClick={() => pullMut.mutate()} disabled={pullMut.isPending}
            className="min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium hover:bg-gray-50"><T k="ERP 확정분 받기" /></button>}
          <button onClick={() => applyMut.mutate()} disabled={applyMut.isPending}
            className="min-h-[44px] px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">HIGH <T k="자동확정" /></button>
        </div>
      </div>

      {/* 🔴 §23 — 마지막 'ERP 확정분 받기' 결과. 미반영 건(형식 거부·키 누락·HIS 미존재)은 토스트로 사라지지 않고 여기 남는다 */}
      {lastPull && (() => {
        const s = summarizePull(lastPull.result);
        const r = lastPull.result;
        const buckets: { key: string; label: ReactNode; items: string[] }[] = [
          { key: 'rejected', label: <T k="형식 거부 (보험코드가 8~13자리 숫자가 아님)" />, items: r.rejected ?? [] },
          { key: 'malformed', label: <T k="키 누락 (ERP 행에 HIS 코드 또는 보험코드가 비어 있음)" />, items: r.malformed ?? [] },
          { key: 'notFound', label: <T k="HIS 미존재 (그 HIS 코드의 약품이 없음)" />, items: r.notFound ?? [] },
        ];
        return (
          <div className={`rounded-xl border p-4 text-xs space-y-2 ${s.reason ? 'border-red-200 bg-red-50' : s.unapplied > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`} data-testid="pull-result">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900"><T k="ERP 확정분 받기 결과" /></h2>
              <span className="text-[11px] text-gray-500"><KDate value={lastPull.at} mode="datetime" /></span>
            </div>
            {s.reason ? (
              <p className="text-red-700"><Tf k="ERP 확정코드를 당기지 못했습니다 ({사유})" params={{ 사유: <code>{s.reason}</code> }} /></p>
            ) : (
              <>
                <p className="text-gray-800">
                  <Tf k="ERP 확정 {반영}/{수신}건 백필" params={{ 반영: <b>{s.updated}</b>, 수신: s.denom ?? '?' }} />
                  {s.unapplied > 0
                    ? <> · <Tf className="text-amber-800 font-medium" k="미반영 {건수}건 — 형식 거부 {거부} · 키 누락 {누락} · HIS 미존재 {미존재}" params={{ 건수: s.unapplied, 거부: s.rejected, 누락: s.malformed, 미존재: s.notFound }} /></>
                    : <> · <T k="미반영 없음" /></>}
                </p>
                {s.unapplied > 0 && (
                  <p className="text-[11px] text-amber-800"><T k="미반영 건은 HIS 가 고치지 않습니다 — ERP 에서 정정한 뒤 다시 받으세요." /></p>
                )}
                {buckets.filter((b) => b.items.length > 0).map((b) => (
                  <details key={b.key} className="bg-white rounded-lg px-3 py-2" data-testid={`pull-${b.key}`}>
                    <summary className="cursor-pointer font-medium text-gray-800">{b.label} ({b.items.length}<Unit><T k="건" /></Unit>)</summary>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {b.items.map((c) => <code key={c} className="font-mono text-[10px] bg-gray-100 rounded px-1 py-0.5">{c}</code>)}
                    </div>
                  </details>
                ))}
              </>
            )}
          </div>
        );
      })()}

      {/* 약가·수가 미등재 — 서버 /api/v1/billing/unpriced-codes 를 부르는 첫 화면(W8-R8) */}
      {unpricedErr ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <T k="약가 미등재 현황 조회 실패" /> — <b><T k="0건이 아니라 확인 불가" /></b><T k="입니다." />
        </div>
      ) : unpriced ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-amber-900"><T k="약가 · 수가 미등재" /></h2>
            <span className="text-[11px] text-amber-700"><T k="금액을" /> <b><T k="모르는" /></b> <T k="상태 — 0원 아님" /></span>
          </div>
          <p className="text-[11px] text-amber-800">{unpriced.note}</p>
          {/* 🔴 가운데 라벨(`급여코드有·약가無 (0원 청구 위험)`)만 2줄이라 양옆이 위로 쏠렸다 */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="flex flex-col justify-center bg-white rounded-lg py-2">
              <p className="text-lg font-bold text-amber-700">{unpriced.summary.medicationsWithoutPrice.toLocaleString()}</p>
              <p className="text-[10px] text-gray-500"><T k="약가 미등재 약품" /></p>
            </div>
            {/* 급여코드는 있는데 약가가 없는 것 = 0원 청구 위험 — 가장 급한 축이라 따로 센다 */}
            <div className="flex flex-col justify-center bg-white rounded-lg py-2">
              <p className="text-lg font-bold text-rose-600">{unpriced.summary.medicationsWithoutPriceButInsuranceListed.toLocaleString()}</p>
              <p className="text-[10px] text-gray-500"><T k="급여코드有·약가無 (0원 청구 위험)" /></p>
            </div>
            <div className="flex flex-col justify-center bg-white rounded-lg py-2">
              <p className="text-lg font-bold text-amber-700">{unpriced.summary.proceduresWithoutPrice.toLocaleString()}</p>
              <p className="text-[10px] text-gray-500"><T k="수가 미등재 행위" /></p>
            </div>
          </div>
          {/* 🔴 잘랐으면 잘랐다고 말한다 — 목록이 조용히 끊기면 "이게 전부"로 읽힌다 */}
          {unpriced.summary.truncated && (
            <p className="text-[11px] text-amber-700">
              목록은 상위 일부만 표시됩니다(전체 {(unpriced.summary.medicationsWithoutPrice + unpriced.summary.proceduresWithoutPrice).toLocaleString()}건 중 {(unpriced.medications.length + unpriced.procedures.length).toLocaleString()}건).
            </p>
          )}
          {unpriced.medications.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-800 font-medium"><T k="약가 미등재 약품 보기" /> ({unpriced.medications.length}<Unit><T k="건" /></Unit>)</summary>
              <div className="mt-2 space-y-0.5 max-h-56 overflow-y-auto">
                {unpriced.medications.map((m) => (
                  <div key={m.code} className="flex items-center gap-2 bg-white rounded px-2 py-1">
                    <span className="font-mono text-[10px] text-gray-400 w-24 shrink-0">{m.code}</span>
                    <span className="text-gray-800 truncate">{m.nameKo}</span>
                    {m.insuranceCode && <span className="ml-auto text-[10px] text-rose-600 font-semibold shrink-0"><T k="급여" /> {m.insuranceCode}</span>}
                    {!m.isActive && <span className="text-[10px] text-gray-400 shrink-0"><T k="비활성" /></span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : (
        <>
          <div className="text-sm text-gray-600"><T k="미채움" /> <strong>{rows.length}</strong><Unit><T k="건" /></Unit> (<T k="이번 매칭 자동적용" /> {d?.applied ?? 0}<Unit><T k="건" /></Unit>). <T k="혈액제제는 혈액수가 체계로 보험코드 없음이 정상입니다." /></div>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.hisCode} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-xs text-gray-400">{r.hisCode}</span>
                  <span className="font-semibold text-gray-900">{r.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${CONF_STYLE[r.confidence]}`}>{r.confidence}</span>
                </div>
                {(r.candidates ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400"><T k="후보 없음 (비급여 또는 혈액수가 — 보험코드 미해당 가능)" /></p>
                ) : (
                  <div className="space-y-1">
                    {(r.candidates ?? []).map((c) => (
                      <div key={c.insuranceCode} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-1.5">
                        <div className="min-w-0">
                          <span className="font-mono text-xs text-blue-600 mr-2">{c.insuranceCode}</span>
                          <span className="text-gray-800">{c.productName}</span>
                          <span className="text-xs text-gray-400 ml-1">{c.manufacturer} {c.spec}</span>
                        </div>
                        <button onClick={() => confirmMut.mutate({ hisCode: r.hisCode, insuranceCode: c.insuranceCode })}
                          disabled={confirmMut.isPending}
                          className="ml-2 min-h-[44px] px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 whitespace-nowrap"><T k="확정" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <input value={manual[r.hisCode] ?? ''} onChange={(e) => setManual({ ...manual, [r.hisCode]: e.target.value })}
                    placeholder={tAttr('보험코드 직접입력(9자리)')} className="border border-gray-300 rounded-md px-2 py-1 text-xs w-44" />
                  <button onClick={() => manual[r.hisCode] && confirmMut.mutate({ hisCode: r.hisCode, insuranceCode: manual[r.hisCode] })}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-md border border-gray-300 hover:bg-gray-50"><T k="직접 확정" /></button>
                  {(() => {
                    const refCode = (manual[r.hisCode] || r.candidates?.[0]?.insuranceCode || '').trim();
                    return (
                      <button
                        onClick={() => refCode && aiLookupMut.mutate({ hisCode: r.hisCode, code: refCode })}
                        disabled={!refCode || aiLookupMut.isPending}
                        title={`${tAttr('참조 보험코드로 생동성 대체품·동일성분 저가약·표준코드를')} ${AI_ORIGIN_TEXT} ${tAttr('약가마스터에서 조회(제네릭 보류건)')}`}
                        className="px-2 py-1 rounded-md border border-violet-300 text-violet-700 text-xs hover:bg-violet-50 disabled:opacity-40">
                        {AI_ORIGIN_TEXT} <T k="대체품 조회" />
                      </button>
                    );
                  })()}
                </div>
                {aiAlts[r.hisCode] && (
                  <div className="mt-2 border-t border-dashed border-violet-200 pt-2">
                    <p className="text-[11px] text-violet-600 font-medium mb-1">{AI_ORIGIN_TEXT} <T k="대체품·표준코드" /> ({aiAlts[r.hisCode].length}<Unit><T k="건" /></Unit>)</p>
                    {aiAlts[r.hisCode].length === 0 ? (
                      <p className="text-xs text-gray-400"><T k="결과 없음" /></p>
                    ) : (
                      <div className="space-y-1">
                        {aiAlts[r.hisCode].map((a) => (
                          <div key={a.code} className="flex items-center justify-between text-sm border border-violet-100 bg-violet-50/40 rounded-lg px-3 py-1.5">
                            <div className="min-w-0">
                              <span className="font-mono text-xs text-violet-700 mr-2">{a.code}</span>
                              <span className="text-gray-800">{a.name || tAttr('(명칭없음)')}</span>
                              {a.note && <span className="text-xs text-gray-400 ml-1">{a.note}</span>}
                            </div>
                            <button onClick={() => confirmMut.mutate({ hisCode: r.hisCode, insuranceCode: a.code })}
                              disabled={confirmMut.isPending}
                              className="ml-2 min-h-[44px] px-3 py-2 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 whitespace-nowrap"><T k="확정" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {rows.length === 0 && <EmptyState icon="💊" title="미채움 약품이 없습니다." />}
          </div>
        </>
      )}
    </div>
  );
}
