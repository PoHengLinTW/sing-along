import { describe, expect, it } from 'vitest';
import { isTypingTarget, transportShortcut } from './shortcuts';

const el = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
};
const key = (k: string, over: Partial<Parameters<typeof transportShortcut>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: document.body as EventTarget,
  ...over,
});

describe('isTypingTarget', () => {
  it('is true for text inputs, textareas, selects and contenteditable', () => {
    expect(isTypingTarget(el('<input type="text">'))).toBe(true);
    expect(isTypingTarget(el('<input>'))).toBe(true);
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isTypingTarget(el('<select><option>a</option></select>'))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true">x</div>'))).toBe(true);
    expect(isTypingTarget(el('<input type="range">'))).toBe(true); // arrows must move the slider
  });
  it('is false for the page, buttons and links', () => {
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(el('<button>x</button>'))).toBe(false);
    expect(isTypingTarget(el('<a href="#">x</a>'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('transportShortcut', () => {
  it('maps Space, Home, Left and Right', () => {
    expect(transportShortcut(key(' '))).toBe('toggle');
    expect(transportShortcut(key('Home'))).toBe('restart');
    expect(transportShortcut(key('ArrowLeft'))).toBe('back');
    expect(transportShortcut(key('ArrowRight'))).toBe('forward');
  });
  it('ignores other keys', () => {
    expect(transportShortcut(key('a'))).toBeNull();
    expect(transportShortcut(key('Enter'))).toBeNull();
  });
  it('is ignored while typing in a text field', () => {
    for (const k of [' ', 'Home', 'ArrowLeft', 'ArrowRight']) {
      expect(transportShortcut(key(k, { target: el('<input type="text">') }))).toBeNull();
      expect(transportShortcut(key(k, { target: el('<textarea></textarea>') }))).toBeNull();
      expect(
        transportShortcut(key(k, { target: el('<div contenteditable="true"></div>') })),
      ).toBeNull();
    }
  });
  it('lets Space activate a focused button instead of toggling playback twice', () => {
    expect(transportShortcut(key(' ', { target: el('<button>x</button>') }))).toBeNull();
    expect(transportShortcut(key('ArrowLeft', { target: el('<button>x</button>') }))).toBe('back');
  });
  it('ignores combinations with Ctrl, Cmd or Alt (browser and OS shortcuts)', () => {
    expect(transportShortcut(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(transportShortcut(key('Home', { metaKey: true }))).toBeNull();
    expect(transportShortcut(key(' ', { ctrlKey: true }))).toBeNull();
  });
});
