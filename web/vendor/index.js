/**
 * The UI library: Preact with hooks, and htm for writing markup as tagged
 * templates -- JSX-like components with no build step. Vendored so the
 * app runs with no internet access. Versions: preact 10.29.8, htm 3.1.1.
 */
import { h, render, Fragment, createContext, createRef, cloneElement, toChildArray } from './preact.module.js';
import htm from './htm.module.js';

export { h, render, Fragment, createContext, createRef, cloneElement, toChildArray };
export * from './hooks.module.js';
export const html = htm.bind(h);
