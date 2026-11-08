import {
  productConfig,
  type MonetisationConfig,
} from "../config/product";

export type MonetisationSlotProps = {
  readonly placement: "guide";
};

export function MonetisationSlot({
  placement,
}: MonetisationSlotProps) {
  const config: MonetisationConfig = productConfig.monetisation;

  if (
    placement !== "guide" ||
    config.mode !== "sponsor" ||
    !config.sponsor.name ||
    !config.sponsor.copy ||
    !config.sponsor.url ||
    !config.sponsor.disclosure
  ) {
    return null;
  }

  return (
    <aside className="monetisation-slot" aria-label="Sponsor">
      <p className="monetisation-slot__disclosure">
        {config.sponsor.disclosure}
      </p>
      {config.sponsor.logoAsset ? (
        <img
          src={config.sponsor.logoAsset}
          alt=""
          className="monetisation-slot__logo"
        />
      ) : null}
      <div>
        <h2>{config.sponsor.name}</h2>
        <p>{config.sponsor.copy}</p>
      </div>
      <a
        href={config.sponsor.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
      >
        Visit sponsor
      </a>
    </aside>
  );
}
