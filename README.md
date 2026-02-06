# Strapi 5 Real-Time Presence Plugin

A premium real-time presence plugin for Strapi 5 that allows content creators to see who else is currently viewing or editing the same entry in the Content Manager.

## Features

- **Real-Time Tracking**: Instant updates when users join or leave a content entry.
- **Premium UI**: Modern glassmorphism design that integrates seamlessly with Strapi 5's admin panel.
- **Unique User Identity**:
  - Automatically identifies users via Strapi 5's cookie-based authentication.
  - Generates unique initials and persistent colors for each user.
  - Interactive tooltips showing full usernames.
- **Deduplication**: Handles multiple open tabs from the same user by showing only one avatar.
- **Optimized Performance**: Uses Socket.io for low-latency communication with fallback support.

## Technical Details

- **Frontend**: React-based component injected into the `right-links` zone of the Content Manager.
- **Backend**: Socket.io server integrated into the Strapi lifecycle.
- **Authentication**: Compatible with Strapi 5's new security model (JWT stored in cookies).

## Installation & Setup

1.  **Build the Plugin**:
    ```bash
    cd src/plugins/presence
    npm install
    npm run build
    ```

2.  **Enable the Plugin**: Ensure the plugin is enabled in your `config/plugins.ts`:
    ```typescript
    export default ({ env }) => ({
      presence: {
        enabled: true,
        resolve: './src/plugins/presence'
      },
    });
    ```

3.  **Rebuild Strapi Admin**:
    ```bash
    npm run build
    npm run dev # or npm run staging
    ```

## Development

The main presence component is located at `admin/src/components/PresenceAvatars.tsx`. It uses standard HTML/CSS for styling to ensure maximum stability and zero conflicts with fluctuating `@strapi/design-system` versions.

## License

MIT
