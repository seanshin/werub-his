'use client';

import React from 'react';

import { T } from '@/components/ui/i18n-text';

/* ── Types ───────────────────────────────────────────────────────────────────── */

export interface DataTableColumn<T = any> {
  /** 데이터 객체의 키 */
  key: string;
  /** 테이블 헤더 레이블 */
  label: string;
  /** 커스텀 렌더러 */
  render?: (row: T) => React.ReactNode;
  /** 헤더 정렬 */
  align?: 'left' | 'center' | 'right';
}

export interface DataTableProps<T = any> {
  /** 컬럼 정의 */
  columns: DataTableColumn<T>[];
  /** 테이블 데이터 */
  data: T[];
  /** 행 클릭 핸들러 */
  onRowClick?: (row: T) => void;
  /** 데이터가 없을 때 메시지 */
  emptyMessage?: string;
  /** 추가 className */
  className?: string;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  emptyMessage = '데이터가 없습니다.',
  className = '',
}: DataTableProps<T>) {
  const alignCls = (a?: string) =>
    a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-semibold text-gray-600 ${alignCls(col.align)}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-12 text-gray-400">
                <T k={emptyMessage} />
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr
                key={idx}
                className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                  onRowClick ? 'cursor-pointer' : ''
                }`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 ${alignCls(col.align)}`}>
                    {col.render ? col.render(row) : (row[col.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
