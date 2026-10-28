'use client';

import { CategoryCmsPage } from '@/components/admin/CategoryCmsPage';
import { useTAttr } from '@/components/ui/i18n-text';

/** value 는 저장값(metadata.subType)이라 번역하지 않는다 — label 만 표시용으로 번역한다 */
const SUB_TYPES = [
  { value: 'NOTICE', label: '공지사항' },
  { value: 'PRESS', label: '언론보도' },
  { value: 'EVENT', label: '행사/이벤트' },
  { value: 'AWARD', label: '수상/인증' },
];

export default function Page() {
  // CategoryCmsPage 는 title/description/subTypes 를 문자열 prop 으로 받아 그대로 그린다 — 여기서 번역해 넘긴다(관리 크롬만 · CMS 값은 번역하지 않는다)
  const tAttr = useTAttr();
  return (
    <CategoryCmsPage
      category="NEWS"
      title={tAttr('뉴스/소식 관리')}
      description={tAttr('홈페이지에 표시되는 공지사항, 언론보도, 행사 소식을 관리합니다')}
      subTypes={SUB_TYPES.map((s) => ({ value: s.value, label: tAttr(s.label) }))}
    />
  );
}
