import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApprovalService } from '../credential-admin/approval.service';

/**
 * 법적 보존명령(legal hold) — 상용 릴리즈 T10-7 (2026-09-13).
 *
 * 🔴 왜: 소송·분쟁·수사로 기록을 보존해야 할 때 **파기·익명화·(향후) 아카이브 이동을 막는 표시**가
 *    스크라이브 세션 1곳(`scribe.service.ts` `legalHold`)에만 있었다. 진료기록 전반에는 없었다.
 *    이 장치는 **막는 방향**이라 보존 기간·저장소 결정(T10 사람 결정)과 무관하게 먼저 필요하다.
 *
 * 규칙
 *   · 🔴 **append-only** — 설정·해제 모두 새 행이다. 활성 여부는 해제 기록 유무로 **파생**한다(상태 컬럼 없음 — DB 트리거가 UPDATE/DELETE 거부).
 *   · 🔴 **설정은 1인, 해제는 4-eyes** — 막는 쪽은 빨라야 하고 푸는 쪽은 느려야 한다.
 *       요청자≠승인자(ApprovalService 엔진) + **설정자≠승인자**(여기서 추가 강제 — 건 사람이 혼자 풀지 못하게).
 *   · 🔴 **해제 사유 필수**(공백 제외 5자 이상).
 *   · 🔴 `isHeld()` 가 **조회에 실패하면 "보존 중"으로 답한다**(fail-closed) — 모르면 파기를 막는 쪽으로 접는다.
 *   · 연결(파기·아카이브·스크라이브)은 이 모듈이 하지 않는다 — 소비처가 `isHeld()` 를 부른다.
 */
export const RELEASE_REASON_MIN = 5;

type HoldRow = {
  id: string;
  patientId: string;
  scope: string;
  reason: string;
  basis: string | null;
  setBy: string;
  setAt: Date;
  release: {
    id: string;
    reason: string;
    requestedBy: string;
    approvedBy: string;
    approvalId: string;
    releasedBy: string;
    releasedAt: Date;
  } | null;
};

/** 활성 판정 정본 — 해제 기록이 없으면 활성이다(다른 어떤 필드도 보지 않는다) */
export function isActiveHold(h: Pick<HoldRow, 'release'>): boolean {
  return h.release == null;
}

@Injectable()
export class LegalHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approval: ApprovalService,
  ) {}

  /** 보존명령 설정 — 1인. 환자 존재를 확인한다(FK 가 없어서 서비스가 대신 본다). */
  async setHold(input: { patientId: string; reason: string; basis?: string | null; scope?: string | null }, setBy: string) {
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException('보존명령 사유는 필수입니다.');
    const patient = await this.prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    return this.prisma.legalHold.create({
      data: {
        patientId: input.patientId,
        reason,
        basis: input.basis?.trim() || null,
        scope: input.scope?.trim() || 'ALL',
        setBy,
      },
      include: { release: true },
    });
  }

  /** 목록 — 활성·해제 모두(이력). 활성 여부는 파생값으로 붙인다. */
  async list(filter: { patientId?: string; activeOnly?: boolean } = {}) {
    const rows = (await this.prisma.legalHold.findMany({
      where: filter.patientId ? { patientId: filter.patientId } : undefined,
      include: { release: true },
      orderBy: { setAt: 'desc' },
      take: 500,
    })) as HoldRow[];
    const withActive = rows.map((r) => ({ ...r, active: isActiveHold(r) }));
    return filter.activeOnly ? withActive.filter((r) => r.active) : withActive;
  }

  /**
   * 파기·익명화·아카이브 이동 전에 소비처가 부르는 판정.
   * 🔴 fail-closed — 조회가 실패하면 `true`(보존 중)로 답한다. 파기 경로에서 "모름"을 "없음"으로 번역하지 않는다.
   */
  /**
   * 활성 보존명령이 걸린 환자 id 전체 — 파기·(향후) 아카이브 이동이 **제외 집합**으로 쓴다.
   * 🔴 조회 실패는 빈 집합으로 접지 않는다(`.catch(() => new Set())` 는 "보존명령 없음"으로 번역하는 코드다) — 그대로 던지고
   *    호출부가 파기를 거부한다(fail-closed · `isHeld()` 와 같은 방향).
   */
  async heldPatientIds(): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.legalHold.findMany({ where: { release: { is: null } }, select: { patientId: true } });
    return new Set(rows.map((r) => r.patientId));
  }

  async isHeld(patientId: string): Promise<boolean> {
    try {
      const n = await this.prisma.legalHold.count({ where: { patientId, release: { is: null } } });
      return n > 0;
    } catch {
      return true;
    }
  }

  /** 해제 요청 — 4-eyes 승인 대기를 만든다. 사유 필수. */
  async requestRelease(holdId: string, patientId: string, requestedBy: string, reason: string) {
    const r = (reason ?? '').trim();
    // 🔴 템플릿 보간 없이 고정 문장 — 서버 조립 한국어 문장 기준선(1,792)을 늘리지 않는다(RELEASE_REASON_MIN 과 같은 값)
    if (r.length < RELEASE_REASON_MIN) throw new BadRequestException('해제 사유는 5자 이상 필수입니다.');
    const hold = await this.getHold(holdId, patientId);
    if (!isActiveHold(hold)) throw new BadRequestException('이미 해제된 보존명령입니다.');
    return this.approval.request('LEGAL_HOLD_RELEASE', 'LEGAL_HOLD', holdId, requestedBy, r, { patientId: hold.patientId });
  }

  /** 해제 승인 — 요청자≠승인자(엔진) + **설정자≠승인자**(여기). */
  async approveRelease(approvalId: string, patientId: string, approverId: string) {
    const a = await this.prisma.adminApproval.findUnique({ where: { id: approvalId } });
    if (!a || a.action !== 'LEGAL_HOLD_RELEASE') throw new NotFoundException('보존명령 해제 승인 요청이 없습니다.');
    const hold = await this.getHold(a.targetId, patientId);
    if (hold.setBy === approverId) {
      throw new ForbiddenException('보존명령을 건 사람은 해제를 승인할 수 없습니다(4-eyes).');
    }
    return this.approval.approve(approvalId, approverId);
  }

  /** 해제 실행 — 승인을 원자적으로 소비한 뒤에만 해제 행을 만든다. */
  async executeRelease(holdId: string, patientId: string, executorId: string) {
    const hold = await this.getHold(holdId, patientId);
    if (!isActiveHold(hold)) throw new BadRequestException('이미 해제된 보존명령입니다.');
    const approved = await this.approval.consume('LEGAL_HOLD_RELEASE', holdId, executorId);
    if (!approved?.approvedBy) throw new ForbiddenException('승인자가 기록되지 않은 승인은 쓸 수 없습니다.');
    const reason = (approved.reason ?? '').trim();
    if (reason.length < RELEASE_REASON_MIN) throw new BadRequestException('승인 요청에 해제 사유가 없습니다.');
    return this.prisma.legalHoldRelease.create({
      data: {
        holdId,
        reason,
        requestedBy: approved.requestedBy,
        approvedBy: approved.approvedBy,
        approvalId: approved.id,
        releasedBy: executorId,
      },
    });
  }

  /** 대기 중 해제 승인 요청(이 모듈 것만) */
  async pendingReleases() {
    const rows = await this.approval.list('PENDING');
    return rows.filter((r) => r.action === 'LEGAL_HOLD_RELEASE');
  }

  /**
   * 🔴 경로의 patientId 와 보존명령의 환자가 같아야 한다 — 감사 원장은 경로의 마지막 UUID(=환자)에 귀속되므로,
   *    다른 환자 id 를 붙여 부르면 **엉뚱한 환자의 접근 이력**에 기록이 남는다. 그 호출은 거부한다.
   */
  private async getHold(holdId: string, patientId?: string): Promise<HoldRow> {
    const h = (await this.prisma.legalHold.findUnique({ where: { id: holdId }, include: { release: true } })) as HoldRow | null;
    if (!h) throw new NotFoundException('보존명령을 찾을 수 없습니다.');
    if (patientId !== undefined && h.patientId !== patientId) {
      throw new BadRequestException('보존명령의 환자와 요청 경로의 환자가 다릅니다.');
    }
    return h;
  }
}
