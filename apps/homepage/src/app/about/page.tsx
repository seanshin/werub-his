import Link from 'next/link';
import { publicFetch } from '@/lib/public-fetch';

export const revalidate = 3600;

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[];
  imageUrl: string | null; updatedAt: string;
}

/* ── SVG 아이콘 팩토리 ── */
function Icon({ d, className = 'w-5 h-5' }: { d: string; className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const icons = {
  greeting:  'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  history:   'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  org:       'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  facility:  'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  direction: 'M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z',
  csr:       'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z',
  gallery:   'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
  heart:     'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z',
  science:   'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611l-.772.13c-1.687.282-3.41.395-5.129.333l-.29-.01a9.064 9.064 0 01-2.866-.596l-1.41-.47a9.065 9.065 0 00-6.23-.693l-1.41.47a3.016 3.016 0 01-2.25-3.11l.14-1.995',
  handshake: 'M10.05 4.575a1.575 1.575 0 10-3.15 0v3.15m3.15-3.15v-1.108c0-.776.518-1.46 1.28-1.574A47.17 47.17 0 0112 2.25c1.357 0 2.688.074 3.99.216.762.114 1.28.798 1.28 1.574v1.108M10.05 4.575L7.5 7.125M10.05 4.575l2.5 2.55M6.9 7.725A23.15 23.15 0 003.375 9.3a1.724 1.724 0 00-.612 1.89l.758 2.652c.306 1.07 1.463 1.676 2.483 1.226l.64-.3m0 0l.176-.078a2.26 2.26 0 012.388.316l.326.29c.67.598 1.654.69 2.432.226l.51-.305a2.26 2.26 0 012.388.316l.326.29c.67.598 1.654.69 2.432.226l2.38-1.428c1.02-.45 1.39-1.7.838-2.681A23.15 23.15 0 0017.1 7.725',
  building:  'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
  bed:       'M2 12h2v6H2v-6zm18 0h2v6h-2v-6zM3 12V8a3 3 0 013-3h12a3 3 0 013 3v4M7 12V9m10 3V9',
  knife:     'M14.121 7.629A3 3 0 009.88 11.87L12 14l6.364-6.364a3 3 0 00-4.243-4.243L12 5.515l-2.121-2.122',
  ambulance: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21a.75.75 0 00.75-.75V11.25a3 3 0 00-3-3h-1.5l-3-4.5H6.75a.75.75 0 00-.75.75v12a.75.75 0 00.75.75h2.25',
  robot:     'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z',
  camera:    'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z',
  flask:     'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5m0 0l3.09 3.09M5 14.5l-1.298 1.298a2.25 2.25 0 001.591 3.841h13.414a2.25 2.25 0 001.591-3.841L19 14.5m0 0l-4.091-4.091a2.25 2.25 0 01-.659-1.591V3.104',
  pill:      'M9.75 3v3.75m4.5-3.75v3.75M3.75 14.25h16.5M5.625 7.5h12.75c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125H5.625a1.125 1.125 0 01-1.125-1.125v-9.75c0-.621.504-1.125 1.125-1.125z',
  trophy:    'M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.996.178-1.768.893-1.768 1.89C3.482 7.603 4.838 9 6.5 9c.802 0 1.491-.553 1.768-1.34 M18.75 4.236c.996.178 1.768.893 1.768 1.89C20.518 7.603 19.162 9 17.5 9c-.802 0-1.491-.553-1.768-1.34',
  shield:    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  globe:     'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  aiChip:    'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z',
  lightbulb: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
};

const ABOUT_MENU = [
  { label: '인사말·비전', href: '/about/hospital-overview', icon: icons.greeting },
  { label: '연혁', href: '/about/history', icon: icons.history },
  { label: '조직도', href: '/about/organization', icon: icons.org },
  { label: '시설 안내', href: '/about/facility', icon: icons.facility },
  { label: '오시는 길', href: '/about/directions', icon: icons.direction },
  { label: '사회공헌', href: '/about/csr', icon: icons.csr },
  { label: '갤러리', href: '/about/gallery', icon: icons.gallery },
];

const STATS = [
  { label: '진료과', value: '22', unit: '개' },
  { label: '전문센터', value: '5', unit: '개' },
  { label: '전문의', value: '29', unit: '명' },
  { label: '병상', value: '240', unit: '병상' },
];

export default async function AboutPage() {
  const items = await publicFetch<CmsItem[]>('/api/v1/public/hospital-info?category=GENERAL', 3600);
  const overview = (items ?? []).find(i => i.slug === 'hospital-overview');

  return (
    <div>
      {/* 히어로 */}
      <section className="relative bg-gradient-to-br from-gray-900 via-blue-900 to-blue-800 overflow-hidden">
        <div className="absolute inset-0">
          <img src="/images/homepage/banners/banner-2.png" alt="" className="w-full h-full object-cover opacity-30" />
        </div>
        <div className="relative max-w-6xl mx-auto px-4 lg:px-8 py-16 lg:py-24">
          <p className="text-blue-300 text-sm font-semibold uppercase tracking-wide mb-2">About 위루비병원</p>
          <h1 className="text-3xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
            환자 중심의<br />따뜻한 의료 서비스
          </h1>
          <p className="text-blue-200/70 mt-4 text-base lg:text-lg max-w-xl leading-relaxed">
            위루비병원은 최첨단 의료 기술과 따뜻한 돌봄으로 지역사회 건강을 책임지는 종합병원입니다
          </p>
        </div>
      </section>

      {/* 주요 지표 */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 -mt-10 relative z-10">
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-xl border border-white/60 p-6 lg:p-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <p className="text-3xl lg:text-4xl font-extrabold text-blue-700">{s.value}<span className="text-lg font-bold text-blue-400 ml-0.5">{s.unit}</span></p>
                <p className="text-sm text-gray-500 mt-1 font-medium">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 소개 메뉴 + 본문 */}
      <section className="max-w-6xl mx-auto px-4 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          {/* 좌측 사이드 메뉴 */}
          <aside className="lg:col-span-1">
            <h2 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wide">병원 소개</h2>
            <nav className="space-y-1">
              {ABOUT_MENU.map(m => (
                <Link
                  key={m.href}
                  href={m.href}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition font-medium group"
                >
                  <span className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-blue-100 flex items-center justify-center transition text-gray-500 group-hover:text-blue-600">
                    <Icon d={m.icon} className="w-4 h-4" />
                  </span>
                  {m.label}
                </Link>
              ))}
            </nav>
          </aside>

          {/* 우측 본문 */}
          <div className="lg:col-span-3 space-y-8">
            {/* 원장 인사말 카드 */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-3xl p-8 lg:p-10">
              <div className="flex items-start gap-6">
                <div className="hidden sm:flex w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex-shrink-0 items-center justify-center shadow-lg shadow-blue-200/50">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    <path d="M19.5 12c0 4.14-3.36 7.5-7.5 7.5S4.5 16.14 4.5 12 7.86 4.5 12 4.5s7.5 3.36 7.5 7.5z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900 mb-3">위루비병원</h2>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    저희 병원은 &ldquo;환자 중심의 따뜻한 의료&rdquo;를 실현하기 위해 최선을 다하고 있습니다.
                    최신 의료 장비와 우수한 의료진을 바탕으로 정확한 진단과 치료를 제공하며,
                    환자 한 분 한 분의 이야기에 귀 기울이는 병원이 되겠습니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 핵심 가치 */}
            <div>
              <SectionTitle>핵심 가치</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { icon: icons.heart, color: 'from-rose-500 to-pink-500', title: '환자 중심', desc: '모든 의사결정의 기준은 환자의 안전과 건강입니다' },
                  { icon: icons.science, color: 'from-blue-500 to-indigo-500', title: '의료 혁신', desc: 'AI 트리아지, 로봇수술 등 최신 의료 기술을 적극 도입합니다' },
                  { icon: icons.handshake, color: 'from-emerald-500 to-teal-500', title: '지역사회 공헌', desc: '의료 봉사, 건강 교육으로 지역사회 건강을 책임집니다' },
                ].map(v => (
                  <div key={v.title} className="bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-md transition group">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${v.color} flex items-center justify-center shadow-sm mb-3`}>
                      <Icon d={v.icon} className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-900">{v.title}</h3>
                    <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{v.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 주요 시설·장비 */}
            <div>
              <SectionTitle>주요 시설 · 장비</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { icon: icons.building, label: '지하3층~지상8층', color: 'bg-blue-50 text-blue-600' },
                  { icon: icons.bed, label: '240병상', color: 'bg-indigo-50 text-indigo-600' },
                  { icon: icons.knife, label: '수술실 4실', color: 'bg-rose-50 text-rose-600' },
                  { icon: icons.ambulance, label: '응급실 24시간', color: 'bg-red-50 text-red-600' },
                  { icon: icons.robot, label: '수술 로봇(다빈치)', color: 'bg-violet-50 text-violet-600' },
                  { icon: icons.camera, label: '3T MRI · 128채널CT', color: 'bg-sky-50 text-sky-600' },
                  { icon: icons.flask, label: '자동화 검사실', color: 'bg-teal-50 text-teal-600' },
                  { icon: icons.pill, label: '자동 조제 시스템', color: 'bg-emerald-50 text-emerald-600' },
                ].map(f => (
                  <div key={f.label} className={`rounded-xl p-4 text-center hover:shadow-sm transition ${f.color}`}>
                    <div className="w-9 h-9 mx-auto rounded-lg bg-white/70 flex items-center justify-center mb-2 shadow-sm">
                      <Icon d={f.icon} className="w-4.5 h-4.5" />
                    </div>
                    <p className="text-[11px] font-semibold leading-tight">{f.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 인증·수상 */}
            <div>
              <SectionTitle>인증 · 수상</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { icon: icons.trophy, color: 'from-amber-500 to-orange-500', title: 'EMR 인증 최고 등급', desc: '보건복지부 전자의무기록 인증 99.1% 적합률' },
                  { icon: icons.shield, color: 'from-emerald-500 to-green-500', title: '환자안전 우수기관', desc: '의료기관평가인증원 IPSG 6개 항목 전수 충족' },
                  { icon: icons.globe, color: 'from-blue-500 to-cyan-500', title: 'FHIR R4 표준 준수', desc: '국제 의료정보 표준 HL7 FHIR R4 연동' },
                  { icon: icons.aiChip, color: 'from-violet-500 to-purple-500', title: 'AI 트리아지 도입', desc: 'KTAS 분류 정확도 98.7% 달성' },
                ].map(a => (
                  <div key={a.title} className="flex items-start gap-4 bg-white border border-gray-100 rounded-xl p-4 hover:border-blue-200 transition">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                      <Icon d={a.icon} className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">{a.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{a.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CMS 본문 — 구조화 렌더링 */}
            {overview && <StructuredContent content={overview.content} />}

            {/* 진료과·센터 바로가기 */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white">
              <h3 className="text-xl font-bold mb-2">진료 서비스</h3>
              <p className="text-blue-100 text-sm mb-6">22개 전문 진료과와 5개 전문센터에서 최상의 진료를 제공합니다</p>
              <div className="flex flex-wrap gap-3">
                <Link href="/care/departments" className="px-5 py-2.5 bg-white text-blue-700 font-bold text-sm rounded-xl hover:bg-blue-50 transition shadow">
                  진료과 안내 →
                </Link>
                <Link href="/care/centers" className="px-5 py-2.5 bg-white/15 text-white font-semibold text-sm rounded-xl hover:bg-white/25 transition border border-white/20">
                  전문센터 안내 →
                </Link>
                <Link href="/care/doctors" className="px-5 py-2.5 bg-white/15 text-white font-semibold text-sm rounded-xl hover:bg-white/25 transition border border-white/20">
                  의료진 소개 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── 공용 섹션 제목 ── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-extrabold text-gray-900 mb-5 flex items-center gap-2">
      <span className="w-1 h-6 bg-blue-600 rounded-full" />
      {children}
    </h2>
  );
}

/* ── CMS 텍스트 → 구조화 렌더링 ── */

const SEC_ICONS: Record<string, string> = {
  '병원 개요': icons.building,
  '진료과': icons.greeting,
  '주요 센터': icons.heart,
  '인증 및 표준': icons.shield,
  '이념': icons.lightbulb,
};
const SEC_COLORS: Record<string, string> = {
  '병원 개요': 'from-blue-50 to-sky-50 border-blue-100',
  '진료과': 'from-indigo-50 to-violet-50 border-indigo-100',
  '주요 센터': 'from-rose-50 to-pink-50 border-rose-100',
  '인증 및 표준': 'from-emerald-50 to-teal-50 border-emerald-100',
  '이념': 'from-amber-50 to-yellow-50 border-amber-100',
};
const SEC_ICON_BG: Record<string, string> = {
  '병원 개요': 'from-blue-500 to-sky-500',
  '진료과': 'from-indigo-500 to-violet-500',
  '주요 센터': 'from-rose-500 to-pink-500',
  '인증 및 표준': 'from-emerald-500 to-teal-500',
  '이념': 'from-amber-500 to-yellow-500',
};

function StructuredContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const sections: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;
  let intro = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('■ ') || trimmed.startsWith('■')) {
      if (current) sections.push(current);
      current = { title: trimmed.replace(/^■\s*/, ''), items: [] };
    } else if (current) {
      current.items.push(trimmed.replace(/^[•·]\s*/, ''));
    } else if (!trimmed.startsWith('🏥') && !trimmed.startsWith('📞') && !trimmed.startsWith('📧')) {
      intro += (intro ? '\n' : '') + trimmed;
    }
  }
  if (current) sections.push(current);

  if (sections.length === 0) {
    return <div className="bg-white border border-gray-100 rounded-2xl p-6"><p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{content}</p></div>;
  }

  return (
    <div className="space-y-5">
      {intro && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <p className="text-sm text-gray-700 leading-relaxed">{intro}</p>
        </div>
      )}
      {sections.map(sec => {
        const iconPath = SEC_ICONS[sec.title] ?? icons.building;
        const color = SEC_COLORS[sec.title] ?? 'from-gray-50 to-slate-50 border-gray-100';
        const iconBg = SEC_ICON_BG[sec.title] ?? 'from-gray-500 to-slate-500';
        const isLong = sec.items.length === 1 && sec.items[0].length > 80;
        const isList = sec.items.length > 1 || sec.items.some(i => i.includes(':'));

        return (
          <div key={sec.title} className={`bg-gradient-to-br ${color} border rounded-2xl p-6`}>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-3 mb-4">
              <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${iconBg} flex items-center justify-center shadow-sm`}>
                <Icon d={iconPath} className="w-4 h-4 text-white" />
              </span>
              {sec.title}
            </h3>
            {isLong ? (
              <p className="text-sm text-gray-700 leading-relaxed">{sec.items[0]}</p>
            ) : isList ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sec.items.map((item, i) => {
                  const [key, ...rest] = item.split(':');
                  const hasColon = rest.length > 0;
                  return (
                    <div key={i} className="flex items-start gap-2.5 bg-white/60 rounded-xl px-4 py-3">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-1.5 flex-shrink-0" />
                      <div className="text-sm">
                        {hasColon ? (
                          <><span className="font-semibold text-gray-800">{key.trim()}</span><span className="text-gray-500"> {rest.join(':').trim()}</span></>
                        ) : (
                          <span className="text-gray-700">{item}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{sec.items.join(', ')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
