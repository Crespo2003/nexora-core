import assert from 'node:assert/strict';
import test from 'node:test';
import { translateKnownMessage } from '../lib/i18n/translations';

// Regression test for: TypeError: Cannot read properties of null (reading 'tone')
// Root cause: rental-command-centre.tsx auto-dismiss effect calls setNotice(null)
// 5 seconds after any non-warning notice. The render at line 1231 previously accessed
// notice.tone unconditionally, crashing after the timer fired.
//
// Fix 1 (line 1231): render is now {notice && <div ...>} — null notice renders nothing.
// Fix 2 (line 695): language effect updater now guards null current.

type Notice = { tone: 'info' | 'success' | 'error' | 'warning'; message: string } | null;

// Mirrors the fixed updater used in the language effect.
function applyLanguageToNotice(current: Notice, language: 'en' | 'zh'): Notice {
  return current ? { ...current, message: translateKnownMessage(current.message, language) } : current;
}

// Mirrors the conditional rendering fix at line 1231.
function renderNotice(notice: Notice): string | null {
  return notice ? `<div class="notice ${notice.tone}">${notice.message}</div>` : null;
}

test('notice updater: returns null unchanged when current is null', () => {
  const result = applyLanguageToNotice(null, 'zh');
  assert.equal(result, null, 'updater must pass null through unchanged');
});

test('notice updater: translates message when current is non-null', () => {
  const notice: Notice = { tone: 'info', message: 'Connecting…' };
  const result = applyLanguageToNotice(notice, 'en');
  assert.ok(result !== null, 'updater must return non-null for non-null input');
  assert.equal(result?.tone, 'info', 'tone must be preserved');
  assert.equal(typeof result?.message, 'string', 'message must be a string');
});

test('renderNotice: returns null when notice is null (no crash)', () => {
  const output = renderNotice(null);
  assert.equal(output, null, 'null notice must render nothing — not throw TypeError');
});

test('renderNotice: renders notice div when notice is non-null', () => {
  const notice: Notice = { tone: 'success', message: '3 tenancies loaded' };
  const output = renderNotice(notice);
  assert.ok(typeof output === 'string', 'non-null notice must produce a string');
  assert.ok(output.includes('success'), 'rendered output must include tone class');
  assert.ok(output.includes('3 tenancies loaded'), 'rendered output must include message');
});

test('auto-dismiss sequence: null notice after dismissal does not crash render or updater', () => {
  // Simulates the full 5-second crash sequence:
  // 1. Success notice shown after data load
  // 2. Auto-dismiss fires, sets notice to null
  // 3. Language effect fires with null current
  // 4. Render receives null

  let notice: Notice = { tone: 'success', message: '3 tenancies loaded' };
  assert.equal(renderNotice(notice), '<div class="notice success">3 tenancies loaded</div>');

  // Auto-dismiss fires
  notice = null;

  // Language effect fires — must not throw
  notice = applyLanguageToNotice(notice, 'zh');
  assert.equal(notice, null, 'language effect with null must keep null');

  // Render must not throw
  const rendered = renderNotice(notice);
  assert.equal(rendered, null, 'null notice must render nothing after auto-dismiss');
});
