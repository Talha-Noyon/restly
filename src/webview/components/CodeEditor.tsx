import {useEffect, useLayoutEffect, useRef} from 'preact/hooks'
import {Annotation, Compartment, EditorState, type Extension} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import {highlightSelectionMatches, searchKeymap} from '@codemirror/search'
import {json} from '@codemirror/lang-json'
import {xml} from '@codemirror/lang-xml'
import {html} from '@codemirror/lang-html'
import {tags as t} from '@lezer/highlight'

export type Language = 'json' | 'xml' | 'html' | 'text'

const theme = EditorView.theme({
  '&': {
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    fontSize: 'var(--vscode-editor-font-size, 13px)',
    height: '100%'
  },
  '&.cm-focused': {outline: 'none'},
  '.cm-scroller': {fontFamily: 'var(--vscode-editor-font-family, monospace)', lineHeight: '1.5'},
  '.cm-content': {caretColor: 'var(--vscode-editorCursor-foreground)'},
  '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--vscode-editorCursor-foreground)'},
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editorLineNumber-foreground)',
    border: 'none'
  },
  '.cm-activeLine': {backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)'},
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--vscode-editorLineNumber-activeForeground)'
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {backgroundColor: 'var(--vscode-editor-selectionBackground)'},
  '.cm-selectionMatch': {backgroundColor: 'var(--vscode-editor-selectionHighlightBackground)'},
  '.cm-searchMatch': {backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)'},
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--vscode-editor-findMatchBackground)'
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--vscode-editorBracketMatch-background)',
    outline: '1px solid var(--vscode-editorBracketMatch-border)'
  },
  '.cm-panels': {
    backgroundColor: 'var(--vscode-editorWidget-background)',
    color: 'var(--vscode-editorWidget-foreground)'
  },
  '.cm-panels input, .cm-panels button': {fontFamily: 'inherit', fontSize: 'inherit'},
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--vscode-editor-foldBackground, transparent)',
    border: 'none',
    color: 'var(--vscode-descriptionForeground)'
  },
  '.cm-placeholder': {color: 'var(--vscode-input-placeholderForeground)'},
  '.cm-var': {
    color: 'var(--restly-var)',
    backgroundColor: 'var(--restly-var-bg)',
    borderRadius: '3px'
  }
})

// Colours come from CSS variables set per VS Code theme kind in styles.css.
const highlight = HighlightStyle.define([
  {tag: [t.string, t.special(t.string)], color: 'var(--restly-string)'},
  {tag: [t.number, t.bool, t.null], color: 'var(--restly-number)'},
  {tag: [t.keyword, t.atom], color: 'var(--restly-keyword)'},
  {tag: [t.propertyName], color: 'var(--restly-property)'},
  {tag: [t.tagName, t.angleBracket], color: 'var(--restly-tag)'},
  {tag: [t.attributeName], color: 'var(--restly-attr)'},
  {tag: [t.attributeValue], color: 'var(--restly-string)'},
  {tag: [t.comment, t.meta], color: 'var(--restly-comment)', fontStyle: 'italic'},
  {tag: t.invalid, color: 'var(--vscode-errorForeground)'}
])

const varMatcher = new MatchDecorator({
  regexp: /\{\{[^{}]+\}\}/g,
  decoration: Decoration.mark({class: 'cm-var'})
})

const varHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = varMatcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = varMatcher.updateDeco(update, this.decorations)
    }
  },
  {decorations: (v) => v.decorations}
)

function languageExtension(language: Language): Extension {
  switch (language) {
    case 'json':
      return json()
    case 'xml':
      return xml()
    case 'html':
      return html()
    default:
      return []
  }
}

interface Props {
  value: string
  onChange?: (value: string) => void
  language: Language
  readOnly?: boolean
  placeholder?: string
  wrap?: boolean
}

/** Marks a change that came from the `value` prop, so it is not echoed back through onChange. */
const fromProps = Annotation.define<boolean>()

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  wrap
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const languageSlot = useRef(new Compartment())
  const wrapSlot = useRef(new Compartment())

  useLayoutEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(highlight),
        varHighlighter,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
          indentWithTab
        ]),
        theme,
        EditorState.readOnly.of(readOnly),
        EditorState.tabSize.of(2),
        placeholder ? placeholderExt(placeholder) : [],
        languageSlot.current.of(languageExtension(language)),
        wrapSlot.current.of(wrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (update.transactions.some((tr) => tr.annotation(fromProps))) return
          onChangeRef.current?.(update.state.doc.toString())
        })
      ]
    })
    view.current = new EditorView({state, parent: host.current!})
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // The editor is created once; later prop changes are applied below.
  }, [])

  // A layout effect runs before the next keystroke can arrive, so the prop is
  // never older than the document; a plain effect let stale values fight it.
  useLayoutEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({
        changes: {from: 0, to: v.state.doc.length, insert: value},
        annotations: fromProps.of(true)
      })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({effects: languageSlot.current.reconfigure(languageExtension(language))})
  }, [language])

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapSlot.current.reconfigure(wrap ? EditorView.lineWrapping : [])
    })
  }, [wrap])

  return <div class="code-editor" ref={host} />
}
