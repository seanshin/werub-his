/**
 * 기초 데이터(고시 자료) 반영 — **정본 서비스를 그대로 부른다.**
 *
 * 🔴 이 스크립트가 로직을 갖지 않는 것이 요점이다. 파싱된 JSON 을 읽어
 *    `ReferenceDatasetService` 에 넘길 뿐이다. 여기에 판정을 다시 쓰면
 *    정본이 둘이 되고, 스크립트로 넣은 것과 화면으로 넣은 것이 갈라진다.
 *
 * 사용:
 *   node dist/scripts/import-reference-file.js drug-price <파일.json> [--apply]
 *   기본은 **dry-run**(무엇이 바뀌는지만 말하고 쓰지 않는다).
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { readFileSync } from 'node:fs';
import { ConfigRuntimeService } from '../modules/config/config-runtime.service';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { ReferenceDatasetService } from '../modules/code-master/reference-dataset.service';

/**
 * 🔴 **`AppModule` 전체를 올리지 않는다.**
 *    운영에서 한 번 그렇게 돌렸더니 모든 모듈의 `onModuleInit` 이 실행되어
 *    거버넌스 시드가 트랜잭션 에러를 냈다(크론 스케줄러도 함께 뜬다).
 *    반영에 필요한 것은 Prisma 와 이 서비스뿐이다 — 그 둘만 올린다.
 */
// 🔴 모듈이 아니라 **서비스만** 제공한다.
//    `ConfigRuntimeModule` 을 import 하면 그 컨트롤러까지 딸려와 `RolesGuard` →
//    `PermissionService` 를 요구한다 — 반영 스크립트가 인가 계층을 올릴 이유가 없다.
//    `EventEmitterModule` 은 AppModule 에서 전역이라 좁힌 컨텍스트에선 빠지므로 함께 올린다.
//    (둘 다 필수 주입이라 빠지면 **부팅에서 멈춘다** — 조용히 undefined 가 되지 않는다.)
@Module({
  imports: [PrismaModule, EventEmitterModule.forRoot()],
  providers: [ReferenceDatasetService, ConfigRuntimeService],
})
class ImportContextModule {}

async function main() {
  const [kind, file, ...flags] = process.argv.slice(2);
  const apply = flags.includes('--apply');
  if (!kind || !file) {
    console.error('사용: import-reference-file <kind> <파일.json> [--apply]');
    process.exit(2);
  }
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const app = await NestFactory.createApplicationContext(ImportContextModule, { logger: ['error', 'warn'] });
  const ref = app.get(ReferenceDatasetService);
  const prisma = app.get(PrismaService);

  // 🔴 사람 계정을 흉내내지 않는다 — 누가 넣었는지 원장에 남아야 하므로 실제 ADMIN 을 찾는다
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } });
  if (!admin) { console.error('ADMIN 계정을 찾지 못했다 — 원장에 반영자를 남길 수 없어 중단한다'); process.exit(3); }

  if (!apply) {
    console.log(`[dry-run] ${kind} · 기준일 ${payload.effectiveDate} · ${payload.rows.length.toLocaleString()}행`);
    console.log(`          출처 ${payload.sourceName} · hash ${payload.contentHash ?? '(없음)'}`);
    console.log(`          반영자 ${admin.email}`);
    console.log('          --apply 를 붙이면 실제로 반영한다.');
    await app.close(); return;
  }

  const r =
    kind === 'drug-price' ? await ref.importDrugPriceList(payload.rows, { ...payload, userId: admin.id })
    : kind === 'procedure-fee' ? await ref.importProcedureFees(payload.rows, { ...payload, userId: admin.id })
    : null;
  if (!r) { console.error(`알 수 없는 kind: ${kind} (drug-price | procedure-fee)`); process.exit(2); }
  console.log(JSON.stringify(r, null, 2));
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
