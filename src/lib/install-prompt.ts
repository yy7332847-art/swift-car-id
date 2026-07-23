export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

declare global {
  interface Window {
    __plateInstallPromptCaptureReady?: boolean;
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

export const APP_RECOVERY_SCRIPT = `
(function () {
  if (window.__plateRecoveryReady) return;
  window.__plateRecoveryReady = true;
  var KEY = 'platecheck.recovery.reloads';
  function clearAppShellAndReload() {
    var count = Number(sessionStorage.getItem(KEY) || '0');
    if (count > 1) return;
    sessionStorage.setItem(KEY, String(count + 1));
    var jobs = [];
    if ('serviceWorker' in navigator) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.map(function (reg) { return reg.unregister().catch(function () { return false; }); }));
      }).catch(function () {}));
    }
    if ('caches' in window) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (name) { return /^platecheck-|^workbox-/.test(name); }).map(function (name) { return caches.delete(name); }));
      }).catch(function () {}));
    }
    Promise.all(jobs).finally(function () { window.location.reload(); });
  }
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    var tag = target && target.tagName;
    if (tag === 'SCRIPT' || tag === 'LINK') clearAppShellAndReload();
  }, true);
  setTimeout(function () {
    var text = (document.body && document.body.innerText || '').trim();
    if (text.length < 2 && !document.querySelector('[data-plate-app-ready="true"]')) clearAppShellAndReload();
  }, 7000);
})();`;
