import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';

export interface MilestoneTpl { key: string; label: string; targetMin: number }
interface Milestone extends MilestoneTpl { doneAt: string | null; doneBy: string | null }

/** 골든타임 프로토콜 3종 템플릿 — 핵심지표·목표시간·번들 마일스톤. primaryKey=핵심지표 시각 기준 마일스톤 */
const TEMPLATES: Record<string, { primaryMetric: string; targetMinutes: number; primaryKey: string; milestones: MilestoneTpl[] }> = {
  STEMI: {
    primaryMetric: 'Door-to-Balloon', targetMinutes: 90, primaryKey: 'balloon',
    milestones: [
      { key: 'ekg', label: '12유도 심전도', targetMin: 10 },
      { key: 'cardiology', label: '순환기내과 통보', targetMin: 15 },
      { key: 'antiplatelet', label: '항혈소판제 투여(Aspirin/P2Y12)', targetMin: 20 },
      { key: 'cathlab', label: '심도자실 활성화', targetMin: 30 },
      { key: 'balloon', label: '재관류(PCI balloon)', targetMin: 90 },
    ],
  },
  STROKE: {
    primaryMetric: 'Door-to-Needle', targetMinutes: 60, primaryKey: 'tpa',
    milestones: [
      { key: 'nihss', label: 'NIHSS 평가', targetMin: 10 },
      { key: 'neuro', label: '신경과 통보', targetMin: 15 },
      { key: 'ct', label: '뇌 CT/CTA 촬영', targetMin: 25 },
      { key: 'ctread', label: 'CT 판독', targetMin: 45 },
      { key: 'tpa', label: '혈전용해제(tPA) 투여', targetMin: 60 },
    ],
  },
  SEPSIS: {
    primaryMetric: '1시간 번들', targetMinutes: 60, primaryKey: 'antibiotics',
    milestones: [
      { key: 'lactate', label: '젖산(Lactate) 측정', targetMin: 30 },
      { key: 'culture', label: '혈액배양 채취(항생제 전)', targetMin: 45 },
      { key: 'antibiotics', label: '광범위 항생제 투여', targetMin: 60 },
      { key: 'fluid', label: '수액 30mL/kg 투여', targetMin: 60 },
      { key: 'relactate', label: '젖산 재측정', targetMin: 120 },
    ],
  },
};

@Injectable()
export class EmergencyPathwayService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly journey?: JourneyService,
  ) {}

  getTemplates() {
    return Object.entries(TEMPLATES).map(([type, t]) => ({ pathwayType: type, ...t }));
  }

  async activate(data: { visitId?: string; patientId: string; pathwayType: string }, activatedBy: string) {
    const tpl = TEMPLATES[data.pathwayType];
    if (!tpl) throw new BadRequestException('유효한 프로토콜: STEMI, STROKE, SEPSIS');
    const active = await this.prisma.emergencyGoldenPathway.findFirst({ where: { patientId: data.patientId, pathwayType: data.pathwayType, status: 'ACTIVE' } });
    if (active) throw new BadRequestException('이미 활성 프로토콜이 있습니다');
    const milestones: Milestone[] = tpl.milestones.map((m) => ({ ...m, doneAt: null, doneBy: null }));
    const created = await this.prisma.emergencyGoldenPathway.create({
      data: {
        visitId: data.visitId ?? null, patientId: data.patientId, pathwayType: data.pathwayType,
        primaryMetric: tpl.primaryMetric, targetMinutes: tpl.targetMinutes,
        milestones: milestones as unknown as Prisma.InputJsonValue, activatedBy,
      },
    });
    // 능동 통지 + 여정 이벤트 — 시간-임계 프로토콜 활성화를 담당의·타임라인에 즉시 노출.
    this.events?.emit('goldenpathway.activated', {
      pathwayId: created.id, patientId: data.patientId, pathwayType: data.pathwayType,
      primaryMetric: tpl.primaryMetric, targetMinutes: tpl.targetMinutes,
    });
    this.journey?.emit({
      patientId: data.patientId, eventType: 'GOLDEN_PATHWAY_ACTIVATED',
      // 여정 P0-5: 응급 방문에서 활성화했으면 그 방문에 귀속(방문 없이 켠 경우는 귀속 없음 — 추정하지 않는다)
      ...(data.visitId ? { refType: 'EmergencyVisit', refId: data.visitId } : {}),
      title: `골든타임 프로토콜 활성화 (${data.pathwayType})`,
      description: `${tpl.primaryMetric} 목표 ${tpl.targetMinutes}분`,
    });
    return created;
  }

  async completeMilestone(id: string, key: string, userId: string) {
    // 마일스톤 배열은 JSON read-modify-write — 서로 다른 key 동시완료가 유실되지 않도록 행잠금으로 직렬화.
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM emergency_golden_pathways WHERE id = ${id}::uuid FOR UPDATE`;
      const pw = await tx.emergencyGoldenPathway.findUnique({ where: { id } });
      if (!pw) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
      if (pw.status !== 'ACTIVE') throw new BadRequestException('활성 프로토콜만 갱신 가능');
      const milestones = pw.milestones as unknown as Milestone[];
      // 오탈자 key로 조용히 성공(no-op)되던 문제 — 미정의 마일스톤 키 거부.
      if (!milestones.some((m) => m.key === key)) {
        throw new BadRequestException({ code: 'MILESTONE_UNKNOWN', message: `정의되지 않은 마일스톤: ${key}` });
      }
      const updated = milestones.map((m) =>
        m.key === key ? { ...m, doneAt: m.doneAt ?? new Date().toISOString(), doneBy: m.doneBy ?? userId } : m,
      );
      return tx.emergencyGoldenPathway.update({ where: { id }, data: { milestones: updated as unknown as Prisma.InputJsonValue } });
    });
  }

  async complete(id: string) {
    const pw = await this.prisma.emergencyGoldenPathway.findUnique({ where: { id } });
    if (!pw) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    if (pw.status !== 'ACTIVE') throw new BadRequestException('활성 프로토콜만 완료 가능');
    // 핵심지표(door-to-balloon 등)는 벽시계(완료버튼 시각)가 아니라 primary 마일스톤 doneAt 기준.
    // primary 미완료면 지표 미달성(null) — now() 폴백으로 실측과 구분없는 가짜 수치를 저장하던 QI 오염 제거.
    const tpl = TEMPLATES[pw.pathwayType];
    const milestones = pw.milestones as unknown as Milestone[];
    const primary = tpl ? milestones.find((m) => m.key === tpl.primaryKey) : undefined;
    const mins = primary?.doneAt
      ? Math.max(0, Math.round((new Date(primary.doneAt).getTime() - new Date(pw.activatedAt).getTime()) / 60000))
      : null;
    // 원자적 종료 — ACTIVE 조건부 updateMany로 동시 complete/cancel 모순상태(취소인데 지표존재) 방지.
    const claimed = await this.prisma.emergencyGoldenPathway.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completedAt: new Date(), primaryMetricMinutes: mins },
    });
    if (claimed.count === 0) throw new ConflictException('이미 종료된 프로토콜입니다');
    return this.prisma.emergencyGoldenPathway.findUnique({ where: { id } });
  }

  async cancel(id: string, reason?: string) {
    const pw = await this.prisma.emergencyGoldenPathway.findUnique({ where: { id } });
    if (!pw) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    if (pw.status !== 'ACTIVE') throw new BadRequestException('활성 프로토콜만 취소 가능');
    const claimed = await this.prisma.emergencyGoldenPathway.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'CANCELLED', notes: reason ?? null },
    });
    if (claimed.count === 0) throw new ConflictException('이미 종료된 프로토콜입니다');
    return this.prisma.emergencyGoldenPathway.findUnique({ where: { id } });
  }

  /** 활성 프로토콜 + 경과/목표/온타임 파생 */
  async getActive() {
    const now = Date.now();
    const list = await this.prisma.emergencyGoldenPathway.findMany({ where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'asc' } });
    const patIds = [...new Set(list.map((p) => p.patientId))];
    const pats = patIds.length ? await this.prisma.patient.findMany({ where: { id: { in: patIds } }, select: { id: true, familyName: true, givenName: true, mrn: true } }) : [];
    const pMap = new Map(pats.map((p) => [p.id, p]));
    return list.map((pw) => {
      const elapsed = Math.floor((now - new Date(pw.activatedAt).getTime()) / 60000);
      const p = pMap.get(pw.patientId);
      const milestones = (pw.milestones as unknown as Milestone[]).map((m) => ({
        ...m,
        done: !!m.doneAt,
        overdue: !m.doneAt && elapsed > m.targetMin,
      }));
      return {
        id: pw.id, visitId: pw.visitId, patientId: pw.patientId,
        name: p ? `${p.familyName}${p.givenName}` : '-', mrn: p?.mrn ?? '-',
        pathwayType: pw.pathwayType, primaryMetric: pw.primaryMetric, targetMinutes: pw.targetMinutes,
        activatedAt: pw.activatedAt, elapsed, overTarget: elapsed > pw.targetMinutes,
        remaining: pw.targetMinutes - elapsed, milestones,
        doneCount: milestones.filter((m) => m.done).length, total: milestones.length,
      };
    });
  }

  async getByPatient(patientId: string) {
    return this.prisma.emergencyGoldenPathway.findMany({ where: { patientId }, orderBy: { activatedAt: 'desc' }, take: 100 });
  }
}
