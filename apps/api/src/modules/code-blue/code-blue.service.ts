import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ActivateRrtDto, CreateCodeBlueDto, RespondRrtDto, UpdateCodeBlueDto } from './dto/code-blue.dto';

/**
 * 원내 심정지 코드블루·신속대응팀(RRT) 임상 기록(P2-C).
 * 코드블루 *알림*은 StaffCall(type=CODE)로 이미 존재 — 본 서비스는 CPR/ROSC/제세동/팀도착 등
 * 소생 경과와 RRT 활성화 SLA를 남긴다. FK는 relation 미사용 컬럼(수동 조인).
 */
@Injectable()
export class CodeBlueService {
  constructor(private readonly prisma: PrismaService) {}

  private async attachPatients<T extends { patientId: string }>(rows: T[]) {
    const pids = [...new Set(rows.map((r) => r.patientId))];
    const pats = pids.length
      ? await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, familyName: true, givenName: true, mrn: true } })
      : [];
    const pmap = new Map(pats.map((p) => [p.id, p]));
    return pmap;
  }

  // ── 코드블루 ──
  async createCodeBlue(userId: string, dto: CreateCodeBlueDto) {
    if (!dto.patientId) throw new BadRequestException('patientId는 필수입니다');
    return this.prisma.codeBlueEvent.create({
      data: {
        patientId: String(dto.patientId),
        admissionId: dto.admissionId ? String(dto.admissionId) : undefined,
        staffCallId: dto.staffCallId ? String(dto.staffCallId) : undefined,
        location: dto.location ? String(dto.location).slice(0, 100) : '미상',
        recognizedAt: dto.recognizedAt ? new Date(String(dto.recognizedAt)) : new Date(),
        cprStartedAt: dto.cprStartedAt ? new Date(String(dto.cprStartedAt)) : undefined,
        recordedBy: userId,
        notes: dto.notes ? String(dto.notes) : undefined,
      },
    });
  }

  async updateCodeBlue(id: string, dto: UpdateCodeBlueDto) {
    const ev = await this.prisma.codeBlueEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('코드블루 기록을 찾을 수 없습니다');
    const data: Prisma.CodeBlueEventUpdateInput = {};
    for (const f of ['teamArrivedAt', 'cprStartedAt', 'roscAt', 'endedAt'] as const) {
      if (dto[f]) data[f] = new Date(String(dto[f]));
    }
    if (dto.defibrillationCount != null) data.defibrillationCount = Number(dto.defibrillationCount);
    if (dto.medications !== undefined) data.medications = dto.medications as Prisma.InputJsonValue;
    if (dto.outcome) data.outcome = dto.outcome;
    if (dto.notes !== undefined) data.notes = dto.notes ? String(dto.notes) : null;
    return this.prisma.codeBlueEvent.update({ where: { id }, data });
  }

  async listCodeBlue(patientId?: string) {
    const events = await this.prisma.codeBlueEvent.findMany({
      where: patientId ? { patientId } : {},
      orderBy: { recognizedAt: 'desc' },
      take: 200,
    });
    const pmap = await this.attachPatients(events);
    return events.map((e) => ({
      ...e,
      patient: pmap.get(e.patientId) ?? null,
      responseMinutes: e.teamArrivedAt ? Math.round((e.teamArrivedAt.getTime() - e.recognizedAt.getTime()) / 60000) : null,
    }));
  }

  async codeBlueStats(month?: string) {
    const where: Prisma.CodeBlueEventWhereInput = {};
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = new Date(`${month}-01T00:00:00Z`);
      const end = new Date(start); end.setMonth(end.getMonth() + 1);
      where.recognizedAt = { gte: start, lt: end };
    }
    const all = await this.prisma.codeBlueEvent.findMany({ where });
    const total = all.length;
    const rosc = all.filter((e) => e.outcome === 'ROSC').length;
    const death = all.filter((e) => e.outcome === 'DEATH').length;
    const ongoing = all.filter((e) => e.outcome === 'ONGOING').length;
    const transfer = all.filter((e) => e.outcome === 'TRANSFER').length;
    const arrivals = all.filter((e) => e.teamArrivedAt).map((e) => (e.teamArrivedAt!.getTime() - e.recognizedAt.getTime()) / 60000);
    const avgArrival = arrivals.length ? Math.round((arrivals.reduce((a, b) => a + b, 0) / arrivals.length) * 10) / 10 : null;
    return {
      total, rosc, death, ongoing, transfer,
      // 🔴 표본 0 은 0% 가 아니라 산출 불가(null) — 같은 응답 안에서 avgArrival 과 표현을 맞춘다(2026-09-06).
      //    분모는 진행중(ONGOING) 포함 전체 — 소비처는 ongoing 을 병기해 과소 산출 여지를 밝힌다.
      roscRate: total ? Math.round((rosc / total) * 1000) / 10 : null, // %
      avgArrivalMinutes: avgArrival,
      arrivalsN: arrivals.length, // avgArrival 의 분모(팀도착 기록이 있는 건)
    };
  }

  // ── RRT(신속대응팀) ──
  async activateRrt(userId: string, dto: ActivateRrtDto) {
    if (!dto.patientId) throw new BadRequestException('patientId는 필수입니다');
    const patientId = String(dto.patientId);
    const trigger = dto.trigger ?? 'DIRECT_CALL';
    let ewsId = dto.ewsId ? String(dto.ewsId) : undefined;
    // NEWS2 트리거인데 EWS 미지정 시, 최신 에스컬레이션 EWS 자동 참조(조기경보→RRT 연계)
    if (!ewsId && trigger === 'NEWS2') {
      const ews = await this.prisma.earlyWarningScore.findFirst({
        where: { patientId, escalationRequired: true },
        orderBy: { recordedAt: 'desc' }, select: { id: true },
      });
      ewsId = ews?.id;
    }
    return this.prisma.rrtActivation.create({
      data: {
        patientId, ewsId, trigger,
        activatedAt: dto.activatedAt ? new Date(String(dto.activatedAt)) : new Date(),
        responderTeam: dto.responderTeam ? String(dto.responderTeam).slice(0, 100) : undefined,
        reason: dto.reason ? String(dto.reason) : undefined,
        recordedBy: userId,
      },
    });
  }

  async respondRrt(id: string, dto: RespondRrtDto) {
    const r = await this.prisma.rrtActivation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('RRT 기록을 찾을 수 없습니다');
    const data: Prisma.RrtActivationUpdateInput = {};
    if (dto.respondedAt || !r.respondedAt) data.respondedAt = dto.respondedAt ? new Date(String(dto.respondedAt)) : new Date();
    if (dto.responderTeam) data.responderTeam = String(dto.responderTeam).slice(0, 100);
    if (dto.outcome) data.outcome = dto.outcome;
    return this.prisma.rrtActivation.update({ where: { id }, data });
  }

  async listRrt(patientId?: string) {
    const acts = await this.prisma.rrtActivation.findMany({
      where: patientId ? { patientId } : {},
      orderBy: { activatedAt: 'desc' }, take: 200,
    });
    const pmap = await this.attachPatients(acts);
    return acts.map((a) => ({
      ...a,
      patient: pmap.get(a.patientId) ?? null,
      slaMinutes: a.respondedAt ? Math.round((a.respondedAt.getTime() - a.activatedAt.getTime()) / 60000) : null,
    }));
  }
}
