import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LOGIN_INPUT_MIN_LENGTH } from '../password-policy';

export class LoginDto {
  @ApiProperty({ example: 'admin@hospitalrun.example' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'admin1234!' })
  @IsString()
  /**
   * 🔴 **정책이 아니라 입력 하한이다.** 로그인은 이미 있는 비밀번호를 받는다 —
   *    여기에 신규 정책(12자)을 걸면 그보다 짧은 기존 계정이 **전부 로그인 불가**가 된다
   *    (운영 시드 계정이 10자다). 정책은 비밀번호를 **바꿀 때** 적용한다.
   */
  @MinLength(LOGIN_INPUT_MIN_LENGTH)
  password: string;
}
