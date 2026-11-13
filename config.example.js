module.exports = {
  port: 3000,
  host: '0.0.0.0',
  baseUrl: 'https://docs.example.com',
  siteName: 'OnyxDocs',
  welcomeTitle: 'Welcome to OnyxDocs',
  welcomeDescription: 'Documentation, guides, and answers for our community.',
  mainSiteUrl: 'https://solaristechsvcs.com',
  discordUrl: '',
  discord: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    // Must exactly match a redirect registered in the Discord Developer Portal.
    redirectUri: 'https://docs.example.com/auth/discord/callback'
  },
  sessionSecret: 'REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
  // Set true behind your trusted Cloudflare Tunnel/reverse proxy only.
  trustProxy: true,
  secureCookies: true,
  // Generate a separate random value. Required to create the first owner.
  setupKey: 'REPLACE_WITH_A_SEPARATE_RANDOM_SETUP_KEY',
  updater: {
    enabled: true,
    repository: 'https://github.com/solaristechsvcs/onyxdocs.git',
    branch: 'main',
    intervalSeconds: 300,
    startupTimeoutSeconds: 60
  },
  mysql: { host: '127.0.0.1', port: 3306, user: 'onyxdocs', password: '', database: 'onyxdocs', connectionLimit: 10 }
};
