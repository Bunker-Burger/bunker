"use client";

import { useSyncExternalStore } from "react";

const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

export function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) return !element.readOnly && !NON_TEXT_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable === true;
}

function hasOnScreenKeyboard() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function readKeyboardOpen() {
  return hasOnScreenKeyboard() && isTextEntry(document.activeElement);
}

function subscribe(onChange: () => void) {
  // focusout fires before focus lands elsewhere; defer so activeElement is settled.
  const deferred = () => queueMicrotask(onChange);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", deferred);
  return () => {
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", deferred);
  };
}

/**
 * True while a touch device is editing text, i.e. the on-screen keyboard is up.
 * Fixed bars hide in that state so they never cover the focused field.
 */
export function useVirtualKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, readKeyboardOpen, () => false);
}
