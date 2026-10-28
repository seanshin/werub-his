'use client';
import ApiStatsWidget from '../ApiStatsWidget';
import { patientFlowSummary } from '@/lib/widget-summaries';

// 🔴 서버 /api/v1/operational-stats/patient-flow 는 { newAdmissions, dischargedToday, activePatients, netFlow }.
//    위젯이 admitted·discharged 를 읽어 2칸 다 영구 '-' 였다(P11).
// 🔴 W9: 종전 `dischargedToday` 는 이름과 달리 기본 조회창(30일) 값이었다.
//    서버가 이름을 사실에 맞추고 창 값을 `dischargedInWindow` 로 분리했으므로 위젯은 창 값을 읽는다
//    (`widget-summaries.ts` 참조). 라벨의 "30일"이 이제 우회가 아니라 사실이다.
export default function PatientFlowWidget() {
  return <ApiStatsWidget widgetId="patient-flow" endpoint="/api/v1/operational-stats/patient-flow" transform={patientFlowSummary}
    stats={[
      { key: 'admitted', label: '입원(30일)', color: 'text-blue-600' },
      { key: 'discharged', label: '퇴원(30일)', color: 'text-emerald-600' },
      { key: 'active', label: '현재 재원' },
      { key: 'netFlow', label: '순증감(30일)', color: 'text-indigo-600' },
    ]} />;
}
