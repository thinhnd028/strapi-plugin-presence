export default [
  {
    method: 'GET',
    path: '/action-history',
    handler: 'action-history-controller.find',
    config: { policies: [], auth: false },
  },
  {
    method: 'GET',
    path: '/action-history/:id',
    handler: 'action-history-controller.findOne',
    config: { policies: [], auth: false },
  },
  {
    method: 'GET',
    path: '/list',
    handler: 'history-controller.find',
    config: { policies: [], auth: false },
  },
  {
    method: 'POST',
    path: '/restore',
    handler: 'history-controller.restore',
    config: {
      policies: ['admin::isAuthenticatedAdmin', 'plugin::presence.has-restore-permission'],
    },
  },
  {
    method: 'GET',
    path: '/version/:documentId',
    handler: 'history-controller.getVersion',
    config: {
      policies: ['admin::isAuthenticatedAdmin', 'plugin::presence.has-restore-permission'],
    },
  },
  {
    method: 'GET',
    path: '/assess/:versionId',
    handler: 'history-controller.assess',
    config: {
      policies: ['admin::isAuthenticatedAdmin', 'plugin::presence.has-restore-permission'],
    },
  },
  {
    method: 'GET',
    path: '/restore-stream/:versionId',
    handler: 'history-controller.restoreStream',
    config: {
      policies: ['admin::isAuthenticatedAdmin', 'plugin::presence.has-restore-permission'],
    },
  },
  {
    method: 'POST',
    path: '/cancel-restore',
    handler: 'history-controller.cancelRestore',
    config: {
      policies: ['admin::isAuthenticatedAdmin', 'plugin::presence.has-restore-permission'],
    },
  },
  {
    method: 'POST',
    path: '/snapshot-now',
    handler: 'history-controller.snapshotNow',
    config: { policies: [], auth: false },
  },
  {
    method: 'GET',
    path: '/snapshot-now',
    handler: 'history-controller.snapshotNow',
    config: { policies: [], auth: false },
  },
  {
    method: 'GET',
    path: '/checkpoint/:token',
    handler: 'history-controller.getCheckpoint',
    config: { policies: [], auth: false },
  },
];
