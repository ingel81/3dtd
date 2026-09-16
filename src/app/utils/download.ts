/**
 * Saving files from the page: photo mode's pictures, the state dump, the
 * corridor snapshot.
 */

/** `text` reduced to lower-case ASCII letters, digits and dashes, at most `maxLength` long, for a file name; empty when nothing is left. */
export function fileSlug(text: string, maxLength: number): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}

/** Save `blob` as `fileName` through a download link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The download has picked the blob up by then
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
