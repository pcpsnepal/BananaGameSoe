import { build } from './app.js';
build({ dataFile: new URL('./data.json', import.meta.url).pathname }).listen({ port: 3001 }, () => console.log('API on :3001'));
