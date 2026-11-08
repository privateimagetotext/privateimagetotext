import type { SteganographyWorkflow } from "../state";

type WorkflowSelectorProps = {
  readonly workflow: SteganographyWorkflow;
  readonly disabled?: boolean;
  readonly onChange: (workflow: SteganographyWorkflow) => void;
};

export function WorkflowSelector({
  workflow,
  disabled = false,
  onChange,
}: WorkflowSelectorProps) {
  return (
    <fieldset className="steg-workflow" disabled={disabled}>
      <legend className="sr-only">Choose what you want to do</legend>
      <label className={workflow === "hide" ? "is-selected" : ""}>
        <input
          type="radio"
          name="steganography-workflow"
          value="hide"
          checked={workflow === "hide"}
          onChange={() => onChange("hide")}
        />
        <span>
          <strong>Hide a message</strong>
          <small>Create a new image that contains your message.</small>
        </span>
      </label>
      <label className={workflow === "reveal" ? "is-selected" : ""}>
        <input
          type="radio"
          name="steganography-workflow"
          value="reveal"
          checked={workflow === "reveal"}
          onChange={() => onChange("reveal")}
        />
        <span>
          <strong>Reveal a message</strong>
          <small>Read a message from an image created with this tool or compatible software.</small>
        </span>
      </label>
    </fieldset>
  );
}
