'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { ProposeAgendaButton } from '@/components/governance/ProposeAgendaModal';
import type { DecisionItem } from '../types';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { DecisionBriefingBody } from '../briefing';
import { DecisionDocPrint, printCanonLine } from '../print-sheet';
import { DevApplyPanel } from '../engine-parts';
import { usePrintIssue } from '@/components/print/usePrintIssue';

/**
 * 결정 설명자료(브리핑) — **사람이 들고 나가서 읽는 문서**.
 *
 * 사람 지시(2026-08-21): "허가권자, 위원회, 실서비스 개시 부분에 대한 UX와 설명자료등을
 * 디테일하게 개선하고 보완."
 *
 * 🔴 이 화면이 지키는 것:
 *  · **읽는 사람은 개발자가 아니다** — 키·enum 이 아니라 문장으로 말한다
 *  · **현재 상황(의사결정 이전)을 먼저 말한다**(`statusQuo`) — 결정하지 않는 것도 결정이다
 *  · **선택의 결과를 고르기 전에** 전부 보여준다
 *  · 🔴 **기록 후에도 남는 일을 숨기지 않는다**(`afterDecision`) — 기록≠적용
 *  · 🔴 **믿으라고 하지 않는다** — 주장마다 직접 확인하는 방법(`verifyHow`)을 붙인다
 *  · 🔴 **시스템은 권고하지 않는다** — 선택지를 나열할 뿐 어느 쪽이 옳다고 말하지 않는다
 *
 * 동적 조합 화면이라 화면번호를 부여하지 않는다(부모 `/admin/decisions` 2415 에서 들어온다).
 */
export default function DecisionBriefPage({ params }: { params: Promise<{ key: string }> }) {
  const tAttr = useTAttr();
  const { key } = use(params);
  const decodedKey = decodeURIComponent(key);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['human-decisions'],
    queryFn: () => apiClient.get<{ data: { items: DecisionItem[]; measuredAt: string; caveat: string } }>('/api/v1/admin/decisions'),
  });
  /** 🔴 인쇄 = 서버 발급(의사결정서 · 발급 원장 동결·진위확인 QR) — 발급 실패·해시 불일치면 인쇄하지 않는다(2026-10-12 기획 P0) */
  const found = data?.data.items.find((i) => i.key === decodedKey);
  const lines = useMemo(() => (found ? [printCanonLine(found)] : []), [found]);
  const pr = usePrintIssue('DECISION_RECORD', { key: decodedKey }, lines, () => { void refetch(); });

  if (isError) return <div className="w-full px-6 py-6"><QueryErrorFallback error={error} onRetry={refetch} /></div>;
  if (isLoading) return <div className="w-full px-6 py-6 text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  const payload = data?.data;
  const item = payload?.items.find((i) => i.key === decodedKey);

  if (!item) {
    return (
      <div className="w-full px-6 py-6">
        <p className="text-sm text-gray-700">
          <T k="등록부에" /> <code className="font-mono text-xs bg-gray-100 px-1 rounded">{decodedKey}</code> <T k="항목이 없습니다." />
        </p>
        <Link href="/admin/decisions" className="text-sm text-blue-600 underline underline-offset-2">← <T k="결정 등록부로" /></Link>
      </div>
    );
  }


  const agendaBody = [
    `[결정 사항] ${item.title}`,
    '',
    `[현재 상황(의사결정 이전)] ${strip(item.statusQuo)}`,
    '',
    `[왜 결정이 필요한가] ${strip(item.why)}`,
    '',
    '[선택지]',
    ...item.options.map((o) => `· ${o.label} → ${strip(o.effect)}`),
    '',
    item.afterDecision ? `[의결 후에도 남는 일] ${strip(item.afterDecision)}` : '',
    `[허가권] ${item.authority}`,
  ].filter(Boolean).join('\n');

  return (
    <div className="w-full px-6 py-6 break-keep print:p-0" data-doc-page>
      {/* 화면 전용 도구 막대 — 인쇄물에는 나오지 않는다 */}
      <div className="flex items-center justify-between gap-3 mb-6 print:hidden">
        <Link href="/admin/decisions" className="text-sm text-gray-500 hover:text-gray-700">← <T k="결정 등록부" />(2415)</Link>
        <div className="flex items-center gap-2">
          {item.committee && (item.approvalPath === 'COMMITTEE' || item.approvalPath === 'CODE_CHANGE') && (
            <ProposeAgendaButton
              sourceRef={{ type: 'DECISION', key: item.key }}
              committeeCodes={[item.committee.lead, ...item.committee.joint]}
              defaultTitle={item.title}
              defaultBody={agendaBody}
              label={tAttr('위원회 상정')}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100"
            />
          )}
          <button onClick={() => void pr.start()} disabled={pr.issuing}
            className="px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-60" data-print-issue-button>
            {pr.issuing ? <T k="발급 중…" /> : <T k="발급 후 인쇄 · PDF 저장" />}
          </button>
        </div>
      </div>
      {pr.bar && <div className="mb-4">{pr.bar}</div>}
      {item.devApply && <div className="mb-4"><DevApplyPanel item={item} /></div>}

      <article className="bg-white rounded-2xl border border-gray-200 px-6 py-8 lg:px-10 print:border-0 print:p-0 space-y-7 leading-relaxed">
        <DecisionBriefingBody item={item} items={payload!.items} measuredAt={payload!.measuredAt} caveat={payload!.caveat} />
      </article>
      {/* 🔴 인쇄는 화면을 찍지 않고 의사결정서로(2026-10-12 — 종전엔 빈 종이) */}
      <DecisionDocPrint item={item} measuredAt={payload!.measuredAt} {...pr.state} />
    </div>
  );
}

const strip = (t: string) => t.replace(/\*\*/g, '').replace(/🔴\s*/g, '');
