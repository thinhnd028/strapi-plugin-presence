import version from './version/schema.json';
import actionHistory from './action-history/schema.json';

export default {
  version: { schema: version },
  'action-history': { schema: actionHistory },
};
