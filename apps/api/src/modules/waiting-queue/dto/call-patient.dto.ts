import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * 환자 호출 요청 본문.
 *
 * 🔴 `class-validator` DTO 여야 전역 ValidationPipe 가 돈다 — 인라인 타입/인터페이스는 런타임
 *    metatype 이 `Object` 라 검증이 통째로 스킵된다(v4.3.0 실측).
 * 🔴 필드를 늘릴 때는 화면이 실제로 보내는 키를 먼저 확인한다 — 전역 `whitelist: true` 는
 *    DTO 에 없는 키를 200 을 주면서 조용히 지운다.
 */
export class CallPatientDto {
  @ApiPropertyOptional({
    description:
      '환자 앱 푸시 발송 여부(명시 옵트인). 기본 false — 미지정이면 푸시하지 않는다(reason=NOT_REQUESTED). ' +
      'true 여도 시스템 설정(notification.patientPush.enabled + types.CALLED)이 둘 다 켜져 있어야 실제로 나간다.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}
