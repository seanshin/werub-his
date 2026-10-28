'use client';

import Link from 'next/link';

const FHIR_RESOURCES = [
  'Patient', 'Encounter', 'MedicationRequest', 'Condition', 'Observation',
  'Immunization', 'Medication', 'Practitioner', 'AllergyIntolerance',
  'Procedure', 'Appointment', 'DiagnosticReport', 'ServiceRequest',
  'Location', 'CarePlan', 'DocumentReference', 'Organization',
];

export default function InteroperabilityPublicPage() {
  const submitApplication = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const one = (k: string) => String(fd.get(k) ?? '').trim() || undefined;
    const many = (k: string) => fd.getAll(k).map(String).filter(Boolean);
    try {
      const res = await fetch('/api/v1/partner/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgName: one('orgName'), orgType: one('orgType'), orgCode: one('orgCode'),
          country: one('country'), contactName: one('contactName'), contactEmail: one('contactEmail'),
          contactPhone: one('contactPhone'), fhirBaseUrl: one('fhirBaseUrl'),
          purpose: many('purpose'), requestedScopes: many('requestedScopes'),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => null);
      const id = body?.data?.id;
      // 🔴 접수된 것만 접수됐다고 말한다 — 접수번호를 함께 준다(확인 경로).
      alert(id ? `연동 신청이 접수되었습니다.\n접수번호: ${id}` : '연동 신청이 접수되었습니다.');
      form.reset();
    } catch {
      // 🔴 보내지 못한 것을 보냈다고 하지 않는다
      alert('신청을 접수하지 못했습니다. 잠시 후 다시 시도하시거나 international@hospital.example.org 로 보내주세요.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <div className="mb-4">
        <Link href="/international" className="text-sm text-blue-600 hover:underline">← International Healthcare</Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">의료 데이터 연동</h1>
      <p className="text-gray-500 mb-10">Healthcare Interoperability — FHIR R4 Standard</p>

      {/* Overview */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-8 text-white mb-10">
        <h2 className="text-2xl font-bold mb-3">FHIR R4 표준 API</h2>
        <p className="text-blue-100 mb-4">
          위루비병원은 HL7 FHIR R4 국제 표준을 준수하는 의료 데이터 API를 제공합니다.
          해외 병원, 보험사, 의료 시스템과 안전하게 환자 데이터를 교환할 수 있습니다.
        </p>
        <div className="flex gap-4">
          <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
            <div className="text-2xl font-bold">{FHIR_RESOURCES.length}</div>
            <div className="text-xs text-blue-200">FHIR Resources</div>
          </div>
          <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
            <div className="text-2xl font-bold">R4</div>
            <div className="text-xs text-blue-200">FHIR Version</div>
          </div>
          <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
            <div className="text-2xl font-bold">JWT</div>
            <div className="text-xs text-blue-200">Authentication</div>
          </div>
          <div className="bg-white/20 rounded-xl px-4 py-2 text-center">
            <div className="text-2xl font-bold">JSON</div>
            <div className="text-xs text-blue-200">Format</div>
          </div>
        </div>
      </div>

      {/* Transfer Process */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">환자 전원 프로세스</h2>
        <div className="grid grid-cols-4 gap-4">
          {[
            { step: 1, icon: '📋', title: 'Referral Request', desc: '전원 의뢰서 작성 (진단+투약+검사)' },
            { step: 2, icon: '📦', title: 'FHIR Bundle', desc: '표준 문서로 자동 패키징 + 디지털 서명' },
            { step: 3, icon: '🔐', title: 'Secure Transfer', desc: 'SMART-on-FHIR 인증 + HTTPS 전송' },
            { step: 4, icon: '✅', title: 'Confirmation', desc: '수신 확인 + 환자 자동 등록' },
          ].map(s => (
            <div key={s.step} className="bg-white rounded-2xl border shadow-sm p-5 text-center">
              <div className="text-3xl mb-2">{s.icon}</div>
              <div className="text-xs font-bold text-blue-600 mb-1">Step {s.step}</div>
              <div className="font-semibold text-gray-900 text-sm mb-1">{s.title}</div>
              <div className="text-xs text-gray-500">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FHIR Resources */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">지원 FHIR R4 리소스</h2>
        <div className="flex flex-wrap gap-2">
          {FHIR_RESOURCES.map(r => (
            <span key={r} className="px-3 py-1.5 bg-white border rounded-lg text-sm font-medium text-gray-700">{r}</span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          <strong>Base URL:</strong> https://his.example.org/fhir/R4 |
          <strong> CapabilityStatement:</strong>{' '}
          <a href="https://his.example.org/fhir/R4/metadata" target="_blank" className="text-blue-600 underline">GET /fhir/R4/metadata</a>
        </p>
      </section>

      {/* For Partners */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">연동 파트너를 위한 안내</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-2">🏥 해외 병원</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• FHIR Bundle로 환자 전원 의뢰/수신</li>
              <li>• SMART-on-FHIR 클라이언트 등록 필요</li>
              <li>• 진단(ICD-10) + 약물(ATC) 국제 코드 사용</li>
              <li>• 영문 진료요약서 자동 생성</li>
            </ul>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-2">💳 보험사</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• 진료비 청구 데이터 FHIR 형식 제공</li>
              <li>• DiagnosticReport + Claim 리소스</li>
              <li>• 실시간 입원/퇴원 알림 (Webhook)</li>
              <li>• 영문 영수증 + 진단서 API</li>
            </ul>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-2">📱 앱 개발사</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Patient/Observation 읽기 권한</li>
              <li>• SMART App Launch (EHR Launch Context)</li>
              <li>• OAuth2 스코프 기반 접근 제어</li>
              <li>• Sandbox 환경 제공 예정</li>
            </ul>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-2">🇰🇷 국내 병원</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• 건강정보고속도로 CDA 연동 (예정)</li>
              <li>• CI 기반 환자 자동 매칭</li>
              <li>• KCD-8 + EDI 코드 지원</li>
              <li>• 전원 의뢰서/회신서 표준 양식</li>
            </ul>
          </div>
        </div>
      </section>

      {/* API Example */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">API 사용 예시</h2>
        <div className="bg-gray-900 rounded-2xl p-6 text-sm">
          <pre className="text-green-400 overflow-x-auto">
{`# 1. 인증
POST /api/v1/auth/login
Content-Type: application/json
{"email": "partner@hospital.example", "password": "..."}

# 2. 환자 검색
GET /fhir/R4/Patient?name=Kim&gender=male
Authorization: Bearer <access_token>

# 3. 검사 결과 조회
GET /fhir/R4/Observation?patient=<patient-id>
Authorization: Bearer <access_token>

# 4. 전원 의뢰
POST /api/v1/transfer/request
Authorization: Bearer <access_token>
{
  "patientId": "<patient-id>",
  "toOrgCode": "11100001",
  "urgency": "URGENT",
  "reason": "Specialist consultation required"
}`}
          </pre>
        </div>
      </section>

      {/* Partner Integration Lifecycle */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">연동 파트너 등록 절차</h2>
        <div className="space-y-3">
          {[
            { step: 1, title: '연동 신청', desc: '아래 폼으로 기관 정보와 연동 목적을 제출합니다.', icon: '📝', time: '즉시' },
            { step: 2, title: '심사·검증', desc: '기관 정보 검증, 연동 범위 협의, 보안 요건을 확인합니다.', icon: '🔍', time: '3~5 영업일' },
            { step: 3, title: '승인·인증 발급', desc: 'SMART Client ID/Secret 발급, Scope 및 Rate Limit을 설정합니다.', icon: '🔑', time: '승인 즉시' },
            { step: 4, title: 'Sandbox 테스트', desc: '테스트 환경에서 FHIR API 연동을 검증합니다.', icon: '🧪', time: '1~2주' },
            { step: 5, title: '운영 전환', desc: 'Production 환경 활성화, 모니터링 대시보드를 제공합니다.', icon: '🚀', time: '검증 완료 후' },
            { step: 6, title: '운영 모니터링', desc: 'API 호출 통계, 에러율, 응답시간을 실시간으로 제공합니다.', icon: '📊', time: '상시' },
          ].map(s => (
            <div key={s.step} className="flex items-center gap-4 bg-white rounded-xl border p-4">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-lg flex-shrink-0">{s.icon}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-600">Step {s.step}</span>
                  <span className="font-semibold text-gray-900 text-sm">{s.title}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
              </div>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{s.time}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Application Form */}
      <section className="mb-12" id="apply">
        <h2 className="text-xl font-bold text-gray-900 mb-4">연동 파트너 신청</h2>
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          {/**
            * 🔴 종전엔 `onSubmit` 이 `alert('연동 신청이 접수되었습니다…')` 뿐이었다 —
            *    이 파일 전체에 `fetch` 가 **0회**였다. 아무 데도 보내지 않고 "접수됐다"고 말했고
            *    신청자는 영영 오지 않는 회신을 3~5 영업일 기다렸다(P16).
            *    서버에는 공개 접수 EP 가 이미 있었다(`POST /api/v1/partner/apply`).
            */}
          <form onSubmit={submitApplication}>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">기관 유형 *</label>
                <select name="orgType" className="w-full px-3 py-2 border rounded-lg text-sm" required>
                  <option value="">선택</option>
                  <option value="HOSPITAL">병원 (Hospital)</option>
                  <option value="CLINIC">의원 (Clinic)</option>
                  <option value="INSURANCE">보험사 (Insurance)</option>
                  <option value="APP_VENDOR">앱 개발사 (App Vendor)</option>
                  <option value="RESEARCH">연구기관 (Research)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">국가 *</label>
                <select name="country" className="w-full px-3 py-2 border rounded-lg text-sm" required>
                  <option value="KOR">🇰🇷 대한민국</option>
                  <option value="USA">🇺🇸 United States</option>
                  <option value="JPN">🇯🇵 日本</option>
                  <option value="CHN">🇨🇳 中国</option>
                  <option value="OTHER">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">기관명 *</label>
                <input type="text" name="orgName" placeholder="Hospital / Company Name" className="w-full px-3 py-2 border rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">기관코드</label>
                <input type="text" name="orgCode" placeholder="HIRA 코드 또는 해외 기관코드" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">FHIR Base URL</label>
                <input type="url" name="fhirBaseUrl" placeholder="https://fhir.your-hospital.com/R4" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">담당자 이메일 *</label>
                <input type="email" name="contactEmail" placeholder="contact@hospital.example" className="w-full px-3 py-2 border rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">담당자 이름 *</label>
                <input type="text" name="contactName" placeholder="Name" className="w-full px-3 py-2 border rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">전화번호</label>
                <input type="tel" name="contactPhone" placeholder="+82-10-0000-0000" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-gray-600 mb-2">연동 목적 (복수 선택)</label>
              <div className="flex flex-wrap gap-2">
                {['환자 전원 (Transfer)', '진료정보 교류 (HIE)', '보험 청구 (Claim)', '앱 연동 (App)', '연구 (Research)'].map(p => (
                  <label key={p} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-sm cursor-pointer hover:bg-blue-50">
                    <input type="checkbox" name="purpose" value={p} className="rounded" />
                    <span>{p}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs font-semibold text-gray-600 mb-2">요청 데이터 범위</label>
              <div className="grid grid-cols-3 gap-2">
                {['Patient (환자)', 'Encounter (진료)', 'Observation (검사)', 'MedicationRequest (처방)', 'Condition (진단)', 'AllergyIntolerance (알레르기)', 'Immunization (접종)', 'DiagnosticReport (보고서)', 'Procedure (수술)'].map(s => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" name="requestedScopes" value={s} className="rounded" />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition">
              연동 신청 제출
            </button>
            <p className="text-xs text-gray-400 mt-2 text-center">심사에 3~5 영업일이 소요됩니다. 승인 후 SMART Client 인증 정보가 발급됩니다.</p>
          </form>
        </div>
      </section>

      {/* Contact */}
      <div className="bg-blue-50 rounded-2xl p-8 text-center">
        <h3 className="text-lg font-bold text-gray-900 mb-2">연동 파트너십 문의</h3>
        <p className="text-sm text-gray-500 mb-4">FHIR API 접근 권한, SMART 클라이언트 등록, 기술 지원에 대해 문의하세요.</p>
        <div className="text-sm"><strong>Email:</strong> fhir@hospital.example.org | <strong>Tel:</strong> +82-2-000-0000</div>
      </div>
    </div>
  );
}
