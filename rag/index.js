const fs = require('fs');
const path = require('path');
const faiss = require('faiss-node');

const dimensions = 96;
const guidelinePath = path.join(__dirname, 'guidelines.json');
const guidelines = JSON.parse(fs.readFileSync(guidelinePath, 'utf8'));
const vectors = guidelines.map(item => embed(`${item.title} ${item.section} ${item.text}`));
const index = new faiss.IndexFlatIP(dimensions);
for (const vector of vectors) {
  index.add(vector);
}

function retrieveGuidelines({ query, type, topK = 3 }) {
  const vector = embed(query || '');
  const searchSize = Math.min(guidelines.length, Math.max(topK * 3, topK));
  const result = index.search(vector, searchSize);
  const matches = [];
  for (let i = 0; i < result.labels.length; i += 1) {
    const label = result.labels[i];
    if (label < 0) {
      continue;
    }
    const item = guidelines[label];
    if (type && item.type !== type) {
      continue;
    }
    matches.push({
      id: item.id,
      type: item.type,
      title: item.title,
      source: item.source,
      section: item.section,
      text: item.text,
      score: Number(result.distances[i].toFixed(4))
    });
    if (matches.length >= topK) {
      break;
    }
  }
  return matches;
}

function getRagStatus() {
  return {
    backend: 'faiss-node',
    index: 'IndexFlatIP',
    dimensions,
    documentCount: guidelines.length,
    source: 'rag/guidelines.json'
  };
}

function embed(text) {
  const vector = Array(dimensions).fill(0);
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const token of tokens) {
    const indexA = hashToken(token) % dimensions;
    const indexB = hashToken([...token].reverse().join('')) % dimensions;
    vector[indexA] += 1;
    vector[indexB] += 0.5;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / magnitude);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

module.exports = {
  getRagStatus,
  retrieveGuidelines
};
