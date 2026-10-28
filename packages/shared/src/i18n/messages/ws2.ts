import type { MessageCatalog } from '../t';

/**
 * P2b 영역 카탈로그(ws2) — **워크스테이션 잔여**(P2-8 이 한 허브·front-desk·documents·certificates 제외).
 * 키=한국어 원문(동음이의는 `원문@문맥`)·세 언어 키 집합은 [en, ja, ar] 튜플로 구조 보장·전량 AI_DRAFT.
 *
 * 범위: 간호(nursing)·혈액은행(blood-bank)·응급(emergency)·약국(pharmacy)·진단검사(diagnostic)·
 *       감염관리(infection-control)·검사(lab) 등 `(main)/workstation/**` 잔여 화면.
 *
 * 🔴 **기존 카탈로그에 있는 원문은 재등재하지 않는다** — 등록 순서상 먼저 등재된 영역이 이겨
 *    여기 적은 값은 죽은 키가 된다(wsportal 이 이미 워크스테이션 어휘 322키를 갖고 있다).
 *    실제로 이 영역의 후보 대부분이 wsportal/status/nav/common 에 있어 **신규는 소수**다.
 *
 * 🔴 **의도적 미등재(원문+티가 정직 — 오역이 안전사고가 되는 자리)**:
 *  · 간호: BCMA 바코드 대조·이중확인·투약 확인 다이얼로그, ⛔고위험(ISMP) 배지, MAR 상태 어휘,
 *    Morse/Braden 척도 항목·선택지·위험등급, 보충산소(NEWS2 7요소) 선택지, Braden 저장불가 고지.
 *  · 혈액은행: 교차시험 판정(적합/부적합 — 수혈 금지/판정 대기), 부적합 경보, 수혈 실행(bedside)
 *    2인 확인·스캔·수혈 시작/완료, 수혈반응 유형·중증도, 혈액원 신고 고지.
 *  · 응급: KTAS 레벨 라벨·설명(소생/긴급/응급/준응급/비응급 — P1-B 도 같은 이유로 미등재),
 *    미분류 배지, 코드 발동 confirm 문구.
 *  · 약국: ⛔고위험·마약류 이중확인, 2인확인 후 완료, 바코드 대조 결과, AI 부작용 위험도 판정.
 *  · 검사/영상/감염: 위급값(critical) 문구, 판독 소견, 격리·신고 판정 어휘.
 * 🔴 그 밖의 미등재: `${}` 보간 문구 · EmptyState/toast/confirm/prompt 등 문자열 prop · print 경로.
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // ── 동음이의 컨텍스트 키 ──
  // '수정'=status Amended(수정된 기록)가 선점 — 여기는 **되돌아가 고치는 행위**다
  '수정@행위': ['Edit', '修正', 'تعديل'],
  // '횟수'=outpatient Visits(내원 횟수)가 선점 — 여기는 **용법의 투여 빈도**다
  '횟수@용법': ['Frequency', '回数', 'التكرار'],

  // ── 간호 워크스테이션(업무 분류) ──
  '수액': ['IV fluid', '輸液', 'السوائل الوريدية'],
  '상처관리': ['Wound care', '創傷ケア', 'العناية بالجروح'],
  '교육': ['Education', '教育', 'التثقيف'],
  '혈당': ['Blood glucose', '血糖', 'سكر الدم'],

  // ── 혈액은행 워크스테이션 ──
  '혈액은행 워크스테이션': ['Blood Bank Workstation', '血液銀行ワークステーション', 'محطة عمل بنك الدم'],
  '접수 → 교차시험 → 혈액 배정 → 완료': [
    'Receive → Crossmatch → Assign blood → Complete',
    '受付 → 交差適合試験 → 血液割当 → 完了',
    'الاستلام ← الفحص المتصالب ← تخصيص الدم ← الإكمال',
  ],
  '혈액은행 메인': ['Blood Bank main', '血液銀行メイン', 'الصفحة الرئيسية لبنك الدم'],
  '교차시험': ['Crossmatch', '交差適合試験', 'الفحص المتصالب'],
  '혈액배정': ['Blood assigned', '血液割当', 'تم تخصيص الدم'],
  '혈액 배정': ['Assign blood', '血液を割り当てる', 'تخصيص الدم'],
  '대기 중인 혈액 요청이 없습니다': ['No pending blood requests', '待機中の血液要求はありません', 'لا توجد طلبات دم معلقة'],
  '단위번호': ['Unit number', 'ユニット番号', 'رقم الوحدة'],
  '혈액 요청을 선택하세요': ['Select a blood request', '血液要求を選択してください', 'اختر طلب دم'],
  '요청을 찾을 수 없습니다': ['Request not found', '要求が見つかりません', 'لم يتم العثور على الطلب'],
  '혈액 요청 상세': ['Blood request details', '血液要求の詳細', 'تفاصيل طلب الدم'],
  '혈액 정보': ['Blood information', '血液情報', 'معلومات الدم'],
  '제품유형': ['Product type', '製品種別', 'نوع المنتج'],
  '단위수': ['Units', '単位数', 'عدد الوحدات'],
  '요청의': ['Requesting physician', '依頼医', 'الطبيب الطالب'],
  '교차시험 결과': ['Crossmatch result', '交差適合試験の結果', 'نتيجة الفحص المتصالب'],
  '수혈 전 확인 체크리스트': ['Pre-transfusion checklist', '輸血前確認チェックリスト', 'قائمة التحقق قبل نقل الدم'],
  '모든 항목 확인 완료': ['All items confirmed', '全項目の確認完了', 'تم تأكيد جميع البنود'],
  '교차시험 시작': ['Start crossmatch', '交差適合試験を開始', 'بدء الفحص المتصالب'],

  // ── 응급 워크스테이션 ──
  '코드레드': ['Code Red', 'コードレッド', 'الرمز الأحمر'],
  '코드화이트': ['Code White', 'コードホワイト', 'الرمز الأبيض'],
  '응급 접수': ['Emergency check-in', '救急受付', 'تسجيل الطوارئ'],
  '접수/트리아지': ['Check-in / Triage', '受付・トリアージ', 'التسجيل / الفرز'],
  '처분 완료': ['Disposition complete', '転帰完了', 'اكتمل التصرف'],
  '응급 환자 접수를 시작하세요': ['Start emergency patient check-in', '救急患者の受付を開始してください', 'ابدأ تسجيل مريض الطوارئ'],
  '응급 접수 시작': ['Start emergency check-in', '救急受付を開始', 'بدء تسجيل الطوارئ'],
  '(신원 미상)': ['(Unidentified)', '(身元不明)', '(مجهول الهوية)'],
  '입원 전환': ['Convert to admission', '入院へ転換', 'التحويل إلى إدخال'],
  '자의퇴원': ['Discharge AMA', '自己退院', 'خروج ضد النصيحة الطبية'],
  '관찰': ['Observation', '経過観察', 'الملاحظة'],
  '응급 → 입원 전환': ['Emergency → Admission', '救急 → 入院転換', 'الطوارئ ← التحويل إلى إدخال'],
  '병상을 배정하면 입원이 생성됩니다.': [
    'Assigning a bed creates the admission.',
    '病床を割り当てると入院が作成されます。',
    'يؤدي تخصيص سرير إلى إنشاء حالة الإدخال.',
  ],
  '병상 배정': ['Bed assignment', '病床割当', 'تخصيص السرير'],
  '처리 중…': ['Processing…', '処理中…', '…جارٍ المعالجة'],
  '응급 환자 접수': ['Emergency patient check-in', '救急患者受付', 'تسجيل مريض الطوارئ'],
  '1단계: 환자 확인': ['Step 1: Confirm patient', 'ステップ1: 患者確認', 'الخطوة 1: تأكيد المريض'],
  '기존 환자 검색': ['Search existing patient', '既存患者を検索', 'البحث عن مريض حالي'],
  '생년월일 (선택)': ['Date of birth (optional)', '生年月日(任意)', 'تاريخ الميلاد (اختياري)'],
  '연락처 (선택)': ['Contact (optional)', '連絡先(任意)', 'جهة الاتصال (اختياري)'],
  '신규 환자 등록 + 응급 접수': [
    'Register new patient + emergency check-in',
    '新規患者登録＋救急受付',
    'تسجيل مريض جديد + تسجيل الطوارئ',
  ],
  '증상 상담 (KTAS 자동 분류)': ['Symptom consult (KTAS auto-triage)', '症状相談(KTAS自動分類)', 'استشارة الأعراض (فرز KTAS آلي)'],
  '적용': ['Apply', '適用', 'تطبيق'],
  '무시': ['Dismiss', '無視', 'تجاهل'],
  '상담': ['Consult', '相談', 'استشارة'],
  '선택된 환자': ['Selected patient', '選択された患者', 'المريض المحدد'],
  '다음: KTAS 분류': ['Next: KTAS triage', '次: KTAS分類', 'التالي: فرز KTAS'],
  '2단계: 주호소 + KTAS 분류': [
    'Step 2: Chief complaint + KTAS triage',
    'ステップ2: 主訴＋KTAS分類',
    'الخطوة 2: الشكوى الرئيسية + فرز KTAS',
  ],
  'KTAS 레벨 선택': ['Select KTAS level', 'KTASレベル選択', 'اختر مستوى KTAS'],
  '다음: 바이탈': ['Next: Vitals', '次: バイタル', 'التالي: العلامات الحيوية'],
  '3단계: 초기 바이탈 + 메모 (선택)': [
    'Step 3: Initial vitals + notes (optional)',
    'ステップ3: 初期バイタル＋メモ(任意)',
    'الخطوة 3: العلامات الحيوية الأولية + ملاحظات (اختياري)',
  ],
  '실제 도착 시각 (선택)': ['Actual arrival time (optional)', '実際の到着時刻(任意)', 'وقت الوصول الفعلي (اختياري)'],
  '다음: 확인': ['Next: Review', '次: 確認', 'التالي: المراجعة'],
  '4단계: 접수 확인': ['Step 4: Confirm check-in', 'ステップ4: 受付確認', 'الخطوة 4: تأكيد التسجيل'],
  '주호소': ['Chief complaint', '主訴', 'الشكوى الرئيسية'],
  '중증도(KTAS)를 선택하세요': [
    'Select a severity (KTAS)',
    '重症度(KTAS)を選択してください',
    'اختر درجة الخطورة (KTAS)',
  ],
  '응급 접수 확정': ['Confirm emergency check-in', '救急受付を確定', 'تأكيد تسجيل الطوارئ'],
  '증상을 입력하세요 (예: 갑자기 가슴이 아프고 숨이 차요)': [
    'Describe the symptom (e.g. sudden chest pain and shortness of breath)',
    '症状を入力してください(例: 急に胸が痛く息が苦しい)',
    'صف العرض (مثال: ألم صدر مفاجئ وضيق نفس)',
  ],
  '주호소를 입력하세요 (예: 흉통, 호흡곤란, 의식저하...)': [
    'Enter the chief complaint (e.g. chest pain, dyspnea, altered consciousness...)',
    '主訴を入力してください(例: 胸痛、呼吸困難、意識低下…)',
    'أدخل الشكوى الرئيسية (مثال: ألم صدر، ضيق نفس، تدهور الوعي...)',
  ],
  '초기 평가 메모 (선택)...': ['Initial assessment note (optional)...', '初期評価メモ(任意)...', '...ملاحظة التقييم الأولي (اختياري)'],

  // ── 약국 워크스테이션 ──
  '약국 워크스테이션': ['Pharmacy Workstation', '薬局ワークステーション', 'محطة عمل الصيدلية'],
  '접수 → 조제 → 검수 → 불출': [
    'Receive → Dispense → Verify → Issue',
    '受付 → 調剤 → 検収 → 払出',
    'الاستلام ← التحضير ← التحقق ← الصرف',
  ],
  '약국 메인': ['Pharmacy main', '薬局メイン', 'الصفحة الرئيسية للصيدلية'],
  '재고/ADR': ['Inventory / ADR', '在庫・ADR', 'المخزون / ADR'],
  '검수대기': ['Awaiting verification', '検収待ち', 'في انتظار التحقق'],
  '주문을 찾을 수 없습니다': ['Order not found', '注文が見つかりません', 'لم يتم العثور على الطلب'],
  '원외 · 처방전 교부': ['Outside pharmacy · issue prescription', '院外・処方箋交付', 'صيدلية خارجية · تسليم الوصفة'],

  // ── 검사(lab) 워크스테이션 ──
  '생화학': ['Biochemistry', '生化学', 'الكيمياء الحيوية'],
  '환자 추가': ['Add patient', '患者を追加', 'إضافة مريض'],
  '호출 중...': ['Calling...', '呼出中...', '...جارٍ النداء'],
  '환자 호출': ['Call patient', '患者呼出', 'نداء المريض'],
  '검사 시작': ['Start test', '検査開始', 'بدء الفحص'],
  '라벨': ['Label', 'ラベル', 'الملصق'],
  '템플릿 선택 (항목 자동채움)...': [
    'Select a template (auto-fill items)...',
    'テンプレート選択(項目自動入力)...',
    '...اختر قالبًا (تعبئة تلقائية للبنود)',
  ],
  '전체 정상': ['All normal', 'すべて正常', 'الكل طبيعي'],
  '템플릿으로 저장': ['Save as template', 'テンプレートとして保存', 'حفظ كقالب'],
  '비교할 이전 결과가 없습니다.': ['No previous result to compare.', '比較する以前の結果はありません。', 'لا توجد نتيجة سابقة للمقارنة.'],
  '단위': ['Unit', '単位', 'الوحدة'],
  '참고범위': ['Reference range', '基準範囲', 'النطاق المرجعي'],
  // 🔴 'Assessment' 였다 — 렌더되는 세 자리가 전부 **결과 등급/적합 여부**다:
  //    검사결과 입력표의 판정 열(workstation/lab 429 — 항목·결과값·단위·참고범위 옆),
  //    검진 결과 판정(NORMAL/ABNORMAL/CRITICAL), 급식 HACCP CCP 적합/부적합.
  //    'Assessment' 는 간호 사정·SOAP 의 A 를 가리키는 **다른 임상 어휘**라 이긴 정의가
  //    자기 화면에서도 틀렸다. admin3 의 '판정@지표'='Judgment' 와 철자를 맞춘다.
  '판정': ['Judgment', '判定', 'التقييم'],
  '검사항목명': ['Test item name', '検査項目名', 'اسم بند الفحص'],
  // '결과'=status Outcome(진료 결과)이 선점 — 여기는 **결과값 입력칸**이다
  '결과@입력': ['Result', '結果', 'النتيجة'],
  '경고 확인 후 저장': ['Save after acknowledging warning', '警告を確認して保存', 'الحفظ بعد الإقرار بالتحذير'],
  '결과 저장 + 완료': ['Save results + complete', '結果保存＋完了', 'حفظ النتائج + إكمال'],
  '예정 사전처방': ['Scheduled pre-orders', '予定の事前指示', 'الطلبات المسبقة المجدولة'],
  '(오늘~+2일 — 사전 준비용)': [
    '(today to +2 days — for advance preparation)',
    '(本日~+2日 — 事前準備用)',
    '(اليوم حتى +2 يوم — للتحضير المسبق)',
  ],
  '접수 시 자동': ['Auto on check-in', '受付時に自動', 'تلقائي عند التسجيل'],

  // ── 기초검사(diagnostic) 워크스테이션 ──
  '기초검사 워크스테이션': ['Diagnostic Tests Workstation', '基礎検査ワークステーション', 'محطة عمل الفحوص الأساسية'],
  '자리를 선택하세요': ['Select a station', '担当場所を選択してください', 'اختر موقع عمل'],
  '검사 의뢰 화면': ['Test order screen', '検査依頼画面', 'شاشة طلب الفحص'],
  '설정 닫기': ['Close settings', '設定を閉じる', 'إغلاق الإعدادات'],
  '자리 설정': ['Station settings', '場所の設定', 'إعدادات الموقع'],
  '이 자리에서 어떤 검사를 하는지 아직 설정되지 않았습니다.': [
    'It has not been set which tests this station performs.',
    'この場所でどの検査を行うかがまだ設定されていません。',
    'لم يُحدَّد بعد ما هي الفحوص التي يجريها هذا الموقع.',
  ],
  '대기 환자가 없는 것이 아니라, 무엇을 대기로 볼지 정해지지 않아 셀 수 없습니다.': [
    'It is not that there are no waiting patients — what counts as waiting has not been defined, so it cannot be counted.',
    '待機患者がいないのではなく、何を待機とみなすかが決まっていないため数えられません。',
    'ليس أنه لا يوجد مرضى منتظرون — بل لم يُحدَّد ما الذي يُعد انتظارًا، لذا لا يمكن العد.',
  ],
  '목표 소요시간 미설정 — 지연 판정 불가': [
    'Target turnaround not set — delay cannot be judged',
    '目標所要時間が未設定 — 遅延の判定不可',
    'لم يُحدَّد زمن الإنجاز المستهدف — يتعذر الحكم على التأخير',
  ],
  '검사값 이어쓰기': ['Continue entering values', '検査値を追記', 'متابعة إدخال القيم'],
  '검사값 등록': ['Enter test values', '検査値の登録', 'تسجيل قيم الفحص'],
  '이 자리에서 시행하는 검사': ['Tests performed at this station', 'この場所で実施する検査', 'الفحوص التي تُجرى في هذا الموقع'],
  '여기서 고른 검사만 이 자리의 대기 목록에 뜹니다. 고르지 않으면 대기 건수를 셀 수 없습니다(0 이 아닙니다).': [
    'Only the tests selected here appear in this station’s worklist. If none are selected the waiting count cannot be computed (it is not 0).',
    'ここで選んだ検査だけがこの場所の待機一覧に表示されます。選ばないと待機件数は算出できません(0 ではありません)。',
    'تظهر في قائمة انتظار هذا الموقع الفحوص المحددة هنا فقط. إذا لم يُحدَّد أي فحص فلا يمكن حساب عدد المنتظرين (وهو ليس صفرًا).',
  ],
  '자리 이름': ['Station name', '場所の名称', 'اسم الموقع'],
  '위치(층·구역)': ['Location (floor · zone)', '位置(階・区域)', 'الموقع (الطابق · المنطقة)'],
  '저장 중…': ['Saving…', '保存中…', '…جارٍ الحفظ'],
  '하나도 고르지 않으면 이 자리는 대기를 셀 수 없습니다.': [
    'If nothing is selected this station cannot count its waiting list.',
    '一つも選ばないとこの場所は待機を数えられません。',
    'إذا لم يتم اختيار أي شيء فلن يتمكن هذا الموقع من عد قائمة الانتظار.',
  ],
  '설정할 자리를 위에서 선택하세요.': ['Select the station to configure above.', '設定する場所を上で選択してください。', 'اختر الموقع المراد إعداده أعلاه.'],
  '새 자리 만들기': ['Create a station', '新しい場所を作成', 'إنشاء موقع جديد'],
  '새 자리': ['New station', '新しい場所', 'موقع جديد'],
  '자리 ID': ['Station ID', '場所ID', 'معرّف الموقع'],
  'diag- 로 시작 · 소문자·숫자·하이픈': [
    'Starts with diag- · lowercase, digits, hyphen',
    'diag- で始まる · 小文字・数字・ハイフン',
    'يبدأ بـ diag- · أحرف صغيرة وأرقام وشرطة',
  ],
  '담당 부서·진료과': ['Owning department', '担当部署・診療科', 'القسم المسؤول'],
  '만드는 중…': ['Creating…', '作成中…', '…جارٍ الإنشاء'],
  '자리 만들기': ['Create station', '場所を作成', 'إنشاء الموقع'],
  '설정 저장': ['Save settings', '設定を保存', 'حفظ الإعدادات'],
  '측정값': ['Measurements', '測定値', 'القياسات'],
  '소견 (Findings)': ['Findings', '所見 (Findings)', 'الموجودات (Findings)'],
  '판독 소견 (Impression)': ['Impression', '読影所見 (Impression)', 'الانطباع (Impression)'],
  // '결론' 은 다른 영역 카탈로그가 Impression 으로 선점 — 여기는 **기초검사 판독의 결론**이다
  '결론@판독': ['Conclusion', '結論', 'الخلاصة'],
  '판독을 마치려면 결론을 선택해야 합니다(기본값 없음).': [
    'A conclusion must be selected to finish the report (no default).',
    '読影を終えるには結論を選択する必要があります(既定値なし)。',
    'يجب اختيار خلاصة لإنهاء التقرير (لا قيمة افتراضية).',
  ],
  '검사값만 저장': ['Save values only', '検査値のみ保存', 'حفظ القيم فقط'],
  '판독까지 등록': ['Save values and report', '読影まで登録', 'تسجيل القيم والتقرير'],
  '담당': ['Performed by', '担当', 'نفّذه'],

  // ── 감염관리(infection-control) 워크스테이션 ──
  // 🔴 격리 등급은 국제 표준 표기(CDC transmission-based precautions)와 1:1 대응이라 등재한다.
  //    영어 화면에서 격리 등급만 한국어로 남으면 **PPE 판단이 불가능**해져 오히려 덜 안전하다.
  '감염관리 워크스테이션': ['Infection Control Workstation', '感染管理ワークステーション', 'محطة عمل مكافحة العدوى'],
  '감염 감시 · 격리 · 보고 · 8초 자동 갱신': [
    'Surveillance · isolation · reporting · auto-refresh every 8s',
    '感染監視・隔離・報告・8秒ごと自動更新',
    'الترصد · العزل · الإبلاغ · تحديث تلقائي كل 8 ثوانٍ',
  ],
  '조사/격리중': ['Investigating / isolated', '調査・隔離中', 'قيد التقصي / العزل'],
  '해당 상태의 업무가 없습니다': ['No tasks in this state', 'この状態の業務はありません', 'لا توجد مهام في هذه الحالة'],
  '병동/호실': ['Ward / room', '病棟・病室', 'الجناح / الغرفة'],
  '감염유형': ['Infection type', '感染種別', 'نوع العدوى'],
  '격리등급': ['Isolation level', '隔離レベル', 'مستوى العزل'],
  '접촉자': ['Contacts', '接触者', 'المخالطون'],
  '역학조사': ['Epidemiological investigation', '疫学調査', 'التقصي الوبائي'],
  '격리조치': ['Isolation measures', '隔離措置', 'إجراءات العزل'],
  '공기주의': ['Airborne precautions', '空気感染予防策', 'احتياطات العدوى المنقولة جوًا'],
  '비말주의': ['Droplet precautions', '飛沫感染予防策', 'احتياطات الرذاذ'],
  '접촉주의': ['Contact precautions', '接触感染予防策', 'احتياطات المخالطة'],
  '표준주의': ['Standard precautions', '標準予防策', 'الاحتياطات القياسية'],
  '검체채취': ['Specimen collection', '検体採取', 'جمع العينة'],
  '배양확인': ['Culture confirmed', '培養確認', 'تأكيد الزرع'],
  '격리지시': ['Isolation order', '隔離指示', 'أمر العزل'],
  '보호구착용': ['PPE donned', '防護具着用', 'ارتداء معدات الوقاية'],
  '접촉자목록': ['Contact list', '接触者リスト', 'قائمة المخالطين'],
  '보고완료': ['Reported', '報告完了', 'تم الإبلاغ'],
  '접촉자 추적': ['Contact tracing', '接触者追跡', 'تتبّع المخالطين'],
  '통보완료': ['Notified', '通知完了', 'تم الإخطار'],
  '대기중': ['Pending', '待機中', 'قيد الانتظار'],
  '감염관리 체크리스트': ['Infection control checklist', '感染管理チェックリスト', 'قائمة تحقق مكافحة العدوى'],
  '역학조사 접수': ['Receive investigation', '疫学調査を受付', 'استلام التقصي'],
  '격리 조치 시작': ['Start isolation measures', '隔離措置を開始', 'بدء إجراءات العزل'],
  '감염관리 완료 처리': ['Complete infection control', '感染管理を完了処理', 'إنهاء مكافحة العدوى'],
  '조사': ['Investigation', '調査', 'التقصي'],
  '체크리스트 확인 필요': ['Checklist confirmation needed', 'チェックリストの確認が必要', 'يلزم تأكيد قائمة التحقق'],

  // ── 동의서(consent) 워크스테이션 ──
  // 동음이의: '승인'=status Approved(승인된 상태)·'거부'=Refused·'회수'=Revoked·'해제'=Clear 가 선점 — 여기는 행위 버튼이다
  '승인@행위': ['Approve', '承認する', 'اعتماد'],
  '거부@행위': ['Reject', '拒否する', 'رفض'],
  '회수@행위': ['Recall', '回収する', 'سحب'],
  // '해제@기기' 는 다른 영역이 Unenroll 로 선점 — 여기는 **서명 태블릿 페어링 해제**다
  '해제@페어링': ['Unpair', '解除する', 'إلغاء الاقتران'],
  '동의서 워크스테이션': ['Consent Workstation', '同意書ワークステーション', 'محطة عمل الموافقات'],
  '환자·보호자에게 설명 후 태블릿/PC에서 서명받기': [
    'Explain to the patient/guardian, then collect a signature on a tablet or PC',
    '患者・保護者に説明のうえ、タブレット/PCで署名を受けます',
    'اشرح للمريض/الوصي ثم احصل على التوقيع عبر جهاز لوحي أو حاسوب',
  ],
  '동의서 요청': ['Request consent', '同意書を依頼', 'طلب موافقة'],
  '서명 기기': ['Signing devices', '署名機器', 'أجهزة التوقيع'],
  '승인대기': ['awaiting approval', '承認待ち', 'بانتظار الاعتماد'],
  '오늘 요청': ['Requested today', '本日の依頼', 'طُلبت اليوم'],
  '서명 대기': ['Awaiting signature', '署名待ち', 'بانتظار التوقيع'],
  '기기로 보내기': ['Send to device', '機器へ送信', 'الإرسال إلى الجهاز'],
  '링크 생성': ['Create link', 'リンクを生成', 'إنشاء رابط'],
  '담당 의사 로그인 후 서명': [
    'The attending physician must sign in to sign',
    '担当医がログインして署名してください',
    'يجب على الطبيب المعالج تسجيل الدخول للتوقيع',
  ],
  '간호사 사전 확인': ['Nurse pre-check', '看護師の事前確認', 'تحقق الممرض المسبق'],
  '동의서를 표시할 태블릿을 선택하세요. 선택 즉시 해당 화면에 나타납니다.': [
    'Choose the tablet that will display the consent form. It appears on that screen immediately.',
    '同意書を表示するタブレットを選択してください。選択すると直ちにその画面に表示されます。',
    'اختر الجهاز اللوحي الذي سيعرض نموذج الموافقة. سيظهر على تلك الشاشة فورًا.',
  ],
  '오프라인': ['Offline', 'オフライン', 'غير متصل'],
  '온라인': ['Online', 'オンライン', 'متصل'],
  '서명 받기': ['Collect signature', '署名を受ける', 'الحصول على التوقيع'],
  '태블릿에서 아래 링크를 열거나, 이 기기에서 바로 서명하세요. (5분 후 만료)': [
    'Open the link below on a tablet, or sign right here on this device. (Expires in 5 minutes)',
    'タブレットで下のリンクを開くか、この機器でそのまま署名してください。(5分後に失効)',
    'افتح الرابط أدناه على جهاز لوحي، أو وقّع من هذا الجهاز مباشرة. (تنتهي الصلاحية خلال 5 دقائق)',
  ],
  '이 기기에서 서명': ['Sign on this device', 'この機器で署名', 'التوقيع على هذا الجهاز'],
  '기기 등록 (QR)': ['Register device (QR)', '機器登録(QR)', 'تسجيل جهاز (QR)'],
  '기기 등록': ['Device registration', '機器登録', 'تسجيل الجهاز'],
  '등록 요청': ['Registration requested', '登録リクエスト', 'طلب تسجيل'],
  '등록된 기기': ['Registered devices', '登録済み機器', 'الأجهزة المسجّلة'],
  '인증코드가 만료되었습니다': ['The pairing code has expired', '認証コードの有効期限が切れました', 'انتهت صلاحية رمز الاقتران'],
  '새 코드 발급': ['Issue a new code', '新しいコードを発行', 'إصدار رمز جديد'],
  '남은 시간': ['Time left', '残り時間', 'الوقت المتبقي'],
  '인증코드 입력 시 자동 승인': ['Entering the code approves automatically', '認証コード入力で自動承認', 'إدخال الرمز يعتمد الجهاز تلقائيًا'],
  '블록체인 서명 기록': ['Blockchain signature log', 'ブロックチェーン署名記録', 'سجل التوقيع على البلوكشين'],
  '동의서 서명 이벤트가 SHA-256 해시로 내부 블록체인에 앵커링됩니다.': [
    'Consent signature events are anchored to the internal blockchain as SHA-256 hashes.',
    '同意書の署名イベントはSHA-256ハッシュとして内部ブロックチェーンにアンカリングされます。',
    'تُرسَّخ أحداث توقيع الموافقة على البلوكشين الداخلي كتجزئات SHA-256.',
  ],
  '문서 상태': ['Document status', '文書ステータス', 'حالة المستند'],
  '문서 해시': ['Document hash', '文書ハッシュ', 'تجزئة المستند'],
  '앵커 Tx': ['Anchor Tx', 'アンカーTx', 'معاملة الترسيخ'],
  '아직 서명 기록이 없습니다.': ['No signature record yet.', 'まだ署名記録がありません。', 'لا يوجد سجل توقيع بعد.'],
  '앵커 이력': ['Anchor history', 'アンカー履歴', 'سجل الترسيخ'],
  '앵커 없음': ['No anchors', 'アンカーなし', 'لا توجد عمليات ترسيخ'],
  '본인': ['Self', '本人', 'المريض نفسه'],
  '의사 사전 확인·서명': ['Physician pre-check · signature', '医師の事前確認・署名', 'تحقق الطبيب المسبق · التوقيع'],
  '환자/보호자 서명 대기': ['Awaiting patient/guardian signature', '患者・保護者の署名待ち', 'بانتظار توقيع المريض/الوصي'],
  '증인 서명 대기': ['Awaiting witness signature', '証人の署名待ち', 'بانتظار توقيع الشاهد'],
  '완료 처리 대기': ['Awaiting finalization', '完了処理待ち', 'بانتظار الإنهاء'],
  '환자명/MRN 검색 (2자 이상)': ['Search by name / MRN (2+ characters)', '患者名・MRN検索(2文字以上)', 'ابحث بالاسم / MRN (حرفان أو أكثر)'],
  '시술/수술명 (예: 심장 스텐트 삽입술)': [
    'Procedure / surgery name (e.g. cardiac stent insertion)',
    '処置・手術名(例: 心臓ステント挿入術)',
    'اسم الإجراء / الجراحة (مثل: تركيب دعامة قلبية)',
  ],
  '위험·합병증 (선택)': ['Risks and complications (optional)', 'リスク・合併症(任意)', 'المخاطر والمضاعفات (اختياري)'],
  '대체 치료법 (선택)': ['Alternative treatments (optional)', '代替治療法(任意)', 'العلاجات البديلة (اختياري)'],
  '설명 요지 (구두 설명 내용)': ['Summary of the explanation given verbally', '説明の要旨(口頭説明の内容)', 'ملخص الشرح الشفهي'],
  '담당 의사 선택': ['Select attending physician', '担当医を選択', 'اختر الطبيب المعالج'],
  '담당 간호사 선택(선택)': ['Select nurse (optional)', '担当看護師を選択(任意)', 'اختر الممرض (اختياري)'],
  '템플릿 선택(선택)': ['Select template (optional)', 'テンプレート選択(任意)', 'اختر قالبًا (اختياري)'],
  '서명 진행 중': ['Signing in progress', '署名進行中', 'التوقيع جارٍ'],
  '서명 중': ['Signing', '署名中', 'قيد التوقيع'],
  '대기 중': ['Idle', '待機中', 'خامل'],

  // ── 동의서 워크스테이션 · 진료 녹음(RECORDING) 접수(2026-09-22 D4) ──
  '법무 검토 전 초안': ['Draft pending legal review', '法務レビュー前の下書き', 'مسودة بانتظار المراجعة القانونية'],
  '진료 녹음 동의서 문안은 법무 검토 전 초안(2026-07-07)입니다. 설명 요지에 초안이 채워지며, [ ] 항목은 기관이 확정하기 전까지 비어 있습니다. 확정 문안이 아닙니다.': ['The encounter-recording consent wording is a draft pending legal review (2026-07-07). It is prefilled into the explanation field; items in [ ] stay empty until the institution decides them. This is not the final wording.', '診療録音同意書の文案は法務レビュー前の下書き（2026-07-07）です。説明要旨に下書きが入り、[ ] 項目は機関が確定するまで空欄です。確定文案ではありません。', 'صيغة موافقة تسجيل الزيارة مسودة بانتظار المراجعة القانونية (2026-07-07). تُعبَّأ في حقل ملخص الشرح، وتبقى العناصر بين [ ] فارغة حتى تقررها المؤسسة. هذه ليست الصيغة النهائية.'],
  '미확정 항목': ['Undecided items', '未確定項目', 'عناصر غير محددة'],
  '진료 녹음 동의서 문안은 자동 생성하지 않습니다(법무 초안 사용)': ['Encounter-recording consent wording is not auto-generated (legal draft is used)', '診療録音同意書の文案は自動生成しません（法務下書きを使用）', 'لا تُولَّد صيغة موافقة تسجيل الزيارة تلقائيًا (تُستخدم المسودة القانونية)'],
  '초안 다시 채우기': ['Refill the draft', '下書きを再入力', 'إعادة تعبئة المسودة'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const WS2_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위(§6-3). 임상 검수 전에는 아무 키도 올리지 않는다. */
export const WS2_VERIFIED: ReadonlySet<string> = new Set();
