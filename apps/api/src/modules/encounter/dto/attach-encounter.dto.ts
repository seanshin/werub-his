import { IsString, IsOptional, IsIn } from 'class-validator';

/** 진료 첨부(타블렛 펜 스케치 등) — base64 dataURL 수신. */
export class AttachEncounterDto {
  @IsString()
  dataUrl!: string; // data:image/png;base64,... | data:image/jpeg;base64,...

  @IsOptional()
  @IsString()
  @IsIn(['SKETCH', 'IMAGE', 'FILE'])
  kind?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
