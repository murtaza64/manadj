import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react';
import './ContextMenu.css';

/**
 * Generic context menu (playlist-editing 03): viewport-aware positioning,
 * hover submenus, disabled items, Escape/click-away dismissal. Purely
 * presentational — consumers own the open/closed state and the items.
 */

export interface MenuItem {
  label: string;
  /** Rendered but inert, with an optional explanatory tooltip. */
  disabled?: boolean;
  /** Tooltip (useful for explaining a disabled item). */
  title?: string;
  /** Destructive styling (red). */
  danger?: boolean;
  /** Leaf action; the menu closes after it runs. Ignored when submenu is set. */
  onSelect?: () => void;
  /** Hover-opened submenu. */
  submenu?: MenuItem[];
  /** Draw a separator line above this item. */
  separatorBefore?: boolean;
  /** Color swatch square before the label (e.g. palette items). */
  swatch?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Keep a menu of the given size inside the viewport. */
export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, viewportWidth - width)),
    y: Math.max(0, Math.min(y, viewportHeight - height)),
  };
}

function MenuList({
  items,
  onClose,
  submenuSide,
}: {
  items: MenuItem[];
  onClose: () => void;
  submenuSide: 'left' | 'right';
}) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

  return (
    <ul className="context-menu-list" role="menu">
      {items.map((item, i) => (
        <li
          key={i}
          role="menuitem"
          aria-disabled={item.disabled || undefined}
          title={item.title}
          className={[
            'context-menu-item',
            item.disabled ? 'disabled' : '',
            item.danger ? 'danger' : '',
            item.separatorBefore ? 'separated' : '',
            item.submenu ? 'has-submenu' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onMouseEnter={() => setOpenSubmenu(item.submenu ? i : null)}
          onClick={(e) => {
            e.stopPropagation();
            if (item.disabled || item.submenu) return;
            if (item.onSelect) {
              item.onSelect();
              onClose();
            }
          }}
        >
          <span className="context-menu-label">
            {item.swatch && <span className="context-menu-swatch" style={{ background: item.swatch }} />}
            {item.label}
          </span>
          {item.submenu && <span className="context-menu-caret">▸</span>}
          {item.submenu && openSubmenu === i && !item.disabled && (
            <div className={`context-menu-submenu ${submenuSide}`}>
              <MenuList items={item.submenu} onClose={onClose} submenuSide={submenuSide} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [submenuSide, setSubmenuSide] = useState<'left' | 'right'>('right');

  // Measure and clamp into the viewport; submenus flip left near the edge.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition(clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
    setSubmenuSide(x + rect.width * 2 > window.innerWidth ? 'left' : 'right');
  }, [x, y]);

  // Dismiss on click-away or Escape. Deliberately NO document 'contextmenu'
  // listener: the right-click that OPENS the menu is still bubbling to
  // document when this effect attaches (React flushes discrete-event
  // effects synchronously), so such a listener dismisses the menu in the
  // same instant it opens. 'mousedown' covers right-clicks anyway — it
  // fires before 'contextmenu', i.e. before the menu mounts.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} submenuSide={submenuSide} />
    </div>
  );
}

/** Convenience: consumer-side open/close state for a context menu.
 * openMenu/closeMenu are identity-stable (they feed memoized rows and
 * the menu's dismiss-listener effect). */
export function useContextMenuState<T>() {
  const [state, setState] = useState<{ x: number; y: number; context: T } | null>(null);
  const openMenu = useCallback((x: number, y: number, context: T) => setState({ x, y, context }), []);
  const closeMenu = useCallback(() => setState(null), []);
  return { menu: state, openMenu, closeMenu };
}
