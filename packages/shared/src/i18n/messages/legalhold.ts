import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그(legalhold) — 상용 릴리즈 T10-7 **법적 보존명령 관제**(`/admin/legal-hold` · 3412). 2026-09-13.
 * 키=한국어 원문 · 튜플 [en, ja, ar] · 세 언어 키 집합 동일 · 전량 AI_DRAFT.
 * 🔴 먼저 등록된 카탈로그에 이미 있는 원문(`법적 보존명령`·`환자 ID`·`사유`·`근거`·`취소`·`불러오는 중…` 등)은
 *    **등재하지 않는다**(사본은 죽은 키가 된다). 등록은 registry.ts · 가드 `apps/web/test/ui/legalhold-i18n-wiring.spec.ts`.
 *
 * 실측 경위: 화면은 `<T>`/`tAttr` 로 **배선돼 있었는데 키가 어느 카탈로그에도 없었다**(28키) —
 *   스캐너 기준 `ko 0 · t 40` 이라 "배선 완료"로 보였지만 영어 화면에는 원문+`EN×` 가 나갔다.
 *   🔴 배선 수(t)는 등재를 보증하지 않는다 — 가드 (b) 가 그 틈을 막는다.
 *
 * ── 의도적 미등재 ──────────────────────────────────────────────────────────────
 * ① **서버가 준 문장** — 보존 사유·근거·해제 사유·API 오류 `message`. 화면이 그대로 그린다.
 * ② **환자 ID(UUID)** — 데이터다.
 *
 * ── 🧑 사람 검수 대상(오역이면 뜻이 바뀐다) ─────────────────────────────────────
 * `보존명령`(legal hold — 법원 명령만이 아니라 소송·분쟁·수사 대비 원내 보존 조치를 포함한다) ·
 * 4-eyes 문장 2종(`요청한 사람과 보존명령을 건 사람은 승인할 수 없습니다…`·`승인이 끝난 해제만 실행됩니다…`) ·
 * 🔴 `이 표시가 실제로 파기를 막으려면…`(연결 전 한계 고지 — 뭉개지면 "이 화면이 막는다"는 거짓 안심이 된다).
 * `LEGALHOLD_VERIFIED` 는 비어 있다 — 검수는 커밋으로 남는 사람 행위다.
 */

// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // ── 2026-09-23 전사 보존(D6) — `/admin/retention` 이 기간 출처·산출 불가·분모를 말하는 자리 ──
  // 🔴 '기본값 — 정해진 적 없음(파기 거부)' 는 **기본값을 정책인 척하지 않는다**는 뜻이다(뭉개지면 반대로 읽힌다).
  '기본값 — 정해진 적 없음(파기 거부)': ['Code default — never decided (purge refused)', 'コード既定値 — 誰も決めていない（破棄拒否）', 'القيمة الافتراضية — لم يُقرَّر قط (رُفض الإتلاف)'],
  '산출 불가(설정값이 숫자가 아님)': ['Not computable (setting is not a number)', '算出不可（設定値が数値ではない）', 'غير قابل للحساب (القيمة ليست رقمًا)'],
  '산출 불가(기간 없음)': ['Not computable (no retention period)', '算出不可（保存期間なし）', 'غير قابل للحساب (لا توجد مدة احتفاظ)'],
  '전사 남은 종료 세션': ['Closed sessions still holding transcripts', '書き起こしが残る終了セッション', 'جلسات منتهية لا تزال تحتفظ بالنصوص'],
  '보존명령 제외': ['Excluded by legal hold', 'リーガルホールドで除外', 'مستثناة بأمر الحجز القانوني'],
  '미반영 대기(파기 대상 아님)': ['Awaiting application (not a purge candidate)', '反映待ち（破棄対象外）', 'بانتظار التطبيق (ليست مرشحة للإتلاف)'],
  '근거(사건번호·요청 기관 등 · 선택)': ['Basis (case number, requesting authority, etc. · optional)', '根拠(事件番号・要請機関など・任意)', 'الأساس (رقم القضية، الجهة الطالبة، إلخ · اختياري)'],
  '보존명령 설정': ['Set legal hold', 'リーガルホールドを設定', 'فرض حجز قانوني'],
  '보존명령 설정에 실패했습니다': ['Failed to set the legal hold', 'リーガルホールドの設定に失敗しました', 'تعذّر فرض الحجز القانوني'],
  '보존명령 해제 요청': ['Legal hold release request', 'リーガルホールド解除の申請', 'طلب رفع الحجز القانوني'],
  '보존명령을 설정했습니다': ['Legal hold set', 'リーガルホールドを設定しました', 'تم فرض الحجز القانوني'],
  '보존명령을 해제했습니다': ['Legal hold released', 'リーガルホールドを解除しました', 'تم رفع الحجز القانوني'],
  '설정 시각': ['Set at', '設定日時', 'وقت الفرض'],
  '소송·분쟁·수사로 보존해야 하는 환자 기록의 파기·익명화·아카이브 이동을 막습니다. 설정은 1인, 해제는 다른 사람의 승인이 필요합니다.': ['Blocks destruction, anonymization and archive transfer of patient records that must be preserved for litigation, disputes or investigations. One person can set a hold; releasing it requires approval by someone else.', '訴訟・紛争・捜査のため保存が必要な患者記録の破棄・匿名化・アーカイブ移動を止めます。設定は1人で可能ですが、解除には別の人の承認が必要です。', 'يمنع إتلاف سجلات المرضى الواجب حفظها للتقاضي أو النزاعات أو التحقيقات، أو إخفاء هويتها أو نقلها إلى الأرشيف. يمكن لشخص واحد فرض الحجز، أما رفعه فيتطلب موافقة شخص آخر.'],
  '승인 대기 중인 해제 요청이 없습니다': ['No release requests awaiting approval', '承認待ちの解除申請はありません', 'لا توجد طلبات رفع بانتظار الموافقة'],
  '승인 대상 보존명령의 환자를 확인할 수 없습니다': ['Cannot identify the patient of the legal hold to approve', '承認対象のリーガルホールドの患者を確認できません', 'تعذّر تحديد مريض الحجز القانوني المطلوب الموافقة عليه'],
  '승인이 끝난 해제만 실행됩니다. 승인이 없으면 서버가 거부합니다.': ['Only approved releases can be executed. Without approval the server rejects the request.', '承認済みの解除のみ実行されます。承認がなければサーバーが拒否します。', 'لا يُنفَّذ إلا الرفع المُوافَق عليه. بدون موافقة يرفض الخادم الطلب.'],
  '요청한 사람과 보존명령을 건 사람은 승인할 수 없습니다. 승인 후 해제 실행은 활성 목록에서 합니다.': ['The requester and the person who set the hold cannot approve. After approval, execute the release from the active list.', '申請者とリーガルホールドを設定した人は承認できません。承認後の解除実行はアクティブ一覧から行います。', 'لا يجوز لمقدّم الطلب ولا لمن فرض الحجز الموافقة. بعد الموافقة يُنفَّذ الرفع من قائمة الحجوزات النشطة.'],
  '이 표시가 실제로 파기를 막으려면 파기·아카이브 경로가 보존명령을 확인해야 합니다. 그 연결 상태는 보유·파기 관제에서 확인하세요.': ['This marker only blocks destruction if the destruction and archive paths check the legal hold. Check that connection on the retention and destruction console.', 'この表示が実際に破棄を止めるには、破棄・アーカイブの経路がリーガルホールドを確認する必要があります。その接続状態は保存・破棄管理で確認してください。', 'لا يمنع هذا المؤشر الإتلاف فعليًا إلا إذا تحققت مسارات الإتلاف والأرشفة من الحجز القانوني. تحقّق من حالة هذا الربط في لوحة الاحتفاظ والإتلاف.'],
  '해제 사유(필수 · 5자 이상)': ['Release reason (required · at least 5 characters)', '解除理由(必須・5文字以上)', 'سبب الرفع (إلزامي · 5 أحرف على الأقل)'],
  '해제 승인': ['Approve release', '解除を承認', 'الموافقة على الرفع'],
  '해제 승인 대기': ['Release awaiting approval', '解除承認待ち', 'رفع بانتظار الموافقة'],
  '해제 승인에 실패했습니다': ['Failed to approve the release', '解除の承認に失敗しました', 'تعذّرت الموافقة على الرفع'],
  '해제 실행': ['Execute release', '解除を実行', 'تنفيذ الرفع'],
  '해제 실행에 실패했습니다': ['Failed to execute the release', '解除の実行に失敗しました', 'تعذّر تنفيذ الرفع'],
  '해제 요청': ['Request release', '解除を申請', 'طلب الرفع'],
  '해제 요청 올리기': ['Submit release request', '解除申請を送信', 'إرسال طلب الرفع'],
  '해제 요청에 실패했습니다': ['Failed to submit the release request', '解除申請に失敗しました', 'تعذّر إرسال طلب الرفع'],
  '해제 요청을 올렸습니다 — 다른 사람의 승인이 필요합니다': ['Release request submitted — approval by someone else is required', '解除を申請しました — 別の人の承認が必要です', 'تم إرسال طلب الرفع — يلزم موافقة شخص آخر'],
  '해제 이력': ['Release history', '解除履歴', 'سجل الرفع'],
  '해제된 보존명령이 없습니다': ['No released legal holds', '解除されたリーガルホールドはありません', 'لا توجد حجوزات قانونية مرفوعة'],
  '해제를 승인했습니다': ['Release approved', '解除を承認しました', 'تمت الموافقة على الرفع'],
  '활성 보존명령': ['Active legal holds', '有効なリーガルホールド', 'الحجوزات القانونية النشطة'],
  '활성 보존명령이 없습니다': ['No active legal holds', '有効なリーガルホールドはありません', 'لا توجد حجوزات قانونية نشطة'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const LEGALHOLD_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const LEGALHOLD_VERIFIED: ReadonlySet<string> = new Set();
