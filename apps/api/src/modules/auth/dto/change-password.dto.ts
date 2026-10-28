import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * 본인 비밀번호 변경 — 🔴 (2026-09-15) 종전 인라인 `@Body() body: { currentPassword; newPassword }` 라
 *    ValidationPipe 가 통째로 스킵됐다(빈 본문이면 bcrypt 가 undefined 를 받아 500 경로).
 * 🔴 강도 규칙(길이·문자 조합)은 여기에 적지 않는다 — 정본은 `password-policy.ts` 이고 런타임 설정(강화 전용)을
 *    읽어야 해서 데코레이터(로딩 시점 고정)로 둘 수 없다. 여기서는 "문자열이고 비어 있지 않다"만 본다.
 */
export class ChangePasswordDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(256) currentPassword!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(256) newPassword!: string;
}
