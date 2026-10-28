import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length } from 'class-validator';

/** 🔴 인라인 `@Body` 를 쓰지 않는다 — 검증이 통째로 스킵된다 */
export class ApplyCategoryDeriveDto {
  @ApiProperty({ description: '적용할 코드 접두(제안 목록에 있는 것만 통과)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(1, 8, { each: true })
  prefixes!: string[];
}
