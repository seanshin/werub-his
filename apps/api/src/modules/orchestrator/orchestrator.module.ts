import { Module } from '@nestjs/common';
import { OrchestratorEngine } from './orchestrator-engine';
import { ToolRegistry } from './tool-registry';

@Module({
  providers: [OrchestratorEngine, ToolRegistry],
  exports: [OrchestratorEngine, ToolRegistry],
})
export class OrchestratorModule {}
