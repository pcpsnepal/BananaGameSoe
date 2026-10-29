import { build } from './app.js';
build().listen({ port: 3001 }, () => console.log('API on :3001'));
