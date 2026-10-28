import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PdfGenerationService } from './pdf-generation.service';

const FEE_PER_COPY = 1000; // 기본 수수료 (원)

@Injectable()
export class MedicalRecordCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfService: PdfGenerationService,
  ) {}

  async generatePdf(recordType: string, recordId: string): Promise<string> {
    // 🔴 (2026-10-13 결함 발굴 B6) 사본은 서명된 기록만 — 종전 생성기는 상태를 보지 않아 작성 중 진료기록·퇴원요약도 사본으로 만들었다
    if (recordType === 'encounter') {
      const e = await this.prisma.encounter.findUnique({ where: { id: recordId }, select: { status: true } });
      if (e && e.status !== 'SIGNED') throw new ConflictException({ code: 'COPY_RECORD_UNSIGNED', message: '서명된 진료기록만 사본으로 만들 수 있습니다' });
    }
    if (recordType === 'discharge_summary') {
      const d = await this.prisma.dischargeSummary.findUnique({ where: { admissionId: recordId }, select: { status: true } });
      if (d && d.status !== 'SIGNED') throw new ConflictException({ code: 'COPY_RECORD_UNSIGNED', message: '서명된 퇴원요약만 사본으로 만들 수 있습니다' });
    }
    switch (recordType) {
      case 'encounter':
        return this.pdfService.generateEncounterPdf(recordId);
      case 'discharge_summary':
        return this.pdfService.generateDischargeSummaryPdf(recordId);
      case 'lab_result':
        return this.pdfService.generateLabResultPdf(recordId);
      default:
        throw new NotFoundException(`Unsupported record type: ${recordType}`);
    }
  }

  async createCopy(data: {
    patientId: string; requestedBy: string; requestorRelation: string;
    purpose: string; recordTypes: any; dateRange?: any; copyCount: number; notes?: string;
  }, issuedBy: string) {
    const fee = data.copyCount * FEE_PER_COPY;
    return this.prisma.medicalRecordCopy.create({
      data: {
        patientId: data.patientId,
        requestedBy: data.requestedBy,
        requestorRelation: data.requestorRelation,
        purpose: data.purpose,
        recordTypes: data.recordTypes as unknown as Prisma.InputJsonValue,
        dateRange: data.dateRange ? (data.dateRange as unknown as Prisma.InputJsonValue) : undefined,
        issuedBy,
        issuedAt: new Date(),
        copyCount: data.copyCount,
        fee,
        notes: data.notes,
      },
    });
  }

  async findByPatient(patientId: string) {
    return this.prisma.medicalRecordCopy.findMany({
      where: { patientId },
      orderBy: { issuedAt: 'desc' },
      include: { issuer: { select: { id: true, familyName: true, givenName: true } } },
    });
  }

  // (B8 2026-10-13) QR 토큰 생성기·공개 사본 확인 제거 — 컨트롤러 주석 참조
}
