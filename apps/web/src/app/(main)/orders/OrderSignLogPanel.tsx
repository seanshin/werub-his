'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { EmptyState, Unit, StaffName, Unknown } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 오더 서명 로그 — 이 오더에 무슨 일이 있었는지를 **봉인된 형태로** 보여준다.
 *
 * 화면이 답해야 하는 것: "누가 언제 무엇을 했나" + "그 기록을 나중에 바꿀 수 있나(없다)".
 * 그래서 행위·행위자·시각만이 아니라 **봉인 상태와 인증 수단**을 함께 세운다 —
 * 봉인 해시가 없는 줄은 아직 증명력이 없다는 뜻이고, 그것도 숨기지 않고 드러낸다.
 */
export interface SignLogRow {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  summary?: string | null;
  origin: string;
  occurredAt: string;
  sealStatus: string;
  entryHash?: string | null;
  prevHash?: string | null;
  authMethod?: string | null;
  anchoredAt?: string | null;
  sealError?: string | null;
  sealAttempts: number;
}

const ACTION_UI: Record<string, { label: string; icon: string; cls: string }> = {
  ORDER_CREATED: { label: '오더 발행', icon: '📝', cls: 'bg-blue-500' },
  ORDER_RECEIVED: { label: '오더 접수', icon: '📥', cls: 'bg-indigo-500' },
  ORDER_IN_PROGRESS: { label: '시행 시작', icon: '⚙️', cls: 'bg-amber-500' },
  ORDER_COMPLETED: { label: '오더 완료', icon: '✅', cls: 'bg-emerald-500' },
  ORDER_CANCELLED: { label: '오더 취소', icon: '🚫', cls: 'bg-rose-500' },
};

/** 봉인 상태 — '아직 안 됨'과 '실패'와 '대상 아님'을 구분해서 보여준다 */
export const SEAL_UI: Record<string, { label: string; cls: string; hint: string }> = {
  SEALED: { label: '봉인됨', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', hint: 'sign 해시체인에 봉인 — 이후 변경하면 체인 검증에서 드러난다' },
  PENDING: { label: '봉인 대기', cls: 'bg-gray-50 text-gray-500 border-gray-200', hint: '기록은 남았고 봉인 대기 중(재시도 크론이 처리)' },
  FAILED: { label: '봉인 실패', cls: 'bg-rose-50 text-rose-600 border-rose-200', hint: 'sign 전송 실패 — 재시도 대상' },
  SKIPPED: { label: '봉인 안 함', cls: 'bg-amber-50 text-amber-700 border-amber-200', hint: 'sign 연동이 꺼져 있어 원내 기록만 남음' },
};

const AUTH_UI: Record<string, { label: string; hint: string }> = {
  SSO: { label: '본인 인증', hint: 'sign 이 의료진 토큰을 검증한 신원 — 부인하기 어렵다' },
  API_KEY: { label: '시스템 기록', hint: '시스템이 주장한 행위자(의료진 토큰 없이 기록)' },
};

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function OrderSignLogPanel({ orderId }: { orderId: string }) {
  const tAttr = useTAttr();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['order-sign-log', orderId],
    queryFn: () => apiClient.get<{ data: SignLogRow[] }>(`/api/v1/orders/${orderId}/sign-log`),
    enabled: !!orderId,
  });

  const rows = (data?.data ?? []) as SignLogRow[];

  if (isLoading) return <div className="py-4 text-xs text-gray-400"><T k="서명 로그를 불러오는 중…" /></div>;
  if (isError) return <p className="py-4 text-xs text-rose-600"><T k="서명 로그를 불러오지 못했습니다." /></p>;
  if (!rows.length) {
    return (
      <EmptyState
        icon="🔏"
        title="아직 봉인된 행위가 없습니다"
        hint="발행·접수·시행·완료·취소가 일어나면 sign 원장에 봉인되어 여기에 쌓입니다"
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10.5px] leading-relaxed text-gray-500">
        <T k="각 줄은 sign 해시체인에 봉인된 행위입니다. 앞 줄의 해시가 뒷 줄에 이어지므로, 중간을 지우거나 바꾸면" /> <span className="font-medium text-gray-700"><T k="체인 검증에서 드러납니다" /></span>.
      </p>

      <ol className="relative space-y-2 border-l border-gray-200 pl-4">
        {rows.map((r) => {
          const ui = ACTION_UI[r.action] ?? { label: r.action, icon: '•', cls: 'bg-gray-400' };
          const seal = SEAL_UI[r.sealStatus] ?? SEAL_UI.PENDING;
          const auth = r.authMethod ? AUTH_UI[r.authMethod] : undefined;
          return (
            <li key={r.id} className="relative rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
              <span className={`absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-white ${ui.cls}`} aria-hidden />

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span aria-hidden>{ui.icon}</span>
                <span className="text-xs font-semibold text-gray-900"><T k={ui.label} /></span>
                {r.fromStatus && (
                  <span className="text-[10px] tabular-nums text-gray-400">{r.fromStatus} → {r.toStatus}</span>
                )}
                <span className="ml-auto text-[10px] tabular-nums text-gray-500">{fmt(r.occurredAt)}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-600">
                {/* 행위자 표시 정본 — 이름이 없는 경우와 시스템 행위를 구분한다.
                    (id 는 있는데 이름이 없다 = 기록은 됐으나 이름을 못 붙임 / id 자체가 없다 = 시스템) */}
                {r.actorName
                  ? <StaffName name={r.actorName} role={r.actorRole} className="font-medium text-gray-800" />
                  : r.actorId
                    ? <Unknown kind="UNRECORDED" className="font-medium" />
                    : <span className="font-medium text-gray-500"><T k="시스템" /></span>}
                {!r.actorName && r.actorRole && <span className="text-[10px] text-gray-400">{r.actorRole}</span>}
                {r.summary && <span className="truncate text-gray-500">· {r.summary}</span>}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold ${seal.cls}`} title={tAttr(seal.hint)}>
                  <T k={seal.label} />
                </span>
                {auth && (
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[9.5px] font-medium ${r.authMethod === 'SSO' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                    title={tAttr(auth.hint)}
                  >
                    <T k={auth.label} />
                  </span>
                )}
                {r.anchoredAt && (
                  <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9.5px] font-medium text-violet-700" title={`${tAttr('시점봉인(TSA)')} ${fmt(r.anchoredAt)}`}>
                    <T k="시점봉인" />
                  </span>
                )}
                {r.origin === 'RECONCILED' && (
                  <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9.5px] text-gray-500" title={tAttr('실시간 배선이 아니라 오더 스탬프에서 소급 복원한 항목')}>
                    <T k="소급 복원" />
                  </span>
                )}
                {r.entryHash && (
                  <code className="ml-auto font-mono text-[9.5px] text-gray-400" title={`entryHash ${r.entryHash}`}>
                    {r.entryHash.slice(0, 12)}…
                  </code>
                )}
              </div>

              {r.sealError && (
                <p className="mt-1 text-[10px] text-rose-500">
                  <T k="봉인 오류" />: {r.sealError.slice(0, 120)} (<T k="시도" /> {r.sealAttempts}<Unit><T k="회" /></Unit>)
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
