'use strict';
const fs = require('node:fs');

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 18 * 1024 * 1024) {
  let parts = [],
    size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const e = new Error('Request too large');
      e.status = 413;
      throw e;
    }
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || '{}');
  } catch {
    throw new Error('Invalid JSON');
  }
}
function serve(res, file, type, req) {
  const size = fs.statSync(file).size;
  const headers = {
    'Content-Type': type,
    'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=3600',
    'Accept-Ranges': 'bytes',
  };
  const range = req?.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = 0,
      end = size - 1;
    if (match) {
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      } else if (match[2]) start = Math.max(0, size - Number(match[2]));
      else start = -1;
    } else start = -1;
    if (start < 0 || start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req?.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

module.exports = { json, body, serve };
