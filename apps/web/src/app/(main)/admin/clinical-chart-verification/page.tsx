'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { CLINICAL_CHARTS, ARCHETYPE_LABEL, getChart, computeDefHash } from '@/lib/clinical-charts';
import {
  useChartVerifications, verificationState, VERIFY_STATE_META, blocksOrderDraft,
  type ChartVerification, type VerifyState,
} from '@/components/clinical-charts/useChartVerifications';
import { kdate } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

type FilterKey = 'all' | VerifyState;

interface HistoryRecord extends ChartVerification { defHash?: string | null }

export default function ClinicalChartVerificationPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const { map: verMap, fourEyes, fourEyesSource, isLoading: verLoading, isError: verError, error: verErr, refetch: verRefetch } = useChartVerifications();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return CLINICAL_CHARTS
      .map((c) => ({ def: c, ver: verMap[c.chartId], state: verificationState(c, verMap[c.chartId], fourEyes) }))
      .filter((r) => (filter === 'all' || r.state === filter))
      .filter((r) => !kw || r.def.name.toLowerCase().includes(kw) || r.def.chartId.toLowerCase().includes(kw) || r.def.category.toLowerCase().includes(kw))
      // 처방 초안을 막고 있는 레지멘 먼저 — 안정 정렬(나머지는 정의 순서 그대로)
      .map((r, i) => ({ ...r, i, blocks: blocksOrderDraft(r.def, r.state) }))
      .sort((a, b) => Number(b.blocks) - Number(a.blocks) || a.i - b.i);
  }, [q, filter, verMap, fourEyes]);
  const regimens = useMemo(() => CLINICAL_CHARTS.filter((d) => d.archetype === 'tree'), []);
  const regimenBlocked = regimens.filter((d) => blocksOrderDraft(d, verificationState(d, verMap[d.chartId], fourEyes))).length;
  // 🔴 요약을 못 받으면 상태를 모른다 — 89개 "미검증"으로 세지 않는다(로딩 중도 아직 모름)
  const stateKnown = !verError && !verLoading;

  const counts = useMemo(() => {
    const c: Record<VerifyState, number> = { verified: 0, pending2nd: 0, defChanged: 0, rejected: 0, unverified: 0 };
    for (const d of CLINICAL_CHARTS) c[verificationState(d, verMap[d.chartId], fourEyes)]++;
    return c;
  }, [verMap, fourEyes]);

  const selected = selectedId ? getChart(selectedId) : null;
  const selectedVer = selectedId ? verMap[selectedId] : undefined;
  const selectedState = selected ? verificationState(selected, selectedVer, fourEyes) : null;

  const { data: historyData } = useQuery({
    queryKey: ['ccv-history', selectedId],
    queryFn: () => apiClient.get<{ data: HistoryRecord[] }>(`/api/v1/clinical-chart-verifications/${selectedId}/history`),
    enabled: !!selectedId,
  });
  const history: HistoryRecord[] = useMemo(() => {
    const raw = historyData?.data;
    return Array.isArray(raw) ? raw : (raw as { data?: HistoryRecord[] } | undefined)?.data ?? [];
  }, [historyData]);

  const decideMut = useMutation({
    mutationFn: (status: 'VERIFIED' | 'REJECTED') => {
      if (!selected) throw new Error('no chart');
      return apiClient.post('/api/v1/clinical-chart-verifications', {
        chartId: selected.chartId,
        status,
        sourceGuideline: selected.sourceGuideline,
        sourceVersion: selected.sourceVersion,
        defHash: computeDefHash(selected), // 승인 시점 정의 스냅샷 — 정의 변경 시 재검수 무효화
        note: note.trim() || undefined,
      });
    },
    onSuccess: (_d, status) => {
      setMsg(status === 'VERIFIED' ? tAttr('검증 승인 기록됨') : tAttr('반려 기록됨'));
      setNote('');
      qc.invalidateQueries({ queryKey: ['clinical-chart-verifications'] });
      qc.invalidateQueries({ queryKey: ['ccv-history', selectedId] });
      setTimeout(() => setMsg(null), 3000);
    },
    // 🔴 서버가 자가 승인(같은 사람이 동일 정의를 두 번 승인)을 409 로 거부한다 — 사유를 그대로 보여준다.
    //    '기록 실패' 로만 뭉개면 검수자가 왜 막혔는지 모른 채 다시 누른다.
    onError: (e: unknown) => setMsg(e instanceof Error && e.message ? e.message : tAttr('기록 실패')),
  });

  // 🔴 라벨과 수치를 분리한다 — `전체 12` 같은 보간 문자열은 카탈로그 키가 될 수 없다(영원히 미등록)
  const FILTERS: [FilterKey, string, number][] = [
    ['all', '전체', CLINICAL_CHARTS.length],
    ['unverified', '미검증', counts.unverified],
    ...(fourEyes ? [['pending2nd', '2차 대기', counts.pending2nd] as [FilterKey, string, number]] : []),
    ['defChanged', '재검수 필요', counts.defChanged],
    ['verified', '검증됨', counts.verified],
    ['rejected', '반려', counts.rejected],
  ];

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900"><T k="임상도구 검수 (verified)" /></h1>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${fourEyes ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}
            title={tAttr("SystemConfig 'clinical.verificationFourEyes' 로 전환")}>
            4-eyes(<T k="2인 승인" />): {stateKnown ? <T k={fourEyes ? '활성' : '비활성'} /> : <T k="확인 불가" />}
          </span>
          {stateKnown && (
            <span className="text-[11px] text-gray-500" data-four-eyes-source={fourEyesSource ?? 'UNKNOWN'}>
              <T k={fourEyesSource === 'config' ? '설정값' : fourEyesSource === 'default' ? '설정 없음 — 서버 안전 기본값(켜짐)' : '출처 모름'} />
              {' · '}<Link href="/admin/decisions/clinicalChart.verifyPolicy" className="text-blue-700 underline"><T k="검수 승인 수 결정" /></Link>
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-1">
          <T k="각 임상도구의 수치·임계값을" /> <b><T k="공식 가이드라인 원문과 대조" /></b><T k="한 뒤 승인/반려를 기록합니다." />
          <T k="기록은 append-only 감사로 보존되며, 승인 시점의" /> <b><T k="정의 해시" /></b><T k="가 저장되어 정의가 변경되면 자동으로 「재검수 필요」로 전환됩니다." />
        </p>
      </div>

      {/* 🔴 서버는 도구 정의를 모른다 — 정의 해시는 이 화면(웹 코드)이 계산해 보낸다. 서버가 대조하지 않는다는 한계를 그대로 말한다 */}
      <p className="text-[11px] text-gray-500" data-def-hash-limit>
        <T k="정의 해시는 이 화면이 웹 코드의 도구 정의로 계산해 보냅니다 — 서버는 정의를 갖고 있지 않아 해시를 대조하지 않습니다(정의를 서버로 옮기는 일은 별도 기획)." />
      </p>

      {verError && <QueryErrorFallback error={verErr} onRetry={verRefetch} />}
      {verError && (
        <p className="text-sm text-amber-800" data-verify-unknown>
          <T k="검수 기록을 불러오지 못했습니다 — 도구별 상태는 확인 불가입니다(미검증으로 세지 않습니다)." />
        </p>
      )}

      {stateKnown && regimens.length > 0 && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${regimenBlocked > 0 ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`} data-regimen-blocked={regimenBlocked}>
          <b><T k="처방 초안이 닫혀 있는 레지멘" /></b> {regimenBlocked} / {regimens.length}
          <span className="ml-2 text-xs"><T k="검증되기 전까지 항암 레지멘 처방 초안을 만들 수 없습니다 — 목록 맨 위에 둡니다." /></span>
        </div>
      )}

      {/* 🔴 미검증 도구의 '사용 가능' 사실 고지 — 노란 배지만으로는 "검수 대기 중이지만 안전하다"로 읽힌다.
          실제로는 사용을 막는 도구가 항암 레지멘 처방 초안 1건뿐이고, 나머지는 임상에서 그대로 쓰인다. */}
      {stateKnown && counts.unverified > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="ccv-unverified-banner">
          <p className="text-sm font-bold text-amber-900">
            <T k="미검증 임상도구" /> {counts.unverified}<T k="개" /> / <T k="전체" /> {CLINICAL_CHARTS.length}<T k="개" /> — <b><T k="사용은 차단되지 않습니다" /></b>
          </p>
          <ul className="text-xs text-amber-800 mt-1.5 space-y-1 leading-relaxed list-disc pl-4">
            <li><T k="미검증 도구도" /> <b><T k="임상 화면에서 그대로 실행·산출" /></b><T k="됩니다. 「미검증 참조용」 배지만 표시됩니다." /></li>
            <li><T k="산출 결과로" /> <b><T k="후속 행위를 막는 곳은 항암 레지멘의 처방 초안 생성 1건뿐" /></b><T k="입니다." /></li>
            <li><T k="검수는" /> <b><T k="공식 원문 대조" /></b><T k="가 전제입니다. 원문을 확보하지 못했다면 승인하지 말고 반려하거나 보류하십시오." /></li>
            <li><T k="어떤 도구의 사용을 차단할지는" /> <b><T k="의료질향상·환자안전위원회 판단 영역" /></b><T k="이며 이 화면에서 정하지 않습니다." /></li>
          </ul>
        </div>
      )}

      {/* 요약 + 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        {stateKnown && FILTERS.map(([k, label, n]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium border ${filter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
            <T k={label} /> {n}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('이름·카테고리 검색…')}
          className="ml-auto px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none w-56" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
        {/* 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs text-gray-500">
                <th className="px-4 py-2.5"><T k="도구" /></th>
                <th className="px-4 py-2.5"><T k="유형" /></th>
                <th className="px-4 py-2.5"><T k="출처" /></th>
                <th className="px-4 py-2.5"><T k="상태" /></th>
                <th className="px-4 py-2.5"><T k="최근 검수" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ def, ver, state, blocks }) => (
                <tr key={def.chartId} onClick={() => { setSelectedId(def.chartId); setNote(''); }}
                  className={`border-b border-gray-50 cursor-pointer ${selectedId === def.chartId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{def.name}</p>
                    <p className="text-[11px] text-gray-400">{def.category} · {def.chartId}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap"><T k={ARCHETYPE_LABEL[def.archetype]} /></td>
                  <td className="px-4 py-2.5 text-[11px] text-gray-500">{def.sourceGuideline}{def.sourceVersion ? ` (${def.sourceVersion})` : ''}</td>
                  <td className="px-4 py-2.5" data-verify-state={stateKnown ? state : 'UNKNOWN'}>
                    {stateKnown
                      ? <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${VERIFY_STATE_META[state].cls}`}><T k={VERIFY_STATE_META[state].label} /></span>
                      : <span className="text-[11px] text-gray-400"><T k={verError ? '확인 불가' : '불러오는 중…'} /></span>}
                    {stateKnown && blocks && <span className="ml-1 text-[10px] font-bold text-rose-700" data-blocks-order-draft><T k="처방 초안 닫힘" /></span>}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">
                    {ver ? `${ver.approverNames?.length ? ver.approverNames.join('·') : ver.verifiedByName} · ${kdate(new Date(ver.createdAt))}` : '-'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-sm"><T k="해당 조건 도구 없음" /></td></tr>}
            </tbody>
          </table>
        </div>

        {/* 검수 패널 */}
        <aside>
          {selected ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 sticky top-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-bold text-gray-900">{selected.name}</h2>
                  {selectedState && (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${VERIFY_STATE_META[selectedState].cls}`}><T k={VERIFY_STATE_META[selectedState].label} /></span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5"><T k={ARCHETYPE_LABEL[selected.archetype]} /> · {selected.category}</p>
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 space-y-1">
                <p><span className="text-gray-400"><T k="출처" />:</span> {selected.sourceGuideline} {selected.sourceVersion && `(${selected.sourceVersion})`}</p>
                <p><span className="text-gray-400"><T k="현재 정의 해시" />:</span> <span className="font-mono">{computeDefHash(selected)}</span></p>
                {selected.note && <p><span className="text-gray-400"><T k="주의" />:</span> {selected.note}</p>}
                {selected.existingModel && <p className="text-blue-600"><T k="기존 도메인 모델 병행" />: {selected.existingModel}</p>}
              </div>

              {selectedState === 'defChanged' && (
                <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-[11px] text-orange-800">
                  ⚠️ <T k="승인 이후" /> <b><T k="정의가 변경" /></b><T k="되었습니다(해시 불일치). 현재 정의를 원문과 다시 대조한 뒤 재승인하세요." />
                </div>
              )}
              {fourEyes && selectedState === 'pending2nd' && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-[11px] text-blue-800">
                  <T k="1차 승인 완료" />({selectedVer?.approverNames?.join('·')}). <b><T k="다른 검수자" /></b><T k="의 2차 승인이 있어야 「검증됨」으로 전환됩니다." />
                </div>
              )}

              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-[11px] text-amber-800">
                <T k="검수 절차: ① 위 출처의" /> <b><T k="최신 공식 원문" /></b><T k="을 확보 ② 정의된 항목·점수·임계값·권고를 원문과 대조 ③ 불일치 시 반려(소견에 수정 필요 사항 기재) ④ 일치 시 승인." />
                <span className="block mt-1"><T k="동일 정의에 대한" /> <b><T k="본인의 재승인은 서버가 거부" /></b><T k="합니다 — 2차 승인은 다른 검수자가 수행해야 합니다." /></span>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1"><T k="검수 소견" /> {decideMut.isPending ? '' : <T k="(반려 시 필수 권장)" />}</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                  placeholder={tAttr('예: ACR 2017 원문 표2와 대조, 전 항목 일치 확인')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none resize-none" />
              </div>

              <div className="flex gap-2">
                <button onClick={() => decideMut.mutate('VERIFIED')} disabled={decideMut.isPending}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  <T k="검증 승인" />
                </button>
                <button onClick={() => decideMut.mutate('REJECTED')} disabled={decideMut.isPending}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  <T k="반려" />
                </button>
              </div>
              {msg && <p className="text-xs font-medium text-emerald-600">{msg}</p>}
              {selectedVer && (
                <p className="text-[11px] text-gray-400">
                  <T k="최근" />: <T k={selectedVer.status === 'VERIFIED' ? '승인' : '반려'} /> · {selectedVer.verifiedByName} · {kdate(new Date(selectedVer.createdAt), 'datetime')}
                  {fourEyes && selectedVer.status === 'VERIFIED' && ` · ${tAttr('승인자')} ${selectedVer.approverCount ?? 1}${tAttr('인')}`}
                </p>
              )}

              {/* 이력 */}
              {history.length > 0 && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-2"><T k="검수 이력" /></p>
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                    {history.map((h, i) => (
                      <li key={i} className="text-[11px] text-gray-600 flex items-start gap-2">
                        <span className={`shrink-0 font-bold ${h.status === 'VERIFIED' ? 'text-emerald-600' : 'text-red-600'}`}><T k={h.status === 'VERIFIED' ? '승인' : '반려'} /></span>
                        <span className="flex-1 min-w-0">
                          {h.verifiedByName} · {kdate(new Date(h.createdAt), 'datetime')}
                          {h.defHash && selected && h.defHash !== computeDefHash(selected) && <span className="text-orange-500"> · <T k="구정의" /></span>}
                          {h.note && <span className="block text-gray-400 truncate" title={h.note}>{h.note}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-10 text-center text-gray-400 text-sm">
              <T k="왼쪽 목록에서 검수할 도구를 선택하세요." />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
