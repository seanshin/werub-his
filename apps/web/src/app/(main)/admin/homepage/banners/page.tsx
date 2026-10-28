'use client';

import { CategoryCmsPage } from '@/components/admin/CategoryCmsPage';
import { T, useTAttr } from '@/components/ui/i18n-text';

const SUB_TYPES = [
  { value: 'HERO', label: '히어로' },
  { value: 'STRIP', label: '띠배너' },
  { value: 'MID', label: '중간 배너' },
];

/**
 * 배너 관리.
 *
 * 🔴 W9 실결함(이 화면을 통째로 갈아엎은 이유):
 *  1) '+ 새 배너 추가' 와 '편집' 버튼에 **onClick 이 아예 없었다** — 클릭해도 아무 일도 일어나지 않는
 *     장식이었다. "BANNER 3건뿐" 은 아무도 안 써서가 아니라 **등록 폼이 없었기 때문**이다.
 *  2) 상태 배지가 `status || 'PUBLISHED'` 폴백이라, status 가 비고 isActive=false 인(=숨긴) 배너까지
 *     초록색 '공개' 라고 말했다. 화면이 공개 여부를 거꾸로 말한 셈이다.
 *  3) 상태 셀렉트가 SCHEDULED 를 publishFrom 없이 보내 '예약'이 곧 '즉시 비공개'였다.
 * → 세 결함 모두 CategoryCmsPage(다른 CMS 화면이 쓰는 정본 편집기)로 수렴한다.
 *   정본은 등록/편집/공개토글/삭제가 실제로 배선돼 있고, 공개 여부는 isActive 를 그대로 말한다.
 *
 * ⚠️ 미배선 고지: 공개 홈페이지(hospital.example.org)의 히어로 슬라이더는 아직 정적 이미지 배열을 쓰고 있어
 *   여기 등록한 BANNER 콘텐츠를 읽지 않는다(consumer 0). 배선 전까지 그 사실을 화면이 말한다.
 */
export default function BannersPage() {
  // 🔴 CategoryCmsPage 는 title/description/subTypes 를 **문자열 prop** 으로 받아 그대로 그린다
  //    (그 파일은 이 갈래 소유가 아니다) — 티를 그릴 수 없는 자리라 tAttr 로 넘긴다.
  const tAttr = useTAttr();
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
        <p className="text-xs font-bold text-amber-800"><T k="공개 홈페이지 미배선" /></p>
        <p className="text-[11px] text-amber-700 mt-0.5">
          <T k="현재 hospital.example.org 히어로 슬라이더는 정적 이미지를 표시하며 여기 등록한 배너를 읽지 않습니다. 저장·공개 토글은 정상 동작하지만" />
          {' '}<b><T k="공개 화면에는 아직 반영되지 않습니다" /></b><T k="(홈페이지 배선 필요)." />
        </p>
      </div>
      <CategoryCmsPage
        category="BANNER"
        title={tAttr('배너 관리')}
        description={tAttr('홈페이지 히어로 배너, 띠배너, 중간 배너를 관리합니다')}
        subTypes={SUB_TYPES.map((s) => ({ value: s.value, label: tAttr(s.label) }))}
      />
    </div>
  );
}
