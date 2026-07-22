export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

declare global {
  interface Window {
    __plateInstallPrompt?: BeforeInstallPromptEvent | null;
    __platePwaInstalled?: boolean;
  }
}

export const INSTALL_PROMPT_CAPTURE_SCRIPT = `
(function () {
  if (window.__plateInstallPromptCaptureReady) return;
  window.__plateInstallPromptCaptureReady = true;
  window.__plateInstallPrompt = null;
  window.__platePwaInstalled = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    window.__plateInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('platecheck-beforeinstallprompt'));
  });
  window.addEventListener('appinstalled', function () {
    window.__plateInstallPrompt = null;
    window.__platePwaInstalled = true;
    window.dispatchEvent(new CustomEvent('platecheck-appinstalled'));
  });
})();`;
