importScripts('./search-index.js');

const index = self.MolanSearchIndex.createSearchIndex();

self.addEventListener('message', event => {
  const message = event.data || {};
  try {
    let result;
    if (message.type === 'build') result = index.build(message.documents);
    else if (message.type === 'search') result = index.search(message.query, message.options);
    else if (message.type === 'clear') { index.clear(); result = { documentCount: 0 }; }
    else throw new Error('未知搜索操作');
    self.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: message.id, ok: false, error: String(error && error.message || error) });
  }
});
