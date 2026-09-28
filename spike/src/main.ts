import { RAW_MIC_CONSTRAINTS, checkMicSupport, describeMicError } from './mic';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (msg: string) => ($('log').textContent += msg + '\n');

const support = checkMicSupport({
  isSecureContext: window.isSecureContext,
  hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
});
$('env').textContent = `${location.origin} | secure=${window.isSecureContext} | mic support=${support.ok ? 'yes' : support.reason}`;

$('enable-mic').addEventListener('click', async () => {
  if (!support.ok) return log(`Cannot use mic: ${support.reason}`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_MIC_CONSTRAINTS });
    log('Mic granted. Settings: ' + JSON.stringify(stream.getAudioTracks()[0].getSettings()));
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    log(describeMicError(e as Error));
  }
});
