import { IsString } from 'class-validator';

export class SsoGrantDto {
  /** ohif | pacs | jitsi | clinic */
  @IsString()
  audience!: string;
}

export class SsoRedeemDto {
  @IsString()
  code!: string;
}

export class SsoIntrospectDto {
  @IsString()
  token!: string;
}
