import { FocusTrap } from "focus-trap-react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useIsCompactLayout } from "@/hooks/useMediaQuery";
import {
  useContextMenuActions,
  useContextMenuStore,
} from "@/store/contextMenuStore";

import MenuList, { DrillInMenuList } from "./MenuList";
import "./index.css";

const ContextMenu: React.FC = () => {
  const { closeMenu } = useContextMenuActions();
  const isOpen = useContextMenuStore((state) => state.isOpen);
  const position = useContextMenuStore((state) => state.position);
  const items = useContextMenuStore((state) => state.items);
  const isCompact = useIsCompactLayout();
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenuPath, setActiveSubmenuPath] = useState<string[]>([]);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({
    opacity: 0,
  });

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("resize", closeMenu);
    }

    if (!isOpen) {
      setMenuStyle({
        opacity: 0,
      });
      setActiveSubmenuPath([]);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", closeMenu);
    };
  }, [isOpen, closeMenu]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === "Escape") {
        if (activeSubmenuPath.length > 0) {
          // Close current submenu
          setActiveSubmenuPath((prev) => prev.slice(0, -1));
        } else {
          closeMenu();
        }
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, closeMenu, activeSubmenuPath]);

  // Calculate menu position (desktop flyout only)
  useEffect(() => {
    if (!isCompact && isOpen && position && menuRef.current) {
      const menu = menuRef.current;
      const { x, y } = position;
      const { innerWidth, innerHeight } = window;

      // Get menu dimensions
      const { width, height } = menu.getBoundingClientRect();

      // Calculate available space in each direction
      const spaceLeft = x;
      const spaceRight = innerWidth - x;
      const spaceTop = y;
      const spaceBottom = innerHeight - y;

      // Default to showing below and to the right
      let finalX = x;
      let finalY = y - 5;

      if (width > spaceRight) {
        if (width < spaceLeft) {
          finalX = Math.max(0, x - width);
        } else {
          finalX = Math.max(0, innerWidth - width);
        }
      }

      if (height > spaceBottom) {
        if (height < spaceTop) {
          finalY = Math.max(0, y - height);
        } else {
          finalY = Math.max(0, innerHeight - height);
        }
      }

      setMenuStyle({
        position: "fixed",
        left: finalX,
        top: finalY,
        opacity: 1,
        // Only cap the height when the menu genuinely cannot fit, so menus that
        // fit exactly keep their previous desktop appearance.
        maxHeight:
          finalY + height > innerHeight
            ? `${innerHeight - finalY}px`
            : undefined,
      });
    }
  }, [isCompact, isOpen, position]);

  if (!isOpen || !position) {
    return null;
  }

  if (isCompact) {
    return createPortal(
      <div className="context-menu-sheet-root">
        <div
          className="context-menu-sheet-backdrop"
          onClick={closeMenu}
          aria-hidden="true"
        />
        <FocusTrap
          focusTrapOptions={{
            allowOutsideClick: true,
            escapeDeactivates: false,
            initialFocus: () =>
              menuRef.current?.querySelector<HTMLElement>(".menu-list") ??
              false,
          }}
        >
          <div
            ref={menuRef}
            className="context-menu context-menu-sheet"
            role="presentation"
          >
            <div className="context-menu-sheet-grab" aria-hidden="true" />
            <div className="context-menu-sheet-content">
              <DrillInMenuList
                items={items}
                activeSubmenuPath={activeSubmenuPath}
                setActiveSubmenuPath={setActiveSubmenuPath}
                onClose={closeMenu}
              />
            </div>
          </div>
        </FocusTrap>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div ref={menuRef} className="context-menu" style={menuStyle} role="menu">
      <div className="context-menu-content">
        <MenuList
          items={items}
          level={0}
          parentPath={[]}
          activeSubmenuPath={activeSubmenuPath}
          setActiveSubmenuPath={setActiveSubmenuPath}
          wasOpenedByKeyboard={false}
        />
      </div>
    </div>,
    document.body,
  );
};

export default ContextMenu;
