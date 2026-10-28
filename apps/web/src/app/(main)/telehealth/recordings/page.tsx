'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { apiClient, ApiError } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr, useTfAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

/**
 * 🔴 (외부 점검) 녹화 API 키를 화면에서 **없앴다**.
 *    종전에는 브라우저 공개 환경변수(빌드 시 번들에 박히는 공개 접두어 변수)로 녹화 API 키를 읽어
 *    `/meet-api/recordings*` 를 직접 불렀다 — 이 화면을 여는 사람이면 누구나 키를 읽을 수 있었고,
 *    '전체 관리 UI' 링크는 키를 **URL 쿼리에** 실어 브라우저 기록·프록시 로그·Referer 에 남겼다.
 *    키 역할이 admin/operator 면 그 키로 녹화 삭제까지 된다.
 *    (🔴 이 주석은 그 변수명을 적지 않는다 — 가드가 소스 문자열로 재발을 막기 때문이다.)
 *    이제 HIS 서버 프록시(`/api/v1/telehealth/recordings`)만 부른다 — 키는 서버에만 있고 RBAC·감사가 걸린다.
 *    🔴 EP 경로는 상수로 묶지 않고 호출마다 리터럴로 적는다 — 역할×화면×EP 스캐너(`role-endpoint-scan.ts`)가
 *       `apiClient.xxx('/api/v1/…')` 리터럴만 본다. 상수로 감추면 이 화면의 EP 가 대조에서 조용히 빠진다.
 */

interface Recording {
  id: string; conferenceId?: string; roomName?: string; status: string;
  fileName?: string; fileSize?: number; duration?: number; mimeType?: string;
  memo?: string; tags?: string; startedAt?: string; completedAt?: string;
}

export default function RecordingsPage() {
  const tAttr = useTAttr();
  const tfAttr = useTfAttr();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Recording | null>(null);
  const [editMemo, setEditMemo] = useState('');
  const [editTags, setEditTags] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['recordings', search],
    // 🔴 실패를 빈 목록으로 삼키지 않는다 — `.catch(() => [])` 를 두면 isError 가 영원히 false 가 되고
    //    "녹화 파일이 없습니다"가 인증 실패·미설정을 가린다(P1-ⓑ). 서버가 503/502 로 말하고 여기서는 전파한다.
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/telehealth/recordings', search ? { keyword: search } : undefined),
    staleTime: 30000,
  });
  // 녹화 서버 응답이 배열이 아니면 "0건"으로 그리지 않는다 — 모양이 다른 것은 다른 사실이다
  const recordings: Recording[] = Array.isArray(data?.data) ? (data!.data as Recording[]) : [];
  const unexpectedShape = !isLoading && !isError && data !== undefined && !Array.isArray(data?.data);
  /** 연동 미설정(503 RECORDINGS_NOT_CONFIGURED) — 재시도로 풀리지 않는다. 설정할 곳을 말한다 */
  const notConfigured = isError && error instanceof ApiError && error.code === 'RECORDINGS_NOT_CONFIGURED';

  const updateMemo = async (rid: string) => {
    try {
      await apiClient.patch(`/api/v1/telehealth/recordings/${rid}`, { memo: editMemo, tags: editTags });
      toast.success(tAttr('메모 저장 완료'));
      refetch();
    } catch (e) { toast.error(extractErrorMessage(e) || tAttr('저장 실패')); }
  };

  /**
   * 🔴 다운로드는 `<a href>` 로 열 수 없다 — HIS EP 는 Bearer 토큰을 요구하고 앵커는 헤더를 싣지 못한다
   *    (가드 `test/architecture/no-authless-api-link.spec.ts`). 종전 링크는 `/meet-api/...` 를 키 없이 불러
   *    사실상 동작하지 않거나 인증 없이 열리던 자리였다. fetch 로 받아 blob 으로 저장한다. 실패는 말한다.
   */
  const downloadRec = async (rid: string, fileName?: string) => {
    try {
      const token = apiClient.getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/telehealth/recordings/${rid}/download`, {
        credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        // 서버 예외 본문(`error.message`)이 있으면 그것을, 없으면 상태코드를 말한다 — 조용히 넘어가지 않는다
        let serverMessage: string | undefined;
        try {
          const body = (await res.json()) as { error?: { message?: string } } | null;
          serverMessage = body?.error?.message;
        } catch { serverMessage = undefined; }
        toast.error(serverMessage || tfAttr('녹화 파일을 내려받지 못했습니다 (HTTP {상태})', { 상태: res.status }));
        return;
      }
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName || `recording-${rid}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (e) {
      toast.error((e as Error)?.message || tAttr('녹화 파일을 내려받지 못했습니다'));
    }
  };

  /**
   * 🔴 삭제는 서버가 ADMIN 으로 좁힌다(녹화는 의무기록의 일부) — 화면도 같은 판정으로 버튼을 그린다.
   *    이 선언은 목록 조회(`apiClient.get`)에서 떨어뜨려 둔다 — 역할×EP 스캐너가 호출 자리 ±10줄의 게이트 신호를 보므로,
   *    조회 옆에 두면 **목록 EP 까지 대조에서 빠진다**(게이트는 삭제 한 자리에만 달린 것이다).
   */
  const canDelete = useHasRole('ADMIN');
  const deleteRec = async (rid: string) => {
    if (!canDelete) return; // 서버 @Roles(ADMIN) 와 같은 판정 — 화면이 가진 적 없는 권한을 가진 척하지 않는다
    if (!confirm(tAttr('녹화를 삭제하시겠습니까? 의무기록 관련 파일은 삭제할 수 없습니다.'))) return;
    try {
      // 🔴 권한이 없으면 403 이 그대로 온다 — 성공한 척하지 않는다
      await apiClient.del(`/api/v1/telehealth/recordings/${rid}`);
      toast.success(tAttr('삭제 완료'));
      setSelected(null);
      refetch();
    } catch (e) { toast.error(extractErrorMessage(e) || tAttr('삭제 실패')); }
  };

  const fmtSize = (b?: number) => !b ? '-' : b > 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${(b / 1024).toFixed(0)}KB`;
  const fmtDur = (s?: number) => !s ? '-' : `${Math.floor(s / 60)}분 ${s % 60}초`;
  const fmtDt = (d?: string) => !d ? '-' : kdate(d, 'datetimeShort');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/telehealth" className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h2 className="text-2xl font-bold text-gray-900"><T k="📹 녹화 관리" /></h2>
          </div>
          <p className="text-sm text-gray-500 mt-1 ml-8"><T k="원격진료 녹화 파일 관리 · 진료 기록 연동" /></p>
        </div>
        {/* 🔴 '전체 관리 UI ↗' 링크 제거 — API 키를 URL 쿼리에 실어 새 창을 열던 자리다(D-27).
            녹화 서버의 자체 관리 화면은 HIS 가 자격을 대신 실어 줄 수 없다 — 그 화면이 필요하면
            녹화 서버에 직접 로그인한다. 링크만 지우면 "어디 갔지"가 되므로 사실을 짧게 적는다. */}
        <p className="text-[11px] text-gray-400 max-w-[260px] text-right">
          <T k="녹화 서버 자체 관리 화면은 녹화 서버에 직접 로그인해 사용합니다(HIS 가 API 키를 화면으로 넘기지 않습니다)." />
        </p>
      </div>

      {/* 검색 */}
      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tAttr('녹화 검색 (메모, 태그, 방이름)...')}
          className="w-full px-4 py-2.5 border rounded-xl text-sm" />
      </div>

      <div className="flex gap-4">
        {/* 목록 */}
        <div className="flex-1 space-y-2">
          {notConfigured ? (
            /* 🔴 미설정은 "녹화 없음"도 "오류"도 아니다 — 재시도를 권하지 않고 설정할 곳을 말한다 */
            <div className="py-16 text-center border border-dashed rounded-xl bg-amber-50/40">
              <p className="text-sm font-semibold text-amber-800"><T k="녹화 서버 연동이 설정되지 않았습니다" /></p>
              <p className="text-xs text-amber-700 mt-1"><T k="서버 환경변수 TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY 를 설정해야 목록을 부를 수 있습니다 — 녹화가 없는 것이 아닙니다." /></p>
            </div>
          ) : isError ? (
            <QueryErrorFallback error={error} onRetry={refetch} />
          ) : isLoading ? (
            <div className="py-16 text-center text-gray-400 animate-pulse"><T k="녹화 목록 로딩 중..." /></div>
          ) : unexpectedShape ? (
            <div className="py-16 text-center text-sm text-red-600"><T k="녹화 서버 응답 모양이 예상과 다릅니다 — 0건으로 표시하지 않습니다." /></div>
          ) : recordings.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">📹</p>
              <p className="text-gray-500"><T k="녹화 파일이 없습니다" /></p>
              <p className="text-xs text-gray-400 mt-1"><T k="원격진료 시 녹화 동의 후 Jitsi에서 녹화를 시작하세요" /></p>
            </div>
          ) : (
            recordings.map(r => (
              <button key={r.id} onClick={() => { setSelected(r); setEditMemo(r.memo ?? ''); setEditTags(r.tags ?? ''); }}
                className={`w-full text-left bg-white border rounded-xl p-4 hover:border-blue-300 transition ${selected?.id === r.id ? 'border-blue-500 bg-blue-50/30' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-gray-900">{r.roomName ?? r.fileName ?? 'Unknown'}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${r.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : r.status === 'recording' ? 'bg-red-100 text-red-700 animate-pulse' : 'bg-gray-100 text-gray-600'}`}>
                    <T k={r.status === 'completed' ? '완료' : r.status === 'recording' ? '녹화중' : r.status === 'processing' ? '처리중' : r.status} />
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span>{fmtDur(r.duration)}</span>
                  <span>{fmtSize(r.fileSize)}</span>
                  <span>{fmtDt(r.startedAt)}</span>
                </div>
                {r.memo && <p className="text-xs text-gray-600 mt-1 truncate">{r.memo}</p>}
                {r.tags && (
                  <div className="flex gap-1 mt-1">
                    {r.tags.split(',').map((t, i) => <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{t.trim()}</span>)}
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* 상세 */}
        {selected && (
          <div className="w-96 shrink-0 bg-white border rounded-xl p-5 space-y-3 sticky top-4">
            <div className="flex justify-between items-start">
              <h3 className="text-sm font-bold text-gray-900"><T k="녹화 상세" /></h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 text-lg">&times;</button>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-500"><T k="방이름" /></span><span className="font-medium">{selected.roomName ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="파일" /></span><span className="font-mono text-[10px]">{selected.fileName ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="크기" /></span><span>{fmtSize(selected.fileSize)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="길이" /></span><span>{fmtDur(selected.duration)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="시작" /></span><span>{fmtDt(selected.startedAt)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="완료" /></span><span>{fmtDt(selected.completedAt)}</span></div>
            </div>

            {/* 메모/태그 편집 */}
            <div className="space-y-2 border-t pt-3">
              <div>
                <label className="text-[10px] text-gray-500 mb-0.5 block"><T k="메모 (진료 기록 연동)" /></label>
                <textarea value={editMemo} onChange={e => setEditMemo(e.target.value)} rows={2}
                  placeholder={tAttr('예: 2026-05-29 김의사-환자A 원격 진료')}
                  className="w-full px-2 py-1.5 border rounded-lg text-xs resize-none" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-0.5 block"><T k="태그 (쉼표 구분)" /></label>
                <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder={tAttr('진료,내과,원격')}
                  className="w-full px-2 py-1.5 border rounded-lg text-xs" />
              </div>
              <button onClick={() => updateMemo(selected.id)}
                className="w-full py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700">
                <T k="메모 저장" />
              </button>
            </div>

            {/* 액션 */}
            <div className="flex gap-2 border-t pt-3">
              {selected.status === 'completed' && (
                <button onClick={() => downloadRec(selected.id, selected.fileName)}
                  className="flex-1 text-center py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700">
                  <T k="다운로드" />
                </button>
              )}
              {canDelete ? (
                <button onClick={() => deleteRec(selected.id)}
                  className="px-4 py-2 bg-red-100 text-red-700 text-xs font-bold rounded-lg hover:bg-red-200">
                  <T k="삭제" />
                </button>
              ) : (
                /* 쓰기 UI 를 숨긴 자리에 왜 없는지를 말한다 — 빈 자리는 "기능이 없다"로 읽힌다 */
                <p className="px-2 py-2 text-[10px] text-gray-400 self-center"><T k="삭제는 관리자 권한입니다(녹화는 의무기록의 일부)" /></p>
              )}
            </div>

            <p className="text-[8px] text-gray-300"><T k="녹화 파일은 의무기록의 일부로 10년간 보존됩니다 (의료법 시행규칙)." /></p>
          </div>
        )}
      </div>
    </div>
  );
}
