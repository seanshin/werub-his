import type { MessageCatalog } from '../t';

/**
 * 영역 카탈로그 — 언어팩 사람 검수 화면(/admin/ui-locale/review · P1 신설). 담당 에이전트 소유(2026-09-09 P3 라운드 4 · 전수 스캔 후).
 * 키=한국어 원문 · 세 언어 키 집합 동일 · 전량 AI_DRAFT.
 * 🔴 먼저 등록된 카탈로그에 이미 있는 원문은 **등재하지 않았다**(사본은 죽은 키가 된다).
 *    실제로 16건(언어·검색·승인·제안·판정·표시·확인 불가·비고 …)이 다른 영역에 이미 있어 뺐다.
 * 🔴 카탈로그에 키를 넣어도 렌더 지점이 `<T>`/`tAttr` 를 지나지 않으면 화면은 바뀌지 않는다.
 * 🔴 여기에는 **동적 키**도 담긴다 — 출처 배지(`I18N_VALUE_ORIGIN_TEXT`)·검수 상태
 *    (`I18N_REVIEW_STATE_TEXT`)·필터 라벨은 상수에서 와서 스캐너의 정적 `<T k="...">` 검사에
 *    걸리지 않는다. 이 자리를 빼먹으면 화면 절반이 조용히 한국어로 남는다.
 * 등록은 registry.ts 가 한다(오케스트레이터 소유) — 이 파일의 표만 채운다.
 */
// [en, ja, ar]
const TRANSLATIONS: Record<string, readonly [string, string, string]> = {
  /* ── 화면 제목·안내 ─────────────────────────────────────────────────────── */
  '언어팩 사람 검수': ['Language Pack Human Review', '言語パック人手レビュー', 'المراجعة البشرية لحزمة اللغة'],
  '← 번역 검수 관제(현황)': ['← Translation review overview', '← 翻訳レビュー現況', '← لوحة مراجعة الترجمة'],
  '코드에 들어 있는 AI 초안 번역을 언어 전문가가 읽고 고치고 \'검수했다\'를 남기는 화면입니다. 원문(한국어)은 키이자 정본이라 여기서 바꾸지 않습니다.': [
    'A language expert reads, corrects and signs off the AI draft translations that live in the code. The Korean source text is the key and the single source of truth, so it is not edited here.',
    'コードに入っている AI 下書き翻訳を言語専門家が読み、修正し、「レビュー済み」を残す画面です。原文（韓国語）はキーであり正本なので、ここでは変更しません。',
    'شاشة يقرأ فيها خبير اللغة مسودات الترجمة المولّدة بالذكاء الاصطناعي داخل الشيفرة ويصححها ويسجّل أنه راجعها. النص الكوري الأصلي هو المفتاح والمرجع، ولا يُعدّل هنا.',
  ],
  '저장(제안)은 화면에 반영되지 않습니다 — 승인된 것만 나갑니다.': [
    'Saving creates a proposal; it does not change the UI. Only approved values ship.',
    '保存（提案）は画面に反映されません — 承認されたものだけが出ます。',
    'الحفظ يُنشئ اقتراحًا ولا يغيّر الواجهة — لا يظهر إلا ما تمت الموافقة عليه.',
  ],
  "승인한 값은 DB 오버레이로 코드 초안 위에 얹힙니다. 정본은 여전히 카탈로그 파일(코드)이며, 아래 '내보내기' 텍스트를 사람이 파일에 반영·커밋해야 코드로 수렴합니다(자동 커밋 없음).": [
    'Approved values are laid over the code draft as a DB overlay. The source of truth is still the catalog file (code): a person must apply and commit the export text below for it to converge into code (no automatic commit).',
    '承認された値は DB オーバーレイとしてコード下書きの上に重なります。正本は依然としてカタログファイル（コード）であり、下の「エクスポート」テキストを人がファイルに反映・コミットして初めてコードに収束します（自動コミットはありません）。',
    'تُوضع القيم المعتمدة فوق مسودة الشيفرة كطبقة في قاعدة البيانات. المرجع يبقى ملف الفهرس (الشيفرة): يجب أن يطبّق شخص نص التصدير أدناه ويحفظه في المستودع (لا يوجد حفظ تلقائي).',
  ],
  '일괄 승인은 없습니다 — 건별로만 판정합니다. 제안자와 승인자가 같으면 막지 않고 그 사실을 목록에 남깁니다.': [
    'There is no bulk approval — decisions are made one by one. If proposer and approver are the same person it is not blocked, but that fact is recorded in the list.',
    '一括承認はありません — 1 件ずつ判定します。提案者と承認者が同じでもブロックせず、その事実を一覧に残します。',
    'لا توجد موافقة جماعية — يتم البتّ في كل بند على حدة. إذا كان المقترح والمعتمد الشخص نفسه فلا يُمنع، لكن تُسجَّل هذه الحقيقة في القائمة.',
  ],
  '번역을 직접 읽고 고치고 \'검수했다\'를 남기려면 사람 검수 워크리스트로 갑니다(건별 승인 · 기록≠적용).': [
    'To read, correct and sign off translations yourself, go to the human review worklist (per-item approval · recorded ≠ applied).',
    '翻訳を直接読み、修正し、「レビュー済み」を残すには人手レビューのワークリストへ（1 件ずつ承認・記録≠適用）。',
    'لقراءة الترجمات وتصحيحها وتسجيل مراجعتها، انتقل إلى قائمة عمل المراجعة البشرية (موافقة فردية · التسجيل ≠ التطبيق).',
  ],

  /* ── 필터·목록 ──────────────────────────────────────────────────────────── */
  '상태·성격': ['Status / kind', '状態・性格', 'الحالة والنوع'],
  '전체 영역': ['All areas', '全領域', 'كل المجالات'],
  '원문·번역 부분 일치 검색 후 Enter': ['Search source or translation, then press Enter', '原文・訳文の部分一致を入力し Enter', 'ابحث في النص الأصلي أو الترجمة ثم اضغط Enter'],
  '한국어는 검수 대상이 아닙니다(원문이 곧 키입니다)': ['Korean is not reviewable — the source text is the key', '韓国語はレビュー対象ではありません（原文がキーです）', 'الكورية ليست قابلة للمراجعة — النص الأصلي هو المفتاح'],
  '별도 트랙': ['Separate track', '別トラック', 'مسار منفصل'],
  '검수 목록을 불러오는 중입니다': ['Loading the review list', 'レビュー一覧を読み込み中です', 'جارٍ تحميل قائمة المراجعة'],
  '이 필터에 해당하는 키가 없습니다': ['No keys match this filter', 'このフィルターに該当するキーはありません', 'لا توجد مفاتيح تطابق هذا المرشّح'],
  "필터를 바꾸거나 다른 언어를 선택하세요 — '없음'은 조회에 성공했다는 뜻입니다": [
    'Change the filter or pick another language — "none" here means the query succeeded',
    'フィルターを変えるか他の言語を選んでください — 「なし」は照会に成功したという意味です',
    'غيّر المرشّح أو اختر لغة أخرى — «لا شيء» هنا تعني أن الاستعلام نجح',
  ],
  '이 필터의 전체': ['Total for this filter', 'このフィルターの全体', 'الإجمالي لهذا المرشّح'],
  '카탈로그 전집': ['Whole catalog', 'カタログ全体', 'الفهرس كاملًا'],
  '더 보기 — 아래에 더 있습니다(전건이 아닙니다)': ['Show more — there are more below (not all items)', 'もっと見る — 下にまだあります（全件ではありません）', 'عرض المزيد — هناك المزيد أدناه (ليست كل البنود)'],
  '이 필터의 전건을 표시했습니다': ['All items for this filter are shown', 'このフィルターの全件を表示しました', 'تم عرض كل بنود هذا المرشّح'],

  /* ── 필터 라벨(동적) ───────────────────────────────────────────────────── */
  '미검수': ['Not reviewed', '未レビュー', 'لم تُراجَع'],
  '제안됨': ['Proposed', '提案済み', 'مُقترح'],
  '반려됨': ['Rejected', '差戻し', 'مرفوض'],
  '코드 반영됨': ['Merged into code', 'コード反映済み', 'مدمج في الشيفرة'],
  '문맥 결손': ['Missing context variant', '文脈欠落', 'نقص في متغيّر السياق'],
  '안전 키': ['Safety-critical key', '安全キー', 'مفتاح حرج للسلامة'],
  '미번역': ['Untranslated', '未翻訳', 'غير مترجم'],
  '원본 바뀜': ['Source changed', '原本が変わった', 'تغيّر النص الأصلي'],
  '반려됨(번역하지 않음 포함)': ['Rejected (includes "leave untranslated")', '差戻し（「翻訳しない」を含む）', 'مرفوض (يشمل «تُترك بلا ترجمة»)'],

  /* ── 출처 배지(동적) ───────────────────────────────────────────────────── */
  '미번역(원문 표시)': ['Untranslated (source shown)', '未翻訳（原文表示）', 'غير مترجم (يُعرض النص الأصلي)'],
  '코드 AI 초안': ['Code AI draft', 'コードの AI 下書き', 'مسودة ذكاء اصطناعي في الشيفرة'],
  '코드 검수 완료': ['Reviewed in code', 'コードでレビュー済み', 'مُراجَع في الشيفرة'],
  '검수 완료(오버레이)': ['Reviewed (overlay)', 'レビュー済み（オーバーレイ）', 'مُراجَع (طبقة)'],

  /* ── 통계 ───────────────────────────────────────────────────────────────── */
  '검수됨 / 키 전집': ['Reviewed / all keys', 'レビュー済み / キー全体', 'مُراجَع / كل المفاتيح'],
  '승인·반려·코드반영 = 사람이 판정을 남긴 키': ['Approved, rejected and merged = keys a person has ruled on', '承認・差戻し・コード反映＝人が判定を残したキー', 'المعتمد والمرفوض والمدمج = مفاتيح بتّ فيها إنسان'],
  '번역됨 / 키 전집': ['Translated / all keys', '翻訳済み / キー全体', 'مترجم / كل المفاتيح'],
  '번역 등재 여부일 뿐 검수 여부가 아님': ['Whether a translation exists — not whether it was reviewed', '訳が登録されているかであり、レビュー済みかではない', 'وجود ترجمة فقط، وليس كونها مُراجَعة'],
  '제안 대기': ['Awaiting decision', '判定待ち', 'بانتظار البتّ'],
  '사람이 승인·반려를 기다리는 건': ['Items waiting for a person to approve or reject', '人の承認・差戻しを待っている件', 'بنود تنتظر موافقة أو رفضًا من إنسان'],
  '임상·규제 — 먼저 처리': ['Clinical and regulatory — handle first', '臨床・規制 — 先に処理', 'سريري وتنظيمي — عالجها أولًا'],
  '뜻이 틀린 번역이 나가는 자리': ['Where a wrong-meaning translation ships', '意味の違う訳が出てしまう箇所', 'مواضع تخرج فيها ترجمة بمعنى خاطئ'],
  '승인했지만 코드에 없음': ['Approved but not in code', '承認済みだがコードにない', 'معتمد لكنه غير موجود في الشيفرة'],
  '오버레이를 끄면 사라지는 값 — 내보내기 후 커밋 필요': ['Values that disappear if the overlay is turned off — export and commit them', 'オーバーレイを切ると消える値 — エクスポートしてコミットが必要', 'قيم تختفي عند إيقاف الطبقة — صدّرها واحفظها في الشيفرة'],
  '코드 검수 표기(VERIFIED)': ['Code-side VERIFIED marks', 'コード側の VERIFIED 表記', 'علامات VERIFIED في الشيفرة'],
  '코드 카탈로그가 스스로 검수라 밝힌 키': ['Keys the code catalog itself marks as reviewed', 'コードカタログが自らレビュー済みと示すキー', 'مفاتيح يعلن فهرس الشيفرة نفسه أنها مُراجَعة'],
  '사람 판정이 아직 없는 키': ['Keys with no human ruling yet', 'まだ人の判定がないキー', 'مفاتيح لم يبتّ فيها إنسان بعد'],

  /* ── 행(워크리스트) ─────────────────────────────────────────────────────── */
  '지금 화면에 나가는 값': ['Value currently shown to users', '今画面に出ている値', 'القيمة المعروضة حاليًا للمستخدمين'],
  '번역 없음 — 한국어 원문이 나갑니다': ['No translation — the Korean source is shown', '訳なし — 韓国語の原文が出ます', 'لا ترجمة — يُعرض النص الكوري الأصلي'],
  '코드 초안': ['Code draft', 'コード下書き', 'مسودة الشيفرة'],
  '교정 입력(저장하면 제안됨)': ['Correction (saving makes it a proposal)', '修正入力（保存すると提案）', 'التصحيح (الحفظ يجعله اقتراحًا)'],
  '이 언어로 확정할 문구': ['The wording to settle on for this language', 'この言語で確定する文言', 'الصياغة المعتمدة لهذه اللغة'],
  "저장하면 '제안됨'으로 남고, 승인 전에는 화면에 반영되지 않습니다.": [
    'Saving records it as "proposed"; nothing changes on screen until it is approved.',
    '保存すると「提案済み」として残り、承認前は画面に反映されません。',
    'الحفظ يسجّله بحالة «مُقترح»، ولا يتغيّر شيء على الشاشة قبل الموافقة.',
  ],
  '쓰이는 곳': ['Used in', '使われている場所', 'مواضع الاستخدام'],
  '확인 불가(사용처 색인 없음)': ['Cannot tell (no usage index)', '確認不可（使用箇所インデックスなし）', 'يتعذّر التحقق (لا فهرس استخدام)'],
  '이 키를 쓰는 화면을 찾지 못했습니다': ['No screen using this key was found', 'このキーを使う画面は見つかりませんでした', 'لم يُعثر على شاشة تستخدم هذا المفتاح'],
  '작성자 미상': ['Author unknown', '作成者不明', 'الكاتب غير معروف'],
  '제안자=승인자': ['Proposer = approver', '提案者＝承認者', 'المقترح = المعتمد'],
  '제안자와 승인자가 같습니다 — 막지 않았고 이 사실이 원장에 남습니다': [
    'Proposer and approver are the same person — not blocked, and the fact is kept in the ledger',
    '提案者と承認者が同じです — ブロックはせず、この事実は台帳に残ります',
    'المقترح والمعتمد الشخص نفسه — لم يُمنع، والحقيقة مسجَّلة في السجل',
  ],
  '무문맥 번역은 있는데 이 문맥 변형이 없습니다 — 뜻이 틀린 번역이 나갑니다': [
    'A context-free translation exists but this context variant does not — a wrong-meaning translation ships',
    '文脈なしの訳はあるが、この文脈変種がありません — 意味の違う訳が出ます',
    'توجد ترجمة بلا سياق لكن لا يوجد هذا المتغيّر السياقي — تخرج ترجمة بمعنى خاطئ',
  ],
  '제안 당시 코드 값이 그 뒤 바뀌었습니다 — 재검수가 필요합니다': [
    'The code value changed after this was proposed — it needs re-review',
    '提案時のコード値がその後変わりました — 再レビューが必要です',
    'تغيّرت قيمة الشيفرة بعد الاقتراح — تحتاج إعادة مراجعة',
  ],
  '임상·규제 키 — 오역이 위해가 됩니다': ['Clinical or regulatory key — a mistranslation causes harm', '臨床・規制キー — 誤訳が危害になります', 'مفتاح سريري أو تنظيمي — الترجمة الخاطئة تسبّب ضررًا'],

  /* ── 결정 버튼 ──────────────────────────────────────────────────────────── */
  '교정 저장(제안)': ['Save correction (propose)', '修正を保存（提案）', 'حفظ التصحيح (اقتراح)'],
  '코드 반영 표시': ['Mark as merged into code', 'コード反映として表示', 'وسمه كمدمج في الشيفرة'],
  '교정 문구를 입력하세요 — 빈 값은 저장하지 않습니다': ['Enter the corrected wording — empty values are not saved', '修正文言を入力してください — 空の値は保存しません', 'أدخل الصياغة المصححة — لا تُحفظ القيم الفارغة'],
  '제안 기록이 없어 판정할 수 없습니다 — 먼저 교정을 저장하세요': [
    'There is no proposal to rule on — save a correction first',
    '提案記録がないため判定できません — まず修正を保存してください',
    'لا يوجد اقتراح للبتّ فيه — احفظ تصحيحًا أولًا',
  ],
  '제안 기록이 없습니다': ['There is no proposal', '提案記録がありません', 'لا يوجد اقتراح'],
  '승인된 항목만 코드 반영으로 표시할 수 있습니다': ['Only approved items can be marked as merged into code', '承認済みの項目だけをコード反映として表示できます', 'يمكن وسم البنود المعتمدة فقط كمدمجة في الشيفرة'],
  '지금은 할 수 없습니다': ['Not available right now', '今はできません', 'غير متاح الآن'],
  '판정을 남기지 못했습니다': ['Could not record the decision', '判定を残せませんでした', 'تعذّر تسجيل القرار'],
  '표시하지 못했습니다': ['Could not mark it', '表示できませんでした', 'تعذّر الوسم'],

  /* ── 권한 ───────────────────────────────────────────────────────────────── */
  '이 언어에서 지금 계정이 할 수 있는 일': ['What this account can do for this language', 'この言語で今のアカウントができること', 'ما يستطيع هذا الحساب فعله لهذه اللغة'],
  '권한 정보를 아직 받지 못했습니다 — 지금 무엇을 할 수 있는지 판정할 수 없습니다(권한이 없다는 뜻이 아닙니다).': [
    'Permission information has not arrived yet — we cannot tell what you may do (this does not mean you lack permission).',
    '権限情報をまだ受け取っていません — 今何ができるか判定できません（権限がないという意味ではありません）。',
    'لم تصل بيانات الصلاحيات بعد — لا يمكن تحديد ما يُسمح لك به (وهذا لا يعني أنك بلا صلاحية).',
  ],
  '승인·반려': ['Approve / reject', '承認・差戻し', 'الموافقة والرفض'],
  '검수자': ['Reviewers', 'レビュー担当', 'المراجعون'],

  /* ── 내보내기 ───────────────────────────────────────────────────────────── */
  '승인분 내보내기 — 코드로 수렴하는 경로': ['Export approved values — the path back into code', '承認分のエクスポート — コードへ収束する経路', 'تصدير القيم المعتمدة — طريق العودة إلى الشيفرة'],
  '내보내기 텍스트 만들기': ['Generate export text', 'エクスポートテキストを作成', 'إنشاء نص التصدير'],
  '이 텍스트는 코드가 아닙니다 — 사람이 카탈로그 파일에 반영·커밋해야 정본이 됩니다.': [
    'This text is not code — a person must apply and commit it to the catalog file for it to become the source of truth.',
    'このテキストはコードではありません — 人がカタログファイルに反映・コミットして初めて正本になります。',
    'هذا النص ليس شيفرة — يجب أن يطبّقه شخص في ملف الفهرس ويحفظه ليصبح المرجع.',
  ],
  '내보내지 못했습니다': ['Could not export', 'エクスポートできませんでした', 'تعذّر التصدير'],
  '승인분': ['Approved items', '承認分', 'البنود المعتمدة'],
  '이미 코드와 같은 것': ['Already identical to code', 'すでにコードと同じもの', 'مطابق للشيفرة أصلًا'],
  '사용처 색인을 만들지 못했습니다 — \'쓰이는 곳\'은 \'없음\'이 아니라 \'확인 불가\'입니다.': [
    'The usage index could not be built — "used in" reads as "cannot tell", not "none".',
    '使用箇所インデックスを作れませんでした — 「使われている場所」は「なし」ではなく「確認不可」です。',
    'تعذّر بناء فهرس الاستخدام — «مواضع الاستخدام» تعني «يتعذّر التحقق» لا «لا شيء».',
  ],

  /* ── §2.4 "번역하지 않음"(키만으로 반려) — 2026-09-09 서버 `reject-key` 신설분 ── */
  '번역하지 않음': ['Do not translate', '翻訳しない', 'عدم الترجمة'],
  '번역하지 않음(사유 필수)': ['Do not translate (reason required)', '翻訳しない（理由必須）', 'عدم الترجمة (السبب إلزامي)'],
  "사유·근거 — '번역하지 않음'에는 필수입니다": [
    'Reason or evidence — required for "do not translate"',
    '理由・根拠 — 「翻訳しない」には必須です',
    'السبب أو السند — إلزامي لخيار «عدم الترجمة»',
  ],
  "교정 저장·승인·반려에는 선택이지만, '번역하지 않음'에는 사유가 필수입니다(교정값이 없어 사유가 곧 판정의 내용입니다).": [
    'Optional when saving a correction, approving or rejecting — but required for "do not translate", because with no corrected value the reason is the content of the ruling.',
    '修正の保存・承認・差戻しでは任意ですが、「翻訳しない」には理由が必須です（修正値がないため理由がそのまま判定の中身になります）。',
    'اختياري عند حفظ التصحيح أو الموافقة أو الرفض، لكنه إلزامي لخيار «عدم الترجمة»، إذ لا توجد قيمة مصححة فيكون السبب هو مضمون القرار.',
  ],
  '사유가 필수입니다 — 교정값이 없어 사유가 곧 판정의 내용입니다(공백만은 사유가 아닙니다)': [
    'A reason is required — with no corrected value the reason is the content of the ruling (whitespace alone is not a reason)',
    '理由が必須です — 修正値がないため理由がそのまま判定の中身です（空白だけは理由ではありません）',
    'السبب إلزامي — لا توجد قيمة مصححة فالسبب هو مضمون القرار (المسافات وحدها ليست سببًا)',
  ],
  "아직 제안이 없는 키입니다 — 승인은 제안된 항목에만 남고, '번역하지 않음'은 사유만으로 남길 수 있습니다.": [
    'No proposal exists for this key yet — approval is recorded only on proposed items, while "do not translate" can be recorded with a reason alone.',
    'まだ提案のないキーです — 承認は提案済みの項目にのみ残り、「翻訳しない」は理由だけで残せます。',
    'لا يوجد اقتراح لهذا المفتاح بعد — تُسجَّل الموافقة على البنود المقترحة فقط، أما «عدم الترجمة» فيمكن تسجيله بالسبب وحده.',
  ],
  "🔴 안전 키입니다 — 번역하지 않고 원문으로 두는 것도 정답입니다(사유를 적어 '번역하지 않음'을 누르세요).": [
    '🔴 Safety-critical key — leaving it in the source language is also a correct answer (write a reason and press "do not translate").',
    '🔴 安全キーです — 翻訳せず原文のまま残すことも正解です（理由を書いて「翻訳しない」を押してください）。',
    '🔴 مفتاح حرج للسلامة — تركه بلغته الأصلية خيار صحيح أيضًا (اكتب سببًا واضغط «عدم الترجمة»).',
  ],
  '판정 사유': ['Decision reason', '判定理由', 'سبب القرار'],
  /**
   * 🔴 무문맥 '제안'·'판정'·'표시' 는 다른 카탈로그가 이미 **다른 뜻**으로 이겼다
   *    (Suggestion · Judgment · Mark). 행의 이 자리는 **사람**과 **표시 중인 건수**라
   *    그 정의를 쓰면 뜻이 틀린 번역이 나간다 — 지는 사본을 두지 않고 별도 원문을 쓴다.
   *    (버튼 '승인'·'반려'는 정본이 이미 `@버튼` 문맥 키를 갖고 있어 그것을 그대로 부른다.)
   */
  '제안자': ['Proposed by', '提案者', 'اقترحه'],
  '판정자': ['Decided by', '判定者', 'بتّ فيه'],
  '표시 중': ['Showing', '表示中', 'المعروض'],

  /* ── 🔴 기록 ≠ 적용 — 반려해도 코드 초안은 남는다(§2.5 코드 수렴) ── */
  '🔴 번역하지 않기로 판정했지만 코드에 AI 초안이 남아 화면에는 그 초안이 계속 나갑니다 — 개발자가 카탈로그에서 이 키를 빼야 반영됩니다(코드 수렴).': [
    '🔴 Ruled "do not translate", but the AI draft is still in the code, so that draft keeps shipping to users — a developer must remove this key from the catalog for the ruling to take effect (code convergence).',
    '🔴 「翻訳しない」と判定しましたが、コードに AI 下書きが残っており画面にはその下書きが出続けます — 開発者がカタログからこのキーを外して初めて反映されます（コード収束）。',
    '🔴 تقرّر «عدم الترجمة»، لكن مسودة الذكاء الاصطناعي ما زالت في الشيفرة فتظل تُعرض للمستخدمين — يجب أن يزيل المطوّر هذا المفتاح من الفهرس ليسري القرار (توافق الشيفرة).',
  ],
  '번역하지 않기로 판정했고, 코드에도 값이 없어 화면에는 원문+티가 나갑니다.': [
    'Ruled "do not translate", and the code has no value either, so the source text with a marker is shown.',
    '「翻訳しない」と判定し、コードにも値がないため画面には原文＋印が出ます。',
    'تقرّر «عدم الترجمة»، ولا توجد قيمة في الشيفرة أيضًا، فيُعرض النص الأصلي مع علامة.',
  ],
  '🔴 번역하지 않기로 했으나 코드에 초안이 남아 아직 그 초안이 화면에 나갑니다': [
    '🔴 Ruled "do not translate", but drafts remain in the code and are still shipping',
    '🔴 「翻訳しない」と決めたのにコードに下書きが残り、まだその下書きが出ています',
    '🔴 تقرّر «عدم الترجمة» لكن المسودات ما زالت في الشيفرة وتُعرض حتى الآن',
  ],
  '— 개발자가 카탈로그에서 그 키를 빼야 반영됩니다(코드 수렴).': [
    '— a developer must remove those keys from the catalog for the ruling to take effect (code convergence).',
    '— 開発者がカタログからそのキーを外して初めて反映されます（コード収束）。',
    '— يجب أن يزيل المطوّر تلك المفاتيح من الفهرس ليسري القرار (توافق الشيفرة).',
  ],
  "사유와 함께 '번역하지 않는다'로 판정된 키": [
    'Keys ruled "do not translate", with a reason',
    '理由とともに「翻訳しない」と判定されたキー',
    'مفاتيح تقرّر «عدم ترجمتها» مع ذكر السبب',
  ],
  '그중 코드 초안이 아직 나가는 것': ['Of those, drafts still shipping', 'そのうち下書きがまだ出ているもの', 'منها مسودات ما زالت تُعرض'],
  '기록은 됐으나 적용되지 않은 몫 — 코드 수렴 필요': [
    'Recorded but not applied — code convergence needed',
    '記録されたが適用されていない分 — コード収束が必要',
    'مسجَّل لكنه غير مطبَّق — يحتاج توافق الشيفرة',
  ],
  '카탈로그에 없는 검수 기록': ['Review records not in the catalog', 'カタログにないレビュー記録', 'سجلات مراجعة خارج الفهرس'],
  '코드에서 원문이 바뀌거나 사라졌다 — 검수율 분자에서 뺐다': [
    'The source text changed or disappeared in the code — excluded from the reviewed numerator',
    'コードで原文が変わったか消えた — レビュー率の分子から除外',
    'تغيّر النص الأصلي أو اختفى في الشيفرة — استُبعد من بسط نسبة المراجعة',
  ],

  /**
   * 🔴 **여기에 `/admin/ui-locale`(현황 화면)의 자기참조 어휘를 등재하지 않는다.**
   *    '잔여'·'누락'·'등재 / 전집'·'검수 / 등재'·'미검수 초안'·'검수 완료'·'카탈로그 미채움 …' 8건은
   *    admin6 트랙이 **미등재를 의도로 동결**해 두었다(`test/ui/admin6-i18n-wiring.spec.ts` §④ —
   *    "번역 관제 화면이 자기 어휘를 번역하면 안 된다"). 등재하면 그 가드가 실패한다.
   *    같은 사실에 정본이 둘이 되지 않도록 그 판단을 그대로 존중한다.
   */

  // 검수 오버레이 런타임 등록 상태(2026-09-09) — 승인분이 이 브라우저에 실제로 얹혔는가.
  // 🔴 실패·0건·로딩·미대상(ko)을 서로 다른 문장으로 말한다(같은 그림으로 그리면 거짓이 된다).
  '검수 오버레이를 아직 불러오지 않았습니다(화면 진입 직후).': [
    'The review overlay has not been loaded yet (just after entering the screen).',
    '検収オーバーレイはまだ読み込まれていません（画面に入った直後）。',
    'لم تُحمَّل طبقة المراجعة بعد (مباشرة بعد دخول الشاشة).',
  ],
  '승인된 검수 결과를 불러오는 중입니다…': [
    'Loading approved review results…',
    '承認された検収結果を読み込んでいます…',
    'جارٍ تحميل نتائج المراجعة المعتمدة…',
  ],
  '한국어는 원문이 곧 정본이라 검수 오버레이 대상이 아닙니다(불러오지 않는 것이 맞습니다).': [
    'Korean is the source of truth itself, so it is not a target for the review overlay (not loading it is correct).',
    '韓国語は原文がそのまま正本のため、検収オーバーレイの対象ではありません（読み込まないのが正しい動作です）。',
    'الكورية هي النص المرجعي نفسه، لذا ليست هدفًا لطبقة المراجعة (عدم تحميلها هو السلوك الصحيح).',
  ],
  '🔴 검수 오버레이를 불러오지 못했습니다 — 지금 이 브라우저의 화면은 코드 초안입니다.': [
    '🔴 The review overlay could not be loaded — screens in this browser are showing the code draft.',
    '🔴 検収オーバーレイを読み込めませんでした — 現在このブラウザの画面はコード下書きです。',
    '🔴 تعذّر تحميل طبقة المراجعة — تعرض الشاشات في هذا المتصفح مسودة الكود.',
  ],
  '승인된 값이 있어도 반영되지 않은 상태입니다. 새로고침하거나 서버 상태를 확인하세요.': [
    'Even if approved values exist, they are not applied. Reload the page or check the server.',
    '承認済みの値があっても反映されていない状態です。再読み込みするか、サーバーの状態を確認してください。',
    'حتى إن وُجدت قيم معتمدة فهي غير مُطبَّقة. أعِد تحميل الصفحة أو تحقّق من حالة الخادم.',
  ],
  '이 언어의 팩이 없어 승인분을 얹을 곳이 없습니다 — 팩을 지어내지 않습니다.': [
    'There is no pack for this language, so approved values have nowhere to be applied — a pack is not invented.',
    'この言語のパックが無いため承認分を適用する先がありません — パックを勝手に作りません。',
    'لا توجد حزمة لهذه اللغة، فلا مكان لتطبيق القيم المعتمدة — ولا تُختلق حزمة.',
  ],
  '🔴 승인이 취소·반려됐지만 이 세션에는 옛 승인값이 그대로 보이는 키가 있습니다(회수 경로 없음 — 새로고침해야 사라집니다):': [
    '🔴 Some keys were un-approved or rejected but still show the old approved value in this session (no rollback path — a reload clears them):',
    '🔴 承認取消・却下されたのに、このセッションでは旧承認値がそのまま見えるキーがあります（回収経路なし — 再読み込みで消えます）：',
    '🔴 أُلغي اعتماد بعض المفاتيح أو رُفضت، لكنها ما زالت تُظهر القيمة المعتمدة القديمة في هذه الجلسة (لا مسار للتراجع — يزيلها إعادة التحميل):',
  ],
  '조회는 성공했고 이 언어에 승인된 검수 결과가 아직 없습니다(실패가 아닙니다).': [
    'The request succeeded and there are no approved review results for this language yet (this is not a failure).',
    '取得は成功し、この言語に承認済みの検収結果はまだありません（失敗ではありません）。',
    'نجح الطلب ولا توجد بعد نتائج مراجعة معتمدة لهذه اللغة (هذا ليس فشلًا).',
  ],
  '승인된 검수 결과가 이 브라우저에 적용됐습니다 —': [
    'Approved review results have been applied in this browser —',
    '承認された検収結果がこのブラウザに適用されました —',
    'طُبِّقت نتائج المراجعة المعتمدة في هذا المتصفح —',
  ],
  '값이 비어 얹지 않은 항목': [
    'entries skipped because the value was empty',
    '値が空で適用しなかった項目',
    'عناصر تُخطّيت لأن قيمتها فارغة',
  ],

  // 언어별 검수자 지정 패널(2026-09-09) — 서버는 `i18n.reviewers` 를 읽는데 설정할 화면이 없었다.
  '검수자 지정을 불러오는 중입니다…': ['Loading reviewer assignments…', '検収者の指定を読み込んでいます…', 'جارٍ تحميل تعيينات المراجعين…'],
  '언어별 검수자 지정': ['Reviewer assignment by language', '言語別 検収者の指定', 'تعيين المراجعين حسب اللغة'],
  '설정 i18n.reviewers · 지정된 사용자는 비관리자여도 그 언어를 검수할 수 있습니다': [
    'Setting i18n.reviewers · assigned users may review that language even if they are not administrators',
    '設定 i18n.reviewers ・指定されたユーザーは管理者でなくてもその言語を検収できます',
    'الإعداد i18n.reviewers · يمكن للمستخدمين المعيَّنين مراجعة تلك اللغة حتى إن لم يكونوا مسؤولين',
  ],
  '🔴 이 언어에 지정된 검수자가 없습니다 — 지금은 ADMIN 만 제안·승인할 수 있습니다(설정이 비어 있는 것이지 권한이 없는 것이 아닙니다).': [
    '🔴 No reviewer is assigned for this language — only ADMIN can propose or approve for now (the setting is empty; it is not a permission denial).',
    '🔴 この言語に指定された検収者がいません — 現在は ADMIN のみ提案・承認できます（設定が空なのであって、権限がないのではありません）。',
    '🔴 لا يوجد مراجع معيَّن لهذه اللغة — يمكن لمسؤول النظام وحده الاقتراح أو الاعتماد حاليًا (الإعداد فارغ، وليس رفضًا للصلاحية).',
  ],
  '(이름 확인 불가)': ['(name not resolvable)', '（氏名を確認できません）', '(تعذّر تحديد الاسم)'],
  '검수자로 지정': ['Assign as reviewer', '検収者に指定', 'تعيين كمراجع'],
  '직원 목록을 불러오지 못했습니다 — 이름 없이 id 로만 보입니다.': [
    'The staff list could not be loaded — entries show as ids without names.',
    '職員一覧を読み込めませんでした — 氏名なしで id のみ表示されます。',
    'تعذّر تحميل قائمة الموظفين — تظهر العناصر بالمعرّفات دون أسماء.',
  ],
  '저장하지 못했습니다 — 지정은 반영되지 않았습니다.': [
    'Could not save — the assignment was not applied.',
    '保存できませんでした — 指定は反映されていません。',
    'تعذّر الحفظ — لم يُطبَّق التعيين.',
  ],
  '검수자 지정은 ADMIN 만 할 수 있습니다 — 이 화면에서는 현재 지정 상태만 보입니다.': [
    'Only ADMIN can assign reviewers — this screen shows the current assignment only.',
    '検収者の指定は ADMIN のみ可能です — この画面では現在の指定状況のみ表示されます。',
    'يمكن لمسؤول النظام وحده تعيين المراجعين — تعرض هذه الشاشة التعيين الحالي فقط.',
  ],
  '검수자 지정을 저장했습니다 — 다음 조회부터 적용됩니다.': [
    'Reviewer assignment saved — it applies from the next request.',
    '検収者の指定を保存しました — 次の取得から適用されます。',
    'حُفِظ تعيين المراجعين — يُطبَّق ابتداءً من الطلب التالي.',
  ],
  '이 검수자를 해제합니다': ['Remove this reviewer', 'この検収者を解除します', 'إزالة هذا المراجع'],
  '검수자로 지정할 직원': ['Staff member to assign as reviewer', '検収者に指定する職員', 'الموظف المراد تعيينه مراجعًا'],
};

const en: Record<string, string> = {};
const ja: Record<string, string> = {};
const ar: Record<string, string> = {};
for (const [key, [e, j, a]] of Object.entries(TRANSLATIONS)) {
  en[key] = e;
  ja[key] = j;
  ar[key] = a;
}

export const I18NREVIEW_MESSAGES: MessageCatalog = { en, ja, ar };
/** 전량 AI_DRAFT — 검수는 커밋으로 남는 사람 행위 */
export const I18NREVIEW_VERIFIED: ReadonlySet<string> = new Set();
