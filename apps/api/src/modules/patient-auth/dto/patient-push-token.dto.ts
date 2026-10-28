import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * 환자 앱 푸시 토큰 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 * 빈 본문이면 `deviceId: undefined` 로 upsert 복합키가 깨져 500, `platform` 이 컬럼 길이(VarChar 20)를 넘어도 500.
 * 필드 이름·검증은 로그인 DTO(`PatientLoginDto`)의 같은 필드와 같다. 모바일(usePushNotifications)이 보내는 키와 기계 대조한다.
 */
export class UpdatePatientFcmTokenDto {
  @ApiProperty({ description: '기기 ID' }) @IsString() @IsNotEmpty() deviceId!: string;
  @ApiProperty({ description: 'FCM 푸시 토큰' }) @IsString() @IsNotEmpty() fcmToken!: string;
}

export class RegisterPatientPushTokenDto extends UpdatePatientFcmTokenDto {
  @ApiProperty({ description: '플랫폼 (iOS, Android, Web — patient_devices.platform VarChar 20)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  platform!: string;
}
