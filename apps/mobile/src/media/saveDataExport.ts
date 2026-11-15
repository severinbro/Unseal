import { Platform, Share } from 'react-native';

interface WebBlobLike {
  readonly size: number;
}

interface WebAnchorLike {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
}

interface WebDownloadGlobals {
  Blob?: new (parts: string[], options: { type: string }) => WebBlobLike;
  URL?: {
    createObjectURL(blob: WebBlobLike): string;
    revokeObjectURL(url: string): void;
  };
  document?: {
    createElement(tag: 'a'): WebAnchorLike;
    body: { appendChild(node: WebAnchorLike): unknown };
  };
}

export function buildDataExportFileName(now: Date = new Date()): string {
  return `unseal-data-export-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Hands the GDPR data export (JSON text) to the user: a file download on web,
 * the system share sheet on Android/iOS (save to Files, mail to self, …).
 */
export async function saveDataExport(
  json: string,
  fileName: string = buildDataExportFileName(),
): Promise<'downloaded' | 'shared'> {
  if (Platform.OS === 'web') {
    const g = globalThis as unknown as WebDownloadGlobals;
    if (!g.Blob || !g.URL || !g.document) {
      throw new Error('File downloads are not supported in this browser.');
    }
    const blob = new g.Blob([json], { type: 'application/json' });
    const url = g.URL.createObjectURL(blob);
    const anchor = g.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    g.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const urlApi = g.URL;
    setTimeout(() => urlApi.revokeObjectURL(url), 1_000);
    return 'downloaded';
  }

  await Share.share({ title: fileName, message: json });
  return 'shared';
}
