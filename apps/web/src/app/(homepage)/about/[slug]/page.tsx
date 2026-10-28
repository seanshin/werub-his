'use client';
import { useParams } from 'next/navigation';
import { redirect } from 'next/navigation';
import { CmsCategoryPage } from '@/components/homepage/CmsCategoryPage';

export default function AboutSlugPage() {
  const { slug } = useParams();

  // hospital-overview는 /about 메인 페이지에서 통합 표시
  if (slug === 'hospital-overview') {
    redirect('/about');
  }

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
      <CmsCategoryPage category="GENERAL" pageTitle="병원 소개" singleSlug={slug as string} renderMode="single" />
    </div>
  );
}
