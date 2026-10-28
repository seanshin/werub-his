import Link from 'next/link';
import { cmsResolveStyle } from '@/lib/cms-style-preset';
import { publicFetch } from '@/lib/public-fetch';
import { PORTAL_URL } from '@/lib/site-info';
import { FloatingMenu } from '@/components/homepage/FloatingMenu';
import { DoctorAvatar } from '@/components/homepage/DoctorAvatar';
import { CenterIllustration } from '@/components/homepage/CenterIllustration';
import { DeptIllustration } from '@/components/homepage/DeptIllustration';
import { IconBox } from '@/components/homepage/SvgIcon';
import { HeroSlider } from '@/components/homepage/HeroSlider';
import { ScrollReveal, CountUp } from '@/components/homepage/ScrollReveal';
import { RevealText } from '@/components/homepage/RevealText';
import { NewsSliderSection } from '@/components/homepage/NewsSlider';

export const revalidate = 300;

interface CmsItem {
  id: string; slug: string; title: string; content: string;
  metadata: Record<string, unknown>; tags: string[]; isPinned: boolean;
  imageUrl: string | null; updatedAt: string; category: string;
}
interface DoctorItem {
  id: string; userId: string; position: string | null;
  certifications: string[]; scheduleNote: string | null;
  user: { familyName: string; givenName: string; department: string; specialty: string | null };
}

const QUICK_MENU: { label: string; href: string; iconName: 'calendar'|'clock'|'mapPin'|'clipboard'|'money'|'user'|'document'; gradient: string }[] = [
  { label: '온라인 예약', href: PORTAL_URL, iconName: 'calendar', gradient: 'from-blue-400/90 to-blue-600/90' },
  { label: '진료시간', href: '/care/schedule', iconName: 'clock', gradient: 'from-slate-400/90 to-slate-600/90' },
  { label: '오시는 길', href: '/about/directions', iconName: 'mapPin', gradient: 'from-stone-400/90 to-stone-600/90' },
  { label: '건강검진', href: '/checkup', iconName: 'clipboard', gradient: 'from-sky-400/90 to-sky-600/90' },
  { label: '제증명 발급', href: '/guide/certificate', iconName: 'document', gradient: 'from-teal-400/90 to-teal-600/90' },
  { label: '비급여 안내', href: '/care/non-covered', iconName: 'money', gradient: 'from-zinc-400/90 to-zinc-600/90' },
  { label: '환자 포털', href: PORTAL_URL, iconName: 'user', gradient: 'from-indigo-400/90 to-indigo-600/90' },
];

// WERUBYHOSP 7개 진료과
const DEPT_SLUGS = [
  'family-medicine', 'internal-medicine', 'dermatology',
  'laboratory-medicine', 'radiology', 'neurosurgery', 'pathology',
];

// WERUBYHOSP 10개 특성화 센터
const CENTER_META: Record<string, { badge: string; badgeColor: string }> = {
  'cell-therapy': { badge: '줄기세포', badgeColor: 'bg-emerald-500' },
  'genomic-analysis': { badge: '유전자분석', badgeColor: 'bg-blue-500' },
  'gene-analysis': { badge: '유전자분석', badgeColor: 'bg-blue-500' },
  'clinical-lab-center': { badge: '정밀검사', badgeColor: 'bg-indigo-500' },
  'radiology-center': { badge: '영상진단', badgeColor: 'bg-sky-500' },
  'endoscopy': { badge: '내시경', badgeColor: 'bg-teal-500' },
  'diabetes-endocrine': { badge: '당뇨/내분비', badgeColor: 'bg-amber-500' },
  'neuroscience': { badge: '뇌과학', badgeColor: 'bg-purple-500' },
  'brain-science': { badge: '뇌과학', badgeColor: 'bg-purple-500' },
  'anti-aging': { badge: '항노화', badgeColor: 'bg-rose-500' },
  'health-checkup': { badge: 'VIP검진', badgeColor: 'bg-cyan-500' },
  'checkup-center': { badge: 'VIP검진', badgeColor: 'bg-cyan-500' },
  'international': { badge: '국제진료', badgeColor: 'bg-violet-500' },
  'international-care': { badge: '국제진료', badgeColor: 'bg-violet-500' },
};

const TYPE_STYLE: Record<string, string> = {
  NOTICE: 'bg-blue-50 text-blue-700 border-blue-200',
  PRESS: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EVENT: 'bg-purple-50 text-purple-700 border-purple-200',
  AWARD: 'bg-amber-50 text-amber-700 border-amber-200',
};
const TYPE_LABEL: Record<string, string> = { NOTICE: '공지', PRESS: '보도', EVENT: '행사', AWARD: '수상' };

export default async function HomepagePage() {
  const [departments, centers, news, healthInfo, doctors, healthVideos, allBanners] = await Promise.all([
    publicFetch<CmsItem[]>('/api/v1/public/departments', 3600),
    publicFetch<CmsItem[]>('/api/v1/public/centers', 3600),
    publicFetch<CmsItem[]>('/api/v1/public/news', 300),
    publicFetch<CmsItem[]>('/api/v1/public/health-info', 3600),
    publicFetch<DoctorItem[]>('/api/v1/public/doctors', 3600),
    publicFetch<CmsItem[]>('/api/v1/public/hospital-info?category=HEALTH_VIDEO', 3600),
    // 🔴 W9: 관리 화면에 등록된 CMS 배너(HERO 2 · STRIP 1)를 읽는 곳이 아무 데도 없었다(소비자 0).
    //    특히 STRIP 배너는 지금 유효한 하절기 진료시간 공지인데 방문자에게 한 번도 보인 적이 없다.
    publicFetch<CmsItem[]>('/api/v1/public/hospital-info?category=BANNER', 300),
  ]);

  const pinnedNews = (news ?? []).filter(n => n.isPinned);
  const regularNews = (news ?? []).filter(n => !n.isPinned);

  const banners = allBanners ?? [];
  const subTypeOf = (b: CmsItem) => (b.metadata as Record<string, unknown> | null)?.subType as string | undefined;
  const heroBanners = banners.filter(b => subTypeOf(b) === 'HERO');
  const stripBanner = banners.find(b => subTypeOf(b) === 'STRIP');

  return (
    <div>
      {/* 공지 띠배너 — CMS STRIP 배너가 있으면 그것을 쓴다(관리 화면에서 바꾼 것이 보여야 한다) */}
      {stripBanner ? (() => {
        // 🔴 표현 정본(cmsResolveStyle) — 종전엔 자유 hex 를 단색으로 칠하고 링크를 밑줄로 뒀다.
        //    편집자가 고른 색이 어떤 값이든 대비가 확보된 그라디언트 띠로 그린다.
        const st = cmsResolveStyle(stripBanner.metadata as Record<string, unknown> | null);
        const meta = (stripBanner.metadata ?? {}) as Record<string, unknown>;
        const linkUrl = typeof meta.linkUrl === 'string' ? meta.linkUrl : '';
        return (
          <div
            className="py-2.5 text-[13px] tracking-wide"
            style={{ backgroundImage: st.gradient, backgroundColor: st.bg, color: st.text }}
          >
            <div className="max-w-7xl mx-auto px-4 lg:px-8 flex items-center justify-center gap-2.5 text-center">
              <span
                className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full tracking-wider"
                style={{ backgroundColor: st.accent, color: st.accentText }}
              >
                공지
              </span>
              <span className="font-medium truncate">{stripBanner.title}</span>
              {linkUrl && (
                <Link
                  href={linkUrl}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full border border-current/30 px-2.5 py-0.5 text-[11px] font-bold opacity-90 transition hover:opacity-100 hover:gap-1.5"
                >
                  {(typeof meta.linkText === 'string' && meta.linkText) || '자세히'}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </div>
          </div>
        );
      })() : pinnedNews.length > 0 ? (
        <div className="bg-gray-900 text-white text-center py-2.5 text-[13px] tracking-wide">
          <span className="inline-flex items-center gap-2">
            <span className="bg-red-500 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">NEW</span>
            {pinnedNews[0].title}
          </span>
        </div>
      ) : null}

      {/* 히어로 — hospital.example.org 스타일: 밝은 배경 + 좌측 텍스트 + 우측 이미지 대각선 그리드 */}
      <section aria-label="히어로" className="relative overflow-hidden bg-gradient-to-br from-purple-50/50 via-white to-gray-50">
        {/* 배경 장식 — 대각선 그라데이션 */}
        <div className="absolute top-0 right-0 w-[60%] h-full bg-gradient-to-bl from-purple-100/30 via-transparent to-transparent" />
        <div className="absolute top-[20%] left-[40%] w-[60%] h-[70%] bg-gradient-to-br from-teal-50/20 via-transparent to-purple-50/20 rotate-12" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

        <div className="relative max-w-[1400px] mx-auto px-6 lg:px-12 py-20 lg:py-32">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* 좌측 텍스트 — 5칸 */}
            <div className="lg:col-span-5 pt-8">
              <ScrollReveal delay={100}>
                <p className="text-teal-600 font-bold text-xl italic tracking-wide mb-6">Care Today, Ready for Tomorrow</p>
              </ScrollReveal>
              <ScrollReveal delay={300}>
                <h1 className="text-[40px] lg:text-[52px] font-extrabold leading-[1.15] text-[#0d4f4f] tracking-tight">
                  정확한 진단으로<br />오늘의 병을 치료합니다.
                </h1>
              </ScrollReveal>
              <ScrollReveal delay={400}>
                <h2 className="text-[36px] lg:text-[48px] font-extrabold leading-[1.15] text-[#0d4f4f] tracking-tight mt-6">
                  정밀한 예측으로,<br />내일의 병을 예방합니다.
                </h2>
              </ScrollReveal>
              <ScrollReveal delay={600}>
                <p className="text-gray-500 mt-10 text-[15px] leading-[1.8] max-w-[480px]">
                  WGIM은 정확한 진단과 최첨단 치료로 오늘의 병을 치료하며, 정밀한 예측을 통해 내일의 병을 예방합니다.전문 의료진과 첨단 기술을 활용하여 각 환자에게 맞춤 치료를 제공하며, 환자 중심의 접근으로 신속하고 효과적인 치료를 실현합니다. 미래의 건강을 예측하여 환자의 더 나은 삶을 돕습니다,
                </p>
              </ScrollReveal>
            </div>

            {/* 우측 이미지 — 대각선 계단식 7칸, hospital.example.org 원본 비율 */}
            <div className="hidden lg:block lg:col-span-7 relative" style={{ height: '680px' }}>
              {/* 이미지 1: 우상단 — 수술실 */}
              <ScrollReveal delay={200}>
                <div className="absolute top-[80px] right-[220px] w-[220px] h-[240px] rounded-2xl overflow-hidden shadow-xl">
                  <img src="/images/homepage/facilities/facility-operating-room.png" alt="수술실" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
              </ScrollReveal>
              {/* 이미지 2: 우상단 큰 카드 — 세포 */}
              <ScrollReveal delay={300}>
                <div className="absolute top-[40px] right-0 w-[210px] h-[250px] rounded-2xl overflow-hidden shadow-xl">
                  <img src="/images/homepage/banners/banner-1.png" alt="세포치료" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
              </ScrollReveal>
              {/* 이미지 3: 중앙좌 — 세포/현미경 (가장 큰 카드) */}
              <ScrollReveal delay={400}>
                <div className="absolute top-[260px] left-[40px] w-[230px] h-[280px] rounded-2xl overflow-hidden shadow-xl">
                  <img src="/images/homepage/centers/center-cancer.png" alt="정밀의학" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
              </ScrollReveal>
              {/* 이미지 4: 우측 중앙 — DNA/유전자 */}
              <ScrollReveal delay={500}>
                <div className="absolute top-[340px] right-[120px] w-[210px] h-[240px] rounded-2xl overflow-hidden shadow-xl">
                  <img src="/images/homepage/facilities/facility-lab.png" alt="유전자분석" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
              </ScrollReveal>
              {/* 이미지 5: 우하단 — 검사장비/분자 */}
              <ScrollReveal delay={600}>
                <div className="absolute top-[300px] right-0 w-[200px] h-[220px] rounded-2xl overflow-hidden shadow-xl">
                  <img src="/images/homepage/facilities/facility-mri.png" alt="검사장비" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                </div>
              </ScrollReveal>
            </div>

            {/* 모바일: 이미지 슬라이더 */}
            <div className="lg:hidden relative overflow-hidden rounded-2xl h-[300px]">
              <HeroSlider banners={heroBanners.map(b => ({ id: b.id, title: b.title, imageUrl: b.imageUrl, metadata: b.metadata as never }))} />
            </div>
          </div>
        </div>
      </section>

      {/* 주요 서비스 — 단어별 등장 애니메이션 */}
      <section className="py-16 lg:py-20 bg-gradient-to-b from-gray-50/50 to-white">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 text-center">
          <ScrollReveal>
            <p className="inline-flex flex-col items-center text-teal-600 font-semibold text-sm tracking-[0.18em] mb-5">
              주요 서비스
              <span className="mt-2 h-px w-10 bg-gradient-to-r from-transparent via-teal-500 to-transparent" />
            </p>
          </ScrollReveal>
          <RevealText
            as="h2"
            text="WGIM의 선구적인 의료 모델은 고객을 중심으로 구축되어 모두에게 더 나은 결과를 제공하고 최고의 서비스를 제공합니다."
            className="text-xl lg:text-[28px] font-extrabold text-gray-900 leading-[1.5] tracking-tight"
            stagger={55}
          />
          <RevealText
            as="p"
            text="지역, 문화, 배경에 관계없이 고객을 위한 새로운 치료 표준을 정립하고 있습니다."
            className="text-gray-500 mt-6 text-base"
            stagger={26}
            delay={880}
          />
        </div>
      </section>

      {/* 빠른 메뉴 */}
      <section className="max-w-7xl mx-auto px-4 lg:px-8 relative z-10">
        <ScrollReveal>
          <div className="bg-white/85 backdrop-blur-xl rounded-3xl shadow-xl shadow-gray-200/40 border border-white/60 p-3 lg:p-4">
            <div className="grid grid-cols-3 lg:grid-cols-7 gap-2 lg:gap-3">
              {QUICK_MENU.map((m, i) => (
                <ScrollReveal key={m.label} delay={i * 80} direction="up">
                  <Link href={m.href} target={m.href.startsWith('http') ? '_blank' : undefined} rel={m.href.startsWith('http') ? 'noopener noreferrer' : undefined} className="flex flex-col items-center gap-3 p-4 lg:p-6 rounded-2xl hover:bg-gray-50/80 transition group">
                    <IconBox name={m.iconName} gradient={m.gradient} />
                    <span className="text-[13px] font-semibold text-gray-700">{m.label}</span>
                  </Link>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* 진료과 */}
      <section className="max-w-7xl mx-auto px-4 lg:px-8 pt-20 pb-12">
        <ScrollReveal>
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Departments</p>
            <RevealText as="h2" text="진료과 안내" className="text-2xl lg:text-3xl font-extrabold text-gray-900" />
          </div>
          <Link href="/care/departments" className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 transition">
            전체보기 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </Link>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 lg:gap-3">
          {(departments ?? []).filter(d => DEPT_SLUGS.includes(d.slug)).slice(0, 16).map((d, i) => (
            <ScrollReveal key={d.slug} delay={i * 50}>
              <Link href={`/care/departments/${d.slug}`}
                className="flex flex-col items-center gap-3 p-3 lg:p-5 rounded-2xl transition-all text-center group hover:shadow-md hover:bg-gray-50">
                <div className="w-14 h-14 rounded-2xl overflow-hidden group-hover:scale-110 transition-all duration-300 shadow-lg shadow-black/5">
                  <DeptIllustration slug={d.slug} size={56} />
                </div>
                <span className="text-xs lg:text-[13px] font-semibold text-gray-700 leading-tight">{d.title}</span>
              </Link>
            </ScrollReveal>
          ))}
        </div>
        </ScrollReveal>
      </section>

      {/* 소식/공지 슬라이더 */}
      {(news ?? []).length > 0 && <NewsSliderSection news={news ?? []} />}

      {/* 전문센터 */}
      {(centers ?? []).length > 0 && (
        <section className="bg-gradient-to-b from-gray-50 to-white py-20">
          <div className="max-w-7xl mx-auto px-4 lg:px-8">
            <ScrollReveal>
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Specialized Centers</p>
                <RevealText as="h2" text="전문센터" className="text-2xl lg:text-3xl font-extrabold text-gray-900" />
              </div>
              <Link href="/care/centers" className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                전체보기 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
            </ScrollReveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {(() => {
                // 중복 제거 (같은 title이면 content가 긴 것 우선)
                const seen = new Map<string, CmsItem>();
                (centers ?? []).forEach(c => {
                  const existing = seen.get(c.title);
                  if (!existing || (c.content?.length ?? 0) > (existing.content?.length ?? 0)) seen.set(c.title, c);
                });
                return Array.from(seen.values());
              })().map((c, ci) => {
                const meta = c.metadata as Record<string, unknown>;
                const depts = (meta?.departments as string[]) ?? [];
                const cm = CENTER_META[c.slug];
                const hasImage = !!c.imageUrl;
                return (
                  <ScrollReveal key={c.id} delay={ci * 150}>
                  <Link href={`/care/centers/${c.slug}`}
                    className="block bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                    <div className="h-44 relative">
                      {hasImage ? (
                        <img src={c.imageUrl!} alt={c.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        <CenterIllustration slug={c.slug} />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                      {cm?.badge && (
                        <div className="absolute bottom-4 left-5">
                          <span className={`text-white text-[10px] font-bold px-2.5 py-1 rounded-full ${cm.badgeColor}`}>{cm.badge}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="text-lg font-bold text-gray-900">{c.title}</h3>
                      <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{c.content.replace(/<[^>]*>/g, '').slice(0, 80)}</p>
                      {depts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {depts.map(d => (
                            <span key={d} className="text-[10px] bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">{d}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                  </ScrollReveal>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 의료진 */}
      {(doctors ?? []).length > 0 && (
        <section className="max-w-7xl mx-auto px-4 lg:px-8 py-20">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Medical Staff</p>
              <RevealText as="h2" text="의료진 소개" className="text-2xl lg:text-3xl font-extrabold text-gray-900" />
            </div>
            <Link href="/care/doctors" className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
              전체보기 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
            {(doctors ?? []).slice(0, 6).map((doc) => {
              const fullName = `${doc.user.familyName}${doc.user.givenName}`;
              return (
                <Link key={doc.id} href={`/care/doctors/${doc.userId}`}
                  className="text-center p-5 rounded-3xl bg-white border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                  <div className="w-20 h-20 mx-auto rounded-2xl overflow-hidden shadow-lg bg-gradient-to-br from-blue-100 to-indigo-100">
                    <DoctorAvatar name={fullName} size={80} />
                  </div>
                  <p className="text-sm font-bold text-gray-900 mt-3">{fullName}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{doc.position ?? '전문의'}</p>
                  <p className="text-[10px] text-blue-600 font-semibold mt-1">{doc.user.department}</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 건강 TV */}
      {(healthVideos ?? []).length > 0 && (
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-4 lg:px-8">
            <ScrollReveal>
              <div className="flex items-end justify-between mb-8">
                <div>
                  <p className="text-teal-600 font-semibold text-sm tracking-wide uppercase mb-1">Health TV</p>
                  <RevealText as="h2" text="건강 TV" className="text-2xl lg:text-3xl font-extrabold text-gray-900" />
                </div>
                <Link href="/health-info" className="text-sm text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                  더보기 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
              </div>
            </ScrollReveal>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {(healthVideos ?? []).slice(0, 6).map((v, vi) => {
                const meta = v.metadata as Record<string, string>;
                return (
                  <ScrollReveal key={v.id} delay={vi * 100}>
                    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-lg transition-shadow group">
                      <div className="relative aspect-video bg-gray-100 overflow-hidden">
                        {v.imageUrl ? (
                          <img src={v.imageUrl} alt={v.title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-teal-600 to-emerald-700 flex items-center justify-center">
                            <svg className="w-12 h-12 text-white/30" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                            <svg className="w-6 h-6 text-teal-600 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        </div>
                        {meta?.duration && (
                          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">{meta.duration}</span>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="text-sm font-bold text-gray-900 group-hover:text-teal-600 transition line-clamp-2">{v.title}</h3>
                        {meta?.doctor && <p className="text-[11px] text-gray-500 mt-1">{meta.doctor}</p>}
                        <p className="text-xs text-gray-400 mt-1 line-clamp-1">{v.content}</p>
                      </div>
                    </div>
                  </ScrollReveal>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 건강정보 + 소식 */}
      <section className="bg-gradient-to-b from-gray-50 to-white py-20">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* 건강정보 */}
          <div>
            <div className="flex items-end justify-between mb-6">
              <div>
                <p className="text-emerald-600 font-semibold text-sm tracking-wide uppercase mb-1">Health Info</p>
                <RevealText as="h2" text="건강정보" className="text-xl font-extrabold text-gray-900" />
              </div>
              <Link href="/health-info" className="text-sm text-blue-600 font-semibold">더보기 →</Link>
            </div>
            <div className="space-y-3">
              {(healthInfo ?? []).slice(0, 3).map(item => (
                <Link key={item.id} href={`/health-info/${item.slug}`}
                  className="block bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                  <h4 className="text-sm font-bold text-gray-900">{item.title}</h4>
                  <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{item.content.replace(/<[^>]*>/g, '').slice(0, 100)}</p>
                  <div className="flex gap-1 mt-2.5">
                    {item.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{t}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* 소식 */}
          <div>
            <div className="flex items-end justify-between mb-6">
              <div>
                <p className="text-amber-600 font-semibold text-sm tracking-wide uppercase mb-1">Hospital News</p>
                <RevealText as="h2" text="병원 소식" className="text-xl font-extrabold text-gray-900" />
              </div>
              <Link href="/news" className="text-sm text-blue-600 font-semibold">더보기 →</Link>
            </div>
            <div className="space-y-3">
              {regularNews.slice(0, 4).map(item => {
                const subType = ((item.metadata as Record<string, unknown>)?.subType as string) ?? '';
                return (
                  <Link key={item.id} href={`/news/${item.slug}`}
                    className="block bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] px-2.5 py-1 rounded-full border font-bold whitespace-nowrap ${TYPE_STYLE[subType] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {TYPE_LABEL[subType] ?? '소식'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-gray-900 truncate">{item.title}</h4>
                      </div>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">
                        {new Date(item.updatedAt).toLocaleDateString('ko', { month: '2-digit', day: '2-digit' })}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 검진 CTA */}
      <section className="max-w-7xl mx-auto px-4 lg:px-8 py-10">
        <div className="relative rounded-[2rem] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-teal-900/90 via-teal-800/80 to-teal-700/60" />
          <div className="relative p-10 lg:p-16 flex flex-col lg:flex-row items-center gap-8">
            <div className="flex-1">
              <p className="text-teal-200 text-sm font-semibold uppercase tracking-wide mb-2">Health Checkup</p>
              <RevealText as="h2" text="건강검진 프로그램" className="text-3xl lg:text-4xl font-extrabold text-white leading-tight" />
              <p className="text-teal-100/80 mt-3 text-base max-w-md">종합건강검진, 국가검진, 기업단체검진 등 다양한 프로그램을 운영합니다</p>
            </div>
            <Link href="/checkup" className="group px-8 py-4 bg-white text-teal-800 font-bold text-[15px] rounded-2xl hover:bg-teal-50 transition-all shadow-xl flex items-center gap-2 whitespace-nowrap">
              검진 프로그램 보기
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </Link>
          </div>
        </div>
      </section>

      <FloatingMenu />
    </div>
  );
}

