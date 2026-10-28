'use client';

import PageHeader from '@/components/ui/PageHeader';
import { T } from '@/components/ui/i18n-text';
import SeclusionRestraintSection from '../../psychiatry/SeclusionRestraintSection';

/**
 * 간호 — §75 격리·강박 감시(2026-10-10).
 *
 * 🔴 관찰 기록·해제 API 는 간호사에게 열려 있었는데 현황은 `/psychiatry`(의사·관리자 메뉴 · 간호사에게 전문과 메뉴 숨김) 안에만
 *    있었다 — 1시간 관찰을 실제로 하는 병동 간호사가 법정시간 초과·관찰 지연을 볼 화면이 없었다.
 *    지시·연장은 의사만(서버 @Roles) — 부품이 역할에 따라 그 버튼을 숨긴다.
 */
export default function NurseSeclusionPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="격리·강박 감시" />
      <p className="text-xs text-gray-500"><T k="정신건강복지법 §75 — 법정시간·관찰 지연·관찰 기록·해제" /></p>
      <SeclusionRestraintSection />
    </div>
  );
}
