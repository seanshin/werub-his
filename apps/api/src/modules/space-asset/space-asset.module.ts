import { Module } from '@nestjs/common';
import { SpaceAssetController } from './space-asset.controller';
import { SpaceAssetService } from './space-asset.service';
import { SpaceBedLinkService } from './space-bed-link.service';

/** 공간 자산 배치 원장 — 워크스테이션·PC·의료기기·장비·보관 장소의 위치(spatial-flow-vision-3d §5-A) */
@Module({
  controllers: [SpaceAssetController],
  providers: [SpaceAssetService, SpaceBedLinkService],
  exports: [SpaceAssetService],
})
export class SpaceAssetModule {}
