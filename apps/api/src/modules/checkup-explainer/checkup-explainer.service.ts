import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpsertExplainerDto, ReviewExplainerDto } from './dto/checkup-explainer.dto';
import { validateContentText } from './guardrail';

interface Actor { id: string; familyName?: string; givenName?: string }

/** 본문 해시 — 감수 대상 텍스트 스냅샷(변경 감지·4-eyes 집계 기준) */
function contentHashOf(c: { plainWhat?: string | null; plainMeaning?: string | null; lifestyleInfo?: string | null; whenToSeeDoctor?: string | null; sourceRef?: string | null }): string {
  const s = JSON.stringify([c.plainWhat ?? '', c.plainMeaning ?? '', c.lifestyleInfo ?? '', c.whenToSeeDoctor ?? '', c.sourceRef ?? '']);
  return createHash('sha256').update(s).digest('hex').slice(0, 64);
}

/**
 * 검진결과 해석 감수 콘텐츠 서비스 (개발-독립 인프라).
 * 저작→감수→승인 워크플로 + 저장 시 가드레일 정적 검증(금칙 포함 콘텐츠 제출 차단).
 * 소비자 노출 EP는 규제 게이트 후 별도(현재는 APPROVED 조회만 내부 제공).
 */
@Injectable()
export class CheckupExplainerService {
  constructor(private readonly prisma: PrismaService) {}

  /** 저작/수정 — 승인본 수정 시 status DRAFT로 되돌리고 version++ (재감수 필요) */
  async upsert(dto: UpsertExplainerDto, user: Actor) {
    // 가드레일 정적 검증 — 금칙(진단확정·처방지시 등) 포함 콘텐츠는 저장 거부
    const fields = { plainWhat: dto.plainWhat, plainMeaning: dto.plainMeaning, lifestyleInfo: dto.lifestyleInfo, whenToSeeDoctor: dto.whenToSeeDoctor };
    const hits = Object.entries(fields).flatMap(([f, v]) => validateContentText(v).map((h) => ({ field: f, ...h })));
    if (hits.length) {
      throw new BadRequestException({ code: 'GUARDRAIL_BLOCKED', message: '금칙 표현(진단 확정·처방/용량 지시 등)이 포함되어 저장할 수 없습니다.', details: hits });
    }

    const existing = await this.prisma.checkupExplainerContent.findUnique({ where: { testCode: dto.testCode } });
    const data = {
      testName: dto.testName,
      plainWhat: dto.plainWhat ?? null,
      plainMeaning: dto.plainMeaning ?? null,
      lifestyleInfo: dto.lifestyleInfo ?? null,
      whenToSeeDoctor: dto.whenToSeeDoctor ?? null,
      sourceRef: dto.sourceRef ?? null,
    };
    if (existing) {
      const resetReview = existing.status === 'APPROVED';
      return this.prisma.checkupExplainerContent.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(resetReview
            ? { status: 'DRAFT', version: existing.version + 1, reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewNote: null }
            : {}),
        },
      });
    }
    return this.prisma.checkupExplainerContent.create({
      data: { ...data, testCode: dto.testCode, status: 'DRAFT', createdBy: user.id },
    });
  }

  /** 감수 제출(DRAFT → IN_REVIEW) */
  async submit(id: string) {
    const c = await this.prisma.checkupExplainerContent.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('콘텐츠 없음');
    if (c.status !== 'DRAFT' && c.status !== 'REJECTED') throw new BadRequestException('DRAFT/반려 상태만 제출 가능');
    return this.prisma.checkupExplainerContent.update({ where: { id }, data: { status: 'IN_REVIEW' } });
  }

  /** 4-eyes 설정 — SystemConfig 'checkup.explainerFourEyes'(기본 off·무중단) */
  private async fourEyesEnabled(): Promise<boolean> {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key: 'checkup.explainerFourEyes' } });
    return cfg?.value === true || (cfg?.value as { enabled?: boolean } | null)?.enabled === true;
  }

  /**
   * 감수 결정(승인/반려) — append-only 로그 기록 + 4-eyes(2인 승인) 판정.
   * 승인 시 현재 본문 해시 저장(변경 시 재감수). 4-eyes 활성 시 서로 다른 승인자 2인 필요.
   */
  async review(id: string, dto: ReviewExplainerDto, user: Actor) {
    const c = await this.prisma.checkupExplainerContent.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('콘텐츠 없음');
    if (c.status !== 'IN_REVIEW') throw new BadRequestException('IN_REVIEW 상태만 감수 가능');
    const name = `${user.familyName ?? ''}${user.givenName ?? ''}`.trim() || '미상';
    const hash = contentHashOf(c);

    await this.prisma.checkupExplainerReview.create({
      data: { contentId: id, testCode: c.testCode, decision: dto.decision, contentHash: hash, note: dto.reviewNote ?? null, reviewedBy: user.id, reviewedByName: name },
    });

    if (dto.decision === 'REJECTED') {
      return this.prisma.checkupExplainerContent.update({
        where: { id },
        data: { status: 'REJECTED', reviewedBy: user.id, reviewedByName: name, reviewedAt: new Date(), reviewNote: dto.reviewNote ?? null, contentHash: hash },
      });
    }

    // 승인 — 마지막 반려 이후 & 현재 해시와 일치하는 distinct 승인자 집계
    const fourEyes = await this.fourEyesEnabled();
    const logs = await this.prisma.checkupExplainerReview.findMany({ where: { contentId: id }, orderBy: { createdAt: 'desc' }, take: 500 });
    const approvers = new Set<string>();
    for (const r of logs) {
      if (r.decision === 'REJECTED') break;
      if (r.contentHash === hash) approvers.add(r.reviewedBy);
    }
    const approved = !fourEyes || approvers.size >= 2;

    return this.prisma.checkupExplainerContent.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'IN_REVIEW', // 2차 대기면 IN_REVIEW 유지
        reviewedBy: user.id, reviewedByName: name, reviewedAt: new Date(), reviewNote: dto.reviewNote ?? null, contentHash: hash,
      },
    });
  }

  async findAll(status?: string) {
    const [items, fourEyes] = await Promise.all([
      this.prisma.checkupExplainerContent.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 500 }),
      this.fourEyesEnabled(),
    ]);
    // 4-eyes 승인자 집계(현재 해시·마지막 반려 이후) 부착
    const ids = items.map((i) => i.id);
    const logs = ids.length
      ? await this.prisma.checkupExplainerReview.findMany({ where: { contentId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 5000 })
      : [];
    const byContent = new Map<string, typeof logs>();
    for (const r of logs) { if (!byContent.has(r.contentId)) byContent.set(r.contentId, []); byContent.get(r.contentId)!.push(r); }
    const withMeta = items.map((it) => {
      const hash = contentHashOf(it);
      const approvers = new Set<string>();
      for (const r of byContent.get(it.id) ?? []) { if (r.decision === 'REJECTED') break; if (r.contentHash === hash) approvers.add(r.reviewedBy); }
      return { ...it, approverCount: approvers.size, pending2nd: fourEyes && it.status === 'IN_REVIEW' && approvers.size === 1 };
    });
    return { fourEyes, items: withMeta };
  }

  async findByCode(testCode: string) {
    return this.prisma.checkupExplainerContent.findUnique({ where: { testCode } });
  }

  /** 승인본만 — 소비자 노출용(규제 게이트 후 포털 연결 시 사용) */
  async findApproved(testCode: string) {
    return this.prisma.checkupExplainerContent.findFirst({ where: { testCode, status: 'APPROVED' } });
  }
}
