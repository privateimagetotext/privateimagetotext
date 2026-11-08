import { Link, useLocation } from "react-router";
import { breadcrumbsForPath } from "../config/structured-data";

export function PageBreadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = breadcrumbsForPath(pathname);
  if (!crumbs.length) return null;
  return <nav className="guide-breadcrumb" aria-label="Breadcrumb">
    <ol>{crumbs.map((crumb, index) => <li key={crumb.path}>
      {index === crumbs.length - 1 ? <span aria-current="page">{crumb.name}</span>
        : <Link to={crumb.path}>{crumb.name}</Link>}
    </li>)}</ol>
  </nav>;
}
