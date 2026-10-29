export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Some browsers deny clipboard access after an awaited API request. */ }
  const previous = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(input);
  try {
    input.select();
    return Boolean(document.execCommand('copy'));
  } catch {
    return false;
  } finally {
    input.remove();
    previous?.focus?.();
  }
}
