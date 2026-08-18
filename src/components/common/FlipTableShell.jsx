import FlipScrollBar from './FlipScrollBar.jsx';

/**
 * Scroll container for flip-window tables.
 * Locked: overflow-y hidden, wheel/keys change which records occupy the slots.
 * Full: ordinary overflow scroll (the whole table image moves).
 */
export default function FlipTableShell({
  flip,
  headerHeight = 38,
  className,
  style,
  children,
}) {
  const enabled = !!flip?.enabled;
  const { overflow, overflowX, overflowY, ...rest } = style || {};
  return (
    <div
      ref={flip?.viewportRef}
      tabIndex={enabled ? 0 : undefined}
      onKeyDown={flip?.onKeyDown}
      className={className}
      style={{
        position: 'relative',
        outline: 'none',
        ...rest,
        overflowX: overflowX ?? (enabled ? 'auto' : overflow ?? 'auto'),
        overflowY: enabled ? 'hidden' : (overflowY ?? overflow ?? 'auto'),
      }}
    >
      {children}
      {enabled && (
        <FlipScrollBar
          start={flip.startIndex}
          maxStart={flip.maxStart}
          slotCount={flip.slotCount}
          total={flip.total}
          headerHeight={headerHeight}
          onChange={flip.setStart}
        />
      )}
    </div>
  );
}
