/**
 * 🔴 (2026-09-15 U4) 저장 컬럼 길이에 맞춰 사용자 입력을 자르는 자리의 정본 — **자르면 잘랐다고 말한다.**
 *
 * 종전엔 서비스가 `x?.slice(0, N)` 으로 조용히 잘라 저장했고, 사용자는 입력한 메모가 온전히 남았다고 믿었다.
 * 자리 성격으로 두 갈래를 쓴다(가드: `test/architecture/stored-field-truncation-guard.spec.ts`).
 *  · 임상·법적 기록(사유·소견) — 자르지 않는다. DTO `@MaxLength`(스키마 길이) 로 400 을 돌려 사용자가 고치게 한다.
 *  · 운영 메모류 — 잘라 저장하되 `TruncationRecorder` 로 모은 `truncatedFields` 를 응답에 싣는다.
 *  · 파생 저장(다른 기록의 전문이 따로 남는 경우) — `truncateWithNote` 로 저장값 자체에 잘렸다는 표시를 남긴다.
 */

export interface TruncatedField {
  /** 응답 소비처가 입력칸을 가리킬 수 있는 필드 경로(예: `items[2].notes`) */
  field: string;
  /** 저장 한도(스키마 길이) */
  max: number;
  /** 사용자가 보낸 길이(trim 뒤) */
  receivedLength: number;
}

export class TruncationRecorder {
  readonly truncatedFields: TruncatedField[] = [];

  /** 앞에서부터 max 자만 남긴다. 잘렸으면 기록한다. `null`/`undefined` 는 그대로 돌려준다 */
  clip<T extends string | null | undefined>(field: string, value: T, max: number): T {
    if (value == null || value.length <= max) return value;
    this.truncatedFields.push({ field, max, receivedLength: value.length });
    return value.slice(0, max) as T;
  }

  /** 누적 이력(`앞 | 뒤`)처럼 **최신이 뒤에 붙는** 값 — 뒤를 남기고 앞을 `…` 로 접는다. 잘렸으면 기록한다 */
  clipKeepTail(field: string, value: string, max: number): string {
    if (value.length <= max) return value;
    this.truncatedFields.push({ field, max, receivedLength: value.length });
    return `…${value.slice(value.length - (max - 1))}`;
  }
}

/** 잘릴 때 저장값 끝에 표시(note)를 남긴다 — 결과 길이는 max 를 넘지 않는다 */
export function truncateWithNote(text: string, max: number, note: string): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - note.length)) + note;
}
