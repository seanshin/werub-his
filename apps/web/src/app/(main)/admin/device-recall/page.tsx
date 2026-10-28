'use client';

// UDI 기기 리콜 역추적 — gap-remediation R5 (GET /api/v1/device-usage/recall 첫 소비처)
// 🔴 세 조건(GTIN·LOT·일련번호)은 서버에서 AND 로 결합된다 — 화면이 그 사실을 밝힌다.
// 🔴 0건은 "해당 없음"이 아니다 — 기록된 사용분 안에서 0건일 뿐(서버 caveat 를 그대로 표시).

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { EmptyState, KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface RecallRow {
  usageId: string;
  patientId: string;
  mrn: string;
  name: string;
  deviceName: string;
  lotNumber?: string | null;
  serialNumber?: string | null;
  usedAt: string;
  usageType: string;
}

interface RecallResult {
  query: Record<string, string>;
  total: number;
  returned: number;
  truncated: boolean;
  patients: RecallRow[];
  caveat: string;
}

const USAGE_TYPE_LABEL: Record<string, string> = { IMPLANT: '삽입(임플란트)', SINGLE_USE: '일회용', REUSABLE: '재사용', OTHER: '기타' };

export default function DeviceRecallPage() {
  const tAttr = useTAttr();
  const [gtin, setGtin] = useState('');
  const [lot, setLot] = useState('');
  const [serial, setSerial] = useState('');
  const [result, setResult] = useState<RecallResult | null>(null);

  const search = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams();
      if (gtin.trim()) params.set('gtin', gtin.trim());
      if (lot.trim()) params.set('lotNumber', lot.trim());
      if (serial.trim()) params.set('serialNumber', serial.trim());
      return apiClient.get<{ data: RecallResult }>(`/api/v1/device-usage/recall?${params.toString()}`);
    },
    onSuccess: (res) => setResult((res.data ?? null) as RecallResult | null),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '조회 실패'),
  });

  const anyInput = !!(gtin.trim() || lot.trim() || serial.trim());

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900"><T k="기기 리콜 역추적 (UDI)" /></h1>
        <p className="mt-1 text-sm text-gray-500">
          리콜 대상 기기의 GTIN·로트·일련번호로 <b>사용(삽입) 기록이 있는 환자</b>를 역추적합니다.
          입력한 조건은 <b>모두 만족(AND)</b>하는 기록만 찾습니다 — 로트 전체를 찾으려면 일련번호는 비워 두세요.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">GTIN</label>
            <input value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder={tAttr('8~14자리')}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="로트(LOT) 번호" /></label>
            <input value={lot} onChange={(e) => setLot(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500"><T k="일련번호" /></label>
            <input value={serial} onChange={(e) => setSerial(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" disabled={!anyInput || search.isPending} onClick={() => search.mutate()}
            className="min-h-[44px] rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            <T k={search.isPending ? '조회 중…' : '역추적 조회'} />
          </button>
        </div>
      </div>

      {search.isError && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          조회에 실패했습니다 — 아래 결과가 비어 있어도 &quot;해당 환자 없음&quot;으로 읽지 마세요. 다시 시도하세요.
        </div>
      )}

      {result && !search.isError && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900"><T k="결과" /> {result.total}건</h2>
            {result.truncated && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {result.returned}건만 표시(절단) — 전체 {result.total}건
              </span>
            )}
          </div>
          {result.caveat && <p className="mb-3 text-xs text-gray-500">{result.caveat}</p>}
          {result.patients.length === 0 ? (
            <EmptyState compact title="기록된 사용분 안에서 일치 0건"
              hint={"UDI 기록이 없는 사용(수기 기록 누락 등)은 이 조회로 찾을 수 없습니다 — 0건이 '해당 없음'을 뜻하지 않습니다."} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2"><T k="환자" /></th><th className="px-3 py-2">MRN</th><th className="px-3 py-2"><T k="기기" /></th>
                    <th className="px-3 py-2">LOT</th><th className="px-3 py-2"><T k="일련번호" /></th><th className="px-3 py-2"><T k="사용 시각" /></th><th className="px-3 py-2"><T k="유형" /></th>
                  </tr>
                </thead>
                <tbody>
                  {result.patients.map((r) => (
                    <tr key={r.usageId} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium">
                        <a href={`/patients/${r.patientId}`} className="text-blue-700 hover:underline">{r.name}</a>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{r.mrn}</td>
                      <td className="px-3 py-2">{r.deviceName}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.lotNumber ?? '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.serialNumber ?? '-'}</td>
                      <td className="px-3 py-2 text-gray-600"><KDate value={r.usedAt} mode="datetime" /></td>
                      <td className="px-3 py-2 text-gray-600"><T k={USAGE_TYPE_LABEL[r.usageType] ?? r.usageType} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
