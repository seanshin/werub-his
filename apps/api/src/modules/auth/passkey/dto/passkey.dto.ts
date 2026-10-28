import { IsObject, IsOptional, IsString } from 'class-validator';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

export class PasskeyRegisterVerifyDto {
  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  deviceName?: string;
}

export class PasskeyLoginOptionsDto {
  /** 선택: 식별자(이메일/사번). 없으면 discoverable credential 흐름 */
  @IsOptional()
  @IsString()
  identifier?: string;
}

export class PasskeyLoginVerifyDto {
  @IsString()
  flowId!: string;

  @IsObject()
  response!: AuthenticationResponseJSON;
}

export class PasskeyRenameDto {
  @IsString()
  deviceName!: string;
}
