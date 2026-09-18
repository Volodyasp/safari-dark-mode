// Allowed by the page's `Content-Security-Policy: script-src 'self'` header
// (external, same-origin script). Appends a text node so the page is
// observably "alive" even though its inline <script> was blocked.
document.body.appendChild(document.createTextNode(' (csp.js ran)'));
