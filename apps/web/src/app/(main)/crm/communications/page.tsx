'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { T, useTAttr } from '@/components/ui/i18n-text';

import { EmptyState, Unit } from '@/components/ui/display';

interface CommLog {
  id: string; channel: string; direction: string; type: string;
  subject: string | null; content: string | null; status: string; createdAt: string;
}

const CHAN_ICON: Record<string, string> = {
  SMS: '💬', PUSH: '🔔', CALL: '📞', EMAIL: '📧', PORTAL: '🌐', VISIT: '🏥',
};

/**
 * 🔴 발송 상태 어휘(생산자 crm-cron 의 3상) — §6 회수(2026-08-25).
 *    종전엔 status 를 **그리지 않아** SIMULATED(채널 미구현 — 실제로 나가지 않음)가
 *    '발신' 배지로만 보였다: 안 나간 것이 나간 것처럼 읽힌다(전송 정직성).
 */
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SENT: { label: '발송됨', cls: 'bg-emerald-100 text-emerald-700' },
  SIMULATED: { label: '발송 안 됨(채널 미구현)', cls: 'bg-amber-100 text-amber-700' },
  FAILED: { label: '발송 실패', cls: 'bg-rose-100 text-rose-700' },
};

export default function CommunicationsPage() {
  const tAttr = useTAttr();
  const [patientId, setPatientId] = useState('');
  const [logs, setLogs] = useState<CommLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!patientId.trim()) return;
    setLoading(true);
    try {
      const res = await apiClient.fetch<{ data: CommLog[]; meta: { total: number } }>(`/api/v1/crm/patients/${patientId}/communications`);
      setLogs(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="소통 이력" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="전체 채널 커뮤니케이션 로그" /></p>
      </div>

      <div className="flex gap-2">
        <input value={patientId} onChange={e => setPatientId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder={tAttr('환자 ID로 조회')} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm" />
        <button onClick={load} className="px-4 py-2.5 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700"><T k="조회" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start gap-3">
              <span className="text-lg">{CHAN_ICON[log.channel] ?? log.channel}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${log.direction === 'INBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    <T k={log.direction === 'INBOUND' ? '수신' : '발신'} />
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-100 text-violet-700">{log.type}</span>
                  {log.status && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${(STATUS_BADGE[log.status] ?? { cls: 'bg-gray-100 text-gray-500' }).cls}`}>
                      <T k={(STATUS_BADGE[log.status] ?? { label: log.status }).label} />
                    </span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">{log.createdAt?.slice(0, 16).replace('T', ' ')}</span>
                </div>
                {log.subject && <p className="text-sm font-medium text-gray-900 mt-1">{log.subject}</p>}
                {log.content && <p className="text-xs text-gray-500 mt-1">{log.content}</p>}
              </div>
            </div>
          ))}
          {logs.length === 0 && patientId && !loading && (
            <EmptyState icon="🔔" title="소통 이력이 없습니다" />
          )}
          {total > 0 && <p className="text-xs text-gray-400 text-center">총 {total}<Unit>건</Unit></p>}
        </div>
      )}
    </div>
  );
}
