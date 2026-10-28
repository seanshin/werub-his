'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { PT } from '../_shared/PT';
import { usePortalSession } from './session-check';

/** 이 시간 안으로 남으면 알린다 — 화면 안내 시점일 뿐 세션 길이(서버 정본)를 바꾸지 않는다 */
export const SESSION_EXPIRY_NOTICE_MINUTES = 5;

/**
 * 남은 분 — 알릴 때가 아니면 null.
 *  · 만료 시각을 모르면(null·형식 오류) null — 모르는 것을 "곧 끝납니다"로 말하지 않는다
 *  · 이미 지났으면 null — 끝난 세션은 서버 401 → 로그인 화면 안내가 맡는다(여기서 두 번 말하지 않는다)
 *  · 1분 미만은 1분으로(0분 뒤 끝납니다는 말이 되지 않는다)
 */
export function minutesUntilExpiry(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  const ms = t - now;
  if (ms <= 0) return null;
  const min = Math.ceil(ms / 60_000);
  return min <= SESSION_EXPIRY_NOTICE_MINUTES ? min : null;
}

/**
 * 로그인 만료 임박 안내(2026-10-22 포털 A1 잔여) — 정본 = 세션 능력표 `expiresAt`(서버가 토큰 exp 에서 산출).
 * 🔴 포털은 토큰을 갱신하지 않는다(계정 1시간·등록번호 30분) — 작성 중에 끝나면 입력이 사라진다. 끝나기 전에 말한다.
 */
export function SessionExpiryNotice() {
  const { data } = usePortalSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const min = minutesUntilExpiry(data?.expiresAt, now);
  if (min == null) return null;
  return (
    <div role="status" className="mx-auto max-w-5xl px-4 pt-3" data-portal-session-expiring={min}>
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <b><PT k="로그인이 곧 끝납니다" /></b> · <PT k="남은 시간" /> {min}<Unit>분</Unit> — <PT k="작성 중인 내용은 먼저 저장하세요. 끝나면 다시 로그인해야 합니다." />
      </p>
    </div>
  );
}
