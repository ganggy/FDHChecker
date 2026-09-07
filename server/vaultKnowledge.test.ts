import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fetchOllamaEmbeddings, cosineSimilarity, tokenizeThai } from './vaultKnowledge.js';

test('cosineSimilarity calculates accurate vector similarity', () => {
  const vec1 = [1, 0, 0];
  const vec2 = [1, 0, 0];
  assert.ok(Math.abs(cosineSimilarity(vec1, vec2) - 1.0) < 1e-6);

  const vecOrthogonal = [0, 1, 0];
  assert.equal(cosineSimilarity(vec1, vecOrthogonal), 0);

  const vecSimilar = [0.9, 0.1, 0];
  const sim = cosineSimilarity(vec1, vecSimilar);
  assert.ok(sim > 0.95 && sim < 1.0);

  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1, 2], [1]), 0);
});

test('tokenizeThai extracts compound words and terms', () => {
  const tokens = tokenizeThai('การเบิกจ่ายชดเชยค่าบริการฟอกเลือดด้วยเครื่องไตเทียม');
  assert.ok(tokens.length > 0);
  assert.ok(tokens.some((t) => t.includes('ฟอก') || t.includes('ไต') || t.includes('เบิก')));
});

test('fetchOllamaEmbeddings uses the batch embedding model endpoint', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/embed');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const embeddings = await fetchOllamaEmbeddings(
      ['ฟอกไต', 'ปิดสิทธิ'],
      'bge-m3',
      `http://127.0.0.1:${address.port}`,
    );
    assert.deepEqual(embeddings, [[1, 0], [0, 1]]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('fetchOllamaEmbeddings rejects inconsistent vector dimensions', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ embeddings: [[1, 0], [0, 1, 2]] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const embeddings = await fetchOllamaEmbeddings(
      ['a', 'b'],
      'bge-m3',
      `http://127.0.0.1:${address.port}`,
    );
    assert.equal(embeddings, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
