console.log('[Presence] Admin Plugin Index Loading...');
import PresenceAvatars from './components/PresenceAvatars';

export default {
    register(app: any) {
        // Register the plugin
    },

    bootstrap(app: any) {
        // Inject the PresenceAvatars component into the Content Manager Edit View
        /*
                app.getPlugin('content-manager').injectComponent('editView', 'informations', {
                    name: 'presence-avatars-info',
                    Component: PresenceAvatars,
                });
        */

        app.getPlugin('content-manager').injectComponent('editView', 'right-links', {
            name: 'presence-avatars-right',
            Component: PresenceAvatars,
        });
    },
};
