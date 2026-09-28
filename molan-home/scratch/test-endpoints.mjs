async function test() {
  const detectRes = await fetch('http://127.0.0.1:3000/api/style/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '张拂潇嘴里叼着一根草，骂了一句：“抢劫抢到老娘头上来了？你们给老娘等着！”' })
  }).then(r => r.json());
  console.log('detect:', detectRes.ok, detectRes.styleArchetype, detectRes.genreFamily);

  const healthRes = await fetch('http://127.0.0.1:3000/api/chapter/health-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '第1章 测试\n\n短文一段。\n\n然而就在此刻，门外突然传来了极其刺耳的破空声！',
      metadata: { title: '测试' }
    })
  }).then(r => r.json());
  console.log('health:', healthRes.ok, healthRes.health.grade, healthRes.health.compositeScore);

  const debtCreate = await fetch('http://127.0.0.1:3000/api/causal-debts/e2e-book-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'arc', debtCategory: 'comedy_mess', seed: '把长老的胡子给剃了', originChapter: 1 })
  }).then(r => r.json());
  console.log('debtCreate:', debtCreate.ok, debtCreate.debt.id);

  const debtGet = await fetch('http://127.0.0.1:3000/api/causal-debts/e2e-book-1?chapterNo=2').then(r => r.json());
  console.log('debtGet:', debtGet.ok, debtGet.active.length);

  const debtSettle = await fetch('http://127.0.0.1:3000/api/causal-debts/e2e-book-1/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debtId: debtCreate.debt.id, reason: '长老买了假胡子戴上' })
  }).then(r => r.json());
  console.log('debtSettle:', debtSettle.ok, debtSettle.debt.status);
}
test().catch(console.error);
