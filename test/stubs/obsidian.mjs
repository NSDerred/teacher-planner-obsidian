/**
 * Stub for the `obsidian` module. The pure logic under test never touches the
 * Obsidian API, but some modules import it at the top level (planTemplates,
 * for its vault-writing helpers), so the bundler needs something to resolve to.
 * Anything here that a test actually calls should be given a real fake instead.
 */
export class App {}
export class Modal {}
export class Notice {}
export class TFile {}
export class Menu {}
export function setIcon() {}
export function normalizePath(p) { return p; }
export const Platform = { isMobile: false };
