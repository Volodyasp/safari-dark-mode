// Background = CORS fetch proxy only (AN §Chosen architecture). No other
// listeners, no onMessageExternal (SPECS §9 security boundary).
const api = globalThis.browser ?? globalThis.chrome;

const MAX_BYTES = 10 * 1024 * 1024;

// top-level on purpose: test seam (AC-4) via sw.evaluate
async function fetchAsDataUrl(url) {
  try {
    if (!/^https?:/.test(url)) {
      return { ok: false, error: 'bad-url' };
    }

    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_BYTES) {
      return { ok: false, error: 'too-large' };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return { ok: false, error: 'too-large' };
    }

    const mime = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    const base64 = arrayBufferToBase64(buffer);
    return { ok: true, dataUrl: `data:${mime};base64,${base64}` };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32 * 1024;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'bdm:fetch') {
    return undefined;
  }
  fetchAsDataUrl(msg.url).then(sendResponse);
  return true;
});
