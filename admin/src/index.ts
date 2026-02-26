import PresenceAvatars from './components/PresenceAvatars';
import PublishHistoryButton from './components/PublishHistoryButton';
import { pluginPermissions } from './permissions';

const ActionHistoryPage = async () => {
  const component = await import(
    /* webpackChunkName: "presence-action-history" */ './pages/ActionHistoryPage'
  );
  return component;
};

export default {
  register(app: any) {
    app.createSettingSection(
      { id: 'presence', intlLabel: { id: 'presence.settings.section', defaultMessage: 'Presence' } },
      [
        {
          intlLabel: { id: 'presence.settings.action-history', defaultMessage: 'Action History' },
          id: 'action-history',
          to: 'action-history',
          Component: ActionHistoryPage,
          permissions: pluginPermissions.accessActionHistory,
        },
      ]
    );
  },

  bootstrap(app: any) {
    app.getPlugin('content-manager').injectComponent('editView', 'right-links', {
      name: 'presence-avatars-right',
      Component: PresenceAvatars,
    });

    const { addDocumentAction } = app.getPlugin('content-manager').apis;
    addDocumentAction((actions: any[]) => {
      if (!actions.some((a: any) => a?.id === 'publish-history-action')) {
        const firstDeleteIndex = actions.findIndex((a: any) =>
          a?.type === 'delete' || (a?.name && String(a.name).includes('Delete'))
        );
        if (firstDeleteIndex !== -1) {
          actions.splice(firstDeleteIndex, 0, PublishHistoryButton);
        } else {
          actions.push(PublishHistoryButton);
        }
      }
      return actions;
    });
  },
};
