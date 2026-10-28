import { Injectable, BadRequestException, ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { CSSD_UNIT_NOT_REGISTERED, CSSD_UNIT_RETIRED } from '../../common/errors/domain-error-codes';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { aggregateUnitUsage, evaluateUnitLife, type UnitLife, type UnitPackageRow } from './instrument-unit-life';

/** 멸균 사이클이 진행 중인(아직 반납·만료·리콜되지 않은) 패키지 상태 — 한 개체가 동시에 둘에 들어갈 수 없다 */
const OPEN_PACKAGE_STATUSES = ['ASSEMBLING', 'PACKAGED', 'IN_LOAD', 'STERILE', 'IN_USE'];

export interface UnitLinkWarning {
  serialNo: string;
  code: 'LIFE_LIMIT_REACHED' | 'IN_OPEN_PACKAGE';
  /** LIFE_LIMIT_REACHED: 연결 전 합격 사이클 수 · 한도 */
  sterilizedCycles?: number;
  limit?: number;
  /** IN_OPEN_PACKAGE: 아직 닫히지 않은 다른 패키지 LOT */
  otherLots?: string[];
}

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * CSSD 기구 개체(개별 기구) — 등록·한도 입력·폐기, 멸균 합격 사이클·최초 사용일(파생)·수명 판정.
 * 판정 정본은 `instrument-unit-life.ts` 하나다.
 */
@Injectable()
export class CssdUnitService {
  constructor(private readonly prisma: PrismaService) {}

  /** 개체별 패키지 기록을 한 번에 읽어 파생값을 만든다(개체 수만큼 쿼리하지 않는다) */
  private async usageRows(unitIds: string[], db: Tx = this.prisma): Promise<Map<string, UnitPackageRow[]>> {
    const map = new Map<string, UnitPackageRow[]>(unitIds.map((id) => [id, []]));
    if (!unitIds.length) return map;
    const links = await db.sterilePackageUnit.findMany({
      where: { unitId: { in: unitIds } },
      select: { unitId: true, package: { select: { sterilizedAt: true, usedAt: true } } },
    });
    for (const l of links) map.get(l.unitId)?.push({ sterilizedAt: l.package.sterilizedAt, usedAt: l.package.usedAt });
    return map;
  }

  async list(filter: { itemId?: string; status?: string; q?: string } = {}) {
    const units = await this.prisma.instrumentUnit.findMany({
      where: {
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(filter.status && filter.status !== 'ALL' ? { status: filter.status } : {}),
        ...(filter.q?.trim() ? { serialNo: { contains: filter.q.trim(), mode: 'insensitive' as const } } : {}),
      },
      include: { item: { select: { id: true, code: true, name: true, maxCycles: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const rows = await this.usageRows(units.map((u) => u.id));
    return units.map((u) => ({ ...u, life: evaluateUnitLife(aggregateUnitUsage(rows.get(u.id) ?? []), u.maxCycles, u.item.maxCycles) }));
  }

  async get(id: string) {
    const unit = await this.prisma.instrumentUnit.findUnique({
      where: { id },
      include: {
        item: { select: { id: true, code: true, name: true, maxCycles: true } },
        packages: {
          orderBy: { addedAt: 'desc' },
          select: {
            addedAt: true,
            package: { select: { id: true, lotNo: true, templateName: true, status: true, sterilizedAt: true, usedAt: true, usedEncounterId: true, loadId: true } },
          },
        },
      },
    });
    if (!unit) throw new NotFoundException('기구 개체를 찾을 수 없습니다');
    const life: UnitLife = evaluateUnitLife(
      aggregateUnitUsage(unit.packages.map((p) => ({ sterilizedAt: p.package.sterilizedAt, usedAt: p.package.usedAt }))),
      unit.maxCycles,
      unit.item.maxCycles,
    );
    return { ...unit, life };
  }

  async create(data: { itemId: string; serialNo: string; maxCycles?: number | null; note?: string }, userId: string) {
    const serialNo = data.serialNo.trim();
    if (!serialNo) throw new BadRequestException('개체 번호가 비어 있습니다');
    const item = await this.prisma.instrumentItem.findUnique({ where: { id: data.itemId }, select: { id: true } });
    if (!item) throw new NotFoundException('기구 품목을 찾을 수 없습니다');
    const dup = await this.prisma.instrumentUnit.findUnique({ where: { serialNo }, select: { id: true } });
    if (dup) throw new ConflictException('이미 등록된 개체 번호입니다');
    return this.prisma.instrumentUnit.create({
      data: { itemId: data.itemId, serialNo, maxCycles: data.maxCycles ?? null, note: data.note ?? null, createdBy: userId },
    });
  }

  /** 한도·메모 변경 — `maxCycles: null` 은 "개체 한도 해제(품목 한도 따름)", 생략은 "바꾸지 않음" */
  async update(id: string, data: { maxCycles?: number | null; note?: string | null }) {
    const unit = await this.prisma.instrumentUnit.findUnique({ where: { id }, select: { id: true } });
    if (!unit) throw new NotFoundException('기구 개체를 찾을 수 없습니다');
    return this.prisma.instrumentUnit.update({
      where: { id },
      data: {
        ...(data.maxCycles !== undefined ? { maxCycles: data.maxCycles } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
      },
    });
  }

  /** 폐기(사람의 명시적 결정) — 기록은 지우지 않는다. 폐기된 개체는 새 패키지에 넣을 수 없다 */
  async retire(id: string, userId: string, note?: string) {
    const unit = await this.prisma.instrumentUnit.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!unit) throw new NotFoundException('기구 개체를 찾을 수 없습니다');
    if (unit.status === 'RETIRED') throw new BadRequestException('이미 폐기된 개체입니다');
    return this.prisma.instrumentUnit.update({
      where: { id },
      data: { status: 'RETIRED', retiredAt: new Date(), retiredBy: userId, retireNote: note ?? null },
    });
  }

  /**
   * 패키지 구성에 개체를 연결한다(재포장 시점).
   * - 없는 번호·폐기 개체는 400(사실 오류 — 무엇을 넣었는지 모르는 채 LOT 를 만들지 않는다).
   * - 🔴 수명 한도 도달·다른 열린 패키지에 이미 들어 있음은 **막지 않고** 경고로 돌려준다(규칙 "막으면 방치된다").
   */
  async resolveForPackage(serials: string[] | undefined, db: Tx = this.prisma) {
    const wanted = [...new Set((serials ?? []).map((s) => s.trim()).filter(Boolean))];
    if (!wanted.length) return { units: [] as { id: string; serialNo: string }[], warnings: [] as UnitLinkWarning[] };
    const units = await db.instrumentUnit.findMany({
      where: { serialNo: { in: wanted } },
      include: { item: { select: { maxCycles: true } } },
    });
    const found = new Set(units.map((u) => u.serialNo));
    const missing = wanted.filter((s) => !found.has(s));
    if (missing.length) throw new DomainException(CSSD_UNIT_NOT_REGISTERED, '등록되지 않은 기구 개체 번호가 있습니다', HttpStatus.BAD_REQUEST, { missing });
    const retired = units.filter((u) => u.status === 'RETIRED').map((u) => u.serialNo);
    if (retired.length) throw new DomainException(CSSD_UNIT_RETIRED, '폐기된 기구 개체는 패키지에 넣을 수 없습니다', HttpStatus.BAD_REQUEST, { retired });

    const rows = await this.usageRows(units.map((u) => u.id), db);
    const open = await db.sterilePackageUnit.findMany({
      where: { unitId: { in: units.map((u) => u.id) }, package: { status: { in: OPEN_PACKAGE_STATUSES } } },
      select: { unitId: true, package: { select: { lotNo: true } } },
    });
    const warnings: UnitLinkWarning[] = [];
    for (const u of units) {
      const life = evaluateUnitLife(aggregateUnitUsage(rows.get(u.id) ?? []), u.maxCycles, u.item.maxCycles);
      if (life.state === 'LIMIT_REACHED') {
        warnings.push({ serialNo: u.serialNo, code: 'LIFE_LIMIT_REACHED', sterilizedCycles: life.sterilizedCycles, limit: life.limit as number });
      }
      const lots = open.filter((o) => o.unitId === u.id).map((o) => o.package.lotNo);
      if (lots.length) warnings.push({ serialNo: u.serialNo, code: 'IN_OPEN_PACKAGE', otherLots: lots });
    }
    return { units: units.map((u) => ({ id: u.id, serialNo: u.serialNo })), warnings };
  }
}
