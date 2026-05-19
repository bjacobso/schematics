import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { autocompletion, closeBrackets, type CompletionContext } from "@codemirror/autocomplete";
import type { Completion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  getSchemaIdeCompletions,
  getSchemaIdeHover,
  getSchemaIdeQuickFixes,
  type SchemaIdeDocumentFormat,
  type SchemaIdeReflection,
} from "@schema-ide/core";
import { diagnosticsForSchemaIdeFile } from "./diagnostics";

export interface SchemaCodeMirrorEditorProps {
  readonly value: string;
  readonly path: string | null;
  readonly format: SchemaIdeDocumentFormat;
  readonly reflection: SchemaIdeReflection;
  readonly readOnly?: boolean | undefined;
  readonly onChange: (value: string) => void;
  readonly onSave?: (() => void) | undefined;
  readonly onDefinitionRequest?: ((path: string, line: number, column: number) => void) | undefined;
}

export interface SchemaCodeMirrorEditorRef {
  readonly getEditor: () => EditorView | null;
  readonly revealLine: (line: number) => void;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    overflow: "auto",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--primary)",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--primary)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklab, var(--primary) 24%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--muted) 45%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "color-mix(in oklab, var(--muted) 35%, transparent)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--muted) 65%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  ".cm-diagnostic": {
    borderLeftColor: "var(--destructive)",
  },
  ".cm-lintRange-error": {
    backgroundImage:
      "linear-gradient(45deg, transparent 65%, var(--destructive) 80%, transparent 90%)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
});

const syntaxTheme = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--primary)" },
  { tag: [tags.atom, tags.bool, tags.null], color: "var(--primary)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--chart-2)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--chart-4)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--chart-3)" },
  { tag: [tags.definition(tags.propertyName), tags.labelName], color: "var(--chart-3)" },
  { tag: tags.variableName, color: "var(--foreground)" },
  {
    tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket],
    color: "var(--muted-foreground)",
  },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--destructive)" },
]);

export const SchemaCodeMirrorEditor = forwardRef<
  SchemaCodeMirrorEditorRef,
  SchemaCodeMirrorEditorProps
>(function SchemaCodeMirrorEditor(
  { value, path, format, reflection, readOnly = false, onChange, onSave },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef({ value, path, format, reflection, onChange, onSave });
  propsRef.current = { value, path, format, reflection, onChange, onSave };

  useImperativeHandle(ref, () => ({
    getEditor: () => viewRef.current,
    revealLine: (line: number) => {
      const view = viewRef.current;
      if (!view) return;
      const targetLine = Math.max(1, Math.min(line, view.state.doc.lines));
      const lineInfo = view.state.doc.line(targetLine);
      view.dispatch({
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
        selection: { anchor: lineInfo.from },
      });
      view.focus();
    },
  }));

  const createEditor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    viewRef.current?.destroy();
    viewRef.current = null;

    const completion = autocompletion({
      activateOnTyping: true,
      override: [
        (context: CompletionContext) => {
          const props = propsRef.current;
          const result = getSchemaIdeCompletions({
            reflection: props.reflection,
            path: props.path,
            content: context.state.doc.toString(),
            offset: context.pos,
            format: props.format,
          });
          if (!result && !context.explicit) return null;
          if (!result) return { from: context.pos, options: [] };
          return {
            from: result.from,
            to: result.to,
            options: result.options.map(
              (option): Completion => ({
                label: option.label,
                type: option.type === "property" ? "property" : "constant",
                apply: option.apply,
                ...(option.detail !== undefined ? { detail: option.detail } : {}),
                ...(option.info !== undefined ? { info: option.info } : {}),
              }),
            ),
          };
        },
      ],
    });

    const hover = hoverTooltip((view, offset) => {
      const props = propsRef.current;
      const result = getSchemaIdeHover({
        reflection: props.reflection,
        path: props.path,
        content: view.state.doc.toString(),
        offset,
        format: props.format,
      });
      if (!result) return null;
      return {
        pos: result.from,
        end: result.to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.style.cssText = "max-width: 420px; padding: 8px 10px; white-space: pre-wrap;";
          dom.textContent = result.content;
          return { dom };
        },
      };
    });

    const schemaLinter = linter((view) => {
      const props = propsRef.current;
      const quickFixes = getSchemaIdeQuickFixes({
        reflection: props.reflection,
        path: props.path,
        content: view.state.doc.toString(),
        format: props.format,
      });
      return diagnosticsForSchemaIdeFile(props.reflection.diagnostics, props.path).map(
        (diagnostic): Diagnostic => {
          const line = view.state.doc.line(Math.max(1, diagnostic.line ?? 1));
          const from = Math.min(line.to, line.from + Math.max(0, (diagnostic.column ?? 1) - 1));
          return {
            from,
            to: Math.max(from + 1, Math.min(line.to, from + 1)),
            severity: diagnostic.severity,
            message: diagnostic.message,
            actions: quickFixes.map((fix) => ({
              name: fix.title,
              apply: (targetView) => {
                for (const edit of fix.edits.filter((candidate) => candidate.path === props.path)) {
                  targetView.dispatch({
                    changes: { from: edit.from, to: edit.to, insert: edit.insert },
                  });
                }
              },
            })),
          };
        },
      );
    });

    const extensions = [
      format === "yaml" ? yaml() : json(),
      editorTheme,
      syntaxHighlighting(syntaxTheme, { fallback: true }),
      history(),
      bracketMatching(),
      closeBrackets(),
      lineNumbers(),
      lintGutter(),
      completion,
      hover,
      schemaLinter,
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            propsRef.current.onSave?.();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": "Schema source editor" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) propsRef.current.onChange(update.state.doc.toString());
      }),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ];

    viewRef.current = new EditorView({
      parent: container,
      state: EditorState.create({ doc: propsRef.current.value, extensions }),
    });
  }, [format, readOnly]);

  useEffect(() => {
    createEditor();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [createEditor]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={containerRef} className="min-h-0 flex-1" />;
});
