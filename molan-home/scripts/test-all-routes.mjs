import { NARRATIVE_ROUTES, prepareGenreSceneContext } from '../lib/genre-engine.js';
import reviewedAssets from '../lib/reviewed-route-assets.js';
const { loadReviewedRouteAssets } = reviewedAssets;

console.log('=== 验证 19 条名家叙事路线资产装配与语料检索 ===\n');

const routeIds = Object.keys(NARRATIVE_ROUTES);
let allPassed = true;

for (const rid of routeIds) {
  const meta = NARRATIVE_ROUTES[rid];
  const lesson = loadReviewedRouteAssets({ routeId: rid });
  const context = prepareGenreSceneContext({
    genre: meta.familyId,
    query: '危机逼近，暗中博弈，利益试探',
    routeId: rid
  });

  const ok = context.ok === true;
  const sysLen = context.writingSystem ? context.writingSystem.length : 0;
  const samples = context.scenePlan?.sampleScenes?.length || 0;
  const lessonReady = lesson && lesson.status === 'ready';

  const status = (ok && sysLen > 500 && lessonReady) ? '✔ PASS' : '❌ FAIL';
  if (status.includes('FAIL')) allPassed = false;

  console.log(`[${status}] ${rid.padEnd(24)} | family: ${meta.familyId.padEnd(16)} | sysChars: ${String(sysLen).padStart(5)} | samples: ${samples} | lesson: ${lesson?.status} | ${meta.title}`);
}

console.log('\n----------------------------------------');
console.log(`全部路线验证结果: ${allPassed ? '全部通过 (19/19)' : '存在失败项'}`);
if (!allPassed) process.exit(1);
