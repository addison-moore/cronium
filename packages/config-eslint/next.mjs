import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const config = require('./next.js');
export default config;