'use strict';

function mergeResourcesIntoState(state, resources) {
  if (!Array.isArray(resources) || resources.length === 0) return state;
  const nextState = JSON.parse(JSON.stringify(state && typeof state === 'object' ? state : {}));
  const projectResources = Array.isArray(nextState.projectResources) ? nextState.projectResources : [];
  const resourceMap = new Map(projectResources.map(resource => [
    `${String(resource && resource.kind || '')}:${String(resource && resource.id || '')}`,
    resource
  ]));
  const creationAssetKeys = {
    worldbuilding: 'worldbuilding',
    'world-rule': 'worldRules',
    culture: 'cultures',
    'history-event': 'history',
    'power-system': 'powerSystems',
    item: 'items',
    ability: 'abilities',
    term: 'terms',
    material: 'materials',
    highlight: 'highlights',
    'writing-task': 'writingTasks',
    issue: 'issues'
  };
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id}`;
    if (resource.status === 'deleted') {
      resourceMap.delete(key);
      if (resource.kind === 'character' && nextState.knowledge && nextState.knowledge.entities) {
        delete nextState.knowledge.entities[resource.id];
      } else if (resource.kind === 'relation' && nextState.knowledge && Array.isArray(nextState.knowledge.edges)) {
        nextState.knowledge.edges = nextState.knowledge.edges.filter(item => !item || item.id !== resource.id);
      } else if (resource.kind === 'foreshadow' && Array.isArray(nextState.foreshadows)) {
        nextState.foreshadows = nextState.foreshadows.filter(item => !item || item.id !== resource.id);
      } else if (resource.kind === 'timeline' && Array.isArray(nextState.timeline)) {
        nextState.timeline = nextState.timeline.filter(item => !item || item.id !== resource.id);
      } else if (creationAssetKeys[resource.kind] && nextState.creationAssets) {
        const assetKey = creationAssetKeys[resource.kind];
        if (Array.isArray(nextState.creationAssets[assetKey])) {
          nextState.creationAssets[assetKey] = nextState.creationAssets[assetKey].filter(item => !item || item.id !== resource.id);
        }
      }
      continue;
    }
    resourceMap.set(key, resource);
    if (resource.kind === 'character') {
      nextState.knowledge = nextState.knowledge && typeof nextState.knowledge === 'object' ? nextState.knowledge : {};
      nextState.knowledge.entities = nextState.knowledge.entities && !Array.isArray(nextState.knowledge.entities)
        ? nextState.knowledge.entities
        : {};
      nextState.knowledge.entities[resource.id] = {
        ...(nextState.knowledge.entities[resource.id] || {}),
        ...resource.payload,
        id: resource.id
      };
    } else if (resource.kind === 'relation') {
      nextState.knowledge = nextState.knowledge && typeof nextState.knowledge === 'object' ? nextState.knowledge : {};
      nextState.knowledge.edges = Array.isArray(nextState.knowledge.edges) ? nextState.knowledge.edges : [];
      const edgeIndex = nextState.knowledge.edges.findIndex(item => item && item.id === resource.id);
      const edge = { ...(edgeIndex < 0 ? {} : nextState.knowledge.edges[edgeIndex]), ...resource.payload, id: resource.id };
      if (edgeIndex < 0) nextState.knowledge.edges.push(edge);
      else nextState.knowledge.edges[edgeIndex] = edge;
    } else if (resource.kind === 'foreshadow') {
      nextState.foreshadows = Array.isArray(nextState.foreshadows) ? nextState.foreshadows : [];
      const foreshadowIndex = nextState.foreshadows.findIndex(item => item && item.id === resource.id);
      const foreshadow = { ...(foreshadowIndex < 0 ? {} : nextState.foreshadows[foreshadowIndex]), ...resource.payload, id: resource.id };
      if (foreshadowIndex < 0) nextState.foreshadows.push(foreshadow);
      else nextState.foreshadows[foreshadowIndex] = foreshadow;
    } else if (resource.kind === 'timeline') {
      nextState.timeline = Array.isArray(nextState.timeline) ? nextState.timeline : [];
      const timelineIndex = nextState.timeline.findIndex(item => item && item.id === resource.id);
      const timelineItem = { ...(timelineIndex < 0 ? {} : nextState.timeline[timelineIndex]), ...resource.payload, id: resource.id };
      if (timelineIndex < 0) nextState.timeline.push(timelineItem);
      else nextState.timeline[timelineIndex] = timelineItem;
    } else if (creationAssetKeys[resource.kind]) {
      nextState.creationAssets = nextState.creationAssets && typeof nextState.creationAssets === 'object'
        ? nextState.creationAssets
        : {};
      const assetKey = creationAssetKeys[resource.kind];
      nextState.creationAssets[assetKey] = Array.isArray(nextState.creationAssets[assetKey])
        ? nextState.creationAssets[assetKey]
        : [];
      const assetIndex = nextState.creationAssets[assetKey].findIndex(item => item && item.id === resource.id);
      const asset = { ...(assetIndex < 0 ? {} : nextState.creationAssets[assetKey][assetIndex]), ...resource.payload, id: resource.id };
      if (assetIndex < 0) nextState.creationAssets[assetKey].push(asset);
      else nextState.creationAssets[assetKey][assetIndex] = asset;
    }
  }
  nextState.projectResources = Array.from(resourceMap.values());
  return nextState;
}

module.exports = { mergeResourcesIntoState };
