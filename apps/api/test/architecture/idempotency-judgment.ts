/**
 * 재시도·멱등 **무방비 자리 한 건씩 판정 등록부**(2026-09-28 재판정 a13360).
 *
 * 🔴 왜 파일인가 — 이 판정은 종전에 `docs/04-report/idempotency-triage-2026-09-16.md` **문서에만** 있었다.
 *    문서는 코드·스키마가 바뀌어도 아무 말을 하지 않는다(캠페인 계측 사각 #4 — "면제 목록이 이름만이면 그 자리의
 *    대조 코드를 지워도 통과한다"). 실제로 그렇게 새어 있었다:
 *      · `claim.generateClaims` 면제 근거 "claimNumber @unique" — 그 필드는 `String?` 이고 생성 시 채워지지 않는다.
 *      · 재고 문서 4자리 면제 근거 "문서번호 @unique" — 번호를 호출마다 새로 뽑으므로 재시도의 심판이 아니다.
 *    그래서 면제는 **기계가 대조할 수 있는 근거**를 반드시 든다(`idempotency-inventory.spec.ts` 가 대조한다).
 *
 * 🔴 정본은 하나다 — 파일별 무방비 수(종전 `IDEMPOTENCY_UNGUARDED_BASELINE`)는 이 등록부로 **대체**했다
 *    (행 단위가 파일 단위보다 엄격하고, 둘을 함께 두면 갈라진다). 기준선 파일은 총계만 동결한다.
 * 🔴 판정은 '무해'를 뜻하지 않는다 — **"이 자리에서 중복이 생기면 무엇이 심판인가"** 하나를 적는다.
 *    심판이 없으면 `humanDecision` 으로 두고 결정 등록부 키(`decisionKey`)를 가리킨다(화면에서 고를 수 있게).
 */
export type IdempotencyVerdict =
  /** DB 유니크·자연키가 막는다 — 단, 그 키가 **요청에서 오는 값**일 때만 성립한다(앵커가 그것을 붙든다) */
  | 'dbUnique'
  /** 도메인 불변식을 스스로 지킨다(이전 활성 마감 후 생성 등) */
  | 'invariantMaintained'
  /** 위임만 한다 — 판정은 위임받는 쪽에 있다 */
  | 'delegated'
  /** 반복 발행이 임상·업무상 정당하다(자연키가 없는 것이 설계다) */
  | 'legitimateRepeat'
  /** 호출부 0 — 죽은 코드 */
  | 'deadCode'
  /** 원장 기록 헬퍼 — 중복 판정을 여기서 할 수 없고 호출부가 갖는다 */
  | 'helperCallerOwned'
  /** 🔴 심판이 없다 — 정책이 갈리므로 사람이 정한다(결정 등록부 키 필수) */
  | 'humanDecision';

export interface IdempotencyJudgment {
  /** `src/modules` 기준 상대 경로 — 스캐너 행의 `file` 과 정확히 같아야 한다 */
  file: string;
  /** 스캐너 행의 `method` */
  method: string;
  /** 이 자리가 만드는 Prisma 모델(스키마에 실제로 있어야 한다) */
  model: string;
  verdict: IdempotencyVerdict;
  /** `dbUnique` 의 근거 — 스키마에 실제로 있고 nullable 이 아니어야 한다. 단일 `'code'`, 복합 `'[itemId,supplierId]'` */
  uniques?: string[];
  /**
   * 🔴 코드 앵커 — **그 메서드 본문 안**(주석 제외)에 반드시 있어야 하는 정규식. 판정의 전제가 코드에서 사라지면
   *    가드가 실패한다. 메서드 이름·시그니처처럼 **늘 있는 것**을 앵커로 쓰지 않는다(항상 통과하는 앵커는 앵커가 아니다).
   */
  codeAnchor?: string;
  /** `deadCode` — `src` 전역 호출부가 0 이어야 한다 */
  noCallers?: true;
  /** 자연키가 **없다**는 것이 판정의 전제일 때 — 모델에 유니크가 하나도 없어야 한다 */
  noNaturalKey?: true;
  /** `humanDecision` — 결정 등록부(`decision.registry.ts`)에 실제로 있는 키 */
  decisionKey?: string;
  note: string;
}

export const IDEMPOTENCY_JUDGMENTS: IdempotencyJudgment[] = [
  // ── 반복 발행이 정당 — 자연키가 없는 것이 설계다 ──────────────────────────────
  {
    file: 'blood-bank/blood-bank.service.ts', method: 'createTransfusionOrder', model: 'TransfusionOrder',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'transfusionOrder\\.create\\(',
    note: '같은 환자에게 수혈을 두 번 내는 것은 업무상 정당하다. 멱등키를 강제하면 정당한 두 번째 발행을 막는다.',
  },
  {
    file: 'blood-bank/blood-bank.service.ts', method: 'createReorder', model: 'BloodReorderRequest',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'bloodReorderRequest\\.create\\(',
    note: '혈액 재발주 요청은 같은 혈액형으로 반복된다(소진될 때마다).',
  },
  {
    file: 'dental/dental.service.ts', method: 'createLabOrder', model: 'DentalLabOrder',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'dentalLabOrder\\.create\\(',
    note: '기공 의뢰는 재제작·수정 의뢰로 반복된다.',
  },
  {
    file: 'dialysis/dialysis.service.ts', method: 'createOrder', model: 'DialysisOrder',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'dialysisOrder\\.create\\(',
    note: '투석 처방은 회차마다 새로 낸다 — 같은 환자·같은 처방이 반복되는 것이 정상이다.',
  },
  {
    file: 'doctor-code/doctor-code.service.ts', method: 'createSet', model: 'DoctorPrescriptionSet',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'doctorPrescriptionSet\\.create\\(',
    note: '개인 처방 세트는 같은 이름으로도 여러 벌 둘 수 있다(개인 도구).',
  },
  {
    file: 'ophthalmology/ophthalmology.service.ts', method: 'prescribeGlasses', model: 'EyePrescription',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'eyePrescription\\.create\\(',
    note: '안경 처방 재발행은 정당하다(분실·도수 변경).',
  },
  {
    file: 'ophthalmology/ophthalmology.service.ts', method: 'prescribeContacts', model: 'EyePrescription',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'eyePrescription\\.create\\(',
    note: '콘택트렌즈 처방 재발행은 정당하다(분실·도수 변경·재구매). 안경 처방과 같은 성격.',
  },
  {
    file: 'ophthalmology/ophthalmology.service.ts', method: 'createPrescription', model: 'EyePrescription',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'eyePrescription\\.create\\(',
    note: '안과 처방 일반 경로 — 위 둘과 같은 성격.',
  },
  {
    file: 'pharmacy/pharmacy.service.ts', method: 'createCounsel', model: 'DispensingCounsel',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'dispensingCounsel\\.create\\(',
    note: '복약상담은 같은 조제 건에 여러 번 있을 수 있다(추가 상담).',
  },
  {
    file: 'order-set/order-set.service.ts', method: 'recordUsage', model: 'OrderSetUsage',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'orderSetUsage\\.create\\(',
    note: '사용 이력은 여러 벌이 정상이다(쓸 때마다 한 줄).',
  },
  {
    file: 'order-set/order-set.service.ts', method: 'createFavorite', model: 'FavoriteOrder',
    verdict: 'legitimateRepeat', noNaturalKey: true, codeAnchor: 'favoriteOrder\\.create\\(',
    note: '개인 즐겨찾기 — 중복이 생겨도 본인 목록이고 삭제 경로가 있다. 금전·재고·법정 영향 없음.',
  },
  {
    file: 'medical-ai/medical-ai.service.ts', method: 'draftOrderSet', model: 'OrderSet',
    verdict: 'legitimateRepeat', codeAnchor: "status: 'DRAFT'",
    note: 'AI 초안은 DRAFT 로만 들어가고 사람 승인 없이는 활성이 되지 않는다. 🔴 앵커가 DRAFT 다 — 자동 활성으로 바뀌면 이 면제는 무효다. 같은 이름이 다시 나오면 name @unique 에 막혀 P2002(500) — 중복이 아니라 오류 모양 문제(별도 후보).',
  },
  {
    file: 'code-master/drg-reference.service.ts', method: 'importSeparateBilling', model: 'DrgSeparateBilling',
    verdict: 'legitimateRepeat', codeAnchor: 'this\\.refData\\.record\\(',
    note: '🔴 종전 근거 "@@unique([datasetId,code]) 가 막는다"는 반쪽이다 — 적재마다 `refData.record` 가 새 dataset 을 발번하므로 그 유니크는 한 판 안에서만 심판이다. 같은 고시를 다시 올리면 새 판이 생기는 것이 설계(판본 이력)다.',
  },

  // ── DB 유니크가 막는다 — 단, 키가 요청에서 오는 값이어야 한다 ─────────────────
  {
    file: 'inventory/inventory.service.ts', method: 'createItem', model: 'InventoryItem',
    verdict: 'dbUnique', uniques: ['code'], codeAnchor: 'code: data\\.code',
    note: '품목코드는 요청이 준 값이라 재시도가 같은 키로 부딪힌다(P2002). 앵커가 그 사실을 붙든다.',
  },
  {
    file: 'inventory/inventory.service.ts', method: 'createStorage', model: 'InventoryStorage',
    verdict: 'dbUnique', uniques: ['code'], codeAnchor: 'code: data\\.code',
    note: '보관장소 코드는 요청이 준 값이라 재시도가 같은 키로 부딪힌다(P2002).',
  },
  {
    file: 'inventory/inventory.service.ts', method: 'createSupplier', model: 'InventorySupplier',
    verdict: 'dbUnique', uniques: ['code'], codeAnchor: 'code: data\\.code',
    note: '거래처 코드는 요청이 준 값이라 재시도가 같은 키로 부딪힌다(P2002).',
  },
  {
    file: 'inventory/inventory.service.ts', method: 'addItemSupplier', model: 'InventoryItemSupplier',
    verdict: 'dbUnique', uniques: ['[itemId,supplierId]'], codeAnchor: 'itemId: data\\.itemId, supplierId',
    note: '(품목,거래처) 쌍이 자연키 — 둘 다 요청이 준 값.',
  },
  {
    file: 'nutrition/nutrition.service.ts', method: 'createMealOrder', model: 'MealOrder',
    verdict: 'dbUnique', uniques: ['[admissionId,date,mealType]'], codeAnchor: '\\.\\.\\.data, date: this\\.dayValue\\(data\\.date\\)',
    note: '(입원,날짜,끼니)가 자연키이고 셋 다 요청에서 온다 — 일괄 생성 멱등이 스키마 주석에 밝혀진 자리.',
  },
  {
    file: 'order-set/order-set.service.ts', method: 'create', model: 'OrderSet',
    verdict: 'dbUnique', uniques: ['name'], codeAnchor: '\\.\\.\\.rest,',
    note: '세트명이 자연키이고 요청이 준다(`...rest` 에 name 이 실린다) — 같은 이름 재시도는 P2002 로 막힌다.',
  },
  {
    file: 'order-set/order-set.service.ts', method: 'createVersion', model: 'OrderSet',
    verdict: 'dbUnique', uniques: ['name'], codeAnchor: 'code: \'ORDER_SET_DRAFT_EXISTS\'',
    note: '2026-10-21 P2 — 복제·사용 중 수정이 이 메서드로 새 판을 만든다. 계보에 열린 초안이 있으면 409(재시도가 판을 하나 더 만들지 않는다) · 이름은 `기준 이름 (v판)` 으로 결정적이고 고유값이라 경합 재시도는 P2002 → 409 로 막힌다.',
  },
  {
    file: 'order-set/order-set.service.ts', method: 'replaceDiagnoses', model: 'OrderSetDiagnosis',
    verdict: 'dbUnique', uniques: ['[orderSetId,diagnosisCode]'],
    codeAnchor: 'orderSetDiagnosis\\.deleteMany\\(\\{ where: \\{ orderSetId \\} \\}\\)',
    note: 'delete-all → create-all 을 한 트랜잭션으로 하는 치환이라 몇 번을 불러도 같은 상태가 된다.',
  },
  {
    file: 'therapy-order/therapy-order.service.ts', method: 'create', model: 'TherapyOrder',
    verdict: 'dbUnique', uniques: ['orderId'], codeAnchor: 'orderId: dto\\.orderId',
    note: '오더 1:1 — orderId 가 요청에서 오고 유니크라 재시도가 막힌다.',
  },
  {
    file: 'therapy-order/therapy-order.service.ts', method: 'generateRecurringSessions', model: 'TherapyOrder',
    verdict: 'dbUnique', uniques: ['orderId'], codeAnchor: 'therapyOrder\\.create\\(',
    note: 'private 헬퍼 — 부모 `create` 의 orderId 유니크가 재시도를 먼저 막는다. 🔴 남는 위험은 중복이 아니라 반쪽이다(1회차만 커밋되고 2..N 회차가 실패하면 재시도가 유니크에 막혀 영영 안 생긴다) — 사람 결정이 아니라 트랜잭션 축의 개발 몫(판정표 참조).',
  },
  {
    file: 'voucher/voucher-ledger.service.ts', method: 'append', model: 'VoucherEvent',
    verdict: 'dbUnique', uniques: ['[voucherId,prevHash]'], codeAnchor: 'prevHash: input\\.prevHash',
    note: '같은 head 에서 두 갈래가 나지 않는다(해시 체인 분기 차단).',
  },

  // ── 위임·불변식·헬퍼 ────────────────────────────────────────────────────
  {
    file: 'cssd/cssd-inventory.service.ts', method: 'tx', model: 'SupplyTransaction',
    verdict: 'helperCallerOwned', codeAnchor: 'qty: delta, balanceAfter, reason',
    note: '잔량(balanceAfter)을 호출부가 계산해 넘기는 원장 기록 헬퍼다 — 중복 판정을 여기서 할 수 없다. 심판은 호출부(초기 재고·ERP 입고·수동 조정·재포장 소모)에 있다. 🔴 2026-09-28 스캐너가 `supplyTransaction` 을 결과 모델로 보게 되며 처음 보였다.',
  },
  {
    file: 'billing/billing.service.ts', method: 'recordRefundLine', model: 'BillingPayment',
    verdict: 'helperCallerOwned', codeAnchor: 'method: REFUND_LEDGER_METHOD, amount: -amountToPatient',
    note: '환불·취소 환급 원장 줄을 남기는 헬퍼다(음수 금액 · 환자에게 돌려준 돈). 중복 판정은 호출부에 있다 — refund·cancel 이 누적 refundAmount·상태를 조건으로 건 updateMany 가 0건이면 409 로 끝나 이 헬퍼까지 오지 않는다. 2026-10-14 수납·청구 결함 발굴 P1-5 로 생김.',
  },
  {
    file: 'inpatient/inpatient.service.ts', method: 'createStayBilling', model: 'Billing',
    verdict: 'delegated', codeAnchor: 'this\\.billing\\.createInpatientStayBilling\\(',
    note: '위임만 한다 — 실제 심판은 billing 쪽(행 잠금 후 재확인 · 패자는 ALREADY_BILLED). K2 봉합분.',
  },
  {
    file: 'nutrition/nutrition-advanced.service.ts', method: 'createDietOrder', model: 'DietOrder',
    verdict: 'invariantMaintained', codeAnchor: 'data: \\{ isActive: false, endDate: startDate \\}',
    note: '새 처방을 만들기 전에 이전 활성 처방을 같은 트랜잭션에서 마감한다 — 몇 번을 불러도 활성은 하나다(중복 행은 비활성 이력으로 남는다).',
  },

  // ── 죽은 코드 ──────────────────────────────────────────────────────────
  {
    file: 'order/order.service.ts', method: 'createFromPrescription', model: 'Order',
    verdict: 'deadCode', noCallers: true,
    note: '호출부 0(스펙만 남아 있다). 처방→오더 생성은 실제 경로가 전부 트랜잭션 안에서 짝지어 만든다. 가드를 붙이지 않고 사실만 적는다.',
  },

  // ── 🔴 심판 없음 — 사람 결정 ────────────────────────────────────────────
  ...(['createPurchaseOrder', 'createRequest', 'createRepackOrder', 'createCount'] as const).map((method) => ({
    file: 'inventory/inventory.service.ts', method,
    model: ({ createPurchaseOrder: 'PurchaseOrder', createRequest: 'InventoryRequest', createRepackOrder: 'RepackOrder', createCount: 'InventoryCount' } as const)[method],
    verdict: 'humanDecision' as const, codeAnchor: 'nextDailyDocNumber\\(pfx,', decisionKey: 'policy.inventory.duplicateSubmit',
    note: '🔴 종전 면제 근거 "문서번호 @unique" 는 사실이 아니었다 — 번호를 호출마다 새로 뽑아 재시도의 심판이 아니었다. 2026-09-28 채번(잠금 + 그날치 최대 + 1)은 봉합했지만 **중복 제출은 여전히 두 벌**이다. 앵커는 채번 봉합이 되돌아오지 않게 붙든다.',
  })),
];
