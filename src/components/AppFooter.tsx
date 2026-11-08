import { Link, NavLink } from "react-router";
import { footerNavigation, productConfig } from "../config/product";
import { SupportLink } from "./SupportLink";

export type AppFooterProps = {
  readonly buildVersion?: string;
  readonly activeNavigation?: boolean;
  /**
   * Whether this route may show the support link. Off unless the shell
   * explicitly allows it, and never allowed on tool routes.
   */
  readonly showSupport?: boolean;
};

export function AppFooter({
  buildVersion,
  activeNavigation = true,
  showSupport = false,
}: AppFooterProps) {
  return (
    <footer className="app-footer">
      <div className="app-footer__identity">
        <strong>{productConfig.name}</strong>
        <span>
          Free browser tools for extracting text, inspecting media and hiding
          messages without uploading your files.
        </span>
        <a href={`mailto:${productConfig.contactEmail}`}>
          {productConfig.contactEmail}
        </a>
        {showSupport ? <SupportLink placement="footer" /> : null}
      </div>
      <nav className="app-footer__navigation" aria-label="Footer navigation">
        {[...productConfig.navigation, ...footerNavigation].map((item) =>
          activeNavigation ? (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
            >
              {item.label}
            </NavLink>
          ) : (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ),
        )}
      </nav>
      <div className="app-footer__build">
        <span>{productConfig.build.environmentLabel}</span>
        {buildVersion ? <span>Version {buildVersion}</span> : null}
      </div>
    </footer>
  );
}
