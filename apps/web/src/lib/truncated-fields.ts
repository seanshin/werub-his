/**
 * 🔴 (2026-09-15 U4) 서버가 운영 메모류를 저장 길이에 맞춰 잘랐을 때 응답에 싣는 `truncatedFields` 읽기
 * (정본: api `common/stored-truncation.ts`). 자르면 잘랐다고 말한다 — 화면은 성공 토스트와 함께 경고를 띄운다.
 */
export interface TruncatedField {
  field: string;
  max: number;
  receivedLength: number;
}

/** `{ data: { truncatedFields } }`(apiClient 응답) 또는 `{ truncatedFields }` 어느 쪽이든 읽는다. 없거나 모양이 다르면 빈 목록 */
export function truncatedFieldsOf(res: unknown): TruncatedField[] {
  const body = res as { data?: { truncatedFields?: unknown }; truncatedFields?: unknown } | null | undefined;
  const list = body?.data?.truncatedFields ?? body?.truncatedFields;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (f): f is TruncatedField =>
      !!f && typeof (f as TruncatedField).field === 'string' && typeof (f as TruncatedField).max === 'number',
  );
}

/** `title(200) · items[1].notes(300)` — 번역 보간 자리에 넣는 필드 요약(필드 경로·숫자만) */
export function truncationSummary(list: TruncatedField[]): string {
  return list.map((f) => `${f.field}(${f.max})`).join(' · ');
}
