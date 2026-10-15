import http from 'node:http';

const posts = [];

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/posts') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(posts));
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,GET,OPTIONS',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/api/v1/widget/chat')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  posts.push(body);
  const origin = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

  if (body.chipActionId === 'send_receipt' && String(body.message || '').includes('expired@example.com')) {
    res.writeHead(409, { ...origin, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'action_expired', message: 'This action expired.' } }));
    return;
  }
  if (body.chipActionId === 'unauthorized_tool') {
    res.writeHead(403, { ...origin, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'tool_disabled', message: 'That action is not available.' } }));
    return;
  }
  if (String(body.message || '').includes('timeout@example.com')) {
    req.socket.destroy();
    return;
  }
  res.writeHead(200, { ...origin, 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ type: 'conversationId', id: 'conv-form-1' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'token', content: 'Receipt sent.' })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  res.end();
});

server.listen(4191, '127.0.0.1');
