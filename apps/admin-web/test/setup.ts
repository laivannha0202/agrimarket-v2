import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// jsdom shims required by antd v6 / rc-* components.
// ---------------------------------------------------------------------------

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in window)) {
  // @ts-expect-error - jsdom shim
  window.ResizeObserver = ResizeObserverStub;
}

class IntersectionObserverStub {
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (!("IntersectionObserver" in window)) {
  // @ts-expect-error - jsdom shim
  window.IntersectionObserver = IntersectionObserverStub;
}

if (!window.scrollTo) {
  window.scrollTo = () => {};
}

// ---------------------------------------------------------------------------
// Fail any test that lets an antd warning reach the console.
//
// antd v6 routes its deprecation/usage warnings through `console.error` (via
// rc-util's `warning`). Capturing them here means a regression that
// reintroduces e.g. the `Alert message` / `Modal maskClosable` / `useForm not
// connected` warnings fails the suite instead of scrolling past silently.
// ---------------------------------------------------------------------------

const antdWarningPatterns = [
  /\[antd:/,
  /not connected to any Form element/,
  /is deprecated/,
];

let capturedAntdWarnings: string[] = [];
const originalError = console.error;

console.error = (...args: unknown[]) => {
  const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  if (antdWarningPatterns.some((re) => re.test(text))) {
    capturedAntdWarnings.push(text);
  }
  originalError(...(args as Parameters<typeof console.error>));
};

export function takeAntdWarnings(): string[] {
  const copy = capturedAntdWarnings;
  capturedAntdWarnings = [];
  return copy;
}

afterEach(() => {
  cleanup();
  capturedAntdWarnings = [];
  vi.clearAllMocks();
});
