'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { bloodInventorySummary } from '@/lib/widget-summaries';

// 🔴 서버 /api/v1/blood-bank/inventory/stats 는 groupBy 배열 [{productType, bloodType, status, count}].
//    위젯이 totalUnits·aPositive·bPositive·oPositive 를 평면 키로 읽어 4칸 전부 영구 '-' 였다(P11).
// 🔴 A+/B+/O+ 는 이 응답으로 만들 수 없다 — groupBy 에 `rhFactor` 가 없어 bloodType 은 ABO(A·B·O·AB)뿐이다.
//    실측 A = POS 5 + NEG 1 인데 "A+ 6"이라 쓰면 수혈 적합성을 잘못 말한다 → Rh 를 참칭하지 않고 상태별로 답한다.
export default function BloodBankWidget() {
  return <ApiStatsWidget widgetId="blood-bank" endpoint="/api/v1/blood-bank/inventory/stats" transform={bloodInventorySummary}
    stats={[
      { key: 'availableUnits', label: '가용', color: 'text-red-600' },
      // 🔴 맨 키 `예약` 은 앞 카탈로그에서 'Appointment'(진료 예약) — 혈액 유닛의 예약은 '확보됨(Reserved)' 이다.
      //    같은 뜻의 문맥 키 `예약@병상`(Reserved) 을 쓴다(ko 표시는 `@` 앞만 — 종전과 같다).
      { key: 'reservedUnits', label: '예약@병상', color: 'text-amber-600' },
      { key: 'issuedUnits', label: '출고', color: 'text-gray-800' },
      { key: 'totalUnits', label: '총 유닛' },
    ]} />;
}
