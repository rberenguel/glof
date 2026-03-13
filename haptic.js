/**
 * Pure JavaScript Haptic Feedback (ES6 Module)
 * MIT Licensed
 *
 * Adapted from the MIT-licensed React hook `use-haptic`.
 * https://github.com/posaune0423/use-haptic
 */

let hapticLabel = null;

const detectiOS = () => {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
};

export function initHaptic() {
  if (hapticLabel || typeof document === "undefined") return;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "es6-haptic-switch";
  input.setAttribute("switch", "");
  input.style.display = "none";
  document.body.appendChild(input);

  const label = document.createElement("label");
  label.htmlFor = "es6-haptic-switch";
  label.style.display = "none";
  document.body.appendChild(label);

  hapticLabel = label;
}

export function triggerHaptic(duration = 5) {
  if (!hapticLabel) {
    console.warn("Haptic feedback not initialized. Call initHaptic() first.");
    return;
  }

  if (detectiOS()) {
    hapticLabel.click();
  } else if (navigator?.vibrate) {
    window?.navigator?.vibrate(duration) || navigator.vibrate(duration);
  } else {
    hapticLabel.click();
  }
}

export function triggerHapticError() {
  if (navigator.vibrate) {
    navigator.vibrate([5, 20, 5]);
  } else {
    triggerHaptic();
    setTimeout(() => triggerHaptic(), 120);
    setTimeout(() => triggerHaptic(), 240);
  }
}
