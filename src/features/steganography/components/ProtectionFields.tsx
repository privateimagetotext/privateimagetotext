import type { RefObject } from "react";
import type { ProtectionMode } from "../state";

type ProtectionFieldsProps = {
  readonly mode: ProtectionMode;
  readonly password: string;
  readonly confirmation: string;
  readonly showPassword: boolean;
  readonly disabled: boolean;
  readonly passwordRef: RefObject<HTMLInputElement | null>;
  readonly onModeChange: (mode: ProtectionMode) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onConfirmationChange: (value: string) => void;
  readonly onShowPasswordChange: (show: boolean) => void;
};

export function ProtectionFields({
  mode,
  password,
  confirmation,
  showPassword,
  disabled,
  passwordRef,
  onModeChange,
  onPasswordChange,
  onConfirmationChange,
  onShowPasswordChange,
}: ProtectionFieldsProps) {
  return (
    <fieldset className="steg-protection" disabled={disabled}>
      <legend>Protection</legend>
      <label className={mode === "encrypted" ? "is-selected" : ""}>
        <input
          type="radio"
          name="protection-mode"
          checked={mode === "encrypted"}
          onChange={() => onModeChange("encrypted")}
        />
        <span><strong>Password protected — recommended</strong><small>Encrypts the message. Without the password, it cannot be read.</small></span>
      </label>
      <label className={mode === "plain" ? "is-selected" : ""}>
        <input
          type="radio"
          name="protection-mode"
          checked={mode === "plain"}
          onChange={() => onModeChange("plain")}
        />
        <span><strong>No password</strong><small>Hides the message but does not encrypt it. Anyone with a compatible decoder can read it.</small></span>
      </label>

      {mode === "plain" ? (
        <p className="steg-warning steg-warning--danger">
          <strong>No password means no encryption.</strong> Anyone with compatible software can read the hidden message.
        </p>
      ) : (
        <div className="steg-password-grid">
          <label>
            <span>Password</span>
            <input
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              value={password}
              minLength={12}
              maxLength={512}
              autoComplete="new-password"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              aria-describedby="steg-password-help"
              onChange={(event) => onPasswordChange(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Confirm password</span>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmation}
              minLength={12}
              maxLength={512}
              autoComplete="new-password"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => onConfirmationChange(event.currentTarget.value)}
            />
          </label>
          <label className="steg-checkbox">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(event) => onShowPasswordChange(event.currentTarget.checked)}
            />
            Show passwords
          </label>
          <p id="steg-password-help" className="field-help">
            Use between 12 and 256 characters. Spaces count and are kept exactly as you type them. Lost passwords cannot be recovered.
          </p>
        </div>
      )}
    </fieldset>
  );
}
