'use client';

import { useWidgetQuery } from '../../hooks/use-widget-query';
import WidgetForbidden from '../WidgetForbidden';
import { T } from '@/components/ui/i18n-text';

interface ApiWidgetProps {
  widgetId: string;
  endpoint: string;
  render: (data: any) => React.ReactNode;
  refetchInterval?: number;
  emptyMessage?: string;
}

/** 범용 API 위젯 — endpoint 호출 후 render 함수로 표시 */
export default function ApiWidget({ widgetId, endpoint, render, refetchInterval = 60000, emptyMessage = '데이터 없음' }: ApiWidgetProps) {
  const { data, isLoading, isForbidden, error } = useWidgetQuery<any>(
    ['widget', widgetId],
    endpoint,
    { refetchInterval },
  );

  if (isForbidden) return <WidgetForbidden widgetId={widgetId} />;
  if (isLoading) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k="로딩..." /></div>;
  // 🔴 조회 실패를 '없음'으로 접지 않는다 — '응급 대기 없음'과 '응급 대기를 못 읽었다'는 다른 사실이다(P17)
  if (error) return <div className="flex items-center justify-center h-full text-xs text-red-600"><T k="조회 실패 — 확인 필요" /></div>;
  if (!data) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k={emptyMessage} /></div>;

  return <>{render(data)}</>;
}
