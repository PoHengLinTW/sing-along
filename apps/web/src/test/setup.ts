import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom has no <dialog> modal support: emulate open/close and the close event.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
