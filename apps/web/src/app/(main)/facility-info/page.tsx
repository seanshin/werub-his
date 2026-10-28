'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Data, T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { HOSPITAL } from '@/components/homepage/hospital-facts';
import { HOSPITAL_CONTACT } from '@/lib/hospital-contact';

/*
 * 🔴 i18n(ops12) — 이 화면의 FLOORS·CONTACTS·안내 카드 **세부 문구**(층 이름·시설명·가격·운영 시간·전화번호·
 *    업소명 '한우리'·'메디치노')는 **기관 데이터**다(화면 크롬이 아니다). 번역하지 않았다 — 기관 정체성 축(§12-C).
 *    게다가 이 하드코딩 값은 기관 정본(`system_configs.hospital.*` = 가상 가상시·+82-2)과 **어긋난다**
 *    (서울 강남·02- 번호). 번역하면 검증되지 않은 기관 사실을 언어마다 복제하게 된다.
 *    번역한 것: 제목·섹션 머리·연락처 라벨·안내 카드 제목·요일 라벨(크롬).
 */

const FLOORS = [
  {
    floor: 'B3~B1', title: '지하',
    sections: [
      { name: '주차장 (B1~B3)', detail: '총 320대 · 진료 2시간 무료 · 이후 30분당 1,000원 · 1일 최대 15,000원', icon: '🅿️', color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
      { name: 'B1 장애인/전기차', detail: '장애인 전용 10대 · 전기차 충전 4대 (급속2+완속2)', icon: '♿', color: 'bg-indigo-50 border-indigo-200 text-indigo-600' },
      { name: '구내식당 "한우리"', detail: '조식 07:00~09:00 / 중식 11:30~14:00 / 석식 17:00~19:00', icon: '🍚', color: 'bg-amber-50 border-amber-200 text-amber-700' },
      { name: '푸드코트', detail: '분식·중식·죽 · 10:00~20:00', icon: '🍜', color: 'bg-amber-50 border-amber-200 text-amber-700' },
      { name: '중앙공급실 (CSSD)', detail: '멸균·소독 장비 관리', icon: '🧹', color: 'bg-gray-50 border-gray-200 text-gray-600' },
    ],
  },
  {
    floor: '1층', title: '로비·응급',
    sections: [
      { name: '원무과 (접수·수납)', detail: '접수 데스크 2, 수납 창구 2 · 평일 08:30~17:30', icon: '🚪', color: 'bg-blue-50 border-blue-200 text-blue-700' },
      { name: '응급실', detail: '24시간 운영 · KTAS 5단계 트리아지', icon: '🚑', color: 'bg-red-50 border-red-200 text-red-700' },
      { name: '약국 (조제실)', detail: '처방 조제 · 복약지도 · 09:00~18:00', icon: '💊', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
      { name: '카페 메디치노', detail: '아메리카노 3,500 / 카페라떼 4,500 / 샌드위치 5,500 · 07:00~20:00', icon: '☕', color: 'bg-orange-50 border-orange-200 text-orange-700' },
      { name: 'CU 편의점', detail: '도시락·간식·생필품·의약외품 · 06:00~23:00', icon: '🏪', color: 'bg-green-50 border-green-200 text-green-700' },
      { name: '건강검진센터 접수', detail: '종합검진/국가검진 접수', icon: '📋', color: 'bg-teal-50 border-teal-200 text-teal-700' },
    ],
  },
  {
    floor: '2층', title: '외래·검사',
    sections: [
      { name: '외래 진료실', detail: '내과·외과·정형외과·소아·산부·안과·이비인후·피부', icon: '🩺', color: 'bg-blue-50 border-blue-200 text-blue-700' },
      { name: '채혈실·검사실', detail: '임상병리, 심전도, 소변검사', icon: '🔬', color: 'bg-violet-50 border-violet-200 text-violet-700' },
      { name: '영상의학과', detail: 'X-ray, CT, MRI, 초음파', icon: '📷', color: 'bg-violet-50 border-violet-200 text-violet-700' },
    ],
  },
  {
    floor: '3층', title: '내과 병동',
    sections: [
      { name: '내과 병동 (301~320호)', detail: '일반 병실 · 간호스테이션 · 처치실', icon: '🏥', color: 'bg-sky-50 border-sky-200 text-sky-700' },
    ],
  },
  {
    floor: '4층', title: '외과 병동·수술',
    sections: [
      { name: '외과 병동 (401~420호)', detail: '일반 병실', icon: '🏥', color: 'bg-sky-50 border-sky-200 text-sky-700' },
      { name: '수술실 (OR 1~4)', detail: '수술실 4실 · 회복실(PACU)', icon: '🔪', color: 'bg-amber-50 border-amber-200 text-amber-700' },
    ],
  },
  {
    floor: '5층', title: '소아·산부',
    sections: [
      { name: '소아·산부 병동', detail: '병실 · 분만실 · 신생아실', icon: '👶', color: 'bg-pink-50 border-pink-200 text-pink-700' },
    ],
  },
  {
    floor: '6층', title: '정형외과·재활',
    sections: [
      { name: '정형외과 병동 (601~620호)', detail: '병실 · 간호스테이션', icon: '🏥', color: 'bg-sky-50 border-sky-200 text-sky-700' },
      { name: '재활치료실', detail: '물리치료·작업치료·언어치료', icon: '💪', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
    ],
  },
  {
    floor: '7층', title: '건강검진센터',
    sections: [
      { name: '건강검진 검사실', detail: '채혈·X-ray·초음파·심전도·내시경·신체계측', icon: '🧪', color: 'bg-teal-50 border-teal-200 text-teal-700' },
      { name: '검진 후 식사', detail: '검진 수검자 식사 제공', icon: '🍽️', color: 'bg-amber-50 border-amber-200 text-amber-600' },
    ],
  },
  {
    floor: '8층', title: '행정',
    sections: [
      { name: '행정부·의무기록실', detail: '병원 행정, 의무기록 관리', icon: '📊', color: 'bg-gray-50 border-gray-200 text-gray-700' },
      { name: '교육센터·도서실', detail: '직원 교육, 학술 자료 · 09:00~18:00', icon: '🎓', color: 'bg-purple-50 border-purple-200 text-purple-700' },
      { name: '회의실 (3실)', detail: '대회의실 1, 소회의실 2 · 사전예약', icon: '🗂️', color: 'bg-gray-50 border-gray-200 text-gray-600' },
    ],
  },
  {
    floor: '별관', title: '장례식장',
    sections: [
      { name: '빈소 1호 (대형 100명)', detail: '1,200,000원/일', icon: '🕊️', color: 'bg-gray-50 border-gray-200 text-gray-600' },
      { name: '빈소 2~3호 (중형 60명)', detail: '800,000원/일', icon: '🕊️', color: 'bg-gray-50 border-gray-200 text-gray-600' },
      { name: '빈소 4~5호 (소형 30명)', detail: '500,000원/일', icon: '🕊️', color: 'bg-gray-50 border-gray-200 text-gray-600' },
      // 🔴 `02-1234-5670` 은 지어낸 번호였다 — 정본이 없으므로 번호를 빼고 운영 시간만 남긴다
      { name: '안치실·사무실', detail: '24시간 운영', icon: '📞', color: 'bg-gray-50 border-gray-200 text-gray-600' },
      { name: '장례식장 주차장', detail: '별관 앞 전용 50대', icon: '🅿️', color: 'bg-indigo-50 border-indigo-200 text-indigo-600' },
    ],
  },
];

/**
 * 🔴 **여기 있던 `02-1234-5678`·`02-1234-5679`·`02-1234-5670` 은 전부 지어낸 번호였다**(2026-09-12 실측).
 *    앱에 **정본이 이미 있는데도**(`lib/hospital-contact.ts` — 2026-08-19 에 포털이 같은 실수를 해서 만든 파일)
 *    이 화면만 그 길을 지나지 않았다. 직원이 이 화면을 보고 거는 번호가 틀렸다는 뜻이다.
 *    → 대표·응급은 정본 경유. **장례식장은 정본이 없다** — 지어낸 번호를 쓰느니 "미등록"이라고 말한다
 *      (기획 `hospital-identity-canon.plan.md` §3: 설정 키 신설 여부는 사람 결정 · 기본은 내리는 쪽).
 * 🔴 내선 번호 3종도 확인된 값이 아니다 — 원내 교환 정본이 생기기 전까지 `unset` 로 둔다.
 */
const CONTACTS: { label: string; value: string | null; icon: string }[] = [
  { label: '대표전화', value: HOSPITAL_CONTACT.main, icon: '📞' },
  { label: '응급실', value: HOSPITAL_CONTACT.emergency, icon: '🚑' },
  { label: '장례식장', value: null, icon: '🕊️' },
  { label: '주차 문의', value: null, icon: '🅿️' },
  { label: '급양과', value: null, icon: '🍚' },
  { label: '원무과', value: null, icon: '🚪' },
];

type GuideCategory = 'PARKING' | 'DINING' | 'FUNERAL';
const GUIDE_CARDS: { category: GuideCategory; label: string; icon: string; box: string; head: string }[] = [
  { category: 'PARKING', label: '주차장', icon: '🅿️', box: 'bg-indigo-50 border-indigo-100', head: 'text-indigo-700' },
  { category: 'DINING', label: '식당·카페·편의점', icon: '🍚', box: 'bg-amber-50 border-amber-100', head: 'text-amber-700' },
  { category: 'FUNERAL', label: '장례식장', icon: '🕊️', box: 'bg-gray-50 border-gray-200', head: 'text-gray-700' },
];

interface PublicGuideRow { id: string; title: string; content: string }

/** 공개 조건 정본(서버 `publicVisibilityWhere`)을 지난 CMS 행만 — 3상태(행/없음/실패) + 로딩 */
function CmsGuideCard({ category, label, icon, box, head }: (typeof GUIDE_CARDS)[number]) {
  const q = useQuery({
    queryKey: ['public-hospital-info', category],
    queryFn: () => apiClient.get<{ data: PublicGuideRow[] }>(`/api/v1/public/hospital-info`, { category }),
  });
  const rows = q.data?.data ?? [];
  return (
    <div className={`rounded-xl border p-4 ${box}`}>
      <div className="text-lg mb-1">{icon}</div>
      <p className={`text-sm font-bold ${head}`}><T k={label} /></p>
      {q.isLoading ? (
        <p className="text-[11px] text-gray-400 mt-1"><T k="불러오는 중…" /></p>
      ) : q.isError ? (
        <div className="mt-1 text-[11px] text-red-600">
          <T k="안내를 불러오지 못했습니다" />{' '}
          <button type="button" onClick={() => q.refetch()} className="underline"><T k="다시 시도" /></button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-gray-500 mt-1"><T k="등록된 안내 없음" /></p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {rows.map((r) => (
            <div key={r.id}>
              <p className="text-[11px] font-semibold text-gray-700"><Data>{r.title}</Data></p>
              <p className="text-[11px] text-gray-600 whitespace-pre-line"><Data>{r.content}</Data></p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DirectoryFloor {
  id: string;
  name: string;
  floor: number | null;
  zones: { id: string; name: string; roomNumber: string | null }[];
}

/** 층 표식 — 지하는 B1, 지상은 1F(공간 정본의 층 번호에서 파생) */
const floorChip = (f: number | null) => (f == null ? '—' : f < 0 ? `B${-f}` : `${f}F`);

/**
 * 층 구성 — 공간 정본(SpaceNode). 🔴 (2026-09-28 P0-5) 종전 이 화면의 층 구성은 코드 상수 `FLOORS` 뿐이었고
 * 공간 모델·환자 앱과 층이 달랐다(검진센터 7층 ↔ B1). 층 구성은 이 칸이 시스템 기준이다.
 * 아래 `FLOORS` 시설 상세는 결정 `policy.facilityInfo.floorGuide` 대기 중인 예시라 지우지 않는다.
 */
function FloorDirectory() {
  const q = useQuery({
    queryKey: ['facility-directory'],
    queryFn: () => apiClient.get<{ data: DirectoryFloor[] }>('/api/v1/metaverse/directory'),
  });
  const floors = (q.data?.data ?? []) as DirectoryFloor[];
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold text-gray-900"><T k="층 구성" /></h2>
      <p className="text-[12px] text-gray-500">
        <T k="환자 앱의 검사실 안내와 같은 공간 모델에서 가져온 층·구역입니다. 아래 예시 안내와 층 배치가 다르면 이 목록이 시스템 기준입니다." />
      </p>
      {q.isError ? (
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
      ) : q.isLoading ? (
        <p className="text-sm text-gray-500"><T k="불러오는 중…" /></p>
      ) : floors.length === 0 ? (
        <EmptyState icon="🏢" title="등록된 층이 없습니다" compact />
      ) : (
        <div className="space-y-1.5">
          {floors.map((f) => (
            <div key={f.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2.5">
              <span className="min-w-[44px] rounded-lg bg-gray-800 px-2 py-1 text-center text-xs font-bold text-white">{floorChip(f.floor)}</span>
              <span className="text-sm font-semibold text-gray-800"><Data>{f.name}</Data></span>
              <div className="flex flex-1 flex-wrap gap-1">
                {f.zones.map((z) => (
                  <span key={z.id} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700">
                    <Data>{z.name}</Data>{z.roomNumber && !z.name.includes(z.roomNumber) ? ` ${z.roomNumber}` : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FacilityInfoPage() {
  const tAttr = useTAttr();
  const [expandedFloor, setExpandedFloor] = useState<string | null>(null);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="시설 안내" /></h1>
        {/* 🔴 종전엔 `서울시 강남구 · 강남역 3번 출구 도보 5분` — 기관 정본은 **가상 가상시**다.
            `HOSPITAL.seoulOffice` 는 사무소 주소이지 병원 소재지가 아닌데 그것이 병원 위치로 둔갑해 있었다.
            도보 안내는 어느 정본에도 없어 **지웠다**(길 안내를 지어내지 않는다). */}
        <p className="text-sm text-gray-500 mt-1">{HOSPITAL.name} · {HOSPITAL.address}</p>
      </div>

      {/*
        🔴 **화면이 스스로 한계를 말한다.** 아래 층별 안내·시설 상세(정원·가격·운영 시간·업소명)는
           `system_configs`·CMS 어디에도 정본이 없다 — 코드가 든 예시값이다. 종전에는 그 사실이
           어디에도 없어서 직원이 **확인된 기관 사실로 읽었다**(P15). 값을 지우는 것은 사람 결정이라
           (기획 §3 — 설정 키 신설 vs 안내 철거) 지우지 않고, **무엇이 확인된 값인지 그 자리에서 가른다.**
      */}
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] leading-relaxed text-amber-800">
        <T k="위 기관명·주소·대표/응급 연락처만 원내 정본에서 온 값입니다. 아래 층별 안내와 시설 상세(정원·가격·운영 시간·업소명)는 시스템에 등재된 정보가 아니라 예시이며, 실제와 다를 수 있습니다." />
      </p>

      {/* 연락처 */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {CONTACTS.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-3 text-center">
            <div className="text-lg mb-1">{c.icon}</div>
            <div className="text-[10px] text-gray-400 font-medium"><T k={c.label} /></div>
            <div className="text-xs font-bold text-gray-700 mt-0.5">
              {c.value ?? <span className="font-medium text-gray-400" title={tAttr('원내 연락처 정본에 등재되지 않았습니다 — 지어내지 않습니다')}><T k="정본 미등재" /></span>}
            </div>
          </div>
        ))}
      </div>

      {/* 주요 안내 카드 — 🔴 (2026-09-14) CMS(HospitalInfoContent) 공개 행만. 종전 카드 4장은 정원·요금·업소명·영업시간을
          코드 상수로 그렸다. 행이 없으면 "등록된 안내 없음"(지어내지 않음), 조회 실패는 실패로 말한다(없음으로 번역하지 않음).
          편집은 /admin/hospital-info 해당 카테고리. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {GUIDE_CARDS.map((g) => <CmsGuideCard key={g.category} {...g} />)}
      </div>

      <FloorDirectory />

      {/* 층별 안내(예시 — 결정 policy.facilityInfo.floorGuide 대기) */}
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-gray-900"><T k="층별 안내" /></h2>
        <p className="text-[12px] text-amber-700"><T k="아래는 시스템에 등재되지 않은 예시이며, 층 배치가 위 층 구성과 다를 수 있습니다." /></p>
        {FLOORS.map(f => {
          const isExpanded = expandedFloor === f.floor;
          return (
            <div key={f.floor} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedFloor(isExpanded ? null : f.floor)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-white bg-gray-800 rounded-lg px-2.5 py-1 min-w-[50px] text-center">{f.floor}</span>
                  <span className="text-sm font-semibold text-gray-800">{f.title}</span>
                  <span className="text-[10px] text-gray-400"><Tf k="{수} 시설" params={{ 수: <>{f.sections.length}<Unit>개</Unit></> }} /></span>
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {f.sections.map(s => (
                    <div key={s.name} className={`flex items-start gap-2.5 p-3 rounded-lg border ${s.color}`}>
                      <span className="text-base flex-shrink-0">{s.icon}</span>
                      <div>
                        <p className="text-xs font-bold">{s.name}</p>
                        <p className="text-[10px] opacity-80 mt-0.5">{s.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 운영 시간 */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-blue-800 mb-3"><T k="진료 시간" /></h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div><span className="font-medium text-blue-700"><T k="평일" /></span><br/><span className="text-blue-600">09:00 ~ 18:00</span></div>
          <div><span className="font-medium text-blue-700"><T k="토요일" /></span><br/><span className="text-blue-600">09:00 ~ 13:00</span></div>
          <div><span className="font-medium text-blue-700"><T k="점심시간" /></span><br/><span className="text-blue-600">12:30 ~ 14:00</span></div>
          <div><span className="font-medium text-red-600"><T k="일·공휴일 휴진" /></span><br/><span className="text-red-500"><T k="응급실 24시간" /></span></div>
        </div>
      </div>
    </div>
  );
}
