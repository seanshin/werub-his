'use client';

/**
 * 언어팩 사람 검수 화면 부품 — 기획서 `i18n-human-review.plan.md` §2.3~§2.6.
 *
 * 🔴 이 화면이 지켜야 하는 것(전부 이 저장소 실측에서 나온 규칙):
 *  · **화면이 값의 출처를 말한다** — 코드 AI 초안인지 검수 완료인지 배지로. 배지가 없으면
 *    사람은 "누군가 검수한 값"으로 읽는다(가드 `overlay-origin-visible.spec.tsx`).
 *  · **기록 ≠ 적용** — `PROPOSED` 는 저장됐지만 화면에 나가지 않는다. 그 사실을 그 자리에서 말한다.
 *  · **일괄 승인 없음** — 건별. 제안자=승인자면 막지 않고 **그 사실을 화면이 말한다**(4-eyes).
 *  · **권한이 없으면 버튼을 숨기지 않는다** — 비활성화하고 왜 못 하는지 말한다(숨김 ≠ 권한 회수).
 *  · **안전 키는 "번역하지 않음(반려+사유)"도 정답**이다 — 화면이 그것을 선택지로 안내한다.
 *  · 임상·결정 버튼은 터치 타깃 44px 이상.
 */

import { useState } from 'react';
import {
  I18N_REVIEW_STATE_TEXT,
  I18N_VALUE_ORIGIN_TEXT,
  RATIO_UNAVAILABLE,
  type I18nReviewState,
  type I18nValueOrigin,
} from '@hospital-run/shared';
import StatusBadge from '@/components/ui/StatusBadge';
import { KDate, Ratio } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { reasonFilled } from '@/lib/reason-presets';
import { useI18nOverlayState } from '@/stores/i18n-overlay-store';
import type { ReviewMeta, ReviewPermission, ReviewRow, ReviewStats } from './contract';

/* ── 출처 배지 ───────────────────────────────────────────────────────────────── */

/**
 * 🔴 **어휘를 FE 가 지어내지 않는다** — 문구는 shared 정본(`I18N_VALUE_ORIGIN_TEXT`) 하나다.
 *    서버도 같은 상수로 `effectiveOriginText` 를 만든다(같은 사실에 정본이 둘이면 갈라진다).
 */
const ORIGIN_TONE: Record<I18nValueOrigin, string> = {
  UNTRANSLATED: 'bg-gray-100 text-gray-600',
  // 초안은 "아직 사람이 안 본 값"이다 — 초록으로 칠하면 검수된 것처럼 읽힌다
  CODE_AI_DRAFT: 'bg-amber-100 text-amber-800',
  CODE_VERIFIED: 'bg-emerald-100 text-emerald-700',
  REVIEW_APPROVED: 'bg-emerald-100 text-emerald-700',
};

export function OriginBadge({ origin, className = '' }: { origin: I18nValueOrigin; className?: string }) {
  return (
    <span
      data-i18n-origin={origin}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${ORIGIN_TONE[origin]} ${className}`}
    >
      <T k={I18N_VALUE_ORIGIN_TEXT[origin]} />
    </span>
  );
}

/**
 * 검수 상태 배지 — 라벨은 shared 정본(`I18N_REVIEW_STATE_TEXT`)에서 **파생**한다.
 * 🔴 로컬 Record 로 라벨을 다시 적지 않는다. 정본 배지에 이 도메인 프리셋이 아직 없어
 *    `config` 로 주입하되, **라벨은 shared 표 그대로**이고 색만 규약대로 고른다.
 */
const STATE_TONE: Record<I18nReviewState, { bg: string; text: string }> = {
  NONE: { bg: 'bg-gray-100', text: 'text-gray-600' },
  PROPOSED: { bg: 'bg-amber-100', text: 'text-amber-700' },
  APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  REJECTED: { bg: 'bg-red-100', text: 'text-red-700' },
  MERGED: { bg: 'bg-blue-100', text: 'text-blue-700' },
};
const STATE_CONFIG = Object.fromEntries(
  (Object.keys(I18N_REVIEW_STATE_TEXT) as I18nReviewState[]).map((s) => [
    s,
    { label: I18N_REVIEW_STATE_TEXT[s], ...STATE_TONE[s] },
  ]),
);

export function ReviewStateBadge({ status }: { status: I18nReviewState }) {
  return <StatusBadge status={status} config={STATE_CONFIG} />;
}

/* ── 작은 표식들 ─────────────────────────────────────────────────────────────── */

function Chip({ tone, title, children }: { tone: string; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tone}`}>
      {children}
    </span>
  );
}

export function SafetyChip({ reason }: { reason: string | null }) {
  const tAttr = useTAttr();
  return (
    <Chip tone="bg-red-50 text-red-700 border border-red-200" title={reason ?? tAttr('임상·규제 키 — 오역이 위해가 됩니다')}>
      <T k="안전 키" />
    </Chip>
  );
}

/* ── 권한 안내 ───────────────────────────────────────────────────────────────── */

/**
 * 🔴 권한이 없다고 **화면에서 지우지 않는다**. 무엇을 할 수 있고 없는지, 그리고 **왜** 인지를
 *    서버가 보낸 문장(`permission.reason`) 그대로 보여준다 — FE 가 사유를 지어내면 서버 판정과 갈라진다.
 */
export function PermissionNotice({ permission }: { permission: ReviewPermission | undefined }) {
  if (!permission) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        <T k="권한 정보를 아직 받지 못했습니다 — 지금 무엇을 할 수 있는지 판정할 수 없습니다(권한이 없다는 뜻이 아닙니다)." />
      </div>
    );
  }
  const writable = permission.canPropose || permission.canApprove || permission.canMarkMerged;
  return (
    <div
      className={`rounded-xl border p-3 text-xs ${writable ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <p className="font-semibold">
        <T k="이 언어에서 지금 계정이 할 수 있는 일" />
      </p>
      <p className="mt-1 leading-relaxed">{permission.reason}</p>
      <p className="mt-1 text-[11px] opacity-80">
        <T k="제안" /> {permission.canPropose ? '✓' : '✕'} · <T k="승인·반려" /> {permission.canApprove ? '✓' : '✕'} ·{' '}
        <T k="코드 반영 표시" /> {permission.canMarkMerged ? '✓' : '✕'} · <span className="font-mono">{permission.configKey}</span>{' '}
        <T k="검수자" />{' '}
        {/* 🔴 조회 실패(null)를 "0명"으로 번역하지 않는다 */}
        {permission.reviewerCount == null ? <T k="확인 불가" /> : `${permission.reviewerCount}`}
      </p>
    </div>
  );
}

/* ── 통계 ────────────────────────────────────────────────────────────────────── */

function StatCell({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <div className="text-[11px] text-gray-500">
        <T k={label} />
      </div>
      <div className="mt-1 text-base font-bold text-gray-900 tabular-nums">{children}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-gray-400">
          <T k={hint} />
        </div>
      )}
    </div>
  );
}

export function StatsPanel({ stats }: { stats: ReviewStats }) {
  return (
    <div className="space-y-3">
      {/**
       * 🔴 **기록 ≠ 적용**(§2.4·§2.5). "번역하지 않기로 함"은 사람의 판정이고, 코드 카탈로그의
       *    AI 초안은 그대로 남는다 — 남아 있으면 화면에는 그 초안이 계속 나간다.
       *    이 줄을 빼면 "N건 번역 안 함"이라 말하면서 화면은 번역을 보여주는 P17 이 된다.
       *    분모(`noTranslate`)를 함께 그린다 — 분모 0 이면 `<Ratio>` 가 '산출 불가'라 말한다.
       */}
      {stats.noTranslateButCodeStillShows > 0 && (
        <div data-code-still-shows className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <p className="font-semibold">
            <T k="🔴 번역하지 않기로 했으나 코드에 초안이 남아 아직 그 초안이 화면에 나갑니다" />
          </p>
          <p className="mt-1">
            <Ratio numerator={stats.noTranslateButCodeStillShows} denominator={stats.noTranslate} />{' '}
            <T k="— 개발자가 카탈로그에서 그 키를 빼야 반영됩니다(코드 수렴)." />
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCell label="검수됨 / 키 전집" hint="승인·반려·코드반영 = 사람이 판정을 남긴 키">
        <Ratio numerator={stats.review.reviewed} denominator={stats.catalogTotal} />
      </StatCell>
      <StatCell label="번역됨 / 키 전집" hint="번역 등재 여부일 뿐 검수 여부가 아님">
        <Ratio numerator={stats.translated} denominator={stats.catalogTotal} />
      </StatCell>
      <StatCell label="제안 대기" hint="사람이 승인·반려를 기다리는 건">
        {stats.review.proposed}
      </StatCell>
      <StatCell label="안전 키" hint="임상·규제 — 먼저 처리">
        {stats.safetyTotal}
      </StatCell>
      <StatCell label="문맥 결손" hint="뜻이 틀린 번역이 나가는 자리">
        {/* 🔴 팩이 없어 못 세는 것을 0 으로 그리지 않는다 */}
        {stats.contextGaps == null ? (
          <span className="text-sm font-medium text-gray-500" title={stats.contextGapsUnavailableReason ?? undefined}>
            <T k={RATIO_UNAVAILABLE} />
          </span>
        ) : (
          stats.contextGaps
        )}
      </StatCell>
      <StatCell label="승인했지만 코드에 없음" hint="오버레이를 끄면 사라지는 값 — 내보내기 후 커밋 필요">
        {stats.approvedNotInCode}
      </StatCell>
      <StatCell label="코드 검수 표기(VERIFIED)" hint="코드 카탈로그가 스스로 검수라 밝힌 키">
        {stats.codeVerifiedCount}
      </StatCell>
      <StatCell label="미검수" hint="사람 판정이 아직 없는 키">
        {stats.review.unreviewed}
      </StatCell>
      <StatCell label="번역하지 않음" hint="사유와 함께 '번역하지 않는다'로 판정된 키">
        {stats.noTranslate}
      </StatCell>
      <StatCell label="그중 코드 초안이 아직 나가는 것" hint="기록은 됐으나 적용되지 않은 몫 — 코드 수렴 필요">
        <Ratio numerator={stats.noTranslateButCodeStillShows} denominator={stats.noTranslate} />
      </StatCell>
      <StatCell label="카탈로그에 없는 검수 기록" hint="코드에서 원문이 바뀌거나 사라졌다 — 검수율 분자에서 뺐다">
        {stats.orphanOverrides}
      </StatCell>
      </div>
    </div>
  );
}

/* ── 워크리스트 행 ───────────────────────────────────────────────────────────── */

export interface RowActions {
  onPropose: (row: ReviewRow, value: string, note: string) => void;
  onApprove: (row: ReviewRow, reason: string) => void;
  onReject: (row: ReviewRow, reason: string) => void;
  /**
   * 🔴 키만으로 "번역하지 않음"(§2.4) — **사유가 필수**다. 교정값이 없으므로 사유가 곧 판정의 내용이다.
   *    화면은 사유가 비면 부르지 않고, **왜 못 누르는지**를 버튼 자리에서 말한다.
   */
  onRejectKey: (row: ReviewRow, reason: string) => void;
  onMarkMerged: (row: ReviewRow, reason: string) => void;
}

/** 결정 버튼 — 🔴 44px 이상(임상 쓰기 규약) · 권한 없으면 숨기지 않고 사유를 단다 */
function ActionButton({
  label,
  tone,
  onClick,
  disabled,
  disabledReason,
}: {
  label: string;
  tone: string;
  onClick: () => void;
  disabled: boolean;
  disabledReason?: string;
}) {
  const tAttr = useTAttr();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? (disabledReason ?? tAttr('지금은 할 수 없습니다')) : undefined}
      className={`min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors ${tone} ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
    >
      <T k={label} />
    </button>
  );
}

export function ReviewRowItem({
  row,
  permission,
  usageAvailable,
  actions,
  busy,
}: {
  row: ReviewRow;
  permission: ReviewPermission | undefined;
  /** 사용처 색인을 만들 수 있었는가 — 🔴 못 만들었으면 "쓰는 곳 없음"이라 말하지 않는다 */
  usageAvailable: boolean;
  actions: RowActions;
  busy: boolean;
}) {
  const tAttr = useTAttr();
  /**
   * 🔴 `overlayValue: ''` 는 **값이 아니라 "번역하지 않음"의 표현**이다(서버 `noTranslate`).
   *    그것을 교정 입력의 초기값으로 읽으면 "빈 교정안이 저장돼 있다"로 보인다.
   */
  const [draft, setDraft] = useState<string>(row.noTranslate ? '' : (row.overlayValue ?? ''));
  const [note, setNote] = useState<string>('');
  /** 사유는 "비어 있지 않음"만 본다 — 어휘를 강제하지 않는다(정본 `reasonFilled`) */
  const hasReason = reasonFilled(note);
  const canPropose = permission?.canPropose === true;
  const canApprove = permission?.canApprove === true;
  const canMerge = permission?.canMarkMerged === true;
  const noPermReason = permission?.reason;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* 원문(키) — 🔴 문맥 키는 `원문@문맥` 을 그대로 보여준다(왜 갈렸는지가 검수의 핵심 정보다) */}
        <div className="lg:col-span-3">
          <div className="text-sm font-semibold text-gray-900 break-words">{row.source}</div>
          {row.context && (
            <div className="mt-0.5 font-mono text-[11px] text-violet-700 break-all">
              {row.key}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip tone="bg-gray-100 text-gray-600">{row.area}</Chip>
            {row.safetyKey && <SafetyChip reason={row.safetyReason} />}
            {/* 🔴 null = 산출 불가 — false(결손 없음)와 같은 그림으로 그리지 않는다(그리지 않는다) */}
            {row.contextGap === true && (
              <Chip tone="bg-violet-50 text-violet-700 border border-violet-200" title={tAttr('무문맥 번역은 있는데 이 문맥 변형이 없습니다 — 뜻이 틀린 번역이 나갑니다')}>
                <T k="문맥 결손" />
              </Chip>
            )}
            {row.baseChanged && (
              <Chip tone="bg-amber-50 text-amber-800 border border-amber-200" title={tAttr('제안 당시 코드 값이 그 뒤 바뀌었습니다 — 재검수가 필요합니다')}>
                <T k="원본 바뀜" />
              </Chip>
            )}
          </div>
          {row.safetyKey && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-red-700">
              <T k="🔴 안전 키입니다 — 번역하지 않고 원문으로 두는 것도 정답입니다(사유를 적어 '번역하지 않음'을 누르세요)." />
            </p>
          )}
        </div>

        {/* 현재 값 + 출처 배지 */}
        <div className="lg:col-span-3">
          <div className="text-[11px] text-gray-500">
            <T k="지금 화면에 나가는 값" />
          </div>
          <div className="mt-0.5 text-sm text-gray-900 break-words" dir="auto">
            {row.effectiveValue ?? <span className="text-gray-400"><T k="번역 없음 — 한국어 원문이 나갑니다" /></span>}
          </div>
          <div className="mt-1.5">
            <OriginBadge origin={row.effectiveOrigin} />
          </div>
          {/**
           * 🔴 **기록 ≠ 적용** — "번역하지 않음"으로 판정해도 코드 카탈로그의 AI 초안은 남는다.
           *    초안이 남아 있으면 화면에는 그 초안이 **계속 나간다**. 판정만 그리고 이 사실을
           *    빼면 "번역 안 함"이라 말하면서 화면은 번역을 보여주는 P17 이 된다.
           */}
          {row.noTranslate && (
            <p
              data-no-translate={row.codeValue != null ? 'CODE_STILL_SHOWS' : 'SOURCE_SHOWN'}
              className={`mt-1.5 text-[11px] leading-relaxed ${row.codeValue != null ? 'text-red-700' : 'text-gray-500'}`}
            >
              {row.codeValue != null ? (
                <T k="🔴 번역하지 않기로 판정했지만 코드에 AI 초안이 남아 화면에는 그 초안이 계속 나갑니다 — 개발자가 카탈로그에서 이 키를 빼야 반영됩니다(코드 수렴)." />
              ) : (
                <T k="번역하지 않기로 판정했고, 코드에도 값이 없어 화면에는 원문+티가 나갑니다." />
              )}
            </p>
          )}
          {row.codeValue != null && row.effectiveOrigin === 'REVIEW_APPROVED' && row.codeValue !== row.effectiveValue && (
            <p className="mt-1 text-[11px] text-gray-500 break-words">
              <T k="코드 초안" />: <span dir="auto">{row.codeValue}</span>
            </p>
          )}
        </div>

        {/* 교정 입력 */}
        <div className="lg:col-span-3">
          <label className="text-[11px] text-gray-500" htmlFor={`draft-${row.key}`}>
            <T k="교정 입력(저장하면 제안됨)" />
          </label>
          <textarea
            id={`draft-${row.key}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            dir="auto"
            disabled={!canPropose || busy}
            placeholder={tAttr('이 언어로 확정할 문구')}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
            placeholder={tAttr("사유·근거 — '번역하지 않음'에는 필수입니다")}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
          />
          {/* 🔴 필수라는 사실을 **누르기 전에** 말한다(눌러 보고 알게 하지 않는다) */}
          <p className="mt-0.5 text-[11px] text-gray-500">
            <T k="교정 저장·승인·반려에는 선택이지만, '번역하지 않음'에는 사유가 필수입니다(교정값이 없어 사유가 곧 판정의 내용입니다)." />
          </p>
          {/* 🔴 기록 ≠ 적용 */}
          <p className="mt-1 text-[11px] text-amber-700">
            <T k="저장하면 '제안됨'으로 남고, 승인 전에는 화면에 반영되지 않습니다." />
          </p>
        </div>

        {/* 상태 · 쓰이는 곳 */}
        <div className="lg:col-span-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <ReviewStateBadge status={row.status} />
            {row.selfApproved && (
              <Chip tone="bg-red-50 text-red-700 border border-red-200" title={tAttr('제안자와 승인자가 같습니다 — 막지 않았고 이 사실이 원장에 남습니다')}>
                <T k="제안자=승인자" />
              </Chip>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-500">
            {row.proposedAt && (
              <div>
                <T k="제안자" /> {row.proposedByName ?? row.proposedBy ?? <T k="작성자 미상" />} · <KDate value={row.proposedAt} mode="datetime" />
              </div>
            )}
            {row.reviewedAt && (
              <div>
                <T k="판정자" /> {row.reviewedByName ?? row.reviewedBy ?? <T k="작성자 미상" />} · <KDate value={row.reviewedAt} mode="datetime" />
              </div>
            )}
            {row.mergedAt && (
              <div>
                <T k="코드 반영 표시" /> <KDate value={row.mergedAt} mode="datetime" />
              </div>
            )}
            {/* 제안자 근거와 판정 사유는 다른 사실이다 — 한 칸에 뭉치면 누가 쓴 말인지 사라진다 */}
            {row.note && (
              <div className="text-gray-600 break-words">
                <T k="근거" />: “{row.note}”
              </div>
            )}
            {row.decisionReason && (
              <div className="text-gray-600 break-words">
                <T k="판정 사유" />: “{row.decisionReason}”
                {row.decisionAt && <> · <KDate value={row.decisionAt} mode="datetime" /></>}
              </div>
            )}
          </div>
          <div className="mt-2 text-[11px]">
            <span className="text-gray-500"><T k="쓰이는 곳" />: </span>
            {!usageAvailable || row.usedIn == null ? (
              <span className="text-gray-400"><T k="확인 불가(사용처 색인 없음)" /></span>
            ) : row.usedIn.length === 0 ? (
              <span className="text-gray-400"><T k="이 키를 쓰는 화면을 찾지 못했습니다" /></span>
            ) : (
              <span className="text-gray-700 break-all">{row.usedIn.slice(0, 6).join(' · ')}{row.usedIn.length > 6 ? ` … +${row.usedIn.length - 6}` : ''}</span>
            )}
          </div>
        </div>
      </div>

      {/* 결정 — 🔴 건별. 일괄 승인 버튼은 없다 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-50 pt-3">
        <ActionButton
          label="교정 저장(제안)"
          tone="bg-blue-50 text-blue-700 hover:bg-blue-100"
          onClick={() => actions.onPropose(row, draft, note)}
          disabled={!canPropose || busy || draft.trim().length === 0}
          disabledReason={!canPropose ? noPermReason : tAttr('교정 문구를 입력하세요 — 빈 값은 저장하지 않습니다')}
        />
        <ActionButton
          label="승인@버튼"
          tone="bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          onClick={() => actions.onApprove(row, note)}
          disabled={!canApprove || busy || row.id == null}
          disabledReason={
            row.id == null
              ? tAttr('제안 기록이 없어 판정할 수 없습니다 — 먼저 교정을 저장하세요')
              : !canApprove
                ? noPermReason
                : undefined
          }
        />
        {row.id == null ? (
          /**
           * 🔴 제안이 없는 키의 "번역하지 않음"(§2.4) — `POST /review/reject-key`.
           *    종전에는 여기가 비활성 버튼이었다(쓰지도 않은 교정값을 먼저 저장해야 했으므로).
           *    사유는 **필수**다 — 교정값이 없어 사유가 곧 판정의 내용이기 때문이다.
           */
          <ActionButton
            label="번역하지 않음(사유 필수)"
            tone="bg-red-50 text-red-700 hover:bg-red-100"
            onClick={() => actions.onRejectKey(row, note)}
            disabled={!canApprove || busy || !hasReason}
            disabledReason={
              !canApprove
                ? noPermReason
                : tAttr('사유가 필수입니다 — 교정값이 없어 사유가 곧 판정의 내용입니다(공백만은 사유가 아닙니다)')
            }
          />
        ) : (
          <ActionButton
            label="반려@버튼"
            tone="bg-red-50 text-red-700 hover:bg-red-100"
            onClick={() => actions.onReject(row, note)}
            disabled={!canApprove || busy}
            disabledReason={!canApprove ? noPermReason : undefined}
          />
        )}
        <ActionButton
          label="코드 반영 표시"
          tone="bg-gray-100 text-gray-700 hover:bg-gray-200"
          onClick={() => actions.onMarkMerged(row, note)}
          disabled={!canMerge || busy || row.id == null || row.status !== 'APPROVED'}
          disabledReason={
            row.id == null
              ? tAttr('제안 기록이 없습니다')
              : row.status !== 'APPROVED'
                ? tAttr('승인된 항목만 코드 반영으로 표시할 수 있습니다')
                : !canMerge
                  ? noPermReason
                  : undefined
          }
        />
        {row.id == null && (
          <span className="text-[11px] text-gray-500">
            <T k="아직 제안이 없는 키입니다 — 승인은 제안된 항목에만 남고, '번역하지 않음'은 사유만으로 남길 수 있습니다." />
          </span>
        )}
      </div>
    </div>
  );
}

/* ── 목록 하단 — 잘랐으면 잘랐다고 말한다 ─────────────────────────────────────── */

export function ListFooter({ meta, onMore }: { meta: ReviewMeta; onMore: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white p-3 text-xs text-gray-600">
      <span>
        <T k="표시 중" /> {meta.returned} / <T k="이 필터의 전체" /> {meta.total}
        <span className="text-gray-400"> · <T k="카탈로그 전집" /> {meta.catalogTotal}</span>
      </span>
      {meta.truncated ? (
        <button
          type="button"
          onClick={onMore}
          className="min-h-[44px] rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          <T k="더 보기 — 아래에 더 있습니다(전건이 아닙니다)" />
        </button>
      ) : (
        <span className="text-gray-400">
          <T k="이 필터의 전건을 표시했습니다" />
        </span>
      )}
    </div>
  );
}


/**
 * 🔴 **승인분이 이 브라우저에 실제로 얹혔는가** — 검수의 마지막 한 걸음을 화면이 말한다.
 *
 * 2026-09-09 이전에는 승인해도 **어느 화면에도 나가지 않았다**(런타임 등록 소비처 0).
 * 그래서 "승인했다"와 "화면이 그것을 보여준다"는 서로 다른 사실이고, 여기서 갈라 말한다.
 * 🔴 조회 실패를 "승인분 0건"과 같은 그림으로 그리지 않는다 — 다른 사실이다.
 * 🔴 불러오는 중을 "확인 불가"라고 말하지 않는다 — 아직 안 온 것과 모르는 것은 다르다.
 */
export function OverlayRuntimeNotice() {
  const o = useI18nOverlayState();
  const box = (tone: 'ok' | 'warn' | 'bad' | 'mute', body: React.ReactNode) => (
    <div
      data-testid="overlay-runtime-notice"
      data-overlay-status={o.status}
      className={`rounded-xl border p-3 text-xs leading-relaxed ${
        tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900'
          : tone === 'bad' ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-gray-200 bg-gray-50 text-gray-600'
      }`}
    >
      {body}
    </div>
  );

  if (o.status === 'IDLE') {
    return box('mute', <T k="검수 오버레이를 아직 불러오지 않았습니다(화면 진입 직후)." />);
  }
  if (o.status === 'LOADING') {
    return box('mute', <T k="승인된 검수 결과를 불러오는 중입니다…" />);
  }
  if (o.status === 'SKIPPED_KO') {
    return box('mute', <T k="한국어는 원문이 곧 정본이라 검수 오버레이 대상이 아닙니다(불러오지 않는 것이 맞습니다)." />);
  }
  if (o.status === 'FAILED') {
    return box('bad', (
      <>
        <p className="font-semibold"><T k="🔴 검수 오버레이를 불러오지 못했습니다 — 지금 이 브라우저의 화면은 코드 초안입니다." /></p>
        <p className="mt-1"><T k="승인된 값이 있어도 반영되지 않은 상태입니다. 새로고침하거나 서버 상태를 확인하세요." /></p>
        {o.error && <p className="mt-1 font-mono text-[11px] opacity-80">{o.error}</p>}
      </>
    ));
  }
  if (o.status === 'NO_PACK') {
    return box('warn', <T k="이 언어의 팩이 없어 승인분을 얹을 곳이 없습니다 — 팩을 지어내지 않습니다." />);
  }

  const stale = o.staleKeys.length > 0 && (
    <p className="mt-1">
      <T k="🔴 승인이 취소·반려됐지만 이 세션에는 옛 승인값이 그대로 보이는 키가 있습니다(회수 경로 없음 — 새로고침해야 사라집니다):" />{' '}
      <span className="font-semibold">{o.staleKeys.length}</span>
    </p>
  );

  if (o.status === 'EMPTY') {
    return box('mute', (
      <>
        <p><T k="조회는 성공했고 이 언어에 승인된 검수 결과가 아직 없습니다(실패가 아닙니다)." /></p>
        {stale}
      </>
    ));
  }
  // APPLIED
  return box('ok', (
    <>
      <p>
        <T k="승인된 검수 결과가 이 브라우저에 적용됐습니다 —" />{' '}
        <span className="font-semibold">{o.applied}</span><T k="건" />
        {o.skipped > 0 && (
          <>
            {' · '}<T k="값이 비어 얹지 않은 항목" />{' '}
            <span className="font-semibold">{o.skipped}</span><T k="건" />
          </>
        )}
      </p>
      {stale}
    </>
  ));
}
