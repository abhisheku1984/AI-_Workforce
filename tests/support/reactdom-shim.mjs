import { createRequire } from 'node:module';
const require = createRequire('/home/user/AI-_Workforce/package.json');
const client = require('react-dom/client');
const dom = require('react-dom');
export const createRoot = client.createRoot;
export const hydrateRoot = client.hydrateRoot;
export const createPortal = dom.createPortal;
export const flushSync = dom.flushSync;
export default { ...client, ...dom };
