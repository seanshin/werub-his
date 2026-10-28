import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VIP_FLAG_TYPE, vipFlagWhere } from './vip-canonical';

/**
 * VIP 환자 지정/조회 — 저장소는 **정본 하나**(`patient_flags` flagType='VIP').
 * 🔴 종전에는 이 서비스만 `vip_patients` 테이블을 썼고, 화면(`/admin/patient-flags`)과
 *    이상탐지가 서로 다른 곳을 봐서 **VIP 접근 경보가 구조적으로 불가능**했다.
 *    자세한 판단 근거는 `vip-canonical.ts` 주석 참조.
 * 응답 모양(`patient`·`designator`·`reason`·`createdAt`)은 기존 `/admin/vip-patients` 화면
 * 계약을 그대로 유지한다 — 저장소만 정본으로 옮겼다.
 */
@Injectable()
export class VipPatientService {
  constructor(private readonly prisma: PrismaService) {}

  private async designatorMap(ids: string[]) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, { id: string; familyName: string | null; givenName: string | null }>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, familyName: true, givenName: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  async designate(patientId: string, reason: string | undefined, designatedBy: string) {
    const existing = await this.prisma.patientFlag.findFirst({ where: vipFlagWhere(patientId) });
    if (existing) throw new ConflictException('Patient is already designated as VIP');

    // 같은 지정자가 과거에 해제한 이력이 있으면 유니크(patientId·flaggedBy·flagType) 충돌 → upsert 로 되살린다.
    const flag = await this.prisma.patientFlag.upsert({
      where: { patientId_flaggedBy_flagType: { patientId, flaggedBy: designatedBy, flagType: VIP_FLAG_TYPE } },
      create: { patientId, flagType: VIP_FLAG_TYPE, reason, flaggedBy: designatedBy, isActive: true },
      update: { reason, isActive: true },
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
    });
    const designators = await this.designatorMap([flag.flaggedBy]);
    return {
      id: flag.id,
      patientId: flag.patientId,
      reason: flag.reason,
      createdAt: flag.createdAt,
      patient: flag.patient,
      designator: designators.get(flag.flaggedBy) ?? null,
    };
  }

  async findAll() {
    const flags = await this.prisma.patientFlag.findMany({
      where: vipFlagWhere(),
      include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const designators = await this.designatorMap(flags.map((f) => f.flaggedBy));
    return flags.map((f) => ({
      id: f.id,
      patientId: f.patientId,
      reason: f.reason,
      createdAt: f.createdAt,
      patient: f.patient,
      designator: designators.get(f.flaggedBy) ?? null,
    }));
  }

  /** VIP 해제 — 그 환자의 활성 VIP 표식을 모두 내린다(여러 직원이 찍었을 수 있다). */
  async remove(patientId: string) {
    const removed = await this.prisma.patientFlag.updateMany({
      where: vipFlagWhere(patientId),
      data: { isActive: false },
    });
    if (removed.count === 0) throw new NotFoundException('VIP designation not found');
    return { patientId, removed: removed.count };
  }

  /** VIP 여부 — 이상탐지·경보가 읽는 것과 **같은 정본** */
  async isVip(patientId: string): Promise<boolean> {
    const count = await this.prisma.patientFlag.count({ where: vipFlagWhere(patientId) });
    return count > 0;
  }
}
