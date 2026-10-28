import type { MessageCatalog } from '../t';

/**
 * 상태 라벨 카탈로그 — P1-B 소유. 키 = shared *_LABEL Record(+META label)의 **한국어 라벨 값 원문**.
 * 🔴 원본 *_LABEL Record 는 시그니처·값 불변(소비처 다수·시드 기계 대조) — 번역은 여기서만.
 * 🔴 전량 AI_DRAFT(STATUS_VERIFIED 빈 집합) — 렌더 부품이 초안 티(data-i18n-draft·툴팁)를 단다.
 *
 * 규약
 * - 한 원문이 여러 Record 에 나오면 **1키로 병합**한다(키 = 원문 하나).
 * - 키 집합은 세 언어 동일 — 아래 TRANSLATIONS 가 [en, ja, ar] 튜플이라 **구조적으로 보장**된다.
 * - COMMON_MESSAGES 에 이미 같은 의미로 등재된 원문(알림 카테고리·심각도: 오더/수납/검사/약국/
 *   임상 위급/결재\/승인/상담\/VoC/시스템/정보/주의/위급)은 **중복 등재하지 않는다**
 *   (CATALOGS 는 등록 순서라 common 이 이기고, 여기 사본은 죽은 키가 된다).
 * - 동음이의는 `원문@상태` 컨텍스트 키: '취소'(common=Cancel 버튼 ↔ 상태=Cancelled),
 *   '예약'(common=Appointment 카테고리 ↔ 상태=Scheduled). StatusBadge 가 `@상태` 를 먼저 본다.
 *
 * 🔴 **뺀 키(번역을 지어내지 않는다 — 미등록 = 한국어 원문 + EN×/JA×/AR× 티가 정직하다)**
 * - KTAS 5종('1 소생'~'5 비응급'): 타 트리아지 척도(CTAS/JTAS) 등급 문구와의 대응은
 *   임상 검수가 필요한 판단이다(예: KTAS 3 '응급' ↔ JTAS 3 '準緊急' — 문구가 어긋난다).
 * - '적신호'(환자안전 sentinel event): 일본어 표준 어휘(警鐘事例/センチネルイベント) 확신 없음.
 * - '성분채혈혈소판': 일본 공식 혈액제제 명명 확신 없음.
 */

/** [en, ja, ar] — 키 집합 3언어 동일을 튜플로 강제한다 */
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // shared SPACE_IMPORT_STATUS_LABEL·SYNTHETIC_GEOMETRY_NOTICE(space-geometry.ts · 2026-09-28 P1)
  '확정(사용 중)': ['Confirmed (in use)', '確定(使用中)', 'مؤكد (قيد الاستخدام)'],
  '대체됨': ['Superseded', '置換済み', 'تم استبداله'],
  '철회됨': ['Withdrawn', '撤回済み', 'تم السحب'],
  '합성 도면 — 실제 건물 아님(시연용 가상병원 배치)': ['Synthetic floor plan — not a real building (demo virtual hospital layout)', '合成図面 — 実在の建物ではありません(デモ用仮想病院の配置)', 'مخطط اصطناعي — ليس مبنى حقيقيًا (تخطيط مستشفى افتراضي للعرض)'],
  // shared LOCATION_SOURCE_LABEL(patient-location.ts · 2026-09-28 공간·동선 P0) — '출처 미상'은 admin6 에 이미 있다
  'QR 스캔(관측)': ['QR scan (observed)', 'QRスキャン(観測)', 'مسح QR (مرصود)'],
  '스테이션 도착(관측)': ['Station arrival (observed)', 'ステーション到着(観測)', 'الوصول إلى المحطة (مرصود)'],
  '이벤트로 추정': ['Inferred from event', 'イベントから推定', 'مُستنتَج من حدث'],
  '시뮬레이션': ['Simulation', 'シミュレーション', 'محاكاة'],
  '직원 입력': ['Staff entry', '職員入力', 'إدخال الموظف'],
  // ── 동음이의(@상태) — StatusBadge 전용 컨텍스트 ──
  '취소@상태': ['Cancelled', '取消', 'ملغى'],
  '예약@상태': ['Scheduled', '予約済み', 'مجدول'],

  // ── StatusBadge DEFAULT_CONFIG ──
  '납부완료': ['Paid', '納付済み', 'تم الدفع'],
  '미납': ['Unpaid', '未納', 'غير مدفوع'],
  '활성': ['Active', '有効', 'نشط'],
  '비활성': ['Inactive', '無効', 'غير نشط'],
  '오류': ['Error', 'エラー', 'خطأ'],
  '경고': ['Warning', '警告', 'تحذير'],
  '확정': ['Confirmed', '確定', 'مؤكد'],
  '완료': ['Completed', '完了', 'مكتمل'],

  // ── GENDER_LABEL ──
  '남': ['Male', '男', 'ذكر'],
  '여': ['Female', '女', 'أنثى'],
  '기타': ['Other', 'その他', 'أخرى'],
  '미상': ['Unknown', '不明', 'غير معروف'],

  // ── INSURANCE_LABEL ──
  '건강보험': ['National Health Insurance', '健康保険', 'التأمين الصحي الوطني'],
  '의료급여': ['Medical Aid', '医療扶助', 'المساعدة الطبية'],
  '산재보험': ["Workers' Compensation", '労災保険', 'تأمين إصابات العمل'],
  '자동차보험': ['Auto Insurance', '自動車保険', 'تأمين السيارات'],
  '비급여(자비)': ['Self-Pay', '自費', 'دفع ذاتي'],

  // ── APPOINTMENT / WAITING_QUEUE / ORDER 공통 흐름 ──
  '진료중': ['In Consultation', '診察中', 'قيد المعاينة'],
  '미내원': ['No-Show', '未来院', 'لم يحضر'],
  '미방문': ['No-Show', '未訪問', 'لم يحضر'],
  '대기': ['Waiting', '待機', 'قيد الانتظار'],
  '호출': ['Called', '呼出済み', 'تم النداء'],
  '수납대기': ['Awaiting Payment', '会計待ち', 'بانتظار الدفع'],
  '약국대기': ['Awaiting Pharmacy', '薬局待ち', 'بانتظار الصيدلية'],

  // ── USER_ROLE_LABEL ──
  '관리자': ['Administrator', '管理者', 'مسؤول النظام'],
  '의사': ['Doctor', '医師', 'طبيب'],
  '간호사': ['Nurse', '看護師', 'ممرض'],
  '원무': ['Reception', '医事', 'الاستقبال'],
  '약사': ['Pharmacist', '薬剤師', 'صيدلي'],
  '검사기사': ['Lab Technologist', '臨床検査技師', 'فني مختبر'],
  '급양': ['Food Services', '給食', 'خدمات التغذية'],
  '행정직': ['Administrative Staff', '事務職', 'موظف إداري'],
  '의무기록사': ['Medical Records Officer', '診療情報管理士', 'أخصائي السجلات الطبية'],
  '검진센터': ['Checkup Center', '健診センター', 'مركز الفحص الصحي'],
  '고객관리 책임자': ['CRM Manager', '顧客管理責任者', 'مدير علاقات العملاء'],
  '고객상담': ['Customer Service', '顧客相談', 'خدمة العملاء'],
  // 🔴 '경영진'(EXECUTIVE)은 여기 없다 — nav 섹션 타이틀 '경영진' 이 **등록 순서상 이긴다**.
  //    직군명과 메뉴 섹션명이 같은 뜻·같은 값이라 en 대조 가드에 안 걸렸다. 지는 쪽을 지운다
  //    (access-control 의 `<T k={roleLabel(r)}/>` 는 nav 정의로 그대로 조회된다).
  '조회 전용': ['Read-Only', '閲覧専用', 'عرض فقط'],

  // ── ENCOUNTER_STATUS_LABEL ──
  '작성중': ['Drafting', '作成中', 'قيد الإعداد'],
  '서명': ['Signed', '署名済み', 'موقّع'],
  '수정': ['Amended', '修正', 'معدّل'],

  // ── BILLING_STATUS_LABEL ──
  '미수납': ['Unpaid', '未収', 'غير مدفوع'],
  '수납완료': ['Paid', '支払完了', 'تم الدفع'],
  '부분수납': ['Partially Paid', '一部支払', 'دفع جزئي'],
  '환불': ['Refunded', '返金', 'مسترد'],
  '후납': ['Deferred Payment', '後払い', 'دفع مؤجل'],
  '분할납': ['Installment', '分割払い', 'دفع بالتقسيط'],

  // ── ORDER / ORDER_DEPT / PHARMACY_ORDER ──
  '의뢰': ['Ordered', '依頼', 'تم الطلب'],
  '진행중': ['In Progress', '進行中', 'قيد التنفيذ'],
  '불출': ['Issued', '払出', 'تم الصرف'],
  '보류': ['On Hold', '保留', 'معلق'],
  '접수대기': ['Awaiting Receipt', '受付待ち', 'بانتظار الاستلام'],
  '수령': ['Received', '受領', 'تم الاستلام'],
  '조제중': ['Preparing', '調剤中', 'التحضير جارٍ'],
  '조제완료': ['Prepared', '調剤完了', 'تم التحضير'],
  '불출대기': ['Awaiting Issue', '払出待ち', 'بانتظار الصرف'],
  '불출완료': ['Issue Complete', '払出完了', 'اكتمل الصرف'],

  // ── PRESCRIPTION_STATUS_LABEL — 활성/완료/취소/보류 는 상단·공통에 등재 ──

  // ── LAB_RESULT_STATUS_LABEL ──
  '채취': ['Collected', '採取済み', 'تم أخذ العينة'],
  '입력완료': ['Entered', '入力済み', 'تم الإدخال'],

  // ── TRANSFUSION_ORDER_STATUS_LABEL ──
  '교차중': ['Crossmatching', '交差適合試験中', 'اختبار التوافق جارٍ'],
  '준비': ['Ready', '準備完了', 'جاهز'],
  '출고': ['Released', '出庫', 'تم الإخراج'],
  '수혈중': ['Transfusing', '輸血中', 'نقل الدم جارٍ'],

  // ── ADMISSION_STATUS_LABEL ──
  '재원': ['Admitted', '在院中', 'منوَّم'],
  '퇴원@상태': ['Discharged', '退院', 'تم الخروج'],
  '전원': ['Transferred', '転院', 'محوَّل'],

  // ── CLAIM_STATUS_LABEL ──
  '제출': ['Submitted', '提出済み', 'تم التقديم'],
  '심사중': ['Under Review', '審査中', 'قيد المراجعة'],
  '인정': ['Approved', '認定', 'موافق عليه'],
  '부분인정': ['Partially Approved', '一部認定', 'موافقة جزئية'],
  '반려': ['Rejected', '却下', 'مرفوض'],
  '결재중': ['In approval', '決裁中', 'قيد الاعتماد'], // HR_REQUEST_STATUS_LABEL(2026-09-14 comp3 에서 이관 — StatusBadge hrRequest)
  '지급완료': ['Paid', '支払済み', 'تم الدفع'],

  // ── EMERGENCY_VISIT_STATUS_LABEL ──
  '분류대기': ['Awaiting Triage', 'トリアージ待ち', 'بانتظار الفرز'],
  '분류완료': ['Triaged', 'トリアージ済み', 'تم الفرز'],
  '진료대기': ['Awaiting Doctor', '診察待ち', 'بانتظار الطبيب'],
  '치료중': ['In Treatment', '治療中', 'قيد العلاج'],
  '결과대기': ['Awaiting Results', '結果待ち', 'بانتظار النتائج'],
  '관찰중': ['Under Observation', '観察中', 'تحت الملاحظة'],
  '처치결정대기': ['Awaiting Disposition', '方針決定待ち', 'بانتظار قرار التصرف'],
  '진료종료': ['Visit Ended', '診療終了', 'انتهت المعالجة'],

  // ── PLAN_STATUS_LABEL ──
  '예정': ['Planned', '予定', 'مقرر'],
  '진행': ['In Progress', '進行中', 'قيد التنفيذ'],

  // ── DOC_ISSUANCE_STATUS_LABEL ──
  '신청': ['Requested', '申請済み', 'تم الطلب'],
  '처리중': ['Processing', '処理中', 'قيد المعالجة'],
  '발급완료': ['Issued', '発行済み', 'تم الإصدار'],
  '교부완료': ['Delivered', '交付済み', 'تم التسليم'],

  // ── ONBOARDING_STATUS_LABEL ──
  '초대됨': ['Invited', '招待済み', 'تمت الدعوة'],
  '본인확인': ['Identity Verified', '本人確認済み', 'تم التحقق من الهوية'],
  '서류제출': ['Documents Submitted', '書類提出済み', 'تم تقديم المستندات'],
  '계약서명': ['Contract Signed', '契約署名済み', 'تم توقيع العقد'],
  '승인': ['Approved', '承認', 'موافق عليه'],
  '활성화': ['Activated', '有効化', 'مفعّل'],
  '만료': ['Expired', '期限切れ', 'منتهي الصلاحية'],
  '폐기': ['Disposed', '廃棄', 'تم الإتلاف'],

  // ── CAMPAIGN_STATUS_LABEL ──
  '초안': ['Draft', '下書き', 'مسودة'],
  '발송중': ['Sending', '送信中', 'جارٍ الإرسال'],

  // ── INTL_CASE_STATUS_LABEL ──
  '문의': ['Inquiry', '問い合わせ', 'استفسار'],
  '견적': ['Quoted', '見積提示', 'تم تقديم عرض السعر'],
  '입국': ['Arrived', '入国', 'وصل'],
  '사후관리': ['Follow-Up', 'フォローアップ', 'متابعة'],
  '종료': ['Closed', '終結', 'مغلق'],

  // ── CONTROLLED_SUBSTANCE_STATUS_LABEL ──
  '처방': ['Prescribed', '処方済み', 'موصوف'],
  '2차확인': ['Second Check', '二次確認', 'تحقق ثانٍ'],
  '투약': ['Administered', '投与済み', 'تم الإعطاء'],
  '반납': ['Returned', '返納', 'تمت الإعادة'],

  // ── MED_ADMIN_STATUS_LABEL ── 예정·완료·보류·거부는 위에 있다 · 🔴 '미투약'은 안전 어휘라 사람 검수 전 미등재(settings3 헤더 ①)

  // ── NIMS_TRANSMISSION_STATUS_LABEL ──
  '제출대기': ['Awaiting Submission', '提出待ち', 'بانتظار التقديم'],
  '원내 기록(미전송)': ['Recorded In-House (Not Sent)', '院内記録(未送信)', 'سجل داخلي (غير مُرسَل)'],
  '전송 실패': ['Transmission Failed', '送信失敗', 'فشل الإرسال'],
  '전송 근거 없음': ['No Proof of Transmission', '送信根拠なし', 'لا دليل على الإرسال'],
  '수기 접수(NIMS 웹)': ['Manually Filed (NIMS Web)', '手動受付(NIMSウェブ)', 'استلام يدوي (موقع NIMS)'],
  '전송 완료': ['Transmitted', '送信完了', 'تم الإرسال'],

  // ── CONSENT_STATUS_LABEL ──
  '서명대기': ['Awaiting Signature', '署名待ち', 'بانتظار التوقيع'],
  '서명완료': ['Signed', '署名完了', 'تم التوقيع'],
  '철회': ['Revoked', '撤回', 'مسحوب'],

  // ── EQUIPMENT_STATUS_LABEL ──
  '가동중': ['In Service', '稼働中', 'قيد التشغيل'],
  '정비중': ['Under Maintenance', '整備中', 'قيد الصيانة'],
  '고장': ['Out of Order', '故障', 'معطل'],

  // ── DIET_TYPE_LABEL / DIET_TEXTURE_LABEL ──
  '일반식': ['Regular Diet', '常食', 'طعام عادي'],
  '저염식': ['Low-Salt Diet', '減塩食', 'حمية قليلة الملح'],
  '당뇨식': ['Diabetic Diet', '糖尿病食', 'حمية السكري'],
  '저지방식': ['Low-Fat Diet', '低脂肪食', 'حمية قليلة الدهون'],
  '연식': ['Soft Diet', '軟食', 'طعام لين'],
  '유동식': ['Liquid Diet', '流動食', 'طعام سائل'],
  '맑은유동식': ['Clear Liquid Diet', '清澄流動食', 'سوائل صافية'],
  '금식': ['NPO', '絶食(NPO)', 'صيام (NPO)'],
  '신장식': ['Renal Diet', '腎臓食', 'حمية الكلى'],
  '간장식': ['Hepatic Diet', '肝臓食', 'حمية الكبد'],
  '고단백식': ['High-Protein Diet', '高タンパク食', 'حمية عالية البروتين'],
  '저단백식': ['Low-Protein Diet', '低タンパク食', 'حمية منخفضة البروتين'],
  '저잔사식': ['Low-Residue Diet', '低残渣食', 'حمية قليلة البقايا'],
  '갈은식': ['Pureed Diet', 'ミキサー食', 'طعام مهروس'],
  '경관영양': ['Tube Feeding', '経管栄養', 'تغذية أنبوبية'],
  '정맥영양(TPN)': ['Parenteral Nutrition (TPN)', '静脈栄養(TPN)', 'تغذية وريدية (TPN)'],
  '일반': ['Regular', '普通', 'عادي'],
  '다진식': ['Minced Diet', 'きざみ食', 'طعام مفروم'],
  '유동': ['Liquid', '流動', 'سائل'],
  '점도증진': ['Thickened', 'とろみ付き', 'مُثخَّن'],

  // ── MEAL_ORDER_STATUS_LABEL ──
  '오더됨': ['Ordered', 'オーダー済み', 'تم الطلب'],
  '조리 완료': ['Cooked', '調理完了', 'تم الطهي'],
  '배식 완료': ['Served', '配膳済み', 'تم تقديم الوجبة'],
  '섭취 완료': ['Consumed', '摂取完了', 'تم تناول الوجبة'],
  '일부 섭취': ['Partially Consumed', '一部摂取', 'تناول جزئي'],
  '거부': ['Refused', '拒否', 'مرفوض'],
  '미배식': ['Not Served', '未配膳', 'لم تُقدَّم الوجبة'],

  // ── INCIDENT_SEVERITY_LABEL ('적신호' 제외 — 상단 주석) ──
  '아차사고': ['Near Miss', 'ヒヤリ・ハット', 'حدث وشيك'],
  '경미': ['Minor', '軽微', 'طفيف'],
  '중등도': ['Moderate', '中等度', 'متوسط'],
  '중대': ['Major', '重大', 'جسيم'],
  '위해': ['Harm', '危害', 'ضرر'],
  '미분류': ['Unclassified', '未分類', 'غير مصنف'],

  // ── INCIDENT_TYPE_LABEL ──
  '낙상': ['Fall', '転倒・転落', 'سقوط'],
  '투약오류': ['Medication Error', '投薬エラー', 'خطأ دوائي'],
  '환자확인': ['Patient Identification', '患者確認', 'التحقق من هوية المريض'],
  '검체라벨': ['Specimen Labeling', '検体ラベル', 'ملصق العينة'],
  '수혈': ['Transfusion', '輸血', 'نقل الدم'],
  '욕창': ['Pressure Ulcer', '褥瘡', 'قرحة الفراش'],
  '감염': ['Infection', '感染', 'عدوى'],
  '주사침상해': ['Needlestick Injury', '針刺し損傷', 'إصابة وخز إبرة'],
  '시술·수술': ['Procedure/Surgery', '処置・手術', 'إجراء أو جراحة'],
  // 🔴 '장비'(EQUIPMENT)는 여기 없다 — nav 워크스테이션 항목 '장비' 가 등록 순서상 이긴다.
  //    같은 명사('의료기기')라 값도 같았고, **이쪽은 T 경로도 없다**(safety/page.tsx 가
  //    `{INCIDENT_TYPE_LABEL[k]}` 를 생출력한다 — 카탈로그를 타지 않는다). 지는 죽은 정의를 지운다.
  '기록': ['Documentation', '記録', 'توثيق'],
  '의사소통': ['Communication', 'コミュニケーション', 'تواصل'],

  // ── RADIATION_PLAN / RADIATION_FRACTION ──
  '계획': ['Planned', '計画', 'مخطط'],
  '치료 중': ['In Treatment', '治療中', 'قيد العلاج'],
  '조사 중': ['Delivering', '照射中', 'التشعيع جارٍ'],
  '조사 완료': ['Delivered', '照射完了', 'اكتمل التشعيع'],
  '건너뜀': ['Skipped', 'スキップ', 'تم التخطي'],

  // ── DOSING_STATE / DISPENSING_STAGE ──
  '투여 중': ['Dosing', '投与中', 'قيد الإعطاء'],
  '기간 종료': ['Period Ended', '期間終了', 'انتهت المدة'],
  '기간 미상': ['Duration Unknown', '期間不明', 'مدة غير معروفة'],
  '조제 대기': ['Awaiting Preparation', '調剤待ち', 'بانتظار التحضير'],
  '조제 중': ['Preparing', '調剤中', 'التحضير جارٍ'],
  '조제 완료 · 검수 대기': ['Prepared · Awaiting Verification', '調剤完了・検収待ち', 'تم التحضير · بانتظار التحقق'],
  '검수 완료 · 불출 대기': ['Verified · Awaiting Issue', '検収完了・払出待ち', 'تم التحقق · بانتظار الصرف'],
  '불출 완료': ['Issue Complete', '払出完了', 'اكتمل الصرف'],
  '조제 취소': ['Preparation Cancelled', '調剤取消', 'أُلغي التحضير'],

  // ── SENTINEL_JUDGMENT / SOURCE / AUDIENCE ──
  '시드·백필 아티팩트': ['Seed/Backfill Artifact', 'シード・バックフィル アーティファクト', 'أثر بيانات تجريبية/تعبئة رجعية'],
  '코드 회수됨 · 잔여 행 보존': ['Code Fixed · Rows Preserved', 'コード修正済み・残存行は保存', 'تم إصلاح الكود · الصفوف المتبقية محفوظة'],
  '실결함 — 회수 필요': ['Real Defect — Fix Required', '実欠陥 — 要修正', 'عيب فعلي — يلزم الإصلاح'],
  '원인 미특정 — 보존': ['Cause Undetermined — Preserved', '原因未特定 — 保存', 'السبب غير محدد — محفوظ'],
  '화면 기록': ['Recorded On-Screen', '画面から記録', 'مسجل من الشاشة'],
  '문서 이관': ['Migrated From Document', '文書から移管', 'منقول من مستند'],
  '의료진': ['Clinical Staff', '医療スタッフ', 'الطاقم الطبي'],
  '행정': ['Administration', '事務', 'الشؤون الإدارية'],

  // ── BLOOD_PRODUCT_LABEL ('성분채혈혈소판' 제외 — 상단 주석) ──
  '농축적혈구': ['Packed Red Blood Cells', '赤血球濃厚液', 'كريات حمراء مركزة'],
  '신선동결혈장': ['Fresh Frozen Plasma', '新鮮凍結血漿', 'بلازما طازجة مجمدة'],
  '혈소판농축액': ['Platelet Concentrate', '濃厚血小板', 'صفائح دموية مركزة'],
  '동결침전': ['Cryoprecipitate', 'クリオプレシピテート', 'راسب بردي'],
  '전혈': ['Whole Blood', '全血', 'دم كامل'],

  // ── CONSENT_TYPE_LABEL ──
  // 🔴 '수술'(동의서 유형)은 여기 없다 — nav 메뉴 '수술'(/surgery 모듈)이 등록 순서상 이긴다.
  //    **뜻은 실제로 갈린다**: 메뉴 쪽은 진료과·모듈(ru `Хирургия`)이고 동의서 쪽은 술식 행위
  //    (ru `Операция`)다. en/ja 가 우연히 같아(Surgery/手術) 교차 충돌 가드에 안 걸렸다.
  //    그런데도 `수술@동의서` 로 **가르지 않은** 이유는 이 정의에 **T 경로가 없기 때문**이다:
  //    consent 워크스테이션은 `{consentTypeText(...)}` 를 생출력한다(카탈로그 미경유·소비처 0).
  //    소비처 0 인 문맥 키를 새로 만드는 것은 지어낸 키다. 지금은 지는 죽은 정의를 지우고,
  //    **동의서 유형을 `<T>` 로 배선하는 날 `수술@동의서` 로 가른다**(그 전에는 팩 번역자를 오도만 한다).
  '마취': ['Anesthesia', '麻酔', 'تخدير'],
  '시술': ['Procedure', '処置', 'إجراء'],
  '연구': ['Research', '研究', 'بحث'],
  '연명의료': ['Life-Sustaining Treatment', '延命治療', 'العلاج المطيل للحياة'],
  '진료': ['Treatment', '診療', 'علاج'],
  '개인정보 수집·이용': ['Personal Data Collection & Use', '個人情報の収集・利用', 'جمع البيانات الشخصية واستخدامها'],
  '제3자 제공': ['Third-Party Provision', '第三者提供', 'تقديم البيانات لطرف ثالث'],
  '민감정보 처리': ['Sensitive Data Processing', '機微情報の処理', 'معالجة البيانات الحساسة'],
  // RECORDING — 2026-09-22 추가(voice-emr §13.2 P0-2 · 종전엔 라벨이 없어 영문 코드가 그대로 나갔다)
  '진료 녹음·AI 문서화': ['Encounter Recording & AI Documentation', '診療録音・AI文書化', 'تسجيل الزيارة والتوثيق بالذكاء الاصطناعي'],

  // ── ANESTHESIA_LABEL ──
  '전신마취': ['General Anesthesia', '全身麻酔', 'تخدير عام'],
  '척추마취': ['Spinal Anesthesia', '脊椎麻酔', 'تخدير شوكي'],
  '경막외마취': ['Epidural Anesthesia', '硬膜外麻酔', 'تخدير فوق الجافية'],
  '국소마취': ['Local Anesthesia', '局所麻酔', 'تخدير موضعي'],
  '수면마취': ['Sedation', '鎮静(セデーション)', 'تخدير بالتهدئة'],
  '부분마취': ['Regional Anesthesia', '区域麻酔', 'تخدير ناحي'],
  '무마취': ['No Anesthesia', '麻酔なし', 'بدون تخدير'],

  // ── BASIS_KIND / BASIS_STATE ──
  '법령·고시': ['Statutes & Notices', '法令・告示', 'القوانين واللوائح'],
  '인증 기준': ['Accreditation Standards', '認証基準', 'معايير الاعتماد'],
  '원내 실측': ['In-House Data', '院内実測', 'قياسات داخلية'],
  '결정으로 정해짐': ['Set by Decision', '決定により設定', 'محدد بقرار'],
  '의결 근거 없음': ['No Decision on Record', '議決根拠なし', 'لا يوجد قرار مسجل'],
  '거버넌스 미등재': ['Not Governed', 'ガバナンス未登録', 'غير مسجل في الحوكمة'],

  // ── HIGH_ALERT_CATEGORY_LABEL ──
  '항암제': ['Chemotherapy Agents', '抗がん剤', 'أدوية العلاج الكيميائي'],
  '신경근차단제': ['Neuromuscular Blockers', '神経筋遮断薬', 'حاصرات عصبية عضلية'],
  '고농축 전해질': ['Concentrated Electrolytes', '高濃度電解質', 'إلكتروليتات مركزة'],
  '인슐린': ['Insulin', 'インスリン', 'أنسولين'],
  '항응고제': ['Anticoagulants', '抗凝固薬', 'مضادات التخثر'],
  '마약성 진통제': ['Opioid Analgesics', 'オピオイド鎮痛薬', 'مسكنات أفيونية'],
  '진정제': ['Sedatives', '鎮静薬', 'مهدئات'],

  // ── NUTRITION_RISK / NEWS2_RISK ──
  '고위험': ['High Risk', '高リスク', 'خطورة عالية'],
  '중위험': ['Medium Risk', '中リスク', 'خطورة متوسطة'],
  '저위험': ['Low Risk', '低リスク', 'خطورة منخفضة'],
  '저-중위험': ['Low–Medium Risk', '低〜中リスク', 'خطورة منخفضة إلى متوسطة'],

  // ── PAYMENT_METHOD_LABEL ──
  '신용카드': ['Credit Card', 'クレジットカード', 'بطاقة ائتمان'],
  '현금': ['Cash', '現金', 'نقدًا'],
  '계좌이체': ['Bank Transfer', '銀行振込', 'تحويل مصرفي'],
  '선수금': ['Deposit', '前受金', 'دفعة مقدمة'],
  // 🔴 '검진권'(결제수단)은 여기 없다 — nav 섹션 '검진권' 이 등록 순서상 이긴다.
  //    같은 바우처를 가리키는 같은 뜻이고, 단복수 차이라 의미 충돌 가드에도 안 걸렸다.
  '복합결제': ['Mixed Payment', '複合決済', 'دفع مختلط'],
  '수단 미기록': ['Method Not Recorded', '支払方法未記録', 'وسيلة الدفع غير مسجلة'],

  // ── JOURNEY_FLAG_META ──
  '접수 지연': ['Registration Delay', '受付遅延', 'تأخر التسجيل'],
  '트리아지 지연': ['Triage Delay', 'トリアージ遅延', 'تأخر الفرز'],
  '호출 지연': ['Call Delay', '呼出遅延', 'تأخر النداء'],
  '진료 지연': ['Consultation Delay', '診察遅延', 'تأخر المعاينة'],
  '수납 지연': ['Payment Delay', '会計遅延', 'تأخر الدفع'],
  '정산 대기': ['Awaiting Settlement', '精算待ち', 'بانتظار التسوية'],
  '장기 재원': ['Long Stay', '長期在院', 'إقامة مطوّلة'],
  '고액 미수': ['High Unpaid Balance', '高額未収', 'مستحقات كبيرة غير مدفوعة'],

  // ── ALLERGY_STATUS_META(label) ──
  '알레르기 있음': ['Has Allergies', 'アレルギーあり', 'توجد حساسية'],
  '알레르기 미확인': ['Allergies Not Assessed', 'アレルギー未確認', 'لم يتم تقييم الحساسية'],
  '알레르기 확인 불가': ['Unable to Assess Allergies', 'アレルギー確認不可', 'تعذر تقييم الحساسية'],
  '알레르기 없음(확인함)': ['No Known Allergies (Assessed)', '既知のアレルギーなし(確認済み)', 'لا توجد حساسية معروفة (تم التقييم)'],

  // ── HIS_MODE_META(label) ──
  '개발': ['Development', '開発', 'تطوير'],
  '리허설': ['Rehearsal', 'リハーサル', 'تجريبي'],
  '실운영': ['Live', '本番運用', 'تشغيل فعلي'],

  // ── JOURNEY_STAGES(label — 미중복분) ──
  '퇴원예정': ['Discharge Planned', '退院予定', 'خروج مقرر'],
  '도착': ['Arrived', '到着', 'وصل'],
  '처치중': ['In Treatment', '処置中', 'قيد المعالجة'],
  '퇴실결정': ['Disposition Decided', '退室決定', 'تقرر الخروج'],
  '퇴실': ['Left ER', '退室', 'غادر'],

  // ── ORDER_SOURCE(label) ──
  '서면·전자 지시': ['Written/Electronic Order', '書面・電子指示', 'أمر كتابي/إلكتروني'],
  '구두 지시 (대면)': ['Verbal Order (In Person)', '口頭指示(対面)', 'أمر شفهي (حضوري)'],
  '전화 지시': ['Telephone Order', '電話指示', 'أمر هاتفي'],

  // ── IM_SUBSPECIALTIES(label) ──
  '심장내과': ['Cardiology', '循環器内科', 'طب القلب'],
  '호흡기내과': ['Pulmonology', '呼吸器内科', 'طب الجهاز التنفسي'],
  '소화기내과': ['Gastroenterology', '消化器内科', 'طب الجهاز الهضمي'],
  '내분비내과': ['Endocrinology', '内分泌内科', 'طب الغدد الصماء'],
  '신장내과': ['Nephrology', '腎臓内科', 'طب الكلى'],
  '혈액종양내과': ['Hematology-Oncology', '血液腫瘍内科', 'طب أمراض الدم والأورام'],
  '감염내과': ['Infectious Diseases', '感染症内科', 'طب الأمراض المعدية'],
  '류마티스내과': ['Rheumatology', 'リウマチ内科', 'طب الروماتيزم'],

  // ── EVIDENCE_FIELD_LABEL ──
  '증빙 참조(문서 번호)': ['Evidence Reference (Doc No.)', '証憑参照(文書番号)', 'مرجع الإثبات (رقم المستند)'],
  '증빙 일자': ['Evidence Date', '証憑日付', 'تاريخ الإثبات'],
  '발급 기관': ['Issuing Authority', '発行機関', 'الجهة المصدرة'],
  '문서 제목': ['Document Title', '文書タイトル', 'عنوان المستند'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const STATUS_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위(사람 검수 후에만 키를 추가한다) */
export const STATUS_VERIFIED: ReadonlySet<string> = new Set();
