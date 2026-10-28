'use client';
import ApiStatsWidget from '../ApiStatsWidget';

// 🔴 서버 /api/v1/dashboard/lab/stats 는 { total, pending, inProgress, completed, cancelled, completionRate }.
//    위젯이 `ordered` 를 읽었는데 그런 키가 없어 '의뢰' 칸이 영구 '-' 였다(P11) → `pending`(대기)로 잇는다.
export default function LabStatsWidget() {
  return <ApiStatsWidget widgetId="lab-stats" endpoint="/api/v1/dashboard/lab/stats" stats={[{key:"pending",label:"대기",color:"text-blue-600"},{key:"inProgress",label:"진행",color:"text-amber-600"},{key:"completed",label:"완료",color:"text-emerald-600"},{key:"total",label:"전체"}]} />;
}
