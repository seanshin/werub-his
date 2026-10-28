'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';
import { KDate, EmptyState, StatusShapeMark, type StatusShape } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * TV 디스플레이 관리(D8·outpatient-clinic-queue-tv-board.plan.md) — 보드 카탈로그 + 운영 키 한곳.
 * 🔴 종전엔 DisplayApiKey 발급 경로가 0(모델만 존재) — 키 수명주기 관리 신설.
 */

const BOARDS: { path: string; name: string; desc: string; auth: '공개' | '키'; deptParam: boolean }[] = [
  { path: '/display/clinic-queue', name: '외래 진료실 대기 보드', desc: '진료과·진료실별 대기/호출/진료중 + 호출 배너 (신형·ER 디자인 언어)', auth: '공개', deptParam: true },
  { path: '/display/er-flow', name: '응급실 진행 현황 보드', desc: '환자별 도착→분류→배정→진료·검사→처분→퇴실 6단계 + 대기시간', auth: '공개', deptParam: false },
  { path: '/display/waiting', name: '외래 호출 전광판 (구형)', desc: '과별 호출·대기 목록 — 기설치 단말 호환 유지', auth: '공개', deptParam: true },
  { path: '/display/kiosk', name: '접수 키오스크', desc: '셀프 접수 단말', auth: '공개', deptParam: false },
];
// 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

interface KeyRow { id: string; name: string; keyPrefix: string; boardType: string | null; config: { departments?: string[] } | null; isActive: boolean; lastUsedAt: string | null; createdAt: string }
// 🔴 `checkup` 누락 — 지정해도 목록이 원시 문자열을 흘렸다(W9). 라디오 선택지와 한 벌로 유지할 것.
const BOARD_LABEL: Record<string, string> = { 'clinic-queue': '외래 진료실 대기', 'er-flow': '응급실 진행', waiting: '외래 호출(구형)', checkup: '건강검진 대기' };

export default function DisplaysAdminPage() {
  const tAttr = useTAttr();
  const { names: depts } = useDepartments({ category: 'CLINICAL' });
  const qc = useQueryClient();
  const [deptSel, setDeptSel] = useState<Record<string, string[]>>({});
  const [newKeyName, setNewKeyName] = useState('');
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);

  const keysQ = useQuery({
    queryKey: ['display-keys'],
    queryFn: () => apiClient.get<{ data: KeyRow[] }>('/api/v1/displays/keys'),
  });
  const keys = keysQ.data?.data ?? [];

  const createMut = useMutation({
    mutationFn: () => apiClient.post<{ data: { name: string; key: string } }>('/api/v1/displays/keys', { name: newKeyName.trim() }),
    onSuccess: (res) => {
      setIssued(res.data);
      setNewKeyName('');
      qc.invalidateQueries({ queryKey: ['display-keys'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '발급 실패'),
  });
  const toggleMut = useMutation({
    mutationFn: (p: { id: string; isActive: boolean }) => apiClient.patch(`/api/v1/displays/keys/${p.id}`, { isActive: p.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['display-keys'] }),
    onError: (e) => toast.error((e as { message?: string })?.message || '변경 실패'),
  });

  const buildUrl = (b: (typeof BOARDS)[number]) => {
    const depts = deptSel[b.path] ?? [];
    const base = `${window.location.origin}${b.path}`;
    return b.deptParam && depts.length ? `${base}?departments=${encodeURIComponent(depts.join(','))}` : base;
  };
  const copyUrl = (b: (typeof BOARDS)[number]) => {
    navigator.clipboard.writeText(buildUrl(b)).then(() => toast.success('URL 을 복사했습니다 — TV 브라우저에 붙여넣어 전체화면으로 여세요.'));
  };
  const staleDays = (last: string | null) => (last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400_000) : null);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="TV 디스플레이 관리" /></h1>
        <p className="text-sm text-gray-500 mt-1"><T k="대기실·복도 TV 보드의 URL 구성과 운영 키(단말 식별)를 한곳에서 관리합니다." /></p>
      </div>

      {/* 보드 카탈로그 + URL 빌더 */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-gray-700"><T k="보드 카탈로그" /></p>
        {BOARDS.map((b) => (
          <div key={b.path} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-gray-900"><T k={b.name} /></p>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${b.auth === '공개' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                <T k={b.auth === '공개' ? '공개 (키 불요 · 생존 미추적)' : '운영 키 필요'} />
              </span>
              <span className="text-xs text-gray-400 font-mono">{b.path}</span>
              <span className="ml-auto flex gap-2">
                <button onClick={() => copyUrl(b)} className="px-2.5 py-1.5 text-xs font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700"><T k="URL 복사" /></button>
                <a href={buildUrl(b)} target="_blank" rel="noreferrer" className="px-2.5 py-1.5 text-xs font-semibold bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="미리보기" /> ↗</a>
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1"><T k={b.desc} /></p>
            {b.deptParam && (
              <div className="mt-2 flex gap-1.5 flex-wrap">
                {depts.map((d) => {
                  const on = (deptSel[b.path] ?? []).includes(d);
                  return (
                    <button key={d}
                      onClick={() => setDeptSel((m) => ({ ...m, [b.path]: on ? (m[b.path] ?? []).filter((x) => x !== d) : [...(m[b.path] ?? []), d] }))}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium border ${on ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {d}
                    </button>
                  );
                })}
                <span className="text-[10px] text-gray-400 self-center ml-1"><T k="선택 없음 = 전체 과 (층별 TV 는 해당 과만 선택)" /></span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 운영 키 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-gray-700"><T k="단말(박스)" /> <span className="text-xs font-normal text-gray-400"><T k="— 박스 URL 한 줄만 설정하면 표시 보드는 여기서 지정 · 마지막 접속=생존 신호" /></span></p>
          <div className="flex gap-2">
            <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder={tAttr('설치 위치 라벨 — 예: 3층 내과 복도 TV')}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-64" />
            <button onClick={() => createMut.mutate()} disabled={!newKeyName.trim() || createMut.isPending}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-40 hover:bg-blue-700"><T k="+ 발급" /></button>
          </div>
        </div>
        {keys.length === 0 ? (
          <EmptyState compact icon="🔑" title="발급된 운영 키가 없습니다" hint="공개 보드만 쓴다면 키 없이 운영해도 됩니다." />
        ) : (
          <div className="divide-y divide-gray-50">
            {keys.map((k) => {
              const days = staleDays(k.lastUsedAt);
              /**
               * 🔴 생존 상태가 색 점 하나였다 — 라벨·title 없이 회/초록/노랑만이라
               *    색각 이상·저조도에서 구분 불가였고, 노랑(1~6일 무접속) 구간은 색 외 단서가 0이었다.
               *    라벨+기호(StatusShapeMark·ui.a11y.statusShape)로 항상 글자가 함께 나온다.
               */
              const live: { shape: StatusShape; label: string; tone: string } =
                !k.isActive ? { shape: 'neutral', label: '비활성', tone: 'bg-gray-100 text-gray-500' }
                : days === null ? { shape: 'warn', label: '접속 기록 없음', tone: 'bg-amber-50 text-amber-600' }
                : days < 1 ? { shape: 'ok', label: '24시간 내 접속', tone: 'bg-emerald-50 text-emerald-600' }
                : days < 7 ? { shape: 'warn', label: `${days}일 무접속`, tone: 'bg-amber-50 text-amber-600' }
                : { shape: 'danger', label: `${days}일 무접속`, tone: 'bg-rose-50 text-rose-600' };
              return (
                <div key={k.id} className="flex items-center gap-3 py-2.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${live.tone}`}>
                    <StatusShapeMark shape={live.shape} />{live.label}
                  </span>
                  <Link href={`/admin/displays/${k.id}`} className="text-sm font-semibold text-gray-800 w-52 truncate hover:text-blue-600">{k.name}</Link>
                  <span className="text-xs w-44 truncate">
                    {k.boardType
                      ? <span className="font-semibold text-sky-600"><T k={BOARD_LABEL[k.boardType] ?? k.boardType} />{(k.config?.departments?.length ?? 0) > 0 ? ` · ${k.config!.departments!.length}개 과` : ''}</span>
                      : <span className="text-gray-400"><T k="보드 미지정" /></span>}
                  </span>
                  <span className="text-xs text-gray-500">
                    {k.lastUsedAt ? <><T k="마지막 접속" /> <KDate value={k.lastUsedAt} mode="datetime" /></> : <T k="접속 기록 없음" />}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <Link href={`/admin/displays/${k.id}`} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-700"><T k="세팅" /></Link>
                    <button onClick={() => toggleMut.mutate({ id: k.id, isActive: !k.isActive })}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${k.isActive ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                      <T k={k.isActive ? '비활성' : '재활성'} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 발급 1회 노출 모달 */}
      {issued && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setIssued(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900"><T k="운영 키 발급" /> — {issued.name}</h3>
            <p className="text-xs text-rose-600 font-medium">이 키는 지금 한 번만 표시됩니다. 목록의 <b>세팅</b>에서 표시할 보드를 지정하고 박스 URL 을 TV 에 등록하세요.</p>
            <code className="block bg-gray-900 text-emerald-300 text-xs rounded-xl p-3 break-all select-all">{issued.key}</code>
            <button onClick={() => { navigator.clipboard.writeText(issued.key); toast.success('키를 복사했습니다.'); }}
              className="w-full py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700"><T k="키 복사" /></button>
            <button onClick={() => setIssued(null)} className="w-full py-2 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="닫기" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
