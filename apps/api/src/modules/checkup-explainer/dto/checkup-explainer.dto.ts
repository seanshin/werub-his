import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertExplainerDto {
  @ApiProperty({ description: '검사 코드(CheckupTestMaster.code)' })
  @IsString() @IsNotEmpty() testCode: string;

  @ApiProperty() @IsString() @IsNotEmpty() testName: string;

  @ApiPropertyOptional({ description: '이 검사는 무엇을 보나요(한 문장)' })
  @IsOptional() @IsString() plainWhat?: string;

  @ApiPropertyOptional({ description: '일반적 의미(단정 금지)' })
  @IsOptional() @IsString() plainMeaning?: string;

  @ApiPropertyOptional({ description: '참고 생활정보' })
  @IsOptional() @IsString() lifestyleInfo?: string;

  @ApiPropertyOptional({ description: '이럴 땐 진료를 권해요' })
  @IsOptional() @IsString() whenToSeeDoctor?: string;

  @ApiPropertyOptional({ description: '근거(가이드라인·기관)' })
  @IsOptional() @IsString() sourceRef?: string;
}

export class ReviewExplainerDto {
  @ApiProperty({ description: 'APPROVED | REJECTED' })
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: '감수 소견' })
  @IsOptional() @IsString() reviewNote?: string;
}
