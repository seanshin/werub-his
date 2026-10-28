import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 임상경로 발행 — 의결 근거(선택).
 *
 * 🔴 인라인 `@Body()` 로 받으면 런타임 metatype 이 `Object` 라 ValidationPipe 가 스킵된다(§8).
 * 🔴 `decisionNo` 는 **선택**이다 — 없어도 발행은 된다(막으면 진료가 멈춘다).
 *    다만 없이 발행하면 "의결 근거 없음"으로 남는다.
 */
export class PublishPathwayDto {
  @IsOptional() @IsString() @MaxLength(30)
  decisionNo?: string;
}
