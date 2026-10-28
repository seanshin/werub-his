'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AiMappingSuggestionPanel } from './auto-mapping-dashboard';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface TerminologyMapping {
  id: string;
  sourceTable: string;
  sourceId: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  targetDisplay: string;
  equivalence: string;
  mapSource: string;
  confidence: number | null;
  isActive: boolean;
  createdAt: string;
}

interface NursingCode {
  id: string;
  codeSystem: string;
  code: string;
  nameKo: string;
  nameEn: string;
  domain: string;
}

const SYS_COLOR: Record<string, string> = {
  SNOMED_CT: 'bg-blue-100 text-blue-700',
  LOINC: 'bg-emerald-100 text-emerald-700',
  ICD10PCS: 'bg-violet-100 text-violet-700',
  MedDRA: 'bg-rose-100 text-rose-700',
  ICF: 'bg-amber-100 text-amber-700',
  ICD_10: 'bg-teal-100 text-teal-700',
  ICD_11: 'bg-indigo-100 text-indigo-700',
};

/**
 * 등가 라벨 — 값은 **i18n 키**다(`@매핑` 문맥 — 무문맥 '포함' 은 다른 화면에서 'included' 로 이미 쓰인다).
 * 표시 원문은 `@` 앞부분이라 한국어 화면은 종전과 글자 단위로 같다. option value(저장값)는 영문 코드 그대로.
 */
const EQ_LABEL: Record<string, string> = {
  equivalent: '동등@매핑',
  wider: '포함@매핑',
  narrower: '포함됨@매핑',
  relatedto: '관련@매핑',
  inexact: '부정확@매핑',
};

/** 매핑 출처 라벨 — 값은 i18n 키. AI 표기는 자리표시자 `{AI표기}` 로 넣는다(AI기본법 §31 표기는 번역하지 않는다) */
const SOURCE_LABEL: Record<string, string> = {
  OFFICIAL: '공식',
  AI_AUTO: '{AI표기} 자동',
  AI_REVIEWED: '{AI표기} 검토',
  MANUAL: '수동',
  RULE_OFFICIAL: '규칙',
};

interface CodeDetailPanelProps {
  sourceTable: string;
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  onClose: () => void;
}

export default function CodeDetailPanel({ sourceTable, sourceId, sourceCode, sourceName, onClose }: CodeDetailPanelProps) {
  const qc = useQueryClient();
  const [detailTab, setDetailTab] = useState<'mappings' | 'nursing' | 'history'>('mappings');
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [newMapping, setNewMapping] = useState({ targetSystem: 'SNOMED_CT', targetCode: '', targetDisplay: '', equivalence: 'equivalent' });
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  /** 모르는 코드값은 그대로 보인다(지어내지 않는다) */
  const eqText = (v: string) => (EQ_LABEL[v] ? tAttr(EQ_LABEL[v]) : v);
  const sourceText = (v: string) => (SOURCE_LABEL[v] ? tfAttr(SOURCE_LABEL[v], { AI표기: AI_ORIGIN_TEXT }) : v);

  /**
   * 이 코드가 **어디에 쓰이고 있는가** — 실무에서 가장 먼저 묻는 것이고,
   * 코드를 중지·개정하기 전에 반드시 봐야 하는 값이다(2026-08-26 · C1).
   * 🔴 참조 목록은 서버가 Prisma 메타데이터에서 뽑는다 — 손으로 적으면 빠진다.
   */
  const usageTable = sourceTable.replace(/_codes$/, '');
  const { data: usageData, isError: usageError } = useQuery<{
    data: { total: number | null; countedRefs: number; totalRefs: number; safeToDeactivate: boolean; refs: { label: string; count: number | null; error?: string }[] };
  }>({
    queryKey: ['code-usage', usageTable, sourceId],
    queryFn: () => apiClient.get(`/api/v1/codes/${usageTable}/${sourceId}/usage`),
    staleTime: 60_000,
  });
  const usage = usageData?.data;

  // Fetch mappings for this code
  const { data: mappingsData, isLoading } = useQuery<{ data: TerminologyMapping[] }>({
    queryKey: ['code-mappings', sourceTable, sourceId],
    queryFn: () => apiClient.get(`/api/v1/codes/mappings/${sourceTable}/${sourceId}`),
  });

  // Fetch related nursing codes
  const { data: nursingData } = useQuery<{ data: NursingCode[] }>({
    queryKey: ['nursing-codes', sourceCode],
    queryFn: () => apiClient.get(`/api/v1/codes/nursing?q=${encodeURIComponent(sourceName)}`),
    enabled: detailTab === 'nursing',
  });

  // Auto map mutation
  const autoMapMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/codes/auto-map', {
      // 🔴 해당하지 않는 표준까지 물으면 "해당 없음"이 갭처럼 쌓인다 — 서버가 NOT_APPLICABLE 로 걸러도
      //    애초에 묻지 않는 것이 정직하다.
      // 🔴 확정하지 않는다(2026-09-09 R8·형제 화면과 같은 결정) — 검토 대기로만 쌓는다.
      //    서버는 `autoConfirm` 이 없으면 true 로 읽으므로(`?? true`) **명시적으로 false** 를 보낸다.
      sourceTable, sourceId, targetSystems: ['SNOMED_CT', 'LOINC', 'MedDRA'], autoConfirm: false,
    }),
    onSuccess: () => { toast.success(tfAttr('{AI표기} 제안을 검토 대기로 보냈습니다 — 확정은 매핑 검토 화면에서 건별 승인', { AI표기: AI_ORIGIN_TEXT })); qc.invalidateQueries({ queryKey: ['code-mappings'] }); qc.invalidateQueries({ queryKey: ['pending-mappings'] }); },
    onError: () => toast.error(tAttr('검토 대기 적재 실패')),
  });

  // Add mapping mutation
  const addMappingMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/codes/mappings', {
      sourceTable, sourceId, sourceCode, ...newMapping,
    }),
    onSuccess: () => {
      toast.success(tAttr('매핑 추가 완료'));
      qc.invalidateQueries({ queryKey: ['code-mappings'] });
      setShowAddMapping(false);
      setNewMapping({ targetSystem: 'SNOMED_CT', targetCode: '', targetDisplay: '', equivalence: 'equivalent' });
    },
    onError: () => toast.error(tAttr('매핑 추가 실패')),
  });

  const mappings = mappingsData?.data ?? [];
  const nursingCodes = nursingData?.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold text-gray-900">{sourceCode}</span>
                <span className="text-sm text-gray-600">{sourceName}</span>
              </div>
              <span className="text-[10px] text-gray-400">{sourceTable}</span>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Detail Tabs */}
          <div className="flex gap-1 mt-3">
            {([
              { key: 'mappings', label: '표준 매핑' },
              { key: 'nursing', label: '관련 간호진단' },
              { key: 'history', label: '매핑 이력' },
            ] as { key: typeof detailTab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setDetailTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  detailTab === t.key ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                }`}><T k={t.label} /></button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {detailTab === 'mappings' && (
            <>
              {/* Existing Mappings */}
              {isLoading ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
              ) : mappings.length > 0 ? (
                <div className="space-y-2">
                  {mappings.map(m => (
                    <div key={m.id} className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SYS_COLOR[m.targetSystem] ?? 'bg-gray-100 text-gray-600'}`}>
                            {m.targetSystem.replace('_', ' ')}
                          </span>
                          <span className="font-mono text-sm font-medium text-gray-800">{m.targetCode}</span>
                          <span className="text-xs text-gray-600">{m.targetDisplay}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-400">
                        <span><Tf k="등가: {등가}" params={{ 등가: eqText(m.equivalence) }} /></span>
                        <span><Tf k="출처: {출처}" params={{ 출처: sourceText(m.mapSource) }} /></span>
                        {m.confidence != null && <span><Tf k="신뢰도: {값}" params={{ 값: <>{(Number(m.confidence) * 100).toFixed(0)}<Unit>%</Unit></> }} /></span>}
                        <span><Tf k="매핑일: {날짜}" params={{ 날짜: kdate(new Date(m.createdAt)) }} /></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon="📋" title="표준 매핑이 없습니다" />
              )}

              {/* 사용처(변경 영향) — 🔴 못 셌으면 "없음"이라 하지 않는다 */}
              <div className="text-[11px] text-gray-500">
                {usageError ? (
                  <span className="text-rose-500"><T k="사용처를 조회하지 못했습니다" /></span>
                ) : !usage ? (
                  <span className="text-gray-400"><T k="사용처 확인 중…" /></span>
                ) : usage.total === null ? (
                  <span className="text-amber-600">
                    <Tf k="사용처를 전부 확인하지 못했습니다 ({센}/{전체}) — 중지 전 확인 필요" params={{ 센: usage.countedRefs, 전체: usage.totalRefs }} />
                  </span>
                ) : usage.total === 0 ? (
                  <span className="text-gray-400"><T k="사용처 없음 — 이 코드를 쓰는 기록이 없습니다" /></span>
                ) : (
                  <span>
                    <b className="text-gray-700"><Tf k="사용 중 {수}건" params={{ 수: usage.total }} /></b>{' '}
                    <span className="text-gray-400">
                      {usage.refs.filter((r) => (r.count ?? 0) > 0).map((r) => `${r.label} ${r.count}`).join(' · ')}
                    </span>
                    {' '}<span className="text-amber-600"><T k="— 중지하면 이 기록들이 영향을 받습니다" /></span>
                  </span>
                )}
              </div>

              {/* Missing systems */}
              {(() => {
                /**
                 * 🔴 **해당 사항이 아닌 것을 갭으로 세지 않는다**(2026-08-26).
                 *    진단코드에 LOINC(검사 관찰)·ICD10PCS(시술)를 "미매핑"으로 적으면
                 *    영원히 채울 수 없는 항목이 갭 목록에 남아 **분모가 오염된다**.
                 *    서버 판정(`isApplicable`)과 같은 기준을 쓴다 — 둘이 갈라지면 화면이 거짓말한다.
                 */
                const applicableFor = (table: string): string[] => {
                  const t = table.toLowerCase();
                  if (t.includes('diagnosis')) return ['SNOMED_CT', 'MedDRA', 'ICF'];
                  if (t.includes('lab') || t.includes('test')) return ['LOINC', 'SNOMED_CT'];
                  if (t.includes('procedure') || t.includes('surgery')) return ['ICD10PCS', 'SNOMED_CT'];
                  if (t.includes('medication') || t.includes('drug')) return ['SNOMED_CT', 'MedDRA'];
                  if (t.includes('nursing')) return ['SNOMED_CT', 'ICF'];
                  return Object.keys(SYS_COLOR);
                };
                const applicable = applicableFor(sourceTable);
                const mapped = new Set(mappings.map(m => m.targetSystem));
                const missing = Object.keys(SYS_COLOR).filter(
                  s => !mapped.has(s) && !['ICD_10', 'ICD_11'].includes(s) && applicable.includes(s),
                );
                if (missing.length === 0) return null;
                return (
                  <div className="text-[10px] text-gray-400">
                    <Tf k="미매핑: {목록}" params={{ 목록: missing.map(s => s.replace('_', ' ')).join(', ') }} />
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowAddMapping(true)}
                  className="px-4 py-2 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">
                  + <T k="매핑 추가" />
                </button>
                <button onClick={() => autoMapMut.mutate()}
                  disabled={autoMapMut.isPending}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                  {autoMapMut.isPending ? (
                    <><SpinnerIcon /> <Tf k="{AI표기} 매핑 중..." params={{ AI표기: AI_ORIGIN_TEXT }} /></>
                  ) : (
                    <><BotIcon /> <Tf k="{AI표기} 매핑 제안 → 검토 대기" params={{ AI표기: AI_ORIGIN_TEXT }} /></>
                  )}
                </button>
              </div>

              {/* AI Suggestion Panel */}
              <AiMappingSuggestionPanel sourceTable={sourceTable} sourceId={sourceId} />

              {/* Add Mapping Form */}
              {showAddMapping && (
                <div className="border border-blue-200 bg-blue-50/30 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-gray-700"><T k="수동 매핑 추가" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block"><T k="표준 체계" /></label>
                      <select value={newMapping.targetSystem} onChange={e => setNewMapping(m => ({ ...m, targetSystem: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-1.5 text-xs">
                        {Object.entries(SYS_COLOR).map(([k]) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block"><T k="표준 코드" /></label>
                      <input value={newMapping.targetCode} onChange={e => setNewMapping(m => ({ ...m, targetCode: e.target.value }))}
                        placeholder="54150009" className="w-full border rounded-lg px-3 py-1.5 text-xs" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-gray-500 mb-1 block"><T k="표준 명칭" /></label>
                      <input value={newMapping.targetDisplay} onChange={e => setNewMapping(m => ({ ...m, targetDisplay: e.target.value }))}
                        placeholder="Upper respiratory infection" className="w-full border rounded-lg px-3 py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-1 block"><T k="등가" /></label>
                      <select value={newMapping.equivalence} onChange={e => setNewMapping(m => ({ ...m, equivalence: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-1.5 text-xs">
                        {Object.entries(EQ_LABEL).map(([k, v]) => <option key={k} value={k}>{tAttr(v)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => addMappingMut.mutate()}
                      disabled={!newMapping.targetCode || addMappingMut.isPending}
                      className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      <T k={addMappingMut.isPending ? '추가 중...' : '매핑 추가'} />
                    </button>
                    <button onClick={() => setShowAddMapping(false)}
                      className="px-4 py-1.5 bg-gray-100 text-gray-600 text-xs rounded-lg"><T k="취소" /></button>
                  </div>
                </div>
              )}
            </>
          )}

          {detailTab === 'nursing' && (
            <div className="space-y-2">
              {nursingCodes.length > 0 ? (
                nursingCodes.slice(0, 10).map(n => (
                  <div key={n.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                      n.codeSystem === 'NANDA_I' ? 'bg-rose-100 text-rose-700' :
                      n.codeSystem === 'NIC' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{n.codeSystem}</span>
                    <span className="font-mono text-xs text-gray-600">{n.code}</span>
                    <span className="text-xs text-gray-900">{n.nameKo}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{n.domain}</span>
                  </div>
                ))
              ) : (
                <EmptyState icon="🩺" title="관련 간호 진단이 없습니다" />
              )}
            </div>
          )}

          {detailTab === 'history' && (
            <MappingHistory sourceTable={sourceTable} sourceId={sourceId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mapping History (§4.8) ──

interface AuditLog {
  id: string;
  mappingId: string;
  action: string;
  previousData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  reason: string | null;
  performedAt: string;
}

/** 이력 행위 라벨 — 값은 i18n 키(`@감사` = 감사 이력의 행위 — 무문맥 '수정' 은 상태어 'Amended'). 표시 원문은 `@` 앞부분 */
const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  CREATED: { label: '생성@감사', color: 'text-emerald-600' },
  CONFIRMED: { label: '승인', color: 'text-blue-600' },
  REJECTED: { label: '거부', color: 'text-red-600' },
  UPDATED: { label: '수정@감사', color: 'text-amber-600' },
  AUTO_CONFIRMED: { label: '자동 확정', color: 'text-violet-600' },
};

function MappingHistory({ sourceTable, sourceId }: { sourceTable: string; sourceId: string }) {
  const { data: auditData, isLoading } = useQuery<{ data: AuditLog[] }>({
    queryKey: ['mapping-audit', sourceTable, sourceId],
    queryFn: () => apiClient.get(`/api/v1/codes/mapping-audit/${sourceTable}/${sourceId}`),
  });

  const { data: mappingsData } = useQuery<{ data: TerminologyMapping[] }>({
    queryKey: ['code-mappings', sourceTable, sourceId],
  });

  const audits = auditData?.data ?? [];
  const mappings = mappingsData?.data ?? [];

  if (isLoading) {
    return <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>;
  }

  // If no audit logs, fallback to showing mappings as timeline
  if (audits.length === 0 && mappings.length === 0) {
    return <EmptyState icon="📝" title="매핑 이력이 없습니다" />;
  }

  // Merge: audit logs + mapping creation records (for mappings without audit)
  const auditMappingIds = new Set(audits.map(a => a.mappingId));
  const fallbackItems = mappings
    .filter(m => !auditMappingIds.has(m.id))
    .map(m => ({
      id: `mapping-${m.id}`,
      action: 'CREATED',
      reason: null as string | null,
      newData: { targetSystem: m.targetSystem, targetCode: m.targetCode, targetDisplay: m.targetDisplay, mapSource: m.mapSource } as Record<string, unknown>,
      previousData: null,
      performedAt: m.createdAt,
      mappingId: m.id,
    }));

  const allItems = [...audits, ...fallbackItems].sort(
    (a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime(),
  );

  return (
    <div className="space-y-2">
      {allItems.map(item => {
        const meta = ACTION_LABEL[item.action] ?? { label: item.action, color: 'text-gray-600' };
        const sys = (item.newData?.targetSystem ?? item.previousData?.targetSystem ?? '') as string;
        const code = (item.newData?.targetCode ?? '') as string;
        const display = (item.newData?.targetDisplay ?? '') as string;
        return (
          <div key={item.id} className="flex items-start gap-3 p-3 border-l-2 border-blue-200 pl-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-medium ${meta.color}`}><T k={meta.label} /></span>
                {sys && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${SYS_COLOR[sys] ?? 'bg-gray-100 text-gray-600'}`}>
                    {sys.replace('_', ' ')}
                  </span>
                )}
                {code && <span className="font-mono text-gray-600">{code}</span>}
              </div>
              {display && <div className="text-[10px] text-gray-400 mt-0.5">{display}</div>}
              {item.reason && <div className="text-[10px] text-gray-500 mt-0.5"><Tf k="사유: {사유}" params={{ 사유: item.reason }} /></div>}
            </div>
            <span className="text-[10px] text-gray-400 shrink-0">
              {kdate(item.performedAt, 'datetimeShort')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Icons ──

function BotIcon() { return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.756 4.39A2.25 2.25 0 0115.146 21H8.854a2.25 2.25 0 01-2.098-1.61L5 14.5m14 0H5" /></svg>; }
function SpinnerIcon() { return <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>; }
