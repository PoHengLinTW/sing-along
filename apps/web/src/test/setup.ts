import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// CI runners are slower and busier than a laptop: a wait is only long when something is wrong.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
// The mix is remembered in localStorage per project: never let one test's mix leak into the next.
beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

// jsdom has no <dialog> modal support: emulate open/close and the close event.
// (Skipped in files that opt into the node environment, e.g. the FLAC encoder test.)
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
