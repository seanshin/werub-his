import { apiClient } from '@/lib/api-client';

/**
 * multipart 파일 업로드 공용 헬퍼 — apiClient는 JSON 전용이라 fetch를 쓰되,
 * 인증은 apiClient와 동일한 Bearer 토큰을 반드시 동봉(쿠키만으로는 401 — 실측 결함 수정).
 * 실패 시 서버 error.message를 담은 Error throw.
 */
export async function uploadMultipart(path: string, file: File, field = 'file'): Promise<unknown> {
  const formData = new FormData();
  formData.append(field, file);
  const token = apiClient.getToken?.();
  const res = await fetch(path, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `업로드 실패 (HTTP ${res.status})`);
  }
  return res.json().catch(() => null);
}

/**
 * 첨부 업로드 응답에서 **서버가 말한** 현재 첨부 수를 읽는다 — 읽을 수 없으면 `null`(모름).
 * 🔴 (2026-09-14 Q5) 외국인 환자 동의서 첨부가 응답 모양을 못 읽으면 `이전 수 + 1` 로 **추정**해
 *    "첨부 완료 (N개)" 를 띄웠다 — 이전 수가 모르는 값일 수 있고, 다른 사람이 같은 동의서에 붙인 것도 모른다.
 *    `{ data: { attachments } }` 와 인터셉터가 한 번 더 감싼 `{ data: { data: { attachments } } }` 둘 다 읽는다.
 */
export function attachmentCountFrom(body: unknown): number | null {
  const d = (body as { data?: unknown } | null)?.data as { attachments?: unknown; data?: { attachments?: unknown } } | undefined;
  const list = Array.isArray(d?.attachments) ? d.attachments : Array.isArray(d?.data?.attachments) ? d.data.attachments : null;
  return list ? list.length : null;
}
