// Z.ai Agent v18.2 - PM2 Config (for LOCAL development only)
// The bot runs on GitHub Actions in production
// To run locally: copy .env.example to .env and fill in values
module.exports = {
  apps: [{
    name: 'zai-bot',
    script: './node_modules/.bin/tsx',
    args: 'src/index.ts',
    env: {
      // Load from .env file — DO NOT put secrets here
      NODE_ENV: 'development',
    },
    max_restarts: 5,
    restart_delay: 5000,
  }]
};
