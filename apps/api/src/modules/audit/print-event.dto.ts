import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** 인쇄 시도 감사 이벤트 — PrintGuard(FE)가 보고. 인라인 @Body 는 ValidationPipe 를 타지 않으므로 DTO 필수(규약). */
export class PrintEventDto {
  /** BLOCKED=차단된 단축키 시도 · SANCTIONED=지정 버튼 인쇄 · PRINT_ROUTE=전용 /print/* 인쇄 */
  @IsIn(['BLOCKED', 'SANCTIONED', 'PRINT_ROUTE'])
  kind!: 'BLOCKED' | 'SANCTIONED' | 'PRINT_ROUTE';

  @IsString()
  @MaxLength(300)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  detail?: string;
}
