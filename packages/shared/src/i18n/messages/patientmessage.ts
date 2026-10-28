import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그(patientmessage) — **환자 메시지함**(`/patient-messages` · 2106). 2026-09-14.
 * 키=한국어 원문 · 튜플 [en, ja, ar] · 세 언어 키 집합 동일 · 전량 AI_DRAFT.
 * 🔴 먼저 등록된 카탈로그에 이미 있는 원문(`환자` 등)은 등재하지 않는다(사본은 죽은 키가 된다).
 * 사이드바 라벨 `환자 메시지함` 은 nav 카탈로그가 갖는다. 가드 `apps/web/test/ui/patientmessage-i18n-wiring.spec.ts`.
 *
 * 실측 경위: 환자가 포털·앱에서 담당의에게 보낸 메시지를 **읽는 직원 측 화면이 없었다**(기획서 전수 검토 2026-09-14).
 *
 * ── 의도적 미등재 ──────────────────────────────────────────────────────────────
 * ① **서버·환자가 준 문장** — 메시지 본문·의사 이름. 화면이 `<Data>` 로 그린다.
 * ② 환자 앱 알림 발송 결과 문장 — 정본 `PatientNotifyConfirm.patientPushMessage` 가 만든다(다른 소비처와 같은 문장).
 *
 * ── 🧑 사람 검수 대상(오역이면 뜻이 바뀐다) ─────────────────────────────────────
 * 🔴 `담당 미지정 — 누가 받는지 정해지지 않았습니다`(배정된 것처럼 번역되면 거짓 안심) ·
 * `답변은 의사만 할 수 있습니다…`(권한 문장) · `환자 앱 알림도 요청(…)`(옵트인·설정·내용 미포함 세 사실).
 */

// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  '환자가 포털·앱에서 담당의에게 보낸 메시지입니다.': ['Messages patients sent to their doctor from the portal or app.', '患者がポータル・アプリから担当医に送ったメッセージです。', 'رسائل أرسلها المرضى إلى طبيبهم عبر البوابة أو التطبيق.'],
  '내게 지정된 메시지와 담당 미지정 메시지만 보입니다.': ['Only messages addressed to you and unassigned messages are shown.', '自分宛てのメッセージと担当未指定のメッセージのみ表示されます。', 'تظهر فقط الرسائل الموجهة إليك والرسائل غير المُسندة.'],
  '전체 메시지가 보입니다. 환자별 열람은 감사 기록에 남습니다.': ['All messages are shown. Opening a patient\'s messages is recorded in the audit log.', 'すべてのメッセージが表示されます。患者ごとの閲覧は監査記録に残ります。', 'تظهر جميع الرسائل. يُسجَّل فتح رسائل كل مريض في سجل التدقيق.'],
  '최근 {건수}건까지만 묶었습니다 — 더 오래된 메시지는 이 목록에 없습니다.': ['Only the latest {건수} messages were grouped — older messages are not in this list.', '直近{건수}件までをまとめました — それより古いメッセージはこの一覧にありません。', 'جُمعت أحدث {건수} رسالة فقط — الرسائل الأقدم ليست في هذه القائمة.'],
  '안 읽음 {건수}': ['{건수} unread', '未読 {건수}', '{건수} غير مقروءة'],
  '담당 미지정 포함': ['Includes unassigned', '担当未指定を含む', 'تتضمن رسائل غير مُسندة'],
  '담당 미지정 — 누가 받는지 정해지지 않았습니다': ['Unassigned — no recipient has been determined', '担当未指定 — 誰が受け取るか決まっていません', 'غير مُسندة — لم يُحدَّد من يستلمها'],
  '환자 앱 알림도 요청(설정이 켜져 있어야 나갑니다 · 답변 내용은 알림에 싣지 않습니다)': ['Also request a patient app notification (sent only if enabled in settings · the reply text is not included in the notification)', '患者アプリ通知も依頼（設定がオンの場合のみ送信 · 返信内容は通知に含めません）', 'اطلب أيضًا إشعارًا في تطبيق المريض (يُرسل فقط إذا كان مفعّلًا في الإعدادات · لا يُضمَّن نص الرد في الإشعار)'],
  '답변 보내기': ['Send reply', '返信を送る', 'إرسال الرد'],
  '이 환자에게서 받은 메시지가 없어 답할 수 없습니다.': ['You cannot reply because you have no message from this patient.', 'この患者から受け取ったメッセージがないため返信できません。', 'لا يمكنك الرد لعدم وجود رسالة من هذا المريض.'],
  '답변은 의사만 할 수 있습니다 — 이 계정에서는 조회만 가능합니다.': ['Only doctors can reply — this account can only view.', '返信は医師のみ可能です — このアカウントでは閲覧のみできます。', 'الرد متاح للأطباء فقط — يمكن لهذا الحساب العرض فقط.'],
  '마지막: 의사 답변': ['Last: doctor reply', '最終: 医師の返信', 'الأخيرة: رد الطبيب'],
  '마지막: 환자': ['Last: patient', '最終: 患者', 'الأخيرة: المريض'],
  '의사 답변': ['Doctor reply', '医師の返信', 'رد الطبيب'],
  '답변을 저장했습니다. 환자 메시지함에 보입니다.': ['Reply saved. It is shown in the patient\'s message list.', '返信を保存しました。患者のメッセージ一覧に表示されます。', 'تم حفظ الرد. يظهر في قائمة رسائل المريض.'],
  '담당 미지정 메시지에 답해 담당으로 기록됐습니다.': ['You replied to unassigned messages and were recorded as the assigned doctor.', '担当未指定のメッセージに返信したため、担当として記録されました。', 'رددت على رسائل غير مُسندة وسُجِّلت طبيبًا مسؤولًا.'],
  '답변 저장에 실패했습니다.': ['Failed to save the reply.', '返信の保存に失敗しました。', 'تعذّر حفظ الرد.'],
  '환자에게 보낼 답변': ['Reply to the patient', '患者への返信', 'الرد على المريض'],
  '받은 환자 메시지가 없습니다.': ['No patient messages received.', '受信した患者メッセージはありません。', 'لا توجد رسائل مرضى مستلمة.'],
  '왼쪽에서 환자를 고르세요.': ['Select a patient on the left.', '左側で患者を選んでください。', 'اختر مريضًا من اليسار.'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const PATIENTMESSAGE_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const PATIENTMESSAGE_VERIFIED: ReadonlySet<string> = new Set();
