import { NextResponse } from 'next/server';

// 무중단 전환(cutover)·PM2 헬스체크용. 앱 프로세스 가동 = 200.
// 기본은 가볍게 200(외부 API 블립으로 헬스 플래핑 방지). ?deep=1 시 HIS API 도달성 확인.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';
  const base = { status: 'ok', service: 'werubyhosp-homepage', ts: new Date().toISOString() };
  if (!deep) return NextResponse.json(base);

  const api = process.env.INTERNAL_API_URL || process.env.HOMEPAGE_API_ORIGIN || '';
  let apiOk = false;
  try {
    const ctrl = AbortSignal.timeout(3000);
    const r = await fetch(`${api}/api/v1/public/departments`, { signal: ctrl, cache: 'no-store' });
    apiOk = r.ok;
  } catch { apiOk = false; }
  // deep 모드에서도 앱 자체는 200 — API 상태는 본문으로 보고(전환 차단은 인프라 판단)
  return NextResponse.json({ ...base, apiOk });
}
