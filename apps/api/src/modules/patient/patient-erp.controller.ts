import { Controller, Get, Param, Query, Headers, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';

// ERP ↔ 환자 디렉터리 연동 (서버-서버, §B). 환자 마스터=HIS(SoT), ERP는 디렉터리 스냅샷을 당겨감.
// 인증: 디렉터리 조회=PII키(S-1) / 단건=PII키 + 대상토큰(S-3 IDOR).
// ⚠️ 암호화 PII(주민번호·여권·외국인등록·보험번호·CI)는 ciphertext 이므로 동봉하지 않는다.
@ApiTags('ERP Integration (환자 디렉터리)')
@SkipThrottle()
@Controller('api/v1/integration/patients')
export class PatientErpController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationAuth: IntegrationAuthService,
  ) {}

  // 디렉터리에 노출하는 비민감 필드만 select (암호화 PID·임상·CRM 제외)
  private static readonly SELECT = {
    mrn: true,
    fhirId: true,
    familyName: true,
    givenName: true,
    nameEn: true,
    dateOfBirth: true,
    gender: true,
    insuranceType: true,
    phone: true,
    email: true,
    address: true,
    nationality: true,
    preferredLanguage: true,
    nationalIdType: true, // 유형만(RESIDENT/FOREIGNER/PASSPORT) — 실 번호는 암호화라 미동봉
    patientSource: true,
    externalPatientId: true,
    sourceOrgId: true,
    maritalStatus: true,
    occupation: true,
    isDeceased: true,
    deathDate: true,
    mergedIntoId: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private map(p: Record<string, unknown>) {
    return { ...p, name: `${p.familyName as string}${p.givenName as string}` };
  }

  @Get()
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({
    summary:
      '환자 디렉터리 스냅샷(마스터 동기화용) — PII 조회 키. 증분(updated_since)·커서(mrn) 페이지네이션. 암호화 PID 미동봉',
  })
  async list(
    @Headers('x-integration-key') key: string,
    @Query('updated_since') updatedSince?: string,
    @Query('source') source?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
    @Query('include_merged') includeMerged?: string,
  ) {
    await this.integrationAuth.assertPiiReadKey(key);

    const limit = Math.min(Math.max(parseInt(limitRaw ?? '500', 10) || 500, 1), 2000);
    const where: Record<string, unknown> = {};
    if (updatedSince) {
      const since = new Date(updatedSince);
      if (!isNaN(since.getTime())) where.updatedAt = { gte: since };
    }
    if (source) where.patientSource = source;
    if (cursor) where.mrn = { gt: cursor };
    if (includeMerged !== 'true') where.mergedIntoId = null;

    const rows = await this.prisma.patient.findMany({
      where,
      select: PatientErpController.SELECT,
      orderBy: { mrn: 'asc' },
      take: limit + 1, // hasMore 판별용 1건 초과 조회
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].mrn : null;

    return {
      data: page.map((p) => this.map(p as Record<string, unknown>)),
      meta: { count: page.length, hasMore, nextCursor, limit },
    };
  }

  @Get(':mrn')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiHeader({ name: 'X-Target-Token', required: false })
  @ApiOperation({ summary: '환자 단건 조회 — PII 조회 키 + 대상 토큰(S-3 IDOR, target=mrn)' })
  async one(
    @Headers('x-integration-key') key: string,
    @Headers('x-target-token') targetToken: string,
    @Param('mrn') mrn: string,
  ) {
    await this.integrationAuth.assertPiiReadKey(key);
    await this.integrationAuth.assertTargetAuth({ token: targetToken, target: mrn }); // S-3: 대상(mrn) 일치 검증
    const patient = await this.prisma.patient.findUnique({
      where: { mrn },
      select: PatientErpController.SELECT,
    });
    if (!patient) throw new NotFoundException('환자 없음');
    return { data: this.map(patient as Record<string, unknown>) };
  }
}
