import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PACS 워크리스트 연동 계약 — 2026-08-02.
 *
 * 이 파일이 지키는 세 가지는 전부 **실제로 조용히 깨져 있던 것**이다:
 *  1. 등록 실패를 삼키고 성공 로그를 찍었다(관측 불가)
 *  2. accession 번호를 `notes` 에 덮어써 수행 메모를 지웠다
 *  3. `order.cancelled` payload 계약이 어긋나 취소 역전이가 **한 번도 발동하지 않았다**
 */
const listener = readFileSync(join(process.cwd(), 'src/modules/pacs-proxy/pacs-integration.listener.ts'), 'utf-8');
const orderSvc = readFileSync(join(process.cwd(), 'src/modules/order/order.service.ts'), 'utf-8');
const rxSvc = readFileSync(join(process.cwd(), 'src/modules/prescription/prescription.service.ts'), 'utf-8');
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');

describe('워크리스트 등록 결과 기록', () => {
  it('전용 컬럼이 있다 — notes 를 쓰지 않는다', () => {
    expect(schema).toContain('accessionNumber String?');
    expect(schema).toContain('worklistStatus  String?');
  });

  it('🔴 accession 을 notes 에 쓰지 않는다(수행 메모 덮어쓰기 방지)', () => {
    expect(listener).not.toMatch(/notes:\s*`accession:/);
    expect(listener).toContain('accessionNumber: accNo');
  });

  it('🔴 등록 실패를 삼키지 않는다 — catch 안에서 FAILED 로 남긴다', () => {
    expect(listener).toContain("worklistStatus: 'FAILED'");
    expect(listener).toContain('worklistError');
    // 실패를 .catch(warn) 로 흘려보내는 구조가 아니어야 한다 — 호출 **문장 안**에 catch 가 없을 것
    // 주석에도 같은 이름이 나오므로 **실제 호출문**을 앵커로 잡는다
    const call = listener.slice(listener.indexOf('await this.pacsProxy.createWorklistItem'));
    const stmt = call.slice(0, call.indexOf('});') + 3);
    expect(stmt).not.toContain('.catch(');
  });

  it('성공했을 때만 REGISTERED', () => {
    const success = listener.slice(listener.indexOf('await this.pacsProxy.createWorklistItem'), listener.indexOf('} catch (e) {'));
    expect(success).toContain("worklistStatus: 'REGISTERED'");
  });
});

describe('PACS 호출 실패 전파', () => {
  const proxy = readFileSync(join(process.cwd(), 'src/modules/pacs-proxy/pacs-proxy.service.ts'), 'utf-8');

  it('🔴 쓰기 작업은 실패를 예외로 올린다 — null 을 돌려주면 호출부 try/catch 가 발동하지 않는다', () => {
    // 실측: PACS 가 401 을 냈는데 request() 가 null 을 반환해 "등록 성공" 로그 + REGISTERED 가 남았다
    const create = proxy.slice(proxy.indexOf('async createWorklistItem'), proxy.indexOf('async createWorklistItem') + 300);
    expect(create).toContain('throwOnError: true');
    const cancel = proxy.slice(proxy.indexOf('async cancelOrder'), proxy.indexOf('async cancelOrder') + 300);
    expect(cancel).toContain('throwOnError: true');
  });

  it('🔴 호출부가 적는 것을 잊어도 비-GET 은 기본으로 예외 — 판독 서명 11자리가 이 기억에 기대고 있었다', () => {
    // 2026-09-15 외부 실호출: PACS 401 인데 HIS 는 201 {data:null} → 화면 "리포트 서명이 완료되었습니다"
    expect(proxy).toContain("const failLoudly = opts?.throwOnError ?? method.toUpperCase() !== 'GET';");
    for (const write of ['async createReport', 'async updateReport', 'async signReport', 'async createOrder']) {
      const at = proxy.indexOf(write);
      expect(at, `${write} 가 없다`).toBeGreaterThan(-1);
      expect(proxy.slice(at, at + 400), `${write}: 실패를 null 로 돌려주는 자리가 남았다`).not.toContain('?? null');
    }
  });

  it('HTTP 오류와 연결 실패 모두 전파된다 — 상류 상태 코드를 메시지에 남긴다', () => {
    expect(proxy).toMatch(/if \(failLoudly\) throw this\.writeFailure\(method, path, res\.status\)/);
    expect(proxy).toMatch(/if \(failLoudly\) throw this\.writeFailure\(method, path, undefined/);
    expect(proxy).toContain("error: 'PACS_WRITE_FAILED'");
    // 상태 코드는 details 로 내려보낸다(문장으로 조립하지 않는다 — 서버 조립 한국어 가드)
    expect(proxy).toContain('details: { method, path, status: status ?? null, reason: reason ?? null }');
  });

  it('조회는 종전대로 null 로 완만히 실패한다(화면이 버틴다)', () => {
    const req = proxy.slice(proxy.indexOf('private async request'));
    expect(req).toContain('return null;');
  });
});

describe('취소 역전이 payload 계약', () => {
  it('🔴 구독자가 orderIds[](발행부 실제 형태)를 받는다', () => {
    const handler = listener.slice(listener.indexOf('handleOrderCancelled'));
    expect(handler).toContain('payload?.orderIds');
    expect(handler).toContain('payload?.orderId');
  });

  it('department 를 payload 가 아니라 DB 에서 읽는다(발행부가 안 넣어도 동작)', () => {
    const handler = listener.slice(listener.indexOf('handleOrderCancelled'));
    expect(handler).toMatch(/department:\s*'IMAGING'/);
    expect(handler).not.toMatch(/payload\.department\s*!==/);
  });

  it('컬럼 도입 이전 건(notes 에 남은 accession)도 처리한다', () => {
    const handler = listener.slice(listener.indexOf('handleOrderCancelled'));
    expect(handler).toContain("notes?.startsWith('accession:')");
  });

  it('🔴 오더 상태변경 취소 경로도 이벤트를 낸다 — 종전엔 무발행이라 PACS 에 유령 오더가 남았다', () => {
    expect(orderSvc).toContain("emit('order.cancelled'");
    const emit = orderSvc.slice(orderSvc.indexOf("emit('order.cancelled'"));
    expect(emit).toContain('orderIds: [id]');
    expect(emit).toContain('department: order.department');
    expect(emit).toContain('prescriptionId: order.prescriptionId');
  });

  it('처방 취소 경로의 발행 형태도 그대로 유지된다(정산 역전이 prescriptionId 를 쓴다)', () => {
    const emit = rxSvc.slice(rxSvc.indexOf("emit('order.cancelled'"));
    expect(emit).toContain('prescriptionId: id');
    expect(emit).toContain('orderIds: cancelledOrderIds');
  });
});
