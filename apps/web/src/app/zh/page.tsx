import Link from 'next/link';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

const STATS = [
  { value: '16+', label: '专科' },
  { value: '300+', label: '床位' },
  { value: '29', label: '专科医生' },
  { value: '24/7', label: '急诊' },
  { value: '5', label: '语言' },
  { value: 'FHIR R4', label: '标准' },
];

const SERVICES = [
  { icon: '🏥', title: '门诊与住院诊疗', desc: '16个专科的全方位诊疗，配备专属国际患者协调员及口译支持。', color: 'from-blue-500 to-blue-600', href: '/care/centers/international-care' },
  { icon: '🩺', title: '健康体检与医疗旅游', desc: '综合体检结合示例观光，提供机场接送与住宿安排。', color: 'from-emerald-500 to-emerald-600', href: '/checkup' },
  { icon: '💻', title: '远程医疗', desc: '就诊前后的远程视频咨询，随时随地接受诊疗。', color: 'from-violet-500 to-violet-600', href: '/portal' },
  { icon: '🔗', title: '医疗数据对接 (FHIR R4)', desc: '基于 FHIR R4 标准的无缝转诊，医院间临床数据自动交换。', color: 'from-amber-500 to-amber-600', href: '/international/interoperability' },
];

const PROCESS = [
  { num: '01', title: '咨询', desc: `通过电话、邮件或 ${AI_ORIGIN_TEXT} 聊天联系我们，告知您的需求。` },
  { num: '02', title: '会诊', desc: '协调员审阅病历，提供诊疗方案与费用估算。' },
  { num: '03', title: '预约', desc: '确认日程，安排接送、住宿及口译。' },
  { num: '04', title: '治疗', desc: '在专属国际患者协调员陪同下接受诊疗。' },
  { num: '05', title: '随访', desc: '诊后远程医疗及英文医疗文件。' },
];

const LANGUAGES = [
  { flag: '🇰🇷', lang: '한국어', level: '母语' },
  { flag: '🇺🇸', lang: 'English', level: '全程支持' },
  { flag: '🇨🇳', lang: '中文', level: '口译' },
  { flag: '🇯🇵', lang: '日本語', level: '口译' },
  { flag: '🇷🇺', lang: 'Русский', level: '可安排' },
  { flag: '🇻🇳', lang: 'Tiếng Việt', level: '可安排' },
];

const WHY = [
  { title: '联合国教科文组织自然遗产', desc: '在世界遗产地的纯净自然中疗愈与康复。' },
  { title: '免签入境', desc: '多数国家公民可免签入境示例，停留最长30天。' },
  { title: '直飞航线', desc: '东京、大阪、上海、北京等地直飞航班。' },
  { title: '先进设施', desc: '配备 MRI、CT、PET-CT 及达芬奇手术机器人。' },
];

export default function ZhLandingPage() {
  return (
    <div>
      <section className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 text-white overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur-sm rounded-full text-sm mb-6 border border-white/20">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              正在接收国际患者
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight mb-6">
              世界一流的医疗服务<br /><span className="text-blue-300">尽在韩国示例岛</span>
            </h1>
            <p className="text-lg text-blue-100 mb-8 leading-relaxed max-w-2xl">
              威路比医院为国际患者提供全面的医疗服务——多语言支持、无缝数据交换，以及示例的疗愈之美。
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="tel:+82-2-000-0000" className="px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition shadow-lg">📞 +82-2-000-0000</a>
              <a href="mailto:international@hospital.example.org" className="px-6 py-3 bg-white/10 backdrop-blur-sm text-white rounded-xl font-semibold hover:bg-white/20 transition border border-white/20">✉️ 联系我们</a>
              <Link href="/booking" className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold hover:bg-emerald-600 transition shadow-lg">🤖 {AI_ORIGIN_TEXT} 预约</Link>
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
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">我们的服务</h2></div>
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
          <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">就诊流程</h2></div>
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
        <div className="text-center mb-12"><h2 className="text-3xl font-bold text-gray-900">语言支持</h2></div>
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
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">为什么选择示例岛？</h2>
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
          <h2 className="text-3xl font-bold mb-8">国际患者中心</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📞</div><div className="font-semibold">电话</div>
              <div className="text-blue-200 text-sm mt-1">+82-2-000-0000</div><div className="text-blue-300/60 text-xs">周一至周五 09:00-18:00 KST</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">✉️</div><div className="font-semibold">邮箱</div>
              <div className="text-blue-200 text-sm mt-1">international@hospital.example.org</div><div className="text-blue-300/60 text-xs">24小时内回复</div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
              <div className="text-2xl mb-2">📍</div><div className="font-semibold">地址</div>
              <div className="text-blue-200 text-sm mt-1">示例市 Example-ro 126</div><div className="text-blue-300/60 text-xs">韩国示例 00000</div>
            </div>
          </div>
          <Link href="/about/directions" className="inline-block px-6 py-3 bg-white text-blue-900 rounded-xl font-semibold hover:bg-blue-50 transition">交通指引 →</Link>
        </div>
      </section>
    </div>
  );
}
