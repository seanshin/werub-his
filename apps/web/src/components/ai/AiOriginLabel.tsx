'use client';

/**
 * AI 산출물 표기 — **정본**.
 *
 * 🔴 2026-08-19 실측: AI EP 를 부르는 화면 **35개 중 사용자에게 "AI"라는 단어가 보이는 곳은 5개**뿐이었다.
 *    나머지는 "WeRU.B"·"자동분석"·"진료 보조"로만 표기했고, 이것이 **의도된 설계**로 문서에 남아 있었다
 *    (f7-pharmacy-review §6.5 "AI 단독 라벨 금지"). 게다가 앱마다 달랐다 —
 *    포털은 브랜드 단독 30여 곳, 모바일은 "AI" 단독 20여 곳, 공개 사이트는 "AI".
 *    **같은 환자가 앱을 바꾸면 다른 이름을 봤다.**
 *
 * 🔴 2026-08-19 정책 결정(운영): **인간에게 정보를 전달하는 것이 최선.**
 *    AI기본법 §31 은 이용자가 AI 산출물임을 알 수 있게 할 것을 요구한다 — 브랜드는 그 사실을 가린다.
 *    브랜드를 지우지 않고 **"AI"를 함께 적는다**. 새 화면은 이 부품만 쓴다(문구를 다시 적지 않는다).
 */
import { AI_BRAND, AI_ORIGIN_TEXT, AI_DEFAULT_DISCLAIMER } from '@hospital-run/shared';

/** 정본은 shared(`packages/shared/src/ai-brand.ts`) — web·mobile·homepage·api 가 같은 값을 쓴다. 여기서는 재노출만. */
export { AI_BRAND, AI_ORIGIN_TEXT, AI_DEFAULT_DISCLAIMER };

export function AiOriginLabel({
  variant = 'badge',
  note,
  className = '',
}: {
  variant?: 'badge' | 'inline';
  /** 서버가 동봉한 disclaimer 를 우선한다 — 없을 때만 기본 문구 */
  note?: string | null;
  className?: string;
}) {
  if (variant === 'inline') {
    return (
      <span className={`text-[11px] text-violet-700 ${className}`}>
        {AI_ORIGIN_TEXT} 생성
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 px-2 py-0.5 text-[10px] font-semibold ${className}`}
      title={note ?? `${AI_ORIGIN_TEXT}가 생성한 참고 정보입니다. 최종 판단은 의료진이 수행합니다.`}
    >
      <span aria-hidden="true">✨</span>
      {AI_ORIGIN_TEXT}
    </span>
  );
}

/**
 * AI 면책 문구.
 * 🔴 서버가 동봉한 `disclaimer` 를 **우선**한다 — 화면이 자기 문구를 하드코딩하면
 *    운영이 config 로 고쳐도 그 화면만 옛 문구로 남는다(실측: 진료 AI 패널이 그랬다).
 */
export function AiDisclaimer({ text, className = '' }: { text?: string | null; className?: string }) {
  const body = text?.trim() || AI_DEFAULT_DISCLAIMER;
  return <p className={`text-[11px] leading-relaxed text-gray-500 ${className}`}>{body}</p>;
}
