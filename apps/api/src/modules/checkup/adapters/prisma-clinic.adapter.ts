import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ClinicAdapter,
  PatientInfo,
  LabOrderParams,
  ImagingOrderParams,
  DiagTestParams,
  AppointmentParams,
  ReferralParams,
  BillingParams,
} from '@hospital-run/shared';

@Injectable()
export class PrismaClinicAdapter implements ClinicAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async getPatient(patientId: string): Promise<PatientInfo> {
    const p = await this.prisma.patient.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        id: true,
        mrn: true,
        familyName: true,
        givenName: true,
        gender: true,
        dateOfBirth: true,
        phone: true,
      },
    });
    return {
      id: p.id,
      mrn: p.mrn,
      familyName: p.familyName,
      givenName: p.givenName,
      gender: p.gender,
      birthDate: p.dateOfBirth.toISOString().slice(0, 10),
      phone: p.phone ?? undefined,
    };
  }

  async searchPatients(query: string, limit = 20): Promise<PatientInfo[]> {
    const patients = await this.prisma.patient.findMany({
      where: {
        OR: [
          { mrn: { contains: query } },
          { familyName: { contains: query } },
          { givenName: { contains: query } },
        ],
      },
      take: limit,
      select: {
        id: true,
        mrn: true,
        familyName: true,
        givenName: true,
        gender: true,
        dateOfBirth: true,
        phone: true,
      },
    });
    return patients.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      familyName: p.familyName,
      givenName: p.givenName,
      gender: p.gender,
      birthDate: p.dateOfBirth.toISOString().slice(0, 10),
      phone: p.phone ?? undefined,
    }));
  }

  async createEncounter(
    patientId: string,
    visitType: string,
  ): Promise<{ encounterId: string }> {
    // 검진용 Encounter 생성 — 시스템 사용자(admin)를 doctor로 지정
    const admin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
    });
    const encounter = await this.prisma.encounter.create({
      data: {
        patientId,
        doctorId: admin!.id,
        status: 'DRAFT',
        visitType,
      },
    });
    return { encounterId: encounter.id };
  }

  /**
   * 🔴 **미구현 — 지어낸 ID 로 성공한 척하지 않는다** (2026-08-27).
   *
   * 종전 이 여섯 메서드는 아무것도 만들지 않고 `lab-<encounterId>-<Date.now()>` 같은
   * **가짜 식별자를 성공 응답으로** 돌려줬다("Phase 4에서 구현" 주석과 함께).
   * 이 저장소가 이미 겪은 두 가지가 겹쳐 있다:
   *   · **P16 — 실행하지 않고 성공 상태만 기록** (외래 COMPLETED 462건 중 456건이 실체 없음)
   *   · **값 날조** — 키오스크가 PG 없이 `KIOSK-<ts>` 를 승인번호로 낸 것과 **같은 형태**다.
   *
   * 지금은 호출부가 0이라 피해가 없다(`CheckupService` 는 이 어댑터를 주입만 하고 부르지 않는다).
   * 그러나 누군가 배선하는 순간 **"오더를 냈다"고 믿게 된다** — 조용한 함정이다.
   * 그래서 지금 **소리 나게** 바꾼다: 미구현은 미구현이라고 말한다.
   *
   * 🔴 이 메서드들을 실제로 구현하는 것은 **검진↔검사·영상 오더 연결**(기능 신설·스키마 승인
   *    선행)이고 사람 판단 대기다. 그 결정 전까지 이 자리는 비어 있어야 하며, **비어 있다는
   *    사실이 보여야 한다.** 구현할 때는 정본 CPOE 경로를 지나야 한다(DUR·역할 가드·서명).
   */
  private notWired(what: string): never {
    throw new NotImplementedException({
      code: 'CHECKUP_CLINIC_LINK_NOT_WIRED',
      message: `검진 ${what} 연동은 아직 구현되지 않았습니다 — 검진↔진료 오더 연결(스키마 승인 대기) 후 정본 CPOE 경로로 배선합니다.`,
    });
  }

  async createLabOrder(_params: LabOrderParams): Promise<{ orderId: string }> {
    this.notWired('검사 오더');
  }

  async createImagingOrder(_params: ImagingOrderParams): Promise<{ orderId: string }> {
    this.notWired('영상 오더');
  }

  async createDiagnosticTest(_params: DiagTestParams): Promise<{ testId: string }> {
    this.notWired('생리기능검사');
  }

  async createAppointment(_params: AppointmentParams): Promise<{ appointmentId: string }> {
    this.notWired('예약');
  }

  async createReferral(_params: ReferralParams): Promise<{ referralId: string }> {
    this.notWired('의뢰');
  }

  async createBilling(_params: BillingParams): Promise<{ billingId: string }> {
    this.notWired('청구');
  }
}
