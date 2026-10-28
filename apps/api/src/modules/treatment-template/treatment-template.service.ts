import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { catalogEditMode, catalogRootId, catalogTransitionAllowed } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PreOrderService } from '../pre-order/pre-order.service';
import { TruncationRecorder } from '../../common/stored-truncation';

// 상태·전이 정본 = shared `catalog-lifecycle`(약속처방과 같은 표 · 2026-10-21 P2)

// 코드 해석이 필수인 항목 유형 — 미해석은 P2 전개 시 실 객체 생성 불가(유령)이므로 ACTIVE 승격 차단
const CODE_REQUIRED_TYPES = new Set(['LAB', 'IMAGING', 'PROCEDURE', 'MEDICATION_CYCLE']);
const ITEM_TYPES = new Set(['VISIT', 'LAB', 'IMAGING', 'PROCEDURE', 'MEDICATION_CYCLE', 'EDUCATION', 'NURSING', 'ASSESSMENT']);

export interface TemplateItemInput {
  dayOffset: number;
  timeOfDay?: string;
  itemType: string;
  title: string;
  refCodeId?: string;
  repeatEvery?: number;
  repeatCount?: number;
  isDefault?: boolean;
  sortOrder?: number;
  notes?: string;
}

// P2 전개 시 PreOrder 초안으로 실행 연결되는 유형 — 나머지는 계획(PLANNED) 항목으로만
const PRE_ORDER_TYPES = new Set(['LAB', 'IMAGING']);

@Injectable()
export class TreatmentTemplateService {
  private readonly logger = new Logger(TreatmentTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly preOrderService?: PreOrderService,
  ) {}

  /**
   * 🔴 (2026-09-15 U4) 항목 제목(200)·메모(300)는 운영 메모류라 잘라 저장하되 `truncatedFields` 로 응답에 알린다
   *    (종전: 조용히 잘라 저장 — 화면 입력칸에 길이 제한도 없었다).
   */
  private normalizeItems(templateId: string, items: TemplateItemInput[], totalDays: number, rec: TruncationRecorder) {
    // 🔴 (2026-09-15 P3) 제목이 비었거나 유형이 어휘(`ITEM_TYPES`) 밖인 항목은 **조용히 버렸다** — 수정은 항목 전체 교체라
    //    버려진 항목은 저장된 템플릿에서 그대로 사라졌다. 버린 항목을 원래 순번으로 응답에 싣는다(자르면 잘랐다고 말한다).
    //    잘린 칸 경로(`items[i]`)도 걸러낸 뒤 순번이라 앞 항목이 빠지면 **다른 행**을 가리켰다 — 원래 순번으로 기록한다.
    const droppedItems: { index: number; reason: 'EMPTY_TITLE' | 'INVALID_ITEM_TYPE'; itemType?: string }[] = [];
    const rows = (items ?? [])
      .map((it, index) => ({ it, index }))
      .filter(({ it, index }) => {
        if (!it?.title?.trim()) { droppedItems.push({ index, reason: 'EMPTY_TITLE' }); return false; }
        if (!ITEM_TYPES.has(it.itemType)) { droppedItems.push({ index, reason: 'INVALID_ITEM_TYPE', itemType: String(it.itemType ?? '') }); return false; }
        return true;
      })
      .map(({ it, index }, i) => ({
        templateId,
        dayOffset: Math.max(0, Math.min(totalDays, Math.round(it.dayOffset ?? 0))),
        timeOfDay: it.timeOfDay?.trim() || null,
        itemType: it.itemType,
        title: rec.clip(`items[${index}].title`, it.title.trim(), 200),
        refCodeId: it.refCodeId || null,
        repeatEvery: it.repeatEvery ? Math.max(1, Math.round(it.repeatEvery)) : null,
        repeatCount: it.repeatCount ? Math.max(1, Math.min(52, Math.round(it.repeatCount))) : null,
        isDefault: it.isDefault ?? true,
        sortOrder: it.sortOrder ?? i,
        notes: rec.clip(`items[${index}].notes`, it.notes?.trim(), 300) || null,
      }));
    return { rows, droppedItems };
  }

  async create(
    data: { name: string; department?: string; description?: string; totalDays?: number; items?: TemplateItemInput[] },
    userId?: string,
  ) {
    if (!data.name?.trim()) throw new BadRequestException('템플릿명이 필요합니다');
    const totalDays = Math.max(1, Math.min(365, data.totalDays ?? 28));
    const created = await this.prisma.treatmentScheduleTemplate.create({
      data: {
        name: data.name.trim(),
        department: data.department?.trim() || null,
        description: data.description?.trim() || null,
        totalDays,
        createdBy: userId ?? null,
        status: 'DRAFT',
      },
    });
    const rec = new TruncationRecorder();
    const { rows, droppedItems } = this.normalizeItems(created.id, data.items ?? [], totalDays, rec);
    if (rows.length) await this.prisma.treatmentTemplateItem.createMany({ data: rows });
    return { ...(await this.findById(created.id)), truncatedFields: rec.truncatedFields, droppedItems };
  }

  async findAll(filters: { status?: string; department?: string; diagnosisCode?: string }) {
    const where: Prisma.TreatmentScheduleTemplateWhereInput = { isActive: true };
    if (filters.status) where.status = filters.status;
    if (filters.department) where.department = filters.department;
    if (filters.diagnosisCode) where.diagnoses = { some: { diagnosisCode: filters.diagnosisCode } };
    return this.prisma.treatmentScheduleTemplate.findMany({
      where,
      include: { items: { orderBy: [{ dayOffset: 'asc' }, { sortOrder: 'asc' }] }, diagnoses: true },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async findById(id: string) {
    const tpl = await this.prisma.treatmentScheduleTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: [{ dayOffset: 'asc' }, { sortOrder: 'asc' }] }, diagnoses: true },
    });
    if (!tpl) throw new NotFoundException('치료일정 템플릿을 찾을 수 없습니다');
    return tpl;
  }

  /**
   * 🔴 수정(2026-10-21 P2) — 사용 중 템플릿은 새 판 초안(사용 중 판은 그대로 · 열린 초안이 있으면 409) ·
   *    승인 대기·승인됨은 초안으로 되돌리고 승인 기록을 지운다 · 정본 shared `catalog-lifecycle`
   */
  async update(
    id: string,
    data: { name?: string; department?: string; description?: string; totalDays?: number; items?: TemplateItemInput[] },
    userId?: string,
  ) {
    const tpl = await this.findById(id);
    const mode = catalogEditMode(tpl.status);
    if (mode === 'NEW_VERSION') return { ...(await this.createVersion(tpl, data, userId)), editMode: mode, newVersionOf: id };
    const totalDays = data.totalDays != null ? Math.max(1, Math.min(365, data.totalDays)) : tpl.totalDays;
    const rec = new TruncationRecorder();
    const normalized = data.items ? this.normalizeItems(id, data.items, totalDays, rec) : null;
    const droppedItems: ReturnType<TreatmentTemplateService['normalizeItems']>['droppedItems'] = normalized?.droppedItems ?? [];
    // 필드·(승인 단계면) 초안 되돌림·항목 치환을 한 트랜잭션으로 — 🔴 상태는 DB 가 대조한다(그 사이 상태가 바뀌었으면 덮어쓰지 않는다)
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.treatmentScheduleTemplate.updateMany({
        where: { id, status: tpl.status },
        data: {
          ...(data.name?.trim() ? { name: data.name.trim() } : {}),
          ...(data.department !== undefined ? { department: data.department?.trim() || null } : {}),
          ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
          totalDays,
          ...(mode === 'RESET_APPROVAL' ? { status: 'DRAFT', approvedBy: null, approvedAt: null } : {}),
        },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'CATALOG_STATUS_RACE', message: '다른 사람이 상태를 먼저 바꿨습니다 — 새로 불러온 뒤 다시 하세요' });
      if (normalized) {
        await tx.treatmentTemplateItem.deleteMany({ where: { templateId: id } });
        if (normalized.rows.length) await tx.treatmentTemplateItem.createMany({ data: normalized.rows });
      }
    });
    return { ...(await this.findById(id)), truncatedFields: rec.truncatedFields, droppedItems, editMode: mode };
  }

  /** 새 판 — 같은 계보 다음 번호 · 항목(바꾸지 않으면 그대로)·진단 연결을 옮긴다 */
  private async createVersion(
    tpl: Awaited<ReturnType<TreatmentTemplateService['findById']>>,
    data: { name?: string; department?: string; description?: string; totalDays?: number; items?: TemplateItemInput[] },
    userId?: string,
  ) {
    const root = catalogRootId(tpl);
    const lineage = await this.prisma.treatmentScheduleTemplate.findMany({ where: { OR: [{ id: root }, { parentId: root }] }, select: { id: true, version: true, status: true } });
    const open = lineage.find((l) => l.id !== tpl.id && l.status === 'DRAFT');
    if (open) throw new ConflictException({ code: 'TEMPLATE_DRAFT_EXISTS', message: '이 템플릿의 새 판 초안이 이미 있습니다 — 그 초안을 고치세요.', details: { draftId: open.id } });
    const version = Math.max(...lineage.map((l) => l.version), tpl.version) + 1;
    const totalDays = data.totalDays != null ? Math.max(1, Math.min(365, data.totalDays)) : tpl.totalDays;
    const rec = new TruncationRecorder();
    let droppedItems: ReturnType<TreatmentTemplateService['normalizeItems']>['droppedItems'] = [];
    // 새 판·항목·진단 연결을 한 트랜잭션으로(항목 없는 초안이 남지 않게)
    const created = await this.prisma.$transaction(async (tx) => {
      const c = await tx.treatmentScheduleTemplate.create({
        data: {
          name: data.name?.trim() || tpl.name,
          department: data.department !== undefined ? data.department?.trim() || null : tpl.department,
          description: data.description !== undefined ? data.description?.trim() || null : tpl.description,
          totalDays, version, parentId: root, status: 'DRAFT', createdBy: userId ?? null,
        },
      });
      if (data.items) {
        const n = this.normalizeItems(c.id, data.items, totalDays, rec);
        droppedItems = n.droppedItems;
        if (n.rows.length) await tx.treatmentTemplateItem.createMany({ data: n.rows });
      } else if (tpl.items.length) {
        await tx.treatmentTemplateItem.createMany({ data: tpl.items.map(({ id: _i, templateId: _t, ...it }) => ({ ...it, templateId: c.id })) as never });
      }
      if (tpl.diagnoses.length) {
        await tx.treatmentTemplateDiagnosis.createMany({ data: tpl.diagnoses.map(({ id: _i, templateId: _t, ...d }) => ({ ...d, templateId: c.id })) as never });
      }
      return c;
    });
    return { ...(await this.findById(created.id)), truncatedFields: rec.truncatedFields, droppedItems };
  }

  /** 승인 기록 남기기 — 승인 절차 없이 사용 중이 된 템플릿(2026-10-21 P2) */
  async recordApproval(id: string, userId: string) {
    const tpl = await this.findById(id);
    if (tpl.status !== 'ACTIVE') throw new ConflictException({ code: 'TEMPLATE_NOT_ACTIVE', message: '사용 중인 템플릿만 승인 기록을 남깁니다' });
    if (tpl.approvedBy) throw new ConflictException({ code: 'TEMPLATE_ALREADY_APPROVED', message: '이미 승인 기록이 있습니다' });
    return this.prisma.treatmentScheduleTemplate.update({ where: { id }, data: { approvedBy: userId, approvedAt: new Date() } });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.treatmentScheduleTemplate.update({ where: { id }, data: { isActive: false } });
  }

  /** 미해석 항목(코드 필수 유형인데 refCodeId 없음) — ACTIVE 승격 게이트 */
  listUnresolvedItems(items: { itemType: string; title: string; refCodeId?: string | null }[]) {
    return (items ?? []).filter((it) => CODE_REQUIRED_TYPES.has(it.itemType) && !it.refCodeId);
  }

  async changeStatus(id: string, newStatus: string, approvedBy?: string) {
    const tpl = await this.findById(id);
    if (!catalogTransitionAllowed(tpl.status, newStatus)) {
      throw new BadRequestException(`Cannot transition from ${tpl.status} to ${newStatus}`);
    }
    if (newStatus === 'ACTIVE') {
      const unresolved = this.listUnresolvedItems(tpl.items);
      if (unresolved.length) {
        throw new BadRequestException(
          `미해석 항목 ${unresolved.length}건 — 코드 지정 후 활성화할 수 있습니다: ${unresolved.map((u) => u.title).slice(0, 5).join(', ')}${unresolved.length > 5 ? ' 외' : ''}`,
        );
      }
      if (!tpl.items.length) throw new BadRequestException('항목이 없는 템플릿은 활성화할 수 없습니다');
    }
    const updateData: Prisma.TreatmentScheduleTemplateUpdateInput = { status: newStatus };
    if (newStatus === 'APPROVED' && approvedBy) {
      updateData.approvedBy = approvedBy;
      updateData.approvedAt = new Date();
    }
    // 🔴 (2026-10-21 P2) 사용 중으로 바꾼 사람이 승인 기록이 된다(이미 승인됐으면 그대로) · 초안으로 돌아가면 승인은 다시
    if (newStatus === 'ACTIVE' && !tpl.approvedBy && approvedBy) { updateData.approvedBy = approvedBy; updateData.approvedAt = new Date(); }
    if (newStatus === 'DRAFT') { updateData.approvedBy = null; updateData.approvedAt = null; }
    // 같은 계보에서 사용 중은 하나 · 🔴 상태는 DB 가 대조한다 · 한 트랜잭션
    const root = catalogRootId(tpl);
    const supersededIds = newStatus === 'ACTIVE'
      ? (await this.prisma.treatmentScheduleTemplate.findMany({ where: { OR: [{ id: root }, { parentId: root }], status: 'ACTIVE', id: { not: id } }, select: { id: true } })).map((o) => o.id)
      : [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.treatmentScheduleTemplate.updateMany({ where: { id, status: tpl.status }, data: updateData as Prisma.TreatmentScheduleTemplateUpdateManyMutationInput });
      if (r.count !== 1) throw new ConflictException({ code: 'CATALOG_STATUS_RACE', message: '다른 사람이 상태를 먼저 바꿨습니다 — 새로 불러온 뒤 다시 하세요' });
      if (supersededIds.length) await tx.treatmentScheduleTemplate.updateMany({ where: { id: { in: supersededIds }, status: 'ACTIVE' }, data: { status: 'DEPRECATED' } });
      return tx.treatmentScheduleTemplate.findUniqueOrThrow({ where: { id } });
    });
    return newStatus === 'ACTIVE' ? { ...updated, supersededIds } : updated;
  }

  // ── 진단 매핑 (OrderSetDiagnosis 패턴) ──
  async replaceDiagnoses(
    templateId: string,
    diagnoses: { diagnosisCode: string; matchType?: string; role?: string; weight?: number }[],
  ) {
    await this.findById(templateId);
    const seen = new Set<string>();
    const rows = (diagnoses ?? [])
      .filter((d) => d.diagnosisCode?.trim())
      .filter((d) => (seen.has(d.diagnosisCode.trim()) ? false : (seen.add(d.diagnosisCode.trim()), true)))
      .map((d) => ({
        templateId,
        diagnosisCode: d.diagnosisCode.trim(),
        matchType: d.matchType === 'PREFIX' ? 'PREFIX' : 'EXACT',
        role: d.role === 'PRIMARY_ONLY' ? 'PRIMARY_ONLY' : 'ANY',
        weight: Math.max(1, Math.min(1000, d.weight ?? 100)),
      }));
    await this.prisma.$transaction([
      this.prisma.treatmentTemplateDiagnosis.deleteMany({ where: { templateId } }),
      ...(rows.length ? [this.prisma.treatmentTemplateDiagnosis.createMany({ data: rows })] : []),
    ]);
    return this.prisma.treatmentTemplateDiagnosis.findMany({ where: { templateId }, orderBy: { diagnosisCode: 'asc' } });
  }

  /** 반복 항목 회차 전개 — dayOffset + k×repeatEvery (k < repeatCount), totalDays 이내 */
  expandOccurrences(item: { dayOffset: number; repeatEvery?: number | null; repeatCount?: number | null }, totalDays: number): number[] {
    if (!item.repeatEvery || !item.repeatCount || item.repeatCount <= 1) return [item.dayOffset];
    const days: number[] = [];
    for (let k = 0; k < item.repeatCount; k++) {
      const d = item.dayOffset + k * item.repeatEvery;
      if (d > totalDays) break;
      days.push(d);
    }
    return days;
  }

  /**
   * P2 전개 — ACTIVE 템플릿을 환자별 일정 인스턴스로.
   * 계획 레이어(PatientScheduleItem)와 실행(도메인 객체)을 분리 — LAB/IMAGING은 PreOrder 초안으로
   * 연결(LINKED), 나머지는 PLANNED(수동 예약/시행 유도). 자동 확정 없음 — 검토 모달에서 선택된 항목만.
   */
  async apply(
    templateId: string,
    dto: { patientId: string; encounterId?: string; anchorDate: string; selectedItemIds?: string[] },
    userId?: string,
  ) {
    const tpl = await this.findById(templateId);
    if (tpl.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 템플릿만 전개할 수 있습니다');
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true } }).catch(() => null);
    if (!patient) throw new BadRequestException('환자를 찾을 수 없습니다');
    const anchor = new Date(`${dto.anchorDate}T00:00:00+09:00`);
    if (isNaN(anchor.getTime())) throw new BadRequestException('anchorDate가 올바르지 않습니다');

    const selected = dto.selectedItemIds?.length
      ? tpl.items.filter((it) => dto.selectedItemIds!.includes(it.id))
      : tpl.items.filter((it) => it.isDefault);
    if (!selected.length) throw new BadRequestException('전개할 항목이 없습니다');

    const schedule = await this.prisma.patientTreatmentSchedule.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId ?? null,
        templateId: tpl.id,
        name: tpl.name,
        anchorDate: anchor,
        createdBy: userId ?? null,
      },
    });

    let linked = 0;
    let planned = 0;
    for (const it of selected) {
      for (const day of this.expandOccurrences(it, tpl.totalDays)) {
        const plannedAt = new Date(anchor.getTime() + day * 86400_000);
        if (it.timeOfDay) {
          const [h, m] = it.timeOfDay.split(':').map(Number);
          if (!isNaN(h)) plannedAt.setHours(h, isNaN(m) ? 0 : m, 0, 0);
        }
        // LAB/IMAGING → PreOrder 초안(승인 대기 — 발효는 기존 사전처방 게이트). 실패 시 PLANNED 폴백.
        let refId: string | null = null;
        if (PRE_ORDER_TYPES.has(it.itemType) && it.refCodeId && this.preOrderService && userId) {
          const created = await this.preOrderService
            .create({
              patientId: dto.patientId,
              doctorId: userId,
              type: it.itemType,
              procedureCodeId: it.refCodeId,
              scheduledDate: plannedAt.toISOString().slice(0, 10),
              reason: `[치료일정] ${tpl.name} D+${day}`,
            })
            .catch((e) => { this.logger.warn(`전개 PreOrder 생성 실패(PLANNED 폴백): ${e.message}`); return null; });
          refId = (created as { data?: { id?: string } } | null)?.data?.id ?? null;
        }
        await this.prisma.patientScheduleItem.create({
          data: {
            scheduleId: schedule.id,
            plannedAt,
            itemType: it.itemType,
            title: it.title,
            status: refId ? 'LINKED' : 'PLANNED',
            refType: refId ? 'PreOrder' : null,
            refId,
            notes: it.notes ?? null,
          },
        });
        if (refId) linked += 1; else planned += 1;
      }
    }

    return {
      scheduleId: schedule.id,
      name: tpl.name,
      anchorDate: dto.anchorDate,
      itemsCreated: linked + planned,
      linkedPreOrders: linked,
      plannedOnly: planned,
    };
  }

  /**
   * P3 변경관리 — 계획 항목 일자 변경(사유 필수)·취소. 연계 PreOrder(미결)는 동반 갱신/취소.
   * shiftFollowing=true면 같은 일정의 이후 항목을 동일 delta로 일괄 이동(선택식 — 자동 전파 아님).
   */
  async updateScheduleItem(
    itemId: string,
    dto: { plannedAt?: string; cancel?: boolean; reason?: string; shiftFollowing?: boolean },
  ) {
    const item = await this.prisma.patientScheduleItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('일정 항목을 찾을 수 없습니다');
    if (item.status === 'CANCELLED') throw new BadRequestException('취소된 항목입니다');

    // 🔴 (2026-09-15 U4) 변경 이력은 `이전 | [태그]: 사유` 로 뒤에 붙는다 — 종전 `.slice(0, 300)` 은 **최신 사유를** 잘랐고
    //    메모가 300자에 닿은 뒤로는 새 사유가 통째로 사라졌다. 사유는 150자에서 자르고, 이력은 뒤(최신)를 남기며
    //    잘린 사실을 `truncatedFields` 로 응답에 싣는다.
    const rec = new TruncationRecorder();
    const reason = rec.clip('reason', dto.reason?.trim() || undefined, 150);
    const stampNote = (prev: string | null, tag: string, field = 'notes') =>
      rec.clipKeepTail(field, `${prev ? `${prev} | ` : ''}${tag}${reason ? `: ${reason}` : ''}`, 300);

    // 연계 PreOrder(미결일 때만) 동반 조치
    const syncPreOrder = async (refId: string | null, refType: string | null, action: 'MOVE' | 'CANCEL', newDate?: Date) => {
      if (refType !== 'PreOrder' || !refId) return;
      const po = await this.prisma.preOrder.findUnique({ where: { id: refId }, select: { status: true } }).catch(() => null);
      if (!po || !['PENDING', 'MODIFIED'].includes(po.status)) return; // 승인 이후는 도메인 SoT — 여기서 건드리지 않음
      if (action === 'CANCEL') {
        await this.prisma.preOrder.update({ where: { id: refId }, data: { status: 'CANCELLED' } }).catch(() => undefined);
      } else if (newDate) {
        // @db.Date 컬럼은 UTC 날짜부만 저장 — KST 자정 Date를 그대로 넘기면 전일로 밀림. KST 기준 날짜로 정규화
        const kstDate = new Date(new Date(newDate.getTime() + 9 * 3600_000).toISOString().slice(0, 10));
        await this.prisma.preOrder.update({ where: { id: refId }, data: { scheduledDate: kstDate } }).catch(() => undefined);
      }
    };

    if (dto.cancel) {
      await syncPreOrder(item.refId, item.refType, 'CANCEL');
      const cancelled = await this.prisma.patientScheduleItem.update({
        where: { id: itemId },
        data: { status: 'CANCELLED', notes: stampNote(item.notes, '[취소]') },
      });
      return { ...cancelled, truncatedFields: rec.truncatedFields };
    }

    if (!dto.plannedAt) throw new BadRequestException('plannedAt 또는 cancel이 필요합니다');
    if (!dto.reason?.trim()) throw new BadRequestException('일자 변경에는 사유가 필요합니다');
    const newAt = new Date(dto.plannedAt);
    if (isNaN(newAt.getTime())) throw new BadRequestException('plannedAt이 올바르지 않습니다');
    const delta = newAt.getTime() - item.plannedAt.getTime();

    await syncPreOrder(item.refId, item.refType, 'MOVE', newAt);

    /**
     * 🔴 (2026-09-16 K1) 항목 이동과 후속 일괄이동이 건별로 따로 커밋됐다 — 중간에 실패하면
     *    **일부만 밀린 일정**이 남고, 다시 부르면 이 항목은 이미 새 날짜라 `delta === 0` 이 되어
     *    `shiftFollowing` 분기를 타지 못한다. 즉 **남은 후속 항목은 영영 이동하지 않는다.**
     *    한 번의 일괄이동은 한 사건이다 — 한 트랜잭션으로 묶는다(PreOrder 동기는 비차단이라 밖).
     */
    const following = dto.shiftFollowing && delta !== 0
      ? await this.prisma.patientScheduleItem.findMany({
        where: { scheduleId: item.scheduleId, plannedAt: { gt: item.plannedAt }, status: { not: 'CANCELLED' }, id: { not: itemId } },
      })
      : [];
    const { updated, shifted } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.patientScheduleItem.update({
        where: { id: itemId },
        data: { plannedAt: newAt, notes: stampNote(item.notes, '[변경]') },
      });
      let moved = 0;
      for (const f of following) {
        await tx.patientScheduleItem.update({
          where: { id: f.id },
          data: { plannedAt: new Date(f.plannedAt.getTime() + delta), notes: stampNote(f.notes, '[일괄이동]', `following[${f.id}].notes`) },
        });
        moved += 1;
      }
      return { updated: row, shifted: moved };
    });
    // 연계 사전처방 예정일 동기 — 일정이 커밋된 뒤 비차단으로(승인 이후 건은 도메인 SoT라 건드리지 않는다)
    for (const f of following) {
      await syncPreOrder(f.refId, f.refType, 'MOVE', new Date(f.plannedAt.getTime() + delta));
    }
    return { ...updated, shiftedFollowing: shifted, truncatedFields: rec.truncatedFields };
  }

  /** 진단 기반 추천 — 약속처방 추천 v2와 동일 규칙(주상병 가중·prefix·PRIMARY_ONLY) */
  async recommend(diagnosisCodes: string[], primaryCode?: string) {
    if (!diagnosisCodes.length) return [];
    const [exactMaps, prefixMaps] = await Promise.all([
      this.prisma.treatmentTemplateDiagnosis.findMany({
        where: { diagnosisCode: { in: diagnosisCodes }, matchType: 'EXACT', template: { isActive: true, status: 'ACTIVE' } },
        include: { template: { include: { items: { orderBy: [{ dayOffset: 'asc' }, { sortOrder: 'asc' }] } } } },
      }),
      this.prisma.treatmentTemplateDiagnosis.findMany({
        where: { matchType: 'PREFIX', template: { isActive: true, status: 'ACTIVE' } },
        include: { template: { include: { items: { orderBy: [{ dayOffset: 'asc' }, { sortOrder: 'asc' }] } } } },
      }),
    ]);
    const isPrimary = (code: string) => !!primaryCode && code === primaryCode;
    type Cand = { tpl: (typeof exactMaps)[number]['template']; score: number; matchedBy: string; matchedCode: string };
    const best = new Map<string, Cand>();
    const consider = (tpl: Cand['tpl'], code: string, exact: boolean, role: string, weight: number, source: string) => {
      if (role === 'PRIMARY_ONLY' && !isPrimary(code)) return;
      const score = weight * (isPrimary(code) ? 1.5 : 1.0) * (exact ? 1.2 : 1.0);
      const prev = best.get(tpl.id);
      if (!prev || score > prev.score) best.set(tpl.id, { tpl, score, matchedBy: source, matchedCode: code });
    };
    for (const m of exactMaps) consider(m.template, m.diagnosisCode, true, m.role, m.weight, 'EXACT');
    for (const m of prefixMaps) {
      const hit = diagnosisCodes.find((c) => c.startsWith(m.diagnosisCode));
      if (hit) consider(m.template, hit, false, m.role, m.weight, 'PREFIX');
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => ({ ...c.tpl, matchScore: Math.round(c.score), matchedBy: c.matchedBy, matchedCode: c.matchedCode }));
  }
}
