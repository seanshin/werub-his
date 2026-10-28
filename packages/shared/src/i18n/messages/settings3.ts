import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그 — 개인설정 5 + 입원·간호 11 화면(2026-09-09 P3 라운드 2 · 담당 에이전트 소유).
 * 키=한국어 원문(동음이의는 `원문@문맥`) · 세 언어 키 집합 동일 · 전량 AI_DRAFT.
 *
 * 🔴 **의도적 미등재 — 여기 없는 것도 판단의 결과다.** 무엇을 왜 빼 두었는지:
 *
 *  ① **투약(MAR) 안전 어휘** — 상태 라벨(예정/투여완료/보류/거부/미투약)·BCMA 바코드 대조 문구·
 *     ⛔고위험(ISMP) 배지·이중확인 안내·투약 확인 다이얼로그 제목/버튼·투약 결과 토스트.
 *     `nursing.ts` 헤더가 같은 이유로 이미 뺀 어휘이고, 오역이 투약 사고가 되는 자리라
 *     한국어 원문+티가 정직하다. 이번에도 **전환하지 않았다**.
 *     🔴 다만 **등재 여부만으로는 판정할 수 없다**: `'BCMA 바코드 대조 (환자·약품)'` 은 `nursing.ts` 가
 *     "일부러 뺐다"고 선언했는데 `wsportal.ts` 에는 등재돼 있다(같은 사실에 정본이 둘). `'침상안정'`·
 *     `'욕창 위험'` 도 다른 영역에 있다. 그래서 이 화면들에 대해 못박는 것은 "카탈로그에 없다"가 아니라
 *     **"화면이 그 키를 부르지 않는다(배선 0)"** 이다 — 가드 `settings3-i18n-wiring.spec.ts` 가 그렇게 잰다.
 *  ② **간호 사정 척도의 '값'** — 활동정도(독립보행…침상안정)·영양상태(양호…중증 불량)·
 *     피부상태(정상…욕창 있음)·Braden 위험등급(정상/경미/중등도/고위험). 등급이 곧 임상 판단이고
 *     이 문자열은 **그대로 저장되는 값**이다(표시=저장). 항목 **이름**만 등재했다.
 *  ③ **SBAR/DAR 작성 placeholder**(‘진단명, 입원일, 주요 기왕력…’ 등 3건) — `nursing.ts` 가
 *     "SBAR 안내 placeholder"로 이미 뺀 키다. 사본을 만들지 않는다.
 *  ④ **전자서명 법적·보안 안내문** — 역할별 가이드 5종의 본문 항목·FAQ 답변·PIN 잠금 정책 문구.
 *     "마약류 투약 시 이중 확인 서명", "블록체인 앵커링으로 법적 증빙" 같은 문장은 제도를 서술한다.
 *     AI 초안이 여기서 틀리면 직원이 절차를 오해한 채 서명한다 — 사람 검수 후에 등재한다.
 *     (가이드 **제목**과 화면 크롬은 등재했다.)
 *  ⑤ **자유 입력 예시**(‘예: 고혈압 기본 처방’·‘예: 내과, 고혈압’) — 사용자가 한국어로 적는
 *     자유 텍스트의 보기다. 번역하면 "영어로 입력해도 된다"는 거짓 신호가 된다(`chart2.ts` 와 같은 판단).
 *  ⑥ **한국어 어미 안쪽을 `<b>`/`<code>` 가 가르는 문장** — 조각내 번역하면 어느 언어에서도 문장이
 *     되지 않아 원문 구조를 지켰다(내 서명 등록의 ‘조회 실패’ 배너, 음성 설정의 마이크 권고,
 *     단축키 화면의 화면번호 무결성 경고).
 *  ⑦ **AI 표기(AI_ORIGIN_TEXT)가 문장 가운데 들어가는 문구** — 어순이 언어마다 달라 동적 조합은 스코프 밖.
 *
 * 🔴 **중복 회피** — 먼저 등록된 카탈로그(common·nav·status·nursing·chart·chart2·wsportal…)에 이미
 *    있는 원문은 넣지 않았다(등록 순서상 settings3 가 지므로 사본은 죽은 키가 된다).
 *    소유 화면에서 뽑은 후보 **571**개 중 **304개가 그렇게 걸러졌고**, 여기 남은 것은 **267**이다
 *    — 입원 목록·약품명·용량·경로·상태·간호사·액션·저장·취소·닫기·보류 사유·보류 확인·실제 투여량·
 *    투여경로·메모·의식수준·통증 (NRS)·미평가·부위·평가자·소변·배액·경구·기타·수축기BP·맥박·체온·
 *    수액·타임라인·근무교대·환자안전 등이 걸러진 쪽이다.
 *    🔴 **등재 시점의 중복 검사만으로는 부족했다**: 같은 라운드의 병행 갈래가 뒤늦게 채운
 *    `clinical3`·`admin4`·`ws3`·`components2`·`nav` 와 **12건이 겹쳐** 있었고(그때는 상대가 비어 있어
 *    "새 키"로 보였다) 전부 제거했다 — ‘내 서명 등록’·‘음성 설정 (VoiceEMR)’·‘문서 유형’·‘+ 항목 추가’·
 *    ‘저장 위치’·‘문서 ID’·‘서명 이력이 없습니다.’·‘작동 방식’·‘자주 묻는 질문’·‘일’·‘세트’·‘코드 검색’.
 *    같은 이유로 `admin5` 가 채워지자 **7건이 더** 겹쳐 제거했다(‘검색 중…’·‘결과 없음’·‘생성 실패’·
 *    ‘삭제 실패’·‘수정되었습니다’·‘테스트 중...’·‘폐지’) — 합류 시점에 한 번 더 대조해야 하는 자리다.
 *    재발은 가드 `settings3-i18n-wiring.spec.ts` ③-a 가 잡는다(재주입 검출 확인).
 *
 * 🔴 **뜻이 갈려 문맥 키로 분리한 3건**(먼저 등재된 정의가 그 화면에서는 틀렸다):
 *    `주간@근무조`(‘주간’=Week 로 선점 → 여기서는 day shift) ·
 *    `기준@척도`(‘기준’=As of 로 선점 → NOC baseline 점수) ·
 *    `정지@상태`(‘정지’=Suspend 동작 버튼으로 선점 → 인증서 상태 Suspended).
 *
 * 🔴 원문을 바꾸지 않는다 · 숫자·코드·환자명·동적 조합은 대상이 아니다.
 * 등록은 registry.ts 가 이미 해 두었다(오케스트레이터 소유) — 이 파일의 표만 채운다.
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // 2026-10-10 재평가 자동 일정·초기평가 Braden 입력 방식
  'Braden 입력 방식(원내 결정)을 확인하지 못해 Braden 칸을 닫았습니다 — 다른 항목은 저장할 수 있습니다.': ['Could not confirm the Braden input method (hospital decision), so the Braden field is closed — other items can still be saved.', 'Braden入力方式(院内決定)を確認できなかったため、Braden欄を閉じました — 他の項目は保存できます。', 'تعذّر تأكيد طريقة إدخال Braden (قرار المستشفى)، لذا أُغلق حقل Braden — يمكن حفظ البنود الأخرى.'],
  '하위 6항목(원내 결정) — 총점은 합': ['6 subscales (hospital decision) — total is the sum', '下位6項目(院内決定) — 合計は和', '6 بنود فرعية (قرار المستشفى) — المجموع هو حاصل الجمع'],
  'Braden 선택 지우기(평가하지 않음)': ['Clear Braden selection (not assessed)', 'Braden選択を消去(評価しない)', 'مسح اختيار Braden (بدون تقييم)'],
  'Braden 을 고르다 말았습니다 — 6항목을 모두 고르거나 선택을 지우세요(부분 합은 Braden 점수가 아닙니다).': ['Braden is partly selected — select all 6 items or clear the selection (a partial sum is not a Braden score).', 'Bradenが途中まで選択されています — 6項目すべてを選ぶか選択を消去してください(部分和はBradenスコアではありません)。', 'تم اختيار Braden جزئيًا — اختر البنود الستة كلها أو امسح الاختيار (المجموع الجزئي ليس درجة Braden).'],
  '재평가 일정을 자동으로 만들었습니다': ['Reassessment schedules created automatically', '再評価スケジュールを自動作成しました', 'تم إنشاء جداول إعادة التقييم تلقائيًا'],
  '이미 열린 재평가 일정이 있어 만들지 않았습니다': ['Not created — an open reassessment schedule already exists', '既に開いている再評価スケジュールがあるため作成しませんでした', 'لم يُنشأ — يوجد جدول إعادة تقييم مفتوح بالفعل'],
  '점수가 없어 일정을 만들지 않았습니다': ['Not created — no score', 'スコアがないためスケジュールを作成しませんでした', 'لم يُنشأ الجدول — لا توجد درجة'],
  '재평가 관리로': ['Go to reassessment management', '再評価管理へ', 'الانتقال إلى إدارة إعادة التقييم'],
  // 2026-10-10 Braden 위험 평가 이력
  '확인 필요 {n}건': ['{n} need review', '要確認 {n}件', '{n} بحاجة إلى مراجعة'],
  '이번 재원에 Braden 기록이 없습니다': ['No Braden records this admission', '今回の入院にBraden記録がありません', 'لا توجد سجلات Braden لهذه الإقامة'],
  '마찰·전단': ['Friction & shear', '摩擦・ずれ', 'الاحتكاك والقص'],
  '초기평가': ['Initial assessment', '初期評価', 'التقييم الأولي'],
  '임상 도구': ['Clinical tool', '臨床ツール', 'أداة سريرية'],
  '재평가': ['Re-assessment', '再評価', 'إعادة التقييم'],
  '총점이 6~23 밖': ['Total outside 6–23', '合計点が6〜23の範囲外', 'المجموع خارج 6–23'],
  '하위 항목 누락': ['Subscores missing', '下位項目の欠落', 'بنود فرعية مفقودة'],
  '항목 점수 범위 밖': ['Item score out of range', '項目点数が範囲外', 'درجة البند خارج النطاق'],
  '항목 합과 총점이 다름': ['Item sum differs from total', '項目の合計と合計点が異なる', 'مجموع البنود يختلف عن المجموع'],
  '초기평가는 총점만 받아 하위 항목이 없습니다 · 2026-10-10 이전 재평가는 마지막 점수만 남아 이력에 없습니다': ['Initial assessments record the total only (no subscores) · re-assessments before 2026-10-10 kept only the last score and are not in this history', '初期評価は合計点のみで下位項目はありません · 2026-10-10以前の再評価は最終点数のみ残り、履歴にはありません', 'التقييم الأولي يسجل المجموع فقط (بلا بنود فرعية) · إعادات التقييم قبل 2026-10-10 احتفظت بآخر درجة فقط وليست في هذا السجل'],
  // 2026-10-10 입원 간호 확장 — I/O 수지·위험 평가 추이·NEWS2 재측정 참고
  '비우면 저장한 시각으로 기록됩니다': ['If left blank, the save time is recorded', '空欄なら保存時刻で記録されます', 'إذا تُرك فارغًا يُسجَّل وقت الحفظ'],
  'I/O 수지': ['I/O balance', 'I/O収支', 'توازن المدخول/المخرج'],
  '섭취 / 배설 · 수지': ['Intake / output · balance', '摂取 / 排泄・収支', 'المدخول / المخرج · التوازن'],
  '직전 근무조': ['Previous shift', '直前の勤務帯', 'المناوبة السابقة'],
  '초번': ['Evening', '準夜', 'المسائية'],
  '플로시트 칸 {n}건 포함': ['Includes {n} flowsheet entries', 'フローシート欄{n}件を含む', 'يتضمن {n} من إدخالات ورقة المتابعة'],
  '마지막 배설 기록': ['Last output record', '最後の排泄記録', 'آخر سجل إخراج'],
  '배설 기록이 없습니다': ['No output records', '排泄記録がありません', 'لا توجد سجلات إخراج'],
  '24시간 안 0 mL 배설 기록 {n}건': ['{n} zero-mL output records in 24 h', '24時間以内の0 mL排泄記録{n}件', '{n} سجلات إخراج بصفر مل خلال 24 ساعة'],
  '배설 공백 기준이 원내에 설정되지 않아 강조하지 않습니다(시스템 설정 nursing.io.noOutputAlertHours).': ['No in-house threshold for output gaps, so none is highlighted (system setting nursing.io.noOutputAlertHours).', '排泄空白の院内基準が未設定のため強調しません(システム設定 nursing.io.noOutputAlertHours)。', 'لم يُحدَّد حد داخلي لفجوة الإخراج، لذا لا يُبرز شيء (إعداد النظام nursing.io.noOutputAlertHours).'],
  '원내 기준 {h}시간 — 넘으면 강조합니다.': ['In-house threshold {h} h — highlighted when exceeded.', '院内基準{h}時間 — 超えると強調します。', 'الحد الداخلي {h} ساعة — يُبرز عند تجاوزه.'],
  '위험 평가 추이': ['Risk assessment trend', 'リスク評価の推移', 'اتجاه تقييم المخاطر'],
  '이번 재원': ['This admission', '今回の入院', 'هذه الإقامة'],
  '이번 재원에 NEWS2 점수가 없습니다(7요소를 다 잰 측정만 점수가 납니다)': ['No NEWS2 score this admission (only measurements with all 7 items are scored)', '今回の入院にNEWS2スコアがありません(7項目すべて測定した場合のみ算出)', 'لا توجد درجة NEWS2 لهذه الإقامة (تُحسب فقط القياسات بالعناصر السبعة كاملة)'],
  '원내 재측정 주기 미설정 — 참고': ['No in-house re-measurement interval — reference', '院内の再測定間隔未設定 — 参考', 'لم يُحدَّد فاصل إعادة القياس داخليًا — مرجع'],
  '참고 간격을 지났습니다': ['Reference interval passed', '参考間隔を過ぎました', 'تجاوز الفاصل المرجعي'],
  '최근 {shown}건만 받았습니다(전체 {total}건)': ['Received the latest {shown} only (of {total})', '最近の{shown}件のみ取得(全{total}件)', 'تم استلام أحدث {shown} فقط (من أصل {total})'],
  '낙상 위험 평가': ['Fall risk assessment', '転倒リスク評価', 'تقييم خطر السقوط'],
  '이번 재원에 낙상 평가 기록이 없습니다': ['No fall assessments this admission', '今回の入院に転倒評価記録がありません', 'لا توجد تقييمات سقوط لهذه الإقامة'],
  '재평가 예정': ['Scheduled re-assessments', '再評価予定', 'إعادات التقييم المجدولة'],
  '재평가 일정이 없습니다 — 입원 시 자동 생성은 원내 설정(위원회)입니다': ['No re-assessment schedule — auto-creation on admission is an in-house setting (committee)', '再評価予定がありません — 入院時の自動作成は院内設定(委員会)です', 'لا يوجد جدول لإعادة التقييم — الإنشاء التلقائي عند الدخول إعداد داخلي (لجنة)'],
  '{h}시간마다': ['Every {h} h', '{h}時間ごと', 'كل {h} ساعة'],
  '지남': ['Overdue', '経過', 'متأخر'],
  // 2026-10-10 입원 간호 — 플로시트 산소·I/O 출처
  '산소 투여': ['Supplemental oxygen', '酸素投与', 'الأكسجين الإضافي'],
  '산소 투여(미관측)': ['Supplemental oxygen (not observed)', '酸素投与(未観測)', 'الأكسجين الإضافي (غير مُلاحظ)'],
  '산소 투여 중': ['On oxygen', '酸素投与中', 'على الأكسجين'],
  '실내 공기': ['Room air', '室内空気', 'هواء الغرفة'],
  '플로시트': ['Flowsheet', 'フローシート', 'ورقة المتابعة'],
  '플로시트 칸에 적힌 섭취·배설입니다(종전 입력 경로).': ['Intake/output recorded in flowsheet columns (former entry path).', 'フローシート欄に記録された摂取・排泄です(従来の入力経路)。', 'مدخول/مخرج مسجّل في أعمدة ورقة المتابعة (مسار الإدخال السابق).'],
  // ── 입원/간호 — 투약확인(MAR) 화면 크롬 (안전 어휘는 위 ① 로 미등재) ──
  '투약확인 (MAR)': ['Medication administration record (MAR)', '与薬確認 (MAR)', 'سجل إعطاء الأدوية (MAR)'],
  '투약 스케줄이 없습니다': ['No medication schedule', '与薬スケジュールがありません', 'لا يوجد جدول أدوية'],
  '해당 날짜에 예정된 투약이 없습니다. 처방을 확인해주세요.': ['No medication is scheduled for this date. Please check the prescriptions.', 'この日付に予定された与薬はありません。処方を確認してください。', 'لا توجد أدوية مجدولة في هذا التاريخ. يرجى مراجعة الوصفات.'],
  '사유 보기': ['View reason', '理由を見る', 'عرض السبب'],
  '투약 보류': ['Hold medication', '与薬保留', 'تعليق الدواء'],
  '투약 거부': ['Medication refusal', '与薬拒否', 'رفض الدواء'],
  '(환자 거부)': ['(patient refused)', '(患者拒否)', '(رفض المريض)'],
  '거부 사유': ['Refusal reason', '拒否理由', 'سبب الرفض'],
  '거부 확인': ['Confirm refusal', '拒否を確定', 'تأكيد الرفض'],
  '사유를 입력하세요...': ['Enter a reason...', '理由を入力してください...', 'أدخل السبب...'],
  '환자 거부 사유를 입력하세요...': ['Enter the patient’s reason for refusal...', '患者の拒否理由を入力してください...', 'أدخل سبب رفض المريض...'],

  // ── 입원/간호 — 섭취·배설(I/O) ──
  '총 섭취량': ['Total intake', '総摂取量', 'إجمالي المدخول'],
  '총 배출량': ['Total output', '総排出量', 'إجمالي المخرجات'],
  '+ 섭취': ['+ Intake', '+ 摂取', '+ مدخول'],
  '+ 배출': ['+ Output', '+ 排出', '+ مخرجات'],
  '섭취량 입력': ['Record intake', '摂取量の入力', 'تسجيل المدخول'],
  '배출량 입력': ['Record output', '排出量の入力', 'تسجيل المخرجات'],
  '양 (mL)': ['Amount (mL)', '量 (mL)', 'الكمية (mL)'],
  '양(mL)': ['Amount (mL)', '量(mL)', 'الكمية (mL)'],
  '기록자': ['Recorded by', '記録者', 'سجّله'],
  'I/O 기록이 없습니다': ['No intake/output records', 'I/O 記録がありません', 'لا توجد سجلات مدخول/مخرجات'],
  '상단의 "+ 섭취" 또는 "+ 배출" 버튼으로 기록을 시작하세요.': ['Use the “+ Intake” or “+ Output” button above to start recording.', '上部の「+ 摂取」または「+ 排出」ボタンから記録を開始してください。', 'استخدم زر «+ مدخول» أو «+ مخرجات» أعلاه لبدء التسجيل.'],
  'NS 1L, 물 200ml...': ['NS 1L, water 200 mL...', 'NS 1L、水 200ml...', 'محلول ملحي 1 لتر، ماء 200 مل...'],
  '정맥(IV)': ['Intravenous (IV)', '静脈内 (IV)', 'وريدي (IV)'],
  '구토': ['Emesis', '嘔吐', 'قيء'],

  // ── 입원/간호 — 간호초기평가(항목 이름만 · 척도 값은 위 ② 로 미등재) ──
  '간호초기평가': ['Initial nursing assessment', '看護初期評価', 'التقييم التمريضي الأولي'],
  '간호초기평가 작성': ['New initial nursing assessment', '看護初期評価の作成', 'إنشاء تقييم تمريضي أولي'],
  '간호초기평가가 아직 없습니다': ['No initial nursing assessment yet', '看護初期評価はまだありません', 'لا يوجد تقييم تمريضي أولي بعد'],
  '환자 입원 시 간호초기평가를 작성해주세요.': ['Please complete the initial nursing assessment when the patient is admitted.', '患者の入院時に看護初期評価を作成してください。', 'يرجى إكمال التقييم التمريضي الأولي عند دخول المريض.'],
  '간호과정 (ADPIE)': ['Nursing process (ADPIE)', '看護過程 (ADPIE)', 'العملية التمريضية (ADPIE)'],
  '활동정도': ['Mobility level', '活動度', 'مستوى الحركة'],
  '영양상태': ['Nutritional status', '栄養状態', 'الحالة التغذوية'],
  '피부상태': ['Skin integrity', '皮膚の状態', 'سلامة الجلد'],
  '통증점수': ['Pain score', '疼痛スコア', 'درجة الألم'],
  '통증점수 (NRS 0-10)': ['Pain score (NRS 0-10)', '疼痛スコア (NRS 0-10)', 'درجة الألم (NRS 0-10)'],
  '통증 없음(0) 확인': ['Confirm no pain (0)', '疼痛なし(0)を確認', 'تأكيد عدم وجود ألم (0)'],
  '통증부위': ['Pain site', '疼痛部位', 'موضع الألم'],
  '알레르기 확인 완료': ['Allergies confirmed', 'アレルギー確認済み', 'تم التحقق من الحساسية'],
  '낙상위험': ['Fall risk', '転倒リスク', 'خطر السقوط'],
  '재사정': ['Reassess', '再評価', 'إعادة التقييم'],
  '아직 평가하지 않은 항목:': ['Not yet assessed:', '未評価の項目:', 'عناصر لم تُقيَّم بعد:'],
  '— 기본값으로 저장하지 않습니다.': ['— defaults are not saved.', '— 既定値では保存しません。', '— لا يتم الحفظ بالقيم الافتراضية.'],
  '평가 저장': ['Save assessment', '評価を保存', 'حفظ التقييم'],

  // ── 입원/간호 — 간호과정(ADPIE) ──
  '간호초기평가가 필요합니다': ['An initial nursing assessment is required', '看護初期評価が必要です', 'التقييم التمريضي الأولي مطلوب'],
  '간호진단(NANDA)은 사정 데이터를 근거로 합니다. 먼저 사정을 작성하세요.': ['Nursing diagnoses (NANDA) are based on assessment data. Complete the assessment first.', '看護診断(NANDA)はアセスメントデータに基づきます。先にアセスメントを作成してください。', 'تستند التشخيصات التمريضية (NANDA) إلى بيانات التقييم. أكمل التقييم أولاً.'],
  '간호 사정 작성': ['Create nursing assessment', '看護アセスメントの作成', 'إنشاء تقييم تمريضي'],
  '간호과정 제안': ['Nursing process suggestions', '看護過程の提案', 'اقتراحات العملية التمريضية'],
  '제안 받기': ['Get suggestions', '提案を受ける', 'الحصول على اقتراحات'],
  '다시': ['Again', 'もう一度', 'مرة أخرى'],
  '제안을 불러오지 못했습니다.': ['Could not load suggestions.', '提案を読み込めませんでした。', 'تعذّر تحميل الاقتراحات.'],
  '사정 데이터 기준 제안할 간호진단이 없습니다(정상 범위). 표준코드에서 직접 선택하세요.': ['No nursing diagnosis is suggested from the assessment data (within normal range). Select one directly from the standard codes.', 'アセスメントデータに基づく提案可能な看護診断はありません（正常範囲）。標準コードから直接選択してください。', 'لا يوجد تشخيص تمريضي مقترح من بيانات التقييم (ضمن المعدل الطبيعي). اختر مباشرة من الرموز المعيارية.'],
  '간호 사정·EWS·낙상 근거로 표준코드(NANDA-NIC)에서 제안합니다. 검토 후 추가하세요.': ['Suggested from the standard codes (NANDA-NIC) based on the nursing assessment, EWS and fall risk. Review before adding.', '看護アセスメント・EWS・転倒を根拠に標準コード(NANDA-NIC)から提案します。確認のうえ追加してください。', 'اقتراحات من الرموز المعيارية (NANDA-NIC) بناءً على التقييم التمريضي وEWS وخطر السقوط. راجعها قبل الإضافة.'],
  '진단으로 추가': ['Add as diagnosis', '診断として追加', 'إضافة كتشخيص'],
  '관련요인': ['Related factors', '関連因子', 'العوامل المرتبطة'],
  '제안은 표준코드에서만 선택됩니다. 최종 진단·중재 확정과 책임은 간호사에게 있습니다.': ['Suggestions are drawn only from standard codes. Confirming the final diagnosis and interventions — and the responsibility for them — rests with the nurse.', '提案は標準コードからのみ選択されます。最終的な診断・介入の確定と責任は看護師にあります。', 'تُختار الاقتراحات من الرموز المعيارية فقط. تأكيد التشخيص والتدخلات النهائية ومسؤوليتها تقع على الممرض/ة.'],
  '등록된 간호진단이 없습니다. 위 제안에서 추가하거나 직접 작성하세요.': ['No nursing diagnosis registered. Add one from the suggestions above, or write your own.', '登録された看護診断はありません。上の提案から追加するか、直接作成してください。', 'لا يوجد تشخيص تمريضي مسجّل. أضف من الاقتراحات أعلاه أو اكتب واحداً.'],
  '+ 표준코드(NANDA)에서 진단 추가': ['+ Add a diagnosis from the standard codes (NANDA)', '+ 標準コード(NANDA)から診断を追加', '+ إضافة تشخيص من الرموز المعيارية (NANDA)'],
  'NANDA 검색(예: 통증, 낙상)…': ['Search NANDA (e.g. pain, fall)…', 'NANDA 検索(例: 疼痛、転倒)…', 'بحث NANDA (مثال: ألم، سقوط)…'],
  '해결': ['Resolve', '解決', 'حل'],
  '중재 (NIC)': ['Interventions (NIC)', '介入 (NIC)', 'التدخلات (NIC)'],
  '이행': ['Performed', '実施', 'نُفِّذ'],
  '이행 기록': ['Record as performed', '実施を記録', 'تسجيل التنفيذ'],
  '중재 추가…': ['Add intervention…', '介入を追加…', 'إضافة تدخل…'],
  '결과 (NOC · 1–5 Likert)': ['Outcomes (NOC · 1–5 Likert)', 'アウトカム (NOC · 1–5 リッカート)', 'النتائج (NOC · مقياس ليكرت 1–5)'],
  '기대결과 추가…': ['Add expected outcome…', '期待される成果を追加…', 'إضافة نتيجة متوقعة…'],
  // 🔴 문맥 키 — '기준'은 'As of'(기준 시점)로 선점됨. NOC 은 baseline 점수다.
  '기준@척도': ['Baseline', 'ベースライン', 'خط الأساس'],

  // ── 입원/간호 — 체크리스트 ──
  '간호 체크리스트': ['Nursing checklists', '看護チェックリスト', 'قوائم التحقق التمريضية'],
  '새 체크리스트 생성': ['Create a new checklist', '新規チェックリストの作成', 'إنشاء قائمة تحقق جديدة'],
  '읽기전용 — 체크리스트 생성은 간호사만 가능합니다': ['Read-only — only nurses can create checklists', '読み取り専用 — チェックリストの作成は看護師のみ可能です', 'للقراءة فقط — إنشاء قوائم التحقق متاح للممرضين فقط'],
  '체크리스트가 없습니다. 위에서 생성해 주세요.': ['No checklists. Create one above.', 'チェックリストがありません。上で作成してください。', 'لا توجد قوائم تحقق. أنشئ واحدة أعلاه.'],
  '체크리스트 생성': ['Checklist created', 'チェックリストを作成しました', 'تم إنشاء قائمة التحقق'],
  '수술 전': ['Pre-operative', '術前', 'ما قبل الجراحة'],
  '수술 후': ['Post-operative', '術後', 'ما بعد الجراحة'],
  '낙상예방': ['Fall prevention', '転倒予防', 'الوقاية من السقوط'],
  '욕창예방': ['Pressure ulcer prevention', '褥瘡予防', 'الوقاية من قرح الفراش'],

  // ── 입원/간호 — Flow Sheet ──
  '시간별 바이탈 + I/O 기록표': ['Hourly vital signs and intake/output chart', '時間別バイタル + I/O 記録表', 'جدول العلامات الحيوية والمدخول/المخرجات بالساعة'],
  '+ 기록 추가': ['+ Add record', '+ 記録を追加', '+ إضافة سجل'],
  '읽기전용': ['Read-only', '読み取り専用', 'للقراءة فقط'],
  '바이탈 + I/O 입력': ['Vital signs + intake/output entry', 'バイタル + I/O 入力', 'إدخال العلامات الحيوية والمدخول/المخرجات'],
  '기록 추가 실패': ['Failed to add the record', '記録の追加に失敗しました', 'فشل إضافة السجل'],
  '경구섭취': ['Oral intake', '経口摂取', 'المدخول الفموي'],

  // ── 입원/간호 — 교대 인수인계(SBAR) ──
  '교대 인수인계 (SBAR)': ['Shift handoff (SBAR)', '勤務交代の申し送り (SBAR)', 'تسليم الوردية (SBAR)'],
  '복사됨': ['Copied', 'コピーしました', 'تم النسخ'],
  '전체 복사': ['Copy all', 'すべてコピー', 'نسخ الكل'],
  '생성 중…': ['Generating…', '生成中…', 'جارٍ الإنشاء…'],
  'SBAR 생성': ['Generate SBAR', 'SBAR を生成', 'إنشاء SBAR'],
  '다시 생성': ['Regenerate', '再生成', 'إعادة الإنشاء'],
  'SBAR를 생성하지 못했습니다. 다시 시도하세요.': ['Could not generate the SBAR. Please try again.', 'SBAR を生成できませんでした。もう一度お試しください。', 'تعذّر إنشاء SBAR. يرجى المحاولة مرة أخرى.'],
  '활력징후·EWS·낙상·활성 간호진단·미서명 기록·투약 지연을 근거로 SBAR 인계 초안을 구성합니다(데이터 기반·읽기 보조). 인계 책임은 간호사에게 있습니다.': ['Builds a draft SBAR handoff from vital signs, EWS, fall risk, active nursing diagnoses, unsigned records and overdue medications (data-based, read-only assistance). Responsibility for the handoff rests with the nurse.', 'バイタルサイン・EWS・転倒・活動中の看護診断・未署名記録・与薬遅延を根拠に SBAR 申し送りの下書きを構成します（データに基づく読み取り補助）。申し送りの責任は看護師にあります。', 'ينشئ مسودة تسليم SBAR من العلامات الحيوية وEWS وخطر السقوط والتشخيصات التمريضية النشطة والسجلات غير الموقّعة والأدوية المتأخرة (مساعدة قراءة قائمة على البيانات). مسؤولية التسليم تقع على الممرض/ة.'],
  '투약지연': ['Overdue medication', '与薬遅延', 'دواء متأخر'],
  '활성 진단': ['Active diagnoses', '活動中の診断', 'التشخيصات النشطة'],
  '데이터 근거로만 구성(임상사실 임의 생성 없음). 검토 후 인계하세요.': ['Built only from recorded data (no clinical facts are invented). Review before handing over.', '記録データのみから構成（臨床事実の創作なし）。確認のうえ申し送りしてください。', 'مبني على البيانات المسجلة فقط (دون اختلاق حقائق سريرية). راجعه قبل التسليم.'],
  'Situation (상황)': ['Situation', 'Situation（状況）', 'Situation (الوضع)'],
  'Background (배경)': ['Background', 'Background（背景）', 'Background (الخلفية)'],
  'Assessment (사정)': ['Assessment', 'Assessment（アセスメント）', 'Assessment (التقييم)'],
  'Recommendation (제안·인계)': ['Recommendation / handover', 'Recommendation（提案・申し送り）', 'Recommendation (التوصية والتسليم)'],

  // ── 입원 상세 I-PASS 인계 폼(2026-10-04 · 개통 이래 저장 0 봉합) ──
  '인수인계가 저장되었습니다.': ['Handover saved.', '申し送りを保存しました。', 'تم حفظ التسليم.'],
  '인수인계 저장에 실패했습니다.': ['Failed to save the handover.', '申し送りの保存に失敗しました。', 'تعذّر حفظ التسليم.'],
  '— 인수 의사 —': ['— Receiving physician —', '— 受け手の医師 —', '— الطبيب المستلم —'],
  '★ 다음 근무조 근무': ['★ On the next shift', '★ 次の勤務帯の勤務者', '★ في المناوبة التالية'],
  // ── 입원/간호 — 타임라인 ──
  '간호 타임라인': ['Nursing timeline', '看護タイムライン', 'الخط الزمني التمريضي'],
  '오늘 기록이 없습니다': ['No records today', '本日の記録はありません', 'لا توجد سجلات اليوم'],
  // 🔴 문맥 키 — '주간'은 'Week'(주 단위)로 선점됨. 여기서는 근무조(day shift)다.
  '주간@근무조': ['Day shift', '日勤', 'وردية نهارية'],
  '준야': ['Evening shift', '準夜勤', 'وردية مسائية'],

  // ── 개인설정 — 내 서명 등록 ──
  '등록한 서명은 동의서·의무기록 등 전자서명 시 자동으로 표시됩니다.': ['The signature you register is shown automatically when you sign consent forms, medical records and other documents.', '登録した署名は同意書・診療記録などの電子署名時に自動的に表示されます。', 'يظهر التوقيع الذي تسجّله تلقائياً عند التوقيع على نماذج الموافقة والسجلات الطبية.'],
  '현재 등록된 서명을 확인하지 못했습니다': ['Could not check the currently registered signature', '現在登録されている署名を確認できませんでした', 'تعذّر التحقق من التوقيع المسجَّل حالياً'],
  '현재 등록된 서명': ['Currently registered signature', '現在登録されている署名', 'التوقيع المسجَّل حالياً'],
  '현재 서명': ['Current signature', '現在の署名', 'التوقيع الحالي'],
  '이 화면의 서명패드로 직접 등록한 서명입니다.': ['This signature was drawn on the signature pad on this screen.', 'この画面の署名パッドで直接登録した署名です。', 'هذا التوقيع رُسم على لوحة التوقيع في هذه الشاشة.'],
  '본인이 그린 서명이 아닙니다 — 시스템이 자동 생성한 임시 이미지입니다.': ['This is not a signature you drew — it is a temporary image generated by the system.', '本人が描いた署名ではありません — システムが自動生成した一時的な画像です。', 'هذا ليس توقيعاً رسمته بنفسك — إنه صورة مؤقتة أنشأها النظام تلقائياً.'],
  '서명 삭제': ['Delete signature', '署名を削除', 'حذف التوقيع'],
  '등록된 서명이 없습니다.': ['No signature registered.', '登録された署名はありません。', 'لا يوجد توقيع مسجّل.'],
  '새 서명으로 변경': ['Replace with a new signature', '新しい署名に変更', 'استبدال بتوقيع جديد'],
  '아래 칸에 서명을 그려주세요': ['Draw your signature in the box below', '下の枠に署名を描いてください', 'ارسم توقيعك في المربع أدناه'],
  '서명 저장': ['Save signature', '署名を保存', 'حفظ التوقيع'],
  '서명이 저장되었습니다': ['Signature saved', '署名を保存しました', 'تم حفظ التوقيع'],
  '서명을 입력해주세요': ['Please enter a signature', '署名を入力してください', 'يرجى إدخال توقيع'],

  // ── 개인설정 — 단축키·화면번호 치트시트 ──
  '단축키 · 화면번호 치트시트': ['Shortcuts · screen-number cheat sheet', 'ショートカット・画面番号チートシート', 'اختصارات · دليل أرقام الشاشات'],
  '사이드바에 보이는 화면': ['Screens visible in the sidebar', 'サイドバーに表示される画面', 'الشاشات الظاهرة في الشريط الجانبي'],
  '화면번호 무결성 경고': ['Screen-number integrity warning', '画面番号の整合性警告', 'تحذير سلامة أرقام الشاشات'],
  '전역 단축키': ['Global shortcuts', 'グローバルショートカット', 'اختصارات عامة'],
  '화면 내 액션 단축키': ['In-screen action shortcuts', '画面内アクションのショートカット', 'اختصارات الإجراءات داخل الشاشة'],
  '화면번호': ['Screen number', '画面番号', 'رقم الشاشة'],
  '화면번호 입력칸 포커스(지정 가능)': ['Focus the screen-number box (rebindable)', '画面番号入力欄にフォーカス（変更可能）', 'التركيز على حقل رقم الشاشة (قابل لإعادة التعيين)'],
  '현재 화면 단축키 도움말': ['Shortcut help for the current screen', '現在の画面のショートカットヘルプ', 'مساعدة اختصارات الشاشة الحالية'],
  '통합 검색(환자·약품·화면번호)': ['Unified search (patients, drugs, screen numbers)', '統合検索（患者・薬品・画面番号）', 'بحث موحّد (المرضى، الأدوية، أرقام الشاشات)'],
  '확정/저장(접수·수납 등)': ['Confirm / save (reception, payment, etc.)', '確定・保存（受付・会計など）', 'تأكيد / حفظ (الاستقبال، الدفع، إلخ)'],
  '신규(환자 등)': ['New (patient, etc.)', '新規（患者など）', 'جديد (مريض، إلخ)'],
  'QR 스캔(접수 WS)': ['Scan QR (reception workstation)', 'QR スキャン（受付WS）', 'مسح QR (محطة الاستقبال)'],
  '새 처방(CPOE)': ['New order (CPOE)', '新規処方（CPOE）', 'طلب جديد (CPOE)'],
  '기록 추가(간호)': ['Add a record (nursing)', '記録を追加（看護）', 'إضافة سجل (تمريض)'],

  // ── 개인설정 — 음성 설정(VoiceEMR) ──
  '마이크': ['Microphone', 'マイク', 'الميكروفون'],
  '화자 음성 등록 (특정화자 인식)': ['Speaker voice enrolment (speaker recognition)', '話者音声の登録（特定話者認識）', 'تسجيل صوت المتحدث (التعرّف على المتحدث)'],
  '다자간 화자분리 테스트': ['Multi-speaker diarization test', '多人数の話者分離テスト', 'اختبار فصل المتحدثين المتعددين'],
  '맞춤 설정': ['Personal settings', 'カスタム設定', 'الإعدادات الشخصية'],
  '맞춤 문구를 불러오지 못했습니다': ['Could not load the custom phrases', 'カスタム文言を読み込めませんでした', 'تعذّر تحميل العبارات المخصصة'],
  '기본 설정을 불러오지 못했습니다': ['Could not load the default settings', '基本設定を読み込めませんでした', 'تعذّر تحميل الإعدادات الأساسية'],
  '설정 저장 실패': ['Failed to save the setting', '設定の保存に失敗しました', 'فشل حفظ الإعداد'],
  '발화(패턴) 입력': ['Enter the spoken phrase (pattern)', '発話（パターン）を入力', 'أدخل العبارة المنطوقة (النمط)'],
  '표준어/코드(canonical)': ['Standard term / code (canonical)', '標準語・コード（canonical）', 'المصطلح المعياري / الرمز (canonical)'],
  '동작 대상 ref(order-set/template/query id)': ['Target ref (order-set / template / query id)', '動作対象 ref（order-set/template/query id）', 'المرجع المستهدف (order-set / template / query id)'],
  '매크로 본문': ['Macro body', 'マクロ本文', 'نص الماكرو'],
  '추가 실패': ['Failed to add', '追加に失敗しました', 'فشلت الإضافة'],
  '변경 실패': ['Failed to change', '変更に失敗しました', 'فشل التغيير'],
  '삭제할까요?': ['Delete this?', '削除しますか？', 'هل تريد الحذف؟'],

  // ── 개인설정 — 내 처방 목록(내 코드) ──
  '내 처방 목록': ['My order list', '自分の処方リスト', 'قائمة طلباتي'],
  '자주 사용하는 약물/검사 코드를 관리합니다. 처방 검색 시 우선 표시됩니다.': ['Manage the drug and test codes you use most. They appear first when searching while prescribing.', 'よく使う薬品・検査コードを管理します。処方検索時に優先表示されます。', 'أدر رموز الأدوية والفحوصات التي تستخدمها كثيراً. تظهر أولاً عند البحث أثناء الوصف.'],
  '내 코드 목록': ['My codes', '自分のコード一覧', 'رموزي'],
  '처방 세트': ['Order sets', '処方セット', 'مجموعات الطلبات'],
  '과 카탈로그': ['Department catalogue', '診療科カタログ', 'كتالوج القسم'],
  '최다 사용 약물 Top5': ['Top 5 most-used drugs', '最も使用した薬品 上位5', 'أكثر 5 أدوية استخداماً'],
  '최다 사용 검사 Top5': ['Top 5 most-used tests', '最も使用した検査 上位5', 'أكثر 5 فحوصات استخداماً'],
  '+ 코드 추가': ['+ Add code', '+ コードを追加', '+ إضافة رمز'],
  '기본 용법': ['Default directions', '既定の用法', 'التعليمات الافتراضية'],
  '고정 해제': ['Unpin', '固定を解除', 'إلغاء التثبيت'],
  '등록된 코드가 없습니다. [+ 코드 추가] 버튼으로 추가하세요.': ['No codes registered. Use the [+ Add code] button to add one.', '登録されたコードはありません。［+ コードを追加］ボタンで追加してください。', 'لا توجد رموز مسجّلة. استخدم زر [+ إضافة رمز] لإضافة واحد.'],
  '코드가 제거되었습니다': ['Code removed', 'コードを削除しました', 'تمت إزالة الرمز'],
  '코드가 추가되었습니다': ['Code added', 'コードを追加しました', 'تمت إضافة الرمز'],
  '이미 등록된 코드이거나 추가에 실패했습니다': ['The code is already registered, or adding it failed', '既に登録されたコードか、追加に失敗しました', 'الرمز مسجّل بالفعل أو فشلت إضافته'],
  '+ 새 세트 만들기': ['+ Create a set', '+ 新しいセットを作成', '+ إنشاء مجموعة'],
  '처방 세트가 없습니다.': ['No order sets.', '処方セットがありません。', 'لا توجد مجموعات طلبات.'],
  '자주 쓰는 처방 조합을 세트로 만들어 보세요.': ['Turn the order combinations you use often into a set.', 'よく使う処方の組み合わせをセットにしてみましょう。', 'حوّل تركيبات الطلبات التي تستخدمها كثيراً إلى مجموعة.'],
  '더': ['more', 'さらに', 'المزيد'],
  '처방 세트가 생성되었습니다': ['Order set created', '処方セットを作成しました', 'تم إنشاء مجموعة الطلبات'],
  '처방 세트가 삭제되었습니다': ['Order set deleted', '処方セットを削除しました', 'تم حذف مجموعة الطلبات'],
  '세트가 적용되었습니다': ['Set applied', 'セットを適用しました', 'تم تطبيق المجموعة'],
  '세트 이름 *': ['Set name *', 'セット名 *', 'اسم المجموعة *'],
  '세트 이름을 입력하세요': ['Enter a set name', 'セット名を入力してください', 'أدخل اسم المجموعة'],
  '세트에 대한 간단한 설명': ['A short description of the set', 'セットの簡単な説明', 'وصف موجز للمجموعة'],
  '새 처방 세트': ['New order set', '新しい処方セット', 'مجموعة طلبات جديدة'],
  '약물/검사명': ['Drug / test name', '薬品・検査名', 'اسم الدواء / الفحص'],
  '약물/검사명 *': ['Drug / test name *', '薬品・検査名 *', 'اسم الدواء / الفحص *'],
  '기간 (일)': ['Duration (days)', '期間（日）', 'المدة (أيام)'],
  '진료과 권장 코드를 내 목록으로 가져옵니다.': ['Import the codes recommended by your department into your own list.', '診療科の推奨コードを自分のリストに取り込みます。', 'استورد الرموز الموصى بها من قسمك إلى قائمتك.'],
  '선택 가져오기': ['Import selected', '選択項目を取り込む', 'استيراد المحدد'],
  '항목을 선택하세요': ['Select at least one item', '項目を選択してください', 'اختر عنصراً واحداً على الأقل'],
  '카탈로그 항목이 없습니다.': ['No catalogue items.', 'カタログ項目がありません。', 'لا توجد عناصر في الكتالوج.'],
  '카탈로그에서 가져왔습니다': ['Imported from the catalogue', 'カタログから取り込みました', 'تم الاستيراد من الكتالوج'],
  '기본 설정': ['Defaults', '既定設定', 'الإعدادات الافتراضية'],
  '안내': ['Guidance', '案内', 'إرشاد'],
  '약물명, 코드, 성분명으로 검색...': ['Search by drug name, code or ingredient...', '薬品名・コード・成分名で検索...', 'ابحث باسم الدواء أو الرمز أو المادة الفعالة...'],
  '검색어를 입력하세요.': ['Enter a search term.', '検索語を入力してください。', 'أدخل كلمة للبحث.'],
  '별명': ['Alias', '別名', 'اسم مستعار'],
  '고정 (상단 표시)': ['Pin (show at top)', '固定（上部に表示）', 'تثبيت (إظهار في الأعلى)'],
  '내 목록에 추가': ['Add to my list', '自分のリストに追加', 'إضافة إلى قائمتي'],

  // ── 개인설정 — 내 전자서명 인증서(크롬만 · 법적·보안 안내문은 위 ④ 로 미등재) ──
  '내 전자서명 인증서': ['My signing certificate', '自分の電子署名証明書', 'شهادة التوقيع الخاصة بي'],
  '전자서명 인증서 관리 및 키 설정': ['Manage your signing certificate and key settings', '電子署名証明書の管理と鍵設定', 'إدارة شهادة التوقيع وإعدادات المفتاح'],
  '전자서명 인증서': ['Signing certificate', '電子署名証明書', 'شهادة التوقيع'],
  '알고리즘 선택': ['Choose an algorithm', 'アルゴリズムの選択', 'اختيار الخوارزمية'],
  '전자서명에 사용할 암호화 알고리즘을 선택하세요.': ['Choose the cryptographic algorithm to use for signing.', '電子署名に使用する暗号アルゴリズムを選択してください。', 'اختر الخوارزمية التشفيرية المستخدمة للتوقيع.'],
  'ECDSA P-256 (권장)': ['ECDSA P-256 (recommended)', 'ECDSA P-256（推奨）', 'ECDSA P-256 (موصى به)'],
  '빠른 서명 속도, 짧은 키 길이. 최신 표준.': ['Fast signing, short keys. Current standard.', '署名が高速で鍵長が短い。最新の標準。', 'توقيع سريع ومفاتيح قصيرة. المعيار الحديث.'],
  '광범위한 호환성. 전통적 알고리즘.': ['Broad compatibility. Traditional algorithm.', '幅広い互換性。従来のアルゴリズム。', 'توافق واسع. خوارزمية تقليدية.'],
  '본인 인증 설정': ['Set up identity verification', '本人認証の設定', 'إعداد التحقق من الهوية'],
  '개인키를 보호할 인증 방식을 설정하세요. 서명 시 매번 인증합니다.': ['Choose how your private key is protected. You will authenticate each time you sign.', '秘密鍵を保護する認証方式を設定してください。署名のたびに認証します。', 'اختر كيفية حماية مفتاحك الخاص. سيُطلب التحقق في كل مرة توقّع فيها.'],
  'Touch ID / Face ID가 이 기기에서 지원됩니다.': ['Touch ID / Face ID is supported on this device.', 'この端末では Touch ID / Face ID が利用できます。', 'يدعم هذا الجهاز Touch ID / Face ID.'],
  '이 기기에서 생체인증을 사용할 수 없어 PIN을 설정합니다.': ['Biometrics are unavailable on this device, so a PIN will be set instead.', 'この端末では生体認証が使えないため PIN を設定します。', 'المصادقة الحيوية غير متاحة على هذا الجهاز، لذا سيتم إعداد رمز PIN.'],
  'Touch ID / Face ID로 설정': ['Set up with Touch ID / Face ID', 'Touch ID / Face ID で設定', 'الإعداد باستخدام Touch ID / Face ID'],
  '또는 PIN으로 설정': ['Or set up with a PIN', 'または PIN で設定', 'أو الإعداد برمز PIN'],
  '생체인증이 등록되었습니다': ['Biometrics registered', '生体認証を登録しました', 'تم تسجيل المصادقة الحيوية'],
  '생체인증이 등록되었습니다.': ['Biometrics registered.', '生体認証を登録しました。', 'تم تسجيل المصادقة الحيوية.'],
  '서명 시 Touch ID / Face ID로 인증합니다': ['You will authenticate with Touch ID / Face ID when signing', '署名時に Touch ID / Face ID で認証します', 'ستتحقق باستخدام Touch ID / Face ID عند التوقيع'],
  '생체인증 등록에 실패했습니다.': ['Biometric registration failed.', '生体認証の登録に失敗しました。', 'فشل تسجيل المصادقة الحيوية.'],
  '생체인증을 먼저 등록해주세요.': ['Please register biometrics first.', '先に生体認証を登録してください。', 'يرجى تسجيل المصادقة الحيوية أولاً.'],
  'PIN은 6자리 숫자를 입력해주세요.': ['Please enter a 6-digit PIN.', 'PIN は6桁の数字を入力してください。', 'يرجى إدخال رمز PIN من 6 أرقام.'],
  'PIN은 6자리를 입력해주세요.': ['Please enter 6 digits for the PIN.', 'PIN は6桁を入力してください。', 'يرجى إدخال 6 أرقام لرمز PIN.'],
  'PIN이 일치하지 않습니다.': ['The PINs do not match.', 'PIN が一致しません。', 'رمزا PIN غير متطابقين.'],
  'PIN을 입력하세요': ['Enter your PIN', 'PIN を入力してください', 'أدخل رمز PIN'],
  'PIN을 입력하세요 (6자리)': ['Enter your PIN (6 digits)', 'PIN を入力してください（6桁）', 'أدخل رمز PIN (6 أرقام)'],
  'PIN 실패': ['PIN failures', 'PIN 失敗', 'محاولات PIN فاشلة'],
  'PIN (6자리)': ['PIN (6 digits)', 'PIN（6桁）', 'رمز PIN (6 أرقام)'],
  '생체인증 (Touch ID / Face ID)': ['Biometrics (Touch ID / Face ID)', '生体認証（Touch ID / Face ID）', 'مصادقة حيوية (Touch ID / Face ID)'],
  '인증 방식': ['Authentication method', '認証方式', 'طريقة المصادقة'],
  '브라우저 (IndexedDB)': ['Browser (IndexedDB)', 'ブラウザ（IndexedDB）', 'المتصفح (IndexedDB)'],
  '인증서 발급': ['Issue certificate', '証明書の発行', 'إصدار الشهادة'],
  '설정을 확인하고 인증서를 발급합니다.': ['Review the settings and issue the certificate.', '設定を確認して証明書を発行します。', 'راجع الإعدادات وأصدر الشهادة.'],
  '발급 중...': ['Issuing...', '発行中...', 'جارٍ الإصدار...'],
  '인증서 발급 완료': ['Certificate issued', '証明書の発行完了', 'تم إصدار الشهادة'],
  '인증서가 성공적으로 발급되었습니다.': ['The certificate was issued successfully.', '証明書が正常に発行されました。', 'تم إصدار الشهادة بنجاح.'],
  '인증서 발급에 실패했습니다.': ['Issuing the certificate failed.', '証明書の発行に失敗しました。', 'فشل إصدار الشهادة.'],
  '백업 파일을 안전한 곳에 보관하세요. 브라우저 데이터가 삭제되면 복원에 필요합니다.': ['Keep the backup file somewhere safe. You will need it to restore the key if browser data is cleared.', 'バックアップファイルを安全な場所に保管してください。ブラウザのデータが削除された場合の復元に必要です。', 'احتفظ بملف النسخ الاحتياطي في مكان آمن. ستحتاجه لاستعادة المفتاح إذا تم مسح بيانات المتصفح.'],
  '백업 파일 다운로드 (.hrkb)': ['Download backup file (.hrkb)', 'バックアップファイルをダウンロード (.hrkb)', 'تنزيل ملف النسخ الاحتياطي (.hrkb)'],
  '백업 파일이 다운로드되었습니다.': ['The backup file was downloaded.', 'バックアップファイルをダウンロードしました。', 'تم تنزيل ملف النسخ الاحتياطي.'],
  '백업': ['Backup', 'バックアップ', 'نسخة احتياطية'],
  '키 생성': ['Key generation', '鍵の生成', 'توليد المفتاح'],
  '키 복원': ['Key restore', '鍵の復元', 'استعادة المفتاح'],
  '키 복원 필요': ['Key restore required', '鍵の復元が必要です', 'استعادة المفتاح مطلوبة'],
  '서버에 인증서가 등록되어 있지만, 이 브라우저에 개인키가 없습니다. 백업 파일(.hrkb)로 복원해주세요.': ['A certificate is registered on the server, but this browser has no private key. Restore it from the backup file (.hrkb).', 'サーバーに証明書は登録されていますが、このブラウザに秘密鍵がありません。バックアップファイル(.hrkb)から復元してください。', 'الشهادة مسجّلة على الخادم، لكن لا يوجد مفتاح خاص في هذا المتصفح. استعده من ملف النسخ الاحتياطي (.hrkb).'],
  '백업 파일 선택': ['Choose backup file', 'バックアップファイルを選択', 'اختيار ملف النسخ الاحتياطي'],
  '복원 중...': ['Restoring...', '復元中...', 'جارٍ الاستعادة...'],
  '키가 복원되었습니다.': ['The key was restored.', '鍵を復元しました。', 'تمت استعادة المفتاح.'],
  '키 복원에 실패했습니다.': ['Restoring the key failed.', '鍵の復元に失敗しました。', 'فشلت استعادة المفتاح.'],
  'sign 발급': ['Issued by sign', 'sign による発行', 'صادرة عن sign'],
  'sign 전자서명 서비스에서 발급·관리': ['Issued and managed by the sign e-signature service', 'sign 電子署名サービスで発行・管理', 'تُصدر وتُدار عبر خدمة التوقيع الإلكتروني sign'],
  '별도 발급 절차가 필요 없습니다. 문서 서명 시 자동으로 인증서가 발급됩니다.': ['No separate issuance step is needed. A certificate is issued automatically when you sign a document.', '別途の発行手続きは不要です。文書に署名する際に自動で証明書が発行されます。', 'لا حاجة لخطوة إصدار منفصلة. تُصدر الشهادة تلقائياً عند توقيع مستند.'],
  '내 sign 인증서 정보는 여기서 확인할 수 없습니다': ['Your sign certificate details cannot be checked here', '自分の sign 証明書情報はここでは確認できません', 'لا يمكن التحقق من تفاصيل شهادة sign الخاصة بك هنا'],
  '유효기간(만료일)': ['Validity (expiry date)', '有効期間（満了日）', 'الصلاحية (تاريخ الانتهاء)'],
  '(사실상 무기한)': ['(effectively indefinite)', '（事実上無期限）', '(غير محدودة عملياً)'],
  '개인키 보관': ['Private key custody', '秘密鍵の保管', 'حفظ المفتاح الخاص'],
  '소프트웨어(브라우저)': ['Software (browser)', 'ソフトウェア（ブラウザ）', 'برمجي (المتصفح)'],
  '클라이언트 보관(HIS 미수탁)': ['Held by the client (not escrowed by the HIS)', 'クライアント保管（HIS は受託しない）', 'محفوظ لدى العميل (غير مودع لدى نظام المستشفى)'],
  '외부 서명서비스(sign)': ['External signing service (sign)', '外部署名サービス（sign）', 'خدمة توقيع خارجية (sign)'],
  '이전 인증서에서 키 교체됨': ['Key replaced from a previous certificate', '以前の証明書から鍵を交換しました', 'تم استبدال المفتاح من شهادة سابقة'],
  '로컬 키 상태': ['Local key status', 'ローカル鍵の状態', 'حالة المفتاح المحلي'],
  '키 사용 가능': ['Key available', '鍵が利用可能', 'المفتاح متاح'],
  '키 없음': ['No key', '鍵なし', 'لا يوجد مفتاح'],
  '개인키가 이 브라우저에 안전하게 저장되어 있습니다.': ['The private key is stored securely in this browser.', '秘密鍵はこのブラウザに安全に保存されています。', 'المفتاح الخاص محفوظ بأمان في هذا المتصفح.'],
  '개인키가 이 브라우저에 없습니다. 복원이 필요합니다.': ['This browser has no private key. It needs to be restored.', 'このブラウザに秘密鍵がありません。復元が必要です。', 'لا يوجد مفتاح خاص في هذا المتصفح. يلزم استعادته.'],
  '로컬 키가 없습니다.': ['There is no local key.', 'ローカル鍵がありません。', 'لا يوجد مفتاح محلي.'],
  '서명 테스트': ['Test signature', '署名テスト', 'اختبار التوقيع'],
  '서명 테스트 성공! 키가 정상 동작합니다.': ['Signature test passed — the key works.', '署名テスト成功。鍵は正常に動作します。', 'نجح اختبار التوقيع — المفتاح يعمل.'],
  '서명 테스트 실패': ['Signature test failed', '署名テストに失敗しました', 'فشل اختبار التوقيع'],
  '키 백업': ['Back up key', '鍵のバックアップ', 'نسخ المفتاح احتياطياً'],
  '키 교체': ['Replace key', '鍵の交換', 'استبدال المفتاح'],
  '키 교체 중...': ['Replacing key...', '鍵の交換中...', 'جارٍ استبدال المفتاح...'],
  '키 교체 완료! 새 키가 브라우저에 저장되었습니다.': ['Key replaced — the new key is stored in this browser.', '鍵の交換が完了しました。新しい鍵をブラウザに保存しました。', 'تم استبدال المفتاح — المفتاح الجديد محفوظ في هذا المتصفح.'],
  '키 교체에 실패했습니다.': ['Replacing the key failed.', '鍵の交換に失敗しました。', 'فشل استبدال المفتاح.'],
  '인증서 정지': ['Suspend certificate', '証明書の停止', 'تعليق الشهادة'],
  '인증서를 정지하시겠습니까? 정지된 인증서로는 서명할 수 없습니다.': ['Suspend this certificate? A suspended certificate cannot be used to sign.', '証明書を停止しますか？停止された証明書では署名できません。', 'هل تريد تعليق هذه الشهادة؟ لا يمكن التوقيع بشهادة معلّقة.'],
  '인증서가 정지되었습니다.': ['The certificate was suspended.', '証明書を停止しました。', 'تم تعليق الشهادة.'],
  '인증서 정지에 실패했습니다.': ['Suspending the certificate failed.', '証明書の停止に失敗しました。', 'فشل تعليق الشهادة.'],
  '인증서 정지·폐기는 관리자 권한입니다. 분실·유출이 의심되면 관리자에게 요청하거나 ‘키 교체’로 새 키를 발급하세요.': ['Suspending or revoking a certificate is an administrator action. If you suspect loss or exposure, ask an administrator, or issue a new key with “Replace key”.', '証明書の停止・失効は管理者権限です。紛失・漏えいが疑われる場合は管理者に依頼するか、「鍵の交換」で新しい鍵を発行してください。', 'تعليق الشهادة أو إلغاؤها من صلاحيات المسؤول. عند الاشتباه بفقدان أو تسريب، اطلب من المسؤول أو أصدر مفتاحاً جديداً عبر «استبدال المفتاح».'],
  // 🔴 문맥 키 — '정지'는 'Suspend'(동작)로 선점됨. 여기는 인증서 상태다.
  '정지@상태': ['Suspended', '停止中', 'معلّقة'],
  '최근 서명 이력': ['Recent signing history', '最近の署名履歴', 'سجل التوقيع الأخير'],
  '서명 일시': ['Signed at', '署名日時', 'وقت التوقيع'],
  '전자서명 안내': ['E-signature guide', '電子署名の案内', 'دليل التوقيع الإلكتروني'],
  '의사 전자서명 가이드': ['E-signature guide for doctors', '医師向け電子署名ガイド', 'دليل التوقيع الإلكتروني للأطباء'],
  '간호사 전자서명 가이드': ['E-signature guide for nurses', '看護師向け電子署名ガイド', 'دليل التوقيع الإلكتروني للممرضين'],
  '약사 전자서명 가이드': ['E-signature guide for pharmacists', '薬剤師向け電子署名ガイド', 'دليل التوقيع الإلكتروني للصيادلة'],
  '검사자 전자서명 가이드': ['E-signature guide for laboratory staff', '検査技師向け電子署名ガイド', 'دليل التوقيع الإلكتروني لفنيي المختبر'],
  '관리자 전자서명 가이드': ['E-signature guide for administrators', '管理者向け電子署名ガイド', 'دليل التوقيع الإلكتروني للمسؤولين'],
  // ── 내 비밀번호 변경(/settings/password · 2026-09-14) ──
  '변경하면 모든 기기에서 로그아웃되며 새 비밀번호로 다시 로그인합니다.': ['Changing it signs you out on all devices; sign in again with the new password.', '変更するとすべての端末でログアウトされ、新しいパスワードで再ログインします。', 'يؤدي التغيير إلى تسجيل خروجك من جميع الأجهزة؛ سجّل الدخول مجددًا بكلمة المرور الجديدة.'],
  '비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다.': ['Password changed. Going to the sign-in screen.', 'パスワードを変更しました。ログイン画面に移動します。', 'تم تغيير كلمة المرور. جارٍ الانتقال إلى شاشة تسجيل الدخول.'],
  '현재 비밀번호': ['Current password', '現在のパスワード', 'كلمة المرور الحالية'],
  '새 비밀번호 확인': ['Confirm new password', '新しいパスワード（確認）', 'تأكيد كلمة المرور الجديدة'],
  '비밀번호 규칙은 서버 정책이 판정합니다 — 맞지 않으면 사유가 아래에 표시됩니다.': ['Password rules are checked by the server policy — if it does not match, the reason appears below.', 'パスワード規則はサーバーのポリシーが判定します — 合わない場合は理由が下に表示されます。', 'تتحقق سياسة الخادم من قواعد كلمة المرور — إن لم تتطابق يظهر السبب أدناه.'],
  '새 비밀번호 두 칸이 일치하지 않습니다.': ['The two new password fields do not match.', '新しいパスワードの2つの欄が一致しません。', 'حقلا كلمة المرور الجديدة غير متطابقين.'],
  '비밀번호를 변경하지 못했습니다.': ['Could not change the password.', 'パスワードを変更できませんでした。', 'تعذّر تغيير كلمة المرور.'],
  '변경 중...': ['Changing...', '変更中...', 'جارٍ التغيير...'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const SETTINGS3_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const SETTINGS3_VERIFIED: ReadonlySet<string> = new Set();
