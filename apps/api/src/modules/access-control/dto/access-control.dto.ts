import { IsArray, IsString, IsObject, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetDeptAccessDto {
  @ApiProperty({ description: '허용 경로 목록', example: ['/dashboard', '/patients'] })
  @IsArray()
  @IsString({ each: true })
  allowedPaths: string[];
}

export class SetRoleDataAccessDto {
  @ApiProperty({ description: '권한 설정 맵', example: { canViewDiagnosis: true, canViewLab: false } })
  @IsObject()
  permissions: Record<string, boolean>;
}

export class SetPacsAccessDto {
  @ApiProperty({
    description: 'PACS 권한 설정 맵',
    example: { studyView: true, reportView: true, reportCreate: false, reportSign: false, viewerAccess: true, worklistManage: false, orderCreate: false, aiInference: false, adminAccess: false },
  })
  @IsObject()
  permissions: Record<string, boolean>;
}

export class SetUserPacsOverrideDto {
  @ApiProperty({
    description: '사용자 개별 PACS 권한 오버라이드',
    example: { reportCreate: true, reportSign: true },
  })
  @IsObject()
  permissions: Record<string, boolean>;
}

export class SetFeatureAccessDto {
  @ApiPropertyOptional({ description: '역할별 허용 매트릭스 (미설정 시 defaultRoles)', example: { CRM_STAFF: true, DOCTOR: false } })
  @IsOptional()
  @IsObject()
  roles?: Record<string, boolean>;

  @ApiPropertyOptional({ description: '명시 허용 사용자 ID 목록', example: ['uuid-a'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grants?: string[];

  @ApiPropertyOptional({ description: '명시 차단 사용자 ID 목록 (최우선)', example: ['uuid-b'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  denies?: string[];
}
