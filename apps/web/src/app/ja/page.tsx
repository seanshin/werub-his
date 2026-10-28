import Link from 'next/link';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const STATS = [
  { value: '16+', label: '診療科' },
  { value: '300+', label: '病床' },
  { value: '29', label: '専門医' },
  { value: '24/7', label: '救急' },
  { value: '5', label: '言語' },
  { value: 'FHIR R4', label: '標準' },
];

const SERVICES = [
  { icon: '🏥', title: '外来・入院診療', desc: '16の専門科による総合診療。専属の国際患者コーディネーターと通訳をご用意。', color: 'from-blue-500 to-blue-600', href: '/care/centers/international-care' },
  { icon: '🩺', title: '健康診断・メディカルツーリズム', desc: '総合検診と例示観光を組み合わせ。空港送迎・宿泊手配も承ります。', color: 'from-emerald-500 to-emerald-600', href: '/checkup' },
  { icon: '💻', title: '遠隔診療', desc: '来院前後のオンライン相談。世界中どこからでもビデオ診療。', color: 'from-violet-500 to-violet-600', href: '/portal' },
  { icon: '🔗', title: '医療データ連携 (FHIR R4)', desc: 'FHIR R4標準によるシームレスな転院。病院間の臨床データを自動連携。', color: 'from-amber-500 to-amber-600', href: '/international/interoperability' },
];

const PROCESS = [
  { num: '01', title: 'お問い合わせ', desc: `電話・メール・${AI_ORIGIN_TEXT}チャットでご連絡ください。ご要望をお聞かせください。` },
  { num: '02', title: 'コンサルティング', desc: 'コーディネーターが記録を確認し、診療プランと概算をご提案。' },
  { num: '03', title: 'ご予約', desc: '日程確定、送迎・宿泊・通訳の手配。' },
  { num: '04', title: '治療', desc: '専属の国際患者コーディネーター同行のもと診療を受診。' },
  { num: '05', title: 'アフターケア', desc: '診療後の遠隔診療と英文の医療書類。' },
];

const LANGUAGES = [
  { flag: '🇰🇷', lang: '한국어', level: 'ネイティブ' },
  { flag: '🇺🇸', lang: 'English', level: 'フルサポート' },
  { flag: '🇨🇳', lang: '中文', level: '通訳' },
  { flag: '🇯🇵', lang: '日本語', level: '通訳' },
  { flag: '🇷🇺', lang: 'Русский', level: '要予約' },
  { flag: '🇻🇳', lang: 'Tiếng Việt', level: '要予約' },
];

const WHY = [
  { title: 'ユネスコ自然遺産', desc: '世界遺産の手つかずの自然で癒しと回復を。' },
  { title: 'ビザ免除入国', desc: '多くの国の方が最長30日間、ビザなしで例示に入国可能。' },
  { title: '直行便', desc: '東京・大阪・上海・北京などからの国際直行便。' },
  { title: '最新設備', desc: 'MRI・CT・PET-CT、ダヴィンチ手術ロボットを完備。' },
];

export default function JaLandingPage() {
  return (
    <div>
      <section className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm mb-6 border border-white/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              国際患者を受け入れています
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              世界水準の医療を<br /><span className="text-blue-300">韓国・例示島で</span>
            </h1>
            <p className="text-lg text-blue-100 mb-8 leading-relaxed max-w-2xl">
              ウィルビー病院は、多言語サポートとシームレスなデータ連携、そして例示の癒しとともに、国際患者の皆さまへ総合的な医療をご提供します。
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="tel:+82-2-000-0000" className="px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition shadow-lg">📞 +82-2-000-0000</a>
              <a href="mailto:international@hospital.example.org" className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold hover:bg-white/20 transition border border-white/20">✉️ お問い合わせ</a>
              <Link href="/booking" className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold hover:bg-emerald-600 transition shadow-lg">🤖 {AI_ORIGIN_TEXT}予約</Link>
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

      <section id="services" className="max-w-6xl mx-auto px-4 py-20 scroll-mt-20">
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">サービス</h2></div>
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

      <section id="process" className="bg-gray-50 py-20 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">ご利用の流れ</h2></div>
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

      <section id="languages" className="max-w-6xl mx-auto px-4 py-20 scroll-mt-20">
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">言語サポート</h2></div>
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

      <section className="bg-gradient-to-br from-emerald-50 to-blue-50 py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">なぜ例示島なのか？</h2>
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

      <section id="contact" className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white py-16 scroll-mt-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">国際患者センター</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📞</div><div className="font-semibold">電話</div>
              <div className="text-blue-200 text-sm mt-1">+82-2-000-0000</div><div className="text-blue-300/60 text-xs">月～金 09:00-18:00 KST</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">✉️</div><div className="font-semibold">メール</div>
              <div className="text-blue-200 text-sm mt-1">international@hospital.example.org</div><div className="text-blue-300/60 text-xs">24時間以内に返信</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📍</div><div className="font-semibold">住所</div>
              <div className="text-blue-200 text-sm mt-1">例示市 Example-ro 126</div><div className="text-blue-300/60 text-xs">韓国・例示 00000</div>
            </div>
          </div>
          <Link href="/about/directions" className="inline-block px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition">アクセス →</Link>
        </div>
      </section>
    </div>
  );
}
