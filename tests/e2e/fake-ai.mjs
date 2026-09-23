// A stand-in for Ollama, answering each kind of prompt the app sends
// with a realistic reply.
import http from 'node:http';
import { fakeEmbedding } from '../fake-ollama.mjs';
export const REPLIES = {
  classify: JSON.stringify({ pages: [{ page: 1, view: 'general_assembly' }, { page: 2, view: 'bom' }] }),
  parts: JSON.stringify({
    drawing_number: '2501-010', jobNumber: '2024-017H', customer: 'EARTHCARE LLC',
    description: '12" DIA X 20\' LG INCLINED SCREW CONVEYOR',
    parts: [
      { balloon: 3, item: 'Motor', item_as_drawn: 'GEARMOTOR, 5HP 39RPM TEFC', quantity: 1, installation_location: 'drive_end', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 7, item: 'Hanger Bearing', item_as_drawn: 'HNGR BRG ASSY, UHMW', quantity: 2, installation_location: 'hanger', source_page: 2, extraction_method: 'bom_table', confidence: 0.9 },
      { balloon: 11, item: 'Auger', item_as_drawn: '12" DIA X 12" PITCH SECTIONAL FLIGHTS', quantity: 3, installation_location: 'screw', source_page: 2, extraction_method: 'bom_table', confidence: 0.85 }
    ]
  }),
  callouts: JSON.stringify({ callouts: [
    { balloon: 3, source_page: 1, position: { x: 0.86, y: 0.42 }, confidence: 0.9 },
    { balloon: 7, source_page: 1, position: { x: 0.38, y: 0.50 }, confidence: 0.9 },
    { balloon: 7, source_page: 1, position: { x: 0.58, y: 0.50 }, confidence: 0.9 },
    { balloon: 11, source_page: 1, position: { x: 0.47, y: 0.46 }, confidence: 0.8 }
  ]}),
  layout: JSON.stringify({ jobNumber: '2024-017H', customer: 'EARTHCARE LLC', orientation: { drive_end_side: 'right', detail: 'gearmotor at the right end' } })
};
export function startFakeAI(port){
  const seen = [];
  const s = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const j = JSON.parse(body || '{}');
    const send = obj => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if(req.url === '/api/tags') return send({ models: [{ name: 'fake-chat', size: 1e9 }, { name: 'fake-vision', size: 1e9 }, { name: 'nomic-embed-text', size: 3e8 }] });
    if(req.url === '/api/ps') return send({ models: [] });
    if(req.url === '/api/version') return send({ version: '0.0-test' });
    if(req.url === '/api/embed') return send({ embeddings: j.input.map(fakeEmbedding) });
    const system = j.messages?.[0]?.content || '';
    const user = JSON.stringify(j.messages?.[1]?.content || '');
    let which;
    if(/classify which kind of page/i.test(system)) which = 'classify';
    else if(/BALLOON CALLOUT is a small circle/i.test(system)) which = 'callouts';
    else if(/transcribe the parts table/i.test(system)) which = 'parts';
    else if(/STRUCTURED ACTIONS/.test(system)) which = 'actions';
    else if(/which side of the assembly view is the DRIVE END/i.test(system)) which = 'layout';
    else which = 'answer';
    seen.push(which);
    let text = REPLIES[which];
    if(which === 'actions'){
      text = /blocker/i.test(user)
        ? JSON.stringify([{ action: 'create_blocker', jobNumber: '2024-017H', issue: 'Gearmotor not delivered', severity: 'High' }])
        : JSON.stringify([{ action: 'advance_stage', jobNumber: '2024-017H' }]);
    }
    if(which === 'answer') text = 'Focus on 2024-017H first: it is due soon and has no blockers.';
    send({ message: { role: 'assistant', content: text }, done: true, prompt_eval_count: 100, eval_count: 50 });
  });
  return new Promise(r => s.listen(port, '127.0.0.1', () => r({ server: s, seen })));
}
