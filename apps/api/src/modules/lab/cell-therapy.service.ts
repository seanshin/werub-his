import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';

@Injectable()
export class CellTherapyService {
  constructor(private readonly prisma: PrismaService) {}

  async getBatches(params?: { status?: string; patientId?: string }) {
    const where: Prisma.CellTherapyBatchWhereInput = {};
    if (params?.status) where.status = params.status;
    if (params?.patientId) where.patientId = params.patientId;
    return this.prisma.cellTherapyBatch.findMany({
      where,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        _count: { select: { environmentLogs: true, qcTests: true, documents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBatch(data: {
    patientId: string; cellType: string; sourceType: string;
    collectionDate: string; targetDose?: string; notes?: string;
  }) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    // 채번 원자화 — batchNumber @unique 동시 생성 충돌(P2002) 방지
    return withAdvisoryLock(this.prisma, `cell-batch:${today}`, async (tx) => {
      const count = await tx.cellTherapyBatch.count();
      const batchNumber = `CT-${today}-${String(count + 1).padStart(3, '0')}`;
      return tx.cellTherapyBatch.create({
        data: {
          patientId: data.patientId,
          batchNumber,
          cellType: data.cellType,
          sourceType: data.sourceType,
          collectionDate: new Date(data.collectionDate),
          targetDose: data.targetDose,
          notes: data.notes,
          status: 'COLLECTED',
        },
        include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
      });
    });
  }

  async getBatchDetail(id: string) {
    const batch = await this.prisma.cellTherapyBatch.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true, dateOfBirth: true, gender: true } },
        environmentLogs: { orderBy: { recordedAt: 'desc' }, take: 48 },
        qcTests: { orderBy: { testedAt: 'desc' }, include: { tester: { select: { familyName: true, givenName: true } } } },
        documents: { orderBy: { uploadedAt: 'desc' }, include: { uploader: { select: { familyName: true, givenName: true } } } },
      },
    });
    if (!batch) throw new NotFoundException('배치를 찾을 수 없습니다');

    // 배양 경과일
    const daysSinceCollection = Math.max(0, Math.ceil((Date.now() - new Date(batch.collectionDate).getTime()) / 86400000));

    // 최근 환경 로그 요약
    const latestEnv = batch.environmentLogs[0];
    const alertCount = batch.environmentLogs.filter(l => l.isAlert).length;

    // QC 요약
    const qcPassed = batch.qcTests.filter(t => t.passFail === 'PASS').length;
    const qcFailed = batch.qcTests.filter(t => t.passFail === 'FAIL').length;
    const qcPending = batch.qcTests.filter(t => t.passFail === 'PENDING').length;

    return {
      ...batch,
      daysSinceCollection,
      latestEnvironment: latestEnv ? {
        temperature: latestEnv.temperature,
        co2Percent: latestEnv.co2Percent,
        humidity: latestEnv.humidity,
        recordedAt: latestEnv.recordedAt,
      } : null,
      environmentAlertCount: alertCount,
      qcSummary: { passed: qcPassed, failed: qcFailed, pending: qcPending, total: batch.qcTests.length },
    };
  }

  async updateBatchStatus(id: string, status: string) {
    const batch = await this.prisma.cellTherapyBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('배치를 찾을 수 없습니다');

    const data: Prisma.CellTherapyBatchUpdateInput = { status };
    if (status === 'PROCESSING') data.processingStart = new Date();
    if (status === 'RELEASED' || status === 'COMPLETED') data.processingEnd = new Date();

    return this.prisma.cellTherapyBatch.update({ where: { id }, data });
  }

  async addEnvironmentLog(batchId: string, data: {
    temperature: number; co2Percent: number; humidity?: number; recordedBy?: string;
  }) {
    // 범위 이탈 자동 감지
    const isAlert =
      data.temperature < 36.0 || data.temperature > 38.0 ||
      data.co2Percent < 4.0 || data.co2Percent > 6.0 ||
      (data.humidity != null && (data.humidity < 90.0 || data.humidity > 99.0));

    return this.prisma.cellEnvironmentLog.create({
      data: {
        batchId,
        temperature: data.temperature,
        co2Percent: data.co2Percent,
        humidity: data.humidity,
        recordedAt: new Date(),
        recordedBy: data.recordedBy,
        isAlert,
      },
    });
  }

  async addQcTest(batchId: string, data: {
    testType: string; result: string; unit?: string;
    passFail: string; testedBy: string; reportUrl?: string;
  }) {
    return this.prisma.cellQcTest.create({
      data: {
        batchId,
        testType: data.testType,
        result: data.result,
        unit: data.unit,
        passFail: data.passFail,
        testedAt: new Date(),
        testedBy: data.testedBy,
        reportUrl: data.reportUrl,
      },
      include: { tester: { select: { familyName: true, givenName: true } } },
    });
  }

  async addDocument(batchId: string, data: {
    docType: string; fileName: string; fileUrl: string; uploadedBy: string;
  }) {
    return this.prisma.cellBatchDocument.create({
      data: { batchId, ...data },
    });
  }

  async releaseBatch(id: string) {
    const batch = await this.prisma.cellTherapyBatch.findUnique({
      where: { id },
      include: { qcTests: true },
    });
    if (!batch) throw new NotFoundException('배치를 찾을 수 없습니다');

    const failedQc = batch.qcTests.filter(t => t.passFail === 'FAIL');
    if (failedQc.length > 0) {
      throw new ConflictException(`QC 실패 항목 ${failedQc.length}건 — 출하 불가`);
    }

    const pendingQc = batch.qcTests.filter(t => t.passFail === 'PENDING');
    if (pendingQc.length > 0) {
      throw new ConflictException(`QC 미완료 항목 ${pendingQc.length}건 — 출하 불가`);
    }

    return this.prisma.cellTherapyBatch.update({
      where: { id },
      data: { status: 'RELEASED', processingEnd: new Date() },
    });
  }
}
