"use client";

import { useEffect } from "react";

const yahooBrandPattern = /Yahoo!\s*(?:JAPAN|ショッピング)/gi;
const yahooAttributionPattern = /Webサービス\s*by\s*Yahoo!\s*JAPAN/gi;
const yahooProviderPattern = /yahoo_shopping/gi;

function sanitizeText(value: string) {
  return value
    .replace(yahooAttributionPattern, "")
    .replace(yahooBrandPattern, "外部商品DB")
    .replace(yahooProviderPattern, "外部商品DB");
}

function sanitizeProviderBranding(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const original = node.textContent ?? "";
    const next = sanitizeText(original);
    if (next !== original) node.textContent = next;
    node = walker.nextNode();
  }

  root.querySelectorAll<HTMLElement>("img, a, [aria-label], [title]").forEach((element) => {
    const image = element instanceof HTMLImageElement ? element : null;
    const text = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${image?.alt ?? ""}`;

    if (/Webサービス\s*by\s*Yahoo!\s*JAPAN/i.test(text)) {
      element.hidden = true;
      return;
    }

    if (image && /Yahoo!/i.test(`${image.alt} ${image.title} ${image.src}`)) {
      image.hidden = true;
      return;
    }

    if (element instanceof HTMLAnchorElement && /yahoo\.co\.jp/i.test(element.href)) {
      const normalized = sanitizeText(element.textContent ?? "").trim();
      if (!normalized || /Yahoo!/i.test(element.textContent ?? "")) {
        element.textContent = "商品ページで確認";
      }
      element.removeAttribute("aria-label");
      element.removeAttribute("title");
    }
  });
}

/**
 * The product lookup keeps provider provenance internally, while Settings/Library
 * presents external providers generically. This guard also catches provider
 * attribution nodes inserted dynamically after hydration.
 */
export function ProviderBrandingSanitizer() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".settings-page");
    if (!root) return;

    sanitizeProviderBranding(root);
    const observer = new MutationObserver(() => sanitizeProviderBranding(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
