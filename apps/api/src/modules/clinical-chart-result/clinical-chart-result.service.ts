import { BadRequestException, Injectable } from '@nestjs/common';
import { bradenTotalOf, readBradenSubscores } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateClinicalChartResultDto } from './dto/clinical-chart-result.dto';

/** 임상차트 엔진 버전 — SaMD 추적성(used_tool_version) */
const TOOL_VERSION = 'clinical-charts-v1';

interface Performer { id: string; familyName?: string; givenName?: string }

@Injectable()
export class ClinicalChartResultService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClinicalChartResultDto, user: Performer) {
    const name = `${user.familyName ?? ''}${user.givenName ?? ''}`.trim() || '미상';
    // 🔴 (2026-10-10) Braden — 화면 도구는 일부 항목만 고른 부분 합도 저장했다(3항목 9점이 "매우 높음").
    //    6항목이 다 있어야 하고 총점은 서버가 항목 합으로 정한다(보낸 총점이 다르면 거부). 등급 라벨은 도구 표시 그대로 둔다.
    let resultValue = dto.resultValue ?? null;
    if (dto.chartId === 'BRADEN') {
      const { scores, invalid } = readBradenSubscores(dto.inputs);
      const sum = bradenTotalOf(scores);
      if (invalid.length || sum == null) throw new BadRequestException({ code: 'BRADEN_INCOMPLETE', message: 'Braden 은 6항목을 모두 골라야 저장됩니다.' });
      if (resultValue != null && resultValue !== sum) throw new BadRequestException({ code: 'BRADEN_SUM_MISMATCH', message: 'Braden 항목 합이 총점과 다릅니다.', details: { sum, total: resultValue } });
      resultValue = sum;
    }
    // 인카운터 연계 저장은 (encounter, chart) 단위 멱등 — 재서명/중복 저장 시 이전 행 대체
    if (dto.encounterId) {
      await this.prisma.clinicalChartResult.deleteMany({ where: { encounterId: dto.encounterId, chartId: dto.chartId } });
    }
    return this.prisma.clinicalChartResult.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId ?? null,
        chartId: dto.chartId,
        chartName: dto.chartName,
        archetype: dto.archetype,
        sourceVersion: dto.sourceVersion ?? null,
        inputs: (dto.inputs ?? {}) as Prisma.InputJsonValue,
        resultLabel: dto.resultLabel ?? null,
        resultLevel: dto.resultLevel ?? null,
        resultValue,
        recommendation: dto.recommendation ?? null,
        flags: dto.flags ?? [],
        performedBy: user.id,
        performedByName: name,
        usedToolVersion: TOOL_VERSION,
      },
    });
  }

  async findByPatient(patientId: string, chartId?: string) {
    return this.prisma.clinicalChartResult.findMany({
      where: { patientId, ...(chartId ? { chartId } : {}) },
      orderBy: { performedAt: 'desc' },
      take: 100,
    });
  }
}
