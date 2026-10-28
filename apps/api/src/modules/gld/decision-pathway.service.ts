import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 결정 **경로 엔진** — CP 엔진의 결정 축 대응물 (2026-08-28 · 계획서 §3.4 · P2).
 *
 * 🔴 발단: CP 엔진(`ProtocolTemplate`/`Step`/`Instance`/`StepState`)과 1:1로 놓으니
 *    결정 축에 **10가지가 전부 없었다** — 템플릿·버전 / 발행이력 / 단계 / 담당역할 /
 *    게이트 / SLA / 전이조건 / 버전 스냅샷 / 현재단계 / **막힌 이유**.
 *    결정은 "상태 문자열 6값 + 자유서술"이었다.
 *
 * 🔴 이 엔진이 하지 않는 것:
 *  · **자동으로 결정하지 않는다** — 경로·상태·근거를 관리할 뿐, 무엇을 고를지는 사람이다.
 *  · **막지 않는다(기본)** — 게이트는 다음 단계로 넘어가는 것만 막고, 결정 자체를 막지 않는다.
 *  · **기한을 지어내지 않는다** — `slaDays` 는 null 이 기본이다(§ 아래 실측).
 */

/** 단계 상태 — CP `ProtocolStepState` 와 같은 어휘 */
export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'SKIPPED';
export type InstanceStatus = 'ACTIVE' | 'BLOCKED' | 'DONE' | 'CANCELLED';

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  PENDING: '대기',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  BLOCKED: '막힘',
  SKIPPED: '건너뜀',
};

/**
 * 🔴 **기한(SLA) 기준값은 넣지 않았다.**
 *
 * 계획서 §6 이 "감으로 정하지 않는다 — 기존 안건의 실소요를 먼저 재라"고 했고, 재봤다.
 * 실측(2026-08-28): 의결된 안건 **20건이 전부 당일 처리**(평균 0.2일 · 중앙값 0.0 · 최대 0.6).
 * 그건 실제 위원회 소요가 아니라 **시드가 같은 날 만든 흔적**이라 표본이 아니다.
 * 그래서 기본 경로의 모든 단계는 `slaDays: null` 이고, 화면은 **"기한 미설정"** 이라 말한다.
 * 표본이 쌓이면(실제 상신→의결 20건 이상) 그때 p95 로 정한다.
 */
/** 층별 요약이 한 번에 읽는 인스턴스 상한 — 넘으면 `truncated:true` 로 밝힌다 */
export const SUMMARY_LIMIT = 1000;

export const SLA_UNSET_REASON =
  '기한 미설정 — 실운영 표본이 없다(의결 20건이 전부 당일 처리 = 시드 흔적). 감으로 정하지 않는다.';

/** 기본 경로 3종 — 결정의 세 층에 하나씩 */
export const PATHWAY_SEED: {
  code: string; name: string; layer: string; description: string;
  steps: { key: string; title: string; ownerRoles: string[]; gate?: boolean; gateRule?: string }[];
}[] = [
  {
    code: 'LICENSE', name: '허가권자 결정 경로', layer: 'LICENSE_HOLDER',
    description: '법령·인허가 사항. 🔴 원내 위원회 의결로 대체할 수 없다.',
    steps: [
      { key: 'submit', title: '상신', ownerRoles: ['ADMIN'] },
      // 🔴 이 게이트가 이 경로의 존재 이유다 — 법적 검토 없이 결재로 넘어가지 못한다
      { key: 'legal_review', title: '법적 검토', ownerRoles: ['ADMIN'], gate: true, gateRule: 'legal_review_recorded' },
      { key: 'authorize', title: '허가권자 결재', ownerRoles: ['ADMIN'] },
      { key: 'record', title: '결정 기록', ownerRoles: ['ADMIN'] },
      { key: 'followup', title: '후속 조치', ownerRoles: ['ADMIN'] },
    ],
  },
  {
    code: 'COMMITTEE', name: '위원회 의결 경로', layer: 'INTERNAL_COMMITTEE',
    description: '법적 요건이 충족된 범위 안에서 정하는 원내 운영 정책.',
    steps: [
      { key: 'submit', title: '상신', ownerRoles: ['ADMIN', 'DOCTOR', 'NURSE'] },
      { key: 'prereview', title: '사전 검토', ownerRoles: ['ADMIN'] },
      { key: 'schedule', title: '회의 배정', ownerRoles: ['ADMIN'] },
      // 🔴 참석 기록 없이 의결할 수 없다 — 이미 `resolveAgenda` 가 강제하는 것을 경로가 드러낸다
      { key: 'quorum', title: '정족수 확인', ownerRoles: ['ADMIN'], gate: true, gateRule: 'quorum_met' },
      { key: 'resolve', title: '의결(선택)', ownerRoles: ['ADMIN'] },
      { key: 'enact', title: '집행', ownerRoles: ['ADMIN'] },
      { key: 'verify', title: '반영 확인', ownerRoles: ['ADMIN'] },
    ],
  },
  {
    code: 'CODE_CHANGE', name: '코드·스키마 변경 경로', layer: 'INTERNAL_COMMITTEE',
    description: '화면으로 적용할 수 없는 결정 — 개발이 반영한다. 🔴 욕창 재평가 저장이 첫 사례다.',
    steps: [
      { key: 'submit', title: '상신', ownerRoles: ['ADMIN', 'DOCTOR', 'NURSE'] },
      { key: 'design', title: '설계', ownerRoles: ['ADMIN'] },
      { key: 'approve', title: '승인', ownerRoles: ['ADMIN'] },
      { key: 'develop', title: '개발', ownerRoles: ['ADMIN'] },
      { key: 'deploy', title: '배포', ownerRoles: ['ADMIN'] },
      // 🔴 배포했다는 것과 운영에서 동작한다는 것은 다른 사실이다
      { key: 'operate_verify', title: '운영 검증', ownerRoles: ['ADMIN'], gate: true, gateRule: 'operation_verified' },
    ],
  },
];

export interface InstanceView {
  id: string;
  pathway: { code: string; name: string; version: number; layer: string };
  source: { kind: 'AGENDA'; agendaId: string } | { kind: 'REGISTRY'; registryKey: string };
  status: InstanceStatus;
  currentStepKey: string | null;
  /** 🔴 지금 누구 손에 있는가 — 현재 단계의 담당 역할. 없으면 `null`(모른다) */
  currentOwnerRoles: string[] | null;
  /** 🔴 왜 멈춰 있는가 — 막힌 단계의 사유. 막히지 않았으면 `null` */
  blockedReason: string | null;
  /**
   * 🔴 현재 단계에 **머문 일수** — *사실*이다.
   *
   * "지연"이라 부르지 않는다. 지연은 기준이 있어야 말할 수 있는 **판정**인데
   * 기준(`slaDays`)이 없다(실운영 표본이 없어 넣지 않았다 — `SLA_UNSET_REASON`).
   * 기준 없이 "지연 N건"이라 말하면 근거 없는 경보가 된다.
   * 완료·취소된 인스턴스는 `null`(머무는 중이 아니다).
   */
  currentStepDays: number | null;
  steps: {
    key: string; title: string; sortOrder: number; ownerRoles: string[];
    gate: boolean; gateRule: string | null;
    /** null = 기한 없음(지어내지 않는다) */
    slaDays: number | null;
    status: StepStatus; actorId: string | null; actedAt: Date | null;
    blockedReason: string | null; note: string | null;
  }[];
  /** 진행률 — 🔴 분모를 함께 낸다(건너뛴 단계는 분모에서 빼지 않는다) */
  progress: { done: number; total: number };
}

@Injectable()
export class DecisionPathwayService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  private db(): PrismaService {
    if (!this.prisma) throw new BadRequestException('저장소를 사용할 수 없습니다');
    return this.prisma;
  }

  /** 기본 경로 3종 시드 — 멱등. 이미 ACTIVE 인 코드는 건드리지 않는다 */
  async seedDefaults(userId?: string): Promise<{ created: string[]; kept: string[] }> {
    const created: string[] = [];
    const kept: string[] = [];
    for (const def of PATHWAY_SEED) {
      const exist = await this.db().decisionPathway.findFirst({
        where: { code: def.code, status: 'ACTIVE' }, select: { id: true },
      });
      if (exist) { kept.push(def.code); continue; }
      await this.db().decisionPathway.create({
        data: {
          code: def.code, name: def.name, layer: def.layer, description: def.description,
          version: 1, status: 'ACTIVE', publishedAt: new Date(), publishedBy: userId ?? null,
          steps: {
            create: def.steps.map((st, i) => ({
              key: st.key, title: st.title, sortOrder: i, ownerRoles: st.ownerRoles,
              gate: st.gate ?? false, gateRule: st.gateRule ?? null,
              // 🔴 기한은 넣지 않는다 — 실운영 표본이 없다(SLA_UNSET_REASON)
              slaDays: null,
            })),
          },
        },
      });
      created.push(def.code);
    }
    return { created, kept };
  }

  /**
   * 인스턴스 시작.
   * 🔴 출처는 **배타**다 — 안건에서 온 것과 등록부에서 온 것을 섞으면
   *    "위원회가 의결하지 않은 것이 의결로 박힌다"(`DecisionAction` 과 같은 불변식).
   */
  async start(input: { code: string; agendaId?: string; registryKey?: string }): Promise<InstanceView> {
    const hasAgenda = !!input.agendaId;
    const hasRegistry = !!input.registryKey;
    if (hasAgenda === hasRegistry) {
      throw new BadRequestException({
        code: 'PATHWAY_SOURCE_EXCLUSIVE',
        message: '출처는 안건 또는 등록부 중 정확히 하나여야 합니다.',
      });
    }
    const pathway = await this.db().decisionPathway.findFirst({
      where: { code: input.code, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!pathway) throw new NotFoundException(`발효된 경로가 없습니다: ${input.code}`);
    if (pathway.steps.length === 0) throw new BadRequestException('단계가 없는 경로는 시작할 수 없습니다.');

    const inst = await this.db().decisionPathwayInstance.create({
      data: {
        pathwayId: pathway.id,
        // 🔴 버전 스냅샷 — 경로가 개정돼도 이 인스턴스는 그때의 경로를 따른다
        pathwayVersion: pathway.version,
        agendaId: input.agendaId ?? null,
        registryKey: input.registryKey ?? null,
        currentStepKey: pathway.steps[0].key,
        status: 'ACTIVE',
        states: {
          create: pathway.steps.map((st, i) => ({
            stepKey: st.key,
            // 첫 단계만 진행 중, 나머지는 대기
            status: i === 0 ? 'IN_PROGRESS' : 'PENDING',
          })),
        },
      },
    });
    return this.view(inst.id);
  }

  /**
   * 단계 완료 → 다음으로.
   * 🔴 게이트 단계는 **통과 근거 없이 넘어가지 못한다** — 다만 그 판정은 호출부가 준다
   *    (엔진이 "법적 검토가 있었는가"를 스스로 알 수 없다. 모르면 막고, 막은 이유를 남긴다).
   */
  async complete(instanceId: string, stepKey: string, opts: {
    actorId?: string; note?: string;
    /** 게이트 단계일 때 필수 — 통과 근거. 없으면 막고 사유를 남긴다 */
    gatePassed?: boolean; gateEvidence?: string;
  } = {}): Promise<InstanceView> {
    const inst = await this.db().decisionPathwayInstance.findUnique({
      where: { id: instanceId },
      include: { pathway: { include: { steps: { orderBy: { sortOrder: 'asc' } } } }, states: true },
    });
    if (!inst) throw new NotFoundException('경로 인스턴스를 찾을 수 없습니다.');
    if (inst.status === 'DONE' || inst.status === 'CANCELLED') {
      throw new BadRequestException(`${inst.status} 상태의 경로는 진행할 수 없습니다.`);
    }
    const step = inst.pathway.steps.find((s) => s.key === stepKey);
    if (!step) throw new NotFoundException(`단계가 없습니다: ${stepKey}`);

    if (step.gate && !opts.gatePassed) {
      /**
       * 🔴 **막되, 왜 막혔는지를 남긴다.**
       * 종전 결정 축에는 "막힘"이라는 상태 자체가 없었고, 있었더라도 이유가 없었다.
       * 이유가 없으면 아무도 그 결정을 다시 밀 수 없다.
       */
      const reason = `게이트 미통과(${step.gateRule ?? step.key}) — 통과 근거가 제시되지 않았습니다.`;
      await this.db().$transaction([
        this.db().decisionPathwayStepState.update({
          where: { instanceId_stepKey: { instanceId, stepKey } },
          data: { status: 'BLOCKED', blockedReason: reason, actorId: opts.actorId ?? null, actedAt: new Date() },
        }),
        this.db().decisionPathwayInstance.update({
          where: { id: instanceId }, data: { status: 'BLOCKED', currentStepKey: stepKey },
        }),
      ]);
      return this.view(instanceId);
    }

    const idx = inst.pathway.steps.findIndex((s) => s.key === stepKey);
    const next = inst.pathway.steps[idx + 1] ?? null;
    const doneNote = step.gate && opts.gateEvidence ? `게이트 통과 근거: ${opts.gateEvidence}` : (opts.note ?? null);

    await this.db().$transaction([
      this.db().decisionPathwayStepState.update({
        where: { instanceId_stepKey: { instanceId, stepKey } },
        data: {
          status: 'DONE', actorId: opts.actorId ?? null, actedAt: new Date(),
          note: doneNote, blockedReason: null,
        },
      }),
      ...(next
        ? [this.db().decisionPathwayStepState.update({
            where: { instanceId_stepKey: { instanceId, stepKey: next.key } },
            data: { status: 'IN_PROGRESS' },
          })]
        : []),
      this.db().decisionPathwayInstance.update({
        where: { id: instanceId },
        data: next
          ? { currentStepKey: next.key, status: 'ACTIVE' }
          // 마지막 단계를 끝내면 완료 — 그때만 completedAt 을 찍는다
          : { currentStepKey: null, status: 'DONE', completedAt: new Date() },
      }),
    ]);
    return this.view(instanceId);
  }

  /** 막힘 기록 — 게이트가 아니어도 사람이 막힌 이유를 남길 수 있어야 한다 */
  async block(instanceId: string, stepKey: string, reason: string, actorId?: string): Promise<InstanceView> {
    if (!reason?.trim()) {
      // 🔴 사유 없는 "막힘"은 아무 정보도 아니다
      throw new BadRequestException({ code: 'BLOCK_REASON_REQUIRED', message: '막힌 이유가 필요합니다.' });
    }
    await this.db().$transaction([
      this.db().decisionPathwayStepState.update({
        where: { instanceId_stepKey: { instanceId, stepKey } },
        data: { status: 'BLOCKED', blockedReason: reason.trim(), actorId: actorId ?? null, actedAt: new Date() },
      }),
      this.db().decisionPathwayInstance.update({
        where: { id: instanceId }, data: { status: 'BLOCKED', currentStepKey: stepKey },
      }),
    ]);
    return this.view(instanceId);
  }

  async view(instanceId: string): Promise<InstanceView> {
    const inst = await this.db().decisionPathwayInstance.findUnique({
      where: { id: instanceId },
      include: { pathway: { include: { steps: { orderBy: { sortOrder: 'asc' } } } }, states: true },
    });
    if (!inst) throw new NotFoundException('경로 인스턴스를 찾을 수 없습니다.');
    const stateOf = new Map(inst.states.map((s) => [s.stepKey, s]));
    const steps = inst.pathway.steps.map((st) => {
      const s = stateOf.get(st.key);
      return {
        key: st.key, title: st.title, sortOrder: st.sortOrder, ownerRoles: st.ownerRoles,
        gate: st.gate, gateRule: st.gateRule, slaDays: st.slaDays,
        status: (s?.status ?? 'PENDING') as StepStatus,
        actorId: s?.actorId ?? null, actedAt: s?.actedAt ?? null,
        blockedReason: s?.blockedReason ?? null, note: s?.note ?? null,
      };
    });
    const cur = steps.find((s) => s.key === inst.currentStepKey) ?? null;
    return {
      id: inst.id,
      pathway: { code: inst.pathway.code, name: inst.pathway.name, version: inst.pathwayVersion, layer: inst.pathway.layer },
      source: inst.agendaId
        ? { kind: 'AGENDA', agendaId: inst.agendaId }
        : { kind: 'REGISTRY', registryKey: inst.registryKey! },
      status: inst.status as InstanceStatus,
      currentStepKey: inst.currentStepKey,
      // 🔴 담당이 없으면 `null`(모른다) — 빈 배열로 "아무도 아니다"라 말하지 않는다
      currentOwnerRoles: cur ? (cur.ownerRoles.length ? cur.ownerRoles : null) : null,
      blockedReason: steps.find((s) => s.status === 'BLOCKED')?.blockedReason ?? null,
      // 체류 시작 = 직전 단계를 끝낸 때(없으면 인스턴스 시작). 진행 중이 아니면 `null`.
      currentStepDays: (() => {
        if (!cur || inst.status === 'DONE' || inst.status === 'CANCELLED') return null;
        const prevDone = steps
          .filter((s) => s.sortOrder < cur.sortOrder && s.actedAt)
          .sort((a, b) => (b.actedAt!.getTime() - a.actedAt!.getTime()))[0]?.actedAt;
        const from = prevDone ?? inst.startedAt;
        return Math.floor((Date.now() - from.getTime()) / 86400000);
      })(),
      steps,
      // 🔴 분모를 함께 — 건너뛴 단계도 분모에 남긴다(빼면 완료율이 부풀려진다)
      progress: { done: steps.filter((s) => s.status === 'DONE').length, total: steps.length },
    };
  }

  /** 안건/등록부 키로 인스턴스 찾기 — 없으면 `null`(만들지 않는다) */
  async findBySource(src: { agendaId?: string; registryKey?: string }): Promise<InstanceView | null> {
    const inst = await this.db().decisionPathwayInstance.findFirst({
      where: src.agendaId ? { agendaId: src.agendaId } : { registryKey: src.registryKey },
      select: { id: true },
    });
    return inst ? this.view(inst.id) : null;
  }

  /**
   * 층별 요약 (P3).
   *
   * 🔴 **층을 합치지 않는다** — 합쳐 하나의 퍼센트로 내면
   *    "위원회가 다 의결했으니 90%" 같은 거짓 안심이 생긴다(등록부 축이 이미 지키는 규칙).
   * 🔴 **"지연"을 세지 않는다** — 기준(`slaDays`)이 없다. 대신 **체류 일수**라는 사실만 낸다.
   *    기준 없이 지연을 세면 근거 없는 경보가 된다.
   */
  async summaryByLayer(): Promise<{
    layers: { layer: string; total: number; active: number; blocked: number; done: number;
              /** 진행 중인 것들의 현재 단계 체류일 — 최대·중앙값. 표본 0 이면 `null`(산출 불가) */
              stayDaysMax: number | null; stayDaysMedian: number | null }[];
    slaNote: string;
    /** 🔴 상한에 걸려 잘렸는가 — 자르면 잘랐다고 말한다(잘린 줄 모르면 이 수치가 전수인 줄 안다) */
    truncated: boolean;
    limit: number;
    measuredAt: string;
  }> {
    // 상한+1 을 읽어 "잘렸는지"를 안다(상한만 읽으면 정확히 상한일 때를 구분 못 한다)
    const rows = await this.db().decisionPathwayInstance.findMany({
      select: { id: true, status: true, pathway: { select: { layer: true } } },
      take: SUMMARY_LIMIT + 1,
    });
    const truncated = rows.length > SUMMARY_LIMIT;
    const views = await Promise.all(rows.slice(0, SUMMARY_LIMIT).map((r) => this.view(r.id)));
    // 🔴 층 목록은 **경로 정의**에서 뽑는다. 인스턴스에서 뽑으면 아직 아무도 안 쓴 층의
    //    카드가 통째로 사라져 "그런 층이 없다"로 읽힌다 — 0건은 감춰야 할 사실이 아니다.
    const allLayers = [...new Set(PATHWAY_SEED.map((p) => p.layer))].sort();
    const layers = allLayers.map((layer) => {
      const inLayer = views.filter((v) => v.pathway.layer === layer);
      const stays = inLayer.map((v) => v.currentStepDays).filter((d): d is number => d != null).sort((a, b) => a - b);
      return {
        layer,
        total: inLayer.length,
        active: inLayer.filter((v) => v.status === 'ACTIVE').length,
        blocked: inLayer.filter((v) => v.status === 'BLOCKED').length,
        done: inLayer.filter((v) => v.status === 'DONE').length,
        // 🔴 표본이 없으면 0 이 아니라 null 이다(재서 0일과 잴 것이 없는 것은 다르다)
        stayDaysMax: stays.length ? stays[stays.length - 1] : null,
        stayDaysMedian: stays.length ? stays[Math.floor(stays.length / 2)] : null,
      };
    });
    return { layers, slaNote: SLA_UNSET_REASON, truncated, limit: SUMMARY_LIMIT, measuredAt: new Date().toISOString() };
  }

  /**
   * 🔴 **막혀 있는 것들** — 이 엔진의 존재 이유.
   *    "N건 진행 중"이 아니라 **무엇이 어디서 왜 멈췄는지**를 목록으로 낸다.
   */
  async blocked(): Promise<InstanceView[]> {
    const rows = await this.db().decisionPathwayInstance.findMany({
      where: { status: 'BLOCKED' }, select: { id: true }, take: 200,
    });
    return Promise.all(rows.map((r) => this.view(r.id)));
  }
}
