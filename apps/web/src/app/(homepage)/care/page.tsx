import Link from 'next/link';
import { IconBox, PATHS } from '@/components/homepage/SvgIcon';

const SECTIONS: { label: string; href: string; desc: string; iconName: keyof typeof PATHS; gradient: string }[] = [
  { label: '진료과 소개', href: '/care/departments', desc: '22개 전문 진료과', iconName: 'stethoscope', gradient: 'from-blue-500 to-indigo-500' },
  { label: '전문센터', href: '/care/centers', desc: '5개 전문 센터', iconName: 'heart', gradient: 'from-rose-500 to-pink-500' },
  { label: '의료진 소개', href: '/care/doctors', desc: '전문 의료진 소개', iconName: 'users', gradient: 'from-emerald-500 to-teal-500' },
  { label: '진료시간·예약', href: '/care/schedule', desc: '진료 시간 및 예약 안내', iconName: 'clock', gradient: 'from-amber-500 to-orange-500' },
  { label: '비급여 안내', href: '/care/non-covered', desc: '비급여 항목 및 가격', iconName: 'money', gradient: 'from-violet-500 to-purple-500' },
];

export default function CarePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
      <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Medical Services</p>
      <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900 mb-2">진료 안내</h1>
      <p className="text-sm text-gray-500 mb-8">위루비병원의 진료 서비스를 안내합니다</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map(s => (
          <Link key={s.href} href={s.href} className="group bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-300">
            <IconBox name={s.iconName} gradient={s.gradient} />
            <h3 className="text-base font-bold text-gray-900 mt-4 group-hover:text-blue-700 transition">{s.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
