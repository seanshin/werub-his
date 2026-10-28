import { IsUUID, IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignErBedDto {
  @ApiProperty({ description: '응급 방문 ID' })
  @IsUUID()
  visitId: string;

  @ApiProperty({ description: '베드 ID' })
  @IsUUID()
  bedId: string;
}

export class MoveErBedDto {
  @ApiProperty({ description: '응급 방문 ID' })
  @IsUUID()
  visitId: string;

  @ApiProperty({ description: '이동할 베드 ID' })
  @IsUUID()
  toBedId: string;
}

export class ReleaseErBedDto {
  @ApiProperty({ description: '응급 방문 ID' })
  @IsUUID()
  visitId: string;

  @ApiPropertyOptional({ description: '해제 사유 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateErBedDto {
  @ApiProperty({ description: '구역 코드 (대문자 2~10자, 예: RESUS·ACUTE)' })
  @IsString()
  @MaxLength(10)
  zone: string;

  @ApiProperty({ description: '베드 번호 (숫자 1~3자리)' })
  @IsString()
  @MaxLength(3)
  bedNumber: string;
}

export class RenameErBedDto extends CreateErBedDto {}

export class ErBedStatusDto {
  // OCCUPIED 는 배정 경로로만 — 상태 EP 로 점유를 위조할 수 없게 목록에서 제외
  @ApiProperty({ description: '베드 상태', enum: ['AVAILABLE', 'CLEANING', 'MAINTENANCE', 'ISOLATION', 'RESERVED'] })
  @IsIn(['AVAILABLE', 'CLEANING', 'MAINTENANCE', 'ISOLATION', 'RESERVED'])
  status: string;
}
