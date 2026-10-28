import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

// 콘텐츠 즉시 반영(On-demand ISR) — HIS 홈페이지관리에서 호출. 재빌드 불필요.
// 시크릿(HOMEPAGE_REVALIDATE_SECRET·런타임 env) 일치해야 동작. /api 가 아니므로 프록시와 무관.
export const dynamic = 'force-dynamic';

const SECRET = process.env.HOMEPAGE_REVALIDATE_SECRET || '';
const DEFAULT_PATHS = [
  '/home', '/news', '/health-info', '/about', '/checkup',
  '/care/departments', '/care/doctors', '/care/centers',
];

export async function POST(req: Request) {
  const got = req.headers.get('x-revalidate-secret') ?? new URL(req.url).searchParams.get('secret') ?? '';
  if (!SECRET || got !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let paths: string[] = DEFAULT_PATHS;
  let all = false;
  try {
    const body = await req.json();
    if (Array.isArray(body?.paths) && body.paths.length) paths = body.paths.filter((p: unknown) => typeof p === 'string').slice(0, 100);
    if (body?.all === true) all = true;
  } catch { /* 본문 없으면 기본 경로 */ }

  const revalidated: string[] = [];
  try {
    if (all) {
      revalidatePath('/', 'layout'); // 전체(동적 포함)
      revalidated.push('/(layout)');
    } else {
      for (const p of paths) { revalidatePath(p); revalidated.push(p); }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, revalidated, ts: new Date().toISOString() });
}
