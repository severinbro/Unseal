import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Removes photo/thumbnail files from the uploads directory after the owning
 * database rows were deleted (GDPR Art. 17). Missing files are ignored; names
 * that are not plain file names are skipped so nothing outside `uploadsDir`
 * can ever be touched.
 */
export async function unlinkUploadFiles(
  uploadsDir: string,
  fileNames: readonly string[],
): Promise<void> {
  for (const fileName of new Set(fileNames)) {
    if (fileName.length === 0 || path.basename(fileName) !== fileName) {
      continue;
    }
    await fs.unlink(path.join(uploadsDir, fileName)).catch(() => undefined);
  }
}
