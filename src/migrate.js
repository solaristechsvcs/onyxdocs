const {pool, migrate} = require('./db');
migrate().then(() => console.log('OnyxDocs MySQL tables ready.')).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
