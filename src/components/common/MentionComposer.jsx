import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { useCareStore } from '../../store/careStore.js';
import {
  filterUsersByQuery,
  listMentionableUsers,
  userDisplayName,
} from '../../utils/mentions.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const PILL_ATTR = 'data-mention-id';

function placeCaretAfter(node) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.setStartAfter(node);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function isMentionPill(node) {
  return node?.nodeType === Node.ELEMENT_NODE && !!node.getAttribute?.(PILL_ATTR);
}

/** True for empty / ZWSP / NBSP-only text nodes left after pill insert. */
function isTrivialText(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  return !/[^\s\u00a0\u200b]/.test(node.textContent || '');
}

/**
 * Find a mention pill adjacent to the caret for Backspace (behind) or Delete (ahead).
 * Handles caret in parent after the pill, or in a text node at its edge.
 */
function findAdjacentMentionPill(root, direction) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  let offset = range.startOffset;
  if (!root.contains(node)) return null;

  if (direction === 'behind') {
    // Caret inside a text node at offset 0 → look at previous sibling (skip trivial text).
    if (node.nodeType === Node.TEXT_NODE && offset === 0) {
      let prev = node.previousSibling;
      while (prev && isTrivialText(prev)) prev = prev.previousSibling;
      if (isMentionPill(prev)) return prev;
      return null;
    }
    // Caret in text node after only whitespace — treat as "just after pill"
    if (node.nodeType === Node.TEXT_NODE && offset > 0) {
      const before = (node.textContent || '').slice(0, offset);
      if (!/[^\s\u00a0\u200b]/.test(before)) {
        let prev = node.previousSibling;
        while (prev && isTrivialText(prev)) prev = prev.previousSibling;
        if (isMentionPill(prev)) return prev;
      }
      return null;
    }
    // Caret in element: child before offset
    if (node.nodeType === Node.ELEMENT_NODE) {
      let i = offset - 1;
      while (i >= 0 && isTrivialText(node.childNodes[i])) i -= 1;
      const prev = node.childNodes[i];
      if (isMentionPill(prev)) return prev;
    }
    return null;
  }

  // direction === 'ahead' (Delete key)
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (offset < text.length) {
      const after = text.slice(offset);
      if (/[^\s\u00a0\u200b]/.test(after)) return null;
    }
    let next = node.nextSibling;
    while (next && isTrivialText(next)) next = next.nextSibling;
    if (isMentionPill(next)) return next;
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    let i = offset;
    while (i < node.childNodes.length && isTrivialText(node.childNodes[i])) i += 1;
    const next = node.childNodes[i];
    if (isMentionPill(next)) return next;
  }
  return null;
}

function removeMentionPill(pill) {
  if (!pill?.parentNode) return;
  const parent = pill.parentNode;
  // Drop trailing trivial spacer that was inserted with the pill
  const next = pill.nextSibling;
  if (isTrivialText(next) && next.parentNode) parent.removeChild(next);
  const prev = pill.previousSibling;
  parent.removeChild(pill);
  if (prev?.parentNode) {
    placeCaretAfter(prev);
  } else {
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(parent, 0);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/** If the selection intersects one or more mention pills, remove those pills. */
function removeSelectedMentionPills(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;

  const pills = [...root.querySelectorAll(`[${PILL_ATTR}]`)].filter((pill) => {
    try {
      return range.intersectsNode(pill);
    } catch {
      return false;
    }
  });
  if (pills.length === 0) return false;

  const anchor = pills[0].previousSibling;
  // Remove last→first so sibling links stay stable
  for (let i = pills.length - 1; i >= 0; i -= 1) {
    const pill = pills[i];
    const next = pill.nextSibling;
    if (isTrivialText(next) && next.parentNode) next.parentNode.removeChild(next);
    pill.parentNode?.removeChild(pill);
  }
  if (anchor?.parentNode) {
    placeCaretAfter(anchor);
  } else {
    const r = document.createRange();
    r.setStart(root, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  return true;
}

function getCaretTextInfo(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;

  // Walk backward from caret collecting text until start or a pill.
  let node = range.startContainer;
  let offset = range.startOffset;
  let textBefore = '';

  if (node.nodeType === Node.TEXT_NODE) {
    textBefore = node.textContent.slice(0, offset);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Caret in element — take text of previous siblings' trailing text
    const child = node.childNodes[offset - 1];
    if (child?.nodeType === Node.TEXT_NODE) {
      textBefore = child.textContent || '';
      node = child;
      offset = textBefore.length;
    } else {
      return { query: null, atIndex: -1, textNode: null, textBefore: '' };
    }
  }

  // Don't search across pill boundaries — stop at start of this text node.
  const at = textBefore.lastIndexOf('@');
  if (at < 0) return { query: null, atIndex: -1, textNode: node, textBefore };

  // '@' must start a token (start or whitespace before it)
  if (at > 0 && !/\s/.test(textBefore[at - 1])) {
    return { query: null, atIndex: -1, textNode: node, textBefore };
  }

  const query = textBefore.slice(at + 1);
  // Abort if query has newline (user moved on)
  if (/\n/.test(query)) return { query: null, atIndex: -1, textNode: node, textBefore };
  return { query, atIndex: at, textNode: node, textBefore };
}

function serializeEditor(root) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.getAttribute?.(PILL_ATTR)) {
      const id = node.getAttribute(PILL_ATTR);
      const label = (node.getAttribute('data-mention-label') || node.textContent || '')
        .replace(/^@/, '')
        .trim();
      out += `@[${label.replace(/[\[\]]/g, '')}](${id})`;
      return;
    }
    if (node.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (node.tagName === 'DIV' || node.tagName === 'P') {
      // Block break before subsequent blocks
      if (out && !out.endsWith('\n')) out += '\n';
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return out.replace(/\u00a0/g, ' ').replace(/\n+$/, '').trimEnd();
}

function createPillEl(user) {
  const label = userDisplayName(user);
  const span = document.createElement('span');
  span.setAttribute(PILL_ATTR, user.id);
  span.setAttribute('data-mention-label', label);
  span.contentEditable = 'false';
  span.textContent = `@${label}`;
  span.style.cssText = [
    'display:inline',
    'padding:1px 7px',
    'margin:0 1px',
    'border-radius:999px',
    'font-weight:650',
    'font-size:0.92em',
    'line-height:1.45',
    `background:${hexToRgba(palette.accentBlue.hex, 0.12)}`,
    `color:${palette.accentBlue.hex}`,
    `box-shadow:inset 0 0 0 1px ${hexToRgba(palette.accentBlue.hex, 0.22)}`,
    'white-space:nowrap',
    'user-select:none',
    'cursor:pointer',
  ].join(';');
  return span;
}

const MentionComposer = forwardRef(function MentionComposer(
  {
    placeholder = 'Write a note… Type @ to mention someone',
    rows = 3,
    onSubmit,
    onEmptyChange,
    excludeUserId = null,
    style = {},
  },
  ref,
) {
  const editorRef = useRef(null);
  const menuRef = useRef(null);
  const storeUsers = useCareStore((s) => s.users) || {};
  const [menu, setMenu] = useState(null); // { query, index }
  const [focused, setFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const candidates = useMemo(
    () => listMentionableUsers(storeUsers, { excludeId: excludeUserId }),
    [storeUsers, excludeUserId],
  );

  const suggestions = useMemo(
    () => (menu ? filterUsersByQuery(candidates, menu.query) : []),
    [menu, candidates],
  );

  const syncEmpty = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const text = (root.textContent || '').replace(/\u00a0/g, ' ').trim();
    const hasPill = !!root.querySelector(`[${PILL_ATTR}]`);
    const empty = !text && !hasPill;
    setIsEmpty(empty);
    onEmptyChange?.(empty);
  }, [onEmptyChange]);

  useImperativeHandle(ref, () => ({
    getValue: () => {
      const root = editorRef.current;
      if (!root) return '';
      return serializeEditor(root).trim();
    },
    clear: () => {
      const root = editorRef.current;
      if (!root) return;
      root.innerHTML = '';
      setMenu(null);
      setIsEmpty(true);
      onEmptyChange?.(true);
    },
    focus: () => editorRef.current?.focus(),
    isEmpty: () => isEmpty,
  }), [isEmpty, onEmptyChange]);

  const insertMention = useCallback((user) => {
    const root = editorRef.current;
    if (!root || !user?.id) return;
    const info = getCaretTextInfo(root);
    if (!info?.textNode || info.atIndex < 0) {
      // Fallback: append at end
      const pill = createPillEl(user);
      root.appendChild(pill);
      root.appendChild(document.createTextNode('\u00a0'));
      placeCaretAfter(pill.nextSibling || pill);
      setMenu(null);
      syncEmpty();
      return;
    }

    const { textNode, textBefore, atIndex } = info;
    const after = (textNode.textContent || '').slice(textBefore.length);
    const before = textBefore.slice(0, atIndex);

    const pill = createPillEl(user);
    const parent = textNode.parentNode;
    const beforeNode = document.createTextNode(before);
    const spaceNode = document.createTextNode('\u00a0');
    const afterNode = after ? document.createTextNode(after) : null;

    parent.insertBefore(beforeNode, textNode);
    parent.insertBefore(pill, textNode);
    parent.insertBefore(spaceNode, textNode);
    if (afterNode) parent.insertBefore(afterNode, textNode);
    parent.removeChild(textNode);

    placeCaretAfter(spaceNode);
    setMenu(null);
    syncEmpty();
  }, [syncEmpty]);

  const updateMentionMenu = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const info = getCaretTextInfo(root);
    if (!info || info.query === null) {
      setMenu(null);
      return;
    }
    setMenu((prev) => ({
      query: info.query,
      index: prev?.query === info.query ? (prev.index || 0) : 0,
    }));
  }, []);

  function onInput() {
    syncEmpty();
    updateMentionMenu();
  }

  function onKeyDown(e) {
    if (menu && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenu((m) => ({ ...m, index: (m.index + 1) % suggestions.length }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenu((m) => ({
          ...m,
          index: (m.index - 1 + suggestions.length) % suggestions.length,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(suggestions[menu.index] || suggestions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    // Backspace / Delete removes an adjacent mention pill as a single unit
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const root = editorRef.current;
      if (root) {
        if (removeSelectedMentionPills(root)) {
          e.preventDefault();
          syncEmpty();
          setMenu(null);
          return;
        }
        const pill = findAdjacentMentionPill(
          root,
          e.key === 'Backspace' ? 'behind' : 'ahead',
        );
        if (pill) {
          e.preventDefault();
          removeMentionPill(pill);
          syncEmpty();
          setMenu(null);
          return;
        }
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    }
  }

  /** Click a pill to select it so Backspace/Delete clears it. */
  function onEditorClick(e) {
    const pill = e.target?.closest?.(`[${PILL_ATTR}]`);
    if (!pill || !editorRef.current?.contains(pill)) return;
    e.preventDefault();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNode(pill);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  }

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    function onDoc(e) {
      if (
        editorRef.current?.contains(e.target) ||
        menuRef.current?.contains(e.target)
      ) return;
      setMenu(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  // Keep highlighted suggestion in view
  useEffect(() => {
    if (!menu) return;
    const el = menuRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [menu?.index, menu]);

  const minHeight = Math.max(3, rows) * 22 + 20;

  return (
    <div style={{ position: 'relative', ...style }}>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={onEditorClick}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          minHeight,
          padding: '10px 12px',
          borderRadius: 8,
          border: `1px solid ${
            focused ? palette.primaryMagenta.hex : 'var(--color-border)'
          }`,
          background: hexToRgba(palette.backgroundDark.hex, 0.03),
          fontSize: 13,
          color: palette.backgroundDark.hex,
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          transition: 'border-color 0.15s',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowY: 'auto',
          maxHeight: 220,
        }}
      />

      {/* Placeholder */}
      {isEmpty && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            right: 12,
            fontSize: 13,
            color: hexToRgba(palette.backgroundDark.hex, 0.35),
            pointerEvents: 'none',
            lineHeight: 1.5,
          }}
        >
          {placeholder}
        </div>
      )}

      {/* Suggestion menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 4,
            background: palette.backgroundLight.hex,
            border: `1px solid var(--color-border)`,
            borderRadius: 10,
            boxShadow: `0 10px 28px ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
            zIndex: 40,
            overflow: 'hidden',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {suggestions.length === 0 ? (
            <div style={{
              padding: '12px 14px',
              fontSize: 12.5,
              color: hexToRgba(palette.backgroundDark.hex, 0.45),
            }}>
              No staff match “{menu.query}”
            </div>
          ) : (
            suggestions.map((u, i) => {
              const active = i === (menu.index || 0);
              const name = userDisplayName(u);
              const initials = name
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join('');
              return (
                <button
                  key={u.id}
                  type="button"
                  data-active={active ? 'true' : 'false'}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(u);
                  }}
                  onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    border: 'none',
                    background: active
                      ? hexToRgba(palette.accentBlue.hex, 0.1)
                      : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                >
                  {u.clerk_image_url ? (
                    <img
                      src={u.clerk_image_url}
                      alt=""
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        objectFit: 'cover', flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: hexToRgba(palette.accentBlue.hex, 0.14),
                      color: palette.accentBlue.hex,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10.5, fontWeight: 800,
                    }}>
                      {initials || '?'}
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      fontSize: 13, fontWeight: 650, margin: 0,
                      color: palette.backgroundDark.hex,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {name}
                    </p>
                    {u.email && (
                      <p style={{
                        fontSize: 11, margin: '1px 0 0',
                        color: hexToRgba(palette.backgroundDark.hex, 0.45),
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {u.email}
                      </p>
                    )}
                  </div>
                  {active && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 650,
                      color: palette.accentBlue.hex, flexShrink: 0,
                    }}>
                      ↵
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

export default MentionComposer;
