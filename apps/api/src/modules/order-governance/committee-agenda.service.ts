import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GovernanceService } from '../gld/governance.service';
import { GovernanceEnactmentService } from '../gld/governance-enactment.service';

/** 화면에서 위원회로 올리는 안건의 출처 — 안건 목록·중복 판정의 축 */
// 2026-10-08 QI 흐름 — 질 지표 목표(QI_INDICATOR)·QI 보고서(QI_REPORT)·환자안전사고 검토(SAFETY_INCIDENT)
// 2026-10-21 임상 규칙 P5 B4 — 약속처방 사용 중 전환(CATALOG_ORDER_SET)
export const SCREEN_AGENDA_SOURCES = ['ORDER_ATTENTION', 'CPOE_QI', 'QI_INDICATOR', 'QI_REPORT', 'SAFETY_INCIDENT', 'CATALOG_ORDER_SET'] as const;
export type ScreenAgendaSource = (typeof SCREEN_AGENDA_SOURCES)[number];
const OPEN_AGENDA = ['SUBMITTED', 'SCHEDULED', 'DEFERRED'];

export interface AgendaOption { value: string; label: string; effect: string; enact: { kind: string; target: Record<string, unknown> } | null }

/**
 * 위원회 안건 다리(2026-10-07) — 기준·목표처럼 **위원회가 정할 것**을 그 기능이 있는 화면에서 안건으로 올린다.
 *
 * 🔴 화면은 값을 바꾸지 않는다 — 선택지(enact 포함)를 만든 안건을 담당 위원회에 올릴 뿐이다.
 *    바뀌는 것은 위원회가 의결한 선택지를 집행 엔진이 반영할 때다(기록 ≠ 적용 · 정본 `GovernanceService`).
 * 🔴 담당 위원회는 거버넌스 표면 매핑(provenance)이 정한다 — 화면이 고르지 않는다. 담당이 없으면 올리지 않고 그렇다고 말한다.
 * 🔴 같은 대상의 열린 안건이 있으면 409 — 두 번 올리면 위원회가 같은 것을 두 번 의결한다.
 * 🔴 선택지의 enact 는 올릴 때 엔진 검증(validateAction)을 먼저 지난다 — 의결 때 가서야 거부되면 위원회 시간을 버린다.
 */
@Injectable()
export class CommitteeAgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: GovernanceService,
    private readonly enactment: GovernanceEnactmentService,
  ) {}

  async ownerCommittee(surfaceKey: string) {
    const prov = await this.governance.provenance(surfaceKey);
    const code = prov.owners.find((o) => o.code)?.code ?? null;
    const committee = code ? await this.prisma.committee.findUnique({ where: { code }, select: { id: true, code: true, name: true } }) : null;
    if (!committee) {
      throw new BadRequestException({ code: 'AGENDA_NO_OWNER', message: '이 기준을 맡은 위원회가 지정되어 있지 않습니다 — 거버넌스에서 담당을 먼저 정해야 합니다', surfaceKey });
    }
    return committee;
  }

  async openAgenda(source: ScreenAgendaSource, key: string) {
    return this.prisma.committeeAgenda.findFirst({
      where: {
        status: { in: OPEN_AGENDA },
        AND: [{ sourceRef: { path: ['type'], equals: source } }, { sourceRef: { path: ['key'], equals: key } }],
      },
      select: { id: true, title: true, status: true, createdAt: true },
    });
  }

  async submit(input: {
    surfaceKey: string; source: ScreenAgendaSource; key: string; title: string; body: string; options: AgendaOption[];
  }, proposerId: string) {
    const committee = await this.ownerCommittee(input.surfaceKey);
    const open = await this.openAgenda(input.source, input.key);
    if (open) throw new ConflictException({ code: 'AGENDA_OPEN', message: '같은 대상의 안건이 이미 위원회에 올라가 있습니다', agendaId: open.id, status: open.status });
    for (const o of input.options) if (o.enact) this.enactment.validateAction(o.enact.kind, o.enact.target);
    const agenda = await this.governance.submitAgenda(proposerId, {
      committeeId: committee.id,
      title: input.title,
      body: input.body,
      sourceRef: { type: input.source, key: input.key, surfaceKey: input.surfaceKey },
      options: input.options as unknown as Record<string, unknown>[],
    });
    return { agenda, committee };
  }

  /** 화면 출처 안건 목록 — 대상별 최근 안건과 의결 번호 */
  async list(sources: readonly ScreenAgendaSource[]) {
    const rows = await this.prisma.committeeAgenda.findMany({
      where: { OR: sources.map((s) => ({ sourceRef: { path: ['type'], equals: s } })) },
      include: { committee: { select: { code: true, name: true } }, decision: { select: { decisionNo: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => {
      const ref = (r.sourceRef ?? {}) as { type?: string; key?: string };
      return {
        id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, source: ref.type ?? null, key: ref.key ?? null,
        committee: r.committee, decision: r.decision,
      };
    });
  }
}
