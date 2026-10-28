import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class GenomicsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTests(params?: { status?: string; patientId?: string }) {
    const where: Record<string, unknown> = {};
    if (params?.status) where.status = params.status;
    if (params?.patientId) where.patientId = params.patientId;
    return this.prisma.genomicTest.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        orderer: { select: { familyName: true, givenName: true } },
        _count: { select: { variants: true, reports: true } },
      },
      orderBy: { orderedAt: 'desc' },
    });
  }

  async createTest(data: {
    patientId: string;
    testType: string;
    panelName?: string;
    sampleType: string;
    referenceLabId?: string;
    notes?: string;
    orderedBy: string;
  }) {
    return this.prisma.genomicTest.create({
      data: {
        patientId: data.patientId,
        testType: data.testType,
        panelName: data.panelName,
        sampleType: data.sampleType,
        referenceLabId: data.referenceLabId,
        notes: data.notes,
        orderedBy: data.orderedBy,
        status: 'ORDERED',
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
    });
  }

  async getTestDetail(id: string) {
    const test = await this.prisma.genomicTest.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        orderer: { select: { familyName: true, givenName: true } },
        referenceLab: { select: { name: true } },
        variants: { orderBy: { gene: 'asc' } },
        reports: {
          orderBy: { reportedAt: 'desc' },
          include: { reporter: { select: { familyName: true, givenName: true } } },
        },
      },
    });
    if (!test) throw new NotFoundException('유전체 검사를 찾을 수 없습니다');

    const pathogenicCount = test.variants.filter(
      (v) => v.classification === 'PATHOGENIC' || v.classification === 'LIKELY_PATHOGENIC',
    ).length;
    const actionableCount = test.variants.filter(
      (v) => v.actionability === 'TIER_1' || v.actionability === 'TIER_2',
    ).length;

    return {
      ...test,
      variantSummary: {
        total: test.variants.length,
        pathogenic: pathogenicCount,
        actionable: actionableCount,
      },
    };
  }

  async updateTestStatus(id: string, status: string) {
    const test = await this.prisma.genomicTest.findUnique({ where: { id } });
    if (!test) throw new NotFoundException('유전체 검사를 찾을 수 없습니다');

    const updateData: Record<string, unknown> = { status };
    if (status === 'REPORTED') updateData.reportedAt = new Date();

    return this.prisma.genomicTest.update({ where: { id }, data: updateData });
  }

  async addVariant(testId: string, data: {
    gene: string;
    chromosome?: string;
    position?: number;
    refAllele?: string;
    altAllele?: string;
    variantType: string;
    zygosity?: string;
    classification: string;
    alleleFreq?: number;
    clinicalSig?: string;
    actionability?: string;
    dbSnpId?: string;
    cosmicId?: string;
    hgvsC?: string;
    hgvsP?: string;
  }) {
    return this.prisma.genomicVariant.create({
      data: {
        genomicTestId: testId,
        gene: data.gene,
        chromosome: data.chromosome,
        position: data.position != null ? BigInt(data.position) : undefined,
        refAllele: data.refAllele,
        altAllele: data.altAllele,
        variantType: data.variantType,
        zygosity: data.zygosity,
        classification: data.classification,
        alleleFreq: data.alleleFreq,
        clinicalSig: data.clinicalSig,
        actionability: data.actionability,
        dbSnpId: data.dbSnpId,
        cosmicId: data.cosmicId,
        hgvsC: data.hgvsC,
        hgvsP: data.hgvsP,
      },
    });
  }

  async addReport(testId: string, data: {
    reportType: string;
    interpretation?: string;
    recommendation?: string;
    reportFileUrl?: string;
    reportedBy: string;
  }) {
    return this.prisma.genomicReport.create({
      data: {
        genomicTestId: testId,
        reportType: data.reportType,
        interpretation: data.interpretation,
        recommendation: data.recommendation,
        reportFileUrl: data.reportFileUrl,
        reportedBy: data.reportedBy,
        reportedAt: new Date(),
      },
      include: { reporter: { select: { familyName: true, givenName: true } } },
    });
  }

  async recordCounsel(testId: string, notes: string) {
    const test = await this.prisma.genomicTest.findUnique({ where: { id: testId } });
    if (!test) throw new NotFoundException('유전체 검사를 찾을 수 없습니다');

    return this.prisma.genomicTest.update({
      where: { id: testId },
      data: {
        status: 'COUNSELED',
        counseledAt: new Date(),
        counselNotes: notes,
      },
    });
  }

  async getPatientGenomicHistory(patientId: string) {
    return this.prisma.genomicTest.findMany({
      where: { patientId },
      include: {
        _count: { select: { variants: true, reports: true } },
      },
      orderBy: { orderedAt: 'desc' },
    });
  }
}
