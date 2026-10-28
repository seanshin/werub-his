import { IsIn } from 'class-validator';

/** 인증서 설정 안내 발송 대상 — FE 선택지와 한 벌 */
export class NotifySetupDto {
  @IsIn(['ALL', 'DOCTOR', 'NURSE', 'PHARMACIST'])
  target!: 'ALL' | 'DOCTOR' | 'NURSE' | 'PHARMACIST';
}
