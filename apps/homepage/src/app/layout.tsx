import type { Metadata } from 'next';
import { SITE_INFO } from '@/lib/site-info';
import { getClinicHours, toIsoRange } from '@/lib/clinic-hours';
import { publicFetch } from '@/lib/public-fetch';
import { GNB } from '@/components/homepage/GNB';
import { Footer } from '@/components/homepage/Footer';
import { PopupRenderer } from '@/components/homepage/PopupRenderer';
import { HideOnLocale } from '@/components/homepage/HideOnLocale';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '위루비병원 — Care Today, Ready for Tomorrow', template: '%s | WERUBYHOSP' },
  // 🔴 W9: "7개 진료과, 10개 특성화센터" 가 박혀 있었다. 공개 API 실측은 진료과 22 · 전문센터 5 다.
  //    검색결과 스니펫으로 나가는 문구라 틀린 수를 단정하지 않는다(수가 필요한 화면은 API 로 센다).
  description: '정확한 진단으로 오늘의 병을 치료합니다. 정밀한 예측으로 내일의 병을 예방합니다. — 가상 위루비병원',
  keywords: ['위루비병원', 'WERUBYHOSP', '가상병원', '세포치료', '유전자분석', '건강검진', '국제진료'],
  openGraph: {
    type: 'website',
    siteName: '위루비병원',
    locale: 'ko_KR',
    title: '위루비병원 — Care Today, Ready for Tomorrow',
    description: '정확한 진단으로 오늘의 병을 치료합니다. 정밀한 예측으로 내일의 병을 예방합니다.',
  },
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://hospital.example.org' },
};

interface DeptItem { slug: string; title: string }

async function buildSchemaOrg() {
  // 🔴 W9: openingHours 가 09:00~18:00 으로 박혀 있어 CMS 정본(09:00~17:30)과 어긋난 채 검색엔진에 나갔다.
  const [hours, departments] = await Promise.all([
    getClinicHours(),
    publicFetch<DeptItem[]>('/api/v1/public/departments', 3600),
  ]);
  // 🔴 T6: CMS 에서 읽은 값만 검색엔진에 선언한다 — 조회 실패·미등록일 때 코드 상수를 openingHours 로 내보내지 않는다
  const weekday = hours.source === 'cms' ? toIsoRange(hours.weekday) : null;
  const saturday = hours.source === 'cms' ? toIsoRange(hours.saturday) : null;

  return {
    '@context': 'https://schema.org',
    '@type': 'Hospital',
    name: `${SITE_INFO.name} (${SITE_INFO.nameEn})`,
    url: SITE_INFO.url,
    telephone: SITE_INFO.phone,
    address: { '@type': 'PostalAddress', streetAddress: '가상로 126', addressLocality: SITE_INFO.addressLocality, addressRegion: SITE_INFO.addressRegion, postalCode: SITE_INFO.postalCode, addressCountry: 'KR' },
    geo: { '@type': 'GeoCoordinates', latitude: 33.253, longitude: 126.510 },
    // 시간을 파싱하지 못하면 openingHours 를 아예 선언하지 않는다 — 틀린 시간을 배포하느니 침묵이 낫다.
    ...((weekday || saturday) && {
      openingHoursSpecification: [
        ...(weekday ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], ...weekday }] : []),
        ...(saturday ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Saturday', ...saturday }] : []),
      ],
    }),
    // 🔴 W9: 진료과 7개가 하드코딩돼 실제 공개 목록(22개)과 달랐고, 진단검사의학과를 'Pathology' 로,
    //    신경외과를 'Neurology' 로 잘못 선언했다. 실데이터에서 만들고, 없으면 선언하지 않는다.
    ...((departments?.length ?? 0) > 0 && {
      department: departments!.map(d => ({ '@type': 'MedicalClinic', name: d.title, url: `${SITE_INFO.url}/care/departments/${d.slug}` })),
    }),
    availableService: { '@type': 'MedicalProcedure', name: '건강검진', procedureType: 'DiagnosticProcedure' },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const SCHEMA_ORG = await buildSchemaOrg();
  return (
    <html lang="ko">
    <body>
    <div className="min-h-screen flex flex-col bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA_ORG) }} />
      {/* 스킵 네비게이션 — 키보드 사용자가 본문으로 바로 이동 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:bg-blue-600 focus:text-white focus:px-5 focus:py-2.5 focus:rounded-xl focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        본문 바로가기
      </a>
      <HideOnLocale><GNB /></HideOnLocale>
      <PopupRenderer />
      <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
        {children}
      </main>
      <HideOnLocale><Footer /></HideOnLocale>

      {/* 모바일 플로팅 버튼 — 전화 + AI 상담 */}
      <div className="fixed bottom-6 right-4 z-40 flex flex-col gap-3 sm:hidden">
        <a href={`tel:${SITE_INFO.phone}`} className="w-12 h-12 bg-green-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-green-600 transition" aria-label="전화하기">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
        </a>
        <a href="/booking" className="w-12 h-12 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-blue-700 transition animate-pulse" aria-label="AI 상담">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
        </a>
      </div>

      {/* 데스크톱 플로팅 — AI 상담 */}
      <div className="fixed bottom-6 right-6 z-40 hidden sm:block">
        <a href="/booking" className="group flex items-center gap-2 bg-blue-600 text-white pl-4 pr-5 py-3 rounded-full shadow-xl hover:bg-blue-700 transition-all hover:scale-105">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
          <span className="text-sm font-semibold">AI 상담</span>
        </a>
      </div>
    </div>
    </body>
    </html>
  );
}
