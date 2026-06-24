/*
 * Embeddable Markdown editor — an Obsidian Live Preview editor mounted inside a
 * plugin view (used here for the week-notes sidebar so notes format as you type).
 *
 * Adapted from the community "EmbeddableMarkdownEditor" snippet, originally written
 * by mgmeyers for the Obsidian Kanban plugin and packaged by Fevol:
 *   https://github.com/mgmeyers/obsidian-kanban  (src/components/Editor/MarkdownEditor.tsx)
 *   https://fevol.github.io/obsidian-notes/notes/snippets/embeddable-markdown-renderer/
 * Both that code and this plugin are GPL-3.0-only, so the licences are compatible.
 *
 * Changes from the original:
 *   - vendored a minimal `around()` monkey-patch helper (no monkey-around dependency)
 *   - replaced obsidian-typings types with local minimal shims (no obsidian-typings dependency)
 *   - wrapped prototype resolution so any failure returns null and the caller falls back
 *   - trimmed to the change / blur / lifecycle hooks this plugin needs
 *
 * This reaches into Obsidian's internal editor API (not part of the public plugin
 * API), so it can need maintenance across Obsidian updates. createEmbeddableEditor()
 * never throws — it returns null on failure and the sidebar uses a plain textarea.
 */

import { App, Scope, TFile } from "obsidian";
import { EditorView, type ViewUpdate } from "@codemirror/view";

type Constructor<T> = new (...args: unknown[]) => T;
type AnyFn = (...args: unknown[]) => unknown;

/** Minimal stand-in for monkey-around's `around`: patch methods, return an uninstaller. */
function around(obj: Record<string, unknown>, factories: Record<string, (next: AnyFn) => AnyFn>): () => void {
  const removers = Object.keys(factories).map((key) => {
    const original = obj[key] as AnyFn;
    const wrapped = factories[key](original);
    obj[key] = wrapped;
    return () => { if (obj[key] === wrapped) obj[key] = original; };
  });
  return () => removers.forEach((r) => r());
}

/** The slice of Obsidian's internal markdown editor this plugin relies on. */
interface ScrollableMarkdownEditor {
  app: App;
  editorEl: HTMLElement;
  editor: { cm: EditorView };
  owner: { editMode: unknown; editor: unknown };
  activeCM: EditorView;
  containerEl: HTMLElement;
  _loaded: boolean;
  set(value: string): void;
  register(uninstall: () => void): void;
  unload(): void;
  destroy(): void;
  onUpdate(update: ViewUpdate, changed: boolean): void;
}

interface WidgetEditorView {
  editable: boolean;
  editMode?: unknown;
  showEditor(): void;
  unload(): void;
}

interface EmbedRegistryApp {
  embedRegistry: {
    embedByExtension: {
      md: (ctx: { app: App; containerEl: HTMLElement }, file: TFile | null, subpath: string) => WidgetEditorView;
    };
  };
}

interface WorkspaceActiveEditor { activeEditor: unknown; }

export interface EmbeddableEditorOptions {
  value?: string;
  cls?: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
}

export interface EmbeddableEditorHandle {
  readonly value: string;
  setValue(v: string): void;
  focus(): void;
  /** Wrap the current selection (or drop the caret between the markers if empty). */
  wrapSelection(before: string, after: string): void;
  /** Map each selected line through `fn` (used for heading / list prefixes). */
  transformSelectedLines(fn: (line: string, index: number) => string): void;
  destroy(): void;
}

/** Resolve Obsidian's internal markdown-editor constructor by instantiating a throwaway embed. */
function resolveEditorPrototype(app: App): Constructor<ScrollableMarkdownEditor> {
  const reg = app as unknown as EmbedRegistryApp;
  const widget = reg.embedRegistry.embedByExtension.md(
    { app, containerEl: document.createElement("div") },
    null,
    "",
  );
  widget.editable = true;
  widget.showEditor();
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(widget.editMode as object));
  widget.unload();
  return proto.constructor as Constructor<ScrollableMarkdownEditor>;
}

let cachedCtor: Constructor<EmbeddableEditorHandle> | null = null;
let resolveFailed = false;

function buildClass(Base: Constructor<ScrollableMarkdownEditor>): Constructor<EmbeddableEditorHandle> {
  class EmbeddableMarkdownEditor extends Base implements EmbeddableEditorHandle {
    opts: EmbeddableEditorOptions = {};
    scope: Scope;

    constructor(...args: unknown[]) {
      const [app, container, options] = args as [App, HTMLElement, EmbeddableEditorOptions];
      // The internal editor expects a MarkdownView-like owner; mock the scroll/mode hooks.
      super(app, container, { app, onMarkdownScroll: () => {}, getMode: () => "source" });
      this.opts = options;
      this.scope = new Scope(this.app.scope);

      // Mock the MarkdownView wiring so editor commands work while this editor is focused.
      this.owner.editMode = this;
      this.owner.editor = this.editor;
      this.set(options.value ?? "");
      if (options.cls) this.editorEl.classList.add(options.cls);

      // Stop the workspace stealing focus away from us while we're being edited.
      this.register(around(this.app.workspace as unknown as Record<string, unknown>, {
        setActiveLeaf: (next: AnyFn) => (...a: unknown[]) => {
          if (!this.activeCM.hasFocus) next.apply(this.app.workspace, a);
        },
      }));

      const dom = this.editor.cm.contentDOM;
      dom.addEventListener("focusin", () => {
        this.app.keymap.pushScope(this.scope);
        (this.app.workspace as unknown as WorkspaceActiveEditor).activeEditor = this.owner;
      });
      dom.addEventListener("blur", () => {
        this.app.keymap.popScope(this.scope);
        if (this._loaded) this.opts.onBlur?.(this.value);
      });
    }

    get value(): string { return this.editor.cm.state.doc.toString(); }
    setValue(v: string): void { this.set(v); }
    focus(): void { this.editor.cm.focus(); }

    wrapSelection(before: string, after: string): void {
      const cm = this.editor.cm;
      const sel = cm.state.selection.main;
      const text = cm.state.sliceDoc(sel.from, sel.to);
      const insert = before + text + after;
      const caret = text ? sel.from + insert.length : sel.from + before.length;
      cm.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: caret } });
      cm.focus();
    }

    transformSelectedLines(fn: (line: string, index: number) => string): void {
      const cm = this.editor.cm;
      const sel = cm.state.selection.main;
      const doc = cm.state.doc;
      const fromLine = doc.lineAt(sel.from);
      const toLine = doc.lineAt(sel.to);
      const block = doc.sliceString(fromLine.from, toLine.to);
      const out = block.split("\n").map(fn).join("\n");
      cm.dispatch({ changes: { from: fromLine.from, to: toLine.to, insert: out } });
      cm.focus();
    }

    onUpdate(update: ViewUpdate, changed: boolean): void {
      super.onUpdate(update, changed);
      if (changed) this.opts.onChange?.(this.value);
    }

    destroy(): void {
      if (this._loaded) this.unload();
      this.app.keymap.popScope(this.scope);
      (this.app.workspace as unknown as WorkspaceActiveEditor).activeEditor = null;
      this.containerEl.empty();
      super.destroy();
    }

    onunload(): void { this.destroy(); }
  }
  return EmbeddableMarkdownEditor as unknown as Constructor<EmbeddableEditorHandle>;
}

/**
 * Create a live Markdown editor inside `container`. Returns null (never throws) if
 * Obsidian's internal editor API can't be resolved, so callers can fall back to a
 * plain textarea. The resolved constructor is cached after the first success.
 */
export function createEmbeddableEditor(
  app: App,
  container: HTMLElement,
  options: EmbeddableEditorOptions,
): EmbeddableEditorHandle | null {
  if (resolveFailed) return null;
  try {
    if (!cachedCtor) cachedCtor = buildClass(resolveEditorPrototype(app));
    return new cachedCtor(app, container, options);
  } catch (e) {
    resolveFailed = true;
    console.error("Teacher Planner: live week-note editor unavailable; using the plain editor.", e);
    return null;
  }
}
