/**
 * Type shim for Svelte 4 component imports. esbuild-svelte compiles these at
 * build time; this declaration gives tsc a concrete type so component
 * construction, $set and $destroy are fully typed. Component-specific
 * exported functions are typed at the call site (see WeekView.ts).
 */
declare module "*.svelte" {
  import { SvelteComponent } from "svelte";
  export default class Component extends SvelteComponent {}
}
