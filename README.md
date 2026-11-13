# OnyxDocs

A self-hosted documentation platform for Node.js, MySQL, Wisp, and Docker. Uses `config.js`; no `.env` required.

## Included

- Public documentation home, category pages, nested category sidebar, keyword search, mobile layout.
- Reference-inspired centered welcome/search, category image URLs, Main Site/Discord links, and a saved light/dark theme preference.
- Markdown articles with tables, images, code blocks, copy buttons, and an automatic heading table of contents.
- Staff dashboard, draft/publish controls, editable slugs, article ordering, summaries, revision restore, and deletion.
- Owner, admin, and editor roles; staff account creation, password resets, and owner role management.
- Site branding settings, social link description metadata, MySQL sessions, CSRF protection, login throttling, sanitized Markdown, and password hashing.
- Automatic table creation at startup and an explicit `npm run migrate` command.

## Wisp installation

1. Use a Node.js 24 egg/image. Install this repository into `/home/container`.
2. Copy `config.example.js` to `config.js` using Wisp's file manager.
3. Set the external MySQL connection. The database must exist and the account must be allowed to create tables.
4. Set `port` to the Wisp allocation and leave `host` as `0.0.0.0`. Do not bind the public server IP inside the container.
5. Set `baseUrl` to your public HTTPS domain. Point Cloudflare Tunnel at the allocation serving this Node process.
6. Generate two independent random values using the command below. Set `sessionSecret` and `setupKey` separately. Keep them private.
7. Use a Node.js image with Git installed (the included Dockerfile provides it). Set startup to `npm install --omit=dev --package-lock=false && node scripts/start.js` in Wisp. Tables initialize automatically. The manual migration command is `npm run migrate`.
8. Visit `/setup`, enter the setup key, and create your first owner account. Setup becomes unavailable after the first account exists. Sign in at `/login`, then open `/admin`.

Generate each secret in a Node console or the Wisp console where commands are supported:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

For HTTPS behind a trusted reverse proxy, keep `trustProxy: true` and `secureCookies: true`. The proxy must forward `X-Forwarded-Proto: https`. Restrict direct access to the origin so clients cannot forge proxy headers. For direct local HTTP testing, set both flags to `false` or the browser will not retain secure login cookies.

`config.js` is ignored by git and excluded from Docker builds. Supply it at runtime. Never commit database passwords or secrets. No public signup is provided; create staff in the dashboard.

## Docker

```sh
docker build -t onyxdocs .
docker run -d --name onyxdocs -p 3000:3000 -v /absolute/path/config.js:/home/container/config.js:ro onyxdocs
```

Use your allocated port on both sides when changing `config.port`. All persistent content and sessions live in MySQL. Back up the database and private configuration before upgrades.

## Roles

| Role | Permissions |
| --- | --- |
| Editor | Create, edit, publish, delete and restore articles; manage categories |
| Admin | Editor permissions, site settings, create/reset editor accounts, reset own password |
| Owner | All permissions; create owners/admins and change other users' roles |

Owners cannot demote themselves, so at least one owner remains. Password changes revoke existing sessions for the affected staff member. Articles are public only when published. Revisions preserve the article text before each edit or restore; slug, category and visibility remain current during restoration.

## Authoring

Create categories first and select a parent for nested sections. Then add an article, choose a unique URL slug, write Markdown, and enable Published when ready. Smaller sort positions appear first; ties sort by title. Search covers published titles, summaries and Markdown content. Article deletion permanently deletes its revisions. Categories with child categories cannot be deleted until those children are moved or removed; articles in a deleted category become uncategorized.

Images use external URLs in Markdown. This version does not include uploads, public accounts, or email delivery.

## Discord login

1. Create or select an application at https://discord.com/developers/applications.
2. In OAuth2, add `https://YOUR-DOCS-DOMAIN/auth/discord/callback` as a redirect. Use the actual domain hosting OnyxDocs, not the reference site unless this application will replace it there.
3. Copy the application's client ID and client secret into the `discord` block in your private root `config.js`:

```js
discord: {
  enabled: true,
  clientId: 'YOUR_DISCORD_APPLICATION_ID',
  clientSecret: 'YOUR_DISCORD_CLIENT_SECRET',
  redirectUri: 'https://YOUR-DOCS-DOMAIN/auth/discord/callback'
},
```

4. Restart Wisp after saving the configuration. Keep the comma between this block and the next configuration entry.
5. Sign in using the owner/staff email and password. Open Dashboard → My account, confirm your staff password, and select Link Discord. Authorize your Discord identity.
6. Future visits can use Sign in with Discord on `/login`.

Only the `identify` scope is requested; a bot token, bot installation, guild access, and email access are not needed. Discord tokens are used briefly for the identity lookup and are not saved. Login never creates a new staff account or assigns a role. Unlinked Discord identities are denied staff access. There is no automatic matching by email. Each Discord identity can link to only one staff account. Link changes and unlinking require the staff password and CSRF protection. Unlinking revokes other sessions for that staff account. Owner setup and staff account creation remain unchanged. If a password is lost, another authorized owner/admin can reset it under Staff accounts according to the existing role restrictions.

The callback URL must match exactly in Discord and `config.js`. Keep `baseUrl` set to the public domain. HTTPS cookies and proxy headers must be configured correctly for the authorization state to survive the redirect. Schema migration adds the unique nullable `users.discord_id` column on startup, including existing installations. The MySQL account needs ALTER privileges for this upgrade.

## Automatic updates

`npm start` (or `node scripts/start.js`) runs a supervisor that starts the site, checks the configured public GitHub repository immediately and every five minutes, stages changed commits with their own dependencies, then restarts the application. It works even if the initial installation was uploaded as files rather than cloned with Git. Git, npm, outbound HTTPS to GitHub/npm, and write access to the application directory are required. An update failure is logged in the Wisp console; download/install failures leave the running site in place.

The optional `updater` block in `config.js` defaults to:

```js
updater: {
  enabled: true,
  repository: 'https://github.com/solaristechsvcs/onyxdocs.git',
  branch: 'main',
  intervalSeconds: 300,
  startupTimeoutSeconds: 60
},
```

Set `enabled: false` to disable checks, then restart Wisp. Configuration changes take effect after a Wisp restart. This updater supports public GitHub repositories; do not put credentials in the repository URL.

Updates are installed under `.onyx-updates/releases/`. The root `config.js` is shared with each release through an absolute configuration path and is never overwritten. The supervisor does not reset or stash local files. Root source edits remain on disk but are not included in downloaded releases: commit intended code changes to GitHub. MySQL remains the content store. A small `active.json` file remembers the selected release across Wisp restarts. Keep this directory on persistent storage if using Docker.

There is brief downtime during the application switch. The new app must complete database initialization and start listening before it is selected. Failed startup restores the previous application; database changes are not reversed. Keep future migrations compatible with the previous version and maintain database backups. Successful releases retain the three most recent staged versions plus the active/previous versions when needed. The root supervisor itself is not replaced during live updates; supervisor changes require updating the root `scripts/` files from GitHub and restarting Wisp.

To bypass the supervisor for troubleshooting, use `npm run start:direct`. To return to the originally installed app, stop Wisp, rename `.onyx-updates/active.json`, and start with updates disabled. Preserve `config.js` and the database.

Set `welcomeTitle`, `welcomeDescription`, `mainSiteUrl`, and `discordUrl` in `config.js` to customize the welcome area and navigation. Category image URLs are editable in the staff category screen. No content or artwork is copied from the reference site.

The initial development environment could not reach the npm registry or MySQL. A dependency lockfile has therefore not been generated; installation uses `npm install`. Generate and commit a lockfile after the first verified installation if you need reproducible dependency versions. GitHub Actions installs dependencies and runs the available checks on every push.

## Development and validation

```sh
npm install
npm test
npm run check
```

Tests cover HTML escaping, safe slugs, nesting, circular category rejection, staged updates, unchanged commits, failed installs, branch changes, state path validation, process readiness, and activation rollback. Network operations in updater unit tests use a simulated command runner. Full runtime testing requires network access and a MySQL database. Verify setup, login, category nesting, draft visibility, publishing, search, revision restore, role permissions and mobile pages against a disposable database before production use.
