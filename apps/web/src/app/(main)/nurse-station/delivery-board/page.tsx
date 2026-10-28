'use client';

import PageHeader from '@/components/ui/PageHeader';
import { T } from '@/components/ui/i18n-text';
import DeliveryBoard from '../../obgyn/DeliveryBoard';

/**
 * 간호 — 분만 현황 보드(2026-10-10).
 *
 * 🔴 분만 보드 API(`obgyn/deliveries/*`)는 간호사에게 열려 있었지만 보드는 `/obgyn` 안에만 있었고,
 *    `/obgyn` 은 의사·관리자 메뉴인 데다 간호사에게는 전문과 메뉴를 숨긴다 — 분만실 간호사가 진통 기록·신생아 등록·
 *    모아 대조를 할 화면이 없었다. 같은 부품을 간호 메뉴에 둔다(산부인과 진료 화면의 의사 전용 조회는 부르지 않는다).
 */
export default function NurseDeliveryBoardPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="분만 현황" />
      <p className="text-xs text-gray-500"><T k="진통·분만·산욕 환자 — 진행 기록·신생아 등록·모아 대조" /></p>
      <p className="text-xs text-gray-500"><T k="산부인과 진료 기록은 산부인과 화면(의사)에서 봅니다" /></p>
      <DeliveryBoard />
    </div>
  );
}
