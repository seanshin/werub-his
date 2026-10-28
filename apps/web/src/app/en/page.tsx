import Link from 'next/link';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const STATS = [
  { value: '16+', label: 'Specialties' },
  { value: '300+', label: 'Beds' },
  { value: '29', label: 'Physicians' },
  { value: '24/7', label: 'Emergency' },
  { value: '5', label: 'Languages' },
  { value: 'FHIR R4', label: 'Standard' },
];

const SERVICES = [
  { icon: '🏥', title: 'Outpatient & Inpatient Care', desc: 'Full-spectrum care across 16 specialties with dedicated international coordinators and interpretation.', color: 'from-blue-500 to-blue-600', href: '/care/centers/international-care' },
  { icon: '🩺', title: 'Health Checkup & Medical Tourism', desc: 'Comprehensive screening combined with Example tourism. Airport pickup and accommodation arranged.', color: 'from-emerald-500 to-emerald-600', href: '/checkup' },
  { icon: '💻', title: 'Telemedicine', desc: 'Remote consultations before and after your visit — video care from anywhere in the world.', color: 'from-violet-500 to-violet-600', href: '/portal' },
  { icon: '🔗', title: 'Medical Data Exchange (FHIR R4)', desc: 'Seamless transfer with FHIR R4 standard. Automated clinical data exchange between hospitals.', color: 'from-amber-500 to-amber-600', href: '/international/interoperability' },
];

const PROCESS = [
  { num: '01', title: 'Inquiry', desc: `Contact us by phone, email, or ${AI_ORIGIN_TEXT} chat. Tell us your needs.` },
  { num: '02', title: 'Consultation', desc: 'Coordinator reviews records and proposes a care plan & estimate.' },
  { num: '03', title: 'Reservation', desc: 'Confirm schedule, arrange pickup, accommodation, and interpreter.' },
  { num: '04', title: 'Treatment', desc: 'Receive care with a dedicated international patient coordinator.' },
  { num: '05', title: 'Follow-up', desc: 'Post-care telemedicine and English medical documents.' },
];

const LANGUAGES = [
  { flag: '🇰🇷', lang: '한국어', level: 'Native' },
  { flag: '🇺🇸', lang: 'English', level: 'Full Support' },
  { flag: '🇨🇳', lang: '中文', level: 'Interpretation' },
  { flag: '🇯🇵', lang: '日本語', level: 'Interpretation' },
  { flag: '🇷🇺', lang: 'Русский', level: 'On Request' },
  { flag: '🇻🇳', lang: 'Tiếng Việt', level: 'On Request' },
];

const WHY = [
  { title: 'UNESCO Natural Heritage', desc: 'Pristine nature for healing and recovery in a World Heritage site.' },
  { title: 'Visa-Free Entry', desc: 'Citizens of most countries can enter Example visa-free for up to 30 days.' },
  { title: 'Direct Flights', desc: 'International flights from Tokyo, Osaka, Shanghai, Beijing, and more.' },
  { title: 'Modern Facilities', desc: 'MRI, CT, PET-CT, and da Vinci robotic surgery on site.' },
];

export default function EnLandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm mb-6 border border-white/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Accepting International Patients
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              World-Class Healthcare<br /><span className="text-blue-300">on Example Island</span>
            </h1>
            <p className="text-lg text-blue-100 mb-8 leading-relaxed max-w-2xl">
              Weruby Hospital provides comprehensive medical services
              for international patients — with multilingual support, seamless data exchange,
              and the healing beauty of Example.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="tel:+82-2-000-0000" className="px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition shadow-lg">📞 +82-2-000-0000</a>
              <a href="mailto:international@hospital.example.org" className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold hover:bg-white/20 transition border border-white/20">✉️ Contact Us</a>
              <Link href="/booking" className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold hover:bg-emerald-600 transition shadow-lg">🤖 {AI_ORIGIN_TEXT} Booking</Link>
            </div>
          </div>
        </div>
        <div className="relative border-t border-white/10 bg-white/5 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-6">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
              {STATS.map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl md:text-3xl font-bold text-white">{s.value}</div>
                  <div className="text-xs text-blue-300">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="max-w-6xl mx-auto px-4 py-20 scroll-mt-20">
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">Our Services</h2></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SERVICES.map(s => (
            <Link key={s.title} href={s.href} className="group relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-lg hover:border-blue-200 transition-all">
              <div className={`absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b ${s.color}`} />
              <div className="p-6 pl-8 flex gap-5">
                <div className={`flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br ${s.color} text-white flex items-center justify-center text-3xl shadow-lg group-hover:scale-110 transition-transform`}>{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{s.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Process */}
      <section id="process" className="bg-gray-50 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">How It Works</h2></div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {PROCESS.map(step => (
              <div key={step.num} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="text-3xl font-black text-blue-100 mb-3">{step.num}</div>
                <h3 className="font-bold text-gray-900 text-sm mb-2">{step.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Languages */}
      <section id="languages" className="max-w-6xl mx-auto px-4 py-20 scroll-mt-20">
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">Language Support</h2></div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {LANGUAGES.map(l => (
            <div key={l.lang} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-center hover:border-blue-200 transition">
              <div className="text-4xl mb-3">{l.flag}</div>
              <div className="font-bold text-gray-900">{l.lang}</div>
              <div className="text-xs text-blue-600 font-semibold mt-1">{l.level}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why Example */}
      <section className="bg-gradient-to-br from-emerald-50 to-blue-50 py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Why Example Island?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {WHY.map(item => (
              <div key={item.title} className="flex gap-3 bg-white/60 rounded-2xl p-5">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 text-sm">{item.title}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white py-16 scroll-mt-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">International Patient Center</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📞</div><div className="font-semibold">Phone</div>
              <div className="text-blue-200 text-sm mt-1">+82-2-000-0000</div><div className="text-blue-300/60 text-xs">Mon-Fri 09:00-18:00 KST</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">✉️</div><div className="font-semibold">Email</div>
              <div className="text-blue-200 text-sm mt-1">international@hospital.example.org</div><div className="text-blue-300/60 text-xs">Response within 24h</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📍</div><div className="font-semibold">Address</div>
              <div className="text-blue-200 text-sm mt-1">126, Example-ro, Example City</div><div className="text-blue-300/60 text-xs">Example, South Korea 00000</div>
            </div>
          </div>
          <Link href="/about/directions" className="inline-block px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition">Directions & Map →</Link>
        </div>
      </section>
    </div>
  );
}
