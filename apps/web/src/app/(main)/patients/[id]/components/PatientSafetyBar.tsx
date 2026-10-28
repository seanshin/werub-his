'use client';

// 임상 안전 스트립(D1) — 격리·DNR·낙상·EWS 중 데이터가 있고 심각한 것만 배지로 노출.
// 대형/회진 맥락에서 접촉 전 격리·코드 전 DNR·낙상·악화(EWS)는 알러지만큼 중요(P-1).
// 외래·안정 환자는 렌더 0(시각 변화 없음). 기존 환자별 EP 재사용(순수 FE·BE 변경 0).
// 격리는 환자별 EP 부재로 이연(P1.5).

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

function unwrap<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

interface EwsRec {
  totalScore: number; riskLevel: string; recordedAt: string;
  // 에스컬레이션 상태 — 응답에 실려 오지만 화면에 없던 값(2026-07 UI 미노출 감사).
  // '보고가 필요한데 아직 통보되지 않았다'는 사실 자체가 대응 신호다.
  escalationRequired?: boolean; escalationNotified?: boolean; escalationNotifiedAt?: string | null;
}
interface FallRec { score: number; riskLevel: string; assessedAt: string }
interface Directive { cprDecision?: string; documentType?: string }
interface IsolationRec { source: 'MDRO' | 'INFECTION' | 'ICU'; type: string; organism?: string | null; isolationType?: string | null }

type Tone = 'red' | 'orange' | 'amber';

function Badge({ tone, label, title }: { tone: Tone; label: string; title?: string }) {
  const cls =
    tone === 'red'
      ? 'bg-red-100 text-red-700 border-red-300'
      : tone === 'orange'
        ? 'bg-orange-100 text-orange-700 border-orange-300'
        : 'bg-amber-100 text-amber-800 border-amber-300';
  return (
    <span title={title} className={`text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

export function PatientSafetyBar({ patientId }: { patientId: string }) {
  // 벽면 board·차트 상시표시 갱신 — 격리/EWS/낙상 등 안전 신호 60초 폴링
  const opts = { enabled: !!patientId, retry: false, staleTime: 5 * 60 * 1000, refetchInterval: 60 * 1000 } as const;

  const ews = useQuery({
    queryKey: ['safety-ews', patientId],
    queryFn: () => apiClient.get<{ data: EwsRec[] }>(`/api/v1/safety/ews/patient/${patientId}`),
    ...opts,
  });
  const fall = useQuery({
    queryKey: ['safety-fall', patientId],
    queryFn: () => apiClient.get<{ data: FallRec[] }>(`/api/v1/safety/fall-risk/${patientId}`),
    ...opts,
  });
  const dir = useQuery({
    queryKey: ['safety-directive', patientId],
    queryFn: () => apiClient.get<{ data: Directive[] }>(`/api/v1/hospice/directives/${patientId}`),
    ...opts,
  });
  const iso = useQuery({
    queryKey: ['safety-isolation', patientId],
    queryFn: () => apiClient.get<{ data: IsolationRec[] }>(`/api/v1/safety/isolation/${patientId}`),
    ...opts,
  });

  const ewsRec = unwrap<EwsRec>(ews.data?.data ?? ews.data)[0];
  const fallRec = unwrap<FallRec>(fall.data?.data ?? fall.data)[0];
  const isDnr = unwrap<Directive>(dir.data?.data ?? dir.data).some((d) => d.cprDecision === 'DNR');

  const isolations = unwrap<IsolationRec>(iso.data?.data ?? iso.data);

  const badges: ReactNode[] = [];
  // 격리 — 접촉 전 확인이 최우선(IPSG.5)
  if (isolations.length > 0) {
    const first = isolations[0];
    badges.push(
      <Badge
        key="iso"
        tone="orange"
        label={`격리${first.isolationType ? `: ${first.isolationType}` : ''}${first.type ? ` (${first.type})` : ''}`}
        title={isolations.map((r) => `${r.source === 'MDRO' ? 'MDRO' : r.source === 'ICU' ? '중환자실' : '감염감시'} ${r.type}${r.organism ? ` · ${r.organism}` : ''}${r.isolationType ? ` · ${r.isolationType}` : ''}`).join('\n')}
      />,
    );
  }
  if (isDnr) badges.push(<Badge key="dnr" tone="red" label="DNR" title="사전연명의료의향서: 심폐소생술 거부(DNR)" />);
  if (fallRec && (fallRec.riskLevel === 'HIGH' || fallRec.riskLevel === 'MEDIUM')) {
    badges.push(
      <Badge
        key="fall"
        tone={fallRec.riskLevel === 'HIGH' ? 'orange' : 'amber'}
        label={`낙상위험 ${fallRec.riskLevel === 'HIGH' ? '높음' : '중간'}`}
        title={`낙상 평가 점수 ${fallRec.score}`}
      />,
    );
  }
  if (ewsRec && (ewsRec.riskLevel === 'HIGH' || ewsRec.riskLevel === 'MEDIUM')) {
    badges.push(
      <Badge
        key="ews"
        tone={ewsRec.riskLevel === 'HIGH' ? 'red' : 'amber'}
        label={`EWS ${ewsRec.totalScore}`}
        title={`조기경고점수(NEWS2) ${ewsRec.totalScore} · ${ewsRec.riskLevel}`}
      />,
    );
    // 에스컬레이션이 필요한데 통보되지 않은 상태를 드러낸다(값이 비어 있다는 사실이 신호).
    if (ewsRec.escalationRequired && !ewsRec.escalationNotified) {
      badges.push(
        <Badge
          key="ews-esc"
          tone="red"
          label="보고 미통보"
          title="EWS 기준상 즉시 보고(에스컬레이션)가 필요하지만 아직 통보되지 않았습니다."
        />,
      );
    }
  }

  // 🔴 조회 실패를 "안전 신호 없음"으로 접지 않는다 — 이 스트립은 신호가 없으면 렌더 0 이라
  //    실패가 그대로 "격리·DNR·낙상·EWS 없음"으로 읽힌다(근거 없이 안심시킴).
  //    무엇을 못 읽었는지 이름으로 밝히고, 그 축만 재시도한다.
  const failed = ([
    ['격리', iso],
    ['DNR', dir],
    ['낙상', fall],
    ['EWS', ews],
  ] as const).filter(([, q]) => q.isError);

  if (badges.length === 0 && failed.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="임상 안전 신호">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide"><T k="안전" /></span>
      {badges}
      {failed.length > 0 && (
        <QueryErrorFallback
          error={failed[0][1].error}
          onRetry={() => failed.forEach(([, q]) => void q.refetch())}
          size="compact"
          className={`w-auto ${badges.length > 0 ? '' : 'flex-1'}`}
        />
      )}
      {failed.length > 0 && (
        <span className="text-[10px] font-semibold text-red-600">
          확인 불가: {failed.map(([label]) => label).join(' · ')}
        </span>
      )}
    </div>
  );
}
