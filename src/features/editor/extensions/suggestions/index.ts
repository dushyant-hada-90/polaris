import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
    keymap,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

import { fetcher } from "./fetcher";

// StateEffect: A way to send "messages" to update state.
// We define one effect type for setting the suggestion text.
const setSuggestionEffect = StateEffect.define<string | null>();

// StateField: Holds our suggestion state in he editor.
// StateField: Holds our suggestion state in the editor.
// - update(): Called on every transaction (keystroke, etc.) to potentially update the value
const suggestionState = StateField.define<string | null>({
    create() {
        return null
    },
    update(value, transaction) {
        // check each effect in this transaction
        // If we find our setSuggestionEffect, return its new value
        // otherwise, keep the current value unchanged
        for (const effect of transaction.effects) {
            if (effect.is(setSuggestionEffect)) {
                return effect.value;
            }
        }
        return value
    }
})

// WidgetType: Creates custom DOM elements to display in the editor.
// toDOM() is called by CodeMirror to create the actual HTML element.
class SuggestionWidget extends WidgetType {
    constructor(readonly text: string) {
        super()
    }

    toDOM() {
        const span = document.createElement("span")
        span.textContent = this.text
        span.style.opacity = "0.4"//Ghost text appearance
        span.style.pointerEvents = "none"
        return span
    }
}

const DEBOUNCE_DELAY = 300;
let debounceTimer: number | null = null;
let isWaitingForSuggestion = false;

let currentAbortController: AbortController | null = null;


const generatePayload = (view: EditorView, fileName: string) => {
    const code = view.state.doc.toString()
    if (!code || code.trim().length === 0) return null
    const cursorPosition = view.state.selection.main.head;
    const currentLine = view.state.doc.lineAt(cursorPosition);
    const cursorInLine = cursorPosition - currentLine.from;

    const previousLines: string[] = [];
    const previousLinesToFetch = Math.min(5, currentLine.number - 1);
    for (let i = previousLinesToFetch; i >= 1; i--) {
        previousLines.push(view.state.doc.line(currentLine.number - i).text);
    }

    const nextLines: string[] = [];
    const totalLines = view.state.doc.lines;
    const linesToFetch = Math.min(5, totalLines - currentLine.number);
    for (let i = 1; i <= linesToFetch; i++) {
        nextLines.push(view.state.doc.line(currentLine.number + i).text);
    }

    return {
        fileName,
        code,
        currentLine: currentLine.text,
        previousLines: previousLines.join("\n"),
        textBeforeCursor: currentLine.text.slice(0, cursorInLine),
        textAfterCursor: currentLine.text.slice(cursorInLine),
        nextLines: nextLines.join("\n"),
        lineNumber: currentLine.number,
    }
}
const createDebouncePlugin = (fileName: string) => {
    return ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                this.triggerSuggestion(view)
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.selectionSet) {
                    this.triggerSuggestion(update.view)
                }
            }

            triggerSuggestion(view: EditorView) {
                if (debounceTimer != null) {
                    clearTimeout(debounceTimer)
                }
                if (currentAbortController !== null) {
                    currentAbortController.abort()
                }

                isWaitingForSuggestion = true

                debounceTimer = window.setTimeout(async () => {
                    const payload = generatePayload(view, fileName)
                    if (!payload) {
                        isWaitingForSuggestion = false
                        view.dispatch({ effects: setSuggestionEffect.of(null) })
                        return
                    }

                    currentAbortController = new AbortController()
                    const suggestion = await fetcher(payload, currentAbortController.signal)
                    isWaitingForSuggestion = false
                    view.dispatch({
                        effects: setSuggestionEffect.of(suggestion)
                    })
                }, DEBOUNCE_DELAY)
            }

            destroy() {
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                }
                if (currentAbortController !== null) {
                    currentAbortController.abort();
                }

            }
        }
    )
}


const renderPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet

        constructor(view: EditorView) {
            this.decorations = this.build(view)
        }
        update(update: ViewUpdate) {
            // Rebuild decorations if doc has changed or cursor has moved,or suggestions changed
            const suggestionChanged = update.transactions.some((transaction) => {
                return transaction.effects.some((effect) => {
                    return effect.is(setSuggestionEffect)
                }
                )
            })

            // Rebuild decorations if doc changed, cursor moved, or suggestion changed
            const shouldRebuild = update.docChanged || update.selectionSet || suggestionChanged
            if (shouldRebuild) {
                this.decorations = this.build(update.view)
            }
        }

        build(view: EditorView) {
            if (isWaitingForSuggestion) { return Decoration.none }

            // Get current suggestion from state
            const suggestion = view.state.field(suggestionState);
            if (!suggestion) {
                return Decoration.none;
            }

            // create a widget decoration at cursor position
            const cursor = view.state.selection.main.head
            return Decoration.set([
                Decoration.widget({
                    widget: new SuggestionWidget(suggestion),
                    side: 1 //render after cursor , not before(-1)
                }).range(cursor)
            ])
        }
    },
    { decorations: (plugin) => plugin.decorations }//tells codemirror to use our decorations
)

const acceptSuggestionKeyMap = keymap.of([
    {
        key: "Tab",
        run: (view) => {
            const suggestion = view.state.field(suggestionState)
            if (!suggestion) {
                return false //no suggestion found so normal indent from tab
            }

            const cursor = view.state.selection.main.head
            view.dispatch({
                changes: { from: cursor, insert: suggestion },//insert suggestion text
                selection: { anchor: cursor + suggestion.length },//move cursor to end
                effects: setSuggestionEffect.of(null)
            })
            return true //we handle tab don't indent
        }
    }
])
export const suggestion = (fileName: string) => [
    suggestionState, // Our state storage
    createDebouncePlugin(fileName),//trigger suggestions on typing
    renderPlugin,//renders ghost state
    acceptSuggestionKeyMap,//Tab to accept
]
