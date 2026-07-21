// PM2 — KayrosLab API. Meme convention que le backend openDPE sur ce VPS.
module.exports = {
  apps: [{
    name: 'kayros-api',
    script: 'index.mjs',
    cwd: '/opt/kayroslab/backend/fastify',
    node_args: '--env-file=.env',
    instances: 1,
    exec_mode: 'fork',            // etat en memoire (gates, denylist) : pas de cluster
    autorestart: true,
    max_memory_restart: '400M',
    out_file: '/var/log/pm2/kayros-api.out.log',
    error_file: '/var/log/pm2/kayros-api.err.log',
    merge_logs: true,
    time: true,
    env_production: { NODE_ENV: 'production' },
  }],
};
