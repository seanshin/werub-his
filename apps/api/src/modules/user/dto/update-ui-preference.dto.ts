import { IsIn, IsOptional } from 'class-validator';
import { TERM_LANG_MODES, activeLocaleCodes, type TermLangMode, type UiLocale } from '@hospital-run/shared';

/**
 * 내 화면 표시 선호 — 🔴 class 선언(interface 는 ValidationPipe 가 스킵). 어휘는 shared 정본.
 * 부분 갱신: 보낸 필드만 바꾼다(둘 다 없으면 서비스가 400).
 */
export class UpdateUiPreferenceDto {
  @IsOptional()
  @IsIn(TERM_LANG_MODES as unknown as string[])
  termLang?: TermLangMode;

  /**
   * 🔴 선택 가능한 언어는 **팩이 정한다**(§9) — 하드코딩 목록을 두면 언어 팩을 넣어도
   *    서버가 거부한다. 데코레이터는 모듈 로딩 시 1회 평가되고, 그 시점엔 shared 의
   *    side-effect import 로 빌트인·추가 팩이 모두 등록돼 있다.
   *    보류(DEFERRED) 언어는 목록에 없으므로 저장도 거부된다(선택지 밖 = 저장 밖).
   */
  @IsOptional()
  @IsIn(activeLocaleCodes())
  uiLocale?: UiLocale;
}
