import { createApp } from './app.factory.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

const app = await createApp();
const env = app.get<Env>(ENV);
await app.listen(env.PORT);
console.log(`ZatGo AI Marketing API listening on ${env.API_URL} (docs: ${env.API_URL}/api/docs)`);
