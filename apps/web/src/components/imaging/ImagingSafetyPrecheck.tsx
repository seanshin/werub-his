'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

/**
 * 이송 전 영상 안전 확인 — 조영제 알레르기·신기능(eGFR)·임신·누적선량.
 *
 * 같은 판정이 종전에는 **시행 시점(방사선사)** 게이트에서만 돌아, 정작 환자를 준비·이송하는
 * 간호사는 화면에서 확인할 수 없었다. 여기서는 게이트를 시행하지 않고 판정 결과만 읽는다
 * (차단·기록 없음 — 서버 `GET /imaging/orders/:id/safety-precheck`).
 */
interface SafetyCheck { rule: string; level: 'INFO' | 'WARNING' | 'ERROR'; message: string }

const LEVEL_UI: Record<string, { cls: string; icon: string }> = {
  ERROR: { cls: 'border-rose-200 bg-rose-50 text-rose-800', icon: '\u26d4' },
  WARNING: { cls: 'border-amber-200 bg-amber-50 text-amber-800', icon: '\u26a0\ufe0f' },
  INFO: { cls: 'border-gray-200 bg-gray-50 text-gray-600', icon: '\u2139\ufe0f' },
};

export function ImagingSafetyPrecheck({ orderId }: { orderId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['imaging-safety-precheck', orderId],
    queryFn: () => apiClient.get<{ data: { modality: string; modalityKnown: boolean; usesContrast: boolean; ionizing: boolean; checks: SafetyCheck[] } }>(
      `/api/v1/imaging/orders/${orderId}/safety-precheck`,
    ),
    enabled: !!orderId,
  });

  if (isLoading) return <p className="text-[11px] text-gray-400"><T k="안전 확인 중…" /></p>;
  // 🔴 조회 실패에 아무것도 그리지 않으면 간호사는 **안전 확인이 있었는지조차 모른다.**
  //    확인하지 못한 것은 "해당 없음"이 아니다.
  if (isError) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
        <T k="⚠️ 안전 확인을 불러오지 못했습니다 — 조영제·임신·피폭 판정을" /> <b><T k="확인하지 못한 상태" /></b><T k="입니다. 이송 전 직접 확인하세요" />
      </p>
    );
  }
  const d = data?.data as {
    modality?: string; modalityKnown?: boolean; usesContrast?: boolean; ionizing?: boolean; checks?: SafetyCheck[];
  } | undefined;
  if (!d) return null;
  const checks = d.checks ?? [];
  // 🔴 검사 종류를 **판정하지 못한 것**은 "해당 없음"이 아니다. 처방에 시술코드가 없으면
  //    조영·임신·피폭 판정이 한 항목도 돌지 않는다 — 그 사실을 그 자리에서 말한다.
  const unknownKind = d.modalityKnown === false;
  // 🔴 서버가 준 `ionizing` 을 화면이 쓰지 않아, 판정 항목이 비면 전리방사선 검사에도
  //    "조영·방사선 검사 아님" 이라 단정하고 있었다(P1 — 아는 것과 모르는 것을 뒤바꿔 말함).
  const applicable = !!d.ionizing || !!d.usesContrast;

  return (
    <div className="space-y-1">
      <p className="text-[11px] text-gray-500">
        {unknownKind ? <T k="검사 종류 미상" /> : d.modality}
        {d.usesContrast ? <> · <T k="조영" /></> : ''}{d.ionizing ? <> · <T k="전리방사선" /></> : ''} — <T k="이송 전 확인" />
      </p>
      {unknownKind && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          <T k="⚠️ 검사 종류를 판정하지 못했습니다(처방에 시술코드 없음) — 조영제·임신 여부·피폭을" />{' '}
          <b><T k="이 화면이 확인해 주지 못합니다." /></b> <T k="직접 확인하세요" />
        </p>
      )}
      {checks.length === 0 ? (
        applicable ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            ⚠️ <T k={d.ionizing ? '전리방사선' : '조영'} /> <T k="검사인데 판정 항목이 비어 있습니다 — 안전 확인 결과를 받지 못했습니다" />
          </p>
        ) : unknownKind ? null : (
          <p className="text-[11px] text-gray-400"><T k="확인 항목 없음(조영·방사선 검사 아님)" /></p>
        )
      ) : (
        checks.map((c, i) => {
          const ui = LEVEL_UI[c.level] ?? LEVEL_UI.INFO;
          return (
            <p key={i} className={`rounded border px-2 py-1 text-[11px] ${ui.cls}`}>
              <span className="mr-1">{ui.icon}</span>{c.message}
            </p>
          );
        })
      )}
    </div>
  );
}
