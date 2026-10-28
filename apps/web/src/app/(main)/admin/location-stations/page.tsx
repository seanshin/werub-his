'use client';

import { useCallback, useEffect, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Zone { id: string; name: string; code?: string; floor?: number; spaceType?: string; department?: string }
interface Station {
  id: string; label: string; deviceType: string; isActive: boolean; lastSeenAt?: string;
  zoneId: string; zone?: { name: string; code?: string; floor?: number } | null;
}

const DEVICE = [{ v: 'TABLET', l: '태블릿' }, { v: 'PHONE', l: '스마트폰' }, { v: 'READER', l: '전용 리더' }];

export default function LocationStationsPage() {
  const tAttr = useTAttr();
  const [zones, setZones] = useState<Zone[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [zoneId, setZoneId] = useState('');
  const [label, setLabel] = useState('');
  const [deviceType, setDeviceType] = useState('TABLET');
  const [issuedKey, setIssuedKey] = useState<{ key: string; label: string } | null>(null);

  const load = useCallback(() => {
    apiClient.get<{ data: Zone[] }>('/api/v1/patient-flow/zones').then((r) => setZones(r.data ?? [])).catch(() => {});
    apiClient.get<{ data: Station[] }>('/api/v1/admin/location-stations').then((r) => setStations(r.data ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const register = async () => {
    if (!zoneId || !label.trim()) { toast.error('구역과 라벨을 입력하세요.'); return; }
    try {
      const r = await apiClient.post<{ data: { stationKey: string; label: string } }>('/api/v1/admin/location-stations', { zoneId, label: label.trim(), deviceType });
      setIssuedKey({ key: r.data.stationKey, label: r.data.label });
      setLabel('');
      toast.success('스테이션 등록 완료 — 키를 기기에 입력하세요(1회만 표시)');
      load();
    } catch { toast.error('등록 실패'); }
  };

  const toggle = async (s: Station) => {
    try { await apiClient.patch(`/api/v1/admin/location-stations/${s.id}`, { isActive: !s.isActive }); load(); }
    catch { toast.error('변경 실패'); }
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900"><T k="장소 스테이션 (동선 체크인 기기)" /></h2>
        <p className="text-sm text-gray-500 mt-1">각 장소의 스캔 기기(태블릿·스마트폰·리더)를 구역에 등록합니다. 발급된 키를 기기의 <span className="font-mono">/station</span> 설정에 입력하세요.</p>
      </div>

      {/* 등록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="구역(장소)" /></label>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
            <option value="">{tAttr('선택…')}</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.floor != null ? `${z.floor}F · ` : ''}{z.name}{z.department ? ` (${z.department})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="기기 라벨" /></label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tAttr('예: 접수데스크 태블릿1')} className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-56" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1"><T k="기기 종류" /></label>
          <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
            {DEVICE.map((d) => <option key={d.v} value={d.v}>{tAttr(d.l)}</option>)}
          </select>
        </div>
        <button onClick={register} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"><T k="기기 등록" /></button>
      </div>

      {/* 발급된 키(1회) */}
      {issuedKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
          <p className="text-xs font-semibold text-amber-800 mb-1">🔑 "{issuedKey.label}" <T k="스테이션 키 — 지금 기기에 입력하세요 (다시 표시되지 않음)" /></p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white rounded-lg border border-amber-200 text-sm font-mono break-all">{issuedKey.key}</code>
            <button onClick={() => { navigator.clipboard?.writeText(issuedKey.key); toast.success('복사됨'); }} className="text-xs px-3 py-2 rounded-lg bg-amber-600 text-white"><T k="복사" /></button>
            <button onClick={() => setIssuedKey(null)} className="text-xs px-3 py-2 rounded-lg bg-gray-100 text-gray-600"><T k="닫기" /></button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left font-medium px-4 py-2.5"><T k="라벨" /></th>
              <th className="text-left font-medium px-4 py-2.5"><T k="구역" /></th>
              <th className="text-left font-medium px-4 py-2.5"><T k="기기" /></th>
              <th className="text-left font-medium px-4 py-2.5"><T k="최근 사용" /></th>
              <th className="text-left font-medium px-4 py-2.5"><T k="상태" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {stations.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2.5 font-medium text-gray-800">{s.label}</td>
                <td className="px-4 py-2.5 text-gray-600">{s.zone ? `${s.zone.floor != null ? s.zone.floor + 'F · ' : ''}${s.zone.name}` : '-'}</td>
                <td className="px-4 py-2.5 text-gray-500"><T k={DEVICE.find((d) => d.v === s.deviceType)?.l ?? s.deviceType} /></td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{s.lastSeenAt ?kdate(s.lastSeenAt, 'datetimeShort') : tAttr('미사용')}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => toggle(s)} className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
                    <T k={s.isActive ? '활성' : '비활성'} />
                  </button>
                </td>
              </tr>
            ))}
            {!stations.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm"><T k="등록된 스테이션이 없습니다." /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
