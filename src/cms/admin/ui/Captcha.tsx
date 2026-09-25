'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Google reCAPTCHA v2 checkbox.
 *
 * Rendered EXPLICITLY rather than by the `g-recaptcha` class the auto-render
 * mode scans for: the auto mode races React, which owns this subtree and can
 * unmount it between the script loading and the scan.
 *
 * No `@types/grecaptcha` dependency for the three members actually used.
 */
interface GrecaptchaApi {
  render(
    container: HTMLElement,
    parameters: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): number;
  reset(widgetId?: number): void;
}

declare global {
  interface Window {
    grecaptcha?: GrecaptchaApi;
    /** Named `onload` target for the explicit-render script. */
    cmsCaptchaOnload?: () => void;
  }
}

const ONLOAD_CALLBACK = 'cmsCaptchaOnload';
const SCRIPT_SRC = `https://www.google.com/recaptcha/api.js?render=explicit&onload=${ONLOAD_CALLBACK}`;

export interface CaptchaProps {
  siteKey: string;
  /** Called with a fresh token, or `null` when it expires or errors. */
  onToken: (token: string | null) => void;
  /**
   * Change this to clear the widget. A v2 token is single-use, so after a
   * rejected submit the widget MUST be reset — reusing the spent token fails
   * with `timeout-or-duplicate`, and the user is stuck on a form that can never
   * succeed no matter how correct their password is.
   */
  resetSignal?: number;
}

export function Captcha({ siteKey, onToken, resetSignal = 0 }: CaptchaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<number | null>(null);
  const onTokenRef = useRef(onToken);

  // Kept in a ref so a parent re-render with a new closure does not tear the
  // widget down and build it again.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const renderWidget = useCallback(() => {
    // Strict mode runs effects twice in development, and `onReady` fires on
    // every mount; rendering twice into the same node stacks two widgets.
    if (widgetIdRef.current !== null) return;
    const api = window.grecaptcha;
    if (!api?.render || !containerRef.current) return;
    widgetIdRef.current = api.render(containerRef.current, {
      sitekey: siteKey,
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
    });
  }, [siteKey]);

  useEffect(() => {
    // `render=explicit` means the API is only usable once this fires.
    window[ONLOAD_CALLBACK] = renderWidget;
    // Covers a remount after the script already loaded, when `onload` has
    // fired for good and will not fire again.
    renderWidget();
    return () => {
      delete window[ONLOAD_CALLBACK];
    };
  }, [renderWidget]);

  useEffect(() => {
    if (resetSignal === 0 || widgetIdRef.current === null) return;
    window.grecaptcha?.reset(widgetIdRef.current);
  }, [resetSignal]);

  return (
    <>
      <Script src={SCRIPT_SRC} strategy="afterInteractive" onReady={renderWidget} />
      <div ref={containerRef} />
    </>
  );
}
