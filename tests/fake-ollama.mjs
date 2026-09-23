// A small Ollama for the tests: chat answers from a handler, embeddings
// from a bag of words -- so texts sharing words come out similar, which
// is all retrieval needs to be tested against.
import http from 'node:http';

const DIM = 64;
export function fakeEmbedding(text){
  const v = new Array(DIM).fill(0);
  for(const w of String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []){
    let h = 0;
    for(const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % DIM] += 1;
  }
  return v;
}

/** `chat(body, req)` returns the answer text, or { status, error }. */
export function startFakeOllama({ chat = () => 'OK', models = ['fake-chat', 'fake-vision', 'nomic-embed-text'] } = {}){
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    calls.push({ url: req.url, body });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if(req.url === '/api/tags') return send(200, { models: models.map(name => ({ name, size: 1e9, details: {} })) });
    if(req.url === '/api/ps') return send(200, { models: [] });
    if(req.url === '/api/version') return send(200, { version: '0.0-test' });
    if(req.url === '/api/embed') return send(200, { embeddings: body.input.map(fakeEmbedding) });
    if(req.url === '/api/chat'){
      const out = await chat(body, req);
      if(out && typeof out === 'object') return send(out.status, { error: out.error });
      return send(200, { message: { role: 'assistant', content: out }, done: true, prompt_eval_count: 50, eval_count: 10 });
    }
    send(404, { error: 'not found' });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => server.close() })));
}
