import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그 — 공용 컴포넌트 A(문서·전문진료·관리 부품 39파일). 담당 에이전트 소유(2026-09-09 P3 라운드 4 · 전수 스캔 후).
 * 키=한국어 원문 · 세 언어 키 집합 동일 · 전량 AI_DRAFT.
 * 🔴 먼저 등록된 카탈로그에 이미 있는 원문은 **등재하지 않았다**(사본은 죽은 키가 된다).
 * 🔴 카탈로그에 키를 넣어도 렌더 지점이 `<T>`/`tAttr` 를 지나지 않으면 화면은 바뀌지 않는다.
 * 등록은 registry.ts 가 한다(오케스트레이터 소유) — 이 파일의 표만 채운다.
 *
 * 🔴 **일부러 비워 둔 5키**(원문+미번역 티가 정직한 상태 — 지어내지 않았다):
 *   ① `⚠️ 누적용량 한계 약물 포함 — 이전 주기 누적을 반드시 확인하세요(자동 합산 미적용).`
 *   ② `⚠️ 산출값 대비 ±20% 초과 — 근거를 재확인하세요.`
 *   ③ `기관 항암 프로토콜·허가사항 원문과 대조했으며, 골수억제/장기기능에 따른 감량·연기 규칙을 확인했습니다. (필수)`
 *      → ①~③ 은 **화면 소스(RegimenOrderModal.tsx)가 "오역이 곧 과용량"이라 미등재를 명시**한 자리다.
 *        카탈로그가 그 결정을 뒤집으면 정본이 둘이 된다(P12).
 *   ④ `선택@행위` — 등재하면 `packContextGaps` 가 ru·kk·mn·th 에서 각각 +1 (그 팩들은 무문맥 `선택`
 *      을 갖고 있다) → `i18n-coverage-honesty.spec.ts` 의 GAP_BASELINE 이 깨진다. 팩을 채우거나
 *      기준선을 올리는 것은 팩·가드 소유자 몫이라 여기서 조용히 넘기지 않는다.
 *   ⑤ `측` — `${tAttr('좌')}${tAttr('측')}` 로 **한 글자씩 이어 붙이는** 자리다. en(' side')·ja('側')
 *      는 되지만 아랍어는 `يسار` + `جانب` 순서가 뒤집혀 틀린 말이 된다(어순이 깨질 수밖에 없다).
 *      화면이 `좌측`/`우측` 온전한 낱말을 쓰도록 고치는 것이 정답이라 카탈로그로 덮지 않았다.
 *
 * 🔴 값 앞의 **분리 공백**은 의도적이다 — 숫자·굵은 글씨 뒤에 이어 붙는 조각이라
 *    한국어(`21일`)는 붙고 라틴 문자(`21 days`)는 떨어져야 한다(clinical3.ts 선례).
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  // 2026-10-10 소아 성장 백분위 — 입력값 표시
  '입력값': ['Entered value', '入力値', 'قيمة مُدخلة'],
  '기준표로 계산한 값이 아닙니다(출처 미확인) — 판정에 쓰지 마세요': ['Not computed from a reference chart (source unverified) — do not use for judgment', '基準表で計算した値ではありません(出典未確認) — 判定に使わないでください', 'ليست محسوبة من جدول مرجعي (المصدر غير مُتحقق) — لا تستخدمها للحكم'],
  '참조곡선은 근사값(출처 확인 전) — 백분위 판정에 쓰지 마세요': ['Reference curves are approximate (source not yet verified) — do not use them to judge percentiles', '参照曲線は近似値(出典確認前) — 百分位の判定に使わないでください', 'المنحنيات المرجعية تقريبية (لم يُتحقق من المصدر) — لا تستخدمها للحكم على المئين'],
  /* ── components/ai — AI 제안 패널·초안 배너 ── */
  '적용 완료': ['Applied', '適用しました', 'تم التطبيق'],
  '무시됨': ['Dismissed', '無視しました', 'تم التجاهل'],
  '원자료가 없어 산출하지 않았습니다': ['Not computed — no source data available', '元データがないため算出していません', 'لم يتم الاحتساب — لا تتوفر بيانات مصدرية'],
  '응답을 받지 못해 규칙 기반 결과로 대체했습니다': ['No response received — replaced with a rule-based result', '応答が得られなかったためルールベースの結果に置き換えました', 'لم يتم تلقي أي رد — تم استبداله بنتيجة قائمة على القواعد'],
  '적용 사실이 감사기록에 남았습니다.': ['The fact that it was applied has been recorded in the audit log.', '適用した事実は監査記録に残りました。', 'تم تسجيل واقعة التطبيق في سجل التدقيق.'],
  '⚠️ 적용 사실을 감사기록에 남기지 못했습니다(서버 미응답) — 이 기록이 AI 초안에서 출발했음을 기록에 직접 남기세요.': [
    '⚠️ The application could not be recorded in the audit log (no server response) — state directly in the record that it started from an AI draft.',
    '⚠️ 適用の事実を監査記録に残せませんでした（サーバー未応答）— この記録がAI下書きから始まったことを記録に直接残してください。',
    '⚠️ تعذّر تسجيل واقعة التطبيق في سجل التدقيق (لا استجابة من الخادم) — دوّن في السجل مباشرةً أن هذا السجل بدأ من مسودة ذكاء اصطناعي.',
  ],
  '적용 사실은 이 기록의 AI 보조 표식으로 남습니다.': ['The application is retained as this record\'s AI-assisted marker.', '適用の事実はこの記録のAI補助マークとして残ります。', 'تبقى واقعة التطبيق كعلامة على مساعدة الذكاء الاصطناعي في هذا السجل.'],
  '검토함': ['Reviewed', '確認済み', 'تمت المراجعة'],
  '배너만 접습니다 — 프로비넌스는 유지됩니다': ['Collapses the banner only — the provenance is kept', 'バナーを閉じるだけです — プロビナンスは保持されます', 'يطوي الشعار فقط — يُحتفظ ببيان المصدر'],

  /* ── components/clinical-charts — 임상차트 실행기(각주·항암 레지멘) ──
   * 🔴 각주는 세 조각이 한 문장이다: `본 산출은` + <b>`보조도구`</b> + `이며 최종…`. */
  '본 산출은': ['This result is', '本算出は', 'هذا الناتج هو'],
  '보조도구': ['a decision-support tool', '補助ツール', 'أداة مساعدة'],
  '이며 최종 임상판단은 의사에게 귀속합니다.': [' and the final clinical judgment rests with the physician.', 'であり、最終的な臨床判断は医師に帰属します。', ' والحكم السريري النهائي يعود إلى الطبيب.'],
  '일@기간': [' days', '日', ' يوم'],
  '신장·체중 입력': ['Enter height and weight', '身長・体重を入力', 'أدخل الطول والوزن'],
  'Carboplatin=Calvert(AUC×(GFR+25)) — 기관 GFR 캡 정책 확인': [
    'Carboplatin = Calvert (AUC×(GFR+25)) — check your institution\'s GFR cap policy',
    'カルボプラチン=Calvert（AUC×(GFR+25)）— 施設のGFRキャップ方針を確認',
    'كاربوبلاتين = صيغة كالفرت (AUC×(GFR+25)) — تحقّق من سياسة حد GFR في المؤسسة',
  ],
  '순서': ['Seq.', '順序', 'التسلسل'],
  '기준용량': ['Standard dose', '基準用量', 'الجرعة المرجعية'],
  '투여일': ['Dosing days', '投与日', 'أيام الإعطاء'],
  '주입': ['Infusion', '注入', 'التسريب'],
  '계산 용량': ['Calculated dose', '計算用量', 'الجرعة المحسوبة'],
  '누적한계': ['Cumulative limit', '累積上限', 'الحد التراكمي'],
  '입력 대기': ['Awaiting input', '入力待ち', 'بانتظار الإدخال'],
  '전처치 (Premedication)': ['Premedication', '前投薬 (Premedication)', 'الأدوية التمهيدية (Premedication)'],
  '지지요법 (Supportive)': ['Supportive care', '支持療法 (Supportive)', 'الرعاية الداعمة (Supportive)'],
  '모든 약물 용량이 계산되면 저장할 수 있습니다.': ['You can save once every drug dose has been calculated.', 'すべての薬剤用量が計算されると保存できます。', 'يمكن الحفظ بعد احتساب جرعات جميع الأدوية.'],
  '처방 초안 생성…': ['Create draft orders…', '処方下書きを作成…', 'إنشاء مسودات الوصفات…'],
  '레지멘이 검수(「검증됨」) 승인된 후 활성화됩니다.': [
    'Enabled after the regimen has been reviewed and approved (“Verified”).',
    'レジメンが検収（「検証済み」）承認された後に有効になります。',
    'يُفعَّل بعد مراجعة النظام العلاجي واعتماده ("مُتحقَّق منه").',
  ],
  '용량 산출 완료 후 생성할 수 있습니다.': ['Available once dose calculation is complete.', '用量算出の完了後に作成できます。', 'يمكن الإنشاء بعد اكتمال احتساب الجرعة.'],
  '입력 필요': ['input required', '入力が必要です', '— الإدخال مطلوب'],
  '계산 오류': ['Calculation error', '計算エラー', 'خطأ في الحساب'],

  /* ── components/clinical-charts/RadsAssistPanel — 판독 보조 ── */
  '판독 보조 (RADS·영상 분류)': ['Reading support (RADS · imaging classification)', '読影補助（RADS・画像分類）', 'دعم القراءة (RADS · تصنيف التصوير)'],
  '보조도구 · 최종 판독/판단은 판독의·의사 귀속': [
    'Support tool · the final reading and judgment rest with the radiologist and physician',
    '補助ツール・最終的な読影/判断は読影医・医師に帰属',
    'أداة مساعدة · القراءة والحكم النهائيان من مسؤولية أخصائي الأشعة والطبيب',
  ],
  '분류 도구': ['Classification tools', '分類ツール', 'أدوات التصنيف'],
  '연관 검사 (선택)': ['Linked study (optional)', '関連検査（任意）', 'الفحص المرتبط (اختياري)'],
  '환자 컨텍스트가 없어 저장할 수 없습니다.': ['Cannot save — there is no patient context.', '患者コンテキストがないため保存できません。', 'لا يمكن الحفظ — لا يوجد سياق مريض.'],
  '등급을 선택/판정하면 저장할 수 있습니다.': ['You can save once a grade is selected or determined.', 'グレードを選択/判定すると保存できます。', 'يمكن الحفظ بعد اختيار الدرجة أو تحديدها.'],
  '최근 판독 보조 기록': ['Recent reading-support records', '最近の読影補助記録', 'سجلات دعم القراءة الأخيرة'],
  '판독 보조 결과 저장됨': ['Reading-support result saved', '読影補助の結果を保存しました', 'تم حفظ نتيجة دعم القراءة'],
  '— 없음 —': ['— None —', '— なし —', '— لا شيء —'],

  /* ── components/clinical-charts/RegimenOrderModal — 처방 초안 생성 ──
   * 🔴 누적용량·±20%·프로토콜 서약 3키는 위 머리 주석대로 **일부러 비어 있다**. */
  '처방 초안 생성': ['Create draft orders', '処方下書きの作成', 'إنشاء مسودات الوصفات'],
  'DRAFT로 생성됩니다 · 서명 전 처방 목록에서 재확인 필수 · 자동 확정 없음': [
    'Created as DRAFT · must be re-checked in the order list before signing · never confirmed automatically',
    'DRAFTとして作成されます・署名前に処方リストでの再確認が必須・自動確定はありません',
    'تُنشأ كمسودة (DRAFT) · يجب إعادة التحقق منها في قائمة الوصفات قبل التوقيع · لا اعتماد تلقائي',
  ],
  '생성된 초안은 처방 목록에서 확인·수정 후 서명하세요.': [
    'Review and edit the generated drafts in the order list, then sign.',
    '作成された下書きは処方リストで確認・修正のうえ署名してください。',
    'راجع المسودات المُنشأة وعدّلها في قائمة الوصفات ثم وقّع.',
  ],
  '이 환자의': ['This patient\'s', 'この患者の', 'لهذا المريض'],
  '이전 기록': ['prior records:', '既往記録', 'سجلات سابقة بعدد'],
  '이 있습니다(임상도구 결과 탭에서 주기·누적 확인).': [
    ' exist (check the cycle and cumulative dose on the clinical tool results tab).',
    'があります（臨床ツールの結果タブで周期・累積を確認）。',
    ' (راجع الدورة والجرعة التراكمية في تبويب نتائج الأدوات السريرية).',
  ],
  '용량 (mg) — 산출': ['Dose (mg) — calculated', '用量 (mg) — 算出', 'الجرعة (ملغ) — محسوبة'],
  '— 누적용량 확인 필수.': ['— the cumulative dose must be verified.', '— 累積用量の確認が必須です。', '— يجب التحقق من الجرعة التراكمية.'],
  '전처치(참고 — 별도 처방 필요)': ['Premedication (reference — a separate order is required)', '前投薬（参考 — 別途処方が必要）', 'الأدوية التمهيدية (للمرجع — تلزم وصفة منفصلة)'],
  '처방 초안': ['Draft orders', '処方下書き', 'مسودات الوصفات'],
  '건 생성': [' — Create', '件を作成', ' — إنشاء'],
  '약물코드 검색(필수 — 자동 매핑 없음)': ['Search medication code (required — no automatic mapping)', '薬剤コード検索（必須 — 自動マッピングなし）', 'ابحث عن رمز الدواء (إلزامي — لا يوجد ربط تلقائي)'],

  /* ── components/hotkeys — 단축키 도움말 ── */
  '⌨️ 단축키 도움말': ['⌨️ Keyboard shortcuts', '⌨️ ショートカットヘルプ', '⌨️ مساعدة اختصارات لوحة المفاتيح'],
  '이 도움말 열기/닫기': ['Open/close this help', 'このヘルプを開く/閉じる', 'فتح/إغلاق هذه المساعدة'],

  /* ── components/imaging — 이송 전 영상 안전 확인 ──
   * 🔴 "확인하지 못한 상태"는 **해당 없음이 아니다** — 세 조각이 한 문장으로 이어진다. */
  '안전 확인 중…': ['Checking safety…', '安全確認中…', 'جارٍ التحقق من السلامة…'],
  '⚠️ 안전 확인을 불러오지 못했습니다 — 조영제·임신·피폭 판정을': [
    '⚠️ Could not load the safety check — the contrast media, pregnancy and radiation exposure assessment is',
    '⚠️ 安全確認を読み込めませんでした — 造影剤・妊娠・被曝の判定を',
    '⚠️ تعذّر تحميل فحص السلامة — تقييم مادة التباين والحمل والتعرّض للإشعاع',
  ],
  '확인하지 못한 상태': ['not confirmed', '確認できていない状態', 'لم يتم التحقق منه'],
  '입니다. 이송 전 직접 확인하세요': ['. Verify it yourself before transport', 'です。搬送前に直接確認してください', '. تحقّق بنفسك قبل النقل'],
  '검사 종류 미상': ['Study type unknown', '検査種別 不明', 'نوع الفحص غير معروف'],
  '전리방사선': ['Ionizing radiation', '電離放射線', 'إشعاع مؤيّن'],
  '이송 전 확인': ['check before transport', '搬送前に確認', 'تحقّق قبل النقل'],
  '⚠️ 검사 종류를 판정하지 못했습니다(처방에 시술코드 없음) — 조영제·임신 여부·피폭을': [
    '⚠️ Could not determine the study type (no procedure code on the order) — contrast media, pregnancy status and radiation exposure',
    '⚠️ 検査種別を判定できませんでした（処方に手技コードなし）— 造影剤・妊娠の有無・被曝を',
    '⚠️ تعذّر تحديد نوع الفحص (لا يوجد رمز إجراء في الطلب) — مادة التباين وحالة الحمل والتعرّض للإشعاع',
  ],
  '이 화면이 확인해 주지 못합니다.': ['cannot be checked for you on this screen.', 'この画面では確認できません。', 'لا يمكن لهذه الشاشة التحقق منها.'],
  '직접 확인하세요': ['Verify them yourself', '直接確認してください', 'تحقّق منها بنفسك'],
  '검사인데 판정 항목이 비어 있습니다 — 안전 확인 결과를 받지 못했습니다': [
    'study, but the assessment list is empty — no safety check result was received',
    '検査なのに判定項目が空です — 安全確認の結果を受け取れませんでした',
    '— فحص بلا بنود تقييم: لم يتم استلام نتيجة فحص السلامة',
  ],
  '확인 항목 없음(조영·방사선 검사 아님)': ['No items to check (not a contrast or radiation study)', '確認項目なし（造影・放射線検査ではありません）', 'لا توجد بنود للتحقق (ليس فحصًا بالتباين أو بالإشعاع)'],

  /* ── components/nursing — 간호사 전용 가드·간호기록·활력 추이 ── */
  '이 페이지는': ['This page is a', 'このページは', 'هذه الصفحة'],
  '간호사 전용': ['nurse-only', '看護師専用', 'للتمريض فقط'],
  '편집 화면입니다.': ['editing screen.', 'の編集画面です。', '— شاشة تحرير.'],
  '계정으로 로그인되어 있어 열람만 가능합니다.': [
    'account is signed in, so you have view-only access.',
    'アカウントでログインしているため、閲覧のみ可能です。',
    'الحساب مسجّل الدخول، لذا لديك صلاحية العرض فقط.',
  ],
  '입원 상세로 돌아가기': ['Back to admission details', '入院詳細に戻る', 'العودة إلى تفاصيل الإدخال'],
  '간호기록 저장에 실패했습니다.': ['Failed to save the nursing note.', '看護記録の保存に失敗しました。', 'فشل حفظ سجل التمريض.'],
  '본문을 입력하세요 — SBAR 은 최소 한 칸, 자유 텍스트는 내용이 필요합니다.': [
    'Enter the body text — SBAR needs at least one field filled in, and free text needs content.',
    '本文を入力してください — SBARは最低1欄、自由テキストは内容が必要です。',
    'أدخل نص السجل — يتطلب SBAR تعبئة حقل واحد على الأقل، ويتطلب النص الحر محتوى.',
  ],
  '바이탈 트렌드': ['Vital signs trend', 'バイタルトレンド', 'اتجاه العلامات الحيوية'],
  '통증 NRS': ['Pain NRS', '疼痛 NRS', 'الألم NRS'],
  '주간 07-15': ['Day shift 07-15', '日勤 07-15', 'الوردية النهارية 07-15'],
  '준야 15-23': ['Evening shift 15-23', '準夜勤 15-23', 'الوردية المسائية 15-23'],
  '야간 23-07': ['Night shift 23-07', '夜勤 23-07', 'الوردية الليلية 23-07'],

  /* ── components/specialty — 전문진료 도표(안과·이비인후과·치과·소아·정형·피부) ── */
  '전후 비교 (Before / After)': ['Before / After comparison', '前後比較 (Before / After)', 'مقارنة قبل / بعد'],
  '이미지 없음': ['No image', '画像なし', 'لا توجد صورة'],
  '드래그하여 비교 (좌우 화살표 키 사용 가능)': [
    'Drag to compare (left/right arrow keys also work)',
    'ドラッグして比較（左右の矢印キーも使用可）',
    'اسحب للمقارنة (يمكن استخدام مفتاحي السهم يمين/يسار)',
  ],
  '전후 비교 슬라이더': ['Before/after comparison slider', '前後比較スライダー', 'شريط تمرير للمقارنة قبل/بعد'],
  '병변 추가': ['Add lesion', '病変を追加', 'إضافة آفة'],
  '신체 부위 다이어그램': ['Body region diagram', '身体部位ダイアグラム', 'مخطط مناطق الجسم'],
  '화상 차트': ['Burn chart', '熱傷チャート', 'مخطط الحروق'],
  '근력 검사 (Motor Exam)': ['Motor exam', '筋力検査 (Motor Exam)', 'فحص القوة العضلية (Motor Exam)'],
  '근력 검사 다이어그램': ['Motor exam diagram', '筋力検査ダイアグラム', 'مخطط فحص القوة العضلية'],
  '상측(Superior)': ['Superior', '上側(Superior)', 'علوي (Superior)'],
  '하측(Inferior)': ['Inferior', '下側(Inferior)', 'سفلي (Inferior)'],
  '이측(Temporal)': ['Temporal', '耳側(Temporal)', 'صدغي (Temporal)'],
  '비측(Nasal)': ['Nasal', '鼻側(Nasal)', 'أنفي (Nasal)'],
  '안저 소견 (Fundus)': ['Fundus findings', '眼底所見 (Fundus)', 'موجودات قاع العين (Fundus)'],
  '안저 차트': ['Fundus chart', '眼底チャート', 'مخطط قاع العين'],
  '성장곡선': ['Growth curve', '成長曲線', 'منحنى النمو'],
  '환자 성별이 확인되지 않아': ['The patient\'s sex is not confirmed, so', '患者の性別が確認できないため', 'لم يتم تأكيد جنس المريض، لذلك'],
  '백분위 참조곡선을 표시하지 않습니다': ['the percentile reference curves are not shown', 'パーセンタイル基準曲線は表示しません', 'لا تُعرض منحنيات النسب المئوية المرجعية'],
  ' — 계측값만 그립니다.': [' — only the measured values are plotted.', ' — 計測値のみを描画します。', ' — تُرسم القيم المقيسة فقط.'],
  '참조표 범위(0~60개월) 밖 계측': [
    'Measurements outside the reference table range (0–60 months):',
    '参照表の範囲（0〜60か月）外の計測',
    'قياسات خارج نطاق الجدول المرجعي (0–60 شهرًا):',
  ],
  '건은 도표에서 제외했습니다.': [' were excluded from the chart.', '件はグラフから除外しました。', ' منها مستبعدة من الرسم البياني.'],
  '표시할 계측값이 없습니다.': ['There are no measurements to display.', '表示する計測値がありません。', 'لا توجد قياسات للعرض.'],
  '성장곡선 차트': ['Growth curve chart', '成長曲線チャート', 'مخطط منحنى النمو'],
  '안압 데이터 없음': ['No intraocular pressure data', '眼圧データなし', 'لا توجد بيانات ضغط العين'],
  '안압 추이 (IOP Trend)': ['Intraocular pressure trend (IOP)', '眼圧推移 (IOP Trend)', 'اتجاه ضغط العين (IOP)'],
  '회 중': [' measurements:', '回中', ' قياسًا:'],
  '회는 한쪽 이상이 미측정이라 그 지점에서 선이 끊깁니다': [
    ' had at least one eye unmeasured, so the line breaks at those points',
    '回は片眼以上が未測定のため、その地点で線が途切れます',
    ' منها لم يُقَس فيها أحد الجانبين على الأقل، لذا ينقطع الخط عند تلك النقاط',
  ],
  '안압 추이 차트': ['Intraocular pressure trend chart', '眼圧推移チャート', 'مخطط اتجاه ضغط العين'],
  '비강 단면 (Nasal Cavity)': ['Nasal cavity cross-section', '鼻腔断面 (Nasal Cavity)', 'مقطع تجويف الأنف (Nasal Cavity)'],
  '비강 단면 다이어그램': ['Nasal cavity cross-section diagram', '鼻腔断面ダイアグラム', 'مخطط مقطع تجويف الأنف'],
  '좌측': ['Left', '左側', 'يسار'],
  '우측': ['Right', '右側', 'يمين'],
  '비중격 만곡': ['Septal deviation', '鼻中隔弯曲', 'انحراف الحاجز الأنفي'],
  '비중격 정상': ['Septum normal', '鼻中隔 正常', 'الحاجز الأنفي طبيعي'],
  '치주 차트 (6-Point Pocket Depth)': ['Periodontal chart (6-point pocket depth)', '歯周チャート (6-Point Pocket Depth)', 'مخطط دواعم السن (عمق الجيب في 6 نقاط)'],
  '1-3mm (정상)': ['1-3 mm (normal)', '1-3mm（正常）', '1-3 مم (طبيعي)'],
  '4-5mm (주의)': ['4-5 mm (caution)', '4-5mm（注意）', '4-5 مم (تنبيه)'],
  '6mm+ (위험)': ['6 mm+ (risk)', '6mm+（危険）', '6 مم فأكثر (خطر)'],
  '출혈(BOP)': ['Bleeding (BOP)', '出血(BOP)', 'نزف (BOP)'],
  '치주 6점 포켓 깊이 차트': ['Periodontal 6-point pocket depth chart', '歯周6点ポケット深さチャート', 'مخطط عمق الجيب اللثوي في 6 نقاط'],
  '점수 추이 차트': ['Score trend chart', 'スコア推移チャート', 'مخطط اتجاه الدرجات'],
  '골절': ['Fracture', '骨折', 'كسر'],
  '5면 뷰': ['5-surface view', '5面ビュー', 'عرض الأسطح الخمسة'],
  '5면 다이어그램': ['5-surface diagram', '5面ダイアグラム', 'مخطط الأسطح الخمسة'],
  '고막': ['Tympanic membrane', '鼓膜', 'طبلة الأذن'],
  '고막 소견 (Tympanic Membrane)': ['Tympanic membrane findings', '鼓膜所見 (Tympanic Membrane)', 'موجودات طبلة الأذن (Tympanic Membrane)'],
  '고막 다이어그램': ['Tympanic membrane diagram', '鼓膜ダイアグラム', 'مخطط طبلة الأذن'],
  '시야 검사 (Visual Field)': ['Visual field test', '視野検査 (Visual Field)', 'فحص المجال البصري (Visual Field)'],
  '시야 검사 맵': ['Visual field map', '視野検査マップ', 'خريطة المجال البصري'],
  '감도 격자 자료 없음': ['No sensitivity grid data', '感度グリッドのデータなし', 'لا توجد بيانات شبكة الحساسية'],

  // 초안≠확정 배너(2026-09-10) — 🔴 종전엔 이 두 문장이 통째로 미배선이었다(영어 화면에 한국어).
  //    문장 안에 변수(서명 라벨·항목·시각)가 끼어 있어 조각으로는 어순이 성립하지 않는다 → 보간 키.
  // 🔴 `서명` 은 이미 'Signed'(과거분사)로 등재돼 있어 **동사 자리에 쓰면 "then Signed" 가 된다**.
  //    동작형 문맥 키를 따로 둔다(품사가 다르면 다른 키다 — 승인@버튼/반려@버튼 선례).
  '서명@동작': ['signing', '署名', 'التوقيع'],
  '적용됨 —': ['applied —', '適用されました —', 'طُبِّق —'],
  '{서명} 전 · 확정 아님': [
    'before {서명} · not final',
    '{서명}前・確定ではありません',
    'قبل {서명} · غير نهائي',
  ],
  /* 🔴 공백을 **자리표시자 밖**에 둔다 — 파라미터에 공백을 실으면 언어마다 구두점 앞에 빈칸이 남는다
   *    (`Applied 14:30 .`). 그래서 항목·시각 유무로 네 갈래를 둔다: 문장이 언어마다 온전해야 한다. */
  '{항목} 에 {시각} 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.': [
    'Applied to {항목} at {시각}. Review and edit the content, then complete {서명} — the record is final only after {서명}.',
    '{시각} に {항목} へ反映しました。内容を確認・修正のうえ{서명}してください — {서명}して初めて記録が確定します。',
    'طُبِّق على {항목} في {시각}. راجِع المحتوى وعدِّله ثم أكمِل {서명} — لا يصبح السجل نهائيًا إلا بعد {서명}.',
  ],
  '{항목} 에 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.': [
    'Applied to {항목}. Review and edit the content, then complete {서명} — the record is final only after {서명}.',
    '{항목} へ反映しました。内容を確認・修正のうえ{서명}してください — {서명}して初めて記録が確定します。',
    'طُبِّق على {항목}. راجِع المحتوى وعدِّله ثم أكمِل {서명} — لا يصبح السجل نهائيًا إلا بعد {서명}.',
  ],
  '{시각} 반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.': [
    'Applied at {시각}. Review and edit the content, then complete {서명} — the record is final only after {서명}.',
    '{시각} に反映しました。内容を確認・修正のうえ{서명}してください — {서명}して初めて記録が確定します。',
    'طُبِّق في {시각}. راجِع المحتوى وعدِّله ثم أكمِل {서명} — لا يصبح السجل نهائيًا إلا بعد {서명}.',
  ],
  '반영. 내용을 검토·수정한 뒤 {서명}하세요 — {서명}해야 기록이 확정됩니다.': [
    'Applied. Review and edit the content, then complete {서명} — the record is final only after {서명}.',
    '反映しました。内容を確認・修正のうえ{서명}してください — {서명}して初めて記録が確定します。',
    'طُبِّق. راجِع المحتوى وعدِّله ثم أكمِل {서명} — لا يصبح السجل نهائيًا إلا بعد {서명}.',
  ],

  /* 임상 척도 판정문(2026-09-10 회수) — CHA2DS2-VASc · CURB/PSI · Child-Pugh · MELD · eGFR(CKD) ·
   * qSOFA · DAS28. 🔴 **템플릿 리터럴로 조립돼 로케일과 무관하게 한국어로 나가던 자리**다.
   * 점수가 문장 가운데 들어가 조각으로는 어순이 깨지므로 자리표시자로 담는다.
   * 🔴 전부 국제 표준 척도의 표준 문구라 영어로 두는 편이 영어권 임상가에게 **더 안전**하다.
   *    다만 판정문은 오역이 곧 위해다 — 🧑 **임상 사람 검수 대상**(원내 표기 정책이 있으면 그쪽을 따른다). */
  '저위험 (연간 뇌졸중 위험 ~0%)': ['Low risk (annual stroke risk ~0%)', '低リスク（年間脳卒中リスク ~0%）', 'خطورة منخفضة (خطر السكتة السنوي ~0%)'],
  '중간위험 (연간 뇌졸중 위험 ~1.3%)': ['Moderate risk (annual stroke risk ~1.3%)', '中等度リスク（年間脳卒中リスク ~1.3%）', 'خطورة متوسطة (خطر السكتة السنوي ~1.3%)'],
  '고위험 (점수 {점수}, 항응고 치료 권고)': ['High risk (score {점수}, anticoagulation recommended)', '高リスク（スコア {점수}、抗凝固療法を推奨）', 'خطورة عالية (النتيجة {점수}، يُوصى بمضادات التخثر)'],
  '저위험 (외래 치료 가능)': ['Low risk (outpatient management possible)', '低リスク（外来治療が可能）', 'خطورة منخفضة (يمكن العلاج في العيادات الخارجية)'],
  '중간위험 (단기 입원 고려)': ['Moderate risk (consider short admission)', '中等度リスク（短期入院を検討）', 'خطورة متوسطة (يُنظر في إقامة قصيرة)'],
  '고위험 (점수 {점수}, 입원/ICU 권고)': ['High risk (score {점수}, admission/ICU recommended)', '高リスク（スコア {점수}、入院/ICU を推奨）', 'خطورة عالية (النتيجة {점수}، يُوصى بالإدخال/العناية المركزة)'],
  'Class A ({점수}점) - 양호한 간기능': ['Class A ({점수} points) - good liver function', 'Class A（{점수}点）- 良好な肝機能', 'Class A ({점수} نقاط) - وظيفة كبدية جيدة'],
  'Class B ({점수}점) - 중등도 간기능 저하': ['Class B ({점수} points) - moderate hepatic impairment', 'Class B（{점수}点）- 中等度の肝機能低下', 'Class B ({점수} نقاط) - قصور كبدي متوسط'],
  'Class C ({점수}점) - 중증 간기능 저하': ['Class C ({점수} points) - severe hepatic impairment', 'Class C（{점수}点）- 重度の肝機能低下', 'Class C ({점수} نقاط) - قصور كبدي شديد'],
  'MELD {점수} - 3개월 사망률 < 2%': ['MELD {점수} - 3-month mortality < 2%', 'MELD {점수} - 3か月死亡率 < 2%', 'MELD {점수} - معدل الوفيات خلال 3 أشهر < 2%'],
  'MELD {점수} - 3개월 사망률 6-20%': ['MELD {점수} - 3-month mortality 6-20%', 'MELD {점수} - 3か月死亡率 6-20%', 'MELD {점수} - معدل الوفيات خلال 3 أشهر 6-20%'],
  'MELD {점수} - 3개월 사망률 > 20%, 이식 고려': ['MELD {점수} - 3-month mortality > 20%, consider transplant', 'MELD {점수} - 3か月死亡率 > 20%、移植を検討', 'MELD {점수} - معدل الوفيات خلال 3 أشهر > 20%، يُنظر في الزراعة'],
  'eGFR {값} - G1 정상 또는 높음': ['eGFR {값} - G1 normal or high', 'eGFR {값} - G1 正常または高値', 'eGFR {값} - G1 طبيعي أو مرتفع'],
  'eGFR {값} - G2 경도 감소': ['eGFR {값} - G2 mildly decreased', 'eGFR {값} - G2 軽度低下', 'eGFR {값} - G2 انخفاض طفيف'],
  'eGFR {값} - G3a 경도-중등도 감소': ['eGFR {값} - G3a mildly to moderately decreased', 'eGFR {값} - G3a 軽度〜中等度低下', 'eGFR {값} - G3a انخفاض طفيف إلى متوسط'],
  'eGFR {값} - G3b 중등도-중증 감소': ['eGFR {값} - G3b moderately to severely decreased', 'eGFR {값} - G3b 中等度〜高度低下', 'eGFR {값} - G3b انخفاض متوسط إلى شديد'],
  'eGFR {값} - G4 중증 감소': ['eGFR {값} - G4 severely decreased', 'eGFR {값} - G4 高度低下', 'eGFR {값} - G4 انخفاض شديد'],
  'eGFR {값} - G5 신부전': ['eGFR {값} - G5 kidney failure', 'eGFR {값} - G5 腎不全', 'eGFR {값} - G5 فشل كلوي'],
  '저위험 (일반 감시)': ['Low risk (routine monitoring)', '低リスク（通常モニタリング）', 'خطورة منخفضة (مراقبة روتينية)'],
  '고위험 (qSOFA {점수}, 패혈증 의심 - SOFA 평가 권고)': ['High risk (qSOFA {점수}, sepsis suspected - SOFA assessment recommended)', '高リスク（qSOFA {점수}、敗血症疑い - SOFA 評価を推奨）', 'خطورة عالية (qSOFA {점수}، يُشتبه بالإنتان - يُوصى بتقييم SOFA)'],
  'DAS28 {점수} - 관해 (Remission)': ['DAS28 {점수} - remission', 'DAS28 {점수} - 寛解（Remission）', 'DAS28 {점수} - هدأة'],
  'DAS28 {점수} - 저활성도 (Low activity)': ['DAS28 {점수} - low disease activity', 'DAS28 {점수} - 低疾患活動性（Low activity）', 'DAS28 {점수} - نشاط مرضي منخفض'],
  'DAS28 {점수} - 중등도 활성 (Moderate activity)': ['DAS28 {점수} - moderate disease activity', 'DAS28 {점수} - 中等度疾患活動性（Moderate activity）', 'DAS28 {점수} - نشاط مرضي متوسط'],
  'DAS28 {점수} - 고활성도 (High activity)': ['DAS28 {점수} - high disease activity', 'DAS28 {점수} - 高疾患活動性（High activity）', 'DAS28 {점수} - نشاط مرضي عالٍ'],

  /* AI 3상태 정직성 문구(2026-09-10 회수) — 🔴 출처가 `AI`/`FALLBACK`/`UNAVAILABLE` 중 무엇인지
   * 말하는 자리다. 로케일과 무관하게 한국어로 나가면 **영어 화면에서 그 사실이 전달되지 않는다**.
   * `{출처}` 는 AI 표기(AI기본법 §31 · shared `AI_ORIGIN_TEXT`)라 번역하지 않고 그대로 넣는다. */
  '{출처} 호출 실패: {사유}': [
    '{출처} call failed: {사유}',
    '{출처} 呼び出し失敗: {사유}',
    'فشل استدعاء {출처}: {사유}',
  ],
  '{출처}를 호출하지 않았습니다 — 원자료가 생기면 다시 산출됩니다.': [
    '{출처} was not called — it will be computed again once source data exists.',
    '{출처} は呼び出していません — 元データができ次第、再計算されます。',
    'لم يُستدعَ {출처} — سيُحتسب مجددًا عند توفّر البيانات المصدرية.',
  ],
  '{출처} 미응답 · 규칙 대체': [
    '{출처} did not respond · rule-based fallback',
    '{출처} 応答なし · ルールで代替',
    'لم يستجب {출처} · بديل قائم على القواعد',
  ],
  '규칙 기반 대체 결과입니다({출처} 소견 아님) — 최종 판단은 의료진이 합니다.': [
    'This is a rule-based fallback result (not a {출처} finding) — the final judgement is the clinician\'s.',
    'ルールベースの代替結果です（{출처} の所見ではありません）— 最終判断は医療者が行います。',
    'هذه نتيجة بديلة قائمة على القواعد (وليست رأي {출처}) — القرار النهائي للطبيب.',
  ],
  /* 그 밖 회수(2026-09-10) */
  '입력 중: {상태}': ['Entering: {상태}', '入力中: {상태}', 'قيد الإدخال: {상태}'],
  '자가': ['Autologous', '自家', 'ذاتي'],
  '동종': ['Allogeneic', '同種', 'خيفي'],
  /* 🔴 `선택` 은 명사(Selection)로 선점돼 있어 동작 자리에서는 문장이 깨진다 — 문맥 키로 가른다.
   *    담당 갈래가 "등재하면 팩 결손이 는다"며 보류했던 키다. 팩 6종을 함께 채워 해소한다. */
  '선택@행위': ['Select', '選択', 'اختيار'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const COMP1_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const COMP1_VERIFIED: ReadonlySet<string> = new Set();
