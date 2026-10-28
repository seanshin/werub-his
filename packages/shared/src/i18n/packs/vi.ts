/**
 * 베트남어 언어 팩 — **743 / 11,806 키(6.3% · 2026-09-09 실측)** 전량 AI 초안(사람 검수 0).
 *
 * 🔴 **분모를 병기한다.** 종전 헤더는 "핵심 591키 중 586키"라고 적어 커버리지가 99% 처럼
 *    읽혔다 — 그 591 은 이 팩이 스스로 손댄 범위였지 화면이 필요로 하는 키의 총수가 아니다.
 *    실제 분모는 코어(en) 팩 키 전집이다(`node scripts/i18n-pack-coverage.mjs` 로 재현).
 *    🔴 영역별로 보면 **한 숫자가 가리는 것**이 드러난다: common 65/65 · nav 264/265 ·
 *    status 258/262 는 사실상 완주인데, 나머지 18개 도메인 영역(외래·차트·간호·약제·
 *    수술/응급·청구·검진·관리…)은 합쳐 **142 / 5,583(2.5%)** 이다. 이번에 넣은 것도
 *    그 영역들의 **공통 부품 어휘**(목록·필터·빈 상태·편집기)일 뿐 임상 본문이 아니다.
 *
 * 🔴 **부분 번역이 정상이다.** 여기 없는 키는 한국어 원문 + 미번역 티로 나온다(§2.2 3상태).
 *    확신 없는 임상 전문어를 지어내 넣는 것보다 원문+티가 정직하다.
 *
 * 의도적으로 뺀 키(6) — 베트남어 표준어를 확인하지 못했다:
 *   · 저잔사식 / 갈은식 / 다진식 / 점도증진 — 연하곤란 식이 질감(IDDSI) 어휘.
 *     잘못 붙이면 흡인(aspiration) 사고로 이어진다.
 *   · 기초검사 — 이 시스템에서 포괄하는 범위(활력·심전도·시력…)에 대응하는 베트남어
 *     상위어를 확정하지 못했다.
 *   · 일반@마약류(en 'Non-controlled') — 베트남 약사법의 특별관리 대상 규정 용어를
 *     확인하지 못했다. 통제 약품을 일반약으로 읽히게 만들 위험이 있다.
 *
 * ── 2026-09-09 문맥 키 결손 회수(12) ─────────────────────────────────────────
 * 🔴 이번 라운드에 코어가 동음이의를 새로 갈랐고, 이 팩은 **무문맥 원문만 가진 채** 9자리가
 *    "뜻이 틀린 번역이 나가는 자리"가 돼 있었다(`packContextGaps('vi')` 실측). 무문맥 값을
 *    복사하지 않고 en/ja 정본 + 그 키를 쓰는 화면을 보고 문맥마다 새로 옮겼다:
 *    만료@일시=Hết hạn(≠Đã hết hạn 만료됨) · 전체@합계=Tổng cộng(≠Tất cả 전부) ·
 *    확정@정산버튼=Xác nhận(버튼 — 무문맥 `확정`은 Đã xác nhận 상태형이다).
 * 🔴 **한 벌은 한 벌로 채운다**: 위원회 안건 상태 7종(접수/상정/의결/부결/보류/철회/접수 중…)은
 *    결손 목록 밖의 4종까지 함께 넣었다 — 일부만 채우면 상태 열이 두 언어로 섞인다.
 * 🔴 **채우지 않은 1키**: `일반@마약류`(en Non-controlled) — 위 제외 사유 그대로다.
 *    베트남 약사법의 특별관리 대상 규정 용어를 확인하지 못했고, 틀리면 통제 약품이
 *    일반약으로 읽힌다. 원문+미번역 티가 정직하다.
 *
 * `verified` 는 빈 Set 이다 — 사람 검수를 거친 키가 아직 없다.
 */
import type { LocalePack } from '../pack';

export const VI_PACK: LocalePack = {
  code: 'vi',
  label: 'Tiếng Việt',
  dir: 'ltr',
  tag: 'vi-VN',
  status: 'ACTIVE',
  messages: {
    // 동작형(2026-09-10) — 무문맥 '선택'은 명사(Selection)라 버튼 자리에서 뜻이 어긋난다
    '선택@행위': 'chọn',
    // 동작형(2026-09-10) — 무문맥 '서명'은 결과(Signed)라 동사 자리에 쓰면 문장이 깨진다
    '서명@동작': 'ký',
    // ── 공통 UI ──────────────────────────────────────────────
    '화면 언어': 'Ngôn ngữ hiển thị',
    '저장': 'Lưu',
    '취소': 'Hủy',
    '닫기': 'Đóng',
    '불러오는 중…': 'Đang tải…',
    '다시 로그인': 'Đăng nhập lại',
    '권한 필요': 'Cần quyền truy cập',
    '재시도': 'Thử lại',
    '다시 시도': 'Thử lại',
    '로그인 화면으로 이동합니다.': 'Bạn sẽ được chuyển đến màn hình đăng nhập.',
    '이 화면의 자료를 볼 권한이 없습니다. 필요하면 관리자에게 권한을 요청하세요.':
      'Bạn không có quyền xem dữ liệu của màn hình này. Nếu cần, hãy đề nghị quản trị viên cấp quyền.',
    '잠시 후 다시 시도해주세요': 'Vui lòng thử lại sau giây lát',
    '불러오는 중...': 'Đang tải...',
    '확인': 'Xác nhận',
    '데이터가 없습니다.': 'Không có dữ liệu.',
    '네트워크 연결이 끊어졌습니다. 일부 기능이 제한될 수 있습니다.':
      'Mất kết nối mạng. Một số chức năng có thể bị hạn chế.',
    '네트워크가 다시 연결되었습니다.': 'Đã kết nối lại mạng.',

    // ── 알림 ────────────────────────────────────────────────
    '알림': 'Thông báo',
    '모두 읽음': 'Đánh dấu đã đọc tất cả',
    '새 알림이 없습니다': 'Không có thông báo mới',
    '알림을 불러오지 못했습니다 — "없음"이 아닙니다':
      'Không tải được thông báo — điều này không có nghĩa là không có thông báo nào',
    '전체 알림 보기': 'Xem tất cả thông báo',
    '오더': 'Y lệnh',
    '수납': 'Thu ngân',
    '검사': 'Xét nghiệm',
    '약국': 'Nhà thuốc',
    '예약': 'Lịch hẹn',
    '임상 위급': 'Nguy kịch lâm sàng',
    '결재/승인': 'Trình ký / Phê duyệt',
    '상담/VoC': 'Tư vấn / VoC',
    '시스템': 'Hệ thống',
    '정보': 'Thông tin',
    '낮음': 'Thấp',
    '주의': 'Chú ý',
    '보통': 'Trung bình',
    '높음': 'Cao',
    '위급': 'Nguy kịch',
    '중요도 미기재': 'Chưa ghi mức độ quan trọng',
    'QR 생성 실패': 'Tạo mã QR thất bại',
    '사유를 입력해 주세요(공백만으로는 남길 수 없습니다).':
      'Vui lòng nhập lý do (không thể lưu nếu chỉ có khoảng trắng).',

    // ── 에디터 ──────────────────────────────────────────────
    '굵게': 'Đậm',
    '기울임': 'Nghiêng',
    '밑줄': 'Gạch chân',
    '취소선': 'Gạch ngang',
    '제목2': 'Tiêu đề 2',
    '제목3': 'Tiêu đề 3',
    '글머리 기호': 'Danh sách dấu đầu dòng',
    '번호 목록': 'Danh sách đánh số',
    '인용': 'Trích dẫn',
    '구분선': 'Đường phân cách',
    '링크': 'Liên kết',
    '이미지 업로드': 'Tải ảnh lên',
    '되돌리기': 'Hoàn tác',
    '다시 실행': 'Làm lại',
    '또는': 'hoặc',

    // ── 입력 폼 ─────────────────────────────────────────────
    '출생 연도': 'Năm sinh',
    '출생 월': 'Tháng sinh',
    '출생 일': 'Ngày sinh',
    '년@생년월일': 'Năm',
    '월@생년월일': 'Tháng',
    '일@생년월일': 'Ngày',
    '주소 검색': 'Tìm địa chỉ',
    '우편번호': 'Mã bưu chính',
    '동 이름으로 검색하거나 주소 직접 입력': 'Tìm theo tên phường/xã hoặc nhập trực tiếp địa chỉ',
    '상세주소 (동/호수 등)': 'Địa chỉ chi tiết (tòa nhà / số phòng, v.v.)',

    // ── 메뉴 대분류 ──────────────────────────────────────────
    '외래': 'Ngoại trú',
    '간호': 'Điều dưỡng',
    '진료 지원': 'Hỗ trợ lâm sàng',
    '수술/중환자': 'Phẫu thuật / Hồi sức tích cực',
    '전문 진료': 'Chuyên khoa',
    '특수 치료': 'Điều trị đặc biệt',
    '의료 질/연구': 'Chất lượng y tế / Nghiên cứu',
    '워크스테이션': 'Trạm làm việc',
    '클리닉 센터': 'Trung tâm phòng khám chuyên đề',
    '입원': 'Nội trú',
    '의무기록': 'Hồ sơ bệnh án',
    '협진/의뢰': 'Hội chẩn / Chuyển tuyến',
    'CRM': 'CRM',
    '원무/관리': 'Hành chính / Quản lý',
    '안전/질관리': 'An toàn / Quản lý chất lượng',
    '병원 안내': 'Hướng dẫn bệnh viện',
    '전원/연동': 'Chuyển viện / Liên kết',
    '생활/편의': 'Đời sống / Tiện ích',
    '내 설정': 'Cài đặt của tôi',
    '경영진': 'Ban lãnh đạo',
    '개원 전 시스템 관리': 'Quản lý hệ thống trước khai trương',
    '운영 시스템 관리': 'Quản lý hệ thống vận hành',
    '검진권': 'Phiếu khám sức khỏe',
    '외부 연동': 'Kết nối bên ngoài',
    '홈페이지 관리': 'Quản lý website',

    // ── 외래·접수 ───────────────────────────────────────────
    '통합 상황판': 'Trung tâm điều hành',
    '대시보드': 'Bảng điều khiển',
    '접수': 'Tiếp nhận',
    '진료실 대기': 'Chờ tại phòng khám',
    '환자 관리': 'Quản lý bệnh nhân',
    '외국인 환자 등록': 'Đăng ký bệnh nhân nước ngoài',
    '응급 미확인 등록': 'Đăng ký cấp cứu chưa rõ danh tính',
    '처방(CPOE)': 'Kê y lệnh (CPOE)',
    '간호 워크스테이션': 'Trạm điều dưỡng',
    '간호 스테이션 보드': 'Bảng trạm điều dưỡng',
    '환자 영상 조회': 'Xem hình ảnh của bệnh nhân',
    '약국 보드': 'Bảng nhà thuốc',
    '약사 임상활동': 'Hoạt động lâm sàng của dược sĩ',
    '검사실': 'Phòng xét nghiệm',
    '영상실': 'Phòng chẩn đoán hình ảnh',
    '병리과': 'Giải phẫu bệnh',
    '혈액은행': 'Ngân hàng máu',
    '화상진료': 'Khám bệnh qua video',
    '비대면진료': 'Khám bệnh từ xa',
    '만성질환 관리': 'Quản lý bệnh mạn tính',
    '임상 도구(점수·계산)': 'Công cụ lâm sàng (thang điểm · tính toán)',
    '검사·영상 보드': 'Bảng xét nghiệm · chẩn đoán hình ảnh',
    'PACS 주치의 포털': 'Cổng PACS cho bác sĩ điều trị',

    // ── 수술·중환자·응급 ────────────────────────────────────
    '수술': 'Phẫu thuật',
    '회복실(PACU)': 'Phòng hồi tỉnh (PACU)',
    '응급실': 'Khoa cấp cứu',
    '응급실 보드': 'Bảng khoa cấp cứu',
    '중환자실': 'Hồi sức tích cực (ICU)',
    'Code Blue / RRT': 'Code Blue / RRT',

    // ── 진료과 ──────────────────────────────────────────────
    '내과': 'Nội khoa',
    '정형외과': 'Chấn thương chỉnh hình',
    '신경외과': 'Ngoại thần kinh',
    '산부인과': 'Sản phụ khoa',
    '소아청소년과': 'Nhi khoa',
    '정신과': 'Tâm thần',
    '안과': 'Nhãn khoa',
    '이비인후과': 'Tai mũi họng',
    '피부과': 'Da liễu',
    '치과': 'Răng hàm mặt',
    '성형외과': 'Phẫu thuật tạo hình',
    '비뇨의학과': 'Tiết niệu',
    '재활의학': 'Phục hồi chức năng',
    '방사선종양': 'Xạ trị ung bướu',
    '항암 치료(사이클)': 'Hóa trị (theo chu kỳ)',
    '투석실': 'Phòng lọc máu',
    '장기이식': 'Ghép tạng',
    '임상경로': 'Lộ trình lâm sàng',
    '다학제진료(MDT)': 'Khám đa chuyên khoa (MDT)',
    '암 등록': 'Đăng ký ung thư',
    '임상 연구(IRB)': 'Nghiên cứu lâm sàng (IRB)',
    'OMOP CDM': 'OMOP CDM',

    // ── 워크스테이션 ────────────────────────────────────────
    '당직/근무': 'Trực / Ca làm việc',
    '접수 워크스테이션': 'Trạm tiếp nhận',
    '판독 대기': 'Chờ đọc kết quả',
    '치료실': 'Phòng điều trị',
    '검사항목 관리': 'Quản lý danh mục xét nghiệm',
    '간호(입원)': 'Điều dưỡng (nội trú)',
    '간호(외래)': 'Điều dưỡng (ngoại trú)',
    '동의서': 'Phiếu đồng ý',
    '서류 발급': 'Cấp giấy tờ',
    '진단서 발급': 'Cấp giấy chứng nhận y tế',
    '퇴원': 'Xuất viện',
    '수술 준비': 'Chuẩn bị phẫu thuật',
    '수술 후 회복': 'Hồi phục sau phẫu thuật',
    '주치의': 'Bác sĩ điều trị',
    '영양': 'Dinh dưỡng',
    '장비': 'Thiết bị',
    '중앙공급': 'Tiệt khuẩn trung tâm (CSSD)',
    '감염관리': 'Kiểm soát nhiễm khuẩn',
    '재활': 'Phục hồi chức năng',

    // ── 건강검진 ────────────────────────────────────────────
    '건강검진센터': 'Trung tâm khám sức khỏe tổng quát',
    '검진 접수': 'Tiếp nhận khám sức khỏe',
    '검진 대기': 'Chờ khám sức khỏe',
    '검사실 허브': 'Điều phối các phòng khám',
    '동선 현황판': 'Bảng theo dõi luồng di chuyển',
    '동선 모니터(QR)': 'Màn hình theo dõi luồng (QR)',
    '대기 디스플레이': 'Màn hình chờ',
    '검진 스테이션': 'Trạm khám sức khỏe',
    '문진표 관리': 'Quản lý phiếu hỏi bệnh',
    '검진 프로그램': 'Chương trình khám sức khỏe',
    '검진 프로토콜': 'Quy trình khám sức khỏe',
    '검진 예약': 'Đặt hẹn khám sức khỏe',
    '소견 대기': 'Chờ kết luận chuyên môn',
    '단체 검진': 'Khám sức khỏe tập thể',
    '추적 관리': 'Quản lý theo dõi',
    '검진 통계': 'Thống kê khám sức khỏe',

    // ── 입원 ────────────────────────────────────────────────
    '입원 환자': 'Bệnh nhân nội trú',
    '회진': 'Đi buồng',
    '인수인계': 'Bàn giao ca',
    '병상 현황': 'Tình trạng giường bệnh',
    '병상·입원 보드': 'Bảng giường bệnh · nhập viện',
    '급식': 'Suất ăn bệnh viện',

    // ── 의무기록·협진 ───────────────────────────────────────
    '기록 검색': 'Tìm kiếm hồ sơ',
    '사본 발급': 'Cấp bản sao',
    '협진 의뢰': 'Yêu cầu hội chẩn',
    '의뢰서 문서': 'Giấy chuyển tuyến',
    '상담 데스크': 'Quầy tư vấn',
    '고객의 소리(VoC)': 'Ý kiến khách hàng (VoC)',

    // ── CRM ─────────────────────────────────────────────────
    'CRM 대시보드': 'Bảng điều khiển CRM',
    '검진 대상자': 'Đối tượng khám sức khỏe',
    '검진 실적': 'Kết quả thực hiện khám sức khỏe',
    '해외환자 케이스': 'Hồ sơ bệnh nhân quốc tế',
    '해외환자 실적': 'Kết quả bệnh nhân quốc tế',
    '캠페인': 'Chiến dịch',
    '템플릿': 'Mẫu',
    '세그먼트': 'Phân khúc',
    'CRM 상담': 'Tư vấn CRM',
    'CRM 분석': 'Phân tích CRM',
    '자동화': 'Tự động hóa',

    // ── 원무·관리 ───────────────────────────────────────────
    '원무·수납 보드': 'Bảng hành chính · thu ngân',
    '보험 청구': 'Yêu cầu thanh toán bảo hiểm',
    '원가 분석': 'Phân tích giá thành',
    '환자 만족도': 'Mức độ hài lòng của bệnh nhân',
    '자재/재고': 'Vật tư / Tồn kho',
    '인사': 'Nhân sự',
    '생체등록·기기관리': 'Đăng ký sinh trắc học · Quản lý thiết bị',
    '인증 관리 콘솔': 'Bảng quản lý xác thực',
    '승인 감사(서명·처방)': 'Kiểm toán phê duyệt (chữ ký · y lệnh)',
    '동선 스테이션': 'Trạm theo dõi luồng di chuyển',

    // ── 안전·질관리 ─────────────────────────────────────────
    '환자안전(사고 보고)': 'An toàn người bệnh (báo cáo sự cố)',
    '감염·질·안전 보드': 'Bảng nhiễm khuẩn · chất lượng · an toàn',
    '직원 노출 사고': 'Sự cố phơi nhiễm của nhân viên',
    'QI': 'QI',
    '매핑 임상검토': 'Rà soát lâm sàng việc ánh xạ mã',
    '직원교육': 'Đào tạo nhân viên',
    '자격·교육(SQE)': 'Chứng chỉ · Đào tạo (SQE)',
    '위원회·정책(GLD)': 'Hội đồng · Chính sách (GLD)',
    '안전 게이트 관제': 'Bảng kiểm soát cổng an toàn',
    '대외 발신 관제': 'Bảng kiểm soát gửi ra bên ngoài',
    '기관 연동': 'Kết nối cơ quan',
    '중요 결정': 'Quyết định quan trọng',
    '감사 대시보드': 'Bảng điều khiển kiểm toán',
    '오더 서명 로그': 'Nhật ký ký y lệnh',
    '단말 보안': 'Bảo mật thiết bị đầu cuối',

    // ── 병원 안내·공개 ──────────────────────────────────────
    '진료과 안내': 'Giới thiệu các khoa',
    '의료진 소개': 'Giới thiệu đội ngũ y tế',
    '시설 안내': 'Giới thiệu cơ sở vật chất',
    '병원 소식': 'Tin tức bệnh viện',
    '건강정보': 'Thông tin sức khỏe',
    '채용 안내': 'Tuyển dụng',
    '시뮬레이터/플로어맵': 'Mô phỏng / Sơ đồ mặt bằng',
    '메타버스 뷰어': 'Trình xem Metaverse',
    '환자 여정': 'Hành trình bệnh nhân',

    // ── 전원·연동 ───────────────────────────────────────────
    '상호운용성': 'Khả năng liên thông',
    '연동 테스트 콘솔': 'Bảng kiểm thử kết nối',
    '전원 관리': 'Quản lý chuyển viện',
    '전원 의뢰': 'Yêu cầu chuyển viện',
    '수신 전원': 'Chuyển viện đến',
    '전원 이력': 'Lịch sử chuyển viện',

    // ── 생활·내 설정 ────────────────────────────────────────
    '직원 식단표': 'Thực đơn nhân viên',
    '내 행정(ESS)': 'Hành chính của tôi (ESS)',
    '내 전자인증서': 'Chứng thư số của tôi',
    '내 서명 등록': 'Đăng ký chữ ký của tôi',
    '나의 약속처방': 'Bộ y lệnh mẫu của tôi',
    '단축키·화면번호': 'Phím tắt · Mã màn hình',
    '음성 설정 (VoiceEMR)': 'Cài đặt giọng nói (VoiceEMR)',

    // ── 경영·개원 ───────────────────────────────────────────
    '경영 대시보드': 'Bảng điều khiển quản trị',
    '의료 품질': 'Chất lượng y tế',
    '개원·운영 단계': 'Giai đoạn khai trương · vận hành',
    '운영 전환(Go-Live) 관제': 'Bảng kiểm soát chuyển vận hành (Go-Live)',
    '연동 개통 게이트': 'Cổng mở kết nối',
    'Phase0 컷오버 승인': 'Phê duyệt chuyển đổi Phase0',
    'EMR 인증': 'Chứng nhận EMR',

    // ── 마스터·설정 ─────────────────────────────────────────
    '코드 마스터': 'Danh mục mã',
    '비급여 관리': 'Quản lý dịch vụ ngoài bảo hiểm',
    '약품 보험코드 매핑': 'Ánh xạ mã bảo hiểm của thuốc',
    '수가 계산기': 'Máy tính giá dịch vụ',
    '진료과 카탈로그': 'Danh mục khoa',
    '카테고리 관리': 'Quản lý phân loại',
    '약속처방(CP)': 'Bộ y lệnh mẫu (CP)',
    '치료일정 템플릿': 'Mẫu lịch điều trị',
    '원내 처방집(위원회)': 'Danh mục thuốc bệnh viện (Hội đồng)',
    'CDSS 규칙': 'Quy tắc CDSS',
    '여정 프로토콜': 'Quy trình hành trình bệnh nhân',
    '처방의 지정 규칙': 'Quy tắc chỉ định người kê đơn',
    '차트 에디터': 'Trình soạn bệnh án',
    '폼 빌더': 'Trình tạo biểu mẫu',
    '임상도구 검수': 'Thẩm định công cụ lâm sàng',
    '트리아지 관리': 'Quản lý phân loại cấp cứu',
    '시설 관리': 'Quản lý cơ sở vật chất',
    '응급실 베드 관리': 'Quản lý giường cấp cứu',
    'TV 디스플레이 관리': 'Quản lý màn hình TV',
    '워크스테이션·디바이스': 'Trạm làm việc · Thiết bị',
    '접근 권한': 'Quyền truy cập',
    '역할 권한': 'Quyền theo vai trò',
    '전자인증서': 'Chứng thư số',
    'ERP 접근 설정': 'Cài đặt truy cập ERP',
    '메뉴 관리': 'Quản lý menu',
    '메뉴 구성·권한': 'Cấu trúc menu · Quyền',
    '화면번호 레지스트리': 'Danh mục mã màn hình',
    '대시보드 템플릿': 'Mẫu bảng điều khiển',
    '수치 표시·반올림 정책': 'Chính sách hiển thị · làm tròn số',
    '확장 슬롯': 'Khe mở rộng',
    '시스템 설정': 'Cài đặt hệ thống',
    '직원 관리': 'Quản lý nhân viên',
    '신규 입사자 관리': 'Quản lý nhân viên mới',
    '의료팀 편성': 'Phân công đội ngũ điều trị',
    '진료표': 'Lịch khám bệnh',
    '당직표': 'Lịch trực',
    '전자결재 대시보드': 'Bảng điều khiển phê duyệt điện tử',
    '문진 대시보드': 'Bảng điều khiển phiếu hỏi bệnh',
    'HIRA 청구': 'Yêu cầu thanh toán HIRA',
    '환자 마킹(루비)': 'Đánh dấu bệnh nhân (Ruby)',

    // ── 통계·감사 ───────────────────────────────────────────
    '통계/분석': 'Thống kê / Phân tích',
    '환자여정 관제': 'Bảng kiểm soát hành trình bệnh nhân',
    '이탈·지연 분석': 'Phân tích bỏ cuộc · chậm trễ',
    '병원 현황': 'Tình hình bệnh viện',
    '질관리 (QI)': 'Cải tiến chất lượng (QI)',
    '기기 리콜 역추적': 'Truy vết thu hồi thiết bị',
    '낙상/욕창 재평가': 'Đánh giá lại té ngã / loét tì đè',
    '데이터 품질': 'Chất lượng dữ liệu',
    '마약류 관리': 'Quản lý thuốc gây nghiện · hướng thần',
    '미비기록(HIM)': 'Hồ sơ chưa hoàn tất (HIM)',
    '감사 로그': 'Nhật ký kiểm toán',
    '응급 접근 검토': 'Rà soát truy cập khẩn cấp',
    '보유·파기(Retention)': 'Lưu trữ · Hủy dữ liệu (Retention)',
    '상시 감시': 'Giám sát liên tục',
    'AI 약물설명 승인': 'Phê duyệt nội dung AI giải thích về thuốc',
    '검진해석 콘텐츠(감수)': 'Nội dung diễn giải kết quả khám (thẩm định)',
    '봇 관리': 'Quản lý bot',
    '회의 분석': 'Phân tích cuộc họp',

    // ── 검진권 ──────────────────────────────────────────────
    '검진권 발행·조회': 'Phát hành · tra cứu phiếu khám',
    '검진권 목록': 'Danh sách phiếu khám',
    '검진권 대시보드': 'Bảng điều khiển phiếu khám',
    '검진권 딜러': 'Đại lý phiếu khám',
    '검진권 정책': 'Chính sách phiếu khám',

    // ── 외부 연동 ───────────────────────────────────────────
    '연동 신청 관리': 'Quản lý đăng ký kết nối',
    '연동 모니터링': 'Giám sát kết nối',
    '연동 기관': 'Tổ chức đối tác',
    'SMART 클라이언트': 'Ứng dụng SMART',
    '전원 통계': 'Thống kê chuyển viện',
    '진료정보교류(HIE)': 'Trao đổi thông tin y tế (HIE)',

    // ── 홈페이지 관리 ───────────────────────────────────────
    '홈페이지 대시보드': 'Bảng điều khiển website',
    '콘텐츠 관리(CMS)': 'Quản lý nội dung (CMS)',
    '공지/팝업': 'Thông báo / Cửa sổ bật lên',
    '배너 관리': 'Quản lý banner',
    '미디어 라이브러리': 'Thư viện đa phương tiện',
    'SEO/메타데이터': 'SEO / Siêu dữ liệu',
    '홈페이지 배포': 'Triển khai website',

    // ── 공통 상태 ───────────────────────────────────────────
    '취소@상태': 'Đã hủy',
    '예약@상태': 'Đã đặt hẹn',
    '납부완료': 'Đã thanh toán',
    '미납': 'Chưa thanh toán',
    '활성': 'Đang hoạt động',
    '비활성': 'Ngừng hoạt động',
    '오류': 'Lỗi',
    '경고': 'Cảnh báo',
    '확정': 'Đã xác nhận',
    '완료': 'Hoàn tất',

    // ── 성별·보험 ───────────────────────────────────────────
    '남': 'Nam',
    '여': 'Nữ',
    '기타': 'Khác',
    '미상': 'Không rõ',
    '건강보험': 'Bảo hiểm y tế',
    '의료급여': 'Trợ cấp y tế',
    '산재보험': 'Bảo hiểm tai nạn lao động',
    '자동차보험': 'Bảo hiểm xe cơ giới',
    '비급여(자비)': 'Tự chi trả',

    // ── 외래 흐름 상태 ──────────────────────────────────────
    '진료중': 'Đang khám',
    '미내원': 'Không đến khám',
    '미방문': 'Không đến',
    '대기': 'Đang chờ',
    '호출': 'Đã gọi',
    '수납대기': 'Chờ thanh toán',
    '약국대기': 'Chờ nhận thuốc',

    // ── 역할 ────────────────────────────────────────────────
    '관리자': 'Quản trị viên',
    '의사': 'Bác sĩ',
    '간호사': 'Điều dưỡng',
    '원무': 'Hành chính tiếp nhận',
    '약사': 'Dược sĩ',
    '검사기사': 'Kỹ thuật viên xét nghiệm',
    '급양': 'Dịch vụ suất ăn',
    '행정직': 'Nhân viên hành chính',
    '의무기록사': 'Nhân viên hồ sơ bệnh án',
    '검진센터': 'Trung tâm khám sức khỏe',
    '고객관리 책임자': 'Phụ trách quản lý khách hàng',
    '고객상담': 'Tư vấn khách hàng',
    '조회 전용': 'Chỉ xem',

    // ── 기록 상태 ───────────────────────────────────────────
    '작성중': 'Đang soạn',
    '서명': 'Đã ký',
    '수정': 'Đã sửa đổi',
    // 🔴 무문맥 '수정'=상태형(Đã sửa đổi=수정됨) — 버튼 동사에 그대로 쓰면 뜻이 뒤집힌다(2026-09-09 P3 문맥 키 신설분)
    '수정@버튼': 'Sửa',

    // ── 수납 상태 ───────────────────────────────────────────
    '미수납': 'Chưa thu',
    '수납완료': 'Đã thu',
    '부분수납': 'Thu một phần',
    '환불': 'Đã hoàn tiền',
    '후납': 'Thanh toán sau',
    '분할납': 'Trả góp',

    // ── 오더·조제 상태 ──────────────────────────────────────
    '의뢰': 'Đã chỉ định',
    '진행중': 'Đang thực hiện',
    '불출': 'Đã cấp phát',
    '보류': 'Tạm hoãn',
    '접수대기': 'Chờ tiếp nhận',
    '수령': 'Đã nhận',
    '조제중': 'Đang chuẩn bị thuốc',
    '조제완료': 'Đã chuẩn bị thuốc',
    '불출대기': 'Chờ cấp phát',
    '불출완료': 'Đã cấp phát xong',

    // ── 검사·수혈 상태 ──────────────────────────────────────
    '채취': 'Đã lấy mẫu',
    '입력완료': 'Đã nhập kết quả',
    '교차중': 'Đang làm phản ứng chéo',
    '준비': 'Sẵn sàng',
    '출고': 'Đã xuất kho',
    '수혈중': 'Đang truyền máu',

    // ── 입원·전원 ───────────────────────────────────────────
    '재원': 'Đang nằm viện',
    '전원': 'Đã chuyển viện',

    // ── 청구 심사 상태 ──────────────────────────────────────
    '제출': 'Đã nộp',
    '심사중': 'Đang thẩm định',
    '인정': 'Được chấp nhận',
    '부분인정': 'Chấp nhận một phần',
    '반려': 'Bị từ chối',
    '지급완료': 'Đã chi trả',

    // ── 응급실 흐름 ─────────────────────────────────────────
    '분류대기': 'Chờ phân loại',
    '분류완료': 'Đã phân loại',
    '진료대기': 'Chờ bác sĩ',
    '치료중': 'Đang điều trị',
    '결과대기': 'Chờ kết quả',
    '관찰중': 'Đang theo dõi',
    '처치결정대기': 'Chờ quyết định hướng xử trí',
    '진료종료': 'Đã kết thúc khám',

    // ── 일반 진행 상태 ──────────────────────────────────────
    '예정': 'Dự kiến',
    '진행': 'Đang tiến hành',
    // 🔴 무문맥 '진행'=상태형(Đang tiến hành=진행 중) — 진행률(명사)에 쓰면 뜻이 다르다
    '진행@진행률': 'Tiến độ',
    '신청': 'Đã đăng ký',
    '처리중': 'Đang xử lý',
    '발급완료': 'Đã cấp',
    '교부완료': 'Đã giao',

    // ── 온보딩·계약 ─────────────────────────────────────────
    '초대됨': 'Đã được mời',
    '본인확인': 'Đã xác minh danh tính',
    '서류제출': 'Đã nộp hồ sơ',
    '계약서명': 'Đã ký hợp đồng',
    '승인': 'Đã phê duyệt',
    '활성화': 'Đã kích hoạt',
    '만료': 'Đã hết hạn',
    // 오역 회수: 'Đã hủy bỏ'(=취소·철회)는 코어 en/ja/ar 이 모두 말하는 "폐기(destroy)"가 아니다
    // (en 'Disposed' · ja '廃棄' · ar 'تم الإتلاف'). 같은 한국어 낱말이 마약류 폐기에도 쓰인다.
    '폐기': 'Đã tiêu hủy',
    '초안': 'Bản nháp',
    '발송중': 'Đang gửi',

    // ── 해외환자 케이스 ─────────────────────────────────────
    '문의': 'Yêu cầu tư vấn',
    '견적': 'Đã báo giá',
    '입국': 'Đã nhập cảnh',
    '사후관리': 'Theo dõi sau điều trị',
    '종료': 'Đã đóng',

    // ── 투약 흐름 ───────────────────────────────────────────
    '처방': 'Đã kê đơn',
    '2차확인': 'Kiểm tra lần hai',
    '투약': 'Đã cho dùng thuốc',
    '투약@패널': 'Thuốc',
    '반납': 'Đã trả lại',

    // ── 대외 전송 상태 ──────────────────────────────────────
    '제출대기': 'Chờ nộp',
    '원내 기록(미전송)': 'Ghi nhận nội bộ (chưa gửi đi)',
    '전송 실패': 'Gửi thất bại',
    '전송 근거 없음': 'Không có bằng chứng đã gửi',
    '수기 접수(NIMS 웹)': 'Nộp thủ công (NIMS web)',
    '전송 완료': 'Đã gửi',

    // ── 서명 상태 ───────────────────────────────────────────
    '서명대기': 'Chờ ký',
    '서명완료': 'Đã ký xong',
    '철회': 'Đã thu hồi',

    // ── 장비 상태 ───────────────────────────────────────────
    '가동중': 'Đang vận hành',
    '정비중': 'Đang bảo trì',
    '고장': 'Hỏng',

    // ── 식이 (연하곤란 질감 어휘 4종은 의도적으로 제외) ─────
    '일반식': 'Chế độ ăn thường',
    '저염식': 'Chế độ ăn ít muối',
    '당뇨식': 'Chế độ ăn cho người đái tháo đường',
    '저지방식': 'Chế độ ăn ít chất béo',
    '연식': 'Chế độ ăn mềm',
    '유동식': 'Chế độ ăn lỏng',
    '맑은유동식': 'Chế độ ăn lỏng trong',
    '금식': 'Nhịn ăn uống (NPO)',
    '신장식': 'Chế độ ăn cho bệnh thận',
    '간장식': 'Chế độ ăn cho bệnh gan',
    '고단백식': 'Chế độ ăn giàu đạm',
    '저단백식': 'Chế độ ăn ít đạm',
    '경관영양': 'Nuôi ăn qua ống thông',
    '정맥영양(TPN)': 'Nuôi dưỡng qua đường tĩnh mạch (TPN)',
    '일반': 'Thường',
    '유동': 'Lỏng',

    // ── 배식 상태 ───────────────────────────────────────────
    '오더됨': 'Đã ra y lệnh',
    '조리 완료': 'Đã nấu xong',
    '배식 완료': 'Đã phát suất ăn',
    '섭취 완료': 'Đã ăn hết',
    '일부 섭취': 'Ăn một phần',
    '거부': 'Từ chối',
    '미배식': 'Chưa phát suất ăn',

    // ── 환자안전 사고 ───────────────────────────────────────
    '아차사고': 'Sự cố suýt xảy ra',
    '경미': 'Nhẹ',
    '중등도': 'Trung bình',
    '중대': 'Nghiêm trọng',
    '위해': 'Gây hại',
    '미분류': 'Chưa phân loại',
    '낙상': 'Té ngã',
    '투약오류': 'Sai sót dùng thuốc',
    '환자확인': 'Xác nhận danh tính người bệnh',
    '검체라벨': 'Dán nhãn bệnh phẩm',
    '수혈': 'Truyền máu',
    '욕창': 'Loét tì đè',
    '감염': 'Nhiễm khuẩn',
    '주사침상해': 'Tổn thương do kim đâm',
    '시술·수술': 'Thủ thuật · Phẫu thuật',
    '기록': 'Ghi chép hồ sơ',
    '의사소통': 'Giao tiếp',

    // ── 치료 일정 상태 ──────────────────────────────────────
    '계획': 'Kế hoạch',
    '치료 중': 'Đang điều trị',
    '조사 중': 'Đang xạ trị',
    '조사 완료': 'Đã xạ trị xong',
    '건너뜀': 'Đã bỏ qua',
    '투여 중': 'Đang dùng thuốc',
    '기간 종료': 'Đã hết thời gian',
    '기간 미상': 'Không rõ thời gian',

    // ── 조제 단계 ───────────────────────────────────────────
    '조제 대기': 'Chờ chuẩn bị thuốc',
    '조제 중': 'Đang chuẩn bị thuốc',
    '조제 완료 · 검수 대기': 'Đã chuẩn bị · Chờ kiểm tra',
    '검수 완료 · 불출 대기': 'Đã kiểm tra · Chờ cấp phát',
    '불출 완료': 'Đã cấp phát xong',
    '조제 취소': 'Đã hủy chuẩn bị thuốc',

    // ── 감시자 판정 어휘 ────────────────────────────────────
    '시드·백필 아티팩트': 'Hiện tượng do dữ liệu mẫu · backfill',
    '코드 회수됨 · 잔여 행 보존': 'Đã sửa mã · Giữ nguyên dữ liệu còn lại',
    '실결함 — 회수 필요': 'Lỗi thực — cần khắc phục',
    '원인 미특정 — 보존': 'Chưa xác định nguyên nhân — giữ nguyên',
    '화면 기록': 'Ghi nhận trên màn hình',
    '문서 이관': 'Chuyển từ tài liệu',
    '의료진': 'Nhân viên y tế',
    '행정': 'Hành chính',

    // ── 혈액제제 ────────────────────────────────────────────
    '농축적혈구': 'Khối hồng cầu',
    '신선동결혈장': 'Huyết tương tươi đông lạnh',
    '혈소판농축액': 'Khối tiểu cầu',
    '동결침전': 'Tủa lạnh (Cryoprecipitate)',
    '전혈': 'Máu toàn phần',

    // ── 동의서 종류 ─────────────────────────────────────────
    '마취': 'Gây mê',
    '시술': 'Thủ thuật',
    '연구': 'Nghiên cứu',
    '연명의료': 'Điều trị duy trì sự sống',
    '진료': 'Điều trị',
    '개인정보 수집·이용': 'Thu thập · sử dụng thông tin cá nhân',
    '제3자 제공': 'Cung cấp cho bên thứ ba',
    '민감정보 처리': 'Xử lý thông tin nhạy cảm',

    // ── 마취 종류 ───────────────────────────────────────────
    '전신마취': 'Gây mê toàn thân',
    '척추마취': 'Gây tê tủy sống',
    '경막외마취': 'Gây tê ngoài màng cứng',
    '국소마취': 'Gây tê tại chỗ',
    '수면마취': 'An thần',
    '부분마취': 'Gây tê vùng',
    '무마취': 'Không gây mê / gây tê',

    // ── 거버넌스 근거 ───────────────────────────────────────
    '법령·고시': 'Văn bản pháp luật · thông tư',
    '인증 기준': 'Tiêu chuẩn chứng nhận',
    '원내 실측': 'Số liệu đo trong bệnh viện',
    '결정으로 정해짐': 'Được ấn định bằng quyết định',
    '의결 근거 없음': 'Không có căn cứ nghị quyết',
    '거버넌스 미등재': 'Chưa đưa vào quản trị',

    // ── 고위험 약물 ─────────────────────────────────────────
    '항암제': 'Thuốc hóa trị',
    '신경근차단제': 'Thuốc ức chế thần kinh cơ',
    '고농축 전해질': 'Điện giải đậm đặc',
    '인슐린': 'Insulin',
    '항응고제': 'Thuốc chống đông',
    '마약성 진통제': 'Thuốc giảm đau opioid',
    '진정제': 'Thuốc an thần',
    '고위험': 'Nguy cơ cao',
    '중위험': 'Nguy cơ trung bình',
    '저위험': 'Nguy cơ thấp',
    '저-중위험': 'Nguy cơ thấp – trung bình',

    // ── 결제 수단 ───────────────────────────────────────────
    '신용카드': 'Thẻ tín dụng',
    '현금': 'Tiền mặt',
    '계좌이체': 'Chuyển khoản',
    '선수금': 'Tiền đặt trước',
    '복합결제': 'Thanh toán kết hợp',
    '수단 미기록': 'Chưa ghi phương thức',

    // ── 지연·이탈 ───────────────────────────────────────────
    '접수 지연': 'Chậm tiếp nhận',
    '트리아지 지연': 'Chậm phân loại cấp cứu',
    '호출 지연': 'Chậm gọi',
    '진료 지연': 'Chậm khám',
    '수납 지연': 'Chậm thanh toán',
    '정산 대기': 'Chờ quyết toán',
    '장기 재원': 'Nằm viện dài ngày',
    '고액 미수': 'Nợ viện phí lớn',

    // ── 알레르기 3상태 ──────────────────────────────────────
    '알레르기 있음': 'Có dị ứng',
    '알레르기 미확인': 'Chưa đánh giá dị ứng',
    '알레르기 확인 불가': 'Không thể đánh giá dị ứng',
    '알레르기 없음(확인함)': 'Không có dị ứng đã biết (đã đánh giá)',

    // ── 운영 모드 ───────────────────────────────────────────
    '개발': 'Phát triển',
    '리허설': 'Diễn tập',
    '실운영': 'Vận hành thật',

    // ── 응급실 베드 흐름 ────────────────────────────────────
    '퇴원예정': 'Dự kiến xuất viện',
    '도착': 'Đã đến',
    '처치중': 'Đang xử trí',
    '퇴실결정': 'Đã quyết định hướng xử trí',
    '퇴실': 'Đã rời khoa cấp cứu',

    // ── 지시 경로 ───────────────────────────────────────────
    '서면·전자 지시': 'Y lệnh bằng văn bản · điện tử',
    '구두 지시 (대면)': 'Y lệnh miệng (trực tiếp)',
    '전화 지시': 'Y lệnh qua điện thoại',

    // ── 내과 세부 분과 ──────────────────────────────────────
    '심장내과': 'Nội tim mạch',
    '호흡기내과': 'Nội hô hấp',
    '소화기내과': 'Nội tiêu hóa',
    '내분비내과': 'Nội tiết',
    '신장내과': 'Nội thận',
    '혈액종양내과': 'Huyết học – Ung bướu',
    '감염내과': 'Nội truyền nhiễm',
    '류마티스내과': 'Nội cơ xương khớp',

    // ── 증빙 ────────────────────────────────────────────────
    '증빙 참조(문서 번호)': 'Tham chiếu chứng từ (số văn bản)',
    '증빙 일자': 'Ngày chứng từ',
    '발급 기관': 'Cơ quan cấp',
    '문서 제목': 'Tiêu đề văn bản',

    /* ══ 문맥 키 회수 (2026-09-07) ══════════════════════════════════════════
     * 🔴 여기 62키는 **번역이 없어서** 죽어 있던 것이 아니다. 코어가 동음이의를
     *    `원문@문맥` 으로 갈라 두었는데 이 팩은 무문맥 원문만 갖고 있어서, 그 자리들이
     *    전부 한국어 원문 + `VI×` 티로 그려지고 있었다(실측 63자리).
     * 🔴 무문맥 값을 그대로 복사하지 않았다 — 문맥마다 뜻이 다르다. 코어 en/ja 를 보고
     *    행위형(Administer)과 상태형(Administered)을 갈랐다.
     *    예) `투약`(=Administered, 이미 준 것) ↔ `투약@행위`(=Administer, 주는 행위).
     * 제외 1키: `일반@마약류`(en 'Non-controlled') — 베트남 약사법의 '특별관리 대상'
     *    규정 용어를 확인하지 못했다. 마약류 분류를 지어내면 통제 약품을 일반약으로
     *    읽게 만들 수 있다. 원문+티로 둔다. */

    // 인증서·결재 — 폐기/철회가 코어에서 갈린다(失効させる ≠ 撤回する)
    '폐기@버튼': 'Vô hiệu hóa',
    '폐기@인증서상태': 'Đã vô hiệu hóa',
    '철회@버튼': 'Thu hồi',
    '제출@버튼': 'Nộp',
    '승인@버튼': 'Phê duyệt',
    '승인@행위': 'Phê duyệt',
    '반려@버튼': 'Trả lại',
    '반려@행위': 'Trả lại',
    '거부@행위': 'Từ chối',
    '보류@행위': 'Tạm hoãn',
    '활성화@버튼': 'Kích hoạt',

    // 🔴 마약류 폐기 — 베트남 약사법의 'tiêu hủy thuốc'(약품 폐기) 어휘.
    //    상태형 '폐기'(Đã tiêu hủy)와 갈라 행위형으로 둔다.
    '폐기@마약류': 'Tiêu hủy',
    '폐기@오더세트': 'Ngừng sử dụng',
    '폐기@초안': 'Hủy bản nháp',

    // 공통 동작 — 상태형(Đã …)이 아니라 행위형이다
    '완료@버튼': 'Hoàn tất',
    '준비@버튼': 'Chuẩn bị',
    '기록@버튼': 'Ghi nhận',
    '수정@행위': 'Sửa',
    '수정@동작': 'Chỉnh sửa',
    '수정@감사': 'Cập nhật',
    '호출@버튼': 'Gọi',
    '호출@동작': 'Gọi',
    '호출@AI': 'Lượt gọi',
    '접수@버튼': 'Tiếp nhận',
    '접수@동작': 'Tiếp nhận',
    '접수@원무': 'Tiếp nhận',
    '접수@오더': 'Tiếp nhận',
    '접수@상태': 'Đã tiếp nhận',
    '취소@오더': 'Đã hủy',
    '종료@시각': 'Kết thúc',
    '종료@녹음': 'Dừng',

    // 🔴 투약 — 안전 축. 행위(Administer)와 상태(Administered)를 절대 뒤섞지 않는다
    '투약@행위': 'Cho dùng thuốc',
    '투약@업무': 'Cho dùng thuốc',
    '투약@목록': 'Thuốc',
    '투약@탭': 'Thuốc',
    '확인@투약': 'Xác nhận',
    '예정@투약': 'Đã lên lịch',
    '불출@버튼': 'Cấp phát',

    // 진료·기록 — 코어 en 이 Clinical/Care/Encounter/Visits 로 갈라 둔 자리
    '진료@분류': 'Lâm sàng',
    '진료@포털': 'Khám chữa bệnh',
    '진료@감사': 'Lượt khám',
    '진료@액션': 'Khám bệnh',
    '진료@횟수': 'Lượt khám',
    '기록@명사': 'bản ghi',
    '기록@탭': 'Ghi chép',
    '계획@SOAP': 'Kế hoạch',
    '계획@진료계획': 'Kế hoạch',

    // 감사 로그 리소스 — 입원은 상태(Nội trú)가 아니라 사건(Nhập viện)이다
    '삭제@감사': 'Xóa',
    '인쇄 시도@감사': 'Thử in',
    '처방@감사': 'Đơn thuốc',
    '수납@감사': 'Thanh toán',
    '예약@감사': 'Lịch hẹn',
    '오더@감사': 'Y lệnh',
    '입원@감사': 'Nhập viện',

    // 검사 — 직군/단계/항목이 코어에서 갈린다
    '검사@직군': 'Kỹ thuật viên xét nghiệm',
    '검사@단계': 'Xét nghiệm',
    '검사@항목': 'Xét nghiệm',

    // 병상·재실 — 'Đang nằm viện'(재원 상태)과 'Có bệnh nhân'(병상 점유)은 다른 사실이다
    '재원@병상': 'Có bệnh nhân',
    '예약@병상': 'Đã đặt trước',
    '퇴실@병동': 'Rời khoa',
    '퇴원@상태': 'Đã xuất viện',
    '전원 의뢰@유형': 'Yêu cầu chuyển viện đi',

    '외국인 환자 등록@버튼': 'Đăng ký bệnh nhân nước ngoài',
    '보통@밀도': 'Thoáng',

    /* ══ 고빈도 공통 키 (2026-09-07) ═══════════════════════════════════════
     * 화면 종류를 가리지 않고 나오는 자리만 골랐다 — 목록/필터/빈 상태/편집기.
     * 🔴 임상 전문어는 여기 넣지 않는다(영역 팩의 몫). 전부 채우지 않는다. */

    // 목록·필터·페이지네이션
    '전체': 'Tất cả',
    '전체 기간': 'Toàn bộ thời gian',
    '목록': 'Danh sách',
    '목록으로': 'Về danh sách',
    '상세': 'Chi tiết',
    '상세 접기': 'Thu gọn chi tiết',
    '상세 펼치기': 'Mở rộng chi tiết',
    '접기': 'Thu gọn',
    '필터': 'Bộ lọc',
    '필터 초기화': 'Đặt lại bộ lọc',
    '전체 초기화': 'Đặt lại tất cả',
    '이전': 'Trước',
    '다음': 'Tiếp',
    '오늘': 'Hôm nay',
    '기간': 'Khoảng thời gian',
    '정렬순서': 'Thứ tự sắp xếp',
    '변경': 'Thay đổi',
    '검색 중...': 'Đang tìm...',
    '검색 결과가 없습니다': 'Không có kết quả tìm kiếm',

    // 진행 상태 — "아직 안 온 것"과 "없는 것"을 뒤바꿔 말하지 않는다(§2.2)
    '저장 중...': 'Đang lưu...',
    '처리 중...': 'Đang xử lý...',
    '처리 중': 'Đang xử lý',
    '분석 중…': 'Đang phân tích…',
    '인증 중...': 'Đang xác thực...',
    '서명 중...': 'Đang ký...',
    '에디터 로딩 중...': 'Đang tải trình soạn thảo...',
    '상세 정보를 불러오는 중...': 'Đang tải thông tin chi tiết...',

    // 빈 상태 — "없다"는 사실을 말하는 자리다(0 으로 그리지 않는다)
    '기록이 없습니다': 'Không có bản ghi',
    '등록된 항목이 없습니다': 'Chưa có mục nào được đăng ký',
    '대기 중인 항목이 없습니다': 'Không có mục nào đang chờ',
    '대기 중인 환자가 없습니다': 'Không có bệnh nhân nào đang chờ',
    '환자 데이터가 없습니다': 'Không có dữ liệu bệnh nhân',
    '마킹된 부위가 없습니다': 'Chưa đánh dấu vùng nào',

    // 실패 — 실패를 "없음"으로 번역하지 않는다(§부분실패)
    '내보내기에 실패했습니다.': 'Xuất dữ liệu thất bại.',
    '코드 마스터에 연결하지 못했습니다 — 잠시 후 다시 시도하세요':
      'Không kết nối được với danh mục mã — vui lòng thử lại sau giây lát',

    // 편집·문서 공통
    '편집': 'Sửa',
    '편집하기': 'Sửa mục này',
    '삭제': 'Xóa',
    '인쇄': 'In',
    '재인쇄': 'In lại',
    '항목 추가': 'Thêm mục',
    '새 항목 추가': 'Thêm mục mới',
    '새 항목 작성': 'Tạo mục mới',
    '수정 저장': 'Lưu thay đổi',
    '등록@저장': 'Tạo mới',
    '제목': 'Tiêu đề',
    '제목을 입력하세요': 'Nhập tiêu đề',
    '본문': 'Nội dung',
    '본문 미리보기': 'Xem trước nội dung',
    '내용을 작성하세요...': 'Nhập nội dung...',
    '메모...': 'Ghi chú...',
    '이미지': 'Hình ảnh',
    '이미지 URL': 'URL hình ảnh',
    '대표 이미지': 'Ảnh đại diện',
    '미디어 선택': 'Chọn tệp phương tiện',
    '파일 업로드': 'Tải tệp lên',
    '슬러그': 'Slug',
    '슬러그 (URL)': 'Slug (URL)',
    '검색 태그': 'Thẻ tìm kiếm',
    '쉼표로 구분': 'Phân cách bằng dấu phẩy',
    '상단 고정': 'Ghim lên đầu',
    '공개': 'Công khai',
    '숨김': 'Ẩn',
    '코드 체계': 'Hệ mã',
    '문서 유형': 'Loại văn bản',
    '서명자': 'Người ký',

    // 진료 대화·초안 패널(전 진료과 공통 부품)
    '기록 중': 'Đang ghi',
    '일시정지': 'Tạm dừng',
    '종료됨': 'Đã kết thúc',
    '재개': 'Tiếp tục',
    '새 기록@녹음': 'Bản ghi mới',
    '패널 숨기기': 'Ẩn bảng',
    '확인했습니다': 'Đã xác nhận',
    '반영': 'Áp dụng',
    '모두 반영': 'Áp dụng tất cả',
    '건너뛰기': 'Bỏ qua',
    '계산': 'Tính',
    '총점': 'Tổng điểm',
    '결과@산출': 'Kết quả',
    // ── 문맥 키 결손 회수(2026-09-09) — 무문맥 값을 복사하지 않고 문맥마다 새로 옮겼다 ──
    /* ── 위원회 안건 상태(7종을 한 벌로) ── */
    '접수 중…@안건': 'Đang gửi…',
    '접수@안건': 'Đã tiếp nhận',
    '상정@안건': 'Đã trình',
    '의결@안건': 'Đã biểu quyết',
    '부결@안건': 'Bị bác bỏ',
    '보류@안건': 'Đã tạm hoãn',
    '철회@안건': 'Đã rút',
    /* ── 일시·명사·집계 문맥 ── */
    '만료@일시': 'Hết hạn',
    '수정@일시': 'Cập nhật',
    '승인@명사': 'Phê duyệt',
    '전체@합계': 'Tổng cộng',
    '확정@정산버튼': 'Xác nhận',
  },
  verified: new Set(),
  note: '743 / 11,806 키(6.3%) · 전량 AI 초안 — 사람 검수 0. 2026-09-09 문맥 키 결손 회수 12(안건 상태 7종 포함) — 잔여 결손 1(일반@마약류). 영역별 내역은 2026-09-07 실측(코어 6,175 시점)이다: 공통·내비·상태 3영역 65/65 · 264/265 · 258/262 · 나머지 18개 도메인 영역 합계 142/5,583(2.5%). 그 뒤 코어가 11,806 으로 늘어 도메인 영역 분모는 더 커졌고, 화면 대부분은 한국어 원문+미번역 티로 나온다. 연하곤란 식이 질감 4종(저잔사식·갈은식·다진식·점도증진)·기초검사·일반@마약류(Non-controlled)는 베트남어 표준어를 확인하지 못해 일부러 뺐다.',
};
