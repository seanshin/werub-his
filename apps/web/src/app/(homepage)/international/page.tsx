import Link from 'next/link';
import type { Metadata } from 'next';
import { publicFetch } from '@/lib/public-fetch';
import { getClinicHours, toIsoRange } from '@/lib/clinic-hours';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

export const metadata: Metadata = {
  title: 'International Medical Services | WERUBYHOSP',
  description: 'World-class healthcare for international patients. Multilingual support, medical tourism, telemedicine, and FHIR-standard data exchange.',
};

const SERVICES = [
  {
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1.5}>
        <rect x="6" y="10" width="36" height="28" rx="4" />
        <path d="M24 18v12M18 24h12" strokeLinecap="round" />
        <circle cx="24" cy="6" r="3" />
      </svg>
    ),
    title: 'Outpatient & Inpatient Care',
    titleKo: '외래 · 입원 진료',
    desc: 'Full-spectrum medical services across 16 specialties with dedicated international patient coordinators.',
    descKo: '16개 전문과 진료, 전담 코디네이터 배정, 다국어 통역 지원',
    color: 'from-blue-500 to-blue-600',
    href: '/care/centers/international-care',
  },
  {
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1.5}>
        <path d="M8 36l8-8 6 6 8-10 10 12" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="8" width="40" height="32" rx="4" />
        <circle cx="14" cy="18" r="3" />
      </svg>
    ),
    title: 'Health Checkup & Medical Tourism',
    titleKo: '건강검진 · 의료관광',
    desc: 'Comprehensive screening programs combined with Example island tourism. Airport pickup and accommodation arranged.',
    descKo: '종합 검진 프로그램 + 가상 관광 패키지, 공항 픽업, 숙소 안내',
    color: 'from-emerald-500 to-emerald-600',
    href: '/checkup',
  },
  {
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1.5}>
        <rect x="8" y="6" width="32" height="36" rx="3" />
        <path d="M16 16h16M16 22h16M16 28h10" strokeLinecap="round" />
        <circle cx="36" cy="36" r="8" fill="currentColor" opacity="0.15" />
        <path d="M33 36h6M36 33v6" strokeLinecap="round" />
      </svg>
    ),
    title: 'Second Opinion & Telemedicine',
    titleKo: '2차 소견 · 원격진료',
    desc: 'Remote consultation with our specialists via secure video. AI-powered imaging analysis available.',
    descKo: `전문의 화상 상담, ${AI_ORIGIN_TEXT} 기반 영상 분석, 자체 호스팅 WebRTC`,
    color: 'from-violet-500 to-violet-600',
    href: '/booking',
  },
  {
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 48 48" stroke="currentColor" strokeWidth={1.5}>
        <path d="M6 24h10l4-8 4 16 4-12 4 8h10" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="8" width="40" height="32" rx="4" />
      </svg>
    ),
    title: 'Patient Transfer (FHIR)',
    titleKo: '환자 전원 · 데이터 연동',
    desc: 'Seamless patient transfer with FHIR R4 standard. Automated clinical data exchange between hospitals.',
    descKo: 'FHIR R4 표준 기반 환자 전원, 진료정보 자동 교환',
    color: 'from-amber-500 to-orange-500',
    href: '/international/interoperability',
  },
];

const PROCESS_STEPS = [
  { num: '01', title: 'Contact Us', titleKo: '문의', desc: 'Email or call our International Patient Center. We respond within 24 hours.', descKo: '국제진료센터에 이메일 또는 전화로 문의하세요. 24시간 내 회신합니다.' },
  { num: '02', title: 'Consultation', titleKo: '상담', desc: 'Our coordinator reviews your medical records and arranges the right specialist.', descKo: '코디네이터가 의료기록을 검토하고 적합한 전문의를 배정합니다.' },
  { num: '03', title: 'Travel & Visit', titleKo: '방문', desc: 'We assist with visa, flight, accommodation, and airport pickup arrangements.', descKo: '비자, 항공, 숙소, 공항 픽업을 지원합니다.' },
  { num: '04', title: 'Treatment', titleKo: '진료', desc: 'Receive world-class treatment with interpreter support throughout your stay.', descKo: '통역 지원과 함께 최고 수준의 진료를 받으세요.' },
  { num: '05', title: 'Follow-up', titleKo: '사후 관리', desc: 'Post-treatment telemedicine follow-ups and medical record sharing via FHIR.', descKo: '퇴원 후 원격 진료 및 FHIR 기반 의료기록 공유.' },
];

const LANGUAGES = [
  { flag: '🇰🇷', lang: '한국어', level: 'Native', speakers: '전 직원' },
  { flag: '🇺🇸', lang: 'English', level: 'Full Support', speakers: 'Coordinators & Doctors' },
  { flag: '🇨🇳', lang: '中文', level: 'Interpretation', speakers: '전문 통역사' },
  { flag: '🇯🇵', lang: '日本語', level: 'Interpretation', speakers: '전문 통역사' },
  { flag: '🇷🇺', lang: 'Русский', level: 'Arrangement', speakers: '예약 통역' },
  { flag: '🇻🇳', lang: 'Tiếng Việt', level: 'Arrangement', speakers: '예약 통역' },
];

/*
 * 🔴 W9(P15 날조 / P12 정본이 둘, 운영 실측 2026-08-14): 이 STATS 가 전부 하드코딩이었고
 *    같은 사이트의 다른 화면과 어긋났다.
 *      - '16+ Specialties' ↔ /about '22개' ↔ 홈 노출 7개 (공개 API 실값은 22)
 *      - '300+ Beds'       ↔ /about '240병상' ↔ CMS 연혁 '200병상' ↔ 운영 DB 57 (근거 없음)
 *      - '29 Physicians'   ↔ 공개 의료진 목록 실제 27명
 *      - '5 Languages'     ↔ 바로 아래 LANGUAGES 표는 6개 언어 (같은 화면 안에서 모순)
 *    셀 수 있는 것은 공개 API/같은 파일의 데이터에서 세고, 근거 없는 병상 수는 뺀다.
 */
async function buildStats() {
  const [departments, doctors] = await Promise.all([
    publicFetch<{ slug: string }[]>('/api/v1/public/departments', 3600),
    publicFetch<{ id: string }[]>('/api/v1/public/doctors', 3600),
  ]);
  return [
    departments && { value: String(departments.length), label: 'Specialties', labelKo: '진료과' },
    doctors && { value: String(doctors.length), label: 'Physicians', labelKo: '의료진' },
    { value: '24/7', label: 'Emergency', labelKo: '응급실' },
    { value: String(LANGUAGES.length), label: 'Languages', labelKo: '지원 언어' },
    { value: 'FHIR R4', label: 'Standard', labelKo: '국제 표준' },
  ].filter(Boolean) as { value: string; label: string; labelKo: string }[];
}

export default async function InternationalPage() {
  const [STATS, hours] = await Promise.all([buildStats(), getClinicHours()]);
  // 🔴 T6: 영문 진료시간 한 줄도 CMS 정본에서 — 못 읽으면 줄을 그리지 않는다(코드 상수를 사실로 내보내지 않는다)
  const weekdayRange = hours.source === 'cms' ? toIsoRange(hours.weekday) : null;

  return (
    <div>
      {/* Hero — Full Width Gradient */}
      <section className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 800 600">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1" fill="white" />
              </pattern>
            </defs>
            <rect width="800" height="600" fill="url(#grid)" />
            {/* Globe outline */}
            <circle cx="650" cy="300" r="200" fill="none" stroke="white" strokeWidth="0.5" opacity="0.3" />
            <ellipse cx="650" cy="300" rx="200" ry="80" fill="none" stroke="white" strokeWidth="0.5" opacity="0.2" />
            <ellipse cx="650" cy="300" rx="80" ry="200" fill="none" stroke="white" strokeWidth="0.5" opacity="0.2" />
            <line x1="450" y1="300" x2="850" y2="300" stroke="white" strokeWidth="0.5" opacity="0.15" />
            <line x1="650" y1="100" x2="650" y2="500" stroke="white" strokeWidth="0.5" opacity="0.15" />
            {/* Example Island */}
            <ellipse cx="650" cy="350" rx="30" ry="15" fill="white" opacity="0.1" />
            <circle cx="650" cy="350" r="4" fill="white" opacity="0.4" />
          </svg>
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm mb-6 border border-white/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Accepting International Patients
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              World-Class Healthcare
              <br />
              <span className="text-blue-300">on Example Island</span>
            </h1>
            <p className="text-lg text-blue-100 mb-4 leading-relaxed max-w-2xl">
              Weruby Hospital provides comprehensive medical services
              for international patients with multilingual support, seamless data exchange,
              and the healing beauty of Example.
            </p>
            <p className="text-base text-blue-200/80 mb-8">
              위루비병원은 가상의 자연 속에서 세계 수준의 의료 서비스를 제공합니다.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="tel:+82-2-000-0000" className="px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition shadow-lg">
                📞 +82-2-000-0000
              </a>
              <a href="mailto:international@hospital.example.org" className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold hover:bg-white/20 transition border border-white/20">
                ✉️ Contact Us
              </a>
              <Link href="/booking" className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold hover:bg-emerald-600 transition shadow-lg">
                🤖 AI Booking
              </Link>
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="relative border-t border-white/10 bg-white/5 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-6">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
              {STATS.map(s => (
                /* 🔴 값 `FHIR R4` 가 좁은 칸(모바일 3열 ≈98px)에서 `FHIR`/`R4` 로 접혀 그 칸만
                   높아지고 나머지가 위로 쏠렸다. 값은 한 줄 고정, 남는 높이는 위아래로 나눈다. */
                <div key={s.label} className="flex flex-col justify-center text-center">
                  <div className="overflow-x-auto whitespace-nowrap text-2xl md:text-3xl font-bold text-white">{s.value}</div>
                  <div className="text-xs text-blue-300">{s.label}</div>
                  <div className="text-[10px] text-blue-400/60">{s.labelKo}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">Our Services</h2>
          <p className="text-gray-500 mt-2">국제진료 서비스</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SERVICES.map(s => (
            <Link key={s.title} href={s.href}
              className="group relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-lg hover:border-blue-200 transition-all">
              <div className={`absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b ${s.color}`} />
              <div className="p-6 pl-8 flex gap-5">
                <div className={`flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${s.color} text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                  {s.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 mb-0.5">{s.title}</h3>
                  <p className="text-xs text-gray-400 mb-2">{s.titleKo}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.descKo}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Process */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900">How It Works</h2>
            <p className="text-gray-500 mt-2">진료 절차 안내</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {PROCESS_STEPS.map((step, i) => (
              <div key={step.num} className="relative">
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 h-full">
                  <div className="text-3xl font-black text-blue-100 mb-3">{step.num}</div>
                  <h3 className="font-bold text-gray-900 text-sm mb-0.5">{step.title}</h3>
                  <p className="text-[10px] text-blue-600 font-semibold mb-2">{step.titleKo}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{step.descKo}</p>
                </div>
                {i < 4 && (
                  <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 z-10 text-gray-300">→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">Language Support</h2>
          <p className="text-gray-500 mt-2">다국어 지원</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {LANGUAGES.map(l => (
            <div key={l.lang} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center hover:border-blue-200 transition">
              <div className="text-4xl mb-3">{l.flag}</div>
              <div className="font-bold text-gray-900">{l.lang}</div>
              <div className="text-xs text-blue-600 font-semibold mt-1">{l.level}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{l.speakers}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why Example */}
      <section className="bg-gradient-to-br from-emerald-50 to-blue-50 py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Why Example Island?</h2>
              <p className="text-gray-500 mb-2">왜 가상인가?</p>
              <div className="space-y-4 mt-6">
                {[
                  { title: 'UNESCO Natural Heritage', titleKo: '유네스코 자연유산', desc: 'Pristine nature for healing and recovery in a World Heritage site.' },
                  { title: 'Visa-Free Entry', titleKo: '무비자 입국', desc: 'Citizens of most countries can enter Example without a visa for up to 30 days.' },
                  { title: 'Direct Flights', titleKo: '직항 노선', desc: 'International flights from Tokyo, Osaka, Shanghai, Beijing, and more.' },
                  { title: 'Modern Facilities', titleKo: '최신 시설', desc: 'State-of-the-art medical equipment including MRI, CT, PET-CT, and robotic surgery.' },
                ].map(item => (
                  <div key={item.title} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 text-sm">{item.title} <span className="text-gray-400 font-normal">· {item.titleKo}</span></h4>
                      <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Example Illustration */}
            <div className="flex justify-center">
              <svg viewBox="0 0 400 300" className="w-full max-w-md">
                {/* Sky */}
                <defs>
                  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bfdbfe" /><stop offset="100%" stopColor="#e0f2fe" /></linearGradient>
                  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#3b82f6" /></linearGradient>
                  <linearGradient id="mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4ade80" /><stop offset="100%" stopColor="#16a34a" /></linearGradient>
                </defs>
                <rect width="400" height="300" fill="url(#sky)" rx="16" />
                {/* Sea */}
                <rect y="200" width="400" height="100" fill="url(#sea)" rx="0" />
                {/* Island */}
                <ellipse cx="200" cy="200" rx="140" ry="35" fill="#86efac" />
                {/* Hallasan */}
                <path d="M160 200 L200 130 L240 200" fill="url(#mt)" />
                <ellipse cx="200" cy="138" rx="12" ry="6" fill="#fef3c7" opacity="0.6" />
                {/* Hospital */}
                <rect x="255" y="175" width="30" height="25" fill="white" rx="2" />
                <path d="M265 180v10M260 185h10" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
                <rect x="258" y="172" width="24" height="5" fill="#60a5fa" rx="1" />
                {/* Palm trees */}
                <line x1="130" y1="195" x2="130" y2="175" stroke="#92400e" strokeWidth="2" />
                <ellipse cx="125" cy="172" rx="10" ry="5" fill="#22c55e" />
                <ellipse cx="135" cy="170" rx="10" ry="5" fill="#16a34a" />
                {/* Sun */}
                <circle cx="340" cy="60" r="25" fill="#fbbf24" opacity="0.8" />
                {/* Clouds */}
                <ellipse cx="80" cy="50" rx="30" ry="12" fill="white" opacity="0.7" />
                <ellipse cx="100" cy="45" rx="25" ry="10" fill="white" opacity="0.6" />
                {/* Plane */}
                <g transform="translate(300, 90) rotate(-15)">
                  <path d="M0 0 L-15 5 L-5 0 L-15 -5 Z" fill="white" opacity="0.8" />
                  <line x1="0" y1="0" x2="10" y2="0" stroke="white" strokeWidth="1.5" opacity="0.6" />
                </g>
                {/* Text */}
                <text x="200" y="260" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" opacity="0.9">Example Island, Korea</text>
                <text x="200" y="278" textAnchor="middle" fill="white" fontSize="10" opacity="0.6">가상특별자치도</text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">More Information</h2>
          <p className="text-gray-500 mt-2">상세 안내</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href="/international/partners" className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-8 hover:shadow-lg hover:border-blue-200 transition-all">
            <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Partner Network</h3>
            <p className="text-xs text-gray-400 mb-2">해외 파트너</p>
            <p className="text-sm text-gray-500">Partner hospitals, insurance companies, and medical tourism agencies worldwide.</p>
          </Link>
          <Link href="/international/insurance" className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-8 hover:shadow-lg hover:border-blue-200 transition-all">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Insurance & Cost</h3>
            <p className="text-xs text-gray-400 mb-2">보험 · 비용 안내</p>
            <p className="text-sm text-gray-500">Travel insurance, cost estimates, payment methods, and English document issuance.</p>
          </Link>
          <Link href="/international/interoperability" className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-8 hover:shadow-lg hover:border-blue-200 transition-all">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <svg className="w-7 h-7 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Data Interoperability</h3>
            <p className="text-xs text-gray-400 mb-2">의료 데이터 연동</p>
            <p className="text-sm text-gray-500">FHIR R4 API with 18 resources, partner registration, and secure data exchange.</p>
          </Link>
        </div>
      </section>

      {/* Contact */}
      <section className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-2">International Patient Center</h2>
          <p className="text-blue-300 mb-8">국제진료센터</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📞</div>
              <div className="font-semibold">Phone</div>
              <div className="text-blue-200 text-sm mt-1">+82-2-000-0000</div>
              {/* 🔴 W9: 09:00-18:00 하드코딩 — CMS 정본(09:00~17:30)과 달랐다 */}
              {weekdayRange && <div className="text-blue-300/60 text-xs">Mon-Fri {weekdayRange.opens}-{weekdayRange.closes} KST</div>}
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">✉️</div>
              <div className="font-semibold">Email</div>
              <div className="text-blue-200 text-sm mt-1">international@hospital.example.org</div>
              <div className="text-blue-300/60 text-xs">Response within 24h</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📍</div>
              <div className="font-semibold">Address</div>
              <div className="text-blue-200 text-sm mt-1">126, Example-ro, Example City</div>
              <div className="text-blue-300/60 text-xs">Example, South Korea 00000</div>
            </div>
          </div>
          <Link href="/about/directions" className="inline-block px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition">
            Directions & Map →
          </Link>
        </div>
      </section>
    </div>
  );
}
