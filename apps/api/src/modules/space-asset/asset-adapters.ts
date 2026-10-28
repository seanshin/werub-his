import { AssetKind } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 자산 종류별 어댑터 — 원래 테이블(정본)을 읽어 배치 화면이 쓰는 한 모양으로 맞춘다.
 *
 * 🔴 비밀·식별 원값을 싣지 않는다: 전광판 `key`(API 키) · 단말 IP/MAC/beacon · 스테이션 keyHash.
 *    단말은 장치 UUID 끝 6자리만(관리자가 실물 라벨과 대조할 최소치).
 * 🔴 `active=false` 는 폐기·비활성 — 배치 누락 집계(분모)에서 빠지지만, 남아 있는 배치는 그대로 보여준다(숨기지 않음).
 */
export interface AssetView {
  kind: AssetKind;
  id: string;
  label: string;
  detail: string | null;
  status: string | null;
  active: boolean;
  /** 자산 테이블의 기존 자유 텍스트 위치(없으면 null) */
  legacyText: string | null;
  /** 자산 테이블이 스스로 공간을 들고 있으면 그 노드 id(LOCATION_STATION) */
  nativeSpaceNodeId?: string | null;
}

type Loader = (prisma: PrismaService, ids?: string[]) => Promise<AssetView[]>;

const idWhere = (ids?: string[]) => (ids ? { id: { in: ids } } : {});
const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ') || null;

export const ASSET_LOADERS: Record<AssetKind, Loader> = {
  EQUIPMENT: async (p, ids) =>
    (await p.equipment.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, assetNumber: true, category: true, model: true, status: true, location: true },
    })).map((r) => ({
      kind: 'EQUIPMENT', id: r.id, label: r.name, detail: join(r.assetNumber, r.category, r.model),
      status: r.status, active: r.status !== 'RETIRED', legacyText: r.location,
    })),

  LAB_INSTRUMENT: async (p, ids) =>
    (await p.labInstrument.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, category: true, model: true, isActive: true, location: true },
    })).map((r) => ({
      kind: 'LAB_INSTRUMENT', id: r.id, label: r.name, detail: join(r.category, r.model),
      status: r.isActive ? 'ACTIVE' : 'INACTIVE', active: r.isActive, legacyText: r.location,
    })),

  DIALYSIS_MACHINE: async (p, ids) =>
    (await p.dialysisMachine.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, model: true, status: true, isActive: true, location: true },
    })).map((r) => ({
      kind: 'DIALYSIS_MACHINE', id: r.id, label: r.name, detail: r.model,
      status: r.status, active: r.isActive, legacyText: r.location,
    })),

  PHARMACY_DEVICE: async (p, ids) =>
    (await p.pharmacyDevice.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, type: true, status: true, location: true },
    })).map((r) => ({
      // 폐기 상태 어휘가 없다(ONLINE/OFFLINE/ERROR/MAINTENANCE) — 전부 활성으로 센다
      kind: 'PHARMACY_DEVICE', id: r.id, label: r.name, detail: r.type,
      status: r.status, active: true, legacyText: r.location,
    })),

  CONSENT_DEVICE: async (p, ids) =>
    (await p.consentSigningDevice.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, status: true, isActive: true, location: true },
    })).map((r) => ({
      kind: 'CONSENT_DEVICE', id: r.id, label: r.name, detail: null,
      status: r.status, active: r.isActive, legacyText: r.location,
    })),

  TERMINAL: async (p, ids) =>
    (await p.terminalRegistry.findMany({
      where: idWhere(ids),
      select: { id: true, label: true, deviceUuid: true, mode: true, status: true, location: true },
    })).map((r) => ({
      kind: 'TERMINAL', id: r.id,
      label: r.label ?? `…${r.deviceUuid.slice(-6)}`, // 라벨 없는 단말 — 끝 6자리만(화면이 '단말' 을 붙인다)
      detail: join(r.mode === 'PRIVATE' ? '전담' : '공용', `…${r.deviceUuid.slice(-6)}`),
      status: r.status, active: r.status !== 'RETIRED', legacyText: r.location,
    })),

  WORKSTATION_PROFILE: async (p, ids) =>
    (await p.workstationProfile.findMany({
      where: idWhere(ids),
      select: { id: true, code: true, label: true, isActive: true, location: true },
    })).map((r) => ({
      kind: 'WORKSTATION_PROFILE', id: r.id, label: r.label, detail: r.code,
      status: r.isActive ? 'ACTIVE' : 'INACTIVE', active: r.isActive, legacyText: r.location,
    })),

  INVENTORY_STORAGE: async (p, ids) =>
    (await p.inventoryStorage.findMany({
      where: idWhere(ids),
      select: { id: true, code: true, name: true, type: true, isActive: true, location: true },
    })).map((r) => ({
      kind: 'INVENTORY_STORAGE', id: r.id, label: r.name, detail: join(r.code, r.type),
      status: r.isActive ? 'ACTIVE' : 'INACTIVE', active: r.isActive, legacyText: r.location,
    })),

  DISPLAY_BOX: async (p, ids) =>
    (await p.displayApiKey.findMany({
      where: idWhere(ids),
      select: { id: true, name: true, isActive: true }, // key 는 API 키 — 싣지 않는다
    })).map((r) => ({
      kind: 'DISPLAY_BOX', id: r.id, label: r.name, detail: null,
      status: r.isActive ? 'ACTIVE' : 'INACTIVE', active: r.isActive, legacyText: null,
    })),

  LOCATION_STATION: async (p, ids) =>
    (await p.locationStation.findMany({
      where: idWhere(ids),
      select: { id: true, label: true, deviceType: true, isActive: true, zoneId: true }, // keyHash 제외
    })).map((r) => ({
      kind: 'LOCATION_STATION', id: r.id, label: r.label, detail: r.deviceType,
      status: r.isActive ? 'ACTIVE' : 'INACTIVE', active: r.isActive, legacyText: null, nativeSpaceNodeId: r.zoneId,
    })),
};
