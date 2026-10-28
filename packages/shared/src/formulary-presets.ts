/**
 * 원내 처방집(포뮬러리) 프리셋 영역(치료·활동) 키 정본 — 관리 화면 선택지와 서버 CSV 일괄 등재 검증이 같은 목록을 쓴다.
 *
 * 🔴 (2026-09-14) 종전 이 목록은 관리 화면(`admin/formulary/page.tsx`) 안 상수뿐이라 서버는 CSV 로 들어온 프리셋 키가
 *    실제로 있는 키인지 확인할 방법이 없었다. 서버가 모르는 키를 받아 두면 처방 화면이 그 키를 그릴 수 없다.
 * 🔴 처방 입력(`components/prescription/order-entry.tsx`)·시드(`prisma/seed.ts`)에도 같은 키가 따로 적혀 있다 —
 *    이 파일로 수렴하는 일(기획서 §3.3 "프리셋 formulary 로드 전환")은 처방 화면을 바꾸는 작업이라 여기서 하지 않았다.
 */
export interface FormularyPreset {
  key: string;
  name: string;
}

export const FORMULARY_PRESETS: Readonly<Record<'THERAPY' | 'ACTIVITY', readonly FormularyPreset[]>> = {
  THERAPY: [
    { key: 'PT_EXERCISE', name: '운동치료' }, { key: 'PT_MANUAL', name: '도수치료' }, { key: 'PT_MODALITY', name: '열전기치료' },
    { key: 'OT_ADL', name: '작업치료' }, { key: 'OT_COGNITIVE', name: '인지재활' }, { key: 'ST_SPEECH', name: '언어치료' },
    { key: 'ST_SWALLOW', name: '삼킴치료' }, { key: 'HD_SESSION', name: '혈액투석' }, { key: 'CHEMO_IV', name: '항암주사' },
    { key: 'RT_FRACTION', name: '방사선치료' }, { key: 'PT_GAIT', name: '보행치료' }, { key: 'PT_TRACTION', name: '견인치료' },
    { key: 'PT_ESWT', name: '체외충격파' }, { key: 'PT_FES', name: '전기자극치료' }, { key: 'PT_LYMPH', name: '림프부종치료' },
    { key: 'REHAB_PULMO', name: '호흡재활' }, { key: 'REHAB_CARDIAC', name: '심장재활' }, { key: 'PD_SESSION', name: '복막투석' },
  ],
  ACTIVITY: [
    { key: 'ACT_ABR', name: '절대안정 (ABR)' }, { key: 'ACT_BR', name: '침상안정 (BR)' }, { key: 'ACT_HOB30', name: '침상머리 30° 거상' },
    { key: 'ACT_SIT', name: '좌위 허용' }, { key: 'ACT_BRP', name: '화장실 보행만 허용' }, { key: 'ACT_ROOM', name: '병실 내 보행' },
    { key: 'ACT_AMB', name: '자유 보행' }, { key: 'ACT_WC', name: '휠체어 이동' }, { key: 'ACT_FALL', name: '낙상 주의' },
    { key: 'ACT_NWB_R', name: '체중부하 금지(우)' }, { key: 'ACT_NWB_L', name: '체중부하 금지(좌)' }, { key: 'ACT_PWB', name: '부분 체중부하' },
    { key: 'ACT_CRUTCH', name: '목발 보행' }, { key: 'ACT_BRACE', name: '보조기 착용 보행' }, { key: 'ACT_HOB_FLAT', name: '두부 거상 금지' },
    { key: 'ACT_NO_SHOWER', name: '샤워·목욕 금지' }, { key: 'ACT_NO_STRAIN', name: '격렬한 활동 금지' },
  ],
};

export function isFormularyPresetKey(domain: string, key: string): boolean {
  const list = (FORMULARY_PRESETS as Record<string, readonly FormularyPreset[]>)[domain];
  return !!list?.some((p) => p.key === key);
}
