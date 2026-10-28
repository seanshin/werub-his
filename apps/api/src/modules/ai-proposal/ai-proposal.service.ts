import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { AiProposalStatus, AiProposalSource, Prisma } from '@prisma/client';
import {
  AI_PROPOSAL_TRANSITION_REASONS,
  AI_PROPOSAL_ZERO_UUID,
  canTransitionAiProposal,
  isAiProposalKind,
  type AiProposalDecision,
  type AiProposalKind,
  type AiProposalStatusValue,
  type AiProposalSourceValue,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { encryptField, decryptField, isEncrypted } from '../../common/crypto/field-encryption';
import { levenshteinCapped, isEditDistanceCapped } from '../../common/util/edit-distance';

/**
 * AI 제안(review-pending) 코어 — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` §2.1.
 *
 * 🔴 **이 서비스는 정본을 쓰지 않는다.** 정본(진료기록·간호기록·퇴원요약 …) 반영은 각 도메인 정본
 *    서비스가 하고, 여기는 "AI 가 무엇을 냈고 사람이 그것을 어떻게 했는가"만 남긴다.
 *    그래서 `decide()` 는 최종 본문을 **저장하지 않는다** — 편집거리(수정량)만 잰다.
 *    최종 본문이 두 곳에 있으면 같은 사실에 정본이 둘이 된다(P12).
 *
 * 🔴 **제안은 불변이다.** 본문(`contentEnc`/`contentHash`)을 update 하는 경로가 없다.
 *    수정은 `supersede()` — 옛 것을 SUPERSEDED 로 닫고 version+1 의 **새 행**을 만든다
 *    (선례: `CheckupExplainerContent`). 가드: `test/architecture/ai-proposal-immutability.spec.ts`.
 *
 * 🔴 **지어내지 않는다.**
 *    · `confidence` 는 모델이 자기보고한 값만. 안 주면 null(0.7 같은 기본값 금지 — R7).
 *    · `modelRef` 는 상류가 돌려준 태그만. 요청 태그로 대신 채우지 않는다.
 *    · 노출 기록 없이 결정된 건은 막지 않되 전이 사유에 `NOT_PRESENTED` 를 남긴다 —
 *      감독 지표가 그것을 "0초 만에 검토한 건"으로 읽으면 안 된다.
 */
@Injectable()
export class AiProposalService {
  private readonly logger = new Logger(AiProposalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ═══════════════════ 생성 ═══════════════════ */

  /**
   * 제안 1건 생성 — 본문 암호화 + sha256 + `GENERATED` 전이 1행을 **같은 트랜잭션**으로.
   *
   * 🔴 전이 행이 없으면 이 제안은 원장에서 시작점을 잃는다. 그래서 분리하지 않는다.
   * @param input.content 초안 평문. 저장은 암호문(`contentEnc`)이고 해시는 **평문 기준**이다
   *   (암호문은 IV 때문에 매번 달라 동일성 비교에 쓸 수 없다).
   */
  async create(input: CreateAiProposalInput) {
    if (!isAiProposalKind(input.kind)) {
      throw new BadRequestException({
        code: 'AI_PROPOSAL_UNKNOWN_KIND',
        message: `알 수 없는 제안 종류: ${String(input.kind)} (정본: shared AI_PROPOSAL_KINDS)`,
      });
    }
    const targetId = input.targetId ?? AI_PROPOSAL_ZERO_UUID;
    if (targetId === AI_PROPOSAL_ZERO_UUID && !input.targetKey) {
      // 🔴 ZERO_UUID 는 "UUID 정본이 아니다"라는 뜻이지 "대상이 없다"가 아니다.
      //    무엇을 가리키는지 아무 데도 없으면 이 제안은 나중에 대상을 재구성할 수 없다.
      throw new BadRequestException({
        code: 'AI_PROPOSAL_TARGET_UNIDENTIFIED',
        message: 'targetId 가 UUID 가 아니면 targetKey 로 대상을 밝혀야 합니다(대상을 추정하지 않습니다).',
      });
    }

    const content = input.content ?? '';
    const contentHash = sha256(content);
    const contentEnc = content === '' ? null : (encryptField(content) as string);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const proposal = await tx.aiProposal.create({
        data: {
          kind: input.kind,
          targetType: input.targetType,
          targetId,
          targetKey: input.targetKey ?? null,
          patientId: input.patientId ?? null,
          modelRef: input.modelRef ?? null,
          modelReleaseId: input.modelReleaseId ?? null,
          promptVersion: input.promptVersion ?? null,
          inputSnapshotHash: input.inputSnapshotHash ?? null,
          contentHash,
          contentEnc,
          // 🔴 모델이 안 준 신뢰도는 null 이다 — 여기서 기본값을 만들지 않는다
          confidence: input.confidence == null ? null : new Prisma.Decimal(input.confidence),
          source: input.source as AiProposalSource,
          reasonCode: input.reasonCode ?? null,
          status: AiProposalStatus.GENERATED,
          version: input.version ?? 1,
          supersedesId: input.supersedesId ?? null,
          createdBy: input.createdBy ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });

      await tx.aiProposalTransition.create({
        data: {
          proposalId: proposal.id,
          fromStatus: null, // 최초 생성 — 이전 상태가 없다
          toStatus: AiProposalStatus.GENERATED,
          actorId: input.createdBy ?? null,
          reason: input.createReason ?? null,
          clientContext: input.clientContext ?? null,
        },
      });

      return proposal;
    });
  }

  /* ═══════════════════ 노출 보고 ═══════════════════ */

  /**
   * 화면이 실제로 렌더한 시점에 1회 보고 — `GENERATED → PRESENTED`.
   *
   * 🔴 **멱등**이다. 이미 PRESENTED 이거나 그 뒤 상태면 아무것도 바꾸지 않고 `changed:false` 로
   *    **그 사실을 말한다**(조용히 성공한 척하지도, 에러로 막지도 않는다 — 화면 리렌더는 정상이다).
   * 원자성: `updateMany(where status=GENERATED)` 의 count 로 판정한다(read→check→write 는 경합에서 깨진다).
   */
  async markPresented(id: string, actorId?: string | null, clientContext?: string | null): Promise<MarkPresentedResult> {
    const before = await this.prisma.aiProposal.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'AI_PROPOSAL_NOT_FOUND', message: '제안을 찾을 수 없습니다.' });

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { count } = await tx.aiProposal.updateMany({
        where: { id, status: AiProposalStatus.GENERATED },
        data: { status: AiProposalStatus.PRESENTED, presentedAt: new Date() },
      });
      if (count === 0) return null;
      await tx.aiProposalTransition.create({
        data: {
          proposalId: id,
          fromStatus: AiProposalStatus.GENERATED,
          toStatus: AiProposalStatus.PRESENTED,
          actorId: actorId ?? null,
          clientContext: clientContext ?? null,
        },
      });
      return tx.aiProposal.findUnique({ where: { id } });
    });

    if (!result) {
      return {
        changed: false,
        status: before.status as AiProposalStatusValue,
        presentedAt: before.presentedAt,
        note: `이미 ${before.status} 상태라 노출 시점을 다시 쓰지 않았습니다(최초 노출 시점을 덮지 않습니다).`,
      };
    }
    return { changed: true, status: result.status as AiProposalStatusValue, presentedAt: result.presentedAt };
  }

  /* ═══════════════════ 사람 결정 ═══════════════════ */

  /**
   * 사람 결정 기록 — `ACCEPTED` | `EDITED` | `REJECTED`.
   *
   * 🔴 최종 본문은 저장하지 않는다. `finalText` 는 **편집거리를 재기 위해서만** 쓰이고 버려진다.
   * 🔴 `finalText` 가 없으면 편집거리는 `null` 이다 — **0 이 아니다**("안 고쳤다"와 "안 쟀다"는 다른 사실).
   * 🔴 편집거리는 캡(1500자) 때문에 **하한**일 수 있다 — `editDistanceCapped` 로 함께 낸다.
   * 🔴 `ACCEPTED` 인데 편집거리가 0 이 아닐 수 있다(호출자가 그렇게 보고한 경우). 값을 고쳐 쓰지 않고
   *    그대로 남긴다 — 감독 지표는 `ACCEPTED` 를 곧 "무수정"으로 읽으면 안 된다.
   * 🔴 노출 기록 없이(GENERATED) 결정하는 것을 **막지 않는다**. 대신 전이 사유에 `NOT_PRESENTED`.
   */
  async decide(id: string, input: DecideAiProposalInput): Promise<DecideAiProposalResult> {
    const before = await this.prisma.aiProposal.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'AI_PROPOSAL_NOT_FOUND', message: '제안을 찾을 수 없습니다.' });

    const to = input.decision as AiProposalStatusValue;
    const from = before.status as AiProposalStatusValue;
    if (!canTransitionAiProposal(from, to)) {
      throw new ConflictException({
        code: 'AI_PROPOSAL_INVALID_TRANSITION',
        message: `${from} → ${to} 전이는 허용되지 않습니다(이미 결정된 제안은 다시 결정하지 않습니다).`,
        details: { from, to },
      });
    }

    const notPresented = from === AiProposalStatus.GENERATED;

    // 편집거리 — 정본 `levenshteinCapped`. 원문 복호에 실패하면 재지 않는다(0 으로 채우지 않는다).
    let editDistance: number | null = null;
    let editDistanceCapped = false;
    let editDistanceNote: string | undefined;
    if ((to === 'ACCEPTED' || to === 'EDITED') && typeof input.finalText === 'string') {
      const original = this.plainContent(before.contentEnc);
      if (original.content === null) {
        editDistanceNote = `초안 원문을 읽을 수 없어 수정량을 재지 않았습니다(${original.reason}).`;
      } else {
        editDistance = levenshteinCapped(original.content, input.finalText);
        editDistanceCapped = isEditDistanceCapped(original.content, input.finalText);
      }
    } else if (to === 'ACCEPTED' || to === 'EDITED') {
      editDistanceNote = '최종본이 전달되지 않아 수정량을 재지 않았습니다(미측정 — 0 이 아닙니다).';
    }

    const reason = [notPresented ? AI_PROPOSAL_TRANSITION_REASONS.NOT_PRESENTED : null, input.reason ?? null]
      .filter(Boolean)
      .join(' · ') || null;

    const updated = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { count } = await tx.aiProposal.updateMany({
        // 🔴 읽은 시점의 상태에서만 바꾼다 — 그 사이 다른 결정이 들어왔으면 count=0 이 되어 막힌다
        where: { id, status: before.status },
        data: {
          status: to as AiProposalStatus,
          decidedAt: new Date(),
          decidedBy: input.actorId ?? null,
          rejectReason: to === 'REJECTED' ? (input.reason ?? null) : null,
          editDistance,
        },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'AI_PROPOSAL_CONCURRENT_DECISION',
          message: '다른 결정이 먼저 기록되어 이 결정을 반영하지 않았습니다. 다시 조회하세요.',
        });
      }
      await tx.aiProposalTransition.create({
        data: {
          proposalId: id,
          fromStatus: before.status,
          toStatus: to as AiProposalStatus,
          actorId: input.actorId ?? null,
          reason: reason ? reason.slice(0, 200) : null,
          editDistance,
          clientContext: input.clientContext ?? null,
        },
      });
      return tx.aiProposal.findUnique({ where: { id } });
    });

    return {
      proposal: updated!,
      editDistance,
      editDistanceCapped,
      notPresented,
      note: editDistanceNote,
    };
  }

  /* ═══════════════════ 대체(새 버전) ═══════════════════ */

  /**
   * 제안 수정 = **새 버전**. 옛 행은 `SUPERSEDED` 로 닫고 `version+1`·`supersedesId` 로 새 행을 만든다.
   * 🔴 옛 제안의 본문은 그대로 남는다 — 그것이 "그때 AI 가 뭐라고 했는지"의 유일한 증거다.
   */
  async supersede(id: string, next: CreateAiProposalInput, actorId?: string | null) {
    const old = await this.prisma.aiProposal.findUnique({ where: { id } });
    if (!old) throw new NotFoundException({ code: 'AI_PROPOSAL_NOT_FOUND', message: '제안을 찾을 수 없습니다.' });
    if (old.status === AiProposalStatus.SUPERSEDED) {
      throw new ConflictException({
        code: 'AI_PROPOSAL_ALREADY_SUPERSEDED',
        message: '이미 대체된 제안입니다(대체 사슬은 최신 행에서 이어갑니다).',
      });
    }

    const created = await this.create({
      ...next,
      version: old.version + 1,
      supersedesId: old.id,
      createdBy: next.createdBy ?? actorId ?? null,
      createReason: AI_PROPOSAL_TRANSITION_REASONS.SUPERSEDED_BY_NEW_VERSION,
    });

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { count } = await tx.aiProposal.updateMany({
        where: { id, status: old.status },
        data: { status: AiProposalStatus.SUPERSEDED },
      });
      if (count === 0) return;
      await tx.aiProposalTransition.create({
        data: {
          proposalId: id,
          fromStatus: old.status,
          toStatus: AiProposalStatus.SUPERSEDED,
          actorId: actorId ?? null,
          reason: AI_PROPOSAL_TRANSITION_REASONS.SUPERSEDED_BY_NEW_VERSION,
        },
      });
    });

    return created;
  }

  /* ═══════════════════ 만료 ═══════════════════ */

  /**
   * 만료 스윕 — `expiresAt` 이 지난 **GENERATED/PRESENTED** 만 `EXPIRED`.
   *
   * 🔴 결정된 제안(ACCEPTED/EDITED/REJECTED)은 건드리지 않는다. 만료는 거부가 아니다 —
   *    섞으면 거부율이 부풀려지고, 그 숫자로 모델을 판단하게 된다.
   * 🔴 크론 시각은 pm2 `TZ=Asia/Seoul` 기준 03:30 KST 다(OS crontab 은 UTC — 다른 체계).
   */
  @Cron('30 3 * * *', { name: 'ai-proposal-expire' })
  async expireDue(now: Date = new Date()): Promise<{ scanned: number; expired: number }> {
    const due = await this.prisma.aiProposal.findMany({
      where: {
        expiresAt: { not: null, lte: now },
        status: { in: [AiProposalStatus.GENERATED, AiProposalStatus.PRESENTED] },
      },
      select: { id: true, status: true },
      take: 1000,
    });
    let expired = 0;
    for (const row of due) {
      const done = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const { count } = await tx.aiProposal.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: AiProposalStatus.EXPIRED },
        });
        if (count === 0) return false; // 그 사이 사람이 결정했다 — 덮지 않는다
        await tx.aiProposalTransition.create({
          data: {
            proposalId: row.id,
            fromStatus: row.status,
            toStatus: AiProposalStatus.EXPIRED,
            actorId: null, // 시스템 전이 — 사람을 지어내지 않는다
            reason: AI_PROPOSAL_TRANSITION_REASONS.EXPIRED_DUE,
          },
        });
        return true;
      });
      if (done) expired++;
    }
    if (expired > 0) this.logger.log(`AI 제안 만료 ${expired}/${due.length}건`);
    return { scanned: due.length, expired };
  }

  /* ═══════════════════ 조회 ═══════════════════ */

  /**
   * 환자별 제안 목록 — 🔴 **본문을 담지 않는다**(복호는 `get()` 에서만).
   * 목록은 "무엇이 언제 나왔고 어떻게 됐는가"까지다.
   */
  async listByPatient(patientId: string, opts: ListByPatientOptions = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await this.prisma.aiProposal.findMany({
      where: {
        patientId,
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.status ? { status: opts.status as AiProposalStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: LIST_SELECT,
    });
    return {
      items: rows,
      // 🔴 잘랐으면 잘랐다고 말한다
      truncated: rows.length === limit,
      limit,
    };
  }

  /**
   * 정본 대상별 제안 목록 — 🔴 **본문을 담지 않는다**(복호는 `get()` 에서만). 최신순.
   *
   * 🔴 왜 여기 있어야 하나: 도메인 서비스가 "이 정본에 달린 제안"을 각자 `prisma.aiProposal.findFirst`
   *    로 찾으면 **같은 사실(정본↔제안 연결)에 정본이 여럿**이 된다(P12). 조회 조건이 한 곳에서만
   *    갈라져도 어떤 화면은 제안을 보고 어떤 화면은 못 본다. 그래서 대상 조회는 이 메서드 하나다.
   *
   * 🔴 **여러 건일 수 있다는 사실을 감추지 않는다.** "가장 최근 제안"이 필요하면 `items[0]` 을 쓰되,
   *    `truncated` 와 목록 길이가 그 대상에 제안이 여럿이라는 사실을 그대로 말한다
   *    (`findFirst` 하나만 두면 두 번째 제안이 존재해도 화면·원장이 그것을 모른다).
   *
   * @param status 좁힐 상태. 배열이면 그 중 하나(미결 제안 = `['GENERATED','PRESENTED']`).
   *   🔴 주지 않으면 **전 상태**다 — 종결된 제안까지 보인다(빈 목록과 "미결 없음"은 다른 사실이다).
   */
  async findByTarget(targetType: string, targetId: string, opts: FindByTargetOptions = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const { status } = opts;
    // 🔴 하나든 여럿이든 같은 모양(`in`)으로 만든다 — 분기를 남기면 한쪽만 고쳐져 갈라진다
    const statuses =
      status == null ? null : ((typeof status === 'string' ? [status] : [...status]) as AiProposalStatus[]);
    const rows = await this.prisma.aiProposal.findMany({
      where: {
        targetType,
        targetId,
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: LIST_SELECT,
    });
    return {
      items: rows,
      // 🔴 잘랐으면 잘랐다고 말한다
      truncated: rows.length === limit,
      limit,
    };
  }

  /**
   * 제안 1건 — 본문 복호는 **여기서만**.
   *
   * 🔴 복호 실패를 본문 없음으로 번역하지 않는다. 3상태로 말한다:
   *    본문 있음 / 본문 없음(애초에 저장 안 됨) / 읽을 수 없음(키 회전·손상).
   * 🔴 `contentIntegrity` 는 저장된 해시와 복호 결과의 대조다 — `UNVERIFIABLE` 은 위반이 아니라 미판정이다.
   */
  async get(id: string): Promise<AiProposalDetail> {
    const row = await this.prisma.aiProposal.findUnique({
      where: { id },
      include: { transitions: { orderBy: { at: 'asc' } } },
    });
    if (!row) throw new NotFoundException({ code: 'AI_PROPOSAL_NOT_FOUND', message: '제안을 찾을 수 없습니다.' });

    const plain = this.plainContent(row.contentEnc);
    const contentIntegrity: ContentIntegrity =
      plain.content === null ? 'UNVERIFIABLE' : sha256(plain.content) === row.contentHash ? 'OK' : 'MISMATCH';

    const { contentEnc: _omit, ...rest } = row;
    return {
      ...rest,
      // 🔴 `patientId` 를 **최상위에 명시**한다. 감사 인터셉터(`resolveAiPatient`)가 응답의
      //    `data.patientId` 로 열람을 환자에 귀속시키기 때문이다 — 스프레드 안에 묻혀 있으면
      //    가드(`test/audit/ai-read-audit.spec.ts`)도 사람도 그 사실을 확인할 수 없다.
      patientId: row.patientId,
      content: plain.content,
      contentUnavailableReason: plain.reason,
      contentIntegrity,
    };
  }

  /**
   * 승인 시점에 입력이 달라졌는가 — **막지 않는다**(사람이 재확인하도록 알리기만).
   *
   * 🔴 세 상태다: `CHANGED` / `UNCHANGED` / `UNKNOWN`(제안에 스냅샷 해시가 없거나 현재 해시를 모름).
   *    `UNKNOWN` 을 `UNCHANGED` 로 접으면 "입력이 그대로였다"는 거짓말이 된다.
   */
  async inputChangeState(id: string, currentSnapshotHash?: string | null): Promise<InputChangeState> {
    const row = await this.prisma.aiProposal.findUnique({
      where: { id },
      select: { inputSnapshotHash: true },
    });
    if (!row) throw new NotFoundException({ code: 'AI_PROPOSAL_NOT_FOUND', message: '제안을 찾을 수 없습니다.' });
    if (!row.inputSnapshotHash) {
      return { state: 'UNKNOWN', reason: '제안에 입력 스냅샷 해시가 없습니다(생성 당시 기록되지 않음).' };
    }
    if (!currentSnapshotHash) {
      return { state: 'UNKNOWN', reason: '현재 입력 스냅샷 해시가 전달되지 않았습니다.' };
    }
    return { state: row.inputSnapshotHash === currentSnapshotHash ? 'UNCHANGED' : 'CHANGED' };
  }

  /**
   * `inputChangeState` 의 얇은 래퍼(승인 화면 경고 표시용 boolean).
   *
   * 🔴 **`UNKNOWN` 은 true 로 접는다** — 모르면 안전측(사람이 한 번 더 보는 쪽)이다.
   *    그래서 이 값이 true 라는 것은 "바뀌었다"가 아니라 **"그대로임을 확인하지 못했다"** 는 뜻이다.
   *    화면 문구를 그렇게 쓰려면 boolean 이 아니라 `inputChangeState()` 를 직접 써야 한다.
   */
  async inputChanged(id: string, currentSnapshotHash?: string | null): Promise<boolean> {
    const { state } = await this.inputChangeState(id, currentSnapshotHash);
    return state !== 'UNCHANGED';
  }

  /* ═══════════════════ 내부 ═══════════════════ */

  /**
   * 저장된 암호문 → 평문. 🔴 `decryptField` 는 복호 실패 시 **원본(암호문)을 그대로 돌려준다**
   * (키 회전 중 손상 방지). 그 값을 본문인 척 내보내면 화면에 hex 덩어리가 초안으로 뜬다 —
   * 그래서 여기서 "아직 암호문 모양인가"를 다시 보고 실패로 판정한다.
   */
  private plainContent(contentEnc: string | null): { content: string | null; reason?: ContentUnavailableReason } {
    if (contentEnc == null || contentEnc === '') return { content: null, reason: 'NOT_STORED' };
    const out = decryptField(contentEnc);
    if (typeof out !== 'string') return { content: null, reason: 'DECRYPT_FAILED' };
    if (isEncrypted(out)) return { content: null, reason: 'DECRYPT_FAILED' };
    return { content: out };
  }
}

/** 본문 sha256 — 평문 기준(암호문은 IV 때문에 매번 달라 비교에 못 쓴다) */
function sha256(v: string): string {
  return createHash('sha256').update(v, 'utf8').digest('hex');
}

const LIST_SELECT = {
  id: true,
  kind: true,
  targetType: true,
  targetId: true,
  targetKey: true,
  patientId: true,
  modelRef: true,
  modelReleaseId: true,
  promptVersion: true,
  inputSnapshotHash: true,
  contentHash: true,
  confidence: true,
  source: true,
  reasonCode: true,
  status: true,
  version: true,
  supersedesId: true,
  createdBy: true,
  createdAt: true,
  presentedAt: true,
  decidedAt: true,
  decidedBy: true,
  rejectReason: true,
  editDistance: true,
  expiresAt: true,
} as const;

/* ═══════════════════ 계약(다음 갈래가 그대로 쓰는 모양) ═══════════════════ */

export interface CreateAiProposalInput {
  kind: AiProposalKind;
  /** 정본 리소스 종류(Encounter·NursingNote·MdtCase …) */
  targetType: string;
  /** 정본 행 id(UUID). UUID 가 아니면 생략하고 `targetKey` 를 준다 */
  targetId?: string | null;
  /** UUID 가 아닌 정본 키. `targetId` 가 없으면 **필수**(대상을 추정하지 않는다) */
  targetKey?: string | null;
  patientId?: string | null;
  /** 초안 평문. 저장은 암호문, 해시는 평문 기준 */
  content: string;
  /** 🔴 상류가 돌려준 모델 태그만(요청 태그로 대신 채우지 않는다) */
  modelRef?: string | null;
  modelReleaseId?: string | null;
  promptVersion?: string | null;
  inputSnapshotHash?: string | null;
  /** 🔴 모델 자기보고 값만. 없으면 생략(0.7 같은 기본값 금지) */
  confidence?: number | null;
  source: AiProposalSourceValue;
  reasonCode?: string | null;
  createdBy?: string | null;
  expiresAt?: Date | null;
  /** supersede 내부에서만 채운다(호출자는 주지 않는다) */
  version?: number;
  supersedesId?: string | null;
  /** 생성 전이 행에 남길 사유(선택) */
  createReason?: string | null;
  clientContext?: string | null;
}

export interface DecideAiProposalInput {
  decision: AiProposalDecision;
  actorId?: string | null;
  /** 편집거리 측정용 최종본 — **저장하지 않는다** */
  finalText?: string;
  reason?: string;
  clientContext?: string | null;
}

export interface DecideAiProposalResult {
  proposal: { id: string; status: AiProposalStatus };
  /** null = 재지 않았다(0 이 아니다) */
  editDistance: number | null;
  /** true 면 editDistance 는 하한이다(캡 1500자) */
  editDistanceCapped: boolean;
  /** 노출 기록 없이 결정됐다 — 검토시간 지표가 이 건을 "0초 검토"로 세면 안 된다 */
  notPresented: boolean;
  note?: string;
}

export interface MarkPresentedResult {
  changed: boolean;
  status: AiProposalStatusValue;
  presentedAt: Date | null;
  /** changed=false 인 이유 */
  note?: string;
}

export interface ListByPatientOptions {
  kind?: string;
  status?: string;
  limit?: number;
}

export interface FindByTargetOptions {
  /** 하나 또는 여럿. 생략하면 **전 상태**(미결만 보고 싶으면 명시한다) */
  status?: AiProposalStatusValue | readonly AiProposalStatusValue[];
  limit?: number;
}

export type ContentUnavailableReason = 'NOT_STORED' | 'DECRYPT_FAILED';
export type ContentIntegrity = 'OK' | 'MISMATCH' | 'UNVERIFIABLE';

export interface AiProposalDetail {
  id: string;
  patientId: string | null;
  status: AiProposalStatus;
  /** null 이면 `contentUnavailableReason` 이 왜인지 말한다 */
  content: string | null;
  contentUnavailableReason?: ContentUnavailableReason;
  contentIntegrity: ContentIntegrity;
  [k: string]: unknown;
}

export interface InputChangeState {
  state: 'CHANGED' | 'UNCHANGED' | 'UNKNOWN';
  reason?: string;
}
