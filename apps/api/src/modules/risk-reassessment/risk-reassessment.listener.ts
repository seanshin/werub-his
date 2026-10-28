import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RiskReassessmentService } from './risk-reassessment.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 위험 재평가 스케줄의 생명주기 배선 — 입원하면 생기고, 재원이 끝나면 닫힌다.
 *
 * 🔴 2026-08-18 이전 실측: `autoCreateOnAdmission` 은 EP·서비스가 다 있는데 **호출처가 전역 0**이라
 *    `risk_reassessment_schedules` 가 0행이었다. 배선을 미뤄둔 사유는 세 가지였고, 각각 이렇게 해소했다.
 *      1) 퇴원 시 스케줄을 닫을 경로가 없었다(수동 버튼뿐) → `admission.closed` 도메인 이벤트 신설.
 *         **닫는 쪽은 게이트와 무관하게 항상 돈다** — 수동으로 만든 기존 스케줄도 닫아야 하기 때문이다.
 *      2) 입원 생성 경로 둘 중 하나만 `admission.created` 를 emit 했다 → 두 경로 모두 emit 하도록 통일.
 *      3) 주기 표가 환자안전위원회 미확정 잠정값이다 → **생성만** config 게이트 뒤에 둔다
 *         (`risk.reassessment.autoCreate` 기본 OFF). 확정 전에 켜면 잘못된 주기로 법정기록이 쌓인다.
 *
 * 🔴 게이트가 OFF 인 동안 이 리스너는 "생성했다"고 말하지 않는다 — 켜기 전까지 스케줄은 계속 0행이고,
 *    그것이 사실이다(관리 화면도 그렇게 표시한다).
 */
@Injectable()
export class RiskReassessmentListener {
  private readonly logger = new Logger(RiskReassessmentListener.name);

  constructor(
    private readonly service: RiskReassessmentService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  @OnEvent('admission.created', { async: true })
  async onAdmissionCreated(p: { admissionId: string; patientId: string }) {
    if (!p?.admissionId || !p?.patientId) return;
    // 게이트 미주입(테스트·부분 부트)일 때는 켜지 않는다 — 모르면 안전측으로 접는다
    const on = (await this.config?.get('risk.reassessment.autoCreate')) === true;
    if (!on) return;
    try {
      const created = await this.service.autoCreateOnAdmission(p.patientId, p.admissionId);
      if (created.length) this.logger.log(`재평가 스케줄 자동 생성 admission=${p.admissionId} ${created.length}건`);
    } catch (e) {
      // 스케줄 생성 실패가 입원을 막지 않는다(비차단) — 다만 조용히 넘기지 않고 남긴다
      this.logger.warn(`재평가 스케줄 자동 생성 실패 admission=${p.admissionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @OnEvent('admission.closed', { async: true })
  async onAdmissionClosed(p: { admissionId: string; reason?: string }) {
    if (!p?.admissionId) return;
    try {
      const n = await this.service.deactivateByAdmission(p.admissionId);
      if (n) this.logger.log(`재원 종료(${p.reason ?? '-'}) — 재평가 스케줄 ${n}건 종료 admission=${p.admissionId}`);
    } catch (e) {
      this.logger.warn(`재평가 스케줄 종료 실패 admission=${p.admissionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
