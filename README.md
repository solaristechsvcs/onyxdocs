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
7. Set startup to `npm install --omit=dev && node src/server.js` in Wisp. Tables initialize automatically. The manual migration command is `npm run migrate`.
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

Images use external URLs in Markdown. This version does not include uploads, public accounts, email delivery, SSO, or an automatic updater. Update application files from GitHub using your normal Wisp deployment process, preserve `config.js`, and restart.

Set `welcomeTitle`, `welcomeDescription`, `mainSiteUrl`, and `discordUrl` in `config.js` to customize the welcome area and navigation. Category image URLs are editable in the staff category screen. No content or artwork is copied from the reference site.

The initial development environment could not reach the npm registry or MySQL. A dependency lockfile has therefore not been generated; installation uses `npm install`. Generate and commit a lockfile after the first verified installation if you need reproducible dependency versions. GitHub Actions installs dependencies and runs the available checks on every push.

## Development and validation

```sh
npm install
npm test
npm run check
```

The helper tests cover HTML escaping, safe slugs, nesting, and circular category rejection. Full runtime testing requires a MySQL database. Verify setup, login, category nesting, draft visibility, publishing, search, revision restore, role permissions and mobile pages against a disposable database before production use.
