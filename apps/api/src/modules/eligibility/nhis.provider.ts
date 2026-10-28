import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { EligibilityProvider, EligibilityInput, EligibilityResult } from './eligibility.types';

/**
 * NHIS/보훈 실연동 **프록시 어댑터(시드)** — 운영 전환 시 실 자격검증을 연결하는 자리.
 *
 * 설계 원칙(실서비스 대응): `docs/01-plan/features/production-service-integration.plan.md` 참조.
 * - 데이터 흐름·화면·DTO는 SIMULATION과 100% 동일(EligibilityProvider 동일 인터페이스).
 * - 외부 호출부만 이 어댑터에 격리. `eligibility.mode=NHIS`일 때 EligibilityService가 선택.
 * - 실 연결(공단 자격조회 API·공인인증/보안매체, 보훈처 국비대상 검증)은 **운영 시** 구현.
 *   현재는 미구성이면 명확히 503으로 실패(가짜 자격이 실 데이터로 처리되는 것 방지).
 *
 * 운영 전환 체크리스트:
 *  1) config `eligibility.apiUrl`·`eligibility.apiKey`(공단), `eligibility.patriotApiUrl`(보훈) 주입
 *  2) 공인인증서/보안매체·요양기관 인증 핸드셰이크 구현(아래 callNhis/callPatriot)
 *  3) 응답 매핑(공단 자격구분→CopayCategory, 보훈 국비대상→PATRIOT)
 *  4) `eligibility.mode=NHIS` 토글
 */
@Injectable()
export class NhisEligibilityProvider implements EligibilityProvider {
  readonly source = 'NHIS' as const;
  private readonly logger = new Logger(NhisEligibilityProvider.name);

  constructor(private readonly config: ConfigRuntimeService) {}

  async check(input: EligibilityInput): Promise<EligibilityResult> {
    const apiUrl = (await this.config.get('eligibility.apiUrl')) as string | undefined;
    const apiKey = (await this.config.get('eligibility.apiKey')) as string | undefined;

    // 미구성: 운영 전환 전 — 프록시만 존재, 실 연결은 미구현. 명확히 실패(시뮬레이션 폴백 금지).
    if (!apiUrl || !apiKey) {
      this.logger.warn('NHIS 자격조회 실연동 미구성(eligibility.apiUrl/apiKey). 운영 전환 시 연결 필요.');
      throw new ServiceUnavailableException({
        error: 'ELIGIBILITY_NHIS_NOT_CONFIGURED',
        message: '공단 자격조회 실연동이 구성되지 않았습니다. (개발: eligibility.mode=SIMULATION 사용)',
      });
    }

    // ── 운영 구현 자리(프록시) ──────────────────────────────────────────────
    // 보훈(국가유공자) 우선 분기: 보훈 대상이면 국비부담(PATRIOT).
    //   const patriot = await this.callPatriot(input);  // 보훈처/보훈병원 위탁 자격
    //   if (patriot?.eligible) return { status:'VERIFIED', copayCategory:'PATRIOT', ... , source:this.source };
    //
    // 공단 자격조회(요양기관 인증·공인인증서/보안매체):
    //   const res = await this.callNhis(apiUrl, apiKey, input);
    //   return this.mapNhisToResult(res);   // 자격구분→CopayCategory, 산정특례 V코드, 자격상실 등
    // ────────────────────────────────────────────────────────────────────────
    throw new ServiceUnavailableException({
      error: 'ELIGIBILITY_NHIS_NOT_IMPLEMENTED',
      message: '공단/보훈 자격조회 어댑터(callNhis/callPatriot)가 아직 구현되지 않았습니다(프록시 시드).',
    });
  }
}
