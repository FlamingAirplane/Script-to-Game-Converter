// Resolved per build mode in vite.config.ts (inline for the offline edition, file otherwise).
declare module '@pipeline-worker' {
  const PipelineWorker: { new (): Worker };
  export default PipelineWorker;
}
