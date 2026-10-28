'use client';
import ApiStatsWidget from '../ApiStatsWidget';
export default function InfectionWidget() {
  return <ApiStatsWidget widgetId="infection-dashboard" endpoint="/api/v1/infection-control/dashboard" stats={[{key:"overview.active",label:"활성 감염",color:"text-red-600"},{key:"overview.isolated",label:"격리 중",color:"text-amber-600"},{key:"overview.resolved",label:"해결@상태",color:"text-emerald-600"},{key:"overview.newToday",label:"오늘 신규"}]} />;
}
