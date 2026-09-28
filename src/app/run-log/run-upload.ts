/**
 * Sending a coop run log to the relay (TODO E38): the player's answer, asked
 * once after the first coop game on a relay that collects and changeable in
 * the Runs dialog, and the packing for the way (gzip, base64).
 */
import { gzipBase64 } from '../utils/gzip-base64';
import { readText, writeText } from '../utils/storage';

const CONSENT_KEY = '3dtd-run-upload';

/** 'yes' or 'no' once the player answered, null while never asked */
export type RunUploadConsent = 'yes' | 'no' | null;

export function readRunUploadConsent(): RunUploadConsent {
  const value = readText(CONSENT_KEY);
  return value === 'yes' || value === 'no' ? value : null;
}

export function writeRunUploadConsent(consent: 'yes' | 'no'): void {
  writeText(CONSENT_KEY, consent);
}

/** The log as gzip in base64, the relay's run-log message */
export function packRunLog(text: string): Promise<string> {
  return gzipBase64(text);
}
