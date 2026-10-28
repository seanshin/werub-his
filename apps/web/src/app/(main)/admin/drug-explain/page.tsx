'use client';

// F-7 약 설명 약사 승인 콘솔 — 생성 설명은 원내 약사 승인분만 환자 노출(2026-07-07 결정).
// 재생성(e약은요 개정) 시 승인 리셋 → 재검수. 반려=삭제(다음 요청 시 재생성 → 재검수 큐).
// 접근: PHARMACIST·ADMIN (BE 롤 가드 — /api/v1/admin/drug-explain)

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface ListRow {
  medicationCodeId: string;
  code: string | null;
  nameKo: string;
  itemCode: string | null;
  sourceVersion: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
}

interface ExplainContent {
  purpose?: string;
  cautions?: string[];
  sideEffects?: string[];
  whenToCall?: string[];
  disclaimer?: string | null;
  generatedAt?: string;
}

interface Detail {
  medicationCodeId: string;
  content: ExplainContent;
  sourceVersion: string | null;
  itemCode: string | null;
  approvedAt: string | null;
  med?: { code?: string; nameKo?: string } | null;
  source?: {
    efficacy?: string; usage?: string; precaution?: string; sideEffect?: string;
    interaction?: string; warn?: string; storage?: string; updateDe?: string;
  } | null;
}

const fmt = (iso: string | null) => (iso ? kdate(new Date(iso), 'datetime') : '-');

export default function DrugExplainAdminPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'approved'>('pending');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['drug-explain-admin', tab],
    queryFn: () => apiClient.get<{ data: ListRow[] }>(`/api/v1/admin/drug-explain?status=${tab}`),
  });
  const rows = data?.data ?? [];

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ['drug-explain-admin-detail', openId],
    queryFn: () => apiClient.get<{ data: Detail }>(`/api/v1/admin/drug-explain/${openId}`),
    enabled: !!openId,
  });
  const detail = detailRes?.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['drug-explain-admin'] });
    qc.invalidateQueries({ queryKey: ['drug-explain-admin-detail'] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/admin/drug-explain/${id}/approve`, {}),
    onSuccess: () => { toast.success(tAttr('승인되었습니다 — 환자 화면에 노출됩니다.')); setOpenId(null); invalidate(); },
    onError: () => toast.error(tAttr('승인에 실패했습니다.')),
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/drug-explain/${id}`),
    onSuccess: () => { toast.success(tAttr('반려되었습니다 — 다음 요청 시 재생성되어 다시 검수 목록에 올라옵니다.')); setOpenId(null); invalidate(); },
    onError: () => toast.error(tAttr('반려에 실패했습니다.')),
  });

  return (
    <div className="p-6 max-w-4xl">
      {/* `{출처}` 는 AI 표기(AI기본법 §31 · shared AI_ORIGIN_TEXT)라 번역하지 않고 그대로 넣는다(comp1 선례) */}
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100"><Tf k="약 설명 검수 ({출처} 생성분)" params={{ 출처: AI_ORIGIN_TEXT }} /></h1>
      {/* 🔴 번역 단위는 문장 — 첫 문장은 보간으로 배선한다. 둘째 문장은 문장 머리에 <b> 가 걸려
          조각으로 쪼개면 어순이 깨진다(P1-A 선례) — 원문 유지 */}
      <p className="text-sm text-gray-500 mt-1">
        <Tf k="환자포털 「쉽게 보기」에 노출될 {출처} 생성 설명입니다." params={{ 출처: AI_ORIGIN_TEXT }} /> <Tf k="{강조}되며, 식약처 e약은요 개정으로 재생성되면 승인이 해제되어 다시 이 목록에 올라옵니다." params={{ 강조: <b><T k="약사 승인분만 환자에게 노출" /></b> }} />
      </p>
      <p className="text-xs text-gray-400 mt-1">
        <T k="검수 기준: ① 원문(하단 대조) 밖 내용 없음 ② 경고 강도 유지 ③ 진단·용법 변경 권고 없음 ④ 환자 눈높이 용어." />
        {' '}<T k="참고 자료" />: docs/05-reference/f7-pharmacy-review-20260707.md
      </p>

      <div className="flex gap-2 mt-4">
        {(['pending', 'approved'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setOpenId(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
            <T k={t === 'pending' ? '검수 대기' : '승인됨'} />
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm text-gray-400"><T k="불러오는 중..." /></p>}
        {!isLoading && !rows.length && (
          <p className="text-sm text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <T k={tab === 'pending' ? '검수 대기 중인 설명이 없습니다.' : '승인된 설명이 없습니다.'} />
          </p>
        )}
        {rows.map((r) => (
          <div key={r.medicationCodeId} className="border border-gray-200 dark:border-gray-700 rounded-xl">
            <button className="w-full flex items-center gap-3 p-3 text-left"
              onClick={() => setOpenId(openId === r.medicationCodeId ? null : r.medicationCodeId)}>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 min-w-0 truncate">{r.nameKo}</span>
              <span className="text-xs font-mono text-gray-400 shrink-0">{r.code ?? '-'}</span>
              <span className="ml-auto text-[11px] text-gray-400 shrink-0">
                {/* 🔴 맨 키 `생성` 은 먼저 등록된 뜻이 Create(동사)라 "Create 2026-…" 로 나갔다 — 시각을 품은 보간 키로 가른다
                    (문맥 키 `생성@시각` 은 추가 언어 팩 5종에 결손을 만든다 — 팩은 이 갈래 소유가 아니다) */}
                <Tf k="생성 {시각}" params={{ 시각: fmt(r.generatedAt) }} />{r.sourceVersion ? <>{' · '}<Tf k="e약은요 개정 {판}" params={{ 판: r.sourceVersion }} /></> : ''}
              </span>
              {r.approvedAt && <span className="text-[11px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded shrink-0"><T k="승인" /> {fmt(r.approvedAt)}</span>}
            </button>

            {openId === r.medicationCodeId && (
              <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-3">
                {detailLoading && <p className="text-sm text-gray-400"><T k="상세 불러오는 중..." /></p>}
                {detail && (
                  <>
                    <Section title="💊 무슨 약인가요">{detail.content?.purpose || <T k="(없음)" />}</Section>
                    <ListSection title="⚠️ 주의하세요" items={detail.content?.cautions} />
                    <ListSection title="😷 이런 증상이 나타날 수 있어요" items={detail.content?.sideEffects} />
                    <ListSection title="🚨 이럴 땐 연락하세요" items={detail.content?.whenToCall} />

                    <details className="text-xs text-gray-600 dark:text-gray-300">
                      <summary className="cursor-pointer text-gray-500"><T k="e약은요 원문 대조 (환각 확인)" /></summary>
                      <div className="mt-2 space-y-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 max-h-80 overflow-y-auto">
                        {detail.source ? (
                          (['efficacy', 'usage', 'warn', 'precaution', 'interaction', 'sideEffect', 'storage'] as const).map((k) =>
                            detail.source?.[k] ? (
                              <p key={k} className="leading-relaxed">
                                <b className="text-gray-500">[{k}]</b> {detail.source[k]}
                              </p>
                            ) : null,
                          )
                        ) : (
                          <p className="text-gray-400"><Tf k="원문을 불러오지 못했습니다 ({출처} 서버 확인 필요) — 원문 대조 없이 승인하지 마세요." params={{ 출처: AI_ORIGIN_TEXT }} /></p>
                        )}
                      </div>
                    </details>

                    <div className="flex gap-2 pt-1">
                      {!detail.approvedAt && (
                        <button onClick={() => approve.mutate(r.medicationCodeId)} disabled={approve.isPending}
                          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
                          <T k="승인 (환자 노출 허용)" />
                        </button>
                      )}
                      <button onClick={() => { if (confirm(tAttr('반려하면 생성물이 삭제되고, 다음 요청 시 재생성되어 다시 검수 목록에 올라옵니다.'))) reject.mutate(r.medicationCodeId); }}
                        disabled={reject.isPending}
                        className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium disabled:opacity-50">
                        <T k="반려 (삭제·재생성 대상)" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200"><T k={title} /></p>
      <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 leading-relaxed">{children}</p>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200"><T k={title} /></p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((s, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">- {s}</li>
        ))}
      </ul>
    </div>
  );
}
