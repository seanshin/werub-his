import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NurseStationService } from './nurse-station.service';

@Injectable()
export class NurseStationListener {
  private readonly logger = new Logger(NurseStationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nurseStationService: NurseStationService,
  ) {}

  /**
   * 접수 완료 시 → 해당 의사에 CareTeam이 있으면 PRE_VISIT 업무 자동 생성
   */
  @OnEvent('queue.checked_in')
  async handleQueueCheckedIn(payload: {
    queueId: string;
    doctorId: string;
    patientId: string;
    departmentName?: string;
  }) {
    try {
      // 해당 의사의 활성 케어팀 간호사 조회
      const careTeam = await this.prisma.careTeam.findFirst({
        where: { doctorId: payload.doctorId, isActive: true, isPrimary: true },
      });

      if (!careTeam) {
        this.logger.debug(`No CareTeam for doctor ${payload.doctorId}, skipping task generation`);
        return;
      }

      await this.nurseStationService.generateTasks(payload.queueId, careTeam.nurseId);
      this.logger.log(`PRE_VISIT tasks generated for queue ${payload.queueId} (nurse: ${careTeam.nurseId})`);

      // Phase 5: 진료과별 추가 업무 생성
      if (payload.departmentName) {
        await this.nurseStationService.generateDepartmentTasks(
          payload.queueId,
          careTeam.nurseId,
          payload.departmentName,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to generate PRE_VISIT tasks for queue ${payload.queueId}: ${msg}`);
    }
  }

  /**
   * Phase 4: 진료 시작 시 → PreVisitVitals를 Encounter에 자동 연결
   */
  @OnEvent('encounter.created')
  async handleEncounterCreated(payload: { encounterId: string; queueId?: string; patientId: string }) {
    if (!payload.queueId) return;
    try {
      await this.nurseStationService.linkVitalsToEncounter(payload.queueId, payload.encounterId);
      this.logger.log(`Vitals linked to encounter ${payload.encounterId} from queue ${payload.queueId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to link vitals for encounter ${payload.encounterId}: ${msg}`);
    }
  }

  /**
   * 진료 완료(서명) 시 → 해당 의사에 CareTeam이 있으면 POST_VISIT 업무 자동 생성
   */
  @OnEvent('encounter.signed')
  async handleEncounterSigned(payload: { encounterId: string; patientId: string }) {
    try {
      // encounter에서 doctorId 조회
      const encounter = await this.prisma.encounter.findUnique({
        where: { id: payload.encounterId },
        select: { doctorId: true },
      });

      if (!encounter) return;

      const careTeam = await this.prisma.careTeam.findFirst({
        where: { doctorId: encounter.doctorId, isActive: true, isPrimary: true },
      });

      if (!careTeam) {
        this.logger.debug(`No CareTeam for doctor ${encounter.doctorId}, skipping post-visit task generation`);
        return;
      }

      await this.nurseStationService.generatePostVisitTasks(payload.encounterId, careTeam.nurseId);
      this.logger.log(`POST_VISIT tasks generated for encounter ${payload.encounterId} (nurse: ${careTeam.nurseId})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to generate POST_VISIT tasks for encounter ${payload.encounterId}: ${msg}`);
    }
  }

  /** 입원이 끝나면(퇴원·취소) 담당 배정도 끝난다 — 실패해도 퇴원은 유지(비차단)·로그로 남긴다 */
  @OnEvent('admission.closed', { async: true })
  async handleAdmissionClosed(payload: { admissionId: string }) {
    if (!payload?.admissionId) return;
    try {
      const n = await this.nurseStationService.releaseForAdmission(payload.admissionId);
      if (n) this.logger.log(`입원 종료 — 담당 배정 ${n}건 해제 admission=${payload.admissionId}`);
    } catch (e) {
      this.logger.error(`입원 종료 시 담당 배정 해제 실패 admission=${payload.admissionId}: ${(e as Error).message}`);
    }
  }
}
