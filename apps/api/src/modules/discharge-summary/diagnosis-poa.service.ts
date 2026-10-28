import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { POA_VALUES } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 진단별 입원 시 존재(POA) 원장(2026-10-09).
 * 진단 목록 정본 = 입원 기간(입원 ~ 퇴원, 퇴원 전이면 지금) 이 환자 진료의 진단(EncounterDiagnosis) — 코드별 하나.
 * 🔴 결정 safety.poaFlag 가 필수(설정 safety.poa.required=true)로 정하기 전엔 비어도 서명된다 — 강제하지 않는다.
 * 🔴 값을 지어 채우지 않는다 — 미기록은 미기록으로 둔다(필수일 때 서명이 그 목록을 말하며 거부한다).
 */
@Injectable()
export class DiagnosisPoaService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: ConfigRuntimeService) {}

  async required(): Promise<boolean> {
    try { return (await this.config?.get('safety.poa.required')) === true; } catch { return false; }
  }

  /** 입원 기간 진단(코드별 하나) */
  async admissionDiagnoses(admissionId: string): Promise<Array<{ code: string; name: string | null }>> {
    const adm = await this.prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true, admitDate: true, dischargeDate: true } });
    if (!adm) throw new NotFoundException('입원 정보를 찾을 수 없습니다');
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId: adm.patientId, createdAt: { gte: adm.admitDate, ...(adm.dischargeDate ? { lte: adm.dischargeDate } : {}) } },
      select: { diagnoses: { select: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
    });
    const byCode = new Map<string, string | null>();
    for (const e of encounters) for (const d of e.diagnoses) if (!byCode.has(d.diagnosisCode.code)) byCode.set(d.diagnosisCode.code, d.diagnosisCode.nameKo ?? null);
    return [...byCode.entries()].map(([code, name]) => ({ code, name }));
  }

  async list(admissionId: string) {
    const [dx, rows, required] = await Promise.all([
      this.admissionDiagnoses(admissionId),
      this.prisma.diagnosisPoa.findMany({ where: { admissionId } }),
      this.required(),
    ]);
    const byCode = new Map(rows.map((r) => [r.diagnosisCode, r]));
    return {
      required,
      items: dx.map((d) => ({ ...d, poa: byCode.get(d.code)?.poa ?? null, recordedAt: byCode.get(d.code)?.recordedAt ?? null })),
      missing: dx.filter((d) => !byCode.has(d.code)).map((d) => d.code),
    };
  }

  async set(admissionId: string, code: string, poa: string, actorId: string) {
    if (!(POA_VALUES as readonly string[]).includes(poa)) throw new BadRequestException({ code: 'POA_VALUE', message: 'POA 값이 올바르지 않습니다' });
    const dx = await this.admissionDiagnoses(admissionId);
    if (!dx.some((d) => d.code === code)) throw new BadRequestException({ code: 'POA_NOT_ADMISSION_DIAGNOSIS', message: '이 입원 기간의 진단이 아닙니다' });
    return this.prisma.diagnosisPoa.upsert({
      where: { admissionId_diagnosisCode: { admissionId, diagnosisCode: code } },
      create: { admissionId, diagnosisCode: code, poa, recordedBy: actorId },
      update: { poa, recordedBy: actorId, recordedAt: new Date() },
    });
  }

  /** 서명 전 검사 — 필수로 정해졌을 때만, 비어 있는 진단 코드를 말하며 거부한다 */
  async assertReadyToSign(admissionId: string) {
    if (!(await this.required())) return;
    const { missing } = await this.list(admissionId);
    if (missing.length) {
      throw new ConflictException({ code: 'POA_REQUIRED', message: '입원 시 존재(POA)가 비어 있는 진단이 있어 서명할 수 없습니다(결정 safety.poaFlag)', details: { missing } });
    }
  }
}
