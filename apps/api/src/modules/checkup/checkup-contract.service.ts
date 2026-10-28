import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface ProgramOption {
  id: string;
  name: string;
  price: number;
  category?: string;
  codes?: string[];
}

@Injectable()
export class CheckupContractService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { status?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    return this.prisma.checkupContract.findMany({
      where,
      include: {
        program: { select: { code: true, name: true, category: true, price: true } },
        _count: { select: { visits: true } },
      },
      orderBy: { contractDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const contract = await this.prisma.checkupContract.findUnique({
      where: { id },
      include: {
        program: true,
        visits: {
          include: {
            patient: {
              select: { id: true, mrn: true, familyName: true, givenName: true, gender: true },
            },
          },
          orderBy: { scheduledDate: 'asc' },
        },
      },
    });
    if (!contract) throw new NotFoundException('단체 계약을 찾을 수 없습니다');
    return contract;
  }

  async create(dto: {
    companyName: string;
    contactPerson?: string;
    contactPhone?: string;
    programId: string;
    headcount: number;
    discountRate: number;
    contractDate: string;
    expiryDate: string;
  }) {
    const program = await this.prisma.checkupProgram.findUnique({
      where: { id: dto.programId },
    });
    if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');

    return this.prisma.checkupContract.create({
      data: {
        companyName: dto.companyName,
        contactPerson: dto.contactPerson,
        contactPhone: dto.contactPhone,
        programId: dto.programId,
        headcount: dto.headcount,
        discountRate: dto.discountRate,
        contractDate: new Date(dto.contractDate),
        expiryDate: new Date(dto.expiryDate),
      },
      include: { program: { select: { code: true, name: true } } },
    });
  }

  async bulkReserve(
    contractId: string,
    reservations: { patientId: string; scheduledDate: string; selectedOptions?: string[] }[],
  ) {
    const contract = await this.findOne(contractId);
    const program = contract.program;

    /**
     * 🔴 (2026-09-03) 못 찾은 옵션 id 를 조용히 건너뛰면 선택 옵션이 0원으로 예약된다.
     *    배치라 중간에 던지면 앞서 만든 예약만 남으므로 — **생성 전에 전 행을 먼저 검증**해
     *    통째로 400(몇 번째 행의 어느 옵션인지 명시)한다.
     */
    const knownOpts = (Array.isArray(program.options) ? program.options : []) as unknown as ProgramOption[];
    reservations.forEach((res, idx) => {
      for (const optId of res.selectedOptions ?? []) {
        if (!knownOpts.find((o) => o.id === optId)) {
          throw new BadRequestException(`${idx + 1}번째 예약의 옵션(${optId})이 현재 프로그램에 없습니다 — 옵션을 다시 선택해 주세요.`);
        }
      }
    });

    const results = [];
    for (const res of reservations) {
      let totalPrice = program.price;
      if (contract.discountRate > 0) {
        totalPrice = Math.round(totalPrice * (1 - contract.discountRate / 100));
      }
      for (const optId of res.selectedOptions ?? []) {
        const opt = knownOpts.find((o) => o.id === optId);
        if (opt) totalPrice += opt.price;
      }

      const visit = await this.prisma.checkupVisit.create({
        data: {
          patientId: res.patientId,
          programId: program.id,
          scheduledDate: new Date(res.scheduledDate),
          selectedOptions: res.selectedOptions as Prisma.InputJsonValue,
          totalPrice,
          contractId,
        },
      });
      results.push(visit);
    }

    return { created: results.length, contractId };
  }

  /**
   * 엑셀 일괄 등록 — 수검자 명단으로 Patient 조회/생성 + 예약 생성
   * rows: [{ name, dateOfBirth, gender, phone }]
   */
  /**
   * 엑셀 성별 파싱.
   *
   * 🔴 종전 `row.gender === '남' || 'MALE' ? 'MALE' : 'FEMALE'` 은 **미기재·오타·'M'·'남자'를
   *    전부 여성으로** 환자 마스터에 영구 기록했다(2026-08-13 W5). 표시가 아니라 저장이라
   *    W1 의 "대기열 전원 여성"보다 무겁다 — 검진 프로그램에는 성별 조건과 성별 특화 항목
   *    (유방/자궁경부)이 있어 임상·수가에 직접 영향한다. 모르면 UNKNOWN 으로 남긴다.
   */
  private static parseGenderValue(v: unknown): 'MALE' | 'FEMALE' | 'UNKNOWN' {
    const t = String(v ?? '').trim().toUpperCase();
    if (['남', '남자', 'M', 'MALE', '1'].includes(t)) return 'MALE';
    if (['여', '여자', 'F', 'FEMALE', '2'].includes(t)) return 'FEMALE';
    return 'UNKNOWN';
  }

  async bulkUpload(
    contractId: string,
    rows: { name: string; dateOfBirth: string; gender: string; phone?: string; scheduledDate: string }[],
  ) {
    const contract = await this.findOne(contractId);
    const program = contract.program;
    const results: { name: string; status: string; visitId?: string; error?: string }[] = [];

    for (const row of rows) {
      try {
        // 이름 파싱 (성+이름)
        const familyName = row.name.slice(0, 1);
        const givenName = row.name.slice(1);

        // 기존 환자 조회 (이름+생년월일)
        let patient = await this.prisma.patient.findFirst({
          where: {
            familyName,
            givenName,
            dateOfBirth: new Date(row.dateOfBirth),
          },
        });

        // 없으면 생성
        if (!patient) {
          const mrn = `P${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
          const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
          patient = await this.prisma.patient.create({
            data: {
              mrn,
              familyName,
              givenName,
              dateOfBirth: new Date(row.dateOfBirth),
              gender: CheckupContractService.parseGenderValue(row.gender),
              phone: row.phone,
              insuranceType: 'NHI',
              createdBy: admin!.id,
              updatedBy: admin!.id,
            },
          });
        }

        // 가격 계산
        let totalPrice = program.price;
        if (contract.discountRate > 0) {
          totalPrice = Math.round(totalPrice * (1 - contract.discountRate / 100));
        }

        // 예약 생성
        const visit = await this.prisma.checkupVisit.create({
          data: {
            patientId: patient.id,
            programId: program.id,
            scheduledDate: new Date(row.scheduledDate),
            totalPrice,
            contractId,
          },
        });

        results.push({ name: row.name, status: 'OK', visitId: visit.id });
      } catch (e) {
        results.push({ name: row.name, status: 'ERROR', error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      total: rows.length,
      success: results.filter((r) => r.status === 'OK').length,
      failed: results.filter((r) => r.status === 'ERROR').length,
      details: results,
    };
  }

  async getContractStats(contractId: string) {
    const contract = await this.findOne(contractId);
    const visits = contract.visits;

    const statusCounts: Record<string, number> = {};
    for (const v of visits) {
      statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
    }

    const completed = (statusCounts['COMPLETED'] ?? 0) + (statusCounts['DELIVERED'] ?? 0);

    return {
      companyName: contract.companyName,
      headcount: contract.headcount,
      reserved: visits.length,
      notReserved: Math.max(0, contract.headcount - visits.length),
      completed,
      // 🔴 (2026-09-17 L4) 예약 0 건이면 '진행률 0%'(=예약자가 아무도 안 왔다)가 아니라 산출 불가.
      progressPct: visits.length > 0 ? Math.round((completed / visits.length) * 100) : null,
      byStatus: statusCounts,
    };
  }
}
