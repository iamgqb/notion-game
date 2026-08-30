#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE_ROOT = path.resolve(__dirname, '../../site');
const PORT = Number(process.env.PORT || 4173);
const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
};

/** @author yuecheng */
function requestedFile(urlValue) {
    const pathname = new URL(urlValue, 'http://localhost').pathname;
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(SITE_ROOT, relativePath);
    return resolved.startsWith(`${SITE_ROOT}${path.sep}`) ? resolved : null;
}

/** @author yuecheng */
const server = http.createServer((request, response) => {
    const filePath = requestedFile(request.url);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
        return;
    }
    response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(response);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`游戏陈列室：http://127.0.0.1:${PORT}`);
});
