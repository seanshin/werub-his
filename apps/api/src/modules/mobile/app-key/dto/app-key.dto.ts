import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

const APPS = ['PATIENT_IOS', 'STAFF_IOS'] as const;

export class AttestationChallengeDto {
  @ApiProperty({ enum: APPS })
  @IsIn(APPS as unknown as string[])
  app!: 'PATIENT_IOS' | 'STAFF_IOS';

  @ApiProperty({ description: '앱이 Keychain 에 보관하는 설치 식별자(UUID)' })
  @IsString() @Length(8, 64)
  installationId!: string;

  @ApiProperty() @IsString() @Length(3, 100)
  bundleId!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  appVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  osVersion?: string;
}

export class AttestationRegisterDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  challengeId!: string;

  @ApiProperty() @IsString() @Length(8, 64)
  installationId!: string;

  @ApiProperty({ description: 'Apple generateKey() 의 keyId(base64)' })
  @IsString() @Length(8, 128)
  keyId!: string;

  @ApiProperty({ description: 'base64 CBOR' })
  @IsString() @IsNotEmpty()
  attestationObject!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  appVersion?: string;
}

export class AssertionChallengeDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  appKeyId!: string;

  @ApiProperty({ description: '이 assertion 이 무엇을 위한 것인가 — 다른 목적으로 전용 불가' })
  @IsString() @Matches(/^[A-Z_]{3,60}$/)
  purpose!: string;

  @ApiProperty() @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
  method!: string;

  @ApiProperty() @IsString() @Matches(/^\/[\w\-./{}:]*$/)
  path!: string;

  @ApiPropertyOptional({ description: 'base64url sha256 of canonical unsigned body' })
  @IsOptional() @IsString() @Length(43, 44)
  bodySha256?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sessionId?: string;
}

export class RevokeAppKeyDto {
  @ApiProperty() @IsString() @Length(2, 255)
  reason!: string;
}
