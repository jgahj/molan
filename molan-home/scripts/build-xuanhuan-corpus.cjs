'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCorpus, corpusSummary } = require('../lib/xuanhuan-quality');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(root, '..', '资源库', '小说原本', '玄幻');
const output = path.join(root, 'data', 'xuanhuan-lab', 'corpus.json');
const corpus = buildCorpus(source);
if (!corpus.scenes.some(scene => scene.split === 'reference') || !corpus.scenes.some(scene => scene.split === 'holdout')) throw new Error('参考集与留出集均须有可用场景');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output + '.tmp', JSON.stringify(corpus));
fs.renameSync(output + '.tmp', output);
console.log(JSON.stringify(corpusSummary(corpus), null, 2));
