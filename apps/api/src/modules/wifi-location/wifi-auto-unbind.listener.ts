import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WifiRegistryService } from './wifi-registry.service';

/**
 * 단말 연결 자동 해제 배선(2026-10-10 · 결정 location.wifi.autoUnbindOnEnd) — 설정이 켜졌을 때만 해제한다(서비스가 판단).
 *  · `admission.closed` — 재원 종료의 단일 구독점(퇴원·전원·입원 취소). 취소는 해제하지 않는다(재원이 없었던 것 — 외래·응급 연결일 수 있다)
 *  · `patient.deceased` — 사망 처리(사망 자동 퇴원은 `admission.closed` 를 내지 않는다)
 * 실패는 퇴원·사망 처리를 막지 않는다 — 다만 남긴다(연결은 현황 '연결 점검'에 그대로 보인다).
 */
@Injectable()
export class WifiAutoUnbindListener {
  private readonly logger = new Logger(WifiAutoUnbindListener.name);
  constructor(private readonly registry: WifiRegistryService) {}

  @OnEvent('admission.closed', { async: true })
  async onAdmissionClosed(p: { admissionId: string; patientId?: string; reason?: string }) {
    if (!p?.patientId) return;
    const cause = p.reason === 'DISCHARGE' ? 'DISCHARGE' : p.reason === 'TRANSFER' ? 'TRANSFER' : null;
    if (!cause) return;
    try {
      const r = await this.registry.autoUnbindForPatient(p.patientId, cause, null);
      if (r.unbound) this.logger.log(`재원 종료(${cause}) — 단말 연결 ${r.unbound}개 자동 해제 admission=${p.admissionId}`);
    } catch (e) {
      this.logger.warn(`단말 연결 자동 해제 실패 admission=${p.admissionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  @OnEvent('patient.deceased', { async: true })
  async onDeceased(p: { patientId?: string; userId?: string }) {
    if (!p?.patientId) return;
    try {
      const r = await this.registry.autoUnbindForPatient(p.patientId, 'DECEASED', p.userId ?? null);
      if (r.unbound) this.logger.log(`사망 — 단말 연결 ${r.unbound}개 자동 해제 patient=${p.patientId}`);
    } catch (e) {
      this.logger.warn(`단말 연결 자동 해제 실패(사망) patient=${p.patientId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
