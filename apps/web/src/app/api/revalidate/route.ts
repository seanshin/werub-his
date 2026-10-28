import { timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

/**
 * HIS 앱 안 `(homepage)` 그룹의 ISR 캐시 무효화.
 *
 * 🔴 2026-09-13 · 상용 릴리즈 T4 잔여 — 종전엔 `REVALIDATE_SECRET || '<저장소에 적힌 문자열>'` 이었다.
 *    판매본에서 값을 안 넣으면 **누구나 아는 비밀로** 캐시를 무효화할 수 있었다(공개 폴백).
 *    비밀이 없으면 **거부한다(503)** — 조용히 통과시키지도, 리터럴로 떨어지지도 않는다.
 *    개발 편의 폴백은 두지 않는다: 이 라우트를 부르는 코드가 저장소에 없다(홈페이지 즉시 반영은
 *    API `hospital-info.service` 가 별도 앱 `apps/homepage` 의 `/revalidate` 를 `HOMEPAGE_REVALIDATE_SECRET` 로 부른다).
 */
function secretMatches(got: string | null, expected: string): boolean {
  if (got == null) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: 'REVALIDATE_SECRET 미설정 — 재검증 요청을 거부합니다' }, { status: 503 });
  }
  if (!secretMatches(req.headers.get('x-revalidate-secret'), expected)) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  // 홈페이지 전체 캐시 무효화
  revalidatePath('/home', 'page');
  revalidatePath('/news', 'page');
  revalidatePath('/health-info', 'page');
  revalidatePath('/care/departments', 'page');
  revalidatePath('/care/centers', 'page');
  revalidatePath('/checkup', 'page');

  return NextResponse.json({ revalidated: true, now: new Date().toISOString() });
}
