import Link from 'next/link';
import { SITE_INFO } from '@/lib/site-info';

const SUPPORT_MENU = [
  { title: '자주 묻는 질문 (FAQ)', description: '진료, 입원, 수납, 검진 등 자주 묻는 질문을 모았습니다', href: '/support/faq', icon: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z', color: 'from-blue-500 to-indigo-500' },
  { title: '고객의 소리 (VOC)', description: '칭찬, 건의, 불만 접수를 안내합니다', href: '/support/voc', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z', color: 'from-emerald-500 to-teal-500' },
];

export default function SupportPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-12">
      <div className="mb-10">
        <p className="text-blue-600 font-semibold text-sm tracking-wide uppercase mb-1">Customer Support</p>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">고객참여</h1>
        <p className="text-sm text-gray-500 mt-2">환자분의 소중한 의견을 듣고, 더 나은 의료 서비스를 만들어 갑니다</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {SUPPORT_MENU.map(item => (
          <Link key={item.href} href={item.href}
            className="group bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-lg hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-300">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center shadow-sm mb-4`}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-700 transition">{item.title}</h3>
            <p className="text-sm text-gray-500 mt-2">{item.description}</p>
            <span className="inline-flex items-center gap-1 text-sm text-blue-600 font-semibold mt-4 group-hover:gap-2 transition-all">
              바로가기
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </Link>
        ))}
      </div>

      {/* 연락처 안내 */}
      <div className="mt-10 bg-gray-50 border border-gray-100 rounded-2xl p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-3">기타 문의</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs mb-1">대표전화</p>
            <p className="font-semibold text-gray-800">{SITE_INFO.phone}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">원무과</p>
            <p className="font-semibold text-gray-800">내선 2000</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs mb-1">이메일</p>
            <p className="font-semibold text-gray-800">support@hospitalrun.example</p>
          </div>
        </div>
      </div>
    </div>
  );
}
