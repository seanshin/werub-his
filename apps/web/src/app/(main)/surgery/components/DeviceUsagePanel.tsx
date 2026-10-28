'use client';

// 삽입 기기(UDI) 구획 — gap-remediation R5. 수술 상세(/surgery/[id])에 부착.
// 서버 계약: POST /api/v1/device-usage/scan(파싱 미리보기·저장 0) → POST /api/v1/device-usage(기록)
//           GET /api/v1/device-usage/patient/:patientId → { items, total, caveat } (최근 200건 절단·신호 없음)
// 🔴 Op Note 의 '삽입물' 자유 텍스트(Surgery.implants)와는 별개 원장이다 — 이 패널이 UDI 정본.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface DeviceUsageRow {
  id: string;
  surgeryId?: string | null;
  gtin?: string | null;
  gtinValid?: boolean | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  expiryDate?: string | null;
  expiryDayUnknown?: boolean;
  deviceName: string;
  manufacturer?: string | null;
  usageType: string;
  quantity: number;
  usedAt: string;
}

interface ScanResult {
  gtin?: string | null;
  gtinValid?: boolean | null;
  lot?: string | null;
  serial?: string | null;
  expiry?: { raw: string; year: number; month: number; day: number | null; dayUnknown: boolean } | null;
  format: 'GS1_128' | 'GTIN' | 'UNKNOWN';
  known: { kind: 'INVENTORY' | 'EQUIPMENT'; id: string; name: string }[];
  summaryText: string;
}

const USAGE_TYPE_LABEL: Record<string, string> = { IMPLANT: '삽입(임플란트)', SINGLE_USE: '일회용', REUSABLE: '재사용', OTHER: '기타' };

export default function DeviceUsagePanel({ surgeryId, patientId }: { surgeryId: string; patientId?: string | null }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['device-usage-patient', patientId],
    queryFn: () => apiClient.get<{ data: { items: DeviceUsageRow[]; total: number; caveat?: string } }>(`/api/v1/device-usage/patient/${patientId}`),
    enabled: !!patientId,
  });
  const all = data?.data?.items ?? [];
  const mine = all.filter((r) => r.surgeryId === surgeryId);
  const others = all.length - mine.length;

  if (!patientId) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-bold text-gray-900"><T k="삽입 기기 (UDI)" /></h3>
        <p className="mt-2 text-sm text-gray-400"><T k="이 수술 기록에 환자 연결 정보가 없어 기기 기록을 조회·추가할 수 없습니다." /></p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-900"><T k="삽입 기기 (UDI)" /></h3>
        <button type="button" onClick={() => setShowAdd(true)}
          className="min-h-[44px] rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"><T k="+ 기기 기록" /></button>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        <T k="UDI 바코드로 기록합니다 — 리콜 시 이 기록으로 환자를 역추적합니다. Op Note 의 &lsquo;삽입물&rsquo; 텍스트와는 별개 원장입니다." />
      </p>

      {isError ? (
        <div className="mt-3"><QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" /></div>
      ) : isLoading ? (
        <div className="py-4 text-center text-sm text-gray-400"><T k="불러오는 중…" /></div>
      ) : mine.length === 0 ? (
        <div className="mt-3"><EmptyState compact title="이 수술에 기록된 기기가 없습니다" /></div>
      ) : (
        <div className="mt-3 space-y-2">
          {mine.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="font-medium text-gray-900">{r.deviceName}</span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700"><T k={USAGE_TYPE_LABEL[r.usageType] ?? r.usageType} /></span>
              {r.quantity > 1 && <span className="text-xs text-gray-600">×{r.quantity}</span>}
              {r.gtin && <span className="font-mono text-xs text-gray-500">GTIN {r.gtin}</span>}
              {r.gtinValid === false && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title={tAttr('GTIN 체크디지트 불일치 — 기록은 유지됨')}><T k="체크디지트 불일치" /></span>}
              {r.lotNumber && <span className="font-mono text-xs text-gray-500">LOT {r.lotNumber}</span>}
              {r.serialNumber && <span className="font-mono text-xs text-gray-500">SN {r.serialNumber}</span>}
              {r.expiryDate && (
                <span className="text-xs text-gray-500">
                  <T k="유효" /> <KDate value={r.expiryDate} /><T k={r.expiryDayUnknown ? ' (일자 미상 — 해당 월 1일로 표기)' : ''} />
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400"><KDate value={r.usedAt} mode="datetime" /></span>
            </div>
          ))}
        </div>
      )}
      {others > 0 && (
        <p className="mt-2 text-[11px] text-gray-400">이 환자의 다른 기록 {others}건은 환자 차트에서 확인하세요(조회는 최근 200건까지).</p>
      )}

      {showAdd && (
        <AddDeviceDialog patientId={patientId} surgeryId={surgeryId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['device-usage-patient', patientId] }); }} />
      )}
    </div>
  );
}

function AddDeviceDialog({ patientId, surgeryId, onClose, onSaved }: {
  patientId: string; surgeryId: string; onClose: () => void; onSaved: () => void;
}) {
  const tAttr = useTAttr();
  const [barcode, setBarcode] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [usageType, setUsageType] = useState(''); // 미선택 초기값
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const doScan = async () => {
    if (!barcode.trim()) return;
    setScanning(true);
    try {
      const res = await apiClient.post<{ data: ScanResult }>('/api/v1/device-usage/scan', { barcode: barcode.trim() });
      const parsed = (res.data ?? null) as ScanResult | null;
      setScan(parsed);
      // 원내 품목 대조 결과가 있으면 이름 입력을 보조한다(제안일 뿐 — 확정은 사람이)
      if (parsed?.known?.length && !deviceName) setDeviceName(parsed.known[0].name);
    } catch (e) { toast.error(e instanceof Error ? e.message : '바코드 판독 실패'); }
    setScanning(false);
  };

  const submit = async () => {
    if (!deviceName.trim() || !usageType) return;
    setSaving(true);
    try {
      const res = await apiClient.post<{ data: DeviceUsageRow; warning?: string | null }>('/api/v1/device-usage', {
        patientId, surgeryId,
        barcode: barcode.trim() || undefined,
        deviceName: deviceName.trim(),
        manufacturer: manufacturer.trim() || undefined,
        usageType, quantity,
      });
      if (res.warning) toast.warning(res.warning);
      else toast.success('기기 사용을 기록했습니다.');
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : '기록 실패'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-gray-900"><T k="기기 사용 기록" /></h3>
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="UDI 바코드 (GS1-128 또는 GTIN)" /></label>
            <div className="flex gap-2">
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doScan(); } }}
                placeholder={tAttr('스캐너 입력 또는 (01)08806…(17)…(10)…')}
                className="flex-1 rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm" autoFocus />
              <button type="button" onClick={doScan} disabled={scanning || !barcode.trim()}
                className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700 disabled:opacity-50">
                <T k={scanning ? '판독 중…' : '판독'} />
              </button>
            </div>
            {scan && (
              <div className={`mt-2 rounded-lg p-2.5 text-xs ${scan.format === 'UNKNOWN' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700'}`}>
                <div>{scan.summaryText}</div>
                {scan.gtinValid === false && <div className="mt-1 font-semibold text-amber-700"><T k="⚠ GTIN 체크디지트 불일치 — 기록은 가능하나 표기가 남습니다." /></div>}
                {scan.known.length > 0 && <div className="mt-1 text-gray-500">원내 대조: {scan.known.map((k) => k.name).join(', ')}</div>}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="기기명 *" /></label>
            <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="제조사" /></label>
              <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="수량" /></label>
              <input type="number" min={1} max={999} value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="사용 유형 *" /></label>
            <select value={usageType} onChange={(e) => setUsageType(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value=""><T k="— 선택 —" /></option>
              {Object.entries(USAGE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-gray-400"><T k="사용 시각은 저장 시점으로 기록됩니다(사후 소급 입력은 현재 지원되지 않습니다)." /></p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-gray-300 px-4 text-sm text-gray-700"><T k="취소" /></button>
          <button type="button" onClick={submit} disabled={saving || !deviceName.trim() || !usageType}
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">
            <T k={saving ? '기록 중…' : '기록'} />
          </button>
        </div>
      </div>
    </div>
  );
}
