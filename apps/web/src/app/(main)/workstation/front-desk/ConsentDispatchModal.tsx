'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface Template { id: string; name: string; type: string; consentType?: string; content?: Record<string, unknown> }
interface Device { id: string; deviceName?: string; name?: string; status?: string; lastSeenAt?: string }
export interface ConsentPatient { id: string; familyName: string; givenName: string }

export function ConsentDispatchModal({ patient, onClose }: { patient: ConsentPatient; onClose: () => void }) {
  const tAttr = useTAttr();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deviceId, setDeviceId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient.get<{ data: Template[] }>('/api/v1/consent-templates')
      .then((r) => { const list = (((r.data as { data?: Template[] })?.data ?? r.data ?? []) as Template[]); setTemplates(list); })
      .catch(() => {});
    apiClient.get<{ data: Device[] }>('/api/v1/consent-devices')
      .then((r) => { const list = (((r.data as { data?: Device[] })?.data ?? r.data ?? []) as Device[]); setDevices(list); if (list[0]) setDeviceId(list[0].id); })
      .catch(() => {});
  }, []);

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const dispatch = async () => {
    if (!picked.size) { toast.error('전송할 동의서를 선택하세요.'); return; }
    if (!deviceId) { toast.error('태블릿을 선택하세요.'); return; }
    setBusy(true);
    let ok = 0;
    try {
      for (const tid of picked) {
        const t = templates.find((x) => x.id === tid);
        if (!t) continue;
        const created = await apiClient.post<{ data: { id: string } }>('/api/v1/consent', {
          patientId: patient.id,
          type: t.type,
          templateName: t.name,
          content: t.content ?? {},
          templateId: t.id,
          consentType: t.consentType || undefined,
        });
        const consentId = created.data.id;
        await apiClient.post(`/api/v1/consent-devices/${deviceId}/dispatch`, { consentId });
        ok++;
      }
      toast.success(`동의서 ${ok}건을 태블릿으로 전송했습니다.`);
      onClose();
    } catch (e: unknown) {
      toast.error(`전송 실패 (${ok}건 처리됨)`);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900"><T k="초진 동의서 태블릿 전송" /></h3>
            <p className="text-xs text-gray-500">{patient.familyName}{patient.givenName} 님</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 scrollbar-thin">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2"><T k="전송할 동의서 선택" /></p>
            <div className="space-y-1.5 max-h-52 overflow-y-auto scrollbar-thin">
              {templates.map((t) => (
                <label key={t.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${picked.has(t.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} className="w-4 h-4" />
                  <span className="flex-1">{t.name}</span>
                  <span className="text-[10px] text-gray-400">{t.consentType ?? t.type}</span>
                </label>
              ))}
              {!templates.length && <EmptyState icon="📄" title="등록된 동의서 템플릿이 없습니다." />}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2"><T k="대상 태블릿" /></p>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-100">
              <option value="">{tAttr('태블릿 선택')}</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.deviceName ?? d.name ?? d.id.slice(0, 8)}{d.status ? ` (${d.status})` : ''}</option>)}
            </select>
            {!devices.length && <p className="text-[11px] text-amber-600 mt-1"><T k="등록된 동의서 태블릿이 없습니다. 관리자에서 기기를 페어링하세요." /></p>}
          </div>
        </div>

        <div className="px-5 py-4 border-t flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50"><T k="취소" /></button>
          <button onClick={dispatch} disabled={busy || !picked.size || !deviceId} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
            {busy ? <T k="전송 중..." /> : <><T k="태블릿으로 전송" /> ({picked.size})</>}
          </button>
        </div>
      </div>
    </div>
  );
}
