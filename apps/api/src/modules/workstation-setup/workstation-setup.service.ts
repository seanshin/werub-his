import { Injectable, NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpsertWorkstationDto, UpsertPeripheralDto } from './dto/workstation-setup.dto';
import { DIAGNOSTIC_STATION_CATEGORY, serverMsg } from '@hospital-run/shared';
import { msgException } from '../../common/msg-exception';
import { matchStationProcedureCodes, cleanStationOrderCodes } from '../../common/station-order-codes';

@Injectable()
export class WorkstationSetupService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 워크스테이션 프로파일(관리) ──

  async listWorkstations() {
    return this.prisma.workstationProfile.findMany({
      orderBy: { code: 'asc' },
      include: { peripherals: { where: { isActive: true }, orderBy: [{ type: 'asc' }, { isDefault: 'desc' }] } },
    });
  }

  async upsertWorkstation(dto: UpsertWorkstationDto) {
    const existing = await this.prisma.workstationProfile.findUnique({ where: { code: dto.code } });
    const data = {
      label: dto.label, department: dto.department ?? null, location: dto.location ?? null,
      defaultStationIds: (dto.defaultStationIds ?? []) as unknown as Prisma.InputJsonValue,
      terminalId: dto.terminalId ?? null, isActive: dto.isActive ?? true,
    };
    if (existing) return this.prisma.workstationProfile.update({ where: { id: existing.id }, data });
    return this.prisma.workstationProfile.create({ data: { code: dto.code, ...data } });
  }

  async deleteWorkstation(id: string) {
    const ws = await this.prisma.workstationProfile.findUnique({ where: { id }, include: { peripherals: true } });
    if (!ws) throw new NotFoundException('워크스테이션 없음');
    await this.prisma.peripheralDevice.deleteMany({ where: { workstationProfileId: id } });
    return this.prisma.workstationProfile.delete({ where: { id } });
  }

  // ── 주변기기(조정 가능·프린터 중심) ──

  async upsertPeripheral(id: string | null, dto: UpsertPeripheralDto) {
    const ws = await this.prisma.workstationProfile.findUnique({ where: { id: dto.workstationProfileId } });
    if (!ws) throw new BadRequestException('워크스테이션을 찾을 수 없습니다');
    const data = {
      type: dto.type, name: dto.name, connection: dto.connection ?? 'NETWORK',
      host: dto.host ?? null, port: dto.port ?? null,
      config: (dto.config ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      isDefault: dto.isDefault ?? false, isActive: dto.isActive ?? true,
    };
    // 유형별 기본기는 하나만 — 새 기본 지정 시 동일 유형 기존 기본 해제
    if (data.isDefault) {
      await this.prisma.peripheralDevice.updateMany({
        where: { workstationProfileId: dto.workstationProfileId, type: dto.type, ...(id ? { id: { not: id } } : {}) },
        data: { isDefault: false },
      });
    }
    if (id) {
      const p = await this.prisma.peripheralDevice.findUnique({ where: { id } });
      if (!p) throw new NotFoundException('주변기기 없음');
      return this.prisma.peripheralDevice.update({ where: { id }, data });
    }
    return this.prisma.peripheralDevice.create({ data: { workstationProfileId: dto.workstationProfileId, ...data } });
  }

  async deletePeripheral(id: string) {
    const p = await this.prisma.peripheralDevice.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('주변기기 없음');
    return this.prisma.peripheralDevice.delete({ where: { id } });
  }

  // ── 하이브리드 정체성 해석 ──

  /**
   * 현재 워크스테이션 해석: (B) 단말 deviceUuid→TerminalRegistry→바인딩 자동 해석,
   * 없으면 (A) 명시 code 선택 폴백. 둘 다 없으면 미해석(FE가 선택 UI 표시).
   */
  async resolve(deviceUuid?: string, code?: string) {
    let ws = null as Awaited<ReturnType<typeof this.getByCode>> | null;
    let via: 'TERMINAL' | 'CODE' | null = null;
    if (deviceUuid) {
      const term = await this.prisma.terminalRegistry.findUnique({ where: { deviceUuid } }).catch(() => null);
      if (term) {
        const bound = await this.prisma.workstationProfile.findFirst({
          where: { terminalId: term.id, isActive: true },
          include: { peripherals: { where: { isActive: true } } },
        });
        if (bound) { ws = bound; via = 'TERMINAL'; }
      }
    }
    if (!ws && code) { ws = await this.getByCode(code); if (ws) via = 'CODE'; }
    return { resolved: !!ws, via, workstation: ws, defaultsByType: ws ? this.defaults(ws.peripherals) : {} };
  }

  private async getByCode(code: string) {
    return this.prisma.workstationProfile.findFirst({
      where: { code, isActive: true },
      include: { peripherals: { where: { isActive: true } } },
    });
  }

  private defaults(peripherals: { type: string; isDefault: boolean; id: string; name: string; connection: string; host: string | null; port: number | null }[]) {
    const map: Record<string, unknown> = {};
    for (const p of peripherals) {
      if (p.isDefault && !map[p.type]) map[p.type] = { id: p.id, name: p.name, connection: p.connection, host: p.host, port: p.port };
    }
    return map;
  }

  /** 논리 스테이션(WorkstationConfig) 목록 — 매핑 편집용 */
  async listLogicalStations() {
    return this.prisma.workstationConfig.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { stationId: 'asc' }],
      select: { stationId: true, label: true, category: true, department: true },
    });
  }

  /**
   * 🔴 논리 스테이션 **검사항목 설정(orderCodes)** 조회 — 2026-09-13 외부 실측 S9.
   *
   * 검사·영상 워크스테이션 배너가 "검사항목 설정이 실제 코드와 맞지 않습니다 … **이 설정을 고칠 화면은
   * 아직 없습니다**"라고 말하고 있었고, 그 말이 사실이었다 — `order_codes` 를 쓰는 EP 는 기초검사 자리
   * (`diagnostic-test`)에만 있었다. **화면이 "안 맞다"고 말하면 고칠 자리가 있어야 한다.**
   *
   * 대조는 큐와 같은 정본(`matchStationProcedureCodes`) — 여기서 "맞음"이면 큐도 그 코드로 거른다.
   */
  async getStationOrderCodes(stationId: string) {
    const station = await this.prisma.workstationConfig.findUnique({ where: { stationId } });
    if (!station) throw msgException(HttpStatus.NOT_FOUND, serverMsg('자리를 찾을 수 없습니다: {자리}', { 자리: stationId }));
    const codes = Array.isArray(station.orderCodes) ? (station.orderCodes as unknown[]).map(String) : [];
    // 🔴 기초검사 자리 코드는 검사 종류 어휘다 — 수가 마스터로 대조하면 늘 "안 맞음"(거짓 경고). 대조하지 않는다.
    const usesProcedureCodes = station.category !== DIAGNOSTIC_STATION_CATEGORY;
    const { matched, unknown } = usesProcedureCodes
      ? await matchStationProcedureCodes(this.prisma, codes)
      : { matched: [], unknown: [] as string[] };
    return {
      stationId: station.stationId,
      label: station.label,
      category: station.category,
      department: station.department,
      orderCodes: codes,
      /** 수가 마스터에 실재하는 코드 — 큐가 실제로 거르는 코드 */
      matched,
      /** 마스터에 없는 코드 — 🔴 막지 않는다. 다만 이것만 있으면 큐가 부서 전체로 떨어진다 */
      unknownCodes: usesProcedureCodes ? unknown : null,
      /** false = 이 자리 코드는 수가 어휘가 아니다(기초검사) — 여기서 편집하지 않는다(다른 화면 소관) */
      usesProcedureCodes,
    };
  }

  /**
   * 논리 스테이션 검사항목 저장. 공백·중복만 정리하고 마스터에 없는 코드는 **막지 않는다**
   * (원내 코드가 마스터에 선등록되기 전 강제하면 아무 코드나 골라 통과 → 거짓 데이터).
   * 🔴 기초검사 자리는 덮지 않는다 — 어휘가 달라 덮으면 그 큐가 죽는다(`diagnostic-test` 가 정본).
   */
  async setStationOrderCodes(stationId: string, orderCodes: string[]) {
    const station = await this.prisma.workstationConfig.findUnique({ where: { stationId } });
    if (!station) throw msgException(HttpStatus.NOT_FOUND, serverMsg('자리를 찾을 수 없습니다: {자리}', { 자리: stationId }));
    if (station.category === DIAGNOSTIC_STATION_CATEGORY) {
      throw new BadRequestException('기초검사 자리의 검사 종류는 기초검사 워크스테이션의 자리 설정에서 바꿉니다(코드 어휘가 다릅니다).');
    }
    await this.prisma.workstationConfig.update({
      where: { stationId },
      data: { orderCodes: cleanStationOrderCodes(orderCodes) as Prisma.InputJsonValue },
    });
    return this.getStationOrderCodes(stationId);
  }

  /** 선택용 활성 워크스테이션 목록(경량) */
  async pickList() {
    const list = await this.prisma.workstationProfile.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, label: true, department: true, location: true } });
    return list;
  }

  /** 바인딩용 미할당 단말 목록 */
  async availableTerminals() {
    const bound = await this.prisma.workstationProfile.findMany({ where: { terminalId: { not: null } }, select: { terminalId: true } });
    const boundIds = bound.map((b) => b.terminalId).filter(Boolean) as string[];
    return this.prisma.terminalRegistry.findMany({
      where: { status: 'ACTIVE', ...(boundIds.length ? { id: { notIn: boundIds } } : {}) },
      select: { id: true, deviceUuid: true, label: true, location: true }, take: 100,
    });
  }
}
