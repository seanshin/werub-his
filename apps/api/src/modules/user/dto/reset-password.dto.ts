import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

export class ResetPasswordDto {
  @ApiProperty({ required: false, description: `새 비밀번호 (최소 ${PASSWORD_MIN_LENGTH}자) — 비우면 서버가 일회용 임의 비밀번호를 발급해 응답 issuedPassword 로 1회 반환` })
  @IsOptional()
  @IsString()
  /**
   * 🔴 종전엔 **6** 이었다 — 사용자 생성·로그인은 8인데 **재설정만 6**이라
   *    선언한 정책의 뒷문이 됐다(관리자가 초기화하면 8자 정책 아래로 내려간다).
   */
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword?: string;
}
