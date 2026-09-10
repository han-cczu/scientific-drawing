import { useEffect } from "react";
import {
  getEditorShortcutAction,
  isEditableKeyboardTarget,
  type EditorShortcutAction,
} from "../keyboardShortcuts";

export function useEditorShortcuts(
  blocked: boolean,
  actions: Record<EditorShortcutAction, () => void>,
) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (blocked) return;
      const action = getEditorShortcutAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        editable: isEditableKeyboardTarget(event.target),
      });
      if (action) {
        event.preventDefault();
        actions[action]();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [blocked, actions]);
}
