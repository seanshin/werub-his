import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ACCREDITATION_JUDGMENTS, allowedAccreditationFrameworks } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { dateOnlyValue } from '../../common/day-range';

/**
 * 인증 기준·자체 평가(QI 흐름 2026-10-08).
 *  · 기준 등록은 **체계가 정해진 뒤에만**(결정 accreditation.framework) — 미설정이면 409. 🔴 기준 문구는 담당자가 원문을 보고 넣는다(시드 없음)
 *  · 평가는 덧붙이기만(이전 판단이 남는다) · 자가 평가와 확인(다른 사람)을 가른다 — 확인 전엔 "자가 평가"
 *  · 기준 ↔ 질 지표 연결(indicatorIds) — 근거 수치를 지표 원장에서 본다
 */
@Injectable()
export class AccreditationService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: ConfigRuntimeService) {}

  async frameworks() {
    let setting: unknown = null;
    try { setting = await this.config?.get('accreditation.framework'); } catch { setting = null; }
    return { setting: setting ?? null, allowed: allowedAccreditationFrameworks(setting) };
  }

  async list() {
    const [fw, standards] = await Promise.all([
      this.frameworks(),
      this.prisma.accreditationStandard.findMany({
        where: { isActive: true }, orderBy: [{ framework: 'asc' }, { code: 'asc' }],
        include: { assessments: { orderBy: { assessedAt: 'desc' }, take: 1 } },
      }),
    ]);
    return {
      ...fw,
      standards: standards.map(({ assessments, ...s }) => ({
        ...s,
        latest: assessments[0] ? { ...assessments[0], verified: !!assessments[0].verifiedAt } : null,
      })),
    };
  }

  async createStandard(dto: { framework: string; chapter: string; code: string; title: string; measurableElement?: string; indicatorIds?: string[]; sourceRef?: string }, actorId: string) {
    const fw = await this.frameworks();
    if (!fw.allowed.includes(dto.framework as never)) {
      throw new ConflictException({ code: 'ACCREDITATION_FRAMEWORK_UNSET', message: '이 인증 체계는 정해지지 않았습니다(결정 accreditation.framework)', allowed: fw.allowed });
    }
    if (dto.indicatorIds?.length) {
      const n = await this.prisma.qualityIndicator.count({ where: { id: { in: dto.indicatorIds } } });
      if (n !== new Set(dto.indicatorIds).size) throw new BadRequestException({ code: 'ACCREDITATION_INDICATOR', message: '연결할 질 지표 중 없는 것이 있습니다' });
    }
    const dup = await this.prisma.accreditationStandard.findUnique({ where: { framework_code: { framework: dto.framework, code: dto.code.trim() } } });
    if (dup) throw new ConflictException({ code: 'ACCREDITATION_STANDARD_EXISTS', message: '같은 체계·코드의 기준이 이미 있습니다', id: dup.id });
    return this.prisma.accreditationStandard.create({
      data: {
        framework: dto.framework, chapter: dto.chapter.trim(), code: dto.code.trim(), title: dto.title.trim(),
        measurableElement: dto.measurableElement?.trim() || null, indicatorIds: (dto.indicatorIds ?? undefined) as never,
        sourceRef: dto.sourceRef?.trim() || null, createdBy: actorId,
      },
    });
  }

  async history(standardId: string) {
    const s = await this.prisma.accreditationStandard.findUnique({ where: { id: standardId }, include: { assessments: { orderBy: { assessedAt: 'desc' } } } });
    if (!s) throw new NotFoundException('인증 기준을 찾을 수 없습니다');
    return s;
  }

  async assess(standardId: string, dto: { cycle: string; judgment: string; evidenceText?: string; attachments?: Array<{ name: string; url: string }>; ownerId?: string; dueDate?: string }, actorId: string) {
    const s = await this.prisma.accreditationStandard.findUnique({ where: { id: standardId }, select: { id: true } });
    if (!s) throw new NotFoundException('인증 기준을 찾을 수 없습니다');
    if (!(ACCREDITATION_JUDGMENTS as readonly string[]).includes(dto.judgment)) throw new BadRequestException({ code: 'ACCREDITATION_JUDGMENT', message: '판정이 올바르지 않습니다' });
    // 충족이 아닌 판정에는 근거(무엇이 부족한가)를 받는다 — 충족에도 근거는 권하되 강제하지 않는다
    if (dto.judgment !== 'MET' && dto.judgment !== 'NA' && !dto.evidenceText?.trim()) {
      throw new BadRequestException({ code: 'ACCREDITATION_EVIDENCE_REQUIRED', message: '부분 충족·미충족은 근거(무엇이 부족한지)를 적어야 합니다' });
    }
    const due = dto.dueDate ? dateOnlyValue(dto.dueDate) : null;
    if (dto.dueDate && !due) throw new BadRequestException({ code: 'ACCREDITATION_DUE', message: '기한을 YYYY-MM-DD 로 지정해주세요' });
    return this.prisma.accreditationAssessment.create({
      data: {
        standardId, cycle: dto.cycle.trim(), judgment: dto.judgment, evidenceText: dto.evidenceText?.trim() || null,
        attachments: (dto.attachments ?? undefined) as never, ownerId: dto.ownerId ?? null, dueDate: due, assessedBy: actorId,
      },
    });
  }

  /** 확인 — 평가한 사람이 아닌 사람만(자가 평가를 스스로 확인하지 않는다) · 한 번 */
  async verify(assessmentId: string, actorId: string) {
    const a = await this.prisma.accreditationAssessment.findUnique({ where: { id: assessmentId } });
    if (!a) throw new NotFoundException('평가를 찾을 수 없습니다');
    if (a.assessedBy === actorId) throw new ConflictException({ code: 'ACCREDITATION_SELF_VERIFY', message: '평가한 사람이 스스로 확인할 수 없습니다' });
    const r = await this.prisma.accreditationAssessment.updateMany({ where: { id: assessmentId, verifiedAt: null }, data: { verifiedAt: new Date(), verifiedBy: actorId } });
    if (!r.count) throw new ConflictException({ code: 'ACCREDITATION_VERIFIED', message: '이미 확인된 평가입니다' });
    return this.prisma.accreditationAssessment.findUnique({ where: { id: assessmentId } });
  }
}
