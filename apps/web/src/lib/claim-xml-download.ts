import { apiClient } from '@/lib/api-client';

/**
 * 청구 XML 내려받기 — 인증 헤더를 실어 받는다(2026-10-14 수납·청구 결함 발굴 P4-3).
 * 🔴 종전엔 `window.open('/api/v1/claims/:id/xml')` — 새 창은 Bearer 헤더가 없어 **늘 401** 이었다(목록·상세 두 곳).
 *    서버가 파일을 만들지 않은 이유(422 — 보험유형·진료일·항목 코드 확인 불가 등)는 그대로 돌려준다.
 * @returns null = 내려받음 · 문자열 = 실패 사유(화면이 말한다)
 */
export async function downloadClaimXml(claimId: string): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_API_URL || '';
  const token = apiClient.getToken();
  const res = await fetch(`${base}/api/v1/claims/${claimId}/xml`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
    return body?.error?.message ?? body?.message ?? `HTTP ${res.status}`;
  }
  const blob = await res.blob();
  const name = /filename=([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `claim-${claimId}.xml`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  return null;
}
