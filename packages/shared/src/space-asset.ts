/**
 * 공간 자산 배치 — 어휘 정본 (기획 `spatial-flow-vision-3d.plan.md` §5-A)
 *
 * 워크스테이션·PC·의료기기·장비·보관 장소가 "어느 공간에 있는가"를 **배치 원장(AssetPlacement) 하나**에 기록한다.
 * 자산 자체(이름·모델·상태)는 각자의 원래 테이블이 정본이고, 원장은 (종류, id) 로 가리키기만 한다(복사하지 않음).
 *
 * 🔴 기존 자유 텍스트 `location` 컬럼은 **덮어쓰지 않는다**. 원장과 어긋나면 "불일치"로 드러낼 뿐이다
 *    (전환기 — 편집 화면이 공간 선택기로 바뀌면 텍스트는 표시 캐시가 된다).
 * 🔴 좌표(x,y)는 도면이 사람에게 확정된 구역에서만 받는다. 그 전에는 구역 단위 배치만 — 지어낸 좌표를 남기지 않는다.
 */

export const ASSET_KINDS = [
  'EQUIPMENT',
  'LAB_INSTRUMENT',
  'DIALYSIS_MACHINE',
  'PHARMACY_DEVICE',
  'CONSENT_DEVICE',
  'TERMINAL',
  'WORKSTATION_PROFILE',
  'INVENTORY_STORAGE',
  'DISPLAY_BOX',
  'LOCATION_STATION',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetKindMeta {
  label: string;
  /** 원래 테이블(정본) — 화면이 "어디서 온 자산인가"를 말할 때 쓴다 */
  sourceTable: string;
  /** 기존 자유 텍스트 위치 컬럼이 있는가(불일치 대조 대상) */
  hasLegacyText: boolean;
  /**
   * 원장으로 배치할 수 있는가.
   * false = 자기 테이블이 이미 공간을 정본으로 들고 있다(LocationStation.zoneId) — 원장이 두 번째 정본이 되지 않게 읽기 전용.
   */
  placeable: boolean;
  /** 관리 화면 그룹 */
  group: 'MEDICAL_DEVICE' | 'IT' | 'STORAGE' | 'DISPLAY';
}

export const ASSET_KIND_META: Record<AssetKind, AssetKindMeta> = {
  EQUIPMENT: { label: '의료장비', sourceTable: 'equipment', hasLegacyText: true, placeable: true, group: 'MEDICAL_DEVICE' },
  LAB_INSTRUMENT: { label: '검사장비', sourceTable: 'lab_instruments', hasLegacyText: true, placeable: true, group: 'MEDICAL_DEVICE' },
  DIALYSIS_MACHINE: { label: '투석기', sourceTable: 'dialysis_machines', hasLegacyText: true, placeable: true, group: 'MEDICAL_DEVICE' },
  PHARMACY_DEVICE: { label: '약제 자동화기기', sourceTable: 'pharmacy_devices', hasLegacyText: true, placeable: true, group: 'MEDICAL_DEVICE' },
  CONSENT_DEVICE: { label: '동의서 서명 태블릿', sourceTable: 'consent_signing_devices', hasLegacyText: true, placeable: true, group: 'IT' },
  TERMINAL: { label: '등록 단말(PC)', sourceTable: 'terminal_registry', hasLegacyText: true, placeable: true, group: 'IT' },
  WORKSTATION_PROFILE: { label: '워크스테이션', sourceTable: 'workstation_profiles', hasLegacyText: true, placeable: true, group: 'IT' },
  INVENTORY_STORAGE: { label: '물품 보관 장소', sourceTable: 'inventory_storages', hasLegacyText: true, placeable: true, group: 'STORAGE' },
  DISPLAY_BOX: { label: '전광판 박스', sourceTable: 'display_api_keys', hasLegacyText: false, placeable: true, group: 'DISPLAY' },
  LOCATION_STATION: { label: 'QR 위치 스테이션', sourceTable: 'location_stations', hasLegacyText: false, placeable: false, group: 'IT' },
};

/**
 * 원장에 넣지 않은 것 — 이유를 남긴다(빠뜨린 것과 뺀 것을 구분).
 * 화면·문서가 "전부 연동"이라고 말하지 않게 한다.
 */
export const ASSET_KINDS_EXCLUDED: ReadonlyArray<{ table: string; reason: string }> = [
  { table: 'controlled_substance_stocks', reason: '보관 장소 값이 재고의 논리 키(@@unique)이고 마약류 법정 대장과 묶여 있다 — 물리 위치 연결은 사람 결정' },
  { table: 'workstation_configs', reason: '논리 스테이션(검사항목 묶음) 설정이다 — 물리 위치는 워크스테이션 프로파일·단말이 갖는다' },
  { table: 'instrument_items / sterile_packages', reason: '순환하는 멸균 물품 — 위치는 CSSD 상태 흐름이 정본(배치 개념이 아니다)' },
  { table: 'blood_products', reason: '보관 위치는 혈액 재고 흐름의 일부 — 혈액은행 정본을 따른다' },
];

/** 배치 출처 — 누가 어떻게 알게 된 위치인가 */
export const PLACEMENT_SOURCES = ['MANUAL', 'SURVEY', 'IMPORT', 'NATIVE'] as const;
export type PlacementSource = (typeof PLACEMENT_SOURCES)[number];
export const PLACEMENT_SOURCE_LABEL: Record<PlacementSource, string> = {
  MANUAL: '직원 입력',
  SURVEY: '현장 실사',
  IMPORT: '일괄 가져오기',
  NATIVE: '자산 테이블 자체 값',
};

/** 배치할 수 있는 공간 노드 — 층 단위(구역 미상)도 허용하되 화면이 그렇게 말한다 */
export const PLACEABLE_NODE_TYPES = ['ZONE', 'WING', 'FLOOR'] as const;

/** 좌표를 받아도 되는 도면 출처 — 기획 §4 원칙 2 (GRID_AUTO·DRAWING_DRAFT 는 좌표 불가) */
export const COORDINATE_TRUSTED_GEOMETRY = ['DRAWING_CONFIRMED', 'SURVEYED'] as const;

export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v);
}
