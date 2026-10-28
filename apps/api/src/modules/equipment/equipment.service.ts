import { Injectable, Logger, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { EquipmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { computeDepreciation, usefulLifeOf } from './equipment-depreciation';
import {
  CreateEquipmentDto, UpdateEquipmentDto, CreateMaintenanceLogDto,
  UpdateMaintenanceLogDto, CreatePartDto, UpdatePartDto,
  CreateUsageLogDto, CreateInspectionLogDto,
} from './dto/equipment.dto';
import { IntegrationOutboxService, type HisEvent } from '../integration/integration-outbox.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { assertEnumParam } from '../../common/enum-param';
import { recordGateViolation } from '../../common/gate-violation-record';

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IntegrationOutboxService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  private erpEvent(event: HisEvent, ref: string, eq: { assetNumber: string; erpAssetCode?: string | null; name: string }, extra: object) {
    void this.outbox.enqueue('equipment', event, ref, { assetNumber: eq.assetNumber, erpAssetCode: eq.erpAssetCode ?? null, name: eq.name, ...extra });
  }

  /**
   * 🔴 점검 기한 경과는 **가동 상태와 별개의 사실**이다 — 2026-08-14(W6).
   *
   * 실측 12대 중 **10대가 정기점검 기한을 넘겼는데**(제세동기 3개월·X-ray 5개월 초과)
   * 상태는 전부 ACTIVE 라 화면은 "가동중 12"만 띄웠다. 기한 경과를 알려주는
   * `GET /equipment/due-inspections` 는 만들어 두고 **어느 화면도 부르지 않았다**.
   * 상태 배지가 초록이면 사람은 점검도 됐다고 읽는다 — 목록에 함께 실어 보낸다.
   */
  private withInspectionFlags<T extends { nextInspection: Date | null }>(rows: T[], now = new Date()) {
    return rows.map((e) => ({
      ...e,
      inspectionOverdue: e.nextInspection != null && e.nextInspection < now,
      inspectionDueInDays:
        e.nextInspection == null
          ? null
          : Math.ceil((e.nextInspection.getTime() - now.getTime()) / 86400000),
    }));
  }

  async findAll(filters: { category?: string; status?: string }) {
    const where: Prisma.EquipmentWhereInput = {};
    if (filters.category) where.category = filters.category;
    if (filters.status) { assertEnumParam(filters.status, EquipmentStatus, '상태'); where.status = filters.status as Prisma.EquipmentWhereInput['status']; }
    const rows = await this.prisma.equipment.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { maintenanceLogs: { orderBy: { performedAt: 'desc' }, take: 1 } },
    });
    return this.withInspectionFlags(rows);
  }

  async create(data: CreateEquipmentDto) {
    const eq = await this.prisma.equipment.create({
      data: {
        assetNumber: data.assetNumber,
        erpAssetCode: data.erpAssetCode,
        name: data.name,
        category: data.category,
        manufacturer: data.manufacturer,
        model: data.model,
        serialNumber: data.serialNumber,
        location: data.location,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        purchasePrice: data.purchasePrice ? Number(data.purchasePrice) : undefined,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : undefined,
        nextInspection: data.nextInspection ? new Date(data.nextInspection) : undefined,
        supplierName: data.supplierName,
        supplierContact: data.supplierContact,
        supplierPhone: data.supplierPhone,
        asContactName: data.asContactName,
        asContactPhone: data.asContactPhone,
        notes: data.notes,
      },
    });
    // ERP 자산 취득 → FixedAsset 등록 트리거
    this.erpEvent('equipment.acquired', `equip:acq:${eq.id}`, eq, { category: eq.category, purchasePrice: eq.purchasePrice, purchaseDate: eq.purchaseDate, manufacturer: eq.manufacturer, model: eq.model, serialNumber: eq.serialNumber });
    return eq;
  }

  async update(id: string, data: UpdateEquipmentDto) {
    const updateData: Record<string, string | number | Date | undefined> = {};
    const fields = ['erpAssetCode', 'name', 'category', 'manufacturer', 'model', 'serialNumber', 'location',
      'supplierName', 'supplierContact', 'supplierPhone', 'asContactName', 'asContactPhone', 'notes'] as const;
    for (const f of fields) { if (data[f] !== undefined) updateData[f] = data[f]; }
    if (data.purchaseDate) updateData.purchaseDate = new Date(data.purchaseDate);
    if (data.purchasePrice !== undefined) updateData.purchasePrice = Number(data.purchasePrice);
    if (data.warrantyExpiry) updateData.warrantyExpiry = new Date(data.warrantyExpiry);
    if (data.nextInspection) updateData.nextInspection = new Date(data.nextInspection);

    return this.prisma.equipment.update({ where: { id }, data: updateData });
  }

  async findById(id: string) {
    const eq = await this.prisma.equipment.findUnique({
      where: { id },
      include: {
        maintenanceLogs: { orderBy: { performedAt: 'desc' }, take: 50 },
        // #5 트윈 사용강도 — 사용 이력(usageHours·patientCount·usedDate·department) 노출
        usageLogs: { orderBy: { usedDate: 'desc' }, take: 100, select: { id: true, usedDate: true, usedBy: true, department: true, patientCount: true, usageHours: true, purpose: true, condition: true } },
      },
    });
    if (!eq) throw new NotFoundException('Equipment not found');
    // Decimal 직렬화 + 사용 요약(진성 사용강도·실가동률 가중용)
    const logs = eq.usageLogs.map((l) => ({ ...l, usageHours: l.usageHours != null ? Number(l.usageHours) : null }));
    const totalHours = logs.reduce((s, l) => s + (l.usageHours ?? 0), 0);
    const totalPatients = logs.reduce((s, l) => s + (l.patientCount ?? 0), 0);
    const usageSummary = {
      sessions: logs.length,
      totalHours: Math.round(totalHours * 10) / 10,
      totalPatientCount: totalPatients,
      lastUsedDate: logs[0]?.usedDate ?? null,
      byDepartment: Object.entries(logs.reduce<Record<string, number>>((m, l) => { const d = l.department || '미지정'; m[d] = (m[d] ?? 0) + 1; return m; }, {})).map(([department, count]) => ({ department, count })),
    };
    return { ...eq, usageLogs: logs, usageSummary };
  }

  async addMaintenanceLog(equipmentId: string, data: CreateMaintenanceLogDto) {
    const log = await this.prisma.maintenanceLog.create({
      data: {
        equipmentId,
        type: data.type,
        status: data.status ?? 'COMPLETED',
        description: data.description,
        performedBy: data.performedBy,
        requestedBy: data.requestedBy,
        cost: data.cost ? Number(data.cost) : undefined,
        vendor: data.vendor,
        partReplaced: data.partReplaced,
        resultNotes: data.resultNotes,
        performedAt: new Date(data.performedAt),
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      },
    });
    // A/S·정비 비용 → ERP 자산 유지보수비(자본적/수익적 지출 판단용)
    if (log.cost) {
      const eq = await this.prisma.equipment.findUnique({ where: { id: equipmentId }, select: { assetNumber: true, erpAssetCode: true, name: true } });
      if (eq) this.erpEvent('equipment.maintenance', `equip:mnt:${log.id}`, eq, { maintenanceType: log.type, cost: log.cost, vendor: log.vendor, performedAt: log.performedAt });
    }
    return log;
  }

  async updateMaintenanceLog(logId: string, data: UpdateMaintenanceLogDto) {
    const updateData: Record<string, string | number | Date> = {};
    if (data.status) updateData.status = data.status;
    if (data.resultNotes) updateData.resultNotes = data.resultNotes;
    if (data.completedAt) updateData.completedAt = new Date(data.completedAt);
    if (data.cost !== undefined) updateData.cost = Number(data.cost);
    if (data.partReplaced) updateData.partReplaced = data.partReplaced;
    return this.prisma.maintenanceLog.update({ where: { id: logId }, data: updateData });
  }

  async updateStatus(id: string, status: string, nextInspection?: string) {
    // 🔴 status 는 원시 파라미터 — 검증 없이 write 하면 Prisma 500
    assertEnumParam(status, EquipmentStatus, '상태');
    const eq = await this.prisma.equipment.update({
      where: { id },
      data: { status: status as EquipmentStatus, ...(nextInspection && { nextInspection: new Date(nextInspection) }) },
    });
    // 처분/폐기 등 상태 변경 → ERP 자산 상태(감가중지·제각 트리거)
    this.erpEvent('equipment.status_changed', `equip:status:${id}:${status}`, eq, { status });
    return eq;
  }

  async getDueInspections() {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    // 폐기 장비는 점검 대상이 아니다. 정비중·고장은 오히려 점검이 밀린 쪽이라 포함한다.
    const rows = await this.prisma.equipment.findMany({
      where: { status: { not: 'RETIRED' }, nextInspection: { lte: thirtyDays } },
      orderBy: { nextInspection: 'asc' },
    });
    return this.withInspectionFlags(rows);
  }

  async getStats() {
    const now = new Date();
    const thirtyDays = new Date(now);
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    const [byStatus, byCategory, recentLogs, pendingAS, inspectionOverdue, inspectionDueSoon] = await Promise.all([
      this.prisma.equipment.groupBy({ by: ['status'], _count: { id: true } }),
      this.prisma.equipment.groupBy({ by: ['category'], _count: { id: true } }),
      this.prisma.maintenanceLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { equipment: { select: { name: true, assetNumber: true } } } }),
      this.prisma.maintenanceLog.count({ where: { status: { in: ['REQUESTED', 'IN_PROGRESS'] } } }),
      // 🔴 점검 기한 경과 — 화면 어디에도 없던 수치(실측 10/12)
      this.prisma.equipment.count({ where: { status: { not: 'RETIRED' }, nextInspection: { lt: now } } }),
      this.prisma.equipment.count({ where: { status: { not: 'RETIRED' }, nextInspection: { gte: now, lte: thirtyDays } } }),
    ]);
    return { byStatus, byCategory, recentLogs, pendingAS, inspectionOverdue, inspectionDueSoon };
  }

  // ── 부품 재고 ──

  async getPartsForEquipment(equipmentId: string) {
    return this.prisma.equipmentPart.findMany({ where: { equipmentId }, orderBy: { partName: 'asc' } });
  }

  async addPart(equipmentId: string, data: CreatePartDto) {
    return this.prisma.equipmentPart.create({
      data: { equipmentId, partName: data.partName, partNumber: data.partNumber, currentStock: Number(data.currentStock ?? 0), minStock: Number(data.minStock ?? 1), unitPrice: data.unitPrice ? Number(data.unitPrice) : undefined, supplier: data.supplier, notes: data.notes },
    });
  }

  async updatePart(partId: string, data: UpdatePartDto) {
    const d: Record<string, string | number | Date | undefined> = {};
    if (data.currentStock !== undefined) d.currentStock = Number(data.currentStock);
    if (data.minStock !== undefined) d.minStock = Number(data.minStock);
    if (data.unitPrice !== undefined) d.unitPrice = Number(data.unitPrice);
    if (data.supplier !== undefined) d.supplier = data.supplier;
    if (data.notes !== undefined) d.notes = data.notes;
    if (data.lastOrderedAt) d.lastOrderedAt = new Date(data.lastOrderedAt);
    return this.prisma.equipmentPart.update({ where: { id: partId }, data: d });
  }

  async getLowStockParts() {
    return this.prisma.$queryRaw`SELECT p.*, e.name as equipment_name, e.asset_number FROM equipment_parts p JOIN equipment e ON p.equipment_id = e.id WHERE p.current_stock <= p.min_stock ORDER BY p.current_stock ASC` as unknown as Record<string, unknown>[];
  }

  // ── 사용일지 ──

  async getUsageLogs(equipmentId: string) {
    return this.prisma.equipmentUsageLog.findMany({ where: { equipmentId }, orderBy: { usedDate: 'desc' }, take: 100 });
  }

  async addUsageLog(equipmentId: string, data: CreateUsageLogDto) {
    // 사용 게이트 — 사용중지(BROKEN/UNDER_MAINTENANCE/RETIRED) 장비 사용 차단·교정기한 경과 경고
    const eq = await this.prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { name: true, assetNumber: true, status: true, nextCalibration: true },
    });
    if (!eq) throw new NotFoundException('Equipment not found');
    const warnings: string[] = [];
    if (eq.status !== 'ACTIVE') {
      const mode = gateMode(await this.configRuntime?.get('equipment.useEnforce'), 'WARN');
      const msg = `사용중지 상태 장비 사용: ${eq.name}(${eq.assetNumber}) — 상태 ${eq.status}`;
      void recordGateViolation(this.prisma, this.logger, {
        gateKey: 'equipment.useEnforce', severity: mode, message: msg, refType: 'EQUIPMENT', refId: equipmentId,
      });
      if (mode === 'BLOCK') {
        throw new BadRequestException({ code: 'EQUIPMENT_USE_BLOCKED', message: `${msg}. 점검/수리 완료 후 사용하세요.` });
      }
      if (mode !== 'OFF') this.logger.warn(`equipment use gate WARN — ${msg}`);
      warnings.push(msg);
    }
    if (eq.nextCalibration && eq.nextCalibration < new Date()) {
      const msg = `교정(calibration) 유효기한 경과: ${eq.name}(${eq.assetNumber}) — 기한 ${eq.nextCalibration.toISOString().slice(0, 10)}`;
      void recordGateViolation(this.prisma, this.logger, {
        gateKey: 'equipment.useEnforce', severity: 'WARN', message: msg, refType: 'EQUIPMENT', refId: equipmentId,
      });
      this.logger.warn(`equipment calibration overdue — ${msg}`);
      warnings.push(msg);
    }
    const log = await this.prisma.equipmentUsageLog.create({
      /**
       * 🔴 (2026-09-15 D3) 종전 `condition: data.condition ?? 'NORMAL'` — 사용 후 상태를 **묻지도 않고 '정상'** 으로
       *    적었다. "이상을 보고하지 않았다"와 "정상임을 확인했다"는 다른 사실이고, 이 칸은 장비 안전 점검
       *    이력으로 읽힌다(칸은 nullable). 미보고는 비워 둔다.
       */
      data: { equipmentId, usedDate: new Date(data.usedDate), usedBy: data.usedBy, department: data.department, patientCount: data.patientCount ? Number(data.patientCount) : undefined, usageHours: data.usageHours ? Number(data.usageHours) : undefined, purpose: data.purpose, condition: data.condition ?? null, issueNotes: data.issueNotes },
    });
    return warnings.length ? { ...log, safetyWarnings: warnings } : log;
  }

  async getAllUsageLogs(filters: { equipmentId?: string; startDate?: string; endDate?: string }) {
    const where: Prisma.EquipmentUsageLogWhereInput = {};
    if (filters.equipmentId) where.equipmentId = filters.equipmentId;
    if (filters.startDate || filters.endDate) {
      where.usedDate = {};
      if (filters.startDate) where.usedDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.usedDate.lte = new Date(filters.endDate);
    }
    return this.prisma.equipmentUsageLog.findMany({ where, orderBy: { usedDate: 'desc' }, take: 200, include: { equipment: { select: { id: true, name: true, assetNumber: true } } } });
  }

  // ── 점검일지 ──

  async getInspectionLogs(equipmentId: string) {
    return this.prisma.equipmentInspectionLog.findMany({ where: { equipmentId }, orderBy: { inspectionDate: 'desc' }, take: 50 });
  }

  async addInspectionLog(equipmentId: string, data: CreateInspectionLogDto) {
    /**
     * 🔴 (2026-09-16 H4) 점검 기록과 그 기록이 **장비에 미치는 효과**(다음 점검·교정기한·불합격 사용중지)는
     *    한 트랜잭션이다. 종전엔 기록을 먼저 커밋하고 상태 전환을 따로 했다 — 뒤가 실패하면
     *    **불합격 기록은 남았는데 장비는 ACTIVE 로 계속 쓰인다**(이 자리의 주석이 막겠다고 적어둔 바로 그 결함).
     *    ERP 통지는 외부 호출이라 트랜잭션 밖에 둔다.
     */
    const nextAt = data.nextInspectionDate ? new Date(data.nextInspectionDate) : null;
    const { log, outOfService } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.equipmentInspectionLog.create({
        data: { equipmentId, inspectionDate: new Date(data.inspectionDate), inspectorName: data.inspectorName, inspectionType: data.inspectionType, checkItems: data.checkItems ?? [], overallResult: data.overallResult, findings: data.findings, actionTaken: data.actionTaken, nextInspectionDate: nextAt ?? undefined },
      });
      // Update equipment next inspection date
      if (nextAt) {
        await tx.equipment.update({ where: { id: equipmentId }, data: { nextInspection: nextAt } });
      }
      // 교정 점검이면 다음 교정기한 갱신(경과 시 사용 경고의 기준)
      if (data.inspectionType === 'CALIBRATION' && nextAt) {
        await tx.equipment.update({ where: { id: equipmentId }, data: { nextCalibration: nextAt } });
      }
      // 점검 불합격 → 자동 사용중지(UNDER_MAINTENANCE) — 불합격 장비가 그대로 사용되던 결함 차단.
      // RETIRED 장비는 전환 제외(폐기 자산을 점검 기록이 '부활'시키는 것 방지)
      let stopped = false;
      if (data.overallResult === 'FAIL') {
        const r = await tx.equipment.updateMany({
          where: { id: equipmentId, status: { not: 'RETIRED' } },
          data: { status: 'UNDER_MAINTENANCE' },
        });
        stopped = r.count === 1;
      }
      return { log: created, outOfService: stopped };
    });

    if (data.overallResult === 'FAIL') {
      if (outOfService) {
        const eq = await this.prisma.equipment.findUnique({
          where: { id: equipmentId },
          select: { name: true, assetNumber: true, erpAssetCode: true },
        });
        if (eq) {
          this.logger.warn(`inspection FAIL → 사용중지 전환: ${eq.name}(${eq.assetNumber})`);
          this.erpEvent('equipment.out_of_service', `eq-fail:${equipmentId}:${log.id}`, { assetNumber: eq.assetNumber, erpAssetCode: eq.erpAssetCode, name: eq.name }, { reason: 'INSPECTION_FAIL', inspectionLogId: log.id });
        }
      }
    }
    return log;
  }

  async getAllInspectionLogs(filters: { type?: string; result?: string }) {
    const where: Prisma.EquipmentInspectionLogWhereInput = {};
    if (filters.type) where.inspectionType = filters.type;
    if (filters.result) where.overallResult = filters.result;
    return this.prisma.equipmentInspectionLog.findMany({ where, orderBy: { inspectionDate: 'desc' }, take: 200, include: { equipment: { select: { id: true, name: true, assetNumber: true } } } });
  }

  async getAllMaintenanceLogs(filters: { type?: string; status?: string }) {
    const where: Prisma.MaintenanceLogWhereInput = {};
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    return this.prisma.maintenanceLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { equipment: { select: { id: true, name: true, assetNumber: true, location: true } } },
    });
  }

  /** 감가상각 스케줄(정액법) — 연도별 상각/누계/장부가 + 현재 장부가 */
  async getDepreciationSchedule(id: string) {
    const eq = await this.prisma.equipment.findUnique({
      where: { id },
      select: { id: true, name: true, assetNumber: true, category: true, purchasePrice: true, purchaseDate: true, status: true },
    });
    if (!eq) throw new NotFoundException('장비를 찾을 수 없습니다');
    if (!eq.purchasePrice || !eq.purchaseDate) {
      return { equipment: eq, applicable: false, message: '취득가·취득일 정보가 없어 감가상각을 계산할 수 없습니다.', schedule: [] };
    }
    const result = computeDepreciation(eq.purchasePrice, new Date(eq.purchaseDate).getFullYear(), eq.category, eq.status === 'RETIRED', new Date().getFullYear());
    return { equipment: eq, applicable: true, ...result };
  }

  /** 자산 감가상각 요약(전체 장부가) */
  async getDepreciationSummary() {
    const items = await this.prisma.equipment.findMany({
      where: { purchasePrice: { not: null }, purchaseDate: { not: null } },
      select: { id: true, name: true, assetNumber: true, category: true, purchasePrice: true, purchaseDate: true, status: true },
      take: 2000,
    });
    const nowYear = new Date().getFullYear();
    let totalCost = 0, totalBookValue = 0;
    const byCategory = new Map<string, { cost: number; bookValue: number; count: number }>();
    for (const eq of items) {
      const years = usefulLifeOf(eq.category);
      const annual = Math.round((eq.purchasePrice ?? 0) / years);
      const elapsed = Math.max(0, nowYear - new Date(eq.purchaseDate as Date).getFullYear() + 1);
      const accum = elapsed >= years ? (eq.purchasePrice ?? 0) : Math.min(eq.purchasePrice ?? 0, annual * elapsed);
      const bv = eq.status === 'RETIRED' ? 0 : Math.max(0, (eq.purchasePrice ?? 0) - accum);
      totalCost += eq.purchasePrice ?? 0; totalBookValue += bv;
      const c = byCategory.get(eq.category) ?? { cost: 0, bookValue: 0, count: 0 };
      c.cost += eq.purchasePrice ?? 0; c.bookValue += bv; c.count += 1;
      byCategory.set(eq.category, c);
    }
    return {
      assetCount: items.length, totalAcquisitionCost: totalCost, totalBookValue,
      totalAccumulatedDepreciation: totalCost - totalBookValue,
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
    };
  }
}