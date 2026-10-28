import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GldService } from '../gld/gld.service';
import { GovernanceService } from '../gld/governance.service';
import { GovernanceEnactmentService } from '../gld/governance-enactment.service';
import { DECISION_REGISTRY } from './decision.registry';
import { DecisionService, isSeedDecisionRecord } from './decision.service';
import { mechanismOf } from './decision-engine';
import { COMMITTEE_CODES, committeeMayDecide, type CommitteeCode } from '@hospital-run/shared';

export interface BulkDecisionInput {
  committeeCode: string;
  items: Array<{ key: string; choice: string }>;
  /** 근거 — 회의록·의결 근거 문서 번호 등(필수) */
  basisRef: string;
  /** 권한 근거 — 권한자 경로 항목에 쓴다(위원회 경로는 의결한 위원회가 권한이다) */
  authorityClaim: string;
  note?: string;
  /** 위원회 경로 항목이 있으면 필수 — 회의 일시·참석자(계정) */
  meeting?: { heldAt: string; attendeeUserIds: string[]; title?: string } | null;
  /** 의결 직후 집행할 것인가(자동 집행 스위치가 꺼져 있으면 집행하지 않고 그 사실을 말한다) */
  enactNow?: boolean;
}

/**
 * 일괄 **상정**(2026-10-21 사용자 "안건 상정까지 기능 구현") — 의결 없이 안건 접수 + (고르면) 회의 배정까지.
 *  · 회의: 없음(접수만 — 간사가 나중에 배정) / 이 위원회의 예정 회의 / 새 회의(예정 일시 — 참석자는 회의 때 사람이 넣는다)
 */
export interface BulkSubmitInput {
  committeeCode: string;
  keys: string[];
  meeting?: { meetingId: string } | { scheduledAt: string; title?: string } | null;
}
export type BulkSubmitItemResult = { key: string; ok: boolean; agendaId?: string; status?: 'SUBMITTED' | 'SCHEDULED'; error?: { code: string; message: string } };

export type BulkItemResult = {
  key: string; choice: string; ok: boolean;
  path: 'COMMITTEE' | 'ROLE' | null;
  decisionNo?: string; agendaId?: string;
  registryWritten?: boolean; engine?: unknown; enact?: unknown;
  error?: { code: string; message: string };
};

const errOf = (e: unknown): { code: string; message: string } => {
  const r = (e as { response?: { code?: string; message?: string } })?.response;
  return { code: r?.code ?? 'FAILED', message: r?.message ?? (e instanceof Error ? e.message : String(e)) };
};

/**
 * 위원회 중요결정 **일괄 의사결정**(2026-10-11 사용자 "관련된 위원회 중요결정사항에 대해서 일괄 변경").
 *
 * 🔴 일괄이어도 경로는 하나씩과 같다 — 지름길을 만들지 않는다.
 *  · 위원회 경로(COMMITTEE·CODE_CHANGE): 회의 하나(사람이 고른 참석자) → 결정마다 안건 → 회의 배정 → **의결**(정족수·명부 대조·선택지 검증은 의결 코드 그대로)
 *    → 등록부 기록·결정 이력·후행 전파는 의결 경로가 한다(v4.52·v4.55)
 *  · 권한자 경로(위원회 층이지만 직책이 정하는 것): 결정 화면과 같은 `decide()`
 *  · 허가권자·직원 층·건별 판단은 여기서 정하지 않는다(근거 문서·업무 화면이 필요하다)
 * 🔴 참석자·회의 일시는 **사람이 넣는다** — 명부로 참석자를 채우면 아무도 오지 않은 회의가 정족수를 넘는다.
 * 🔴 원자적이지 않다 — 항목마다 성공/실패를 돌려준다(일부 실패를 전체 성공으로 말하지 않는다).
 */
@Injectable()
export class DecisionBulkService {
  private readonly logger = new Logger(DecisionBulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gld: GldService,
    private readonly governance: GovernanceService,
    private readonly enactment: GovernanceEnactmentService,
    private readonly decisions: DecisionService,
  ) {}

  /** 항목 사전 검증 — 하나라도 틀리면 아무것도 하지 않는다(검증 실패는 일부 실행의 이유가 아니다) */
  private plan(input: BulkDecisionInput) {
    const code = input.committeeCode as CommitteeCode;
    if (!(COMMITTEE_CODES as readonly string[]).includes(code)) {
      throw new BadRequestException({ code: 'BULK_COMMITTEE', message: '위원회 코드가 아닙니다' });
    }
    if (!input.items?.length) throw new BadRequestException({ code: 'BULK_EMPTY', message: '고른 결정이 없습니다' });
    if (input.items.length > 50) throw new BadRequestException({ code: 'BULK_TOO_MANY', message: '한 번에 50건까지 정할 수 있습니다' });
    if ((input.basisRef ?? '').trim().length < 4) throw new BadRequestException({ code: 'BULK_BASIS_REQUIRED', message: '의사결정 근거(회의록·문서 번호 등)를 입력해야 합니다' });
    const seen = new Set<string>();
    const problems: Array<{ key: string; code: string }> = [];
    const rows = input.items.map((it) => {
      const def = DECISION_REGISTRY.find((d) => d.key === it.key);
      if (seen.has(it.key)) problems.push({ key: it.key, code: 'DUPLICATE' });
      seen.add(it.key);
      if (!def) { problems.push({ key: it.key, code: 'NOT_REGISTERED' }); return null; }
      if (def.layer !== 'INTERNAL_COMMITTEE') problems.push({ key: it.key, code: 'NOT_COMMITTEE_LAYER' });
      if (!committeeMayDecide(def.key, code)) problems.push({ key: it.key, code: 'NOT_ASSIGNED' });
      if (mechanismOf(def) === 'PER_EVENT') problems.push({ key: it.key, code: 'PER_EVENT' });
      if (!def.options.some((o) => o.value === it.choice)) problems.push({ key: it.key, code: 'INVALID_CHOICE' });
      const path: 'COMMITTEE' | 'ROLE' = def.approvalPath === 'AUTHORIZED_ROLE' ? 'ROLE' : 'COMMITTEE';
      return { def, choice: it.choice, path };
    });
    if (problems.length) {
      throw new BadRequestException({ code: 'BULK_INVALID', message: '정할 수 없는 항목이 있습니다 — 아무것도 정하지 않았습니다', details: { problems } });
    }
    const plan = rows.filter((r): r is NonNullable<typeof r> => !!r);
    if (plan.some((p) => p.path === 'ROLE') && (input.authorityClaim ?? '').trim().length < 2) {
      throw new BadRequestException({ code: 'BULK_AUTHORITY_REQUIRED', message: '권한자 경로 항목이 있습니다 — 권한 근거를 입력해야 합니다' });
    }
    return { code, plan };
  }

  async decide(input: BulkDecisionInput, userId: string) {
    const { code, plan } = this.plan(input);
    const committeeItems = plan.filter((p) => p.path === 'COMMITTEE');
    let meetingId: string | null = null;
    let committeeId: string | null = null;

    if (committeeItems.length) {
      const m = input.meeting;
      const at = m?.heldAt ? new Date(m.heldAt) : null;
      if (!m || !at || Number.isNaN(at.getTime())) {
        throw new BadRequestException({ code: 'BULK_MEETING_REQUIRED', message: '위원회 의결 항목이 있습니다 — 회의 일시를 입력해야 합니다' });
      }
      if (at.getTime() > Date.now() + 5 * 60_000) {
        throw new BadRequestException({ code: 'BULK_MEETING_FUTURE', message: '아직 열리지 않은 회의로 의결할 수 없습니다' });
      }
      const committee = await this.prisma.committee.findUnique({ where: { code }, select: { id: true, quorum: true, name: true } });
      if (!committee) throw new BadRequestException({ code: 'BULK_COMMITTEE_MISSING', message: '위원회가 아직 만들어지지 않았습니다' });
      const attendees = [...new Set(m.attendeeUserIds ?? [])];
      // 🔴 의결 코드도 정족수를 본다 — 여기서 먼저 막는 이유는 회의·안건을 만들고 전부 실패하는 것을 피하려는 것뿐이다
      if (attendees.length === 0 || (committee.quorum > 0 && attendees.length < committee.quorum)) {
        throw new BadRequestException({ code: 'QUORUM_NOT_MET', message: '참석자가 정족수보다 적습니다', details: { attendees: attendees.length, quorum: committee.quorum } });
      }
      committeeId = committee.id;
      const meeting = await this.gld.createMeeting({
        committeeId, title: m.title?.trim() || committee.name, scheduledAt: at.toISOString(),
        agenda: input.basisRef.trim(), createdBy: userId, attendees,
      });
      meetingId = meeting.id;
    }

    const results: BulkItemResult[] = [];
    for (const p of plan) {
      const r: BulkItemResult = { key: p.def.key, choice: p.choice, ok: false, path: p.path };
      try {
        if (p.path === 'ROLE') {
          const out = await this.decisions.decide(p.def.key, userId, {
            choice: p.choice, legalReviewRef: input.basisRef.trim(), authorityClaim: input.authorityClaim.trim(), note: input.note,
          });
          r.ok = true; r.engine = out.engine;
        } else {
          // 이미 상정(접수)된 안건이 있으면 그 안건을 의결한다 — 같은 결정의 안건을 둘 만들지 않는다(2026-10-21)
          const open = await this.governance.openDecisionAgenda(p.def.key);
          if (open && open.committeeId !== committeeId) {
            throw new BadRequestException({ code: 'DECISION_AGENDA_OTHER_COMMITTEE', message: '이 결정은 다른 위원회 안건으로 올라가 있습니다 — 그 위원회에서 의결하거나 안건을 철회하세요', details: { agendaId: open.id, committee: open.committee?.code ?? null } });
          }
          const agenda: { id: string; options?: unknown } = open
            ? await this.prisma.committeeAgenda.findUniqueOrThrow({ where: { id: open.id }, select: { id: true, options: true } })
            : await this.governance.submitAgenda(userId, {
                committeeId: committeeId!, title: p.def.title, body: p.def.why, sourceRef: { type: 'DECISION', key: p.def.key },
              });
          r.agendaId = agenda.id;
          await this.governance.updateAgenda(agenda.id, { meetingId: meetingId! });
          const opt = p.def.options.find((o) => o.value === p.choice)!;
          const resolved = await this.governance.resolveAgenda(agenda.id, {
            resolution: opt.label,
            chosenOption: { value: p.choice, snapshot: (agenda.options ?? []) as unknown[], ...(input.note?.trim() ? { note: input.note.trim() } : {}) },
          }, userId) as { id: string; decisionNo: string; registryRecord?: { written: boolean; engine?: unknown } };
          r.decisionNo = resolved.decisionNo;
          r.registryWritten = resolved.registryRecord?.written ?? false;
          r.engine = resolved.registryRecord?.engine;
          r.ok = true;
          if (input.enactNow) {
            r.enact = await this.enactment.enactDecision(resolved.id, userId).catch((e) => ({ error: errOf(e) }));
          }
        }
      } catch (e) {
        r.ok = false; r.error = errOf(e);
        this.logger.warn(`일괄 의사결정 실패 ${p.def.key}: ${r.error.code} ${r.error.message}`);
      }
      results.push(r);
    }
    return {
      committeeCode: code, meetingId,
      total: results.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length,
      results,
    };
  }

  /**
   * 일괄 상정 — 🔴 하나씩 올리는 것과 같은 경로(`submitAgenda` → `updateAgenda`)를 차례로 지난다(배정 위원회·선택지 물려받기·중복 금지 그대로).
   *  · 검증 실패면 아무것도 만들지 않는다 · 실행은 항목마다 결과(원자적이지 않다)
   *  · 🔴 상정은 의결이 아니다 — 등록부·설정·결정 이력은 바뀌지 않는다(개발 시드도 그대로)
   *  · 이미 실결정이 있는 결정은 일괄로 올리지 않는다(재상정은 결정 화면에서 하나씩 — 다시 정하는 일이라서)
   *  · 권한자가 기록하는 결정(위원회 층이지만 직책이 정함)은 안건이 아니다
   */
  async submit(input: BulkSubmitInput, userId: string) {
    const code = input.committeeCode as CommitteeCode;
    if (!(COMMITTEE_CODES as readonly string[]).includes(code)) {
      throw new BadRequestException({ code: 'BULK_COMMITTEE', message: '위원회 코드가 아닙니다' });
    }
    const keys = input.keys ?? [];
    if (!keys.length) throw new BadRequestException({ code: 'BULK_EMPTY', message: '고른 결정이 없습니다' });
    if (keys.length > 50) throw new BadRequestException({ code: 'BULK_TOO_MANY', message: '한 번에 50건까지 올릴 수 있습니다' });

    const records = await this.prisma.systemConfig.findMany({ where: { key: { in: keys.map((k) => `decision.${k}`) } }, select: { key: true, value: true } });
    const recordOf = new Map(records.map((r) => [r.key.slice('decision.'.length), r.value as Record<string, unknown> | null]));
    const problems: Array<{ key: string; code: string; agendaId?: string }> = [];
    const seen = new Set<string>();
    const defs = [];
    for (const k of keys) {
      if (seen.has(k)) { problems.push({ key: k, code: 'DUPLICATE' }); continue; }
      seen.add(k);
      const def = DECISION_REGISTRY.find((d) => d.key === k);
      if (!def) { problems.push({ key: k, code: 'NOT_REGISTERED' }); continue; }
      if (def.layer !== 'INTERNAL_COMMITTEE') problems.push({ key: k, code: 'NOT_COMMITTEE_LAYER' });
      else if (!committeeMayDecide(k, code)) problems.push({ key: k, code: 'NOT_ASSIGNED' });
      if (mechanismOf(def) === 'PER_EVENT') problems.push({ key: k, code: 'PER_EVENT' });
      if (def.approvalPath === 'AUTHORIZED_ROLE') problems.push({ key: k, code: 'ROLE_PATH' });
      const rec = recordOf.get(k);
      if (rec && typeof rec === 'object' && !isSeedDecisionRecord(rec as never)) problems.push({ key: k, code: 'ALREADY_DECIDED' });
      const open = await this.governance.openDecisionAgenda(k);
      if (open) problems.push({ key: k, code: 'OPEN_AGENDA', agendaId: open.id });
      defs.push(def);
    }
    if (problems.length) {
      throw new BadRequestException({ code: 'BULK_SUBMIT_INVALID', message: '올릴 수 없는 항목이 있습니다 — 아무것도 올리지 않았습니다', details: { problems } });
    }
    const committee = await this.prisma.committee.findUnique({ where: { code }, select: { id: true, name: true } });
    if (!committee) throw new BadRequestException({ code: 'BULK_COMMITTEE_MISSING', message: '위원회가 아직 만들어지지 않았습니다' });

    let meetingId: string | null = null;
    const m = input.meeting;
    if (m && 'meetingId' in m) {
      const mt = await this.prisma.committeeMeeting.findUnique({ where: { id: m.meetingId }, select: { committeeId: true, status: true, minutesSignedAt: true } });
      if (!mt || mt.committeeId !== committee.id) throw new BadRequestException({ code: 'BULK_SUBMIT_MEETING', message: '이 위원회의 회의가 아닙니다' });
      if (mt.status !== 'SCHEDULED' || mt.minutesSignedAt) throw new BadRequestException({ code: 'BULK_SUBMIT_MEETING_CLOSED', message: '예정된 회의에만 상정합니다 — 끝났거나 취소·봉인된 회의입니다' });
      meetingId = m.meetingId;
    } else if (m && 'scheduledAt' in m) {
      const at = new Date(m.scheduledAt);
      if (!m.scheduledAt || Number.isNaN(at.getTime())) throw new BadRequestException({ code: 'BULK_SUBMIT_MEETING_DATE', message: '회의 예정 일시가 올바르지 않습니다' });
      // 참석자는 넣지 않는다 — 회의 때 실제로 온 사람을 사람이 기록한다(명부로 채우지 않는다)
      const meeting = await this.gld.createMeeting({ committeeId: committee.id, title: m.title?.trim() || committee.name, scheduledAt: at.toISOString(), createdBy: userId });
      meetingId = meeting.id;
    }
    let seq = 0;
    if (meetingId) {
      const last = await this.prisma.committeeAgenda.findFirst({ where: { meetingId }, orderBy: { seq: 'desc' }, select: { seq: true } });
      seq = last?.seq ?? 0;
    }

    const results: BulkSubmitItemResult[] = [];
    for (const def of defs) {
      const r: BulkSubmitItemResult = { key: def.key, ok: false };
      try {
        const agenda = await this.governance.submitAgenda(userId, {
          committeeId: committee.id, title: def.title, body: def.why, sourceRef: { type: 'DECISION', key: def.key },
        });
        r.agendaId = agenda.id;
        r.status = 'SUBMITTED';
        if (meetingId) {
          seq += 1;
          await this.governance.updateAgenda(agenda.id, { meetingId, seq });
          r.status = 'SCHEDULED';
        }
        r.ok = true;
      } catch (e) {
        r.error = errOf(e);
        this.logger.warn(`일괄 상정 실패 ${def.key}: ${r.error.code} ${r.error.message}`);
      }
      results.push(r);
    }
    return {
      committeeCode: code, meetingId,
      total: results.length, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length,
      results,
    };
  }
}
