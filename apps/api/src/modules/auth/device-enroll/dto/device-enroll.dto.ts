import { IsIn, IsObject, IsOptional, IsString, Length } from 'class-validator';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export class EnrollStartDto {
  @IsString()
  staffUserId!: string;

  /** IN_PERSON(고보증 역할 필수) / REMOTE. 미지정 시 역할 기반 자동 */
  @IsOptional()
  @IsIn(['IN_PERSON', 'REMOTE'])
  enrollMode?: 'IN_PERSON' | 'REMOTE';

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class EnrollClaimDto {
  @IsString()
  code!: string;
}

export class EnrollRegisterDto {
  @IsString()
  code!: string;

  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class DeviceRevokeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/** 원격 등록 2차 인증 — 등록 코드와 **다른 secret** 이라 DTO 도 따로 둔다 */
export class EnrollRemoteFactorDto {
  @IsString()
  @Length(4, 8)
  code!: string;
}
