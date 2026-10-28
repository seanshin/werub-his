import Link from 'next/link';
import { SvgIcon, IconBox, PATHS } from '@/components/homepage/SvgIcon';

const ITEMS: { label: string; href: string; desc: string; iconName: keyof typeof PATHS; gradient: string }[] = [
  { label: '입원 안내', href: '/guide/admission', desc: '입원 절차, 준비물, 병실 안내', iconName: 'bed', gradient: 'from-blue-500 to-indigo-500' },
  { label: '면회 안내', href: '/guide/visiting', desc: '면회 시간, 장소, 주의사항', iconName: 'users', gradient: 'from-emerald-500 to-teal-500' },
  { label: '주차 안내', href: '/guide/parking', desc: '주차장 위치, 요금, 무료 안내', iconName: 'building', gradient: 'from-amber-500 to-orange-500' },
  { label: '편의시설', href: '/guide/dining', desc: '식당, 카페, 편의점 안내', iconName: 'building', gradient: 'from-pink-500 to-rose-500' },
  { label: '장례식장', href: '/guide/funeral', desc: '장례식장 이용 안내', iconName: 'heart', gradient: 'from-gray-500 to-slate-500' },
  { label: '환자 권리·의무', href: '/guide/rights', desc: '환자안전법에 따른 권리와 의무', iconName: 'shield', gradient: 'from-violet-500 to-purple-500' },
];

export default function GuidePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10">
      <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Patient Guide</p>
      <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900 mb-2">입원·이용 안내</h1>
      <p className="text-sm text-gray-500 mb-8">입원, 면회, 주차, 편의시설 등을 안내합니다</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {ITEMS.map(i => (
          <Link key={i.href} href={i.href} className="group bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-300">
            <IconBox name={i.iconName} gradient={i.gradient} />
            <h3 className="text-sm font-bold text-gray-900 mt-4 group-hover:text-blue-700 transition">{i.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{i.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
