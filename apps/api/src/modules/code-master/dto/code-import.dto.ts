import { IsIn, IsString, MaxLength, Matches, MinLength } from 'class-validator';

/**
 * 🔴 인라인 `@Body()` 는 **ValidationPipe 가 통째로 스킵된다**(v4.3.0 실측).
 *    고시 파일은 외부에서 들어오는 큰 텍스트라 검증 없이 받으면 안 된다.
 */
export class CodeImportDto {
  @IsIn(['diagnosis', 'procedure', 'medication'], { message: 'kind 는 diagnosis·procedure·medication 중 하나여야 합니다' })
  kind!: 'diagnosis' | 'procedure' | 'medication';

  /** CSV/TSV 본문(헤더 포함). 🔴 상한을 둔다 — 무제한 본문은 메모리를 태운다 */
  @IsString()
  @MinLength(2, { message: '내용이 비어 있습니다' })
  @MaxLength(8_000_000, { message: '파일이 너무 큽니다(8MB 상한) — 나눠서 올리세요' })
  content!: string;

  /** 시행일(YYYY-MM-DD) — 이 날짜부터 새 값이 유효하다 */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '시행일은 YYYY-MM-DD 형식이어야 합니다' })
  effectiveDate!: string;
}
