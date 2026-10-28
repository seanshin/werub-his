import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그(servermsg) — **서버가 조립하던 표시 문장**을 `{ k, params }`(shared `ServerMessage`)로 옮긴 키. 2026-09-15 I1.
 * 키=한국어 원문 문장(자리표시자 `{이름}`) · 튜플 [en, ja, ar] · 세 언어 키 집합·자리표시자 동일 · 전량 AI_DRAFT.
 * 설계 `docs/01-plan/features/server-display-text-i18n.plan.md` · 렌더 `apps/web/src/components/ui/server-text.tsx`.
 *
 * 배치 1 — `go-live.service.ts`(관리 `/admin/go-live` 의 항목 사유 `detailMsg`·준비율 근거 `basisMsg`).
 * 배치 2(I2) — `opening.service.ts`(`/admin/opening` 파생 사유 `derived.detailMsg`·주기 라벨 `periodLabelMsg` · 집행 라벨 조각
 *    `결정·반영됨` 등은 결정 정본 `DecisionService.enactmentStatusOf` 의 `label`) · `code-master/*`(`/admin/codes` 고시 반영 미리보기·
 *    분류 유도·중복·내보내기 `notesMsg`·행 `errorMsg`/`changesMsg`·분류 `noteMsg`·동의어 승인 `warningMsg`·자동 매핑 `reasonMsg`).
 * 배치 3(I3) — `record-timeline/record-insights.ts`(환자 기록 '의미찾기' `titleMsg`·`hintMsg`·`noteMsg`·항목 `labelMsg`/`detailMsg`).
 * 예외 배치(I4) — 예외 응답 `error.msg`(`common/msg-exception.ts`): opening 9 · diagnostic-test 10 · 전역 쿼리 파이프 6(화면 `ApiError.msg`).
 * 예외 배치(D-27 · 2026-09-21) — `telehealth/telehealth-recordings.service.ts`(녹화 서버 프록시 503/502 · 4키).
 * 🔴 키는 서버 코드의 `serverMsg('…')` 첫 인자와 **글자 하나까지 같아야** 한다 — 가드
 *    `apps/api/test/architecture/server-message-go-live.spec.ts`(고아·죽은 키 — 전 배치 합집합)·`server-message-batch2.spec.ts` 가
 *    서버 소스에서 뽑아 대조한다.
 *
 * ── 의도적 미등재 ──────────────────────────────────────────────────────────────
 * ① 한글 없는 키 `{key}={value}`·`{head} · {tail}`(opening 사유 조각 잇기) — 번역 대상이 아니다(`<Tf>` 가 티 없이 그린다). 🔴 자리 이름에 한글을 쓰면 `<Tf>` 가
 *    한글 키로 보고 EN× 를 단다 — 한글 없는 문장은 자리 이름도 ASCII 로.
 * ② 낱말 조각 `미설정`·`의원`·`병원`·`종합병원`·`상급종합병원`·`미결`(집행 라벨) — 먼저 등록된 카탈로그에 있다.
 * ③ 자리 값(설정 키·코드·경로·오류 메시지) — 데이터다.
 *
 * ── 🧑 사람 검수 대상 ────────────────────────────────────────────────────────────
 * `요양기관 종별이 설정되지 않았습니다 …`(청구 종별 — 오역이면 "의원으로 청구된다"는 경고가 흐려진다) ·
 * `빌드 상한이 {빌드} 다 …`(화면 토글로는 사라지지 않는다는 한계 고지) · 준비율 근거(실검증/자가신고 구분).
 */

// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  '영역 미설정(전 영역 OFF)': ['No areas configured (all areas OFF)', '領域未設定(全領域 OFF)', 'لم تُضبط أي مجالات (جميع المجالات OFF)'],
  '{전체}영역 중 {충족}영역만 목표({목표}) 충족 · 최저 {최저} — 미달 {미달}': ['Only {충족} of {전체} areas meet the target ({목표}) · lowest {최저} — below target: {미달}', '{전체}領域中 {충족}領域のみ目標({목표})を達成 · 最低 {최저} — 未達 {미달}', 'فقط {충족} من {전체} مجالات تستوفي الهدف ({목표}) · الأدنى {최저} — دون الهدف: {미달}'],
  '{전체}영역 중 {충족}영역만 목표({목표}) 충족 · 최저 {최저}': ['Only {충족} of {전체} areas meet the target ({목표}) · lowest {최저}', '{전체}領域中 {충족}領域のみ目標({목표})を達成 · 最低 {최저}', 'فقط {충족} من {전체} مجالات تستوفي الهدف ({목표}) · الأدنى {최저}'],
  '미설정(전환 결정 필요)': ['Not set (switch decision required)', '未設定(切替の決定が必要)', 'غير مضبوط (يلزم قرار التحويل)'],
  '현재 {값}': ['Current: {값}', '現在 {값}', 'الحالي: {값}'],
  '모드 {모드} (목표 {목표})': ['Mode {모드} (target {목표})', 'モード {모드} (目標 {목표})', 'الوضع {모드} (الهدف {목표})'],
  '실행 완료': ['Executed', '実行完了', 'تم التنفيذ'],
  '승인됨(실행 대기)': ['Approved (awaiting execution)', '承認済み(実行待ち)', 'تمت الموافقة (بانتظار التنفيذ)'],
  '법무 승인 대기': ['Awaiting legal approval', '法務承認待ち', 'بانتظار الموافقة القانونية'],
  '기관 필수 키를 확인하지 못했습니다(판정 불가 — 미입력이라 말하지 않는다)': ['Could not check the required institution keys (cannot determine — not reported as missing input)', '機関必須キーを確認できませんでした(判定不可 — 未入力とは表示しない)', 'تعذّر التحقق من مفاتيح المؤسسة الإلزامية (يتعذّر الحكم — لا يُعرض على أنه إدخال ناقص)'],
  '설정 {키} 를 확인하지 못했습니다(판정 불가 — 미설정이라 말하지 않는다)': ['Could not read setting {키} (cannot determine — not reported as unset)', '設定 {키} を確認できませんでした(判定不可 — 未設定とは表示しない)', 'تعذّرت قراءة الإعداد {키} (لا يمكن التحديد — لا يُعرض على أنه غير مُعيَّن)'],
  '입력 {입력} / 필수 {필수} · 행 없음 {행없음수}({행없음키}) · 개발용 가짜 값 {가짜수}({가짜키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤': ['Entered {입력} / required {필수} · no row {행없음수} ({행없음키}) · dev placeholder values {가짜수} ({가짜키}) — judged by actual DB rows (a default is not a setting) · issuance blocking follows the identity.unsetIssuance decision', '入力 {입력} / 必須 {필수} · 行なし {행없음수}({행없음키}) · 開発用ダミー値 {가짜수}({가짜키}) — 判定は DB 行の実在(既定値は設定ではない) · 発行ブロックは identity.unsetIssuance の決定後', 'مُدخل {입력} / مطلوب {필수} · بلا صف {행없음수} ({행없음키}) · قيم وهمية للتطوير {가짜수} ({가짜키}) — يُحكم بوجود صفوف فعلية في قاعدة البيانات (القيمة الافتراضية ليست إعدادًا) · حظر الإصدار بعد قرار identity.unsetIssuance'],
  '입력 {입력} / 필수 {필수} · 행 없음 {행없음수}({행없음키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤': ['Entered {입력} / required {필수} · no row {행없음수} ({행없음키}) — judged by actual DB rows (a default is not a setting) · issuance blocking follows the identity.unsetIssuance decision', '入力 {입력} / 必須 {필수} · 行なし {행없음수}({행없음키}) — 判定は DB 行の実在(既定値は設定ではない) · 発行ブロックは identity.unsetIssuance の決定後', 'مُدخل {입력} / مطلوب {필수} · بلا صف {행없음수} ({행없음키}) — يُحكم بوجود صفوف فعلية في قاعدة البيانات (القيمة الافتراضية ليست إعدادًا) · حظر الإصدار بعد قرار identity.unsetIssuance'],
  '입력 {입력} / 필수 {필수} · 개발용 가짜 값 {가짜수}({가짜키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤': ['Entered {입력} / required {필수} · dev placeholder values {가짜수} ({가짜키}) — judged by actual DB rows (a default is not a setting) · issuance blocking follows the identity.unsetIssuance decision', '入力 {입력} / 必須 {필수} · 開発用ダミー値 {가짜수}({가짜키}) — 判定は DB 行の実在(既定値は設定ではない) · 発行ブロックは identity.unsetIssuance の決定後', 'مُدخل {입력} / مطلوب {필수} · قيم وهمية للتطوير {가짜수} ({가짜키}) — يُحكم بوجود صفوف فعلية في قاعدة البيانات (القيمة الافتراضية ليست إعدادًا) · حظر الإصدار بعد قرار identity.unsetIssuance'],
  '입력 {입력} / 필수 {필수} — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤': ['Entered {입력} / required {필수} — judged by actual DB rows (a default is not a setting) · issuance blocking follows the identity.unsetIssuance decision', '入力 {입력} / 必須 {필수} — 判定は DB 行の実在(既定値は設定ではない) · 発行ブロックは identity.unsetIssuance の決定後', 'مُدخل {입력} / مطلوب {필수} — يُحكم بوجود صفوف فعلية في قاعدة البيانات (القيمة الافتراضية ليست إعدادًا) · حظر الإصدار بعد قرار identity.unsetIssuance'],
  '종별 설정을 확인하지 못했습니다(판정 불가) — {오류}': ['Could not check the institution type setting (cannot determine) — {오류}', '種別設定を確認できませんでした(判定不可) — {오류}', 'تعذّر التحقق من إعداد نوع المؤسسة (يتعذّر الحكم) — {오류}'],
  '요양기관 종별이 설정되지 않았습니다 — 코드가 기본값 CLINIC(의원)으로 떨어져 **의원으로 청구됩니다**. /admin/billing-calc 에서 개설 허가상 종별을 지정하십시오.': ['The care institution type is not set — the code falls back to the default CLINIC (clinic), so **claims are billed as a clinic**. Specify the type stated in the establishment permit at /admin/billing-calc.', '療養機関の種別が設定されていません — コードが既定値 CLINIC(医院)にフォールバックし、**医院として請求されます**。/admin/billing-calc で開設許可上の種別を指定してください。', 'لم يُضبط نوع مؤسسة الرعاية — تعود الشيفرة إلى القيمة الافتراضية CLINIC (عيادة)، لذا **تُصدر المطالبات بصفة عيادة**. حدّد النوع الوارد في ترخيص التأسيس في /admin/billing-calc.'],
  '알 수 없는 종별 값입니다: {값} (가능: {가능})': ['Unknown institution type value: {값} (allowed: {가능})', '不明な種別値です: {값} (可能: {가능})', 'قيمة نوع مؤسسة غير معروفة: {값} (المسموح: {가능})'],
  '종별 {종별}({코드}) — 종별가산·의료급여 정액·수가 단가 열이 이 값을 따릅니다. 개설 허가와 일치하는지는 사람이 확인합니다.': ['Type {종별} ({코드}) — institution-type add-ons, Medical Aid flat rates and fee unit-price columns follow this value. A person verifies that it matches the establishment permit.', '種別 {종별}({코드}) — 種別加算・医療給付定額・診療報酬単価列はこの値に従います。開設許可と一致するかは人が確認します。', 'النوع {종별} ({코드}) — تتبع هذه القيمةَ إضافاتُ نوع المؤسسة والمبالغ الثابتة للمساعدة الطبية وأعمدة سعر وحدة الرسوم. يتحقق شخص من مطابقتها لترخيص التأسيس.'],
  'HIS_MODE 미설정 — REAL 로 동작 중(명시 설정 권장)': ['HIS_MODE not set — running as REAL (explicit setting recommended)', 'HIS_MODE 未設定 — REAL で動作中(明示設定を推奨)', 'HIS_MODE غير مضبوط — يعمل بوضع REAL (يُنصح بالضبط الصريح)'],
  '빌드 상한 REAL (런타임 {런타임} 는 넓히지 못해 무시됨)': ['Build ceiling REAL (runtime {런타임} cannot widen it and is ignored)', 'ビルド上限 REAL (ランタイム {런타임} は広げられないため無視)', 'سقف البناء REAL (وقت التشغيل {런타임} لا يمكنه التوسيع فيُتجاهل)'],
  '빌드 상한 REAL': ['Build ceiling REAL', 'ビルド上限 REAL', 'سقف البناء REAL'],
  '빌드 상한이 {빌드} 다 — 이 배포본에는 시드 로그인이 포함돼 있고 대외 발신이 차단된다. 실환자 전에 `deploy.sh --mode real` 로 재배포해야 한다(화면 토글로는 사라지지 않는다).': ['The build ceiling is {빌드} — this build includes seed logins and blocks outbound transmission. Before real patients, redeploy with `deploy.sh --mode real` (a screen toggle does not remove it).', 'ビルド上限が {빌드} です — このデプロイ版にはシードログインが含まれ、外部送信が遮断されています。実患者の前に `deploy.sh --mode real` で再デプロイする必要があります(画面トグルでは消えません)。', 'سقف البناء هو {빌드} — يتضمن هذا الإصدار تسجيلات دخول تجريبية ويحظر الإرسال الخارجي. قبل استقبال مرضى حقيقيين يجب إعادة النشر باستخدام `deploy.sh --mode real` (لا يزيله مفتاح التبديل في الشاشة).'],
  '암호화된 정기 백업 파일이 없다 ({경로}) — 크론이 돌아도 실패하면 파일이 생기지 않는다(배포 백업은 세지 않는다)': ['No encrypted scheduled backup files ({경로}) — if the cron runs but fails, no file is created (deploy backups are not counted)', '暗号化された定期バックアップファイルがありません ({경로}) — cron が動いても失敗すればファイルは作られません(デプロイ時バックアップは数えません)', 'لا توجد ملفات نسخ احتياطي مجدولة مشفّرة ({경로}) — إذا عمل cron وفشل فلن يُنشأ ملف (لا تُحتسب نسخ النشر الاحتياطية)'],
  '최근 백업 {시각} ({시간}시간 전) · 보관 {건수}건': ['Latest backup {시각} ({시간} h ago) · {건수} retained', '最新バックアップ {시각} ({시간}時間前) · 保管 {건수}件', 'آخر نسخة احتياطية {시각} (قبل {시간} ساعة) · محفوظ {건수}'],
  '🔴 최근 백업이 {일}일 전({시각}) — 크론 로그(~/backups/backup.log)를 확인하라': ['🔴 Latest backup was {일} days ago ({시각}) — check the cron log (~/backups/backup.log)', '🔴 最新バックアップが {일}日前({시각}) — cron ログ(~/backups/backup.log)を確認してください', '🔴 آخر نسخة احتياطية قبل {일} يوم ({시각}) — تحقّق من سجل cron (~/backups/backup.log)'],
  '백업 디렉터리를 읽지 못했다({경로}) — 판정 불가: {오류}': ['Could not read the backup directory ({경로}) — cannot determine: {오류}', 'バックアップディレクトリを読めませんでした({경로}) — 判定不可: {오류}', 'تعذّرت قراءة مجلد النسخ الاحتياطي ({경로}) — يتعذّر الحكم: {오류}'],
  '🔴 ENCRYPTION_KEY 미설정 — PID 암호화 불가': ['🔴 ENCRYPTION_KEY not set — PID encryption impossible', '🔴 ENCRYPTION_KEY 未設定 — PID 暗号化不可', '🔴 ENCRYPTION_KEY غير مضبوط — تشفير PID غير ممكن'],
  '🔴 ENCRYPTION_KEY 가 all-zeros(개발 플레이스홀더) — 실 키로 로테이션 + 기존 암호문 재암호화 필요': ['🔴 ENCRYPTION_KEY is all-zeros (dev placeholder) — rotate to a real key and re-encrypt existing ciphertext', '🔴 ENCRYPTION_KEY が all-zeros(開発用プレースホルダー) — 実キーへのローテーション + 既存暗号文の再暗号化が必要', '🔴 ENCRYPTION_KEY كلها أصفار (عنصر نائب للتطوير) — يلزم التدوير إلى مفتاح حقيقي وإعادة تشفير النصوص المشفّرة الحالية'],
  '🔴 ENCRYPTION_KEY 길이 {길이}자(AES-256 = 64 hex 자) — 설정 오류': ['🔴 ENCRYPTION_KEY length {길이} chars (AES-256 = 64 hex chars) — misconfigured', '🔴 ENCRYPTION_KEY の長さ {길이}文字(AES-256 = 64 hex 文字) — 設定エラー', '🔴 طول ENCRYPTION_KEY {길이} حرفًا (AES-256 = 64 حرف hex) — خطأ في الإعداد'],
  '실 키 설정됨(64 hex·플레이스홀더 아님)': ['Real key set (64 hex, not a placeholder)', '実キー設定済み(64 hex・プレースホルダーではない)', 'تم ضبط مفتاح حقيقي (64 hex · ليس عنصرًا نائبًا)'],
  '적용 {적용}/{전체} (pg_indexes 실측)': ['Applied {적용}/{전체} (measured via pg_indexes)', '適用 {적용}/{전체} (pg_indexes 実測)', 'مُطبّق {적용}/{전체} (قياس فعلي عبر pg_indexes)'],
  '적용 {적용}/{전체} — 부재: {부재} (수동 SQL 미적용)': ['Applied {적용}/{전체} — missing: {부재} (manual SQL not applied)', '適用 {적용}/{전체} — 不在: {부재} (手動 SQL 未適用)', 'مُطبّق {적용}/{전체} — مفقود: {부재} (لم يُطبّق SQL اليدوي)'],
  '실측 실패 — 확인 불가 ({오류})': ['Measurement failed — cannot verify ({오류})', '実測失敗 — 確認不可 ({오류})', 'فشل القياس — يتعذّر التحقق ({오류})'],
  '개통 게이트 미착수': ['Go-live gates not started', '開通ゲート未着手', 'بوابات بدء التشغيل لم تبدأ'],
  '결재 {실결재}/{전체} 완료': ['Approvals {실결재}/{전체} complete', '決裁 {실결재}/{전체} 完了', 'اكتملت الموافقات {실결재}/{전체}'],
  '실 결재 {실결재}/{전체} · 개발 시드 {시드}건 제외(실 결재로 교체 필요)': ['Real approvals {실결재}/{전체} · {시드} dev seed approvals excluded (must be replaced with real approvals)', '実決裁 {실결재}/{전체} · 開発シード {시드}件を除外(実決裁への置換が必要)', 'موافقات حقيقية {실결재}/{전체} · استُبعدت {시드} موافقات بذور تطوير (يلزم استبدالها بموافقات حقيقية)'],
  '실 결재 {실결재}/{전체}': ['Real approvals {실결재}/{전체}', '実決裁 {실결재}/{전체}', 'موافقات حقيقية {실결재}/{전체}'],
  '채널 등록부에 없음: {키}': ['Not in the channel registry: {키}', 'チャネル登録簿にありません: {키}', 'غير موجود في سجل القنوات: {키}'],
  '구현 여부 판정 불가: {키}': ['Cannot determine implementation status: {키}', '実装有無を判定できません: {키}', 'يتعذّر تحديد حالة التنفيذ: {키}'],
  '전송 구현 {구현}/{전체}': ['Transmission implemented {구현}/{전체}', '送信実装 {구현}/{전체}', 'الإرسال المُنفَّذ {구현}/{전체}'],
  '전송 구현 {구현}/{전체} — 미구현: {미구현}(수기 신고로 대체 중)': ['Transmission implemented {구현}/{전체} — not implemented: {미구현} (manual reporting in the meantime)', '送信実装 {구현}/{전체} — 未実装: {미구현}(手作業の届出で代替中)', 'الإرسال المُنفَّذ {구현}/{전체} — غير مُنفَّذ: {미구현} (يُستعاض عنه بالإبلاغ اليدوي)'],
  '소스 미정': ['Source undetermined', 'ソース未定', 'المصدر غير محدد'],
  '{키}={값} (목표 {목표})': ['{키}={값} (target {목표})', '{키}={값} (目標 {목표})', '{키}={값} (الهدف {목표})'],
  '현재 {현재} — 개시 전 운영 결정 필요': ['Current {현재} — operational decision required before go-live', '現在 {현재} — 開始前に運用決定が必要', 'الحالي {현재} — يلزم قرار تشغيلي قبل البدء'],
  '현재 {현재} (개시 목표 {목표})': ['Current {현재} (go-live target {목표})', '現在 {현재} (開始目標 {목표})', 'الحالي {현재} (هدف البدء {목표})'],
  '필수 {필수}건 중 준비 {준비}건(시스템 실검증 {실검증} · 담당자 자가신고 {자가신고})': ['{준비} of {필수} required items ready (system-verified {실검증} · owner self-reported {자가신고})', '必須 {필수}件中 準備 {준비}件(システム実検証 {실검증} · 担当者自己申告 {자가신고})', 'جاهز {준비} من {필수} بندًا إلزاميًا (تحقق النظام الفعلي {실검증} · إفادة ذاتية من المسؤول {자가신고})'],
  '필수 항목이 0건 — 준비율 산출 불가(분모 없음)': ['Zero required items — readiness cannot be calculated (no denominator)', '必須項目が0件 — 準備率は算出不可(分母なし)', 'لا توجد بنود إلزامية — يتعذّر حساب نسبة الجاهزية (لا مقام)'],
  // ── 배치 2(2026-09-15 I2) — opening(개원 단계 파생 사유·위원회 주기 라벨·집행 라벨 조각) · code-master(고시 반영·분류 유도·중복·내보내기·자동 매핑 사유) ──
  '{연}년 {월}월': ['{월}/{연}', '{연}年{월}月', '{월}/{연}'],
  '{연}년 {분기}분기': ['Q{분기} {연}', '{연}年 第{분기}四半期', 'الربع {분기} من {연}'],
  '{연}년 상반기': ['H1 {연}', '{연}年 上半期', 'النصف الأول من {연}'],
  '{연}년 하반기': ['H2 {연}', '{연}年 下半期', 'النصف الثاني من {연}'],
  '{연}년': ['{연}', '{연}年', '{연}'],
  '결정됨 · {집행}': ['Decided · {집행}', '決定済み · {집행}', 'تم القرار · {집행}'],
  '결정·반영됨': ['Decided · enacted', '決定・反映済み', 'تم القرار · نُفِّذ'],
  '결정·반영대기': ['Decided · enactment pending', '決定・反映待ち', 'تم القرار · بانتظار التنفيذ'],
  '결정·반영실패': ['Decided · enactment failed', '決定・反映失敗', 'تم القرار · فشل التنفيذ'],
  '결정·수동확인': ['Decided · manually confirmed', '決定・手動確認', 'تم القرار · تأكيد يدوي'],
  '미결정': ['Undecided', '未決定', 'لم يُتخذ قرار'],
  '개발 시드 기록 — 실결정 아님': ['Development seed record — not a real decision', '開発シード記録 — 実決定ではない', 'سجل بذرة تطوير — ليس قرارًا فعليًا'],
  '위원회 없음': ['No committee', '委員会なし', 'لا توجد لجنة'],
  '위원 {위원}명 / 정족수 {정족수}': ['{위원} members / quorum {정족수}', '委員 {위원}名 / 定足数 {정족수}', '{위원} أعضاء / النصاب {정족수}'],
  '위원 {위원}명 (정족수 미설정)': ['{위원} members (quorum not set)', '委員 {위원}名 (定足数未設定)', '{위원} أعضاء (النصاب غير مضبوط)'],
  '전원 시드 구성(실제 임명 기록 없음)': ['All seeded (no record of actual appointment)', '全員シード構成(実際の任命記録なし)', 'جميعهم من بيانات البذور (لا سجل تعيين فعلي)'],
  '실제 임명 {임명}명': ['{임명} actually appointed', '実際の任命 {임명}名', 'المعيّنون فعليًا {임명}'],
  '⚠ 같은 이름의 위원회가 따로 있다(코드 없음 · 위원 {위원}명)': ['⚠ A separate committee with the same name exists (no code · {위원} members)', '⚠ 同名の委員会が別に存在する(コードなし · 委員 {위원}名)', '⚠ توجد لجنة منفصلة بالاسم نفسه (بلا رمز · {위원} أعضاء)'],
  '{원천} 에는 {표준} 이 해당하지 않습니다': ['{표준} does not apply to {원천}', '{원천} には {표준} は該当しません', 'لا ينطبق {표준} على {원천}'],
  '자동 매핑을 수행하지 못했습니다: {오류}': ['Automatic mapping could not be performed: {오류}', '自動マッピングを実行できませんでした: {오류}', 'تعذّر إجراء الربط التلقائي: {오류}'],
  '후보를 찾지 못했습니다': ['No candidates found', '候補が見つかりませんでした', 'لم يُعثر على مرشحين'],
  'AI 제안은 대조할 표준 코드 사전이 없어 자동 확정하지 않습니다 — 사람 승인이 필요합니다': ['AI suggestions are not auto-confirmed because there is no standard code dictionary to check against — human approval is required', 'AI 提案は照合する標準コード辞書がないため自動確定しません — 人の承認が必要です', 'لا تُؤكَّد اقتراحات الذكاء الاصطناعي تلقائيًا لعدم وجود قاموس رموز معيارية للمطابقة — تلزم موافقة بشرية'],
  '후보는 있으나 신뢰도가 낮습니다({신뢰도}%)': ['Candidates exist but confidence is low ({신뢰도}%)', '候補はありますが信頼度が低いです({신뢰도}%)', 'يوجد مرشحون لكن الثقة منخفضة ({신뢰도}%)'],
  '🔴 접두 {자리}자리 증거로 채울 수 있는 것은 미분류 {미분류}건 중 {채움}건({비율}%)입니다.': ['🔴 Evidence from {자리}-character prefixes can fill {채움} of {미분류} uncategorized codes ({비율}%).', '🔴 接頭 {자리}桁の証拠で埋められるのは未分類 {미분류}件中 {채움}件({비율}%)です。', '🔴 يمكن لأدلة البادئات المكوّنة من {자리} أحرف ملء {채움} من {미분류} رمزًا غير مصنّف ({비율}%).'],
  '🔴 나머지는 접두로 채울 수 없습니다 — 고시 원본 파일을 [고시 반영] 탭으로 올려야 채워집니다.': ['🔴 The rest cannot be filled from prefixes — upload the original gazette file on the [Apply gazette] tab to fill them.', '🔴 残りは接頭では埋められません — 告示原本ファイルを[告示反映]タブでアップロードすると埋まります。', '🔴 لا يمكن ملء الباقي من البادئات — ارفع ملف الإشعار الأصلي في تبويب [تطبيق الإشعار] لملئها.'],
  '🔴 적용분에는 출처가 `PREFIX_DERIVED` 로 남습니다. 고시 분류와 구분해서 읽으세요.': ['🔴 Applied entries keep the source `PREFIX_DERIVED`. Read them separately from gazette categories.', '🔴 適用分には出典が `PREFIX_DERIVED` として残ります。告示の分類と区別して読んでください。', '🔴 تحتفظ الإدخالات المطبّقة بالمصدر `PREFIX_DERIVED`. اقرأها بمعزل عن تصنيفات الإشعار.'],
  '🔴 증거가 두 갈래 이상인 접두 {개수}개({건수}건)는 제안하지 않았습니다 — 다수결로 정하면 그 추정이 규칙인 척합니다.': ['🔴 {개수} prefixes ({건수} codes) with conflicting evidence were not suggested — deciding by majority would make a guess pose as a rule.', '🔴 証拠が二手以上に分かれる接頭 {개수}個({건수}件)は提案しませんでした — 多数決で決めるとその推定が規則のふりをします。', '🔴 لم تُقترح {개수} بادئات ({건수} رمزًا) ذات أدلة متعارضة — الحسم بالأغلبية يجعل التخمين يتظاهر بأنه قاعدة.'],
  '🔴 고시 마스터는 검사하지 않습니다 — 같은 명칭에 여러 코드가 있는 것이 정상입니다(수가 가산·약품 포장 단위·진단 사고 유형).': ['🔴 The gazette master is not checked — multiple codes for the same name are normal there (fee add-ons · drug package units · diagnosis accident types).', '🔴 告示マスターは検査しません — 同じ名称に複数のコードがあるのが正常です(診療報酬加算・薬品包装単位・診断の事故類型)。', '🔴 لا تُفحص قائمة الإشعار الرئيسية — تعدد الرموز للاسم نفسه أمر طبيعي فيها (إضافات الرسوم · وحدات تعبئة الأدوية · أنواع الحوادث في التشخيص).'],
  '🔴 코드 {코드} 의 마스터 대조에 실패했습니다 — 충돌 여부를 알 수 없습니다.': ['🔴 Master comparison failed for code {코드} — whether it collides is unknown.', '🔴 コード {코드} のマスター照合に失敗しました — 衝突の有無は分かりません。', '🔴 فشلت مقارنة الرمز {코드} بالقائمة الرئيسية — لا يُعرف ما إذا كان هناك تعارض.'],
  '검사할 원내 등록 코드가 없습니다 — 지금까지 화면에서 만든 코드가 없다는 뜻이고, 중복이 없다는 뜻이 아닙니다.': ['There are no in-house codes to check — this means no codes have been created on screen so far, not that there are no duplicates.', '検査する院内登録コードがありません — これまで画面で作成したコードがないという意味で、重複がないという意味ではありません。', 'لا توجد رموز داخلية للفحص — يعني ذلك أنه لم يُنشأ أي رمز من الشاشة حتى الآن، لا أنه لا توجد تكرارات.'],
  '🔴 원내 코드가 {한도}건을 넘어 앞의 {한도}건만 검사했습니다 — 결과가 전부가 아닙니다.': ['🔴 In-house codes exceed {한도}, so only the first {한도} were checked — the results are not complete.', '🔴 院内コードが {한도}件を超えたため先頭 {한도}件のみ検査しました — 結果は全件ではありません。', '🔴 تجاوزت الرموز الداخلية {한도}، لذا فُحص أول {한도} فقط — النتائج ليست كاملة.'],
  '🔴 마스터에 같은 명칭이 이미 있는 원내 코드가 있습니다 — 청구가 되지 않을 수 있습니다. 병합은 [폐지 + 후속 코드 지정]으로 합니다(자동으로 합치지 않습니다).': ['🔴 Some in-house codes share a name already in the master — they may not be billable. Merge via [Retire + designate successor code] (nothing is merged automatically).', '🔴 マスターに同じ名称が既にある院内コードがあります — 請求できない可能性があります。統合は[廃止 + 後続コード指定]で行います(自動では統合しません)。', '🔴 توجد رموز داخلية يطابق اسمها اسمًا موجودًا في القائمة الرئيسية — قد لا تكون قابلة للفوترة. يتم الدمج عبر [إيقاف + تحديد رمز لاحق] (لا يُدمج شيء تلقائيًا).'],
  '🔴 전체 {전체}건 중 {시작}–{끝}건입니다 — 다음 장이 있습니다(이대로 제출하면 일부만 제출됩니다).': ['🔴 Codes {시작}–{끝} of {전체} — there is a next page (submitting as is would submit only part).', '🔴 全 {전체}件中 {시작}–{끝}件です — 次のページがあります(このまま提出すると一部のみ提出されます)。', '🔴 الرموز {시작}–{끝} من {전체} — توجد صفحة تالية (التقديم كما هو يقدّم جزءًا فقط).'],
  '🔴 전체 {전체}건 중 {시작}–{끝}건입니다.': ['🔴 Codes {시작}–{끝} of {전체}.', '🔴 全 {전체}件中 {시작}–{끝}件です。', '🔴 الرموز {시작}–{끝} من {전체}.'],
  '조건에 맞는 코드가 없습니다 — 빈 파일이 나갑니다(코드가 없다는 뜻입니다).': ['No codes match the conditions — an empty file will be exported (meaning there are no codes).', '条件に合うコードがありません — 空のファイルが出力されます(コードがないという意味です)。', 'لا توجد رموز مطابقة للشروط — سيُصدَّر ملف فارغ (أي لا توجد رموز).'],
  'code 가 비어 있습니다': ['code is empty', 'code が空です', 'code فارغ'],
  '같은 코드가 파일 안에 두 번 있습니다': ['The same code appears twice in the file', '同じコードがファイル内に2回あります', 'يتكرر الرمز نفسه مرتين في الملف'],
  'nameKo 가 비어 있습니다': ['nameKo is empty', 'nameKo が空です', 'nameKo فارغ'],
  'unitPrice 를 숫자로 읽을 수 없습니다: {값}': ['unitPrice cannot be read as a number: {값}', 'unitPrice を数値として読めません: {값}', 'تعذّرت قراءة unitPrice كرقم: {값}'],
  '명칭: {이전} → {이후}': ['Name: {이전} → {이후}', '名称: {이전} → {이후}', 'الاسم: {이전} → {이후}'],
  '수가: {이전} → {이후}': ['Fee: {이전} → {이후}', '診療報酬: {이전} → {이후}', 'الرسوم: {이전} → {이후}'],
  '분류: {이전} → {이후}': ['Category: {이전} → {이후}', '分類: {이전} → {이후}', 'التصنيف: {이전} → {이후}'],
  '적용하면 **새 버전**으로 쌓입니다(이전 버전은 시행일 전날로 종료). 과거 기록의 값은 바뀌지 않습니다.': ['Applying adds a **new version** (the previous version ends the day before the effective date). Values in past records do not change.', '適用すると**新しいバージョン**として積み上がります(前バージョンは施行日前日で終了)。過去の記録の値は変わりません。', 'التطبيق يضيف **إصدارًا جديدًا** (ينتهي الإصدار السابق في اليوم السابق لتاريخ النفاذ). لا تتغير القيم في السجلات السابقة.'],
  '🔴 이 코드 종류는 코드당 1행이라 적용하면 **현재 값을 덮어씁니다**(이력이 남지 않습니다 · 변경은 감사 원장에 기록됩니다).': ['🔴 This code type has one row per code, so applying **overwrites the current values** (no history is kept · changes are recorded in the audit ledger).', '🔴 このコード種別はコードごとに1行のため、適用すると**現在の値を上書きします**(履歴は残りません · 変更は監査台帳に記録されます)。', '🔴 لهذا النوع من الرموز صف واحد لكل رمز، لذا يؤدي التطبيق إلى **الكتابة فوق القيم الحالية** (لا يُحفظ سجل تاريخي · تُسجَّل التغييرات في سجل التدقيق).'],
  '🔴 파일에 없는 살아 있는 코드 {건수}건은 **자동으로 폐지하지 않습니다** — 폐지는 따로 고릅니다.': ['🔴 {건수} active codes not in the file are **not retired automatically** — retirement is chosen separately.', '🔴 ファイルにない有効なコード {건수}件は**自動では廃止しません** — 廃止は別途選びます。', '🔴 لا تُوقَف تلقائيًا **{건수} رموز نشطة غير موجودة في الملف** — يُختار الإيقاف بشكل منفصل.'],
  '🔴 그중 **원내 등록 {건수}건**은 고시 파일에 없는 것이 정상입니다 — 폐지 후보로 읽지 마세요.': ['🔴 Of these, **{건수} in-house codes** are normally absent from the gazette file — do not read them as retirement candidates.', '🔴 そのうち**院内登録 {건수}件**は告示ファイルにないのが正常です — 廃止候補として読まないでください。', '🔴 من بينها **{건수} رموز داخلية** غيابها عن ملف الإشعار أمر طبيعي — لا تعدّها مرشحة للإيقاف.'],
  '🔴 반영하지 않는 열 {개수}개: {열} — 이 코드 종류에는 해당 컬럼이 없습니다.': ['🔴 {개수} columns not applied: {열} — this code type has no such columns.', '🔴 反映しない列 {개수}個: {열} — このコード種別には該当する列がありません。', '🔴 {개수} أعمدة لن تُطبَّق: {열} — لا يحتوي هذا النوع من الرموز على هذه الأعمدة.'],
  '분류가 비어 있는 코드가 {건수}건입니다 — 분류로 거르면 보이지 않습니다.': ['{건수} codes have no category — they are hidden when filtering by category.', '分類が空のコードが {건수}件あります — 分類で絞り込むと表示されません。', 'يوجد {건수} رمزًا بلا تصنيف — لا تظهر عند التصفية حسب التصنيف.'],
  '코드 {코드} 의 존재를 확인하지 못했습니다 — 승인은 했으나 검색 결과를 눌러 확인하세요': ['Could not confirm that code {코드} exists — it was approved, but open the search results to check', 'コード {코드} の存在を確認できませんでした — 承認はしましたが、検索結果を開いて確認してください', 'تعذّر التأكد من وجود الرمز {코드} — تمت الموافقة، لكن افتح نتائج البحث للتحقق'],
  // ── 배치 3(I3 2026-09-15) — record-timeline `record-insights.ts`(의미찾기 묶음 제목·힌트·근거·항목 문장) ──
  '위급 {건수}건 포함': ['Includes {건수} critical', '危急 {건수}件を含む', 'يشمل {건수} حرجة'],
  '주의 {건수}건': ['{건수} caution', '注意 {건수}件', '{건수} تنبيه'],
  '{진단수}개 진단 · 최초 {날짜}': ['{진단수} diagnoses · first {날짜}', '{진단수}件の診断 · 初回 {날짜}', '{진단수} تشخيصات · الأول {날짜}'],
  '최초 {최초} · 최근 {최근} · {횟수}회 기재': ['First {최초} · latest {최근} · recorded {횟수} times', '初回 {최초} · 最近 {최근} · {횟수}回記載', 'الأول {최초} · الأحدث {최근} · سُجّل {횟수} مرات'],
  '{날짜} 1회 기재': ['{날짜} · recorded once', '{날짜} 1回記載', '{날짜} · سُجّل مرة واحدة'],
  '{약품} 시작': ['{약품} started', '{약품} 開始', 'بدء {약품}'],
  '{약품} 용량 변경': ['{약품} dose changed', '{약품} 用量変更', 'تغيير جرعة {약품}'],
  '{약품} 투약기간 종료': ['{약품} course ended', '{약품} 投薬期間終了', 'انتهاء مدة {약품}'],
  '{처방일} 처방 {일수}일분 · {종료일} 이후 재처방 없음': ['Prescribed {처방일} for {일수} days · no re-prescription after {종료일}', '{처방일} 処方 {일수}日分 · {종료일} 以降再処方なし', 'وُصف في {처방일} لمدة {일수} يومًا · لا إعادة وصف بعد {종료일}'],
  '약품 {종수}종 · 변화 {건수}건': ['{종수} drugs · {건수} changes', '薬品 {종수}種 · 変化 {건수}件', '{종수} أدوية · {건수} تغييرات'],
  '{검사} 유지': ['{검사} stable', '{검사} 横ばい', '{검사} مستقر'],
  '{검사} 상승': ['{검사} rising', '{검사} 上昇', '{검사} في ارتفاع'],
  '{검사} 하락': ['{검사} falling', '{검사} 下降', '{검사} في انخفاض'],
  '{횟수}회 · {처음} ({처음일}) → {최근} ({최근일}){단위}': ['{횟수} results · {처음} ({처음일}) → {최근} ({최근일}){단위}', '{횟수}回 · {처음} ({처음일}) → {최근} ({최근일}){단위}', '{횟수} نتائج · {처음} ({처음일}) ← {최근} ({최근일}){단위}'],
  '{횟수}회 · {처음} ({처음일}) → {최근} ({최근일}){단위} · {변화}': ['{횟수} results · {처음} ({처음일}) → {최근} ({최근일}){단위} · {변화}', '{횟수}回 · {처음} ({처음일}) → {최근} ({최근일}){단위} · {변화}', '{횟수} نتائج · {처음} ({처음일}) ← {최근} ({최근일}){단위} · {변화}'],
  '{항목수}개 항목': ['{항목수} items', '{항목수}項目', '{항목수} عناصر'],
  '{제목} 미서명': ['{제목} unsigned', '{제목} 未署名', '{제목} غير موقّع'],
  '{날짜} 작성 · 서명 전': ['Written {날짜} · not yet signed', '{날짜} 作成 · 署名前', 'كُتب في {날짜} · قبل التوقيع'],
  '{제목} 확정 전': ['{제목} not finalized', '{제목} 確定前', '{제목} غير معتمد'],
  '{날짜} 접수 · 결과 확정(검증) 전': ['Received {날짜} · result not yet finalized (verified)', '{날짜} 受付 · 結果確定(検証)前', 'استُلم في {날짜} · قبل اعتماد النتيجة (التحقق)'],
  '{제목} 판독 전': ['{제목} not yet read', '{제목} 読影前', '{제목} قبل القراءة'],
  '{날짜} 촬영 · 판독보고 전': ['Acquired {날짜} · report not yet issued', '{날짜} 撮影 · 読影報告前', 'صُوّر في {날짜} · قبل تقرير القراءة'],
  '{입원일} ~ {퇴원일} · 기간 내 기록 {건수}건': ['{입원일} ~ {퇴원일} · {건수} records in this period', '{입원일} ~ {퇴원일} · 期間内の記録 {건수}件', '{입원일} ~ {퇴원일} · {건수} سجلات خلال الفترة'],
  '{입원일} ~ (재원) · 기간 내 기록 {건수}건': ['{입원일} ~ (inpatient) · {건수} records in this period', '{입원일} ~ (入院中) · 期間内の記録 {건수}件', '{입원일} ~ (منوّم) · {건수} سجلات خلال الفترة'],
  '{입원일} ~ (재원)': ['{입원일} ~ (inpatient)', '{입원일} ~ (入院中)', '{입원일} ~ (منوّم)'],
  '위급 역치 도달·참고범위 이탈·미확인 위급값을 한곳에 모았습니다.': ['Critical thresholds reached, out-of-range results and unacknowledged critical values, gathered in one place.', '危急閾値到達・参考範囲逸脱・未確認の危急値を一か所にまとめました。', 'جُمعت هنا بلوغ العتبات الحرجة والنتائج خارج النطاق المرجعي والقيم الحرجة غير المؤكَّدة.'],
  '진단 경과': ['Diagnosis course', '診断経過', 'مسار التشخيص'],
  '진단이 처음 붙은 시점과 이후 반복 여부 — 새로 생긴 문제와 계속 따라다니는 문제를 가릅니다.': ['When each diagnosis first appeared and whether it recurs — separates new problems from ongoing ones.', '診断が初めて付いた時点とその後の反復 — 新たな問題と続いている問題を分けます。', 'متى ظهر كل تشخيص أول مرة وهل تكرر — يفصل المشكلات الجديدة عن المستمرة.'],
  '약물 변화': ['Medication changes', '薬物の変化', 'تغييرات الأدوية'],
  '시작·용량 변경·투약기간 종료만 남겼습니다 — 같은 약의 반복 처방은 변화가 아닙니다.': ['Only starts, dose changes and course ends are kept — repeat prescriptions of the same drug are not changes.', '開始・用量変更・投薬期間終了のみ残しました — 同じ薬の繰り返し処方は変化ではありません。', 'أُبقي فقط على البدء وتغيير الجرعة وانتهاء المدة — تكرار وصف الدواء نفسه ليس تغييرًا.'],
  '수치 추세': ['Value trends', '数値の推移', 'اتجاهات القيم'],
  '같은 검사가 3회 이상 있을 때만 방향을 표시합니다(2회는 추세로 보지 않습니다).': ['A direction is shown only when the same test has 3 or more results (2 results are not a trend).', '同じ検査が3回以上ある場合のみ方向を表示します(2回は推移とみなしません)。', 'يُعرض الاتجاه فقط عندما يكون للفحص نفسه 3 نتائج أو أكثر (نتيجتان لا تشكّلان اتجاهًا).'],
  '마무리 안 된 것': ['Unfinished items', '未完了のもの', 'عناصر غير مكتملة'],
  '서명·확정·판독이 남은 기록입니다 — 폐루프가 열려 있으면 후속 조치가 지연됩니다.': ['Records still awaiting signature, finalization or reading — while the loop is open, follow-up is delayed.', '署名・確定・読影が残っている記録です — ループが開いたままだと後続対応が遅れます。', 'سجلات لا تزال بانتظار التوقيع أو الاعتماد أو القراءة — ما دامت الحلقة مفتوحة تتأخر المتابعة.'],
  '입원 에피소드': ['Admission episode', '入院エピソード', 'حلقة دخول'],
  '재원 중': ['Currently admitted', '入院中', 'منوّم حاليًا'],
  '입원·수술 에피소드': ['Admission & surgery episodes', '入院・手術エピソード', 'حلقات الدخول والجراحة'],
  '사건 단위로 묶었습니다 — 그 기간에 무슨 기록이 얼마나 쌓였는지 함께 봅니다.': ['Grouped by event — shows what records accumulated in that period and how many.', '出来事単位でまとめました — その期間にどんな記録がどれだけ溜まったかを一緒に見ます。', 'جُمعت حسب الحدث — لرؤية السجلات التي تراكمت في تلك الفترة وعددها.'],
  '기재 없음': ['Not recorded', '記載なし', 'غير مسجّل'],
  // ── 예외 배치(I4) — 예외 응답 `error.msg`(`apps/api/src/common/msg-exception.ts`) ──
  // opening(`/admin/opening` 기관 항목 추가·수정·삭제)
  '개원 항목을 찾을 수 없습니다: {항목}': ['Opening task not found: {항목}', '開院項目が見つかりません: {항목}', 'تعذّر العثور على مهمة الافتتاح: {항목}'],
  '단계가 올바르지 않습니다: {단계}': ['Invalid phase: {단계}', '段階が正しくありません: {단계}', 'مرحلة غير صالحة: {단계}'],
  '기한 구분이 올바르지 않습니다: {기한}': ['Invalid due category: {기한}', '期限区分が正しくありません: {기한}', 'فئة الموعد النهائي غير صالحة: {기한}'],
  '모르는 국가 코드입니다: {국가}': ['Unknown country code: {국가}', '不明な国コードです: {국가}', 'رمز دولة غير معروف: {국가}'],
  '주기가 올바르지 않습니다: {주기}': ['Invalid cycle: {주기}', '周期が正しくありません: {주기}', 'دورة غير صالحة: {주기}'],
  '선행 항목이 없습니다: {항목}': ['Prerequisite task does not exist: {항목}', '先行項目が存在しません: {항목}', 'المهمة السابقة غير موجودة: {항목}'],
  '선행 항목이 다른 나라의 것입니다(국가 간 선행은 걸지 않습니다): {항목}': ['Prerequisite belongs to another country (prerequisites are not set across countries): {항목}', '先行項目が別の国のものです(国をまたぐ先行は設定しません): {항목}', 'المهمة السابقة تخص دولة أخرى (لا تُربط المتطلبات السابقة بين الدول): {항목}'],
  '이 항목을 선행으로 걸고 있는 항목이 있습니다: {항목}': ['Other tasks depend on this task as a prerequisite: {항목}', 'この項目を先行として設定している項目があります: {항목}', 'توجد مهام تعتمد على هذه المهمة كمتطلب سابق: {항목}'],
  '기관 항목을 찾을 수 없습니다: {항목}': ['Institution task not found: {항목}', '機関項目が見つかりません: {항목}', 'تعذّر العثور على مهمة المؤسسة: {항목}'],
  // diagnostic-test(기초검사 워크스테이션 검사값 입력·자리 설정) — `{항목}` 은 측정 항목 이름(화면이 원문으로 그리는 데이터)
  '측정 항목 키가 올바르지 않습니다: {항목}': ['Invalid measurement key: {항목}', '測定項目キーが正しくありません: {항목}', 'مفتاح القياس غير صالح: {항목}'],
  '측정값은 단일 값이어야 합니다: {항목}': ['A measurement must be a single value: {항목}', '測定値は単一の値である必要があります: {항목}', 'يجب أن يكون القياس قيمة واحدة: {항목}'],
  '{항목}: 숫자를 입력해 주세요': ['{항목}: please enter a number', '{항목}: 数値を入力してください', '{항목}: يُرجى إدخال رقم'],
  '{항목}: {최소} 미만은 입력할 수 없습니다': ['{항목}: values below {최소} cannot be entered', '{항목}: {최소} 未満は入力できません', '{항목}: لا يمكن إدخال قيم أقل من {최소}'],
  '{항목}: {최대} 초과는 입력할 수 없습니다': ['{항목}: values above {최대} cannot be entered', '{항목}: {최대} を超える値は入力できません', '{항목}: لا يمكن إدخال قيم أكبر من {최대}'],
  '{항목}: 선택지에 없는 값입니다': ['{항목}: value is not one of the options', '{항목}: 選択肢にない値です', '{항목}: القيمة ليست من الخيارات المتاحة'],
  '자리를 찾을 수 없습니다: {자리}': ['Station not found: {자리}', 'ステーションが見つかりません: {자리}', 'تعذّر العثور على المحطة: {자리}'],
  '기초검사 자리가 아닙니다(category={분류})': ['Not a diagnostic test station (category={분류})', '基礎検査ステーションではありません(category={분류})', 'ليست محطة فحوص تشخيصية (category={분류})'],
  '이미 있는 자리 ID 입니다: {자리}': ['Station ID already exists: {자리}', '既に存在するステーション ID です: {자리}', 'معرّف المحطة موجود بالفعل: {자리}'],
  // 전역 쿼리 파이프(`common/pipes/date-query.pipe.ts` — 모든 화면의 날짜·페이지 파라미터) · `{파라미터}` 는 쿼리 키 이름(데이터)
  '{파라미터} 는 YYYY-MM-DD 형식이어야 합니다 (받은 값: {값})': ['{파라미터} must be in YYYY-MM-DD format (received: {값})', '{파라미터} は YYYY-MM-DD 形式である必要があります (受信値: {값})', 'يجب أن يكون {파라미터} بتنسيق YYYY-MM-DD (القيمة المستلمة: {값})'],
  '{파라미터} 는 4자리 연도여야 합니다 (받은 값: {값})': ['{파라미터} must be a 4-digit year (received: {값})', '{파라미터} は4桁の年である必要があります (受信値: {값})', 'يجب أن يكون {파라미터} سنة من 4 أرقام (القيمة المستلمة: {값})'],
  '{파라미터} 는 YYYY-MM 형식이어야 합니다 (받은 값: {값})': ['{파라미터} must be in YYYY-MM format (received: {값})', '{파라미터} は YYYY-MM 形式である必要があります (受信値: {값})', 'يجب أن يكون {파라미터} بتنسيق YYYY-MM (القيمة المستلمة: {값})'],
  '{파라미터} 는 0 이상의 정수여야 합니다 (받은 값: {값})': ['{파라미터} must be an integer of 0 or more (received: {값})', '{파라미터} は0以上の整数である必要があります (受信値: {값})', 'يجب أن يكون {파라미터} عددًا صحيحًا يساوي 0 أو أكثر (القيمة المستلمة: {값})'],
  '{파라미터} 는 {상한} 이하여야 합니다 (받은 값: {값})': ['{파라미터} must be {상한} or less (received: {값})', '{파라미터} は {상한} 以下である必要があります (受信値: {값})', 'يجب أن يكون {파라미터} {상한} أو أقل (القيمة المستلمة: {값})'],
  // 원격진료 녹화 서버 프록시(`telehealth/telehealth-recordings.service.ts` · 2026-09-21 D-27) — 미설정 503·연결 실패 503·거부 502 · `{상태}` 는 HTTP 상태코드(데이터)
  '원격진료 녹화 서버 연동이 설정되지 않았습니다(TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY) — 녹화가 없는 것이 아닙니다': ['Telehealth recording server integration is not configured (TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY) — this does not mean there are no recordings', '遠隔診療の録画サーバー連携が設定されていません(TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY) — 録画がないという意味ではありません', 'لم يتم إعداد تكامل خادم تسجيل الرعاية عن بُعد (TELEHEALTH_RECORDINGS_URL·TELEHEALTH_RECORDINGS_KEY) — هذا لا يعني عدم وجود تسجيلات'],
  '녹화 서버에 연결하지 못했습니다 — 녹화가 없는 것이 아닙니다': ['Could not connect to the recording server — this does not mean there are no recordings', '録画サーバーに接続できませんでした — 録画がないという意味ではありません', 'تعذر الاتصال بخادم التسجيل — هذا لا يعني عدم وجود تسجيلات'],
  '녹화 서버가 요청을 거부했습니다(HTTP {상태}) — 녹화가 없는 것이 아닙니다': ['The recording server rejected the request (HTTP {상태}) — this does not mean there are no recordings', '録画サーバーがリクエストを拒否しました(HTTP {상태}) — 録画がないという意味ではありません', 'رفض خادم التسجيل الطلب (HTTP {상태}) — هذا لا يعني عدم وجود تسجيلات'],
  '녹화 서버 응답을 해석하지 못했습니다(HTTP {상태})': ['Could not parse the recording server response (HTTP {상태})', '録画サーバーの応答を解釈できませんでした(HTTP {상태})', 'تعذر تفسير استجابة خادم التسجيل (HTTP {상태})'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const SERVERMSG_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const SERVERMSG_VERIFIED: ReadonlySet<string> = new Set();
