'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { formatNum } from '@hospital-run/shared';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { money } from '@/lib/ui-settings';

import { EmptyState, Money } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

// ── Interfaces ──

type CenterType = 'DIRECT_CARE' | 'SUPPORT' | 'ADMIN';
type DriverCategory = 'LABOR' | 'MATERIAL' | 'OVERHEAD' | 'DEPRECIATION' | 'UTILITY';
type AllocationStatus = 'PENDING' | 'ALLOCATED' | 'LOCKED';

interface CostCenter {
  id: string;
  code: string;
  name: string;
  type: CenterType;
  department: string;
  parentId: string | null;
  isActive: boolean;
  children?: CostCenter[];
  createdAt: string;
}

interface CostDriver {
  id: string;
  name: string;
  category: DriverCategory;
  unitCost: number;
  unit: string;
  period: string;
}

interface Allocation {
  id: string;
  costCenterId: string;
  costCenterName: string;
  driverId: string;
  driverName: string;
  category: DriverCategory;
  quantity: number;
  totalCost: number;
  period: string;
  status: AllocationStatus;
}

interface ProcedureCost {
  id: string;
  procedureCode: string;
  procedureName: string;
  directCost: number;
  indirectCost: number;
  totalCost: number;
  revenueAvg: number;
  margin: number;
  volumeCount: number;
  period: string;
}

interface DeptAnalytics {
  department: string;
  totalCost: number;
  /** 🔴 진료과별 매출 귀속 경로가 없어 산출 불가 — 0 으로 채우면 전 부서가 마진율 -100% 로 보인다 */
  totalRevenue: number | null;
  margin: number | null;
  marginRate: number | null;
  allocationCount?: number;
  procedureCount?: number;
  rank?: number;
}

interface PeriodTrend {
  period: string;
  totalCost: number;
  count?: number;
  totalRevenue?: number | null;
  margin?: number | null;
  marginRate?: number | null;
}

interface DashboardSummary {
  period: string;
  departments: DeptAnalytics[];
  trends: PeriodTrend[];
  overallCost: number;
  overallRevenue: number | null;
  overallMargin: number | null;
  /** 배분 실행 여부 — '아직 안 돌렸다'와 '원가가 0원이다'는 다른 사실이다 */
  allocationCount: number;
  revenueAvailable: boolean;
  departmentRevenueAvailable: boolean;
  departmentRevenueReason?: string;
}

interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// ── Constants ──

const TABS = [
  { key: 'centers', label: '원가 센터' },
  { key: 'allocation', label: '비용 배분' },
  { key: 'procedure', label: '행위별 원가' },
  { key: 'actual', label: '실제손익' },
  { key: 'dashboard', label: '경영 대시보드' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const CENTER_TYPE_BADGE: Record<CenterType, string> = {
  DIRECT_CARE: 'bg-blue-50 text-blue-700',
  SUPPORT: 'bg-amber-50 text-amber-700',
  ADMIN: 'bg-gray-100 text-gray-600',
};

const CENTER_TYPE_LABEL: Record<CenterType, string> = {
  DIRECT_CARE: '직접진료',
  SUPPORT: '지원부서',
  ADMIN: '관리부서',
};

const DRIVER_CATEGORY_BADGE: Record<DriverCategory, string> = {
  LABOR: 'bg-blue-50 text-blue-700',
  MATERIAL: 'bg-emerald-50 text-emerald-700',
  OVERHEAD: 'bg-purple-50 text-purple-700',
  DEPRECIATION: 'bg-rose-50 text-rose-600',
  UTILITY: 'bg-teal-50 text-teal-700',
};

const DRIVER_CATEGORY_LABEL: Record<DriverCategory, string> = {
  LABOR: '인건비',
  MATERIAL: '재료비',
  OVERHEAD: '간접비',
  DEPRECIATION: '감가상각',
  UTILITY: '공공요금',
};

const ALLOCATION_STATUS_BADGE: Record<AllocationStatus, string> = {
  PENDING: 'bg-yellow-50 text-yellow-700',
  ALLOCATED: 'bg-emerald-50 text-emerald-700',
  LOCKED: 'bg-gray-200 text-gray-600',
};

const ALLOCATION_STATUS_LABEL: Record<AllocationStatus, string> = {
  PENDING: '대기',
  ALLOCATED: '배분완료',
  LOCKED: '확정',
};

const CENTER_TYPES: CenterType[] = ['DIRECT_CARE', 'SUPPORT', 'ADMIN'];
const DRIVER_CATEGORIES: DriverCategory[] = ['LABOR', 'MATERIAL', 'OVERHEAD', 'DEPRECIATION', 'UTILITY'];

// 부서 목록 정본 = 마스터(useDepartments·전 카테고리 — 원가센터는 지원·행정 부서도 갖는다)

function currentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function generatePeriodOptions(): string[] {
  const periods: string[] = [];
  const now = new Date();
  const year = now.getFullYear();
  for (let y = year - 1; y <= year; y++) {
    for (let q = 1; q <= 4; q++) {
      if (y === year && q > Math.ceil((now.getMonth() + 1) / 3)) break;
      periods.push(`${y}-Q${q}`);
    }
  }
  return periods.reverse();
}

// ── Helper ──

function unwrap<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as ApiResponse<T>).data;
  }
  return raw as T;
}

function formatWon(value: number): string {
  return value.toLocaleString() + '원';
}

function formatMarginRate(rate: number): string {
  return (rate >= 0 ? '+' : '') + formatNum(rate, 'percent', { unit: false }) + '%';
}

// ── Modal Shell ──

function Modal({ open, onClose, title, children, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`bg-white rounded-2xl shadow-xl mx-4 max-h-[85vh] overflow-y-auto ${wide ? 'w-full max-w-2xl' : 'w-full max-w-lg'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900"><T k={title} /></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-gray-700 mb-1">
      <T k={label} />
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

// ── Tab 1: 원가 센터 ──

function CostCentersTab() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', type: 'DIRECT_CARE' as CenterType, department: '' });
  const [form, setForm] = useState({ code: '', name: '', type: 'DIRECT_CARE' as CenterType, department: '', parentId: '' });

  const { data: centers = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: async () => unwrap<CostCenter[]>(await apiClient.fetch('/api/v1/cost/centers')),
  });

  // 부서 목록 = 마스터(전 카테고리) ∪ 기존 센터의 부서 ∪ 폼 현재값 — 마스터 밖 어휘가 사라지지 않게
  const { names: departments, isError: deptListError, refetch: refetchDepts } = useDepartments({ include: [...centers.map((c) => c.department), editForm.department, form.department] });

  const createMut = useMutation({
    mutationFn: (body: typeof form) =>
      apiClient.fetch('/api/v1/cost/centers', {
        method: 'POST',
        body: JSON.stringify({ ...body, parentId: body.parentId || null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
      toast.success('원가 센터가 추가되었습니다.');
      setShowAdd(false);
      setForm({ code: '', name: '', type: 'DIRECT_CARE', department: '', parentId: '' });
    },
    onError: () => toast.error('원가 센터 추가에 실패했습니다.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CostCenter> }) =>
      // 🔴 서버는 `PUT /cost/centers/:id` 다 — PATCH 는 라우트가 없어 404 였다(운영 실측)
      apiClient.fetch(`/api/v1/cost/centers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
      toast.success('원가 센터가 수정되었습니다.');
      setEditingId(null);
    },
    onError: () => toast.error('수정에 실패했습니다.'),
  });

  function startEdit(c: CostCenter) {
    setEditingId(c.id);
    setEditForm({ code: c.code, name: c.name, type: c.type, department: c.department });
  }

  function saveEdit(id: string) {
    updateMut.mutate({ id, body: editForm });
  }

  // Build tree structure
  function buildTree(items: CostCenter[]): CostCenter[] {
    const map = new Map<string, CostCenter>();
    const roots: CostCenter[] = [];
    items.forEach((item) => map.set(item.id, { ...item, children: [] }));
    items.forEach((item) => {
      const node = map.get(item.id)!;
      if (item.parentId && map.has(item.parentId)) {
        map.get(item.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  function renderTree(nodes: CostCenter[], depth: number): React.ReactNode {
    return nodes.map((c) => (
      <div key={c.id}>
        {editingId === c.id ? (
          <div className="flex items-center gap-2 py-2 px-4 bg-blue-50/50 border-b border-gray-100" style={{ paddingLeft: `${depth * 24 + 16}px` }}>
            <input
              className="w-24 px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-300"
              value={editForm.code}
              onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))}
              placeholder={tAttr('코드')}
            />
            <input
              className="flex-1 px-2 py-1 text-xs border rounded focus:ring-1 focus:ring-blue-300"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={tAttr('명칭')}
            />
            <select
              className="w-24 px-2 py-1 text-xs border rounded"
              value={editForm.type}
              onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as CenterType }))}
            >
              {CENTER_TYPES.map((t) => (
                <option key={t} value={t}>{tAttr(CENTER_TYPE_LABEL[t])}</option>
              ))}
            </select>
            <select
              className="w-28 px-2 py-1 text-xs border rounded"
              value={editForm.department}
              onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
            >
              <option value="">{tAttr('부서 선택')}</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {deptListError && <DeptLoadError onRetry={refetchDepts} />}
            <button
              onClick={() => saveEdit(c.id)}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <T k="저장" />
            </button>
            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">
              <T k="취소" />
            </button>
          </div>
        ) : (
          <div
            className="flex items-center gap-3 py-2.5 px-4 border-b border-gray-50 hover:bg-gray-50/80 cursor-pointer group"
            style={{ paddingLeft: `${depth * 24 + 16}px` }}
            onClick={() => startEdit(c)}
          >
            {depth > 0 && <span className="text-gray-300 text-xs">{'└'}</span>}
            <span className="text-xs font-mono text-gray-500 w-20">{c.code}</span>
            <span className="flex-1 text-sm text-gray-900">{c.name}</span>
            <Badge className={CENTER_TYPE_BADGE[c.type]}><T k={CENTER_TYPE_LABEL[c.type]} /></Badge>
            <span className="text-xs text-gray-500 w-28 text-right">{c.department}</span>
            <button
              className="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800 transition-opacity"
              onClick={(e) => { e.stopPropagation(); startEdit(c); }}
            >
              <T k="편집" />
            </button>
          </div>
        )}
        {c.children && c.children.length > 0 && renderTree(c.children, depth + 1)}
      </div>
    ));
  }

  const tree = buildTree(centers);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500"><T k="원가 센터를 관리합니다. 행을 클릭하면 인라인 편집이 가능합니다." /></p>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          <T k="센터 추가" />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 py-2 px-4 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
          <span className="w-20"><T k="코드" /></span>
          <span className="flex-1"><T k="센터명" /></span>
          <span className="w-20 text-center"><T k="유형" /></span>
          <span className="w-28 text-right"><T k="부서" /></span>
          <span className="w-12" />
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400"><T k="로딩중..." /></div>
        ) : centers.length === 0 ? (
          <EmptyState icon="📋" title="등록된 원가 센터가 없습니다." />
        ) : (
          renderTree(tree, 0)
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="원가 센터 추가">
        <div className="space-y-4">
          <div>
            <FieldLabel label="센터 코드" required />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="CC-001"
            />
          </div>
          <div>
            <FieldLabel label="센터명" required />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="내과 병동"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel label="유형" required />
              <select
                className="w-full px-3 py-2 text-sm border rounded-lg"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CenterType }))}
              >
                {CENTER_TYPES.map((t) => (
                  <option key={t} value={t}>{tAttr(CENTER_TYPE_LABEL[t])}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="부서" required />
              <select
                className="w-full px-3 py-2 text-sm border rounded-lg"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              >
                <option value="">{tAttr('선택')}</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {deptListError && <DeptLoadError onRetry={refetchDepts} />}
            </div>
          </div>
          <div>
            <FieldLabel label="상위 센터 (선택)" />
            <select
              className="w-full px-3 py-2 text-sm border rounded-lg"
              value={form.parentId}
              onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}
            >
              <option value="">{tAttr('없음 (최상위)')}</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
              <T k="취소" />
            </button>
            <button
              onClick={() => createMut.mutate(form)}
              disabled={!form.code || !form.name || !form.department || createMut.isPending}
              className="min-h-[44px] px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <T k={createMut.isPending ? '저장 중...' : '추가'} />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Tab 2: 비용 배분 ──

function AllocationTab() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentQuarter);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    costCenterId: '',
    driverId: '',
    quantity: 0,
  });

  const periodOptions = generatePeriodOptions();

  const { data: drivers = [], isLoading: driversLoading } = useQuery({
    queryKey: ['cost-drivers', period],
    queryFn: async () => unwrap<CostDriver[]>(await apiClient.fetch('/api/v1/cost/drivers', { params: { period } })),
  });

  const { data: allocations = [], isLoading: allocLoading } = useQuery({
    queryKey: ['cost-allocations', period],
    queryFn: async () => unwrap<Allocation[]>(await apiClient.fetch('/api/v1/cost/allocations', { params: { period } })),
  });

  const { data: centers = [] } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: async () => unwrap<CostCenter[]>(await apiClient.fetch('/api/v1/cost/centers')),
  });

  const autoAllocMut = useMutation({
    mutationFn: () =>
      apiClient.fetch('/api/v1/cost/allocations/auto', { method: 'POST', body: JSON.stringify({ period }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-allocations', period] });
      toast.success('자동 배분이 완료되었습니다.');
    },
    onError: () => toast.error('자동 배분에 실패했습니다.'),
  });

  const manualAllocMut = useMutation({
    mutationFn: (body: typeof manualForm) =>
      apiClient.fetch('/api/v1/cost/allocations', {
        method: 'POST',
        body: JSON.stringify({ ...body, period }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-allocations', period] });
      toast.success('수동 배분이 등록되었습니다.');
      setShowManual(false);
      setManualForm({ costCenterId: '', driverId: '', quantity: 0 });
    },
    onError: () => toast.error('수동 배분에 실패했습니다.'),
  });

  const totalAllocated = allocations.reduce((sum, a) => sum + a.totalCost, 0);

  return (
    <div className="space-y-6">
      {/* Period + Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700"><T k="기간" /></label>
          <select
            className="px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500"><T k="총 배분액" />: <strong className="text-gray-900">{formatWon(totalAllocated)}</strong></span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowManual(true)}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
          >
            <T k="수동 배분" />
          </button>
          <button
            onClick={() => autoAllocMut.mutate()}
            disabled={autoAllocMut.isPending}
            className="min-h-[44px] px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
          >
            <T k={autoAllocMut.isPending ? '배분 중...' : '자동 배분'} />
          </button>
        </div>
      </div>

      {/* Cost Drivers */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="원가 동인 (Cost Drivers)" /></h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="동인명" /></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="분류" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="단위원가" /></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="단위" /></th>
              </tr>
            </thead>
            <tbody>
              {driversLoading ? (
                <tr><td colSpan={4} className="py-8 text-center text-gray-400"><T k="로딩중..." /></td></tr>
              ) : drivers.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-gray-400"><T k="등록된 원가 동인이 없습니다." /></td></tr>
              ) : (
                drivers.map((d) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-gray-900">{d.name}</td>
                    <td className="px-4 py-2">
                      <Badge className={DRIVER_CATEGORY_BADGE[d.category]}><T k={DRIVER_CATEGORY_LABEL[d.category]} /></Badge>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-800">{formatWon(d.unitCost)}</td>
                    <td className="px-4 py-2 text-gray-500">{d.unit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocation Results */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="배분 결과" /></h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="원가 센터" /></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="동인" /></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="분류" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="수량" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="배분액" /></th>
                <th className="text-center px-4 py-2 font-medium text-gray-500"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {allocLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400"><T k="로딩중..." /></td></tr>
              ) : allocations.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400"><T k="배분 내역이 없습니다." /></td></tr>
              ) : (
                allocations.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-gray-900">{a.costCenterName}</td>
                    <td className="px-4 py-2 text-gray-700">{a.driverName}</td>
                    <td className="px-4 py-2">
                      <Badge className={DRIVER_CATEGORY_BADGE[a.category]}><T k={DRIVER_CATEGORY_LABEL[a.category]} /></Badge>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-gray-700">{a.quantity.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium text-gray-900">{formatWon(a.totalCost)}</td>
                    <td className="px-4 py-2 text-center">
                      <Badge className={ALLOCATION_STATUS_BADGE[a.status]}><T k={ALLOCATION_STATUS_LABEL[a.status]} /></Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Allocation Modal */}
      <Modal open={showManual} onClose={() => setShowManual(false)} title="수동 배분">
        <div className="space-y-4">
          <div>
            <FieldLabel label="원가 센터" required />
            <select
              className="w-full px-3 py-2 text-sm border rounded-lg"
              value={manualForm.costCenterId}
              onChange={(e) => setManualForm((f) => ({ ...f, costCenterId: e.target.value }))}
            >
              <option value="">{tAttr('선택')}</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel label="원가 동인" required />
            <select
              className="w-full px-3 py-2 text-sm border rounded-lg"
              value={manualForm.driverId}
              onChange={(e) => setManualForm((f) => ({ ...f, driverId: e.target.value }))}
            >
              <option value="">{tAttr('선택')}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({tAttr(DRIVER_CATEGORY_LABEL[d.category])})</option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel label="수량" required />
            <input
              type="number"
              className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200"
              value={manualForm.quantity || ''}
              onChange={(e) => setManualForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              placeholder="0"
              min={0}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowManual(false)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">
              <T k="취소" />
            </button>
            <button
              onClick={() => manualAllocMut.mutate(manualForm)}
              disabled={!manualForm.costCenterId || !manualForm.driverId || manualForm.quantity <= 0 || manualAllocMut.isPending}
              className="min-h-[44px] px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <T k={manualAllocMut.isPending ? '저장 중...' : '배분'} />
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Tab 3: 행위별 원가 ──

function ProcedureCostTab() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentQuarter);
  const periodOptions = generatePeriodOptions();

  const { data: procedures = [], isLoading } = useQuery({
    queryKey: ['procedure-costs', period],
    queryFn: async () => unwrap<ProcedureCost[]>(await apiClient.fetch('/api/v1/cost/procedure-costs', { params: { period } })),
  });

  const calculateMut = useMutation({
    mutationFn: () =>
      apiClient.fetch('/api/v1/cost/procedure-costs/calculate', { method: 'POST', body: JSON.stringify({ period }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['procedure-costs', period] });
      toast.success('원가 산출이 완료되었습니다.');
    },
    onError: () => toast.error('원가 산출에 실패했습니다.'),
  });

  const totalDirectCost = procedures.reduce((s, p) => s + p.directCost, 0);
  const totalIndirectCost = procedures.reduce((s, p) => s + p.indirectCost, 0);
  const totalCost = procedures.reduce((s, p) => s + p.totalCost, 0);
  const totalRevenue = procedures.reduce((s, p) => s + p.revenueAvg * p.volumeCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700"><T k="기간" /></label>
          <select
            className="px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periodOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => calculateMut.mutate()}
          disabled={calculateMut.isPending}
          className="min-h-[44px] px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          <T k={calculateMut.isPending ? '산출 중...' : '원가 산출'} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1"><T k="직접 원가 합계" /></p>
          <p className="text-lg font-bold text-gray-900">{formatWon(totalDirectCost)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1"><T k="간접 원가 합계" /></p>
          <p className="text-lg font-bold text-gray-900">{formatWon(totalIndirectCost)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1"><T k="총 원가" /></p>
          <p className="text-lg font-bold text-gray-900">{formatWon(totalCost)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1"><T k="총 수익" /></p>
          <p className="text-lg font-bold text-blue-700">{formatWon(totalRevenue)}</p>
        </div>
      </div>

      {/* Procedure table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="행위코드" /></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="행위명" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="직접원가" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="간접원가" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="총원가" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="평균수익" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="마진" /></th>
                <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="건수" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400"><T k="로딩중..." /></td></tr>
              ) : procedures.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400"><T k="원가 데이터가 없습니다. '원가 산출' 버튼을 눌러 산출하세요." /></td></tr>
              ) : (
                procedures.map((p) => {
                  const marginRate = p.totalCost > 0 ? ((p.margin / p.totalCost) * 100) : 0;
                  return (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-gray-600">{p.procedureCode}</td>
                      <td className="px-4 py-2 text-gray-900">{p.procedureName}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{formatWon(p.directCost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{formatWon(p.indirectCost)}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium text-gray-900">{formatWon(p.totalCost)}</td>
                      <td className="px-4 py-2 text-right font-mono text-blue-700">{formatWon(p.revenueAvg)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${p.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatWon(p.margin)}
                        <span className="text-xs ml-1">({formatMarginRate(marginRate)})</span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-700">{p.volumeCount.toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: 경영 대시보드 ──

interface ActualProfitRow {
  procedureCode: string; procedureName: string; unitCost: number; standardRevenueAvg: number;
  actualRevenuePerCase: number; actualVolume: number; actualRevenue: number; periodCost: number;
  actualMargin: number; standardMargin: number; marginVariance: number;
}
interface ActualProfitResult { period: string; rows: ActualProfitRow[]; summary: { totalRevenue: number; totalCost: number; totalMargin: number } }

function ActualProfitabilityTab() {
  const tAttr = useTAttr();
  const [period, setPeriod] = useState(currentQuarter);
  const periodOptions = generatePeriodOptions();
  const { data, isLoading } = useQuery({
    queryKey: ['cost-actual-profit', period],
    queryFn: async () => unwrap<ActualProfitResult>(await apiClient.fetch('/api/v1/cost/analytics/actual-profitability', { params: { period } })),
  });
  const exportMut = useMutation({
    mutationFn: () => apiClient.fetch('/api/v1/cost/export-erp', { method: 'POST', body: JSON.stringify({ period }) }),
    onSuccess: () => toast.success('ERP 관리회계로 발행했습니다.'),
    onError: () => toast.error('ERP 연계에 실패했습니다.'),
  });
  const rows = data?.rows ?? [];
  const s = data?.summary;
  const pct = (v: number) => `${formatNum(v * 100, 'percent', { unit: false })}%`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
            {periodOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* 🔴 마크업으로 쪼개진 문장 — 조각 번역은 어순이 다른 언어에서 뜻이 갈린다(카탈로그 헤더 §③) */}
          <span className="text-xs text-gray-400">표준수가 대비 <b>실제 청구액</b> 기반 손익</span>
        </div>
        <button onClick={() => exportMut.mutate()} disabled={exportMut.isPending}
          className="min-h-[44px] px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40"><T k="ERP 관리회계 연계" /></button>
      </div>

      {s && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-xs text-gray-400"><T k="실제 수익" /></div><div className="text-lg font-bold text-blue-700"><Money value={s.totalRevenue} /></div></div>
          <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-xs text-gray-400"><T k="배부 원가" /></div><div className="text-lg font-bold text-gray-700"><Money value={s.totalCost} /></div></div>
          <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-xs text-gray-400"><T k="종합 마진" /></div><div className={`text-lg font-bold ${s.totalMargin < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{pct(s.totalMargin)}</div></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-50"><h3 className="text-sm font-semibold text-gray-800"><T k="행위별 실제손익 (저마진 우선)" /></h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-3 py-2 text-left"><T k="행위" /></th><th className="px-3 py-2 text-right"><T k="건수" /></th>
              <th className="px-3 py-2 text-right"><T k="단위원가" /></th><th className="px-3 py-2 text-right"><T k="실제수익/건" /></th>
              <th className="px-3 py-2 text-right"><T k="실제마진" /></th><th className="px-3 py-2 text-right"><T k="표준마진" /></th><th className="px-3 py-2 text-right"><T k="편차" /></th>
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400"><T k="불러오는 중…" /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400"><T k="해당 기간 원가/청구 데이터 없음" /></td></tr>
              : rows.map((r) => (
                <tr key={r.procedureCode} className="border-b border-gray-50">
                  <td className="px-3 py-2"><span className="font-mono text-gray-400">{r.procedureCode}</span> {r.procedureName}</td>
                  <td className="px-3 py-2 text-right">{r.actualVolume}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-600">{r.unitCost.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-600">{r.actualRevenuePerCase.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${r.actualMargin < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{pct(r.actualMargin)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{pct(r.standardMargin)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.marginVariance < 0 ? 'text-rose-500' : 'text-gray-500'}`}>{r.marginVariance >= 0 ? '+' : ''}{pct(r.marginVariance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DashboardTab() {
  const tAttr = useTAttr();
  const [period, setPeriod] = useState(currentQuarter);
  const periodOptions = generatePeriodOptions();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['cost-dashboard', period],
    queryFn: async () => unwrap<DashboardSummary>(await apiClient.fetch('/api/v1/cost/dashboard', { params: { period } })),
  });

  const departments = summary?.departments ?? [];
  const trends = summary?.trends ?? [];
  const overallCost = summary?.overallCost ?? null;
  const overallRevenue = summary?.overallRevenue ?? null;
  const overallMargin = summary?.overallMargin ?? null;
  const overallMarginRate =
    overallRevenue != null && overallRevenue > 0 && overallMargin != null
      ? (overallMargin / overallRevenue) * 100
      : null;
  /** 🔴 배분을 아직 안 돌린 것과 원가가 0원인 것은 다른 사실이다 */
  const notAllocated = !!summary && summary.allocationCount === 0;
  /** 산출 불가 표기 — 종전에는 호출이 404 여도 ₩0·0%(초록)로 그렸다 */
  const won = (v: number | null | undefined) => (v == null ? tAttr('산출 불가') : formatWon(v));
  const rate = (v: number | null | undefined) => (v == null ? tAttr('산출 불가') : formatMarginRate(v));
  const toneOf = (v: number | null | undefined, pos: string, neg: string) =>
    v == null ? 'text-gray-400' : v >= 0 ? pos : neg;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">기간</label>
        <select
          className="px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-200"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {periodOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400"><T k="로딩중..." /></div>
      ) : (
        <>
          {notAllocated && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <strong>{summary?.period}</strong> 기간에 <strong>배분된 원가가 없습니다</strong> —
              원가 0원이 아니라 <strong>비용 배분을 아직 실행하지 않은 상태</strong>입니다.
              ‘비용 배분’ 탭에서 먼저 배분을 실행하세요.
            </div>
          )}

          {/* Overview cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1"><T k="총 원가" /></p>
              <p className="text-xl font-bold text-gray-900">{won(overallCost)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1"><T k="총 수익" /></p>
              <p className="text-xl font-bold text-blue-700">{won(overallRevenue)}</p>
              {summary && !summary.revenueAvailable && (
                <p className="mt-1 text-[11px] text-gray-400"><T k="행위별 원가 미등재 — 실청구와 대조 불가" /></p>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1"><T k="순이익" /></p>
              <p className={`text-xl font-bold ${toneOf(overallMargin, 'text-emerald-600', 'text-red-600')}`}>
                {won(overallMargin)}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500 mb-1"><T k="마진율" /></p>
              <p className={`text-xl font-bold ${toneOf(overallMarginRate, 'text-emerald-600', 'text-red-600')}`}>
                {rate(overallMarginRate)}
              </p>
            </div>
          </div>

          {/* Department analytics cards */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1"><T k="부서별 원가 대 수익" /></h3>
            {summary && !summary.departmentRevenueAvailable && (
              <p className="mb-3 text-xs text-gray-400">
                진료과별 수익은 산출 불가 — {summary.departmentRevenueReason}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              {departments.slice(0, 9).map((dept) => (
                <div key={dept.department} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">{dept.department}</span>
                    <span className={`text-xs font-semibold ${toneOf(dept.marginRate, 'text-emerald-600', 'text-red-600')}`}>
                      {rate(dept.marginRate)}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-gray-500">
                    <div className="flex justify-between">
                      <span><T k="원가" /></span>
                      <span className="font-mono text-gray-700">{won(dept.totalCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span><T k="수익" /></span>
                      <span className="font-mono text-blue-700">{won(dept.totalRevenue)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Profitability Ranking */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="수익성 랭킹" /></h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-center px-4 py-2 font-medium text-gray-500 w-12"><T k="순위" /></th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="부서" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="원가" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="수익" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="마진" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="마진율" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="행위건수" /></th>
                  </tr>
                </thead>
                <tbody>
                  {departments.length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400"><T k="데이터가 없습니다." /></td></tr>
                  ) : (
                    [...departments]
                      // 🔴 마진율이 산출 불가면 순위를 매길 근거가 없다 — 원가 큰 순
                      .sort((a, b) => (b.marginRate ?? -Infinity) - (a.marginRate ?? -Infinity) || b.totalCost - a.totalCost)
                      .map((dept, idx) => (
                        <tr key={dept.department} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2 text-center">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                              idx === 1 ? 'bg-gray-200 text-gray-600' :
                              idx === 2 ? 'bg-orange-100 text-orange-700' :
                              'text-gray-400'
                            }`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-medium text-gray-900">{dept.department}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-700">{won(dept.totalCost)}</td>
                          <td className="px-4 py-2 text-right font-mono text-blue-700">{won(dept.totalRevenue)}</td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${toneOf(dept.margin, 'text-emerald-600', 'text-red-600')}`}>
                            {won(dept.margin)}
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold ${toneOf(dept.marginRate, 'text-emerald-600', 'text-red-600')}`}>
                            {rate(dept.marginRate)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-gray-700">
                            {(dept.allocationCount ?? dept.procedureCount)?.toLocaleString() ?? '-'}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Period Trend */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2"><T k="기간별 추이" /></h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2 font-medium text-gray-500"><T k="기간" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="총 원가" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="총 수익" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="순이익" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="마진율" /></th>
                    <th className="text-right px-4 py-2 font-medium text-gray-500"><T k="전기 대비" /></th>
                  </tr>
                </thead>
                <tbody>
                  {trends.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400"><T k="추이 데이터가 없습니다." /></td></tr>
                  ) : (
                    trends.map((t, idx) => {
                      const prev = idx < trends.length - 1 ? trends[idx + 1] : null;
                      // 🔴 마진율이 없는 기간끼리는 '전기 대비'도 없다 — 0%p 로 채우지 않는다
                      const marginDiff =
                        prev && t.marginRate != null && prev.marginRate != null
                          ? t.marginRate - prev.marginRate
                          : null;
                      return (
                        <tr key={t.period} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-2 font-medium text-gray-900">{t.period}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-700">{won(t.totalCost)}</td>
                          <td className="px-4 py-2 text-right font-mono text-blue-700">{won(t.totalRevenue)}</td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${toneOf(t.margin, 'text-emerald-600', 'text-red-600')}`}>
                            {won(t.margin)}
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold ${toneOf(t.marginRate, 'text-emerald-600', 'text-red-600')}`}>
                            {rate(t.marginRate)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {marginDiff != null ? (
                              <span className={`text-xs font-semibold ${marginDiff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {marginDiff >= 0 ? '+' : ''}{marginDiff.toFixed(1)}%p
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──

export default function CostAnalysisPage() {
  const [tab, setTab] = useState<TabKey>('centers');

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900"><T k="원가 분석 (ABC Costing)" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="활동기준원가 분석으로 행위별 원가를 산출하고 경영 의사결정을 지원합니다." /></p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'centers' && <CostCentersTab />}
      {tab === 'allocation' && <AllocationTab />}
      {tab === 'procedure' && <ProcedureCostTab />}
      {tab === 'actual' && <ActualProfitabilityTab />}
      {tab === 'dashboard' && <DashboardTab />}
    </div>
  );
}
