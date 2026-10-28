import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 🔴 인라인 `@Body` 는 ValidationPipe 를 건너뛴다 — 폐지는 되돌리기 어려운 변경이라 더 그렇다. */
export class CodeRetireDto {
  /** 종료일(YYYY-MM-DD) — 이 날짜까지 유효했다는 뜻 */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '종료일은 YYYY-MM-DD 형식이어야 합니다' })
  validTo!: string;

  /** 후속(대체) 코드 — 🔴 필수로 강제하지 않는다. 대체가 없는 폐지도 있고, 강제하면 아무 값이나 넣는다. */
  @IsOptional() @IsString() @MaxLength(20)
  successorCode?: string;

  @IsString()
  @MinLength(2, { message: '폐지 사유가 필요합니다' })
  @MaxLength(300)
  reason!: string;
}
