import {
  localProcessingStatuses,
  type LocalProcessingStatus,
  type LocalProcessingStatusDefinition,
} from "../config/product";

export type LocalProcessingBadgeProps = {
  readonly status: LocalProcessingStatus;
  readonly compact?: boolean;
  readonly definition?: LocalProcessingStatusDefinition;
};

export function LocalProcessingBadge({
  status,
  compact = false,
  definition: override,
}: LocalProcessingBadgeProps) {
  const definition = override ?? localProcessingStatuses[status];

  return (
    <span
      className={`local-processing-badge local-processing-badge--${status}${
        compact ? " local-processing-badge--compact" : ""
      }`}
      title={definition.description}
      data-status={status}
    >
      <span className="local-processing-badge__mark" aria-hidden="true" />
      <span className="local-processing-badge__label">{definition.label}</span>
    </span>
  );
}
