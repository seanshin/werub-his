'use client';

import { useWidgetQuery } from '../../hooks/use-widget-query';
import WidgetForbidden from '../WidgetForbidden';
import { T } from '@/components/ui/i18n-text';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (value: any, row: any) => React.ReactNode;
}

interface ApiTableWidgetProps {
  widgetId: string;
  endpoint: string;
  columns: Column[];
  refetchInterval?: number;
  dataKey?: string; // nested data path (e.g. "items")
  emptyMessage?: string;
  maxRows?: number;
}

/** 범용 API 테이블 위젯 — endpoint → 테이블 자동 렌더링 */
export default function ApiTableWidget({
  widgetId, endpoint, columns, refetchInterval = 60000,
  dataKey, emptyMessage = '데이터 없음', maxRows = 10,
}: ApiTableWidgetProps) {
  const { data, isLoading, isForbidden, error } = useWidgetQuery<any>(
    ['widget', widgetId],
    endpoint,
    { refetchInterval },
  );

  if (isForbidden) return <WidgetForbidden widgetId={widgetId} />;
  if (isLoading) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k="로딩..." /></div>;
  // 🔴 조회 실패를 빈 표(=0행)로 만들지 않는다(P17)
  if (error) return <div className="flex items-center justify-center h-full text-xs text-red-600"><T k="조회 실패 — 확인 필요" /></div>;

  const rows: any[] = dataKey ? (data?.[dataKey] ?? []) : (Array.isArray(data) ? data : []);
  if (rows.length === 0) return <div className="flex items-center justify-center h-full text-xs text-gray-400"><T k={emptyMessage} /></div>;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-gray-100">
          {columns.map((col) => (
            <th key={col.key} className={`px-2 py-1.5 font-medium text-gray-500 text-${col.align ?? 'left'}`}>
              <T k={col.label} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, maxRows).map((row: any, i: number) => (
          <tr key={row.id ?? i} className="border-b border-gray-50 hover:bg-gray-50/50">
            {columns.map((col) => (
              <td key={col.key} className={`px-2 py-1.5 text-${col.align ?? 'left'}`}>
                {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
