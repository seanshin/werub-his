// 화면번호 고정(freeze) — 2026-06-07 기준. 한번 부여한 코드는 변경 금지(매뉴얼·암기 안정성).
// 메뉴 순서가 바뀌어도 기존 화면 코드는 이 맵으로 보존된다. 신규 화면은 여기에 추가(레지스트리가 자동 도출 폴백).
// 참고: in-screen-action-hotkeys / screen-number-navigation 기획·설계
export const SCREEN_CODE_FROZEN: Record<string, string> = {
  '/dashboard': '1000', '/reception': '1001', '/clinic-queue': '1002', '/patients': '1003', '/patients/register/foreign': '1004', '/patients/register/emergency': '1005', '/schedule': '1006', '/orders': '1007',
  '/nurse-station': '1100',
  '/pharmacy': '1200', '/pharmacist-activity': '1201', '/lab': '1202', '/imaging': '1203', '/pathology': '1204', '/diagnostics': '1205', '/blood-bank': '1206', '/telehealth': '1207', '/remote-consult': '1208', '/compounding': '1209',
  // 1304 는 /emergency-board 가 이미 사용(아래 등재) — /code-blue 는 1305
  '/surgery': '1300', '/pacu': '1301', '/emergency': '1302', '/icu': '1303', '/code-blue': '1305',
  '/internal-medicine': '1400', '/orthopedics': '1401', '/neurosurgery': '1402', '/obgyn': '1403', '/pediatrics': '1404', '/psychiatry': '1405', '/ophthalmology': '1406', '/ent': '1407', '/dermatology': '1408', '/dental': '1409', '/plastic': '1410', '/urology': '1411',
  '/rehab': '1500', '/radiation': '1501', '/dialysis': '1502',
  '/clinical-pathway': '1600', '/mdt': '1601', '/cancer-registry': '1602', '/research': '1603', '/omop-cdm': '1604', '/duty-schedule': '1605',
  '/workstation/front-desk': '1700', '/workstation': '1701', '/workstation/lab': '1702', '/workstation/imaging': '1703', '/workstation/diagnostic': '1704', '/workstation/reading': '1705', '/workstation/therapy': '1706', '/workstation/templates': '1707', '/workstation/pharmacy': '1708', '/workstation/nursing': '1709', '/workstation/outpatient-nursing': '1710', '/workstation/reception': '1711', '/workstation/consent': '1712', '/workstation/discharge': '1713', '/workstation/admission': '1714', '/workstation/surgery-prep': '1715', '/workstation/post-op': '1716', '/workstation/icu': '1717', '/workstation/attending': '1718', '/workstation/emergency': '1719', '/workstation/triage': '1720', '/workstation/blood-bank': '1721', '/workstation/nutrition': '1722', '/workstation/equipment': '1723', '/workstation/cssd': '1724', '/workstation/infection-control': '1725', '/workstation/rehab-station': '1726',
  '/his-checkup': '1800', '/his-checkup/reception': '1801', '/his-checkup/waiting': '1802', '/his-checkup/ws': '1803', '/his-checkup/flow-board': '1804', '/display/checkup': '1805', '/his-checkup/questionnaires': '1806', '/his-checkup/programs': '1807', '/his-checkup/test-catalog': '1808', '/his-checkup/schedule': '1809', '/his-checkup/review': '1810', '/his-checkup/contracts': '1811', '/his-checkup/follow-ups': '1812', '/his-checkup/stats': '1813',
  '/inpatient': '1900', '/rounds': '1901', '/handoffs': '1902', '/beds': '1903', '/nutrition': '1904',
  '/consent': '2000', '/medical-records/search': '2001', '/medical-records/copy': '2002',
  '/consultations': '2100', '/consultations/letters': '2101', '/consult': '2102',
  '/crm': '2200', '/crm/checkup/targets': '2201', '/crm/checkup/analytics': '2202', '/crm/international/cases': '2203', '/crm/international/analytics': '2204', '/crm/campaigns': '2205', '/crm/templates': '2206', '/crm/segments': '2207', '/crm/consultation': '2208', '/crm/analytics': '2209', '/crm/automation': '2210',
  '/billing': '2300', '/claims': '2301', '/cost-analysis': '2302', '/satisfaction': '2303', '/inventory': '2304', '/cssd': '2305', '/equipment': '2306', '/hr': '2307', '/admin/staff-devices': '2308', '/admin/identity': '2309',
  '/safety': '2400', '/infection': '2401', '/quality': '2402', '/mapping-review': '2403', '/education': '2404', '/admin/sqe': '2405', '/admin/gld': '2406',
  '/departments': '2500', '/doctors': '2501', '/facility-info': '2502', '/his-news': '2503', '/his-health-info': '2504', '/recruit': '2505',
  // 🔴 `/health-info` 를 2504 별칭으로 두던 것 제거 — 화면 실사용 점검 W8(2026-08-14).
  //    주석은 "레거시 별칭"이라 적혀 있었지만 실측하면 `/health-info` 는 **살아 있는 공개 홈페이지 경로**다
  //    (GNB 메뉴·sitemap·revalidate·상세페이지 링크 전부 현역). `/his-health-info`(HIS 내부 화면)와
  //    **다른 화면**인데 같은 번호를 공유해 `npm run check:screen-codes` 가 exit 1 이었고,
  //    그 사실을 `/admin/screen-codes` 화면은 "중복 0"이라 말했다.
  //    화면번호는 **직원이 번호를 입력해 이동하는 HIS 내부 화면**의 체계다 — 공개 홈페이지 경로는 대상이 아니다.
  '/concierge': '2600', '/ai-booking': '2601', '/simulator': '2602', '/metaverse': '2603', '/journey': '2604', '/interoperability': '2605',
  '/transfer': '2700', '/transfer/request': '2701', '/transfer/incoming': '2702', '/transfer/history': '2703',
  '/staff-meal': '2800',
  '/settings/my-certificate': '2900', '/settings/my-signature': '2901', '/settings/my-codes': '2902', '/settings/shortcuts': '2903',
  '/executive': '3000', '/executive/clinical': '3001', '/executive/finance-benchmark': '3002',
  '/admin/staff-management': '3100', '/admin/care-teams': '3101', '/admin/order-sets': '3102', '/admin/clinic-schedule': '3103', '/admin/duty-schedule': '3104', '/admin/cdss-rules': '3105', '/admin/analytics': '3106', '/admin/facility': '3107', '/admin/codes': '3108', '/admin/non-covered': '3109', '/admin/status': '3110', '/admin/audit': '3111', '/admin/patient-flags': '3112', '/admin/ai-settings': '3113', '/admin/categories': '3114', '/admin/menus': '3115', '/admin/billing-calc': '3116', '/admin/medical-law': '3117', '/admin/ai-vision': '3118', '/admin/ai-meeting': '3119', '/admin/ai-counseling': '3120', '/admin/ai-translate': '3121', '/admin/emr-cert': '3122', '/admin/blockchain-cert': '3123', '/admin/hira-edi': '3124', '/admin/controlled-substance': '3125', '/admin/risk-reassessment': '3126', '/admin/access-control': '3127', '/admin/dashboard-templates': '3128', '/admin/chart-editor': '3129', '/admin/triage': '3130', '/admin/qi': '3131', '/admin/screen-codes': '3132', '/admin/erp': '3133', '/admin/reference-ranges': '3134',
  '/admin/partner-requests': '3200', '/admin/partner-monitoring': '3201', '/admin/organizations': '3202', '/admin/smart-clients': '3203', '/admin/transfer-stats': '3204', '/admin/hie-dashboard': '3205',
  '/admin/homepage': '3300', '/admin/hospital-info': '3301', '/admin/homepage/popups': '3302', '/admin/homepage/banners': '3303', '/admin/homepage/media': '3304', '/admin/homepage/seo': '3305', '/admin/homepage/deploy': '3306',

  // ── 2026-08 W7 고정 확장 ──
  // 🔴 미고정 화면 62개가 `deriveCode((10+섹션)*100+항목)` 폴백으로 굴러가며 **기존 고정번호와 38건 충돌**했다
  //    (1000=대시보드인데 통합상황판, 2900=내 전자인증서인데 ESS, 검진권 5건이 외부연동 3200~3204 를 덮음).
  //    화면번호는 사람이 외워 치는 값이라 충돌=**다른 화면으로 보내는 것**. 기존 번호는 하나도 바꾸지 않고
  //    각 섹션의 빈 뒤 번호로만 신규 부여한다(암기 안정성 유지). 검진권은 3300 대가 홈페이지라 3400 대 신설.
  '/command-center': '1008',
  '/nursing-station': '1101', '/nurse-station/imaging': '1102', '/nurse-station/delivery-board': '1103', '/nurse-station/seclusion': '1104',
  '/pharmacy-board': '1210', '/chronic': '1211', '/clinical-tools': '1212', '/diagnostics-board': '1213', '/pacs-portal': '1214',
  '/emergency-board': '1304',
  '/chemo': '1503', '/transplant': '1504',
  '/workstation/documents': '1727', '/workstation/certificates': '1728',
  '/patient-flow': '1814', '/his-checkup/station': '1815', '/his-checkup/protocols': '1816',
  '/bed-board': '1905',
  '/bed-transfers': '1906', // 2026-09-30 병동 간 전동 요청·수락
  '/admin/voc': '2103', '/patient-messages': '2106',
  '/reception-billing-board': '2310', '/admin/stepup-approvals': '2311', '/admin/location-stations': '2312',
  '/safety-quality-board': '2407', '/admin/safety-gates': '2408', '/admin/audit-dashboard': '2409', '/admin/order-sign-logs': '2410', '/admin/terminal-security': '2411', '/admin/outbound-channels': '2413', '/admin/agency-integrations': '2414', '/admin/decisions': '2415', '/admin/decisions/console': '2416', '/admin/decisions/register': '2417', '/admin/decisions/checks': '2418', '/admin/human-actions': '2419',
  '/infection/staff-exposure': '2412',
  '/interoperability/test': '2606',
  '/ess': '2904', '/settings/voice': '2905', '/settings/password': '2907',
  '/admin/onboarding': '3135', '/admin/er-beds': '3136', '/admin/displays': '3137', '/admin/numeric-policy': '3138', '/admin/treatment-templates': '3139', '/admin/go-live': '3140', '/admin/integration-gates': '3141', '/admin/him': '3142', '/admin/formulary': '3143', '/admin/forms': '3144', '/admin/dept-catalog': '3145', '/admin/drug-explain': '3146', '/admin/approvals-dashboard': '3147', '/admin/questionnaire-dashboard': '3148', '/admin/bots': '3149', '/admin/extensions': '3150', '/journey-console': '3151', '/flow-analytics': '3152', '/admin/drug-mapping': '3153', '/admin/data-quality': '3154', '/admin/phase0-cutover': '3155', '/admin/menu-config': '3156', '/admin/prescriber-rules': '3157', '/admin/protocols': '3158', '/admin/rbac': '3159', '/admin/workstations': '3160', '/admin/clinical-chart-verification': '3161', '/admin/checkup-explainer': '3162',
  '/admin/voucher/issue': '3400', '/admin/voucher/list': '3401', '/admin/voucher/dashboard': '3402', '/admin/voucher/distributors': '3403', '/admin/voucher/settings': '3404',

  // ── 2026-08-21 진입점 실측 확장 ──
  // 🔴 화면번호가 없던 (main) 정적 화면 41개를 실측해 **진입점(다른 화면의 링크·버튼·탭)이 있는 27개만** 부여한다.
  //    나머지 14개는 부여하지 않는다 — 번호를 주면 "이 화면은 정상 경로로 도달한다"는 거짓 신호가 된다.
  //    동적 조합 화면(`[id]`·쿼리 파라미터로 조합되는 상세)은 대상이 아니다 — 지금 형태 그대로 동작한다.
  //    부여 기준·미부여 목록: docs/05-reference/screen-code-assignment.md
  '/patients/new': '1009', '/schedule/new': '1010',
  // 검사결과 확인함 — 미확인 결과 워크리스트(2026-09-30 · 사이드바 '외래')
  '/results-inbox': '1011',
  '/verbal-orders': '1012',
  '/renewals': '1013',
  // 의사 할 일함 — 위 넷(1011·1012·1013·1217)을 한 화면에서 센다(2026-10-07)
  '/doctor-inbox': '1014',
  '/pharmacy/admin': '1215', '/telehealth/recordings': '1216', '/pharmacist-replies': '1217',
  '/hospice': '1505',
  '/his-checkup/ws/hub': '1817', '/his-checkup/ws/blood': '1818', '/his-checkup/ws/urine': '1819', '/his-checkup/ws/physical': '1820', '/his-checkup/ws/eye': '1821', '/his-checkup/ws/ecg': '1822', '/his-checkup/ws/pft': '1823', '/his-checkup/ws/xray': '1824', '/his-checkup/ws/ultrasound': '1825', '/his-checkup/ws/endoscopy': '1826', '/his-checkup/ws/consult': '1827',
  '/consent/templates': '2003',
  '/consult/admin': '2104', '/consult/lead': '2105',
  '/crm/checkup/follow-ups': '2211', '/crm/communications': '2212', '/crm/international/agencies': '2213',
  '/claims/stats': '2313',
  '/notifications': '2906',
  '/admin/config': '3163', '/admin/governance': '3164', '/admin/vip-patients': '3165',
  // 🔴 표준(CP·프로토콜)이 무엇이 있어야 발효되는가 — 위원회 대장(3164)에서 링크로 들어간다(2026-08-27)
  '/admin/governance/standards': '3166', '/admin/opening': '3167',

  // ── 2026-08-21 CMS 전용 편집 화면 부여 ──
  // 🔴 종전 미부여 사유는 "CMS 정본이 둘이라 사람 결정 전"이었다. 이번에 정본을 정했다 —
  //    **전용 화면 = 편집 정본**(카테고리별 구조화 폼·미충족 표시), `/admin/hospital-info` = 전체 교차 조회.
  //    허브(3300)가 전용 화면으로 링크하므로 진입점이 생겼다 → 번호를 부여한다.
  '/admin/homepage/departments': '3307', '/admin/homepage/centers': '3308', '/admin/homepage/news': '3309',
  '/admin/homepage/health-info': '3310', '/admin/homepage/health-tv': '3311', '/admin/homepage/gallery': '3312',
  '/admin/homepage/csr': '3313', '/admin/homepage/recruit': '3314', '/admin/homepage/doctors': '3315',
  // 상시 감시 관제 — 기획 his-sentinel-monitoring.plan.md P0
  '/admin/sentinel': '3405',
  // 응급 접근(Break-glass) 사후 검토 — gap-remediation R2
  '/admin/break-glass': '3406',
  // UDI 리콜 역추적 · 보유·파기 관제 — gap-remediation R5·R6
  '/admin/device-recall': '3407', '/admin/retention': '3408',
  // UI 다국어 검수 관제 — ui-locale-i18n P1
  '/admin/ui-locale': '3409',
  // AI 감독 관제 — ai-judgment-governance.plan.md §2.3 P2(수용·수정·거부·만료 지표 · 검토 소요 · 호출 분포)
  '/admin/ai-oversight': '3410',
  // 언어팩 사람 검수 워크리스트 — i18n-human-review.plan.md §2.3 P1(진입점 = /admin/ui-locale 3409 의 링크)
  '/admin/ui-locale/review': '3411',
  // 법적 보존명령(legal hold) 관제 — 상용 릴리즈 T10-7(파기·익명화·아카이브 이동 차단 표시 · 해제 4-eyes)
  '/admin/legal-hold': '3412',
  // 공간 자산 배치(워크스테이션·PC·의료기기·장비 위치 원장) — spatial-flow-vision-3d §5-A
  '/admin/space-assets': '3413',
  // 공간 도면 가져오기(space-import.v1 · 확정 도면만 뷰어·길안내에 쓰인다) — spatial-flow-vision-3d P1
  '/admin/space-model': '3414',
  // 활력 표시 표준(순서·LOINC·UCUM·단위·자릿수) + 원장 기록 적합성 — vital-signs 정본 2026-10-07
  '/admin/vitals-standard': '3415',
  // 무선 위치(AP 등록부·수집기·단말 연결 · wifi-location.v1) — wifi-ap-location.plan.md 2026-10-09
  '/admin/wifi-location': '3416',
  // 임상 규칙 대장(10개 카탈로그 한 장 · 읽기 전용) — clinical-rules-templates-review P4 2026-10-21
  '/admin/clinical-rules': '3417',
  // 간호 원내 규정(통증 재평가·인계 인수 방식·보호대 점검 간격) — 2026-10-26
  '/admin/nursing-rules': '3418',
};
