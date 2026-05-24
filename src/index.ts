import { Hono } from 'hono';

// Vercel's Hono auto-detection expects a recognized entry file that imports `hono`.
void Hono;

export { app as default } from './runtime.js';
