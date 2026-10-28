import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * 진료 기반 수납 생성 요청 본문.
 *
 * 🔴 `class-validator` DTO 여야 전역 ValidationPipe 가 돈다(인라인 타입은 metatype 이 `Object` 라 스킵).
 * 🔴 전역 `whitelist: true` 는 DTO 에 없는 키를 조용히 지운다 — 화면이 보내는 키를 여기 다 적는다.
 */
export class CreateBillingDto {
  @ApiPropertyOptional({
    description:
      '환자 앱 "수납 대기" 푸시 발송 여부(명시 옵트인). 기본 false — 미지정이면 reason=NOT_REQUESTED. ' +
      'true 여도 시스템 설정(notification.patientPush.enabled + types.BILLING)이 둘 다 켜져 있어야 나간다.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}
