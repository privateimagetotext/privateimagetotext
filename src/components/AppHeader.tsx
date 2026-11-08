import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
  productConfig,
  type LocalProcessingStatus,
} from "../config/product";
import { LocalProcessingBadge } from "./LocalProcessingBadge";
import { ThemeToggle } from "./ThemeToggle";
import { useOfflineReadiness } from "../hooks/useOfflineReadiness";
import { toolDirectory } from "../config/tool-directory";

const toolPaths = new Set(toolDirectory.map((tool) => tool.path));
// Shown between 1100 and 1304px, where the full navigation does not fit but
// the tools should still be visible without opening the menu.
const toolNavigationItems = productConfig.navigation.filter((item) => toolPaths.has(item.to));

export type AppHeaderProps = {
  readonly localStatus: LocalProcessingStatus;
  readonly activeNavigation?: boolean;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function AppHeader({
  localStatus,
  activeNavigation = true,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuDialogRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const offline = useOfflineReadiness();
  const statusExplanationId = useId();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const dialog = menuDialogRef.current;
    const returnFocusTarget = menuButtonRef.current;
    const backgroundRegions = [
      document.querySelector<HTMLElement>("main"),
      document.querySelector<HTMLElement>(".app-footer"),
    ].filter((region): region is HTMLElement => region !== null);
    const previousInertValues = backgroundRegions.map((region) => region.inert);

    document.body.classList.add("is-menu-open");
    backgroundRegions.forEach((region) => {
      region.inert = true;
    });

    const focusFirstControl = () => {
      dialog
        ?.querySelector<HTMLElement>(focusableSelector)
        ?.focus({ preventScroll: true });
    };

    const frame = window.requestAnimationFrame(focusFirstControl);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((control) => control.getClientRects().length > 0);

      if (controls.length === 0) {
        event.preventDefault();
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("is-menu-open");
      backgroundRegions.forEach((region, index) => {
        region.inert = previousInertValues[index];
      });
      returnFocusTarget?.focus({ preventScroll: true });
    };
  }, [menuOpen]);

  const navigationLinks = (items: readonly (typeof productConfig.navigation)[number][]) =>
    items.map((item) =>
        activeNavigation ? (
          <NavLink
            key={item.to}
            to={item.to}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              isActive
                ? "app-navigation__link is-active"
                : "app-navigation__link"
            }
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </NavLink>
        ) : (
          <Link
            key={item.to}
            to={item.to}
            className="app-navigation__link"
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ),
      );

  const navigation = (
    <nav className="app-navigation" aria-label="Primary navigation">
      {navigationLinks(productConfig.navigation)}
    </nav>
  );

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <NavLink
          className="app-wordmark"
          to="/"
          end
          aria-label={`${productConfig.name} tool`}
          onClick={() => setMenuOpen(false)}
        >
          <span className="app-wordmark__mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span className="app-wordmark__copy">
            <strong>{productConfig.name}</strong>
            <small>{productConfig.descriptor}</small>
          </span>
        </NavLink>

        <div className="app-header__desktop">{navigation}</div>
        <nav className="app-navigation app-header__tools" aria-label="Tools">
          {navigationLinks(toolNavigationItems)}
        </nav>

        <div className="app-header__actions">
          <details className="header-offline-status" data-ready={offline.label.startsWith("Offline: ready")}>
            <summary aria-describedby={statusExplanationId}>
              <LocalProcessingBadge status={localStatus} compact definition={{ label: offline.headerLabel, description: offline.headerDescription }} />
            </summary>
            <p id={statusExplanationId}>{offline.headerDescription}</p>
          </details>
          {location.pathname !== "/" && <span className="sr-only" aria-live="polite" aria-atomic="true">{offline.headerAnnouncement}</span>}
          <div className="app-header__desktop">
            <ThemeToggle />
          </div>
          <button
            ref={menuButtonRef}
            className="menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="mobile-menu-layer">
          <button
            className="mobile-menu-layer__backdrop"
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuDialogRef}
            id={menuId}
            className="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="mobile-menu__header">
              <span>{productConfig.name}</span>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setMenuOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {navigation}
            <div className="mobile-menu__footer">
              <ThemeToggle />
              <LocalProcessingBadge status={localStatus} definition={{ label: offline.headerLabel, description: offline.headerDescription }} />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
