'use client';

import { Unit, EmptyState } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 시설 관리.
 *
 * 🔴 2026-08-14 W8(P15/P16) — 이 화면의 **아래쪽 전부가 코드에 박힌 상수**였다.
 *    9개 섹션 45개 항목(내과 1진료실 담당 '김내과', 수납창구 2개, 카페/편의점 영업시간,
 *    B2 주차장 120대, 장례식장 5개 빈소와 전화번호 02-1234-5670, 층별 배치도 7개 층)이
 *    전부 가짜였고, 병원에 실제로 무엇이 있는지와 무관하게 초록 점으로 '가동중'을 그렸다.
 *    「설정 편집」 버튼은 편집 모드를 켰고, 켜지면 나타나는 「편집」 버튼에는 **onClick 이 없었다** —
 *    누르면 아무 일도 일어나지 않는데 화면은 편집할 수 있는 것처럼 보였다.
 *
 *    시설 마스터(진료실·데스크·간호스테이션·편의시설·주차장·장례식장) 모델은 이 시스템에 없다.
 *    없는 것을 상수로 지어내는 대신 **실제로 조회되는 것만 보여주고**(병동/병상·수술실),
 *    나머지는 **빈 상태로 그 사실을 말한다**(표본 부재의 정답은 폴백이 아니라 빈 목록).
 *    죽은 버튼은 없앴다.
 */

interface Bed {
  id: string;
  bedNumber: string;
  roomNumber: string;
  status: string;
}

interface Ward {
  id: string;
  name: string;
  floor: number;
  beds: Bed[];
}

interface BedStatusCount {
  status: string;
  _count: number;
}

interface BedStatusSummary {
  total: number;
  byStatus: BedStatusCount[];
}

interface OperatingRoomRow {
  id: string;
  name: string;
  floor: string | null;
  roomType: string;
  isActive: boolean;
}

/** 표시 전용(렌더 키) — '정형'·'심장'·'신경' 은 장기명·진료과명과 겹칠 수 있어 수술실 유형 문맥 키로 가른다.
 *  ko 표시는 `@` 앞만 나가므로 글자 그대로다. '일반' 은 먼저 등록된 맨 키(Regular)를 그대로 쓴다 —
 *  `일반@수술실` 은 추가 언어 팩 6종 모두에 문맥 결손을 만든다(팩은 이 갈래 소유가 아니다). */
const OR_TYPE_LABEL: Record<string, string> = {
  GENERAL: '일반', ORTHO: '정형@수술실', CARDIAC: '심장@수술실', NEURO: '신경@수술실', MINOR_PROCEDURE: '소수술/시술', HYBRID: '하이브리드',
};

function unwrap<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export default function FacilityPage() {
  const tAttr = useTAttr();
  const { data: wardsData, isError, error, refetch } = useQuery({
    queryKey: ['wards'],
    queryFn: () => apiClient.get<{ data: Ward[] }>('/api/v1/beds/wards'),
  });
  const { data: bedStatus } = useQuery({
    queryKey: ['bed-status'],
    queryFn: () => apiClient.get<{ data: BedStatusSummary }>('/api/v1/beds/status'),
  });
  // 수술실은 실제 마스터(OperatingRoom)가 있는 유일한 비병상 시설이다.
  const { data: orData, isError: orIsError, error: orError, refetch: refetchOr } = useQuery({
    queryKey: ['facility-or-rooms'],
    queryFn: () => apiClient.get<{ data: OperatingRoomRow[] }>('/api/v1/surgery/rooms'),
  });

  const wards: Ward[] = unwrap<Ward>(wardsData?.data);
  const orRooms: OperatingRoomRow[] = unwrap<OperatingRoomRow>(orData?.data);
  const totalBeds = bedStatus?.data?.total ?? 0;
  const statusCounts: Record<string, number> = {};
  (bedStatus?.data?.byStatus ?? []).forEach((s: BedStatusCount) => { statusCounts[s.status] = s._count; });

  // 층별 배치도는 '그려둔 그림'이 아니라 등록된 병동·수술실에서 파생한다(없는 층은 만들지 않는다).
  const floorMap = new Map<string, string[]>();
  wards.forEach((w) => {
    const key = `${w.floor}F`;
    floorMap.set(key, [...(floorMap.get(key) ?? []), w.name]);
  });
  orRooms.forEach((r) => {
    if (!r.floor) return;
    const key = r.floor.toUpperCase().endsWith('F') ? r.floor.toUpperCase() : `${r.floor}F`;
    floorMap.set(key, [...(floorMap.get(key) ?? []), r.name]);
  });
  const floors = [...floorMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }));

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900"><T k="시설 관리" /></h2>
        {/* 🔴 번역 단위는 **문장**이다 — 첫 문장은 온전한 한 문장이라 배선한다.
            둘째 문장은 중간에 <b> 가 들어가 조각으로 쪼개면 어순이 깨진다(정본 선례: admin6 §②) — 원문 유지 */}
        <p className="text-sm text-gray-500 mt-1"><T k="등록된 병동·병상과 수술실 현황입니다." /> <Tf k="이 화면은 {강조} 보여줍니다." params={{ 강조: <b><T k="등록된 것만" /></b> }} /></p>
      </div>

      {/* Bed Summary */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" /></svg>
          {/* 보간 문장(총 N병상) — 조각으로 쪼개지 않는다 */}
          <Tf k="병동/병상 현황 (총 {병상}병상)" params={{ 병상: totalBeds }} />
        </h3>
        <div className="flex gap-3 mb-5">
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">
            <T k="이용가능" /> {statusCounts['AVAILABLE'] ?? 0}
          </span>
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700">
            <T k="사용중" /> {statusCounts['OCCUPIED'] ?? 0}
          </span>
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700">
            {/* 🔴 '예약'은 진료 예약(Appointment)과 동음이의 — 병상 상태는 `예약@병상`(Reserved) */}
            <T k="예약@병상" /> {statusCounts['RESERVED'] ?? 0}
          </span>
          <span className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">
            <T k="정비" /> {statusCounts['MAINTENANCE'] ?? 0}
          </span>
        </div>

        {wards.length === 0 ? (
          <EmptyState compact icon="🛏️" title="등록된 병동이 없습니다" hint="병동·병상은 병상 관리에서 등록합니다." />
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wards.map((ward: Ward) => {
            const beds = ward.beds ?? [];
            const available = beds.filter((b: Bed) => b.status === 'AVAILABLE').length;
            const occupied = beds.filter((b: Bed) => b.status === 'OCCUPIED').length;
            // Group beds by room
            const rooms: Record<string, Bed[]> = {};
            beds.forEach((b: Bed) => {
              if (!rooms[b.roomNumber]) rooms[b.roomNumber] = [];
              rooms[b.roomNumber].push(b);
            });

            return (
              <div key={ward.id} className="border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">{ward.name}</h4>
                    <p className="text-xs text-gray-400">{ward.floor}<Unit>층</Unit> · <Tf k="{수}병상" params={{ 수: beds.length }} /></p>
                  </div>
                  {/* 숫자에 붙은 단위(N가용·N사용) — <Unit> 로 감싸면 글자 크기가 바뀐다(표현 변경).
                      보간 키로 옮긴다 — `{n}<T k="가용" />` 조각은 영어에서 `3available` 이 된다 */}
                  <div className="flex gap-1.5 text-xs">
                    <Tf className="text-emerald-600 font-medium" k="{수}가용" params={{ 수: available }} />
                    <span className="text-gray-300">|</span>
                    <Tf className="text-blue-600 font-medium" k="{수}사용" params={{ 수: occupied }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(rooms).map(([roomNum, roomBeds]) => (
                    <div key={roomNum} className="flex items-center gap-0.5">
                      <span className="text-[10px] text-gray-400 mr-0.5">{roomNum}</span>
                      {roomBeds.map((bed: Bed) => (
                        <div
                          key={bed.id}
                          title={`${roomNum}-${bed.bedNumber} (${bed.status})`}
                          className={`w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold cursor-pointer transition-colors ${
                            bed.status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' :
                            bed.status === 'OCCUPIED' ? 'bg-blue-100 text-blue-700' :
                            bed.status === 'RESERVED' ? 'bg-amber-100 text-amber-700' :
                            'bg-gray-200 text-gray-500'
                          }`}
                        >
                          {bed.bedNumber}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* 수술실 — 실제 마스터(OperatingRoom) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900"><T k="수술실" /></h3>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{orIsError ? <T k="조회 실패" /> : <Tf k="{수}개@수술실" params={{ 수: orRooms.length }} />}</span>
        </div>
        {orIsError ? (
          <QueryErrorFallback error={orError} onRetry={() => refetchOr()} size="compact" />
        ) : orRooms.length === 0 ? (
          <EmptyState compact icon="🔧" title="등록된 수술실이 없습니다" hint="수술실은 수술 관리에서 등록합니다." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {orRooms.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg border border-gray-100">
                {/* 🔴 색만으로 운영 여부를 말하지 않는다(§4.6) — 의미는 r.isActive 에서 가져온다.
                    옆 텍스트(층·유형)에는 운영 여부가 없다 */}
                <span aria-label={r.isActive ? tAttr('운영 중') : tAttr('미운영')} title={r.isActive ? tAttr('운영 중') : tAttr('미운영')}
                  className={`w-2 h-2 rounded-full ${r.isActive ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-400">
                    {r.floor ?? tAttr('층 미등록')} · <T k={OR_TYPE_LABEL[r.roomType] ?? r.roomType} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 그 밖의 시설 — 마스터가 없다. 지어내지 않는다. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1"><T k="그 밖의 시설" /></h3>
        <p className="text-xs text-gray-400 mb-4"><T k="외래 진료실 · 원무/접수 창구 · 간호 스테이션 · 검사/영상실 · 편의시설 · 주차장 · 장례식장" /></p>
        <EmptyState
          compact
          icon="🏢"
          title="시설 마스터가 등록되어 있지 않습니다"
          hint="이 항목들을 담는 마스터가 아직 시스템에 없습니다. 등록 기능이 만들어지기 전까지 이 화면은 비어 있는 것이 정상입니다."
        />
      </div>

      {/* 층별 배치도 — 등록된 병동·수술실에서 파생 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-1"><T k="층별 배치도" /></h3>
        <p className="text-xs text-gray-400 mb-4"><T k="등록된 병동·수술실 위치에서 산출합니다. 시설 마스터가 없는 공간(로비·검사실 등)은 표시되지 않습니다." /></p>
        {floors.length === 0 ? (
          <EmptyState compact icon="🗺️" title="층 정보를 산출할 자료가 없습니다" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {floors.map(([floor, names]) => (
              <div key={floor} className="text-center p-3 rounded-xl border border-gray-100">
                <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-lg bg-blue-100 text-blue-700 mb-1.5">{floor}</span>
                <p className="text-[11px] text-gray-500 leading-tight">{names.join(', ')}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
