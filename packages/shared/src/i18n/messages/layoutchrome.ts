import type { MessageCatalog } from '../t';

/**
 * P3 영역 카탈로그(layoutchrome) — **레이아웃·전역 크롬**.
 * 소유 렌더 지점: `apps/web/src/components/layout/**`(Sidebar 푸터·TopBar·ManualLink·EduLauncher·
 * ErpLauncher·ScreenJump·SmartSearchBar·WorkstationBadge·TermLangToggle·UiLocaleSelect) ·
 * `apps/web/src/app/(main)/layout.tsx` · `apps/web/src/lib/his-mode.tsx`(운영 모드 칩·띠 — 레이아웃 전용 렌더).
 *
 * 🔴 **왜 이 카탈로그가 생겼는가**: 화면 본문은 영어로 나오는데 **그것을 감싸는 틀이 한국어**였다
 *    (2026-09-09 사람 스크린샷 실측 — English 로 두고 찍었는데 상단 바 검색 placeholder·운영 모드 배지·
 *    화면 언어 라벨·역할 배지·사이드바 푸터가 전부 한국어). 화면 배선 238/449 는 **본문 축**이고
 *    크롬은 그 축이 아니었다.
 *
 * 키=한국어 원문(동음이의는 `원문@문맥`)·세 언어 키 집합 동일(TABLE 하나에서 파생)·**전량 AI_DRAFT**
 * (`LAYOUTCHROME_VERIFIED` 는 빈 집합 — 렌더 부품이 초안 티 `data-i18n-draft` 를 단다).
 *
 * 🔴 **무엇을 왜 등재하지 않았는지**(의도적 미등재 — 사실만 적는다)
 *
 * 1) **중복 회피로 등재하지 않았다 — 31키.** `AREA_CATALOGS` 등록 순서상 앞 카탈로그가 이기므로
 *    여기 사본을 두면 **죽은 정의**가 된다. 배선 전에 빌드된 shared 로 `tOf(key,'en')` 를 실행해
 *    가려냈다(수기 대조가 아니다 — 형제 갈래들이 그 대조를 건너뛰어 죽은 키를 만든 적이 있다).
 *    이미 다른 영역이 갖고 있던 원문:
 *    `관리자`·`의사`·`간호사`·`약사`·`검사실`·`급양`·`행정직`·`의무기록사`·`원무`·`경영진`·`검진센터`
 *    (TopBar 역할 배지 11종) · `급여 기초정보`·`내 행정(ESS)`(개인 메뉴) · `접기`·`펼치기`·`안내`·`열기`
 *    (사이드바) · `즐겨찾기`·`화면번호`(ScreenJump) · `검색 결과가 없습니다.`·`환자`·`약품`·`진단`
 *    (통합 검색) · `자동`·`미선택`·`현재`(워크스테이션 배지) · `다시 시도`·`닫기`(레이아웃) ·
 *    `개발`·`리허설`(운영 모드) · `화면 언어`(로케일 셀렉트).
 *
 * 2) **nav 축 어휘라 등재하지 않았다 — 사이드바 소분류(group) 라벨.** `진료·원무`·`진단·약제`·
 *    `동의·기록`·`코드·마스터`·`임상 규칙·템플릿`·`권한·보안` 같은 소분류 헤더는 **nav 데이터**이고
 *    정본은 `messages/nav.ts` 다. 여기 사본을 두면 같은 사실에 정본이 둘이 된다(P12).
 *    렌더 지점은 `<T>` 를 지나게 **배선만** 했다 — nav 에 없는 소분류는 화면에 원문+`EN×` 티로 뜬다.
 *    미번역이라는 사실이 보이는 쪽이 정직하고, nav 담당이 그 구멍을 볼 수 있다.
 *
 * 3) **기관 고유명이라 등재하지 않았다.** 사이드바 로고의 `위루비병원`(+`WERUBYHOSP`)은 기관
 *    이름이지 UI 어휘가 아니다(dashboard.ts 선례). 번역하면 존재하지 않는 병원 이름이 생긴다.
 *
 * 4) **`${AI_ORIGIN_TEXT}` 조합이라 등재하지 않았다.** `${AI_ORIGIN_TEXT} 어시스턴트 열기`(사이드바
 *    로고 버튼) · `${AI_ORIGIN_TEXT} 어시스턴트에게 묻기:`(옴니박스) — 브랜드 표기가 런타임 상수라
 *    키가 성립하지 않는다(AI 표기 병기 규약 — shared `AI_ORIGIN_TEXT`).
 *
 * 5) **동적 문자열이라 등재하지 않았다.** 숫자·경로·조사(이(가)/을(를))가 섞여 키가 성립하지 않는 자리:
 *    ScreenJump 의 `화면번호 ${target}이(가) …개 화면에 중복 지정되어 있어 …` ·
 *    `화면번호 ${target}을(를) 찾을 수 없습니다.` · `'${entry.label}' 화면 접근 권한이 없습니다.` ·
 *    WorkstationBadge 의 `이 컴퓨터는 ${ws.label}(으)로 지정돼 있습니다…` ·
 *    SmartSearchBar 의 환자·약품·수가 부제(`${p.mrn} · ${p.phone}` 등 서버 값) ·
 *    `${p.unitPrice}원`(통화 표기는 `NUMERIC_POLICIES` 잠금 도메인 — 이 축이 건드리지 않는다).
 *
 * 6) **문장이 마크업으로 쪼개져 있어 등재하지 않았다 — 2문장.** WorkstationBadge 의
 *    `검사실·처치실처럼 <b>장소</b>를 고릅니다. 고르면 <b>검체 라벨·팔찌 인쇄가 그 자리 프린터로</b> 나갑니다.`
 *    와 `선택은 <b>이 브라우저에만</b> 저장됩니다. 다른 컴퓨터에서는 다시 골라야 합니다.` 는
 *    `<b>` 로 조각나 있어 조각마다 키를 만들면 **다른 언어에서 어순이 깨진다**(한국어 어순 그대로
 *    영어 조각을 이어 붙이면 문장이 아니다). 강조를 지워 한 키로 만드는 것은 이 갈래가 단독으로
 *    정할 UX 변경이 아니라고 판단해 **배선하지 않고 남겼다** — 미배선은 목록에 남아 보인다.
 *
 * 7) **개발자용 콘솔 로그라 등재하지 않았다.** Sidebar 의 `[screen-codes] 🔴 중복 화면번호…` 2건은
 *    `console.warn` 이고 화면에 렌더되지 않는다.
 *
 * 8) **부서·진료과 이름은 이 축이 아니다.** `DEPT_TO_SPECIALTY_PATH`·`DEFAULT_DEPT_ACCESS` 의
 *    `내과`·`검사실(채혈)` 등은 **DB 부서명과 대조하는 비교값**이지 표시 문구가 아니다.
 *    번역하면 매칭이 깨진다(표시보다 저장·비교가 더 위험하다).
 *
 * 🔴 등재는 했으나 **오역이 뜻을 뒤집을 수 있어 사람 검수 대상**인 키는 아래 표에 `SAFETY` 로 표시했다.
 *    특히 운영 모드 배지(`시드 데이터 · 대외 발신 차단`)는 **안전 문구**다 — "차단(blocked)"이
 *    "제한(limited)"으로 약해지면 리허설 중 실제 발신이 나간다고 읽힐 수 있다. AI 초안 상태이며
 *    검수 전까지 화면에 초안 티가 붙는다.
 */

/** [en, ja, ar] — 키 집합 3언어 동일을 튜플로 강제한다 */
const TABLE: Record<string, readonly [string, string, string]> = {
  // ── TopBar ────────────────────────────────────────────────────────────────
  '환자, 약품, 진단코드, 화면 통합 검색...': ['Search patients, medications, diagnosis codes, screens...', '患者・薬品・診断コード・画面を統合検索...', 'بحث موحّد في المرضى والأدوية ورموز التشخيص والشاشات...'],
  '환자, 약품, 진단코드, 화면 통합 검색 열기': ['Open unified search for patients, medications, diagnosis codes and screens', '患者・薬品・診断コード・画面の統合検索を開く', 'فتح البحث الموحّد للمرضى والأدوية ورموز التشخيص والشاشات'],
  '통합 검색 열기': ['Open unified search', '統合検索を開く', 'فتح البحث الموحّد'],
  '사이드바 메뉴 열기': ['Open sidebar menu', 'サイドバーメニューを開く', 'فتح قائمة الشريط الجانبي'],
  '새창 전체 화면 보기': ['Open full screen in a new window', '新しいウィンドウで全画面表示', 'فتح ملء الشاشة في نافذة جديدة'],
  '개인 메뉴': ['Personal menu', '個人メニュー', 'القائمة الشخصية'],
  '로그아웃': ['Log out', 'ログアウト', 'تسجيل الخروج'],

  // ── Sidebar (푸터·상태 배너·접근성 라벨) ──────────────────────────────────
  '주 내비게이션': ['Main navigation', 'メインナビゲーション', 'التنقل الرئيسي'],
  '사이드바 메뉴': ['Sidebar menu', 'サイドバーメニュー', 'قائمة الشريط الجانبي'],
  '메뉴 닫기': ['Close menu', 'メニューを閉じる', 'إغلاق القائمة'],
  '메뉴 설정을 불러오지 못해 마지막으로 받은 설정으로 표시 중입니다.': ['Menu settings could not be loaded — showing the last settings received.', 'メニュー設定を読み込めなかったため、最後に受信した設定で表示しています。', 'تعذّر تحميل إعدادات القائمة — يتم العرض بآخر إعدادات مستلَمة.'],
  '메뉴 설정을 불러오지 못했습니다 — 관리자 숨김·순서가 반영되지 않은 기본 메뉴입니다.': ['Menu settings could not be loaded — this is the default menu, without the administrator’s hidden items and ordering.', 'メニュー設定を読み込めませんでした — 管理者の非表示・並び順が反映されていない既定メニューです。', 'تعذّر تحميل إعدادات القائمة — هذه هي القائمة الافتراضية دون عناصر المسؤول المخفية وترتيبه.'],

  // ── ManualLink (역할별 사용 매뉴얼) ────────────────────────────────────────
  '의사 진료 매뉴얼': ['Physician Clinical Manual', '医師 診療マニュアル', 'دليل الطبيب السريري'],
  '간호 매뉴얼': ['Nursing Manual', '看護マニュアル', 'دليل التمريض'],
  '진료지원 매뉴얼': ['Clinical Support Manual', '診療支援マニュアル', 'دليل الدعم السريري'],
  '원무 업무 매뉴얼': ['Front Desk Operations Manual', '医事業務マニュアル', 'دليل عمليات الاستقبال'],
  '급양·영양 매뉴얼': ['Food Service & Nutrition Manual', '給食・栄養マニュアル', 'دليل خدمات الطعام والتغذية'],
  '총무·자재 매뉴얼': ['General Affairs & Supplies Manual', '総務・資材マニュアル', 'دليل الشؤون العامة والمستلزمات'],
  '의무기록 매뉴얼': ['Medical Records Manual', '診療記録マニュアル', 'دليل السجلات الطبية'],
  '건강검진 매뉴얼': ['Health Checkup Manual', '健康診断マニュアル', 'دليل الفحص الصحي'],
  '사용 매뉴얼': ['User Manual', '利用マニュアル', 'دليل الاستخدام'],

  // ── EduLauncher / ErpLauncher ─────────────────────────────────────────────
  '사내교육': ['Staff Training', '社内教育', 'التدريب الداخلي'],
  '사내교육 (SSO 자동 로그인)': ['Staff Training (SSO auto sign-in)', '社内教育（SSO自動ログイン）', 'التدريب الداخلي (تسجيل دخول تلقائي عبر SSO)'],
  'ERP (SSO 자동 로그인)': ['ERP (SSO auto sign-in)', 'ERP（SSO自動ログイン）', 'ERP (تسجيل دخول تلقائي عبر SSO)'],
  '로그인 정보가 없어 ERP 로 이동할 수 없습니다. 다시 로그인해 주세요.': ['There is no sign-in credential, so ERP cannot be opened. Please sign in again.', 'ログイン情報がないためERPへ移動できません。再度ログインしてください。', 'لا توجد بيانات تسجيل دخول، لذا تعذّر فتح ERP. يُرجى تسجيل الدخول مجددًا.'],
  '팝업이 차단되어 이 탭에서 ERP 를 엽니다.': ['Pop-ups are blocked, so ERP will open in this tab.', 'ポップアップがブロックされているため、このタブでERPを開きます。', 'النوافذ المنبثقة محظورة، لذا سيُفتح ERP في هذه التبويبة.'],
  'ERP 연결에 실패했습니다(인증 쿠키 발급 실패).': ['Connecting to ERP failed (the authentication cookie could not be issued).', 'ERPへの接続に失敗しました（認証クッキーの発行失敗）。', 'فشل الاتصال بـ ERP (تعذّر إصدار ملف تعريف ارتباط المصادقة).'],
  'ERP 연결에 실패했습니다(인증 토큰 발급 실패).': ['Connecting to ERP failed (the handoff token could not be issued).', 'ERPへの接続に失敗しました（連携トークンの発行失敗）。', 'فشل الاتصال بـ ERP (تعذّر إصدار رمز التسليم).'],
  '팝업이 차단되어 ERP 를 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.': ['Pop-ups are blocked, so ERP could not be opened. Please allow pop-ups for this site.', 'ポップアップがブロックされているためERPを開けませんでした。このサイトのポップアップを許可してください。', 'النوافذ المنبثقة محظورة، لذا تعذّر فتح ERP. يُرجى السماح بالنوافذ المنبثقة لهذا الموقع.'],

  // ── ScreenJump (화면번호 이동) ────────────────────────────────────────────
  '일치하는 화면이 없습니다': ['No matching screen', '一致する画面がありません', 'لا توجد شاشة مطابقة'],
  '최근 이동': ['Recently visited', '最近の移動', 'الانتقالات الأخيرة'],
  '화면번호로 이동': ['Go to screen number', '画面番号へ移動', 'الانتقال إلى رقم الشاشة'],
  '화면번호 단축키': ['Screen-number shortcut', '画面番号ショートカット', 'اختصار رقم الشاشة'],
  '화면번호 단축키 지정 (클릭 후 원하는 키 입력)': ['Set the screen-number shortcut (click, then press the key you want)', '画面番号ショートカットの設定（クリック後、希望のキーを押す）', 'تعيين اختصار رقم الشاشة (انقر ثم اضغط المفتاح المطلوب)'],
  '해당 키는 단축키로 사용할 수 없습니다.': ['That key cannot be used as a shortcut.', 'そのキーはショートカットとして使用できません。', 'لا يمكن استخدام هذا المفتاح كاختصار.'],
  '수정자 키(Cmd/Ctrl/Alt) 조합은 화면번호 단축키로 쓸 수 없습니다.': ['Modifier-key (Cmd/Ctrl/Alt) combinations cannot be used as a screen-number shortcut.', '修飾キー（Cmd/Ctrl/Alt）の組み合わせは画面番号ショートカットに使用できません。', 'لا يمكن استخدام تركيبات مفاتيح التعديل (Cmd/Ctrl/Alt) كاختصار لرقم الشاشة.'],
  '키 입력…': ['Press a key…', 'キー入力…', 'اضغط مفتاحًا…'],

  // ── SmartSearchBar (Cmd+K 통합 검색) ─────────────────────────────────────
  '환자, 약품, 진단코드, 화면명·번호 검색...': ['Search patients, medications, diagnosis codes, screen names/numbers...', '患者・薬品・診断コード・画面名/番号を検索...', 'ابحث في المرضى والأدوية ورموز التشخيص وأسماء/أرقام الشاشات...'],
  '2자 이상 입력하면 환자, 약품, 진단코드를 통합 검색합니다.': ['Enter 2 or more characters to search patients, medications and diagnosis codes together.', '2文字以上入力すると患者・薬品・診断コードを統合検索します。', 'أدخل حرفين أو أكثر للبحث الموحّد في المرضى والأدوية ورموز التشخيص.'],
  '로 언제든 열 수 있습니다': ['opens it at any time', 'でいつでも開けます', 'يفتحه في أي وقت'],
  '화면': ['Screen', '画面', 'شاشة'],
  '수가': ['Fee schedule', '診療報酬', 'جدول الرسوم'],

  // ── WorkstationBadge (이 컴퓨터가 놓인 자리 — 인쇄 대상) ──────────────────
  '워크스테이션 선택': ['Select workstation', 'ワークステーションを選択', 'اختيار محطة العمل'],
  '이 컴퓨터가 놓인 자리': ['Where this computer is located', 'このコンピューターが置かれている場所', 'موقع هذا الحاسوب'],
  '등록된 단말이라 자동으로 정해졌습니다': ['set automatically because this is a registered terminal', '登録端末のため自動的に決まりました', 'تم التعيين تلقائيًا لأن هذا جهاز مسجَّل'],
  '인쇄 대상:': ['Prints to:', '印刷先:', 'الطباعة إلى:'],
  '이 자리에 등록된 프린터가 없습니다 — 인쇄는 파일로 내려받게 됩니다': ['No printer is registered at this location — printing will be downloaded as a file', 'この場所に登録されたプリンターがありません — 印刷はファイルとしてダウンロードされます', 'لا توجد طابعة مسجَّلة في هذا الموقع — ستُنزَّل المطبوعات كملف'],
  '등록된 자리가 없습니다 — 전산실에 문의하세요': ['No locations are registered — please contact the IT department', '登録された場所がありません — 情報システム室にお問い合わせください', 'لا توجد مواقع مسجَّلة — يُرجى التواصل مع قسم تقنية المعلومات'],
  '찾는 자리가 없습니다': ['No matching location', '該当する場所がありません', 'لا يوجد موقع مطابق'],
  '자리 이름·부서로 찾기 (예: 내시경, 영상의학과)': ['Find by location name or department (e.g. Endoscopy, Radiology)', '場所名・部署で検索（例: 内視鏡、放射線科）', 'ابحث باسم الموقع أو القسم (مثل: التنظير، الأشعة)'],
  '선택 해제': ['Clear selection', '選択を解除', 'إلغاء التحديد'],
  // SAFETY — 인쇄가 어디로도 나가지 않는다는 사실을 약하게 말하면 검체 라벨이 없는 채로 채혈이 진행된다
  '이 컴퓨터가 병원 어느 자리인지 아직 정하지 않았습니다 — 검체 라벨·팔찌 인쇄가 이 자리 프린터로 나가지 않습니다': ['This computer has not been assigned a location in the hospital yet — specimen label and wristband printing will not go to a printer at this location', 'このコンピューターが院内のどの場所かまだ設定されていません — 検体ラベル・リストバンドの印刷がこの場所のプリンターに出力されません', 'لم يُحدَّد بعد موقع هذا الحاسوب داخل المستشفى — لن تُطبع ملصقات العينات وأساور المعصم على طابعة هذا الموقع'],

  // ── (main)/layout.tsx (인증 확인·초점 모드 셸) ────────────────────────────
  '로그인 상태를 확인하지 못하고 있습니다.': ['Sign-in status cannot be confirmed.', 'ログイン状態を確認できていません。', 'تعذّر تأكيد حالة تسجيل الدخول.'],
  '네트워크 또는 서버 응답을 기다리는 중입니다. 계속 이 화면이면 아래에서 다시 시도하세요.': ['Waiting for the network or the server response. If this screen persists, try again below.', 'ネットワークまたはサーバー応答を待っています。この画面が続く場合は下から再試行してください。', 'في انتظار الشبكة أو استجابة الخادم. إذا استمرت هذه الشاشة، أعد المحاولة أدناه.'],
  '로그인 화면': ['Sign-in screen', 'ログイン画面', 'شاشة تسجيل الدخول'],
  '전체 화면 보기': ['Full screen view', '全画面表示', 'عرض ملء الشاشة'],
  '사이드바 표시': ['Show sidebar', 'サイドバーを表示', 'إظهار الشريط الجانبي'],

  // ── 운영 모드 칩·띠 (lib/his-mode.tsx) ───────────────────────────────────
  // 🔴 SAFETY — 전부 사람 검수 대상. "차단(blocked)"을 "제한"으로 약하게 옮기면
  //    리허설 중 실제 문자·메일이 환자에게 나갈 수 있다고 읽히지 않는다.
  '시드 데이터 · 대외 발신 차단': ['Seed data · Outbound sending blocked', 'シードデータ・対外送信ブロック', 'بيانات أولية · الإرسال الخارجي محظور'], // SAFETY
  '개발 모드 — 시드(가상) 데이터입니다. 실환자 기록이 아니며 대외 발신은 나가지 않습니다.': ['Development mode — this is seed (fictional) data. It is not real patient records, and no outbound sending goes out.', '開発モード — シード（仮想）データです。実患者の記録ではなく、対外送信は行われません。', 'وضع التطوير — هذه بيانات أولية (افتراضية). ليست سجلات مرضى حقيقيين، ولا يخرج أي إرسال خارجي.'], // SAFETY
  '리허설 모드 — 실환자 데이터가 아닙니다. 문자·메일·기관 전송은 실제로 나가지 않습니다.': ['Rehearsal mode — this is not real patient data. SMS, e-mail and agency transmissions do not actually go out.', 'リハーサルモード — 実患者データではありません。SMS・メール・機関送信は実際には送出されません。', 'وضع التجربة — هذه ليست بيانات مرضى حقيقيين. لا تُرسَل فعليًا الرسائل النصية والبريد الإلكتروني وإرساليات الجهات.'], // SAFETY
  '서버 미확인': ['server unconfirmed', 'サーバー未確認', 'الخادم غير مؤكَّد'],
  '확인불가': ['cannot confirm', '確認不可', 'تعذّر التأكيد'], // 🔴 '산출 불가'/'확인 불가' 는 정직성 어휘다 — 'unavailable' 로 흐리지 않는다
  '서버 설정을 확인하지 못해 배포 시 모드로 표시 중': ['the server setting could not be checked, so the mode from deployment is shown', 'サーバー設定を確認できず、デプロイ時のモードで表示中', 'تعذّر التحقق من إعداد الخادم، لذا يُعرض وضع النشر'],

  // ── 언어 토글 2종 (축이 다르다: 화면 언어 vs 의료용어) ────────────────────
  '의료코드': ['Medical codes', '医療コード', 'الرموز الطبية'],
  '의료용어 표시 언어': ['Medical terminology display language', '医療用語の表示言語', 'لغة عرض المصطلحات الطبية'],
  '의료용어(진단명·약품명·검사 항목명) 표시 언어 — 표시만 바뀝니다(저장·검색·인쇄 불변)': ['Display language for medical terminology (diagnosis, drug and test names) — display only changes (stored data, search and printing are unchanged)', '医療用語（診断名・薬品名・検査項目名）の表示言語 — 表示のみが変わります（保存・検索・印刷は不変）', 'لغة عرض المصطلحات الطبية (أسماء التشخيصات والأدوية والفحوصات) — يتغير العرض فقط (البيانات المحفوظة والبحث والطباعة دون تغيير)'],
  '한글': ['Korean', '韓国語', 'الكورية'],
  '병기': ['Both', '併記', 'كلاهما'],
  '의료용어를 한글로 표시합니다(영문명만 있으면 영문 그대로).': ['Shows medical terms in Korean (if only an English name exists, the English is shown as is).', '医療用語を韓国語で表示します（英語名のみの場合は英語のまま）。', 'يعرض المصطلحات الطبية بالكورية (إذا وُجد الاسم الإنجليزي فقط، يُعرض الإنجليزي كما هو).'],
  '의료용어를 영문으로 표시합니다. 영문명이 없는 항목은 한글 그대로 + 미등록 표시 — 번역을 지어내지 않습니다.': ['Shows medical terms in English. Items with no English name stay in Korean with a "not registered" mark — no translation is invented.', '医療用語を英語で表示します。英語名のない項目は韓国語のまま＋未登録表示 — 翻訳を作り出しません。', 'يعرض المصطلحات الطبية بالإنجليزية. تبقى العناصر بلا اسم إنجليزي بالكورية مع علامة «غير مسجَّل» — لا تُختلق ترجمة.'],
  '한글 (영문) 병기로 표시합니다.': ['Shows Korean with the English in parentheses.', '韓国語（英語）併記で表示します。', 'يعرض الكورية مع الإنجليزية بين قوسين.'],
  '번역': ['Translated', '翻訳済み', 'مترجَم'],
  '화면 언어 (선택지에 번역 문구 수 / 화면 전체 문구 수를 병기)': ['Display language (each option shows translated strings / total strings in the UI)', '画面言語（選択肢に「翻訳済み文言数 / 画面全体の文言数」を併記）', 'لغة العرض (يعرض كل خيار عدد النصوص المترجمة / إجمالي نصوص الواجهة)'],
  // 🔴 아래 4문장은 로케일 셀렉트의 **자기 설명**이다 — 이것 자체가 AI 초안이므로 사람 검수 우선순위가 높다.
  //    (등재하지 않으면 영어 화면에 한국어 툴팁이 남는다 — 그래서 등재했다.)
  '화면 언어 — 메뉴·버튼·라벨의 표시 언어입니다(기록·인쇄 불변).': ['Display language — the language of menus, buttons and labels (records and printing are unchanged).', '画面言語 — メニュー・ボタン・ラベルの表示言語です（記録・印刷は不変）。', 'لغة العرض — لغة القوائم والأزرار والتسميات (السجلات والطباعة دون تغيير).'],
  '목록의 숫자는 「이 언어에 번역된 문구 / 화면 전체 문구」입니다.': ['The numbers in the list are "strings translated into this language / all strings in the UI".', 'リストの数字は「この言語に翻訳された文言数 / 画面全体の文言数」です。', 'الأرقام في القائمة هي «النصوص المترجمة إلى هذه اللغة / إجمالي نصوص الواجهة».'],
  '번역이 없는 문구는 한국어 원문에 미번역 표시가 붙어 나옵니다.': ['Strings with no translation appear as the Korean original with an untranslated mark.', '翻訳のない文言は韓国語原文に未翻訳表示が付いて出ます。', 'تظهر النصوص غير المترجمة بالنص الكوري الأصلي مع علامة «غير مترجم».'],
  '등재된 번역은 전량 AI 초안이며 사람 검수를 거치지 않았습니다.': ['All registered translations are AI drafts and have not been reviewed by a person.', '登録された翻訳はすべてAI下書きであり、人の検収を経ていません。', 'جميع الترجمات المسجَّلة مسودات من الذكاء الاصطناعي ولم تُراجَع بشريًا.'],
  // 비밀번호 변경 필요 배너(PasswordStatusBanner — (main)/layout 전용 렌더 지점 · 2026-09-14)
  '비밀번호 변경이 필요합니다 — 최초 설정 전이거나 변경 후 {일수}일이 지났습니다.': ['Password change required — it has not been set yet, or {일수} days have passed since the last change.', 'パスワードの変更が必要です — 初回設定前か、変更から{일수}日が経過しています。', 'يلزم تغيير كلمة المرور — لم تُعيَّن بعد، أو مرّ {일수} يومًا منذ آخر تغيير.'],
  '비밀번호 변경이 필요합니다 — 최초 설정 전이거나 변경 기한이 지났습니다.': ['Password change required — it has not been set yet, or the change period has passed.', 'パスワードの変更が必要です — 初回設定前か、変更期限が過ぎています。', 'يلزم تغيير كلمة المرور — لم تُعيَّن بعد، أو انقضت مدة التغيير.'],
  // 좁은 화면 자동 축소(사이드바 아이콘 레일·상단 도구 접기 · 2026-09-29)
  '메뉴 접기(아이콘으로)': ['Collapse menu (icons only)', 'メニューを折りたたむ（アイコン表示）', 'طيّ القائمة (أيقونات فقط)'],
  '메뉴 펼치기': ['Expand menu', 'メニューを展開', 'توسيع القائمة'],
  '화면 도구(언어·의료코드·화면번호)': ['Screen tools (language, medical codes, screen number)', '画面ツール（言語・医療コード・画面番号）', 'أدوات الشاشة (اللغة، الرموز الطبية، رقم الشاشة)'],
};

export const LAYOUTCHROME_MESSAGES: MessageCatalog = {
  en: Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v[0]])),
  ja: Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v[1]])),
  ar: Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [k, v[2]])),
};

/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위(사람 검수 후에만 키를 추가한다) */
export const LAYOUTCHROME_VERIFIED: ReadonlySet<string> = new Set<string>();
