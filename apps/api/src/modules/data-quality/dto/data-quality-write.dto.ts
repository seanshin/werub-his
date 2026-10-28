import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const OUTREACH_TYPES = ['recall', 'infoUpdate', 'passportExpiry'] as const;

/**
 * 🔴 (2026-09-15 B10) C3 안내 초안 — 유형 오타는 서비스가 **조용히 `recall`** 로 바꿔 다른 목적의 문안을 돌려줬다.
 *    언어 값은 AI 프롬프트에 그대로 들어가므로 길이 상한을 둔다.
 */
export class OutreachDraftDto {
  @ApiPropertyOptional({ enum: OUTREACH_TYPES, description: '기본 recall' }) @IsOptional() @IsIn(OUTREACH_TYPES as unknown as string[]) type?: (typeof OUTREACH_TYPES)[number];
  @ApiPropertyOptional({ description: '기본 ko' }) @IsOptional() @IsString() @MaxLength(16) language?: string;
}

/**
 * 🔴 (2026-09-15 B10) C4 전화 정규화 적용 — 환자 연락처를 **고쳐 쓰는** 경로다.
 *  - 서비스가 `ids.slice(0, 100)` 로 101번째부터 **말없이 버렸고**(자르면 잘랐다고 말한다) —
 *  - uuid 아닌 id 가 섞이면 앞 id 들을 이미 고친 뒤 루프 중간에 Prisma 500 이 나서, 화면은 실패로 보는데 일부는 적용된 상태가 됐다.
 *  입구에서 전량 검사한다(최대 100 = 미리보기 상한).
 */
export class NormalizeApplyDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids: string[];
}
