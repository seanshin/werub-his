import type { MessageCatalog } from '../t';

/**
 * P2c 영역 카탈로그(ws3) — **워크스테이션 잔여 2차**(P2-8 이 허브·front-desk·documents·certificates,
 * P2b(ws2)가 간호·혈액은행·응급·약국·기초검사·감염관리를 가져간 뒤 남은 화면).
 *
 * 범위: `(main)/workstation/{discharge,surgery-prep,therapy,nutrition,icu,reception,rehab-station,
 *        admission,equipment,cssd,post-op,imaging,reading,outpatient-nursing,templates,attending}`
 * 키=한국어 원문(동음이의는 `원문@문맥`)·세 언어 키 집합은 [en, ja, ar] 튜플로 구조 보장·전량 AI_DRAFT.
 *
 * 🔴 **중복 등재 금지 — 등록 순서가 이긴다.** 이 화면들이 부르는 키 **340개 중 95개가 기존
 *    카탈로그(status·nav·common·wsportal·ws2·surgeryer·nursing·outpatient…)에 이미 있어** 여기 넣지
 *    않았다(넣었으면 전부 죽은 키). 등재는 **245키**.
 *    실측 방법: `tOf(키,'en').missing` 전수 대조 + 합류 직전 **선점 재대조**(`tOf(k,'en') === 내 값`)
 *    — 수기 판단 금지(이 축에서 한 번 후보 52 중 48이 이미 있었다).
 *
 * 🔴 **동음이의 문맥 키** — 기존 등재가 **다른 품사·다른 뜻**이라 그대로 쓰면 화면이 거짓말을 한다:
 *    · `접수@버튼`(Receive) — 무문맥 '접수'는 `Reception`(부서명)이고 `접수@상태`는 `Received`(상태).
 *      워크스테이션 표의 '접수'는 **누르는 동사**다. 단계 칩(파란 배지)은 `접수@상태` 로 갈랐다.
 *    · `완료@버튼`(Complete) — 무문맥 '완료'는 `Completed`(상태 과거분사). 버튼에 과거분사가 뜨던 자리.
 *    · `준비@버튼`(Prepare) — 무문맥 '준비'는 `Ready`(상태).
 *    · `호출@버튼`(Call) — 무문맥 '호출'은 `Called`(호출됨 상태).
 *    · `재실@체류시간`(Time in PACU) — 무문맥 '재실'은 `In department`(재실 인원). PACU 표의 '재실'은
 *      **머문 시간** 열이다(Duration 을 담는다).
 *    · `인계@인수인계`(Handoff) — 무문맥 '인계'는 `Handed off by`(인계자). 여기 열 머리글은 인계 **여부**다.
 *    · `수정@행위`(Edit·ws2 기등재 재사용) — 무문맥 '수정'은 `Amended`(수정된 기록 상태).
 *
 * 🔴 **의도적 미등재(원문+티가 정직 — 뺀 것과 사유)**
 *  · **단위 접미사** `건`·`명`·`점`·`회` — `<Unit>` 안의 수 뒤 꼬리라 문장 순서가 언어마다 다르다.
 *  · **태그로 쪼개진 문장** — PACU 안내(`이 보드는 회복실 기록(<code>pacu_records</code>)을 <b>읽어서…`),
 *    캘린더 실패 고지(`<b>비어 있는 것이 아니라 모르는 상태</b>입니다.`), 퇴원 정산 배지(`정산 <b>확인 불가</b>`),
 *    판독 헤더(`대기 N건 · 10초 갱신`). 조각만 번역하면 영어 어순에서 문장이 부서진다.
 *  · **`<option>` 텍스트** — `<T>` 로 감싸면 option 안에 span 이 들어간다. `useTAttr()` 문자열로 전환했고
 *    (`기도*`·`계획*`·`미배식 사유 선택…`·`템플릿 삽입...`) 키는 여기 등재한다.
 *  · **소유 밖 부품의 문자열 prop** — `EmptyState title=`(8곳)·`SmartSignButton label="서명"`은 그 부품이
 *    아직 `<T k={prop}>` 로 렌더하지 않는다. 감싸지 않았고 **키도 넣지 않았다**(넣으면 죽은 키).
 *  · **임상 판정·데이터 값** — Aldrete/PADSS 점수 산출, 활력 수치, 상태 코드 값은 표시 크롬이 아니다.
 *
 * 🔴 **안전 문구는 안전 관점으로 판단했다** — 영어 화면에서 그 줄만 한국어면 판단을 못 한다:
 *    IPSG.1 환자 확인 3줄·수술안전 체크리스트 차단 고지·PACU 지연/재실초과 경보·ICU '이상수치' 배지·
 *    피폭선량 자동추정 고지는 **등재가 더 안전하다**(표준 용어라 오역 여지가 좁다).
 *    반대로 임상 등급·척도 판정 어휘는 ws2/nursing 이 뺀 그대로 두었다(여기에 새로 만들지 않았다).
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // ── 동음이의 문맥 키(위 헤더 참조) ──
  '접수@버튼': ['Receive', '受付する', 'استلام'],
  '접수@상태': ['Received', '受付済', 'تم الاستلام'],
  '완료@버튼': ['Complete', '完了する', 'إكمال'],
  '준비@버튼': ['Prepare', '準備する', 'تجهيز'],
  '호출@버튼': ['Call', '呼び出す', 'استدعاء'],
  '재실@체류시간': ['Time in PACU', 'PACU滞在時間', 'مدة البقاء في الإفاقة'],
  '인계@인수인계': ['Handoff', '申し送り', 'التسليم'],

  // ── 퇴원 워크스테이션(discharge) ──
  '퇴원 워크스테이션': ['Discharge Workstation', '退院ワークステーション', 'محطة عمل الخروج'],
  '퇴원요약 → 체크리스트 → 교육 → 완료': [
    'Discharge summary → Checklist → Education → Complete',
    '退院サマリー → チェックリスト → 教育 → 完了',
    'ملخص الخروج ← قائمة التحقق ← التثقيف ← الإكمال',
  ],
  '대기 중인 퇴원 업무가 없습니다': ['No pending discharge tasks', '待機中の退院業務はありません', 'لا توجد مهام خروج معلقة'],
  '퇴원 상세': ['Discharge details', '退院の詳細', 'تفاصيل الخروج'],
  '병실:': ['Room:', '病室:', 'الغرفة:'],
  '과:': ['Dept:', '科:', 'القسم:'],
  '입원일:': ['Admitted:', '入院日:', 'تاريخ الدخول:'],
  '퇴원일:': ['Discharged:', '退院日:', 'تاريخ الخروج:'],
  '주치의:': ['Attending:', '主治医:', 'الطبيب المعالج:'],
  '진단:': ['Diagnosis:', '診断:', 'التشخيص:'],
  '추적:': ['Follow-up:', 'フォローアップ:', 'المتابعة:'],
  '+ 퇴원 후 재진 사전처방': ['+ Post-discharge follow-up pre-orders', '+ 退院後再診の事前処方', '+ طلبات مسبقة لما بعد الخروج'],
  '퇴원 후 재진 시 시행할 검사·처방 예약 (퇴원약과 별개 — 승인 시 발효)': [
    'Tests and orders scheduled for the follow-up visit after discharge (separate from discharge medications — effective on approval)',
    '退院後の再診で行う検査・処方の予約(退院薬とは別 — 承認時に発効)',
    'الفحوصات والطلبات المجدولة لزيارة المتابعة بعد الخروج (منفصلة عن أدوية الخروج — تسري عند الموافقة)',
  ],
  '입원경과': ['Hospital course', '入院経過', 'مسار الإقامة'],
  '전체 퇴원요약 보기/수정': ['View / edit full discharge summary', '退院サマリー全体を表示・修正', 'عرض/تحرير ملخص الخروج كاملاً'],
  '아직 퇴원요약이 작성되지 않았습니다': ['No discharge summary has been written yet', '退院サマリーはまだ作成されていません', 'لم يُكتب ملخص الخروج بعد'],
  '퇴원요약 작성': ['Write discharge summary', '退院サマリー作成', 'كتابة ملخص الخروج'],
  '퇴원 준비 현황 (서버 검증)': ['Discharge readiness (verified on the server)', '退院準備状況(サーバー検証)', 'جاهزية الخروج (تحقق من الخادم)'],
  '정산 미완 · 잔액': ['Settlement incomplete · balance', '精算未完 · 残高', 'التسوية غير مكتملة · الرصيد'],
  '퇴원약': ['Discharge medications', '退院薬', 'أدوية الخروج'],
  '퇴원 처리 시작': ['Start discharge processing', '退院処理を開始', 'بدء إجراءات الخروج'],

  // ── 수술 준비(surgery-prep) ──
  '수술 준비 워크스테이션': ['Surgery Prep Workstation', '手術準備ワークステーション', 'محطة عمل تحضير العملية'],
  '접수 → 수술 전 체크 → 이송 → 완료': [
    'Receive → Pre-op check → Transfer → Complete',
    '受付 → 術前チェック → 移送 → 完了',
    'الاستلام ← فحص ما قبل العملية ← النقل ← الإكمال',
  ],
  '수술 목록': ['Surgery list', '手術一覧', 'قائمة العمليات'],
  '수술 전 체크': ['Pre-op check', '術前チェック', 'فحص ما قبل العملية'],
  '수술실 이송': ['Transfer to OR', '手術室へ移送', 'النقل إلى غرفة العمليات'],
  '예정시간': ['Scheduled', '予定時刻', 'الوقت المقرر'],
  '대기 중인 수술 준비가 없습니다': ['No surgery preparations pending', '待機中の手術準備はありません', 'لا توجد تحضيرات جراحية معلقة'],
  '수술을 선택하세요': ['Select a surgery', '手術を選択してください', 'اختر عملية'],
  '수술 준비 상세': ['Surgery prep details', '手術準備の詳細', 'تفاصيل تحضير العملية'],
  '성별:': ['Sex:', '性別:', 'الجنس:'],
  '생년월일:': ['Date of birth:', '生年月日:', 'تاريخ الميلاد:'],
  '수술 정보': ['Surgery information', '手術情報', 'معلومات العملية'],
  '집도의:': ['Surgeon:', '執刀医:', 'الجرّاح:'],
  '마취:': ['Anesthesia:', '麻酔:', 'التخدير:'],
  '수술실:': ['OR:', '手術室:', 'غرفة العمليات:'],
  '예정:': ['Scheduled:', '予定:', 'المقرر:'],
  '수술 메모': ['Surgery notes', '手術メモ', 'ملاحظات العملية'],
  'WHO 수술안전 체크리스트': ['WHO Surgical Safety Checklist', 'WHO手術安全チェックリスト', 'قائمة منظمة الصحة العالمية لسلامة الجراحة'],
  '이 오더에 연결된 수술 건이 없어 체크리스트를 기록할 수 없습니다 — 수술 예약과 연결한 뒤 진행하세요.': [
    'This order is not linked to a surgery case, so the checklist cannot be recorded — link it to a surgery booking first.',
    'このオーダーに紐づく手術がないため、チェックリストを記録できません — 手術予約と紐づけてから進めてください。',
    'هذا الطلب غير مرتبط بحالة جراحية، لذا لا يمكن تسجيل قائمة التحقق — اربطه بحجز عملية أولاً.',
  ],
  '마취 전 평가 (ASA)': ['Pre-anesthesia assessment (ASA)', '麻酔前評価(ASA)', 'تقييم ما قبل التخدير (ASA)'],
  '마취전평가 (sign-in 게이트)': ['Pre-anesthesia assessment (sign-in gate)', '麻酔前評価(sign-inゲート)', 'تقييم ما قبل التخدير (بوابة sign-in)'],
  '금식 확인 (NPO 8h+)': ['Fasting confirmed (NPO 8h+)', '絶食確認(NPO 8時間以上)', 'تأكيد الصيام (NPO 8 ساعات فأكثر)'],
  '마취 동의서': ['Anesthesia consent', '麻酔同意書', 'موافقة التخدير'],
  '필수 동의서 확인': ['Required consent check', '必須同意書の確認', 'التحقق من الموافقات المطلوبة'],
  '확인 필요': ['Needs confirmation', '要確認', 'يتطلب تأكيدًا'],
  '수술 상세 보기': ['View surgery details', '手術詳細を見る', 'عرض تفاصيل العملية'],
  '수술 준비 시작': ['Start surgery prep', '手術準備を開始', 'بدء تحضير العملية'],
  '수술 준비 완료': ['Surgery prep complete', '手術準備完了', 'اكتمل تحضير العملية'],
  '기도*': ['Airway*', '気道*', 'مجرى الهواء*'],
  '계획*': ['Plan*', '計画*', 'الخطة*'],
  '평가 완료': ['Assessment complete', '評価完了', 'اكتمل التقييم'],

  // ── 치료실(therapy) ──
  '📋 리스트': ['📋 List', '📋 リスト', '📋 قائمة'],
  '📅 캘린더': ['📅 Calendar', '📅 カレンダー', '📅 تقويم'],
  '+ 환자 추가': ['+ Add patient', '+ 患者追加', '+ إضافة مريض'],
  '💉 항암 →': ['💉 Chemo →', '💉 化学療法 →', '💉 العلاج الكيميائي ←'],
  '투석 시작': ['Start dialysis', '透析開始', 'بدء غسيل الكلى'],
  '투석 완료': ['Dialysis complete', '透析完了', 'اكتمل غسيل الكلى'],
  '방사선 전달': ['Deliver radiation', '放射線照射', 'إعطاء الجرعة الإشعاعية'],
  '세션 완료': ['Session complete', 'セッション完了', 'اكتملت الجلسة'],
  '치료 활동': ['Therapy activity', '治療活動', 'نشاط العلاج'],
  '진행 메모': ['Progress note', '経過メモ', 'ملاحظة التقدم'],
  '수축기 혈압': ['Systolic BP', '収縮期血圧', 'ضغط الدم الانقباضي'],
  '이완기 혈압': ['Diastolic BP', '拡張期血圧', 'ضغط الدم الانبساطي'],
  '실제 초여과량 (mL)': ['Actual ultrafiltration (mL)', '実際の除水量 (mL)', 'الترشيح الفائق الفعلي (mL)'],
  '실제 시간 (분)': ['Actual duration (min)', '実施時間(分)', 'المدة الفعلية (دقيقة)'],
  'Kt/V (실측·선택)': ['Kt/V (measured · optional)', 'Kt/V(実測・任意)', 'Kt/V (مقاس · اختياري)'],
  '합병증 체크리스트': ['Complication checklist', '合併症チェックリスト', 'قائمة التحقق من المضاعفات'],
  '전달 선량 (Gy)': ['Delivered dose (Gy)', '照射線量 (Gy)', 'الجرعة المعطاة (Gy)'],
  'Setup 확인 완료': ['Setup verified', 'セットアップ確認完了', 'تم التحقق من الوضعية'],
  'Cone-beam CT 확인': ['Cone-beam CT verified', 'コーンビームCT確認', 'تم التحقق بالأشعة المقطعية المخروطية'],
  '시행한 치료 활동...': ['Therapy activities performed...', '実施した治療活動...', 'أنشطة العلاج المنفذة...'],
  '환자 반응, ROM 변화...': ['Patient response, ROM change...', '患者の反応、ROMの変化...', 'استجابة المريض، تغير مدى الحركة...'],
  '미측정이면 비워 둔다': ['Leave blank if not measured', '未測定なら空欄のまま', 'اتركه فارغًا إن لم يُقس'],
  // 캘린더
  '캘린더 데이터 로딩 중...': ['Loading calendar data...', 'カレンダーデータを読み込み中...', 'جارٍ تحميل بيانات التقويم...'],
  '불러오지 못함': ['Failed to load', '読み込めませんでした', 'تعذّر التحميل'],
  '환자 수': ['Patients', '患者数', 'عدد المرضى'],

  // ── 영양(nutrition) ──
  '영양 워크스테이션': ['Nutrition Workstation', '栄養ワークステーション', 'محطة عمل التغذية'],
  '영양 업무 상세': ['Nutrition task details', '栄養業務の詳細', 'تفاصيل مهمة التغذية'],
  '업무 정보': ['Task information', '業務情報', 'معلومات المهمة'],
  '업무명': ['Task name', '業務名', 'اسم المهمة'],
  '식사유형': ['Meal type', '食事種別', 'نوع الوجبة'],
  '접수시각': ['Received at', '受付時刻', 'وقت الاستلام'],
  '알레르기 / 특이사항': ['Allergies / notes', 'アレルギー・特記事項', 'الحساسية / ملاحظات'],
  '특이사항': ['Notes', '特記事項', 'ملاحظات خاصة'],
  '진행 단계': ['Workflow stage', '進行段階', 'مرحلة سير العمل'],
  '병실 / 침대': ['Room / bed', '病室・ベッド', 'الغرفة / السرير'],
  '병실/침대': ['Room/bed', '病室/ベッド', 'الغرفة/السرير'],
  '미배식 사유 선택…': ['Select a reason for not serving…', '未配膳の理由を選択…', 'اختر سبب عدم التقديم…'],
  '급양관리 메인': ['Food service main', '給食管理メイン', 'الصفحة الرئيسية لخدمة التغذية'],
  '급양관리 메인 바로가기': ['Go to food service main', '給食管理メインへ', 'الانتقال إلى صفحة خدمة التغذية'],
  '배식 대기': ['Awaiting serving', '配膳待ち', 'بانتظار التقديم'],
  '배식 처리': ['Mark as served', '配膳処理', 'تسجيل التقديم'],
  '해당 업무가 없습니다': ['No tasks in this state', '該当する業務はありません', 'لا توجد مهام في هذه الحالة'],

  // ── 중환자실(icu) ──
  '중환자실(ICU) 워크스테이션': ['ICU Workstation', 'ICU(集中治療室)ワークステーション', 'محطة عمل العناية المركزة'],
  '접수 → 모니터링 → 처치 → 완료': [
    'Receive → Monitoring → Treatment → Complete',
    '受付 → モニタリング → 処置 → 完了',
    'الاستلام ← المراقبة ← المعالجة ← الإكمال',
  ],
  'ICU 메인': ['ICU main', 'ICUメイン', 'الصفحة الرئيسية للعناية المركزة'],
  '입원관리': ['Inpatient management', '入院管理', 'إدارة التنويم'],
  '모니터링': ['Monitoring', 'モニタリング', 'المراقبة'],
  '모니터링 시작': ['Start monitoring', 'モニタリング開始', 'بدء المراقبة'],
  '처치': ['Treatment', '処置', 'المعالجة'],
  '처치 시작': ['Start treatment', '処置開始', 'بدء المعالجة'],
  '업무/병실': ['Task / room', '業務・病室', 'المهمة / الغرفة'],
  '대기 중인 ICU 업무가 없습니다': ['No pending ICU tasks', '待機中のICU業務はありません', 'لا توجد مهام عناية مركزة معلقة'],
  '데이터를 찾을 수 없습니다': ['No data found', 'データが見つかりません', 'لم يتم العثور على بيانات'],
  'ICU 환자 상세': ['ICU patient details', 'ICU患者の詳細', 'تفاصيل مريض العناية المركزة'],
  '병동:': ['Ward:', '病棟:', 'الجناح:'],
  '침대:': ['Bed:', 'ベッド:', 'السرير:'],
  '바이탈사인': ['Vital signs', 'バイタルサイン', 'العلامات الحيوية'],
  '이상수치': ['Abnormal values', '異常値', 'قيم غير طبيعية'],
  'ICU 확인 체크리스트': ['ICU verification checklist', 'ICU確認チェックリスト', 'قائمة تحقق العناية المركزة'],
  '중증도 (APACHE II)': ['Severity (APACHE II)', '重症度(APACHE II)', 'شدة الحالة (APACHE II)'],

  // ── 접수(reception) ──
  '환자 확인 → 접수 → 진료 대기': [
    'Identify patient → Receive → Waiting for consultation',
    '患者確認 → 受付 → 診療待ち',
    'التحقق من المريض ← الاستلام ← بانتظار الفحص',
  ],
  '접수 메인': ['Reception main', '受付メイン', 'الصفحة الرئيسية للاستقبال'],
  '진료 대기': ['Waiting for consultation', '診療待ち', 'بانتظار الفحص'],
  '예약시간': ['Appointment time', '予約時刻', 'وقت الموعد'],
  '대기 중인 접수가 없습니다': ['No pending check-ins', '待機中の受付はありません', 'لا توجد تسجيلات معلقة'],
  '접수 상세': ['Check-in details', '受付の詳細', 'تفاصيل التسجيل'],
  'IPSG.1 환자 확인': ['IPSG.1 Patient identification', 'IPSG.1 患者確認', 'IPSG.1 التحقق من هوية المريض'],
  '이름 확인 (구두 확인)': ['Name confirmed (verbally)', '氏名確認(口頭確認)', 'تأكيد الاسم (شفهيًا)'],
  'MRN / 생년월일 확인 (2가지 식별자)': [
    'MRN / date of birth confirmed (two identifiers)',
    'MRN・生年月日の確認(2つの識別子)',
    'تأكيد رقم الملف / تاريخ الميلاد (معرّفان)',
  ],
  '접수 정보': ['Check-in information', '受付情報', 'معلومات التسجيل'],
  '진료과:': ['Department:', '診療科:', 'القسم:'],
  '담당의:': ['Doctor:', '担当医:', 'الطبيب:'],
  '보험:': ['Insurance:', '保険:', 'التأمين:'],
  '구분:': ['Category:', '区分:', 'الفئة:'],
  '예약:': ['Appointment:', '予約:', 'الموعد:'],
  '이 화면에서는 대기번호를 발급하지 않습니다': [
    'This screen does not issue queue numbers',
    'この画面では受付番号を発行しません',
    'هذه الشاشة لا تُصدر أرقام انتظار',
  ],
  '외래 접수(데스크)에서 확인하세요': [
    'Check at the outpatient reception desk',
    '外来受付(デスク)でご確認ください',
    'تحقق من ذلك في مكتب استقبال العيادات الخارجية',
  ],
  '접수 확인': ['Confirm check-in', '受付確認', 'تأكيد التسجيل'],
  '진료 대기 전환': ['Move to waiting list', '診療待ちへ移す', 'النقل إلى قائمة الانتظار'],
  '법정 동의서 (초진)': ['Statutory consent forms (first visit)', '法定同意書(初診)', 'نماذج الموافقة القانونية (الزيارة الأولى)'],
  '📲 포털 동의 요청': ['📲 Request consent via portal', '📲 ポータルで同意を依頼', '📲 طلب الموافقة عبر البوابة'],

  // ── 재활(rehab-station) ──
  '재활 워크스테이션': ['Rehabilitation Workstation', 'リハビリテーションワークステーション', 'محطة عمل إعادة التأهيل'],
  '재활 업무 상세': ['Rehabilitation task details', 'リハビリ業務の詳細', 'تفاصيل مهمة إعادة التأهيل'],
  '치료 정보': ['Therapy information', '治療情報', 'معلومات العلاج'],
  '치료유형': ['Therapy type', '治療種別', 'نوع العلاج'],
  '치료사': ['Therapist', 'セラピスト', 'المعالج'],
  '치료시간': ['Therapy time', '治療時間', 'وقت العلاج'],
  '세션 진행률': ['Session progress', 'セッション進捗', 'تقدّم الجلسات'],
  '치료 완료': ['Therapy complete', '治療完了', 'اكتمل العلاج'],
  '치료실 메인': ['Therapy unit main', '治療室メイン', 'الصفحة الرئيسية لوحدة العلاج'],
  '치료실 메인 바로가기': ['Go to therapy unit main', '治療室メインへ', 'الانتقال إلى صفحة وحدة العلاج'],

  // ── 입원(admission) ──
  '입원 워크스테이션': ['Admission Workstation', '入院ワークステーション', 'محطة عمل التنويم'],
  '접수 → 동의서 → 병실배정 → 오리엔테이션': [
    'Receive → Consent → Room assignment → Orientation',
    '受付 → 同意書 → 病室割当 → オリエンテーション',
    'الاستلام ← الموافقة ← تخصيص الغرفة ← التعريف',
  ],
  '병실 배정': ['Room assignment', '病室割当', 'تخصيص الغرفة'],
  '배정 병실': ['Assigned room', '割当病室', 'الغرفة المخصصة'],
  '대기 중인 입원이 없습니다': ['No pending admissions', '待機中の入院はありません', 'لا توجد حالات تنويم معلقة'],
  '입원 상세': ['Admission details', '入院の詳細', 'تفاصيل التنويم'],
  '요청의:': ['Requesting physician:', '依頼医:', 'الطبيب الطالب:'],
  '입원 경로': ['Admission route', '入院経路', 'مسار الدخول'],
  '빈 침상 조회 / 배정': ['Find and assign an available bed', '空床照会・割当', 'البحث عن سرير شاغر وتخصيصه'],
  '필수 동의서': ['Required consent forms', '必須同意書', 'الموافقات المطلوبة'],
  '미서명': ['Unsigned', '未署名', 'غير موقّع'],
  '입원 체크리스트': ['Admission checklist', '入院チェックリスト', 'قائمة تحقق التنويم'],
  '입원 처리 시작': ['Start admission processing', '入院処理を開始', 'بدء إجراءات التنويم'],

  // ── 장비(equipment) ──
  '장비 관리 워크스테이션': ['Equipment Workstation', '医療機器管理ワークステーション', 'محطة عمل إدارة الأجهزة'],
  '접수 → 점검/수리 → 완료 · 8초 자동 갱신': [
    'Receive → Inspect/repair → Complete · auto-refresh every 8s',
    '受付 → 点検・修理 → 完了 · 8秒ごと自動更新',
    'الاستلام ← الفحص/الإصلاح ← الإكمال · تحديث تلقائي كل 8 ثوانٍ',
  ],
  '점검/수리중': ['Inspecting / repairing', '点検・修理中', 'قيد الفحص/الإصلاح'],
  '장비명': ['Equipment name', '機器名', 'اسم الجهاز'],
  '모델/시리얼': ['Model / serial', 'モデル・シリアル', 'الطراز / الرقم التسلسلي'],
  '업무유형': ['Task type', '業務種別', 'نوع المهمة'],
  '다음점검일': ['Next inspection', '次回点検日', 'الفحص القادم'],
  '다음 점검일': ['Next inspection date', '次回点検日', 'تاريخ الفحص القادم'],
  '장비 정보': ['Equipment information', '機器情報', 'معلومات الجهاز'],
  '시리얼': ['Serial', 'シリアル', 'الرقم التسلسلي'],
  '제조사': ['Manufacturer', '製造元', 'الشركة المصنّعة'],
  '최근 점검 이력': ['Recent inspection history', '最近の点検履歴', 'سجل الفحوصات الأخيرة'],
  '점검 체크리스트': ['Inspection checklist', '点検チェックリスト', 'قائمة تحقق الفحص'],
  '접수 처리': ['Receive', '受付処理', 'تسجيل الاستلام'],
  '점검시작': ['Start inspection', '点検開始', 'بدء الفحص'],
  '점검 시작': ['Start inspection', '点検開始', 'بدء الفحص'],

  // ── 중앙공급(cssd) ──
  '중앙공급 워크스테이션': ['CSSD Workstation', '中央材料室ワークステーション', 'محطة عمل التعقيم المركزي'],
  '수거 → 세척/멸균 → 완료 · 8초 자동 갱신': [
    'Collect → Clean/sterilize → Complete · auto-refresh every 8s',
    '回収 → 洗浄・滅菌 → 完了 · 8秒ごと自動更新',
    'الجمع ← التنظيف/التعقيم ← الإكمال · تحديث تلقائي كل 8 ثوانٍ',
  ],
  '수거대기': ['Awaiting collection', '回収待ち', 'بانتظار الجمع'],
  '세척/멸균중': ['Cleaning / sterilizing', '洗浄・滅菌中', 'قيد التنظيف/التعقيم'],
  '기구세트': ['Instrument set', '器械セット', 'مجموعة الأدوات'],
  '기구세트 정보': ['Instrument set information', '器械セット情報', 'معلومات مجموعة الأدوات'],
  '요청병동': ['Requesting ward', '依頼病棟', 'الجناح الطالب'],
  '유효기간': ['Expiry date', '有効期限', 'تاريخ الانتهاء'],
  '세척방법': ['Cleaning method', '洗浄方法', 'طريقة التنظيف'],
  '멸균방법': ['Sterilization method', '滅菌方法', 'طريقة التعقيم'],
  'BI 지시기': ['BI (biological indicator)', 'BI(生物学的インジケータ)', 'المؤشر البيولوجي (BI)'],
  '처리 체크리스트': ['Processing checklist', '処理チェックリスト', 'قائمة تحقق المعالجة'],
  '수거접수': ['Receive collection', '回収受付', 'تسجيل الجمع'],
  '수거 접수': ['Receive collection', '回収受付', 'تسجيل الجمع'],
  '멸균시작': ['Start sterilization', '滅菌開始', 'بدء التعقيم'],
  '멸균 처리 시작': ['Start sterilization', '滅菌処理を開始', 'بدء عملية التعقيم'],

  // ── 회복실 보드(post-op / PACU) ──
  '수술 후 회복(PACU) 워크스테이션': ['Post-anesthesia Care (PACU) Workstation', '術後回復(PACU)ワークステーション', 'محطة عمل الإفاقة بعد التخدير (PACU)'],
  '회복실 기록·퇴실': ['Recovery records · discharge', '回復室記録・退室', 'سجلات الإفاقة · الخروج'],
  '수술실 메인': ['OR main', '手術室メイン', 'الصفحة الرئيسية لغرف العمليات'],
  '측정 지연·재실 초과·저체온·이상 활력': [
    'Overdue vitals · prolonged stay · hypothermia · abnormal vitals',
    'バイタル測定遅延・滞在超過・低体温・異常バイタル',
    'تأخر القياس · تجاوز مدة البقاء · انخفاض الحرارة · علامات حيوية غير طبيعية',
  ],
  '퇴실 기준 충족': ['Meets discharge criteria', '退室基準を満たす', 'يستوفي معايير الخروج'],
  '입실 대기': ['Awaiting admission to PACU', '入室待ち', 'بانتظار الدخول'],
  '수술 완료 · PACU 미입실': ['Surgery complete · not yet in PACU', '手術完了・PACU未入室', 'انتهت العملية · لم يدخل الإفاقة بعد'],
  '활력 재측정': ['Vitals due', 'バイタル再測定', 'إعادة قياس العلامات الحيوية'],
  '마지막 활력': ['Last vitals', '最終バイタル', 'آخر قياس للعلامات الحيوية'],
  '재실 초과': ['Prolonged stay', '滞在超過', 'تجاوز مدة البقاء'],
  '입실 후 미측정': ['No vitals since admission', '入室後未測定', 'لا قياسات منذ الدخول'],
  '입실 인계 있음': ['Handoff recorded', '入室申し送りあり', 'تم تسجيل التسليم'],
  '입실 인계 없음': ['No handoff recorded', '入室申し送りなし', 'لا يوجد تسليم مسجل'],

  // ── 영상 촬영(imaging) ──
  '환자 접수': ['Receive patient', '患者受付', 'استلام المريض'],
  '촬영 완료': ['Acquisition complete', '撮影完了', 'اكتمل التصوير'],
  '촬영 완료 확인': ['Confirm acquisition', '撮影完了の確認', 'تأكيد اكتمال التصوير'],
  '☢ 피폭선량 기록 (장비 콘솔 판독값·선택)': [
    '☢ Radiation dose record (read from the device console · optional)',
    '☢ 被曝線量の記録(装置コンソールの読取値・任意)',
    '☢ تسجيل جرعة الإشعاع (قراءة من وحدة تحكم الجهاز · اختياري)',
  ],
  '유효선량 미입력 시 DLP×부위별 변환계수로 자동 추정됩니다': [
    'If effective dose is left blank it is estimated automatically from DLP × the region conversion factor',
    '実効線量が未入力の場合、DLP×部位別変換係数から自動推定されます',
    'إذا تُرك الجرعة الفعالة فارغًا، تُقدَّر تلقائيًا من DLP × معامل التحويل حسب المنطقة',
  ],
  '유효선량 (mSv)': ['Effective dose (mSv)', '実効線量 (mSv)', 'الجرعة الفعالة (mSv)'],
  '촬영 전/후 체크리스트': ['Pre/post acquisition checklist', '撮影前後チェックリスト', 'قائمة التحقق قبل/بعد التصوير'],
  '촬영 완료 → 판독 요청': ['Acquisition complete → request reading', '撮影完了 → 読影依頼', 'اكتمل التصوير ← طلب التقرير'],

  // ── 판독(reading) ──
  '📋 판독 대기열': ['📋 Reading queue', '📋 読影待ちリスト', '📋 قائمة انتظار التقارير'],
  '판독 소견 입력': ['Enter reading report', '読影所見の入力', 'إدخال تقرير الأشعة'],
  'Findings (소견)': ['Findings', 'Findings(所見)', 'Findings (النتائج)'],
  'Conclusion (결론)': ['Conclusion', 'Conclusion(結論)', 'Conclusion (الخلاصة)'],
  'Recommendation (권고)': ['Recommendation', 'Recommendation(推奨)', 'Recommendation (التوصية)'],
  '템플릿 삽입...': ['Insert template...', 'テンプレート挿入...', 'إدراج قالب...'],
  '영상 소견을 기술하세요...': ['Describe the imaging findings...', '画像所見を記載してください...', 'صف نتائج التصوير...'],
  '판독 결론...': ['Reading conclusion...', '読影の結論...', 'خلاصة التقرير...'],
  '추가 검사, 추적 등...': ['Additional tests, follow-up, etc...', '追加検査・経過観察など...', 'فحوصات إضافية، متابعة، إلخ...'],

  // ── 외래 간호(outpatient-nursing) ──
  '외래 간호 워크스테이션': ['Outpatient Nursing Workstation', '外来看護ワークステーション', 'محطة عمل تمريض العيادات'],
  '입원 간호': ['Inpatient nursing', '入院看護', 'تمريض التنويم'],
  '진료 중': ['In consultation', '診療中', 'أثناء الفحص'],
  '진료과 / 의사': ['Department / doctor', '診療科・医師', 'القسم / الطبيب'],
  '간호 진행': ['Nursing progress', '看護の進行', 'تقدّم التمريض'],
  '간호 미완료': ['Nursing not completed', '看護未完了', 'التمريض غير مكتمل'],
  '접수 사유': ['Reason for visit', '受付理由', 'سبب الزيارة'],
  '대기 환자가 없습니다': ['No waiting patients', '待機中の患者はいません', 'لا يوجد مرضى منتظرون'],

  // ── 검사항목 템플릿(templates) ──
  '검사항목 템플릿 관리': ['Test item templates', '検査項目テンプレート管理', 'إدارة قوالب بنود الفحص'],
  '검사 코드별 입력 항목(이름/단위/참고범위)을 관리합니다': [
    'Manage the input items (name / unit / reference range) for each test code',
    '検査コードごとの入力項目(名称・単位・参考範囲)を管理します',
    'إدارة بنود الإدخال (الاسم / الوحدة / المدى المرجعي) لكل رمز فحص',
  ],
  '+ 템플릿 추가': ['+ Add template', '+ テンプレート追加', '+ إضافة قالب'],
  '항목명': ['Item name', '項目名', 'اسم البند'],
  '항목명 *': ['Item name *', '項目名 *', 'اسم البند *'],
  '검사코드 *': ['Test code *', '検査コード *', 'رمز الفحص *'],
  '검사명 *': ['Test name *', '検査名 *', 'اسم الفحص *'],
  '스테이션': ['Station', 'ステーション', 'المحطة'],
  '+ 항목 추가': ['+ Add item', '+ 項目追加', '+ إضافة بند'],
  '일반혈액검사': ['Complete blood count', '一般血液検査', 'تعداد الدم الكامل'],

  // ── 주치의(attending) ──
  '👨‍⚕️ 주치의 워크스테이션': ['👨‍⚕️ Attending Workstation', '👨‍⚕️ 主治医ワークステーション', '👨‍⚕️ محطة عمل الطبيب المعالج'],
  '협진 요청': ['Consult requests', 'コンサルト依頼', 'طلبات الاستشارة'],
  // ── S4 2026-09-15 ──
  "이 진료에 약 처방이 없습니다": ["No medication prescriptions for this visit", "この診療に薬の処方はありません", "لا توجد وصفات دوائية لهذه الزيارة"],
  "처방·약품 마스터에 등록된 값 그대로입니다 — 용법·주의 문구는 만들지 않습니다": ["Values as recorded in the prescription and drug master — no usage or caution text is generated", "処方・薬品マスタの登録値そのままです — 用法・注意文は生成しません", "القيم كما سُجلت في الوصفة وسجل الأدوية — لا يُولَّد نص استخدام أو تحذير"],
  "처방이 많아 앞의 {건수}건만 표시합니다": ["Too many prescriptions — showing the first {건수}", "処方が多いため最初の{건수}件のみ表示します", "وصفات كثيرة — عرض أول {건수} فقط"],
  "마스터 미등록 처방": ["Prescription not linked to drug master", "マスタ未登録の処方", "وصفة غير مرتبطة بسجل الأدوية"],
  "보관@약품": ["Storage", "保管", "التخزين"],
  "임부 분류": ["Pregnancy category", "妊婦分類", "فئة الحمل"],
  "유사명칭 그룹": ["Look-alike/sound-alike group", "類似名称グループ", "مجموعة الأسماء المتشابهة"],
  "처방의 지시(원문)": ["Prescriber's instructions (verbatim)", "処方医の指示（原文）", "تعليمات الطبيب الواصف (حرفيًا)"],
  "진료 후 처방 설명": ["Post-visit prescription guide", "診療後の処方説明", "شرح الوصفة بعد الزيارة"],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const WS3_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위(§6-3). 임상 검수 전에는 아무 키도 올리지 않는다. */
export const WS3_VERIFIED: ReadonlySet<string> = new Set();
