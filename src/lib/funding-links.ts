/**
 * Fail-closed validation for the two allowed funding links: one outbound
 * support link and disclosed affiliate links inside guide content.
 *
 * Both are plain first-party anchors built from static, reviewed
 * configuration. Nothing here loads a script, image, iframe or font, makes a
 * request, or reads tool state. Anything that does not validate exactly
 * renders nothing.
 */

export type SupportPlatformId = "ko-fi" | "github-sponsors" | "buy-me-a-coffee";

export type SupportConfig = {
  /** The full https URL of Simon's support page. Empty renders nothing. */
  readonly url: string;
};

export type AffiliateEntry = {
  /** Stable registry key referenced by guides, for example `proton-pass`. */
  readonly id: string;
  /** The company running the affiliate programme, for example `Proton`. */
  readonly partner: string;
  /** The product the link points to, for example `Proton Pass`. */
  readonly product: string;
  /** Reviewed one-sentence reason the product fits the guide's reader. */
  readonly description: string;
  /** The exact https affiliate URL issued by the programme. */
  readonly url: string;
  /**
   * The exact hostname the URL must use. Declaring it separately makes a
   * changed or mistyped URL fail closed instead of silently pointing at an
   * unreviewed destination.
   */
  readonly host: string;
};

export type ResolvedSupportLink = {
  readonly platform: SupportPlatformId;
  readonly platformName: string;
  readonly href: string;
};

export type ResolvedAffiliateLink = {
  readonly id: string;
  readonly partner: string;
  readonly product: string;
  readonly description: string;
  readonly href: string;
};

type SupportPlatformRule = {
  readonly id: SupportPlatformId;
  readonly name: string;
  readonly hosts: readonly string[];
  readonly path: RegExp;
};

/**
 * The only hosts a support link may point to. Each accepts a single creator
 * page path, with no query string or fragment, so a link cannot carry
 * campaign, referral or user-derived parameters.
 */
export const SUPPORT_PLATFORMS: readonly SupportPlatformRule[] = [
  {
    id: "ko-fi",
    name: "Ko-fi",
    hosts: ["ko-fi.com"],
    path: /^\/[A-Za-z0-9_]{1,64}\/?$/,
  },
  {
    id: "github-sponsors",
    name: "GitHub Sponsors",
    hosts: ["github.com"],
    path: /^\/sponsors\/[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}\/?$/,
  },
  {
    id: "buy-me-a-coffee",
    name: "Buy Me a Coffee",
    hosts: ["buymeacoffee.com", "www.buymeacoffee.com"],
    path: /^\/[A-Za-z0-9_-]{1,64}\/?$/,
  },
];

/**
 * Link shorteners and generic redirect services hide the real destination,
 * which the policy forbids. This list is defence in depth: the explicit
 * per-entry host is the primary control.
 */
export const BLOCKED_AFFILIATE_HOSTS: readonly string[] = [
  "bit.ly",
  "buff.ly",
  "cutt.ly",
  "goo.gl",
  "is.gd",
  "lnkd.in",
  "ow.ly",
  "rb.gy",
  "rebrand.ly",
  "shorturl.at",
  "t.co",
  "tiny.cc",
  "tinyurl.com",
];

const FIRST_PARTY_HOST = "privateimagetotext.com";

/**
 * Route types whose shared footer may show the support link. Tool routes,
 * the not-found page and any unknown type are excluded (fail closed), so no
 * funding component mounts anywhere on a tool route.
 */
const SUPPORT_FOOTER_ROUTE_TYPES: readonly string[] = ["content", "guide-index", "guide"];

export function footerMayShowSupport(routeType: string | undefined): boolean {
  return typeof routeType === "string" && SUPPORT_FOOTER_ROUTE_TYPES.includes(routeType);
}

// Lower-case DNS name with at least one dot; no ports, IPs, wildcards or
// trailing dots.
const DNS_HOST =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const AFFILIATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_COPY_LENGTH = 240;

function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  // Reject whitespace and control characters before the URL parser can
  // normalise them away.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  // The parsed form must be the literal form, so what reviewers read in the
  // configuration is exactly what visitors follow: no dot segments,
  // backslashes, unencoded characters or other normalised spellings.
  if (url.href !== value && url.href !== `${value}/`) return null;
  return url;
}

function isPlainCopy(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_COPY_LENGTH &&
    value === value.trim() &&
    !/[<>]/.test(value)
  );
}

/** Returns the support link to render, or `null` when it must not render. */
export function resolveSupportLink(
  config: SupportConfig | undefined,
): ResolvedSupportLink | null {
  if (!config) return null;
  const url = parseHttpsUrl(config.url);
  // Also reject a bare "?" or "#", which the URL parser reports as empty.
  if (!url || config.url.includes("?") || config.url.includes("#")) return null;
  const platform = SUPPORT_PLATFORMS.find((rule) =>
    rule.hosts.includes(url.hostname),
  );
  if (!platform || !platform.path.test(url.pathname)) return null;
  return { platform: platform.id, platformName: platform.name, href: url.href };
}

/** Returns a renderable affiliate link, or `null` when it must not render. */
export function resolveAffiliateEntry(
  entry: AffiliateEntry | undefined,
): ResolvedAffiliateLink | null {
  if (!entry) return null;
  if (typeof entry.id !== "string" || !AFFILIATE_ID.test(entry.id)) return null;
  if (![entry.partner, entry.product, entry.description].every(isPlainCopy)) {
    return null;
  }
  if (typeof entry.host !== "string" || !DNS_HOST.test(entry.host)) return null;
  if (
    entry.host === FIRST_PARTY_HOST ||
    entry.host.endsWith(`.${FIRST_PARTY_HOST}`) ||
    BLOCKED_AFFILIATE_HOSTS.some(
      (blocked) => entry.host === blocked || entry.host.endsWith(`.${blocked}`),
    )
  ) {
    return null;
  }
  const url = parseHttpsUrl(entry.url);
  if (!url || url.hostname !== entry.host) return null;
  return {
    id: entry.id,
    partner: entry.partner,
    product: entry.product,
    description: entry.description,
    href: url.href,
  };
}

/**
 * Validates the whole registry. Duplicate ids invalidate every entry with
 * that id, so an ambiguous reference never picks one silently.
 */
export function resolveAffiliateRegistry(
  registry: readonly AffiliateEntry[] | undefined,
): ReadonlyMap<string, ResolvedAffiliateLink> {
  const resolved = new Map<string, ResolvedAffiliateLink>();
  if (!Array.isArray(registry)) return resolved;
  const counts = new Map<string, number>();
  for (const entry of registry) {
    counts.set(entry?.id, (counts.get(entry?.id) ?? 0) + 1);
  }
  for (const entry of registry) {
    if (counts.get(entry?.id) !== 1) continue;
    const link = resolveAffiliateEntry(entry);
    if (link) resolved.set(link.id, link);
  }
  return resolved;
}

/** Resolves a guide's references in order, dropping unknown or invalid ids. */
export function resolveAffiliateIds(
  ids: readonly string[] | undefined,
  registry: readonly AffiliateEntry[] | undefined,
): readonly ResolvedAffiliateLink[] {
  if (!ids?.length) return [];
  const resolved = resolveAffiliateRegistry(registry);
  const seen = new Set<string>();
  const links: ResolvedAffiliateLink[] = [];
  for (const id of ids) {
    const link = resolved.get(id);
    if (!link || seen.has(id)) continue;
    seen.add(id);
    links.push(link);
  }
  return links;
}
