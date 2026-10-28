'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments } from '@/lib/use-departments';
import { toast } from '@/stores/toast-store';
import { KDate } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * TV 박스(운영 키) 세팅 화면(D9) — 이 단말이 무엇을 틀지 지정한다.
 * 단말에는 박스 URL 한 줄만 설정하고, 여기서 바꾸면 TV 는 60초 안에 스스로 반영한다.
 */

const BOARD_TYPES: { value: string; label: string; desc: string; needsDept: boolean; hasTts: boolean }[] = [
  { value: 'clinic-queue', label: '외래 진료실 대기', desc: '진료과·진료실별 대기/호출/진료중 + 호출 배너·음성', needsDept: true, hasTts: true },
  { value: 'er-flow', label: '응급실 진행 현황', desc: '환자별 도착→분류→배정→진료·검사→처분→퇴실 6단계', needsDept: false, hasTts: false },
  { value: 'waiting', label: '외래 호출 전광판(구형)', desc: '기설치 단말 호환 — 신규 지정은 권장하지 않음', needsDept: true, hasTts: false },
  // 🔴 보드는 살아 있는데 지정할 수단이 없었다 — 화면 실사용 점검 W9(2026-08-14).
  //    `/display/checkup` 은 운영 중인데 이 라디오에 없어 **박스 단말에 검진 보드를 지정할 수 없었다.**
  //    (서버·박스 경로는 같은 점검에서 배선했다. EP 를 만들면 부르는 화면까지가 한 벌이다.)
  { value: 'checkup', label: '건강검진 대기', desc: '검진센터 스테이션별 대기·호출(공개·서버 마스킹)', needsDept: false, hasTts: false },
];
// 진료과 목록 정본 = 마스터(useDepartments) — 로컬 배열 재정의 금지(input-assist-ux P1)

interface BoxDetail {
  id: string; name: string; key: string; boardType: string | null;
  config: { departments?: string[]; tts?: boolean } | null;
  isActive: boolean; lastUsedAt: string | null; createdAt: string;
}

export default function DisplayBoxSettingPage({ params }: { params: Promise<{ keyId: string }> }) {
  const tAttr = useTAttr();
  const { names: deptMaster } = useDepartments({ category: 'CLINICAL' });
  const { keyId } = use(params);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [boardType, setBoardType] = useState('');
  const [depts, setDepts] = useState<string[]>([]);
  const [tts, setTts] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const boxQ = useQuery({
    queryKey: ['display-box', keyId],
    queryFn: () => apiClient.get<{ data: BoxDetail }>(`/api/v1/displays/keys/${keyId}`),
  });
  const box = boxQ.data?.data;

  useEffect(() => {
    if (box && !hydrated) {
      setName(box.name);
      setBoardType(box.boardType ?? '');
      setDepts(box.config?.departments ?? []);
      setTts(box.config?.tts ?? false);
      setHydrated(true);
    }
  }, [box, hydrated]);

  const saveMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/displays/keys/${keyId}`, {
      name: name.trim(),
      boardType: boardType || null,
      config: { departments: depts, tts },
    }),
    onSuccess: () => {
      toast.success('저장했습니다 — 해당 TV 는 1분 안에 스스로 반영합니다.');
      qc.invalidateQueries({ queryKey: ['display-box', keyId] });
      qc.invalidateQueries({ queryKey: ['display-keys'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '저장 실패'),
  });
  const toggleActiveMut = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/displays/keys/${keyId}`, { isActive: !box?.isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['display-box', keyId] }); qc.invalidateQueries({ queryKey: ['display-keys'] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || '변경 실패'),
  });

  if (!box) return <div className="text-sm text-gray-400"><T k="불러오는 중…" /></div>;

  const boxUrl = typeof window !== 'undefined' ? `${window.location.origin}/display/box/${box.key}` : '';
  const selected = BOARD_TYPES.find((b) => b.value === boardType);
  const days = box.lastUsedAt ? Math.floor((Date.now() - new Date(box.lastUsedAt).getTime()) / 86400_000) : null;

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href="/admin/displays" className="text-xs text-gray-400 hover:text-gray-600">← <T k="TV 디스플레이 관리" /></Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1"><T k="단말 세팅" /> — {box.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          이 단말이 표시할 보드를 지정합니다. TV 에는 아래 <b>박스 URL 한 줄만</b> 설정하면 되고, 여기서 바꾸면 <b>TV 를 만지지 않아도 1분 안에 반영</b>됩니다.
        </p>
      </div>

      {/* 상태 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4 flex-wrap">
        <span className={`w-2.5 h-2.5 rounded-full ${!box.isActive ? 'bg-gray-300' : days !== null && days < 1 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        <span className="text-sm text-gray-600">
          <T k={box.isActive ? '활성' : '비활성'} /> · {box.lastUsedAt ? <><T k="마지막 접속" /> <KDate value={box.lastUsedAt} mode="datetime" /></> : <T k="접속 기록 없음" />}
        </span>
        {box.isActive && days !== null && days >= 7 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-600">{days}일 무접속</span>}
        <button onClick={() => toggleActiveMut.mutate()}
          className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold ${box.isActive ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
          <T k={box.isActive ? '비활성' : '재활성'} />
        </button>
      </div>

      {/* 박스 URL */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <p className="text-sm font-bold text-gray-700 mb-2"><T k="박스 URL" /> <span className="text-xs font-normal text-gray-400"><T k="— TV 브라우저에 이 주소만 등록하고 전체화면으로 두세요" /></span></p>
        <div className="flex gap-2">
          <code className="flex-1 bg-gray-900 text-emerald-300 text-xs rounded-xl px-3 py-2.5 break-all select-all">{boxUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(boxUrl); toast.success('URL 을 복사했습니다.'); }}
            className="px-3 py-2 text-xs font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700 whitespace-nowrap"><T k="복사" /></button>
          <a href={boxUrl} target="_blank" rel="noreferrer" className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 whitespace-nowrap"><T k="미리보기" /> ↗</a>
        </div>
      </div>

      {/* 지정 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5"><T k="설치 위치 라벨" /></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tAttr('예: 3층 내과 복도 TV')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>

        <div>
          <p className="text-xs font-bold text-gray-700 mb-1.5"><T k="표시할 보드" /></p>
          <div className="space-y-2">
            {BOARD_TYPES.map((b) => (
              <label key={b.value} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${boardType === b.value ? 'border-blue-300 bg-blue-50/50' : 'border-gray-100 hover:border-gray-200'}`}>
                <input type="radio" name="boardType" checked={boardType === b.value} onChange={() => setBoardType(b.value)} className="mt-1" />
                <span>
                  <span className="text-sm font-semibold text-gray-800"><T k={b.label} /></span>
                  <span className="block text-xs text-gray-500 mt-0.5"><T k={b.desc} /></span>
                </span>
              </label>
            ))}
            <label className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${!boardType ? 'border-gray-300 bg-gray-50' : 'border-gray-100 hover:border-gray-200'}`}>
              <input type="radio" name="boardType" checked={!boardType} onChange={() => setBoardType('')} />
              <span className="text-sm text-gray-600"><T k="미지정 (안내 화면 표시)" /></span>
            </label>
          </div>
        </div>

        {selected?.needsDept && (
          <div>
            <p className="text-xs font-bold text-gray-700 mb-1.5"><T k="표시할 진료과" /> <span className="font-normal text-gray-400"><T k="— 선택 없음 = 전체 과" /></span></p>
            <div className="flex gap-1.5 flex-wrap">
              {deptMaster.map((d) => {
                const on = depts.includes(d);
                return (
                  <button key={d} onClick={() => setDepts((m) => on ? m.filter((x) => x !== d) : [...m, d])}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium border ${on ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selected?.hasTts && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={tts} onChange={(e) => setTts(e.target.checked)} />
            <T k="음성 호출 사용" /> <span className="text-xs text-gray-400"><T k="(TV 브라우저 정책상 설치 후 화면에서 한 번 켜야 소리가 납니다)" /></span>
          </label>
        )}

        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-40">
          <T k={saveMut.isPending ? '저장 중…' : '저장'} />
        </button>
      </div>
    </div>
  );
}
