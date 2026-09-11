declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  interface PdfTextItem {
    readonly str: string;
    readonly hasEOL?: boolean;
  }
  interface PdfPage {
    getTextContent(): Promise<{ readonly items: readonly PdfTextItem[] }>;
  }
  interface PdfDocument {
    readonly numPages: number;
    getPage(pageNumber: number): Promise<PdfPage>;
    destroy(): Promise<void>;
  }
  export function getDocument(input: {
    readonly data: Uint8Array;
    readonly isEvalSupported: boolean;
    readonly disableWorker: boolean;
    readonly useSystemFonts: boolean;
  }): { readonly promise: Promise<PdfDocument> };
}
