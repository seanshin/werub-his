import type { MessageCatalog } from '../t';

/**
 * P2b 영역 카탈로그(components2) — `apps/web/src/components/**` 공용 부품
 * (chart·specialty·clinical-charts·nursing·signature·voice-emr·workstation·record-timeline·admin CMS).
 * 키=한국어 원문(동음이의는 `원문@문맥`)·en/ja 필수·**전량 AI_DRAFT**(렌더 부품이 초안 티를 단다).
 *
 * 🔴 중복 등재 금지 — 이미 다른 영역(common·status·chart·nursing·pharmlab·surgeryer 등)에 있는
 *    원문은 여기 다시 넣지 않는다(먼저 등록된 영역이 이긴다). 47개가 그렇게 재사용된다.
 *    다만 **먼저 등록된 번역이 이 화면의 뜻과 다른 자리**는 `원문@문맥` 으로 갈랐다(8건):
 *      수정@동작(status '수정'=Amended ↔ 여기선 편집 액션) · 투여@시각(pharmlab '투여'=Route ↔ 투여 시각)
 *      촬영@시각(chart2 '촬영'=Imaging ↔ 촬영 시각) · 종료@녹음(status '종료'=Closed ↔ 녹음 중지)
 *      새 기록@녹음(nursing '새 기록'=New note ↔ 새 녹음) · 결과@산출(surgeryer '결과'=Outcome ↔ 계산 결과)
 *      등록@저장(adminops '등록'=Registered ↔ 저장 버튼) · 서명 완료@결과(chart '서명 완료'=Complete signing ↔ 서명됨)
 *
 * 🔴 의도적 미등재(원문+미번역 티가 정직 — 오역이 임상 사고가 되는 자리):
 *    · 임상 평가도구 항목·선택지·판정 밴드 — GCS/NEWS/MORSE/Braden/SOFA/APACHE II/GAF 옵션 텍스트,
 *      위험등급(고위험·중위험·저위험·중증…), NRS 통증 서술어(PAIN_LABELS), 청력 손실 등급(정상~심도),
 *      치식 상태(우식·충전·크라운·근관치료·결손·임플란트·발치필요·브릿지·미상), 화상 깊이·부위 정본,
 *      CHA2DS2-VASc/CURB-65/Child-Pugh/MELD/eGFR/qSOFA/DAS28 의 판정 문구.
 *    · 항암 레지멘(TreeRunner) 블록 전체 — 기준용량·계산 용량·누적한계·투여일 등 용량 산출 어휘.
 *    · DUR 미적용 배지·정본 우회 경고를 뺀 나머지 안전 고지문 중 `<b>`/보간이 섞인 문장.
 *    · 상태/코드 Record(TYPE_LABELS·SEVERITY_LABELS·TRACK_UI 등) — status.ts(P1-B) 축 소관.
 *    · print/document 서식은 이 영역 밖(법정 서식 불변).
 *
 * 아랍어(ar)는 이 영역에서 등재하지 않는다(§8 별도 트랙 · 이 축의 계약상 선택 사항).
 */
export const COMPONENTS2_MESSAGES: MessageCatalog = {
  en: {
    // ── chart/ChartRenderer (차트 템플릿 동적 폼) ──
    'KCD 코드 또는 진단명 검색...': 'Search KCD code or diagnosis name...',
    '검색 중...': 'Searching...',
    '검색 결과가 없습니다': 'No search results',
    '코드 체계': 'Code system',
    '점수를 선택하세요': 'Select a score',
    '부위를 클릭하세요': 'Click a body region',
    '마킹된 부위가 없습니다': 'No regions marked',
    '메모...': 'Note...',
    '남아': 'Boy',
    '여아': 'Girl',
    '신장': 'Height',
    '검사 결과 메모': 'Lab result note',
    '검사 결과 메모...': 'Lab result note...',
    '코드 마스터에 연결하지 못했습니다 — 잠시 후 다시 시도하세요':
      'Could not reach the code master — please try again shortly',
    '처방 메모': 'Prescription note',
    '처방 항목이 없습니다': 'No prescription items',
    '약품명...': 'Drug name...',
    '투여횟수': 'Frequency',
    '투여기간': 'Duration',
    '오더 메모': 'Order note',
    '오더 항목이 없습니다': 'No order items',
    '처치 타임라인': 'Procedure timeline',
    '기록 추가': 'Add entry',
    '타임라인 기록이 없습니다': 'No timeline entries',
    '처치/관찰 내용...': 'Procedure / observation...',
    '임상도구가 선택되지 않았습니다(템플릿 설정에서 지정).':
      'No clinical tool selected (assign one in the template settings).',

    // ── clinical-charts/ClinicalChartRunner (임상차트 실행기) ──
    '정식기록은 차트 모듈 사용': 'Use the chart module for the official record',
    '총점': 'Total score',
    '모든 항목을 선택하면 판정됩니다.': 'The result appears once every item is answered.',
    '계산': 'Calculate',
    '결과@산출': 'Result',
    '판정식': 'Decision rule',
    '모든 항목에 예/아니오를 선택하면 판정됩니다.':
      'The result appears once Yes/No is chosen for every item.',

    // ── signature/SignatureModal (전자서명) ──
    '인증서 없음': 'No certificate',
    '전자서명을 하려면 먼저 인증서를 발급받아야 합니다.':
      'You need to be issued a certificate before you can sign electronically.',
    '인증서 설정으로 이동': 'Go to certificate settings',
    '인증서 비활성': 'Certificate inactive',
    '문서 유형': 'Document type',
    '서명자': 'Signer',
    '로컬 키가 없습니다. 설정 페이지에서 키를 복원해주세요.':
      'No local key found. Restore your key from the settings page.',
    '서명 완료@결과': 'Signed',
    '인증 중...': 'Authenticating...',
    'Touch ID / Face ID로 서명': 'Sign with Touch ID / Face ID',
    '또는 PIN 입력': 'Or enter a PIN',
    'PIN 입력 (6자리)': 'Enter PIN (6 digits)',
    '서명 중...': 'Signing...',
    '생체인증으로 돌아가기': 'Back to biometric authentication',

    // ── voice-emr/ConversationStreamPanel (앰비언트 대화) ──
    '진료 대화': 'Encounter conversation',
    '(음성)': '(voice)',
    '기록 중': 'Recording',
    '일시정지': 'Paused',
    '종료됨': 'Ended',
    '재개': 'Resume',
    '분석 중…': 'Analyzing…',
    'SOAP 분석': 'SOAP analysis',
    '종료@녹음': 'Stop',
    '새 기록@녹음': 'New recording',
    '패널 숨기기': 'Hide panel',
    '확인했습니다': 'Acknowledged',
    '화자 정정(탭)': 'Correct speaker (tap)',
    '(수정됨)': '(edited)',
    '(이어짐)': '(continued)',
    '수정@동작': 'Edit',
    '삭제(기록 제외)': 'Delete (exclude from record)',
    '대화를 시작하세요 — 발화가 여기에 실시간으로 기록됩니다.':
      'Start the conversation — utterances appear here in real time.',
    'SOAP 초안 제안': 'SOAP draft suggestions',
    '반영할 제안이 없습니다.': 'No suggestions to apply.',
    'AI 제안': 'AI suggestion',
    '규칙 추출': 'Rule extraction',
    '반영': 'Apply',
    '건너뛰기': 'Skip',
    '모두 반영': 'Apply all',
    '기록이 저장되었습니다. [SOAP 분석]으로 초안 제안을 다시 볼 수 있습니다.':
      'The record has been saved. Use [SOAP analysis] to see the draft suggestions again.',

    // ── nursing/NursingNotePanel (범용 간호기록) ──
    '간호 기록이 없습니다': 'No nursing notes',
    '간호 노트 추가': 'Add nursing note',
    '본문이 비어 있는 기록입니다(저장 시 유실 가능성).':
      'This record has no body text (it may have been lost on save).',
    '작성 방식': 'Entry format',
    '자유 텍스트': 'Free text',
    '간호 기록 내용을 입력하세요...': 'Enter the nursing note...',
    '활력징후 (선택)': 'Vital signs (optional)',
    '회/분': '/min',

    // ── workstation/PatientAddModal (워크스테이션 환자 추가) ──
    '환자 추가': 'Add patient',
    '환자 이름, 등록번호, 전화번호 검색... (↑↓ 선택, Enter 확인)':
      'Search by patient name, MRN or phone... (↑↓ to move, Enter to confirm)',
    '변경': 'Change',
    '이미 대기 중인 오더가 있습니다': 'There are already pending orders',
    '검진 접수 수검자': 'Checked-in health screening examinee',
    '치료 유형': 'Therapy type',
    '촬영 내용': 'Imaging details',
    '검사 내용': 'Test details',
    '예: Chest X-ray, Brain MRI': 'e.g. Chest X-ray, Brain MRI',
    '예: 심전도, 폐기능': 'e.g. ECG, pulmonary function',
    '예: CBC, LFT': 'e.g. CBC, LFT',
    '매칭된 환자': 'Matching patients',
    '오늘 접수/검진 환자': "Today's registered / screening patients",
    '기타 검색 결과': 'Other search results',
    '오늘 접수된 환자가 없습니다.': 'No patients registered today.',
    '이름으로 검색해주세요.': 'Search by name.',
    '↑↓ 선택 · Enter 확인 · Esc 닫기': '↑↓ to move · Enter to confirm · Esc to close',
    '대기열에 추가': 'Add to queue',
    '치료 유형을 선택하세요': 'Select a therapy type',

    // ── record-timeline/record-card (통합 시계열 카드) ──
    '상세 접기': 'Collapse details',
    '상세 펼치기': 'Expand details',
    '이 기록만 별도 창으로 열기': 'Open just this record in a separate window',
    // 🔴 record-timeline 카드의 '자료 ↗' 버튼(=이 기록만 별도 창으로 연다). en 만 'Source'(출처/원천)라
    //    갈라져 있었다 — ja '資料' 와 팩 ru/kk/mn 3종이 모두 "자료·문서"로 읽었다. 다수에 맞춘다.
    '자료': 'Material',
    '입원 간호기록 정본을 우회해 저장된 기록입니다(서명·QA 대상 아님)':
      'Saved bypassing the inpatient nursing-note canon (not subject to signing or QA)',
    '접기': 'Collapse',
    '결론': 'Impression',
    '소견': 'Findings',
    '술전': 'Pre-op',
    '술후': 'Post-op',
    '술전진단': 'Pre-op diagnosis',
    '술후진단': 'Post-op diagnosis',
    '수술소견': 'Operative findings',
    '판독보고': 'Report issued',
    '촬영@시각': 'Acquired',
    '투여@시각': 'Administered',
    '지시': 'Instructions',
    '보류사유': 'Hold reason',
    '입원진단': 'Admission diagnosis',
    '퇴원진단': 'Discharge diagnosis',
    '경과요약': 'Hospital course',
    '추적계획': 'Follow-up plan',
    '입원사유': 'Reason for admission',
    '입원번호': 'Admission no.',
    '혈압': 'Blood pressure',
    '맥박': 'Pulse',
    '통증(NRS)': 'Pain (NRS)',

    // ── specialty/AudiogramChart (청력도) ──
    '청력도 (Audiogram)': 'Audiogram',
    '주파수 (Hz)': 'Frequency (Hz)',
    '편집 귀:': 'Ear being edited:',
    '우측 (R)': 'Right (R)',
    '좌측 (L)': 'Left (L)',
    '우측 기도 (AC)': 'Right air conduction (AC)',
    '좌측 기도 (AC)': 'Left air conduction (AC)',
    '우측 골도 (BC)': 'Right bone conduction (BC)',
    '좌측 골도 (BC)': 'Left bone conduction (BC)',

    // ── specialty/DentalChartDiagram (치과 차트) ──
    '치과 32치아 차트': '32-tooth dental chart',
    '상악 (Upper Jaw)': 'Upper jaw',
    '하악 (Lower Jaw)': 'Lower jaw',
    '우측(R)': 'Right (R)',
    '좌측(L)': 'Left (L)',

    // ── specialty/BurnsChart (화상 차트) ──
    '앞면': 'Front',
    '뒷면': 'Back',
    '앞면 (Front)': 'Front',
    '뒷면 (Back)': 'Back',
    ' - 소아': ' - Pediatric',

    // ── specialty/ScoreCalculator (입력 라벨만) ──
    '빌리루빈 (mg/dL)': 'Bilirubin (mg/dL)',
    '크레아티닌 (mg/dL)': 'Creatinine (mg/dL)',
    '나트륨 Na (mEq/L)': 'Sodium Na (mEq/L)',
    '혈청 크레아티닌 (mg/dL)': 'Serum creatinine (mg/dL)',
    '나이 (세)': 'Age (years)',
    '압통관절수 TJC (0-28)': 'Tender joint count TJC (0-28)',
    '종창관절수 SJC (0-28)': 'Swollen joint count SJC (0-28)',
    '환자 VAS (0-100 mm)': 'Patient VAS (0-100 mm)',

    // ── admin/CategoryCmsPage (홈페이지 CMS 편집기) ──
    '대표 이미지가 화면의 주된 요소입니다': 'The cover image is the main element on the page',
    '이 카테고리를 읽는 공개 화면이 확인되지 않았습니다 — 저장해도 홈페이지에 나오지 않습니다.':
      'No public page was found that reads this category — saving will not surface it on the website.',
    '새 항목 추가': 'Add new item',
    '제목, 내용, 태그로 검색...': 'Search by title, body or tag...',
    '공개 화면이 읽는 값이 비어 있어 그 자리가 폴백으로 그려집니다':
      'A value the public page reads is empty, so that slot falls back to a placeholder',
    '등록된 항목이 없습니다': 'No items registered',
    '편집': 'Edit',
    '숨김': 'Hide',
    '공개': 'Publish',
    '본문 미리보기': 'Body preview',
    '슬러그': 'Slug',
    '이미지': 'Image',
    '편집하기': 'Edit this item',
    '목록으로': 'Back to list',
    '새 항목 작성': 'New item',
    '수정 저장': 'Save changes',
    '등록@저장': 'Create',
    '슬러그 (URL)': 'Slug (URL)',
    '예: my-news-item': 'e.g. my-news-item',
    '정렬순서': 'Sort order',
    '(유형 미지정)': '(type unspecified)',
    '제목': 'Title',
    '제목을 입력하세요': 'Enter a title',
    '상단 고정': 'Pin to top',
    '본문': 'Body',
    '에디터 로딩 중...': 'Loading editor...',
    '내용을 작성하세요...': 'Write the content...',
    '검색 태그': 'Search tags',
    '쉼표로 구분': 'Separate with commas',
    '대표 이미지': 'Cover image',
    '이미지 URL': 'Image URL',
    '미디어 선택': 'Choose media',
    '파일 업로드': 'Upload file',
    '본문을 입력하면 미리보기가 표시됩니다': 'A preview appears once you enter body text',
  },
  ja: {
    // ── chart/ChartRenderer ──
    'KCD 코드 또는 진단명 검색...': 'KCDコードまたは診断名を検索...',
    '검색 중...': '検索中...',
    '검색 결과가 없습니다': '検索結果がありません',
    '코드 체계': 'コード体系',
    '점수를 선택하세요': 'スコアを選択してください',
    '부위를 클릭하세요': '部位をクリックしてください',
    '마킹된 부위가 없습니다': 'マークされた部位はありません',
    '메모...': 'メモ...',
    '남아': '男児',
    '여아': '女児',
    '신장': '身長',
    '검사 결과 메모': '検査結果メモ',
    '검사 결과 메모...': '検査結果メモ...',
    '코드 마스터에 연결하지 못했습니다 — 잠시 후 다시 시도하세요':
      'コードマスタに接続できませんでした — しばらくしてから再試行してください',
    '처방 메모': '処方メモ',
    '처방 항목이 없습니다': '処方項目がありません',
    '약품명...': '薬品名...',
    '투여횟수': '投与回数',
    '투여기간': '投与期間',
    '오더 메모': 'オーダーメモ',
    '오더 항목이 없습니다': 'オーダー項目がありません',
    '처치 타임라인': '処置タイムライン',
    '기록 추가': '記録を追加',
    '타임라인 기록이 없습니다': 'タイムライン記録がありません',
    '처치/관찰 내용...': '処置・観察内容...',
    '임상도구가 선택되지 않았습니다(템플릿 설정에서 지정).':
      '臨床ツールが選択されていません(テンプレート設定で指定します)。',

    // ── clinical-charts/ClinicalChartRunner ──
    '정식기록은 차트 모듈 사용': '正式記録はチャートモジュールを使用',
    '총점': '合計点',
    '모든 항목을 선택하면 판정됩니다.': 'すべての項目を選択すると判定されます。',
    '계산': '計算',
    '결과@산출': '結果',
    '판정식': '判定式',
    '모든 항목에 예/아니오를 선택하면 판정됩니다.':
      'すべての項目に「はい/いいえ」を選択すると判定されます。',

    // ── signature/SignatureModal ──
    '인증서 없음': '証明書なし',
    '전자서명을 하려면 먼저 인증서를 발급받아야 합니다.':
      '電子署名を行うには、まず証明書の発行が必要です。',
    '인증서 설정으로 이동': '証明書設定へ移動',
    '인증서 비활성': '証明書が無効',
    '문서 유형': '文書種別',
    '서명자': '署名者',
    '로컬 키가 없습니다. 설정 페이지에서 키를 복원해주세요.':
      'ローカル鍵がありません。設定ページから鍵を復元してください。',
    '서명 완료@결과': '署名済み',
    '인증 중...': '認証中...',
    'Touch ID / Face ID로 서명': 'Touch ID / Face ID で署名',
    '또는 PIN 입력': 'または PIN を入力',
    'PIN 입력 (6자리)': 'PIN入力(6桁)',
    '서명 중...': '署名中...',
    '생체인증으로 돌아가기': '生体認証に戻る',

    // ── voice-emr/ConversationStreamPanel ──
    '진료 대화': '診療会話',
    '(음성)': '(音声)',
    '기록 중': '記録中',
    '일시정지': '一時停止',
    '종료됨': '終了済み',
    '재개': '再開',
    '분석 중…': '分析中…',
    'SOAP 분석': 'SOAP分析',
    '종료@녹음': '停止',
    '새 기록@녹음': '新規録音',
    '패널 숨기기': 'パネルを隠す',
    '확인했습니다': '確認しました',
    '화자 정정(탭)': '話者の訂正(タップ)',
    '(수정됨)': '(修正済み)',
    '(이어짐)': '(継続)',
    '수정@동작': '編集',
    '삭제(기록 제외)': '削除(記録から除外)',
    '대화를 시작하세요 — 발화가 여기에 실시간으로 기록됩니다.':
      '会話を開始してください — 発話がここにリアルタイムで記録されます。',
    'SOAP 초안 제안': 'SOAP下書き提案',
    '반영할 제안이 없습니다.': '反映する提案がありません。',
    'AI 제안': 'AI提案',
    '규칙 추출': 'ルール抽出',
    '반영': '反映',
    '건너뛰기': 'スキップ',
    '모두 반영': 'すべて反映',
    '기록이 저장되었습니다. [SOAP 분석]으로 초안 제안을 다시 볼 수 있습니다.':
      '記録が保存されました。[SOAP分析]から下書き提案を再度確認できます。',

    // ── nursing/NursingNotePanel ──
    '간호 기록이 없습니다': '看護記録がありません',
    '간호 노트 추가': '看護ノートを追加',
    '본문이 비어 있는 기록입니다(저장 시 유실 가능성).':
      '本文が空の記録です(保存時に失われた可能性があります)。',
    '작성 방식': '記載方式',
    '자유 텍스트': '自由記載',
    '간호 기록 내용을 입력하세요...': '看護記録の内容を入力してください...',
    '활력징후 (선택)': 'バイタルサイン(任意)',
    '회/분': '回/分',

    // ── workstation/PatientAddModal ──
    '환자 추가': '患者を追加',
    '환자 이름, 등록번호, 전화번호 검색... (↑↓ 선택, Enter 확인)':
      '患者氏名・登録番号・電話番号で検索...(↑↓で選択、Enterで確定)',
    '변경': '変更',
    '이미 대기 중인 오더가 있습니다': 'すでに待機中のオーダーがあります',
    '검진 접수 수검자': '健診受付済みの受診者',
    '치료 유형': '治療種別',
    '촬영 내용': '撮影内容',
    '검사 내용': '検査内容',
    '예: Chest X-ray, Brain MRI': '例: Chest X-ray, Brain MRI',
    '예: 심전도, 폐기능': '例: 心電図、肺機能',
    '예: CBC, LFT': '例: CBC, LFT',
    '매칭된 환자': '該当する患者',
    '오늘 접수/검진 환자': '本日の受付・健診患者',
    '기타 검색 결과': 'その他の検索結果',
    '오늘 접수된 환자가 없습니다.': '本日受付された患者はいません。',
    '이름으로 검색해주세요.': '氏名で検索してください。',
    '↑↓ 선택 · Enter 확인 · Esc 닫기': '↑↓で選択 · Enterで確定 · Escで閉じる',
    '대기열에 추가': '待機列に追加',
    '치료 유형을 선택하세요': '治療種別を選択してください',

    // ── record-timeline/record-card ──
    '상세 접기': '詳細を閉じる',
    '상세 펼치기': '詳細を開く',
    '이 기록만 별도 창으로 열기': 'この記録だけ別ウィンドウで開く',
    '자료': '資料',
    '입원 간호기록 정본을 우회해 저장된 기록입니다(서명·QA 대상 아님)':
      '入院看護記録の正本を経由せずに保存された記録です(署名・QAの対象外)',
    '접기': '閉じる',
    '결론': '結論',
    '소견': '所見',
    '술전': '術前',
    '술후': '術後',
    '술전진단': '術前診断',
    '술후진단': '術後診断',
    '수술소견': '手術所見',
    '판독보고': '読影報告',
    '촬영@시각': '撮影日時',
    '투여@시각': '投与日時',
    '지시': '指示',
    '보류사유': '保留理由',
    '입원진단': '入院時診断',
    '퇴원진단': '退院時診断',
    '경과요약': '経過要約',
    '추적계획': 'フォローアップ計画',
    '입원사유': '入院理由',
    '입원번호': '入院番号',
    '혈압': '血圧',
    '맥박': '脈拍',
    '통증(NRS)': '疼痛(NRS)',

    // ── specialty/AudiogramChart ──
    '청력도 (Audiogram)': 'オージオグラム',
    '주파수 (Hz)': '周波数 (Hz)',
    '편집 귀:': '編集する耳:',
    '우측 (R)': '右 (R)',
    '좌측 (L)': '左 (L)',
    '우측 기도 (AC)': '右 気導 (AC)',
    '좌측 기도 (AC)': '左 気導 (AC)',
    '우측 골도 (BC)': '右 骨導 (BC)',
    '좌측 골도 (BC)': '左 骨導 (BC)',

    // ── specialty/DentalChartDiagram ──
    '치과 32치아 차트': '歯科32歯チャート',
    '상악 (Upper Jaw)': '上顎',
    '하악 (Lower Jaw)': '下顎',
    '우측(R)': '右 (R)',
    '좌측(L)': '左 (L)',

    // ── specialty/BurnsChart ──
    '앞면': '前面',
    '뒷면': '背面',
    '앞면 (Front)': '前面',
    '뒷면 (Back)': '背面',
    ' - 소아': ' - 小児',

    // ── specialty/ScoreCalculator ──
    '빌리루빈 (mg/dL)': 'ビリルビン (mg/dL)',
    '크레아티닌 (mg/dL)': 'クレアチニン (mg/dL)',
    '나트륨 Na (mEq/L)': 'ナトリウム Na (mEq/L)',
    '혈청 크레아티닌 (mg/dL)': '血清クレアチニン (mg/dL)',
    '나이 (세)': '年齢 (歳)',
    '압통관절수 TJC (0-28)': '圧痛関節数 TJC (0-28)',
    '종창관절수 SJC (0-28)': '腫脹関節数 SJC (0-28)',
    '환자 VAS (0-100 mm)': '患者VAS (0-100 mm)',

    // ── admin/CategoryCmsPage ──
    '대표 이미지가 화면의 주된 요소입니다': '代表画像がページの主要な要素です',
    '이 카테고리를 읽는 공개 화면이 확인되지 않았습니다 — 저장해도 홈페이지에 나오지 않습니다.':
      'このカテゴリを読み込む公開ページが確認できません — 保存してもホームページには表示されません。',
    '새 항목 추가': '新規項目を追加',
    '제목, 내용, 태그로 검색...': 'タイトル・本文・タグで検索...',
    '공개 화면이 읽는 값이 비어 있어 그 자리가 폴백으로 그려집니다':
      '公開ページが読み込む値が空のため、その箇所は代替表示になります',
    '등록된 항목이 없습니다': '登録された項目がありません',
    '편집': '編集',
    '숨김': '非公開',
    '공개': '公開',
    '본문 미리보기': '本文プレビュー',
    '슬러그': 'スラッグ',
    '이미지': '画像',
    '편집하기': 'この項目を編集',
    '목록으로': '一覧へ戻る',
    '새 항목 작성': '新規項目作成',
    '수정 저장': '変更を保存',
    '등록@저장': '登録する',
    '슬러그 (URL)': 'スラッグ (URL)',
    '예: my-news-item': '例: my-news-item',
    '정렬순서': '並び順',
    '(유형 미지정)': '(種別 未指定)',
    '제목': 'タイトル',
    '제목을 입력하세요': 'タイトルを入力してください',
    '상단 고정': '上部に固定',
    '본문': '本文',
    '에디터 로딩 중...': 'エディタを読み込み中...',
    '내용을 작성하세요...': '内容を入力してください...',
    '검색 태그': '検索タグ',
    '쉼표로 구분': 'カンマ区切り',
    '대표 이미지': '代表画像',
    '이미지 URL': '画像URL',
    '미디어 선택': 'メディアを選択',
    '파일 업로드': 'ファイルをアップロード',
    '본문을 입력하면 미리보기가 표시됩니다': '本文を入力するとプレビューが表示されます',
  },
  ar: {},
};

/** 검수 완료 키 — 검수는 커밋으로 남는 사람 행위. 현재 전량 AI_DRAFT. */
export const COMPONENTS2_VERIFIED: ReadonlySet<string> = new Set();
