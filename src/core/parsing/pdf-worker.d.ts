// pdf.js ships no types for its worker module; it is only loaded to run on the calling thread (see pdf.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
