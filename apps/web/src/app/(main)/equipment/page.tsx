'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { LOG_TYPE_LABEL, LOG_STATUS_COLOR, LOG_STATUS_LABEL } from './components/constants';
import { InfoRow } from './components/shared';
import { EquipmentRegisterForm } from './components/EquipmentRegisterForm';
import { UsageLogTab } from './components/UsageLogTab';
import { InspectionLogTab } from './components/InspectionLogTab';
import { PartsTab } from './components/PartsTab';
import { EquipmentPartsSection, EquipmentUsageSection, EquipmentInspectionSection } from './components/EquipmentDetailSections';
import { MaintenanceLogModal } from './components/MaintenanceLogModal';
import type { Equipment, MaintenanceLog } from '@hospital-run/shared';
import { money, kdate } from '@/lib/ui-settings';

import { EmptyState, Money } from '@/components/ui/display';

/** 서버가 함께 실어 보내는 점검 기한 판정(가동 상태와 별개의 사실) */
interface InspectionFlags {
  inspectionOverdue?: boolean;
  inspectionDueInDays?: number | null;
}

interface EquipmentDetail extends Equipment, InspectionFlags {
  maintenanceLogs?: MaintenanceLog[];
}

interface EquipmentStats {
  byStatus: { status: string; _count: { id: number } }[];
  pendingAS: number;
  inspectionOverdue: number;
  inspectionDueSoon: number;
}

interface ApiWrapper<T> { data?: T }

type Tab = 'list' | 'maintenance' | 'usage' | 'inspection' | 'parts' | 'register';

export default function EquipmentPage() {
  const tAttr = useTAttr();
  const [tab, setTab] = useState<Tab>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLogForm, setShowLogForm] = useState(false);
  const qc = useQueryClient();

  const { data: equipList, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['equipment'],
    queryFn: () => apiClient.get<{ data: (Equipment & InspectionFlags)[] }>('/api/v1/equipment'),
  });
  const { data: statsData } = useQuery({
    queryKey: ['equipment-stats'],
    queryFn: () => apiClient.get<{ data: EquipmentStats }>('/api/v1/equipment/stats'),
  });
  const { data: logsData } = useQuery({
    queryKey: ['maintenance-logs'],
    queryFn: () => apiClient.get<{ data: MaintenanceLog[] }>('/api/v1/equipment/maintenance-logs'),
    enabled: tab === 'maintenance',
  });
  const { data: usageData } = useQuery({
    queryKey: ['usage-logs'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/equipment/usage-logs/all'),
    enabled: tab === 'usage',
  });
  const { data: inspData } = useQuery({
    queryKey: ['inspection-logs'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/equipment/inspection-logs/all'),
    enabled: tab === 'inspection',
  });
  const { data: lowStockData } = useQuery({
    queryKey: ['low-stock-parts'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/equipment/parts/low-stock'),
    enabled: tab === 'parts',
  });
  const { data: detailData } = useQuery({
    queryKey: ['equipment-detail', selectedId],
    queryFn: () => apiClient.get<{ data: EquipmentDetail }>(`/api/v1/equipment/${selectedId}`),
    enabled: !!selectedId,
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const _equipRaw = equipList?.data;
  const equipments: (Equipment & InspectionFlags)[] = Array.isArray(_equipRaw) ? _equipRaw : (_equipRaw as unknown as ApiWrapper<(Equipment & InspectionFlags)[]>)?.data ?? [];
  const stats = statsData?.data;
  const _logsRaw = logsData?.data;
  const logs: MaintenanceLog[] = Array.isArray(_logsRaw) ? _logsRaw : (_logsRaw as unknown as ApiWrapper<MaintenanceLog[]>)?.data ?? [];
  const detail = detailData?.data;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="의료장비 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="장비 등록, 정비/A/S, 점검 관리 (의공팀)" /></p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {stats.byStatus.map((s: { status: string; _count: { id: number } }) => (
            <div key={s.status} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-lg font-bold text-gray-900">{s._count.id}</p>
              <div className="mt-0.5"><StatusBadge domain="equipment" status={s.status} /></div>
            </div>
          ))}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-lg font-bold text-blue-700">{stats.pendingAS}</p>
            <p className="text-[11px] font-medium text-blue-600"><T k="진행중 A/S" /></p>
          </div>
          {/* 🔴 점검 기한 경과는 가동 상태와 별개다 — 상태가 전부 '가동중'이라 화면에서 사라져 있었다 */}
          <div className={`rounded-xl border px-4 py-3 ${stats.inspectionOverdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className={`text-lg font-bold ${stats.inspectionOverdue > 0 ? 'text-red-700' : 'text-gray-500'}`}>{stats.inspectionOverdue}</p>
            <p className={`text-[11px] font-medium ${stats.inspectionOverdue > 0 ? 'text-red-600' : 'text-gray-500'}`}><T k="점검 기한 경과" /></p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-lg font-bold text-amber-700">{stats.inspectionDueSoon}</p>
            <p className="text-[11px] font-medium text-amber-600"><T k="30일 내 점검" /></p>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {[
          { id: 'list' as Tab, label: '장비 목록' },
          { id: 'maintenance' as Tab, label: '정비/A/S' },
          { id: 'usage' as Tab, label: '사용일지' },
          { id: 'inspection' as Tab, label: '점검일지' },
          { id: 'parts' as Tab, label: '부품재고' },
          { id: 'register' as Tab, label: '장비 등록' },
        ].map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setSelectedId(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          ><T k={t.label} /></button>
        ))}
      </div>

      {/* ── 장비 목록 탭 ── */}
      {tab === 'list' && !selectedId && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="자산번호" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="제조사/모델" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="분류" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="위치" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="공급업체" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="보증만료" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={8} className="px-4 py-3"><div className="h-4 w-full bg-gray-100 rounded-lg animate-pulse" /></td></tr>
                ))
              ) : equipments.map((e: Equipment & InspectionFlags) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer" onClick={() => setSelectedId(e.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{e.assetNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.name}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{[e.manufacturer, e.model].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{e.category}</td>
                  <td className="px-4 py-3 text-gray-600">{e.location ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{e.supplierName ?? '-'}</td>
                  <td className="px-4 py-3 text-xs tabular-nums text-gray-500">
                    {e.warrantyExpiry ? kdate(e.warrantyExpiry) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge domain="equipment" status={e.status} />
                      {e.inspectionOverdue && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 whitespace-nowrap">
                          <T k="점검" /> {Math.abs(e.inspectionDueInDays ?? 0)}<T k="일 경과" />
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 장비 상세 ── */}
      {tab === 'list' && selectedId && detail && (
        <div>
          <button onClick={() => setSelectedId(null)} className="text-sm text-blue-600 hover:text-blue-700 mb-4 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            <T k="목록으로" />
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {/* 장비 정보 */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">{detail.name}</h3>
                <div className="flex items-center gap-1.5">
                  <StatusBadge domain="equipment" status={detail.status} />
                  {detail.inspectionOverdue && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 whitespace-nowrap">
                      <T k="점검 기한 경과" />
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <InfoRow label="자산번호" value={detail.assetNumber} />
                <InfoRow label="분류" value={detail.category} />
                <InfoRow label="제조사" value={detail.manufacturer} />
                <InfoRow label="모델" value={detail.model} />
                <InfoRow label="시리얼번호" value={detail.serialNumber} />
                <InfoRow label="위치" value={detail.location} />
                <InfoRow label="구매일" value={detail.purchaseDate ? kdate(detail.purchaseDate) : '-'} />
                <InfoRow label="구매금액" value={detail.purchasePrice ? `${money(detail.purchasePrice)}` : '-'} />
                <InfoRow label="보증만료" value={detail.warrantyExpiry ? kdate(detail.warrantyExpiry) : '-'} />
                <InfoRow
                  label="다음점검"
                  value={detail.nextInspection
                    ? `${kdate(detail.nextInspection)}${detail.inspectionOverdue ? ` (${Math.abs(detail.inspectionDueInDays ?? 0)}일 경과)` : ''}`
                    : '미지정'}
                />
              </div>
              {detail.notes && <p className="mt-3 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">{detail.notes}</p>}
            </div>

            {/* 공급업체/A/S 정보 */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="공급업체 / A/S" /></h3>
              <div className="space-y-3 text-sm">
                <InfoRow label="공급업체" value={detail.supplierName} />
                <InfoRow label="담당자" value={detail.supplierContact} />
                <InfoRow label="연락처" value={detail.supplierPhone} />
                <div className="border-t border-gray-100 pt-3 mt-3">
                  <InfoRow label="A/S 담당" value={detail.asContactName} />
                  <InfoRow label="A/S 연락처" value={detail.asContactPhone} />
                </div>
              </div>
              <button
                onClick={() => setShowLogForm(true)}
                className="mt-4 w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors"
              >
                <T k="정비/A/S 기록 추가" />
              </button>
            </div>
          </div>

          {/* 정비 이력 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4"><T k="정비/A/S 이력" /></h3>
            {detail.maintenanceLogs?.length === 0 ? (
              <EmptyState icon="📝" title="정비 이력이 없습니다." />
            ) : (
              <div className="space-y-3">
                {detail.maintenanceLogs?.map((log: MaintenanceLog) => (
                  <div key={log.id} className="border border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><T k={LOG_TYPE_LABEL[log.type] ?? log.type} /></span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${LOG_STATUS_COLOR[log.status] ?? 'bg-gray-100 text-gray-500'}`}><T k={LOG_STATUS_LABEL[log.status] ?? log.status} /></span>
                      </div>
                      <span className="text-xs text-gray-400 tabular-nums">{kdate(new Date(log.performedAt))}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-1">{log.description}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {log.performedBy && <span><T k="수행:" /> {log.performedBy}</span>}
                      {log.vendor && <span><T k="업체:" /> {log.vendor}</span>}
                      {log.cost != null && <span><T k="비용:" /> <Money value={log.cost} /></span>}
                      {log.partReplaced && <span><T k="교체부품:" /> {log.partReplaced}</span>}
                    </div>
                    {log.resultNotes && <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded-lg px-3 py-2">{log.resultNotes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 부품 재고 */}
          <EquipmentPartsSection equipmentId={selectedId} />

          {/* 사용일지 */}
          <EquipmentUsageSection equipmentId={selectedId} />

          {/* 점검일지 */}
          <EquipmentInspectionSection equipmentId={selectedId} />

          {/* 정비 기록 추가 모달 */}
          {showLogForm && <MaintenanceLogModal equipmentId={selectedId} onClose={() => { setShowLogForm(false); qc.invalidateQueries({ queryKey: ['equipment-detail', selectedId] }); }} />}
        </div>
      )}

      {/* ── 정비/A/S 이력 탭 ── */}
      {tab === 'maintenance' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="설명" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="업체/수행자" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500"><T k="비용" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="일자" /></th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm"><T k="정비 이력 없음" /></td></tr>
              ) : logs.map((log: MaintenanceLog) => (
                <tr key={log.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-xs">{log.equipment?.name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{log.equipment?.assetNumber}</p>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"><T k={LOG_TYPE_LABEL[log.type] ?? log.type} /></span></td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${LOG_STATUS_COLOR[log.status]}`}><T k={LOG_STATUS_LABEL[log.status] ?? log.status} /></span></td>
                  <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{log.description}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{log.vendor || log.performedBy || '-'}</td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums text-xs">{log.cost != null ? `${money(log.cost)}` : '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{kdate(new Date(log.performedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 사용일지 탭 ── */}
      {tab === 'usage' && (
        <UsageLogTab equipments={equipments} data={(Array.isArray(usageData?.data) ? usageData.data : (usageData?.data as unknown as ApiWrapper<unknown[]>)?.data ?? []) as never[]} onRefresh={() => qc.invalidateQueries({ queryKey: ['usage-logs'] })} />
      )}

      {/* ── 점검일지 탭 ── */}
      {tab === 'inspection' && (
        <InspectionLogTab equipments={equipments} data={(Array.isArray(inspData?.data) ? inspData.data : (inspData?.data as unknown as ApiWrapper<unknown[]>)?.data ?? []) as never[]} onRefresh={() => qc.invalidateQueries({ queryKey: ['inspection-logs'] })} />
      )}

      {/* ── 부품재고 탭 ── */}
      {tab === 'parts' && (
        <PartsTab equipments={equipments} lowStockData={(Array.isArray(lowStockData?.data) ? lowStockData.data : (lowStockData?.data as unknown as ApiWrapper<unknown[]>)?.data ?? []) as never[]} onRefresh={() => qc.invalidateQueries({ queryKey: ['low-stock-parts'] })} />
      )}

      {/* ── 장비 등록 탭 ── */}
      {tab === 'register' && <EquipmentRegisterForm onSuccess={() => { setTab('list'); qc.invalidateQueries({ queryKey: ['equipment'] }); }} />}
    </div>
  );
}
