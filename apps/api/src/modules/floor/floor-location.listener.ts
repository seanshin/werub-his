import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FloorService } from './floor.service';

/**
 * 위치 원장의 "떠남" 배선(2026-10-03) — 재원이 끝나면(퇴원·전원·입원 취소) 그 환자의 열린 위치를 닫는다.
 * `admission.closed` 는 재원 종료의 단일 구독점이다(inpatient.service — 퇴원·취소 두 경로가 모두 낸다).
 * 실패는 퇴원을 막지 않는다(비차단) — 다만 조용히 넘기지 않고 남긴다.
 */
@Injectable()
export class FloorLocationListener {
  private readonly logger = new Logger(FloorLocationListener.name);
  constructor(private readonly floor: FloorService) {}

  @OnEvent('admission.closed', { async: true })
  async onAdmissionClosed(p: { admissionId: string; patientId?: string; reason?: string }) {
    if (!p?.admissionId || !p?.patientId) return;
    try {
      const r = await this.floor.closeOpenLocations({ patientId: p.patientId, closedBy: `ADMISSION_CLOSED:${p.reason ?? 'UNKNOWN'}`, closeSource: 'INFERRED_EVENT', eventRef: p.admissionId });
      if (r.closed) this.logger.log(`재원 종료(${p.reason ?? '-'}) — 열린 위치 ${r.closed}건 닫음 admission=${p.admissionId}`);
    } catch (e) {
      this.logger.warn(`재원 종료 위치 닫기 실패 admission=${p.admissionId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 응급실 퇴실(2026-10-03 결정 D9) — 귀가·전원·사망으로 응급실을 떠나면 그 퇴실 시각으로 닫는다.
   * 입원 전환은 내지 않는다(병동 위치가 응급 위치를 이어받는다 — 닫으면 병동 위치까지 닫힌다).
   */
  @OnEvent('emergency.departed', { async: true })
  async onEmergencyDeparted(p: { visitId: string; patientId?: string; departedAt?: string; reason?: string }) {
    if (!p?.visitId || !p?.patientId || !p?.departedAt) return;
    const at = new Date(p.departedAt);
    if (Number.isNaN(at.getTime())) return;
    try {
      const r = await this.floor.closeOpenLocations({ patientId: p.patientId, closedBy: `ER_DEPARTED:${p.reason ?? 'UNKNOWN'}`, closeSource: 'INFERRED_EVENT', eventRef: p.visitId, at });
      if (r.closed) this.logger.log(`응급 퇴실(${p.reason ?? '-'}) — 열린 위치 ${r.closed}건 닫음 visit=${p.visitId}`);
    } catch (e) {
      this.logger.warn(`응급 퇴실 위치 닫기 실패 visit=${p.visitId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
