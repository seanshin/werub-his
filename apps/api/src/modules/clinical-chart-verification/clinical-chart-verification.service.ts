import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateChartVerificationDto } from './dto/clinical-chart-verification.dto';

interface Verifier { id: string; familyName?: string; givenName?: string }

/**
 * 🔴 4-eyes 기본값을 **on** 으로 뒤집었다.
 *    원 결함: SystemConfig 'clinical.verificationFourEyes' 행이 아예 없어(운영 실측 0행) 기본 off 였고,
 *    그 결과 **1인 승인만으로 임상 가이드라인이 「검증됨」** 이 됐다. 승인 권한은 @Roles(DOCTOR, ADMIN) 이라
 *    비임상 전산 관리자 1인도 89개 임상도구를 혼자 승인할 수 있었다.
 *    기본값 on 은 fail-closed 방향(등급을 낮추기만 하고 올리지 않는다)이라 무중단이다:
 *    현재 검수 기록이 0행이므로 표시 상태는 바뀌지 않는다.
 *    끄려면 config 행을 명시적으로 false 로 만들어야 한다(= 끈 사람이 남는다).
 */
const FOUR_EYES_DEFAULT = true;

export interface ChartVerificationSummary {
  chartId: string;
  status: string;                 // 최신 레코드 상태 (VERIFIED | REJECTED)
  verifiedByName: string;         // 최신 검수자
  createdAt: Date;
  sourceGuideline?: string | null;
  sourceVersion?: string | null;
  note?: string | null;
  defHash?: string | null;        // 최신 승인 시점 정의 해시
  /** 마지막 REJECTED 이후 연속 VERIFIED 구간의 서로 다른 승인자 수 (4-eyes 판정용) */
  approverCount: number;
  approverNames: string[];
}

/** 4-eyes 게이트 상태 — 'config'=관리자가 명시 설정, 'default'=설정 행 없음(안전 기본값) */
export type FourEyesSource = 'config' | 'default';

/**
 * 임상차트 검수 기록 — append-only(수정/삭제 없음).
 * chartId별 최신 레코드가 현재 검수 상태. 정의(코드)의 verified=false 를 런타임에 오버라이드.
 * 4-eyes(2인 승인)는 SystemConfig 'clinical.verificationFourEyes' 게이트(설정 행이 없으면 **on** — 아래 FOUR_EYES_DEFAULT · 끄려면 설정을 false 로).
 */
@Injectable()
export class ClinicalChartVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 4-eyes 설정 조회 — 설정 행이 없으면 안전 기본값(on).
   * 🔴 원 결함: `cfg?.value === true || cfg?.value?.enabled === true` 는 **행이 없으면 false**(=off) 였다.
   *    "설정을 안 했다"가 "2인 검수를 끈다"로 읽히면 안 된다.
   */
  private async resolveFourEyes(): Promise<{ fourEyes: boolean; fourEyesSource: FourEyesSource }> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'clinical.verificationFourEyes' } });
    if (!cfg) return { fourEyes: FOUR_EYES_DEFAULT, fourEyesSource: 'default' };
    const v = cfg.value as unknown;
    const enabled = v === true || (typeof v === 'object' && v !== null && (v as { enabled?: boolean }).enabled === true);
    return { fourEyes: enabled, fourEyesSource: 'config' };
  }

  /**
   * 검수 기록(append-only).
   * 🔴 자가 승인 차단: 동일 정의(defHash)에 대해 **같은 사람이 두 번 승인**하는 것을 거부한다.
   *    집계(getSummary)는 승인자를 Set 으로 세므로 중복 승인이 2인으로 카운트되지는 않았지만,
   *    화면에는 "승인 기록됨" 이라고만 떠서 검수자가 2차 승인이 끝난 줄 알 수 있었다.
   *    이제 서버가 거부하고 이유를 말한다 — 2차 승인은 반드시 다른 사람이 해야 한다.
   *    (반려 REJECTED 는 누구든 몇 번이든 가능 — 안전 방향이라 막지 않는다)
   */
  async create(dto: CreateChartVerificationDto, user: Verifier) {
    if (dto.status === 'VERIFIED') {
      const prior = await this.prisma.clinicalChartVerification.findMany({
        where: { chartId: dto.chartId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { status: true, verifiedBy: true, defHash: true },
      });
      for (const r of prior) {
        if (r.status !== 'VERIFIED') break;          // 마지막 반려 이전은 무효 구간
        if ((r.defHash ?? null) !== (dto.defHash ?? null)) continue; // 옛 정의에 대한 승인은 별개
        if (r.verifiedBy === user.id) {
          throw new ConflictException(
            '이미 동일한 정의에 대한 귀하의 승인이 기록되어 있습니다. 2인 검수(4-eyes)의 2차 승인은 다른 검수자가 수행해야 합니다.',
          );
        }
      }
    }

    const name = `${user.familyName ?? ''}${user.givenName ?? ''}`.trim() || '미상';
    return this.prisma.clinicalChartVerification.create({
      data: {
        chartId: dto.chartId,
        status: dto.status,
        sourceGuideline: dto.sourceGuideline ?? null,
        sourceVersion: dto.sourceVersion ?? null,
        defHash: dto.defHash ?? null,
        note: dto.note ?? null,
        verifiedBy: user.id,
        verifiedByName: name,
      },
    });
  }

  /** chartId별 검수 요약(최신 상태 + 4-eyes 승인자 집계) + 4-eyes 설정 */
  async getSummary() {
    const [records, gate] = await Promise.all([
      // chartId별 최신 상태 집계 — 안전 상한(정상 규모 « 20000). 초과 시 상위 최신만(오래된 이력은 요약 불필요)
      this.prisma.clinicalChartVerification.findMany({ orderBy: { createdAt: 'desc' }, take: 20000 }),
      this.resolveFourEyes(),
    ]);
    const { fourEyes, fourEyesSource } = gate;

    const byChart = new Map<string, typeof records>();
    for (const r of records) {
      if (!byChart.has(r.chartId)) byChart.set(r.chartId, []);
      byChart.get(r.chartId)!.push(r); // createdAt desc 유지
    }

    const items: ChartVerificationSummary[] = [];
    for (const [chartId, list] of byChart) {
      const latest = list[0];
      // 마지막 REJECTED 이후 연속 VERIFIED 구간(최신부터)에서 distinct 승인자 집계
      const approvers = new Map<string, string>();
      if (latest.status === 'VERIFIED') {
        for (const r of list) {
          if (r.status !== 'VERIFIED') break;
          // 정의 해시가 최신 승인과 다른(=옛 정의에 대한) 승인은 4-eyes 집계에서 제외
          if (latest.defHash && r.defHash && r.defHash !== latest.defHash) continue;
          approvers.set(r.verifiedBy, r.verifiedByName);
        }
      }
      items.push({
        chartId,
        status: latest.status,
        verifiedByName: latest.verifiedByName,
        createdAt: latest.createdAt,
        sourceGuideline: latest.sourceGuideline,
        sourceVersion: latest.sourceVersion,
        note: latest.note,
        defHash: latest.defHash,
        approverCount: approvers.size,
        approverNames: Array.from(approvers.values()),
      });
    }
    return { fourEyes, fourEyesSource, items };
  }

  /** 특정 차트의 전체 검수 이력 */
  async findHistory(chartId: string) {
    return this.prisma.clinicalChartVerification.findMany({
      where: { chartId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
