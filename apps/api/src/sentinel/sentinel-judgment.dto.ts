import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SENTINEL_JUDGMENT_VERDICTS, type SentinelJudgmentVerdict } from '@hospital-run/shared';

const AXES = ['DATA', 'FLOW', 'CONTRACT', 'PIPE'] as const;

/** AI 판정 보조 요청 — 발견 좌표만 받는다(무엇을 물을지는 서버가 발견 행에서 만든다) */
export class AdviceRequestDto {
  @IsIn(AXES as unknown as string[])
  axis!: (typeof AXES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[\w.\-]+$/, { message: 'checkKey 형식이 아닙니다' })
  checkKey!: string;
}

/**
 * 판정 기록 요청 — 🔴 class 로 선언한다(interface/교차 타입은 ValidationPipe 가 통째로 스킵).
 * 판정 시점 건수는 받지 않는다 — 서버가 발견 행에서 직접 스냅샷한다.
 */
export class RecordJudgmentDto {
  @IsIn(AXES as unknown as string[])
  axis!: (typeof AXES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[\w.\-]+$/, { message: 'checkKey 형식이 아닙니다' })
  checkKey!: string;

  @IsIn(SENTINEL_JUDGMENT_VERDICTS as unknown as string[])
  verdict!: SentinelJudgmentVerdict;

  /** 🔴 근거 필수 — 실측·문서 참조 없이 한두 글자로 판정하지 못하게 하한을 둔다 */
  @IsString()
  @MinLength(10, { message: '판정 근거를 적어 주세요(10자 이상 — 무엇을 실측/참조했는지)' })
  @MaxLength(2000)
  basis!: string;
}
