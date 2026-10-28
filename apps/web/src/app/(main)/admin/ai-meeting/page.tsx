'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

// 🔴 이 화면은 WeRU.B 의 **테넌트 공용 작업 큐**를 "병원 회의"로 둔갑시켜 보여주고 있었다(W8-R6/A).
//    실측 47건 = 교육 STT 벤치마크 31 · 앰비언트 **진료녹취(scribe) 6** · 미상 9 · 병원 회의 **0**.
//    상세 조회는 transcript.full_text·speaker_segments 를 함께 받아왔고(B) FE 는 summary 만 그려
//    "전문이 같이 왔다"는 사실을 숨겼다. 이제 서버가 ①우리 출처 작업만 반환 ②전사 전문 제거를 수행하며,
//    이 화면은 걸러진 개수를 **사실대로** 표시한다(병원 회의가 0건이면 0건이라 말한다).
interface MeetingJob {
  id: string; // 회의분석 서비스 작업 id (이전엔 job_id로 잘못 매핑 → 렌더 크래시)
  status: string;
  metadata?: { room_name?: string; meeting_id?: string; duration_sec?: number; source?: string | null };
  // 전사 전문(transcript/speaker_segments)은 응답에 실리지 않는다 — 존재 사실만 transcriptOmitted 로 온다.
  result?: { summary?: string; action_items?: string[]; highlights?: string[]; transcriptOmitted?: boolean };
  created_at?: string;
  error?: string;
}

interface MeetingJobsPayload {
  jobs?: MeetingJob[];
  queueTotal?: number;
  excluded?: { total: number; bySource: Record<string, number> };
}

/** 공용 큐의 타 출처 표기 — 모르는 값은 옮겨 적기만 하고 의미를 지어내지 않는다 */
const SOURCE_LABEL: Record<string, string> = {
  scribe: '앰비언트 진료녹취(scribe)',
  unknown: '출처 미상',
};

const jobLabel = (j: MeetingJob) => j.metadata?.room_name ?? j.metadata?.meeting_id ?? j.id?.slice(0, 8) ?? '회의';

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-600',
};

export default function AiMeetingPage() {
  const tAttr = useTAttr();
  const [jobs, setJobs] = useState<MeetingJob[]>([]);
  const [excluded, setExcluded] = useState<{ total: number; bySource: Record<string, number> } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MeetingJob | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileUrl, setFileUrl] = useState('');
  const [roomName, setRoomName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.fetch<{ data: MeetingJobsPayload }>('/api/v1/ai/meeting/jobs');
      setJobs(res.data?.jobs ?? []);
      setExcluded(res.data?.excluded ?? null);
      setLoadError(null);
    } catch (e) {
      // 🔴 기존: 실패를 통째로 삼켜(catch {}) 목록이 "0건"으로 보였다 — 실패와 진짜 0건이 구분되지 않았다.
      setJobs([]);
      setExcluded(null);
      setLoadError(e instanceof Error ? e.message : '작업 목록을 불러오지 못했습니다');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 진행 중(pending/processing류) 잡이 있으면 5초 자동 폴링 — 없으면 미폴링
  const hasRunning = jobs.some(j => ['pending', 'processing', 'running', 'queued', 'in_progress'].includes(String(j.status ?? '').toLowerCase()));
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [hasRunning, load]);

  const handleSubmit = async () => {
    if (!fileUrl) return;
    setSubmitting(true);
    try {
      await apiClient.fetch('/api/v1/ai/meeting/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: fileUrl,
          options: { summary: true, action_items: true, highlights: true },
          metadata: { room_name: roomName || '회의' },
        }),
      });
      toast.success('분석 요청이 접수되었습니다');
      setFileUrl('');
      setRoomName('');
      load();
    } catch { toast.error('분석 요청 실패'); }
    setSubmitting(false);
  };

  const handleRefresh = async (jobId: string) => {
    try {
      const res = await apiClient.fetch<{ data: MeetingJob }>(`/api/v1/ai/meeting/job/${jobId}`);
      setSelected(res.data);
      setDetailError(null);
      load();
    } catch (e) {
      // 서버가 타 출처 작업(진료녹취 등)을 403 으로 거부하는 경우를 포함 — 사유를 숨기지 않는다.
      setSelected(null);
      setDetailError(e instanceof Error ? e.message : '작업 상세를 불러오지 못했습니다');
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">회의 녹화 {AI_ORIGIN_TEXT} 분석</h1>
        <p className="text-sm text-gray-500 mt-1"><T k="화상회의 녹화본 → STT(Whisper) → 요약 + 액션아이템 + 하이라이트" /></p>
        <p className="text-xs text-gray-400 mt-1">
          이 화면은 <strong>이 병원이 회의 분석으로 제출한 작업</strong>만 표시합니다. {AI_ORIGIN_TEXT} 작업 큐는 여러 출처가
          공용으로 쓰며, 진료 녹취 등 타 출처 작업은 여기서 열람할 수 없습니다.
        </p>
      </div>

      {/* 분석 요청 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-bold text-gray-700"><T k="새 분석 요청" /></h2>
        <input value={fileUrl} onChange={e => setFileUrl(e.target.value)}
          placeholder={tAttr('녹화 파일 URL (S3 Presigned URL 등)')}
          className="w-full px-4 py-2 border border-gray-200 rounded-xl text-sm" />
        <div className="flex gap-3">
          <input value={roomName} onChange={e => setRoomName(e.target.value)}
            placeholder={tAttr('회의실명 (선택)')} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm" />
          <button onClick={handleSubmit} disabled={submitting || !fileUrl}
            className="px-6 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-30">
            <T k={submitting ? '요청 중...' : '분석 요청'} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 작업 목록 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="병원 회의 분석 작업" /> ({jobs.length}<Unit>건</Unit>)</h2>
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
          ) : loadError ? (
            // 실패를 0건으로 표시하지 않는다 — 모르는 것은 모른다고 말한다.
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
              <T k="작업 목록을 불러오지 못했습니다" /> — {loadError}
              <p className="text-[11px] text-red-500 mt-1"><T k="아래 목록이 비어 있는 것은 “작업 0건”을 뜻하지 않습니다." /></p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {jobs.map(j => (
                <button key={j.id} onClick={() => handleRefresh(j.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${selected?.id === j.id ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{jobLabel(j)}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLOR[j.status] ?? 'bg-gray-100'}`}>{j.status}</span>
                  </div>
                  {j.created_at && <p className="text-[10px] text-gray-400 mt-0.5">{j.created_at}</p>}
                </button>
              ))}
              {jobs.length === 0 && <EmptyState icon="📊" title="이 병원이 제출한 회의 분석 작업이 없습니다" />}
            </div>
          )}

          {/* 공용 큐에서 제외된 작업 — 개수만 사실대로(내용·상세는 열지 않는다) */}
          {!loading && !loadError && excluded && excluded.total > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <p className="text-[11px] font-bold text-amber-700">
                공용 {AI_ORIGIN_TEXT} 큐의 타 출처 작업 {excluded.total}<Unit>건</Unit>은 이 화면에서 제외했습니다
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(excluded.bySource).map(([src, n]) => (
                  <span key={src} className="text-[11px] text-amber-600">
                    <T k={SOURCE_LABEL[src] ?? src} /> {n}<Unit>건</Unit>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-amber-500 mt-1">
                <T k="진료 녹취는 개인정보보호법·의료법상 진료기록 열람 경로(진료건 바인딩·동의·환자 지목 감사)로만 볼 수 있습니다." />
              </p>
              {jobs.length === 0 && (excluded.bySource['unknown'] ?? 0) > 0 && (
                <p className="text-[10px] text-amber-500 mt-1">
                  참고: 분류는 작업 metadata 의 출처 표기에 의존합니다. 분석을 요청했는데도 목록이 계속 비어 있고
                  ‘출처 미상’만 늘어난다면, {AI_ORIGIN_TEXT} 가 metadata 를 회신하지 않는 것일 수 있습니다(운영 확인 필요).
                </p>
              )}
            </div>
          )}
        </div>

        {/* 결과 상세 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4"><T k="분석 결과" /></h2>
          {selected?.result ? (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {selected.result.summary && (
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-[10px] text-blue-500 font-bold mb-1"><T k="요약" /></p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{selected.result.summary}</p>
                </div>
              )}
              {selected.result.action_items && selected.result.action_items.length > 0 && (
                <div className="bg-amber-50 rounded-xl p-4">
                  <p className="text-[10px] text-amber-600 font-bold mb-2"><T k="액션 아이템" /></p>
                  {selected.result.action_items.map((item, i) => (
                    <p key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-amber-500">•</span>{item}</p>
                  ))}
                </div>
              )}
              {selected.result.highlights && selected.result.highlights.length > 0 && (
                <div className="bg-violet-50 rounded-xl p-4">
                  <p className="text-[10px] text-violet-600 font-bold mb-2"><T k="하이라이트" /></p>
                  {selected.result.highlights.map((h, i) => (
                    <p key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-violet-500">•</span>{h}</p>
                  ))}
                </div>
              )}
              {selected.result.transcriptOmitted && (
                <p className="text-[11px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  <T k="전사 전문·화자분절은 이 화면에 제공되지 않습니다(응답에서 제외). 요약·액션아이템만 표시합니다." />
                </p>
              )}
            </div>
          ) : detailError ? (
            <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">{detailError}</div>
          ) : selected?.error ? (
            <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">{selected.error}</div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-8"><T k="좌측에서 작업을 선택하세요" /></p>
          )}
        </div>
      </div>
    </div>
  );
}
