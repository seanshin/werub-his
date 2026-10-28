import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ProtocolService } from './protocol.service';

/**
 * 여정 프로토콜 인스턴스 자동 생성(@OnEvent).
 * 도메인 이벤트 발생 시 해당 프로토콜 인스턴스를 보장(ensure*)한다. ensure*는 멱등(findFirst→없으면 create)
 * 이라 중복 이벤트에도 안전. 실패는 흡수(부작용 — 본 흐름 차단 금지).
 *
 * 범위: 여정이 길고 다역할인 수술·입원·응급만 자동 생성. 외래(OPD)는 대량이라 QR 스캔/해석 시 lazy 생성 유지.
 */
@Injectable()
export class ProtocolListener {
  private readonly logger = new Logger(ProtocolListener.name);

  constructor(private readonly protocol: ProtocolService) {}

  @OnEvent('surgery.scheduled', { async: true })
  async onSurgeryScheduled(p: { surgeryId: string }) {
    if (!p?.surgeryId) return;
    try { await this.protocol.ensureInstanceForSurgery(p.surgeryId); }
    catch (e) { this.logger.warn(`수술 프로토콜 자동생성 실패(${p.surgeryId}): ${e}`); }
  }

  @OnEvent('admission.created', { async: true })
  async onAdmissionCreated(p: { admissionId: string }) {
    if (!p?.admissionId) return;
    try { await this.protocol.ensureInstanceForAdmission(p.admissionId); }
    catch (e) { this.logger.warn(`입원 프로토콜 자동생성 실패(${p.admissionId}): ${e}`); }
  }

  @OnEvent('emergency.created', { async: true })
  async onEmergencyCreated(p: { emergencyVisitId: string }) {
    if (!p?.emergencyVisitId) return;
    try { await this.protocol.ensureInstanceForEmergency(p.emergencyVisitId); }
    catch (e) { this.logger.warn(`응급 프로토콜 자동생성 실패(${p.emergencyVisitId}): ${e}`); }
  }
}
