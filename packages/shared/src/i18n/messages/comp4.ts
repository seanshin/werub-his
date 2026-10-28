import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그(comp4) — §12-C 구조 회수(2026-09-11): `components/admin/HisModePanel.tsx`(16조각 → 4문장)·
 * `components/nursing/NurseOnlyGuard.tsx`(조각 2문장 + 역할명 하드코딩). 키=한국어 원문 · [en, ja, ar] · 전량 AI_DRAFT.
 * 🔴 `<Tf>` 노드 자리표시자(§12-H-2)로 옮겼다 — 강조어·`<code>` 는 노드 값이고 강조어는 따로 `<T>` 로 번역한다.
 * 역할명은 shared 정본 `USER_ROLE_LABEL` 값(이미 status·nav 에 등재)을 동적 키로 쓴다 — 여기 재등재하지 않았다.
 * admin8 머리의 "HisModePanel 문단 조각 16 — 미등재" 는 이 카탈로그로 해소됐다(조각 자체가 화면에서 사라졌다).
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  '🔴 이 서버는 {빌드} 빌드라 여기로 넓힐 수 없다 — 재배포가 필요하다': [
    '🔴 This server is a {빌드} build, so it cannot be widened to this mode — a redeploy is required',
    '🔴 このサーバーは {빌드} ビルドのため、ここへは広げられません — 再デプロイが必要です',
    '🔴 هذا الخادم بإصدار {빌드}، فلا يمكن توسيعه إلى هذا الوضع — يلزم إعادة النشر',
  ],
  '모드는 {두층}이다.': ['The mode has {두층}.', 'モードは{두층}です。', 'للوضع {두층}.'],
  '두 층': ['two layers', '二層構造', 'طبقتان'],
  '{빌드상한}({빌드})은 이 배포본에 무엇이 {들어}를 정하고 재배포로만 바뀐다 ({명령}).': [
    'The {빌드상한} ({빌드}) decides {들어} this deployment and changes only by redeploying ({명령}).',
    '{빌드상한}（{빌드}）はこの配布物に何が{들어}を決め、再デプロイでのみ変わります（{명령}）。',
    'يحدد {빌드상한} ({빌드}) {들어} في هذا الإصدار، ولا يتغير إلا بإعادة النشر ({명령}).',
  ],
  '들어 있는지': ['what is included in', '含まれているか', 'ما الذي يتضمنه'],
  '아래 버튼은 {런타임}이며 {좁히기} 한다 — 리얼 빌드에는 시드 로그인 모듈이 아예 없어 런타임으로 되살아나지 않는다.': [
    'The buttons below are the {런타임} and {좁히기} — a REAL build has no seed-login module at all, so it cannot be revived at runtime.',
    '下のボタンは{런타임}で、{좁히기} — リアルビルドにはシードログインのモジュール自体がないため、ランタイムでは復活しません。',
    'الأزرار أدناه هي {런타임} و{좁히기} — لا يحتوي إصدار REAL على وحدة تسجيل دخول تجريبي أصلًا، فلا يمكن إحياؤها أثناء التشغيل.',
  ],
  '더 좁히기만': ['can only narrow it further', 'さらに狭めることしかできません', 'يمكنها التضييق فقط'],
  '저장된 런타임 값({런타임})이 빌드 상한({빌드})보다 넓어 {강조}. 실효 모드는 {실효} 다.': [
    'The saved runtime value ({런타임}) is wider than the build ceiling ({빌드}), so it was {강조}. The effective mode is {실효}.',
    '保存されたランタイム値（{런타임}）がビルド上限（{빌드}）より広いため、{강조}。実効モードは {실효} です。',
    'قيمة التشغيل المحفوظة ({런타임}) أوسع من سقف الإصدار ({빌드})، لذا {강조}. الوضع الفعلي هو {실효}.',
  ],
  '적용되지 않았다': ['not applied', '適用されませんでした', 'لم تُطبَّق'],
  '이 페이지는 {대상} 편집 화면입니다.': ['This page is an editing screen {대상}.', 'このページは{대상}の編集画面です。', 'هذه الصفحة شاشة تحرير {대상}.'],
  '현재 {역할} 계정으로 로그인되어 있어 열람만 가능합니다.': [
    'You are signed in with a {역할} account, so you can only view.',
    '現在 {역할} アカウントでログインしているため、閲覧のみ可能です。',
    'أنت مسجّل الدخول بحساب {역할}، لذا يمكنك العرض فقط.',
  ],
  // HisModePanel 리얼 모드 설명(2026-09-14 P5) — 다른 두 모드는 shared HIS_MODE_META.banner 가 키다
  '실환자 운영. 시드 로그인 없음 · 대외 발신 허용(채널별 설정·승인은 그대로).': [
    'Live patient operation. No seed login · outbound sending allowed (per-channel settings and approvals still apply).',
    '実患者運用。シードログインなし · 外部送信を許可（チャネル別の設定・承認はそのまま）。',
    'تشغيل مع مرضى حقيقيين. لا تسجيل دخول تجريبي · يُسمح بالإرسال الخارجي (تبقى إعدادات القنوات والموافقات كما هي).',
  ],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const COMP4_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const COMP4_VERIFIED: ReadonlySet<string> = new Set();
