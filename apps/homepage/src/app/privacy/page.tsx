import type { Metadata } from 'next';
import { SITE_INFO } from '@/lib/site-info';

export const metadata: Metadata = { title: '개인정보처리방침' };

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-12 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">개인정보처리방침</h1>

      <div className="prose prose-sm prose-gray max-w-none space-y-6 text-sm leading-relaxed text-gray-700">
        <p>
          위루비병원(이하 &quot;병원&quot;)은 「개인정보 보호법」 제30조에 따라 정보주체의
          개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여
          다음과 같이 개인정보 처리방침을 수립·공개합니다.
        </p>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제1조 (개인정보의 처리 목적)</h2>
          <p>병원은 다음의 목적을 위하여 개인정보를 처리합니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>진료 예약, 접수 및 진료 서비스 제공</li>
            <li>건강검진 예약 및 결과 안내</li>
            <li>온라인 상담 및 고객의 소리 접수·처리</li>
            <li>홈페이지 회원 가입 및 관리</li>
            <li>의료 관련 법적 의무 이행</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제2조 (개인정보의 처리 및 보유 기간)</h2>
          <p>
            병원은 법령에 따른 개인정보 보유·이용기간 또는 정보주체로부터 개인정보를 수집 시에
            동의 받은 개인정보 보유·이용기간 내에서 개인정보를 처리·보유합니다.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>진료 기록: 의료법 제22조에 따라 10년</li>
            <li>처방전: 의료법 시행규칙에 따라 2년</li>
            <li>건강검진 기록: 5년</li>
            <li>홈페이지 회원 정보: 탈퇴 시까지</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제3조 (개인정보의 제3자 제공)</h2>
          <p>
            병원은 정보주체의 동의, 법률의 특별한 규정 등 「개인정보 보호법」 제17조 및 제18조에
            해당하는 경우에만 개인정보를 제3자에게 제공합니다.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제4조 (정보주체의 권리·의무 및 행사 방법)</h2>
          <p>정보주체는 병원에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>개인정보 열람 요구</li>
            <li>오류 등이 있을 경우 정정 요구</li>
            <li>삭제 요구</li>
            <li>처리 정지 요구</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제5조 (개인정보의 안전성 확보 조치)</h2>
          <p>병원은 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취하고 있습니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>관리적 조치: 내부 관리계획 수립·시행, 정기적 직원 교육</li>
            <li>기술적 조치: 개인정보처리시스템 등의 접근 권한 관리, 암호화 기술 적용</li>
            <li>물리적 조치: 전산실, 자료보관실 등 접근 통제</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제6조 (개인정보 보호책임자)</h2>
          <div className="bg-gray-50 rounded-xl p-4 text-sm">
            <p><strong>개인정보 보호책임자</strong></p>
            <p>부서: 의료정보팀</p>
            <p>연락처: {SITE_INFO.phone}</p>
            <p>이메일: {SITE_INFO.email.privacy}</p>
          </div>
        </section>

        <p className="text-xs text-gray-400 mt-8">
          이 개인정보처리방침은 2026년 1월 1일부터 적용됩니다.
        </p>
      </div>
    </div>
  );
}
