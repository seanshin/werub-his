'use client';

// 처방 안전 근거 배지 — API 가 이미 반환하지만 화면에 없던 값(2026-07 UI 미노출 감사 §5).
//  · durOverridden/durOverrideReason/At : DUR 경고를 무시한 사실과 사유(규제 감사 근거)
//  · orderSource : 구두·전화 처방 여부(오기 위험이 높은 경로)
//  · readBackConfirmedAt : 구두처방 Read-back 확인(환자안전 필수 절차)
//
// 값이 없으면 아무것도 그리지 않는다(일반 서면 처방 화면은 변화 없음).

import { kdate } from '@/lib/ui-settings';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';

interface Props {
  rx: Record<string, any>;
  /** 컴팩트(목록 행) 모드 — 사유 텍스트를 title 로만 노출 */
  compact?: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  VERBAL: '구두처방',
  TELEPHONE: '전화처방',
};

function ts(v?: string | null): string {
  if (!v) return '';
  try { return kdate(new Date(v)); } catch { return ''; }
}

export function PrescriptionSafetyBadges({ rx, compact }: Props) {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const overridden = Boolean(rx?.durOverridden || rx?.durOverrideAt);
  const sourceLabel = SOURCE_LABEL[rx?.orderSource as string];
  const needsReadBack = Boolean(sourceLabel); // 구두·전화 처방만 Read-back 대상
  const readBackAt = rx?.readBackConfirmedAt as string | undefined;

  if (!overridden && !sourceLabel) return null;

  return (
    <>
      {overridden && (
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 whitespace-nowrap"
          title={[
            tAttr('DUR 경고를 무시하고 처방했습니다.'),
            // 🔴 사유·시각은 **기록된 값**이다 — 문장 틀만 번역하고 값은 자리표시자로 끼운다
            rx?.durOverrideReason ? tfAttr('사유: {사유}', { 사유: String(rx.durOverrideReason) }) : tAttr('사유 미기재'),
            rx?.durOverrideAt ? tfAttr('시각: {시각}', { 시각: ts(rx.durOverrideAt) }) : '',
          ].filter(Boolean).join('\n')}
        >
          ⚠ <T k="DUR 무시" />
          {!compact && rx?.durOverrideReason ? ` · ${String(rx.durOverrideReason).slice(0, 20)}` : ''}
        </span>
      )}

      {sourceLabel && (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-300 whitespace-nowrap">
          🗣 <T k={sourceLabel} />
        </span>
      )}

      {needsReadBack && (
        readBackAt ? (
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap"
            title={tfAttr('Read-back 확인: {시각}', { 시각: ts(readBackAt) })}
          >
            ✓ <T k="Read-back 확인" />
          </span>
        ) : (
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 whitespace-nowrap"
            title={tAttr('구두·전화 처방은 Read-back(복창 확인)이 필요합니다.')}
          >
            ! <T k="Read-back 미확인" />
          </span>
        )
      )}
    </>
  );
}
