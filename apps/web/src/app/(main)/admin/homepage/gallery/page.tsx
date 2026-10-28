'use client';

import { CategoryCmsPage } from '@/components/admin/CategoryCmsPage';
import { useTAttr } from '@/components/ui/i18n-text';

export default function Page() {
  // CategoryCmsPage 는 title/description 을 문자열 prop 으로 받아 그대로 그린다 — 여기서 번역해 넘긴다(관리 크롬만 · CMS 값은 번역하지 않는다)
  const tAttr = useTAttr();
  return (
    <CategoryCmsPage
      category="GALLERY"
      title={tAttr('갤러리 관리')}
      description={tAttr('홈페이지에 표시되는 시설 사진, 행사 갤러리를 관리합니다')}
    />
  );
}
