import { ruleKey } from '../design/design';

// Every CSS rule of the app, read from the page, so the design editor can change any property of
// any of them. Design-variable blocks (:root …) are left to the variables tab.

export interface Declaration {
  prop: string;
  value: string;
  important: boolean;
}

export interface AppRule {
  key: string;
  selector: string;
  media: string;
  decls: Declaration[];
}

/** Splits text at a separator that isn't inside quotes, brackets or parentheses. */
export function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseDeclarations(cssText: string): Declaration[] {
  const out: Declaration[] = [];
  for (const part of splitTopLevel(cssText, ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    out.push({ prop: prop.startsWith('--') ? part.slice(0, colon).trim() : prop, value, important });
  }
  return out;
}

const SKIP_SHEET = (s: CSSStyleSheet) => {
  const owner = s.ownerNode as Element | null;
  return owner?.id === 'nb-design';
};

/** The app's style rules, in page order. Rules with the same selector and media are merged. */
export function readAppRules(doc: Document = document): AppRule[] {
  const byKey = new Map<string, AppRule>();
  const visit = (rules: CSSRuleList, media: string) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSMediaRule) visit(r.cssRules, media ? `${media} and ${r.conditionText}` : r.conditionText);
      else if (r instanceof CSSSupportsRule) visit(r.cssRules, media);
      else if (r instanceof CSSStyleRule) {
        const selector = r.selectorText.trim();
        if (/^:root\b/.test(selector) && !selector.includes(' ')) continue;
        const decls = parseDeclarations(r.style.cssText);
        if (!decls.length) continue;
        const key = ruleKey(selector, media);
        const existing = byKey.get(key);
        if (existing) {
          for (const d of decls) {
            const i = existing.decls.findIndex((x) => x.prop === d.prop);
            if (i >= 0) existing.decls[i] = d;
            else existing.decls.push(d);
          }
        } else byKey.set(key, { key, selector, media, decls });
      }
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    if (SKIP_SHEET(sheet)) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a stylesheet from another origin (fonts)
    }
    visit(rules, '');
  }
  return [...byKey.values()];
}

// States that come and go (hover, focus …) and pseudo-elements, stripped so a picked element
// finds the rules that style it in those states too.
const DYNAMIC = /::?(before|after|placeholder|selection|marker|first-line|first-letter|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b|:(hover|active|focus|focus-visible|focus-within|visited|target)\b/g;

/** Whether a rule styles this element (in any state). */
export function ruleMatches(rule: AppRule, el: Element): boolean {
  for (const part of splitTopLevel(rule.selector, ',')) {
    const plain = part.replace(DYNAMIC, '').trim() || '*';
    try {
      if (el.matches(plain)) return true;
    } catch {
      /* a selector this browser can't test */
    }
  }
  return false;
}

/** A short description of an element, e.g. button.btn.primary */
export function describeElement(el: Element): string {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4) : [];
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.map((c) => `.${c}`).join('')}`;
}
