import { SetMetadata } from '@nestjs/common';

/** FeatureAccessGuard 가 읽는 메타데이터 키 */
export const REQUIRE_FEATURE = 'require_feature';

/**
 * 핸들러/컨트롤러에 기능 진입 권한을 요구한다.
 * 반드시 JwtAuthGuard + FeatureAccessGuard 와 함께 사용.
 *   @UseGuards(JwtAuthGuard, FeatureAccessGuard)
 *   @RequireFeature('terminal.admin')
 */
export const RequireFeature = (featureKey: string) => SetMetadata(REQUIRE_FEATURE, featureKey);
