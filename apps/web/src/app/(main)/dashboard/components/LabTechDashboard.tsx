'use client';

import { T } from '@/components/ui/i18n-text';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';

/**
 * 검사실 업무 요약 — 검사·영상 대기열의 단계별 건수.
 *
 * 🔴 (2026-10-02 역할별 대시보드 재검토)
 *  - 장비 칸이 `/api/v1/equipment`(관리자·행정 전용)를 불러 **검사실 계정에 늘 403**("조회 실패")이었다. 그 목록은 병원 전체
 *    장비(수술·응급 장비 포함)에 구매가·공급처 연락처까지 담고 검사실 장비를 가를 필드가 없다 → 권한을 넓히지 않고 칸을 뺐다.
 *  - '영상 대기'가 `/orders?department=IMAGING&status=ORDERED`(접수 전만)라 같은 배치의 '영상 대기열' 위젯(`/imaging/queue` —
 *    촬영 중 포함)과 수가 달랐다(실측 8 vs 13) → 같은 응답에서 단계별로 센다.
 *  - 검사·영상 대기 목록을 같은 배치의 대기열 위젯과 **두 번** 그렸다 → 목록은 위젯, 여기는 단계 요약.
 *  - 접수됨(RECEIVED)이 어느 칸에도 세지지 않았다 → '진행 중'에 함께 센다(라벨에 밝힌다).
 */
interface QueueItem { id: string; status: string }

const listOf = (raw: unknown): QueueItem[] => (Array.isArray(raw) ? raw : ((raw as { data?: QueueItem[] })?.data ?? []));

export default function LabTechDashboard() {
  // 경로는 리터럴로 둔다 — 역할×EP 정합 스캐너가 호출 자리를 읽는다(인자로 넘기면 스캐너가 못 본다)
  const lab = useQuery({
    queryKey: ['lab-queue-dash'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/lab/queue'),
    refetchInterval: pollMs('fast'),
  });
  const imaging = useQuery({
    queryKey: ['imaging-queue-dash'],
    queryFn: () => apiClient.get<{ data: QueueItem[] }>('/api/v1/imaging/queue'),
    refetchInterval: pollMs('fast'),
  });
  const labList = listOf(lab.data?.data);
  const imgList = listOf(imaging.data?.data);
  const n = (list: QueueItem[], ...st: string[]) => list.filter((o) => st.includes(o.status)).length;

  const cells: Array<{ key: string; label: string; note?: string; href: string; q: typeof lab; value: number; tone: string }> = [
    { key: 'lab-ordered', label: '검사 접수 대기', href: '/lab', q: lab, value: n(labList, 'ORDERED'), tone: 'text-indigo-700' },
    { key: 'lab-progress', label: '검사 진행 중', note: '접수됨 포함', href: '/lab', q: lab, value: n(labList, 'RECEIVED', 'IN_PROGRESS'), tone: 'text-amber-700' },
    { key: 'img-ordered', label: '영상 접수 대기', href: '/imaging', q: imaging, value: n(imgList, 'ORDERED'), tone: 'text-pink-700' },
    { key: 'img-progress', label: '촬영 중', note: '접수됨 포함', href: '/imaging', q: imaging, value: n(imgList, 'RECEIVED', 'IN_PROGRESS'), tone: 'text-violet-700' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <Link key={c.key} href={c.href} data-lab-stage={c.key} className="rounded-xl border border-gray-100 px-3 py-2.5 hover:border-slate-300">
          <p className="text-[11px] text-gray-500"><T k={c.label} />{c.note && <span className="text-gray-400"> (<T k={c.note} />)</span>}</p>
          {/* 🔴 조회 실패에 0 을 그리지 않는다 — "대기 없음"과 "모른다"는 다른 사실이다 */}
          <p className={`text-2xl font-bold tabular-nums ${c.q.isError ? 'text-sm font-medium text-red-600' : c.tone}`}>
            {c.q.isError ? <T k="조회 실패" /> : c.q.isLoading ? '…' : c.value}
          </p>
        </Link>
      ))}
    </div>
  );
}
