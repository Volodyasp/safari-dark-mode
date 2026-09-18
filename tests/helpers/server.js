// Two static fixture servers used by the Playwright harness. Both serve
// tests/fixtures/; they run on different ports (and are reached under
// different hostnames, 127.0.0.1 vs localhost) so tests can exercise
// cross-origin behaviour (topHostOf, the CORS-CSS bridge).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const PORTS = [4180, 4181];
const BIG_BIN_BYTES = 11 * 1024 * 1024; // 11 MB, over the 10 MB proxy cap (AC-4)
const BIG_BIN_CHUNK = 64 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png'
};

function serveBigBin(res) {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(BIG_BIN_BYTES)
  });
  const chunk = Buffer.alloc(BIG_BIN_CHUNK);
  let sent = 0;
  function writeMore() {
    while (sent < BIG_BIN_BYTES) {
      const remaining = BIG_BIN_BYTES - sent;
      const piece = remaining >= BIG_BIN_CHUNK ? chunk : chunk.subarray(0, remaining);
      sent += piece.length;
      if (!res.write(piece)) {
        res.once('drain', writeMore);
        return;
      }
    }
    res.end();
  }
  writeMore();
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relPath = urlPath === '/' ? '/light.html' : urlPath;
  const filePath = path.join(FIXTURES_DIR, relPath);

  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end();
      return;
    }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' };
    if (relPath === '/csp.html') {
      headers['Content-Security-Policy'] = "script-src 'self'";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function requestHandler(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/big.bin') {
    serveBigBin(res);
    return;
  }
  serveFile(req, res);
}

async function startServers() {
  const servers = PORTS.map(() => http.createServer(requestHandler));
  await Promise.all(
    servers.map(
      (server, i) =>
        new Promise((resolve, reject) => {
          server.once('error', reject);
          // listen(port) with no host binds dual-stack loopback, so both
          // 127.0.0.1 and localhost reach the same server.
          server.listen(PORTS[i], resolve);
        })
    )
  );
  return servers;
}

async function stopServers(servers) {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
}

module.exports = { startServers, stopServers, PORTS };
