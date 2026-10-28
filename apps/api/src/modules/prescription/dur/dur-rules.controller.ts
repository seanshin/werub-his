import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CLINICAL_CODE_RULES } from '@hospital-run/shared';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { DurRulesRepo } from './dur-rules.repo';
import { PreviewDurRuleDto, UpsertDurRuleDto } from './dur-rules.dto';
import { previewDurRule, type PreviewRx } from './dur-rule-preview';
import { buildMedicationHay } from './ingredient-terms';
import { ageOf } from '@hospital-run/shared';
import { NoAudit } from '../../audit/no-audit.decorator';

/**
 * DUR 룰 관리(P0-a) — 약사위 심의 대상 데이터의 개정 EP.
 * 쓰기=ADMIN(위원회 의결 바인딩은 거버넌스 엔진 P3에서 이 EP 를 정본으로 호출).
 * 조회=약사·의사 포함(어떤 룰로 차단되는지 투명하게).
 */
@ApiTags('DUR Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/dur/rules')
export class DurRulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: DurRulesRepo,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST, UserRole.DOCTOR)
  @ApiOperation({ summary: 'DUR 룰 목록(유형 필터)' })
  async list(@Query('ruleType') ruleType?: string) {
    return { data: await this.prisma.durRule.findMany({
      where: ruleType ? { ruleType } : undefined,
      orderBy: [{ ruleType: 'asc' }, { drugA: 'asc' }],
    }) };
  }

  /**
   * 관리 화면 개관(2026-10-21 임상 규칙 P1) — 룰 + 룰별 적중 + 유형별 출처(표/코드 기본값) + 편집 못 하는 코드 규칙.
   *  · 적중 = 처방 원장 `dur_warnings` 에 남은 경고 중 이 룰 id 를 든 것(실제 처방 저장 기준 · 미리 보기 점검은 세지 않는다)
   *  · 🔴 룰 id 를 싣기 시작한 뒤부터만 센다 — 그 전 기간은 모른다(`metering.since` · 없으면 적중 null = 계측 전, 0 아님)
   */
  @Get('overview')
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST, UserRole.DOCTOR)
  @ApiOperation({ summary: 'DUR 룰 개관 — 룰·적중(처방 원장)·유형별 출처·코드 규칙' })
  async overview(@Query('days') daysRaw?: string) {
    const days = Math.min(365, Math.max(1, Number.parseInt(daysRaw ?? '90', 10) || 90));
    const from = new Date(Date.now() - days * 86_400_000);
    const [rules, sourceByType, since, hits] = await Promise.all([
      this.prisma.durRule.findMany({ orderBy: [{ ruleType: 'asc' }, { drugA: 'asc' }] }),
      this.repo.sourceByType(),
      this.prisma.$queryRaw<Array<{ since: Date | null }>>`
        SELECT MIN(p.created_at) AS since FROM prescriptions p, jsonb_array_elements(p.dur_warnings) e
        WHERE jsonb_typeof(p.dur_warnings) = 'array' AND e ? 'ruleId'`.then((r) => r[0]?.since ?? null),
      this.prisma.$queryRaw<Array<{ id: string; n: number }>>`
        SELECT e->>'ruleId' AS id, COUNT(*)::int AS n FROM prescriptions p, jsonb_array_elements(p.dur_warnings) e
        WHERE jsonb_typeof(p.dur_warnings) = 'array' AND e ? 'ruleId' AND p.created_at >= ${from}
        GROUP BY 1`,
    ]);
    const hitMap = new Map(hits.map((h) => [h.id, h.n]));
    return {
      data: {
        rules: rules.map((r) => ({ ...r, hits: since ? hitMap.get(r.id) ?? 0 : null })),
        window: { days, from: from.toISOString(), effectiveFrom: since ? new Date(Math.max(from.getTime(), since.getTime())).toISOString() : null },
        metering: { since: since ? since.toISOString() : null },
        sourceByType,
        codeRules: CLINICAL_CODE_RULES,
      },
    };
  }

  /**
   * 영향 미리보기(2026-10-21 P4 B2) — 이 룰(초안)이 지난 30일 처방에 걸렸을 건수 · `id` 가 있으면 지금 저장된 룰과 비교.
   * 저장하지 않는다(읽기 전용) · 처방 5,000건 상한(넘으면 잘랐다고) · 매칭은 실제 판정과 같은 함수.
   */
  @Post('preview')
  @Roles(UserRole.ADMIN, UserRole.PHARMACIST)
  @NoAudit()
  @ApiOperation({ summary: 'DUR 룰 영향 미리보기(지난 30일 처방 · 저장 없음 · 현재 룰과 비교)' })
  async preview(@Body() dto: PreviewDurRuleDto) {
    const days = 30;
    const from = new Date(Date.now() - days * 86_400_000);
    const LIMIT = 5000;
    const raw = await this.prisma.prescription.findMany({
      where: { createdAt: { gte: from }, medicationCodeId: { not: null } },
      select: {
        id: true, encounterId: true, dosage: true, frequency: true, createdAt: true,
        medicationCode: { select: { ingredient: true, nameKo: true, nameEn: true } },
        encounter: { select: { patientId: true, patient: { select: { dateOfBirth: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIMIT + 1,
    });
    const truncated = raw.length > LIMIT;
    const rxs: PreviewRx[] = raw.slice(0, LIMIT).map((r) => ({
      id: r.id, encounterId: r.encounterId, patientId: r.encounter?.patientId ?? r.encounterId,
      age: ageOf(r.encounter?.patient?.dateOfBirth ?? null, r.createdAt),
      hay: buildMedicationHay(r.medicationCode), dosage: r.dosage, frequency: r.frequency,
    }));
    const draft = previewDurRule(dto, rxs);
    let current: ReturnType<typeof previewDurRule> | null = null;
    if (dto.id) {
      const row = await this.prisma.durRule.findUnique({ where: { id: dto.id } });
      if (row) current = previewDurRule({ ...row, keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : null }, rxs);
    }
    return { data: { windowDays: days, scanned: rxs.length, truncated, draft, current } };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 룰 추가' })
  async create(@Body() dto: UpsertDurRuleDto) {
    return { data: await this.repo.createRule(dto as unknown as Record<string, unknown>) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 룰 수정(비활성화 포함)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertDurRuleDto) {
    return { data: await this.repo.updateRule(id, dto as unknown as Record<string, unknown>) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 룰 삭제 — 이력 보존이 필요하면 삭제 대신 isActive=false 권장' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.repo.deleteRule(id) };
  }
}
