import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateQrDto {
  @IsIn(['LOGIN', 'CLOCK', 'ATTEND', 'RECEIPT']) purpose!: string;
  @IsOptional() @IsString() @MaxLength(30) refType?: string;
  @IsOptional() @IsString() @MaxLength(64) refId?: string;
}

export class ScanDto {
  @IsString() @MaxLength(64) token!: string;
}
