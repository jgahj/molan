BEGIN;

ALTER TABLE luna.project_resources
  DROP CONSTRAINT IF EXISTS project_resources_kind_check;

ALTER TABLE luna.project_resources
  ADD CONSTRAINT project_resources_kind_check CHECK (kind IN (
    'profile', 'worldbuilding', 'world-rule', 'culture', 'history-event', 'power-system',
    'character', 'relation', 'item', 'ability', 'term', 'outline', 'storyline',
    'plot-node', 'scene', 'event', 'place', 'faction', 'calendar', 'foreshadow',
    'timeline', 'material', 'highlight', 'writing-task', 'issue', 'manuscript', 'publication'
  ));

COMMIT;
