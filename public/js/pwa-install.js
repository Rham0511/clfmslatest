(() => {
  if (window.__comlabPwaInitialized) return;
  window.__comlabPwaInitialized = true;

  const DISMISS_KEY = 'comlab-pwa-install-dismissed-until';
  const OPEN_APP_SESSION_KEY = 'comlab-pwa-open-app-prompt-shown';
  const OPEN_APP_ATTEMPT_KEY = 'comlab-pwa-open-app-attempt';
  const DISMISS_DAYS = 7;
  let deferredInstallPrompt = null;
  let updateRegistration = null;
  let installBanner;
  let installHelp;
  let updateNotice;
  let openAppPrompt;

  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isMobileDevice = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(max-width: 1100px)').matches)
    || (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 900px)').matches);

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone === true;

  const readDismissedUntil = () => {
    try { return Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { return 0; }
  };

  const markInstallOfferDismissed = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000)); } catch { /* storage may be unavailable */ }
  };

  const hideInstallBanner = () => {
    if (installBanner) installBanner.hidden = true;
  };

  const closeInstallHelp = () => {
    if (installHelp) installHelp.hidden = true;
  };

  const closeOpenAppPrompt = () => {
    if (openAppPrompt) openAppPrompt.hidden = true;
  };

  const showOpenAppPrompt = (force = false) => {
    if (!openAppPrompt || !isMobileDevice() || isStandalone()) return;
    try {
      if (!force && sessionStorage.getItem(OPEN_APP_SESSION_KEY) === '1') return;
      sessionStorage.setItem(OPEN_APP_SESSION_KEY, '1');
    } catch { /* show the prompt for this page if storage is unavailable */ }
    openAppPrompt.hidden = false;
  };

  const checkForInstalledApp = async () => {
    if (!isMobileDevice() || isStandalone() || typeof navigator.getInstalledRelatedApps !== 'function') return false;
    try {
      const apps = await navigator.getInstalledRelatedApps();
      return apps.some((app) => app.platform === 'webapp');
    } catch {
      return false;
    }
  };

  const showInstallHelp = () => {
    if (!installHelp) return;
    const message = installHelp.querySelector('[data-install-help-message]');
    if (message) {
      message.textContent = isIos()
        ? 'Sa Safari, i-tap ang Share button, pagkatapos piliin ang “Add to Home Screen.” Sa iOS 16.4 pataas, maaari ring gamitin ang Share menu ng ibang browser.'
        : 'Buksan ang menu ng browser (⋮), pagkatapos piliin ang “Install app” o “Add to Home Screen.” Kung wala ang option, subukan sa Chrome o Samsung Internet.';
    }
    installHelp.hidden = false;
    installHelp.querySelector('button')?.focus();
  };

  const showInstallBanner = () => {
    if (!installBanner || !isMobileDevice() || isStandalone() || readDismissedUntil() > Date.now()) return;
    installBanner.hidden = false;
  };

  const showUpdateNotice = () => {
    if (!updateNotice) return;
    hideInstallBanner();
    updateNotice.hidden = false;
  };

  const setupInstallUi = () => {
    if (!document.body) return;

    installBanner = document.createElement('aside');
    installBanner.id = 'comlabInstallBanner';
    installBanner.setAttribute('aria-label', 'Install ComLab app');
    installBanner.hidden = true;
    installBanner.innerHTML = '<img src="/images/comlab-app-192.png" alt=""><div class="comlab-install-copy"><strong class="comlab-install-title">Install ComLab</strong><p class="comlab-install-description">Add the lab system to your home screen for quick access.</p></div><button id="comlabInstallButton" type="button">Install</button><button class="comlab-install-close" type="button" aria-label="Dismiss install suggestion">×</button>';

    installHelp = document.createElement('section');
    installHelp.id = 'comlabInstallHelp';
    installHelp.setAttribute('role', 'dialog');
    installHelp.setAttribute('aria-modal', 'true');
    installHelp.setAttribute('aria-labelledby', 'comlabInstallHelpTitle');
    installHelp.hidden = true;
    installHelp.innerHTML = '<div class="comlab-install-help-card"><h2 id="comlabInstallHelpTitle">Add ComLab to your home screen</h2><p data-install-help-message></p><div class="comlab-install-help-actions"><button type="button">Got it</button></div></div>';

    updateNotice = document.createElement('aside');
    updateNotice.id = 'comlabUpdateNotice';
    updateNotice.setAttribute('aria-label', 'ComLab update available');
    updateNotice.hidden = true;
    updateNotice.innerHTML = '<p>A new ComLab update is ready.</p><button id="comlabUpdateButton" type="button">Reload app</button>';

    openAppPrompt = document.createElement('section');
    openAppPrompt.id = 'comlabOpenAppPrompt';
    openAppPrompt.setAttribute('role', 'dialog');
    openAppPrompt.setAttribute('aria-modal', 'true');
    openAppPrompt.setAttribute('aria-labelledby', 'comlabOpenAppTitle');
    openAppPrompt.hidden = true;
    openAppPrompt.innerHTML = '<div class="comlab-open-app-card"><img src="/images/comlab-app-192.png" alt=""><h2 id="comlabOpenAppTitle">ComLab is installed</h2><p id="comlabOpenAppMessage">Open this page in the ComLab app, or keep using it in your browser.</p><div class="comlab-open-app-actions"><button id="comlabContinueBrowser" class="comlab-open-app-secondary" type="button">Continue in browser</button><button id="comlabOpenInstalledApp" class="comlab-open-app-primary" type="button">Open ComLab app</button></div></div>';

    document.body.append(installBanner, installHelp, updateNotice, openAppPrompt);

    installBanner.querySelector('.comlab-install-close')?.addEventListener('click', () => {
      markInstallOfferDismissed();
      hideInstallBanner();
    });
    installBanner.querySelector('#comlabInstallButton')?.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showInstallHelp();
        return;
      }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice?.outcome === 'accepted') markInstallOfferDismissed();
      } catch (error) {
        console.warn('[PWA] Install prompt could not be opened:', error);
      }
      hideInstallBanner();
    });
    installHelp.addEventListener('click', (event) => {
      if (event.target === installHelp || event.target.closest('button')) closeInstallHelp();
    });
    openAppPrompt.querySelector('#comlabContinueBrowser')?.addEventListener('click', closeOpenAppPrompt);
    openAppPrompt.addEventListener('click', (event) => {
      if (event.target === openAppPrompt) closeOpenAppPrompt();
    });
    openAppPrompt.querySelector('#comlabOpenInstalledApp')?.addEventListener('click', () => {
      try {
        sessionStorage.setItem(OPEN_APP_SESSION_KEY, '1');
        sessionStorage.setItem(OPEN_APP_ATTEMPT_KEY, '1');
      } catch { /* continue with the app launch attempt */ }
      const target = new URL(window.location.href);
      target.searchParams.set('comlab_open_app', '1');
      window.location.assign(target.href);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeInstallHelp();
      if (event.key === 'Escape') closeOpenAppPrompt();
    });
    updateNotice.querySelector('#comlabUpdateButton')?.addEventListener('click', () => window.location.reload());

    if (isMobileDevice() && !isStandalone()) {
      window.setTimeout(showInstallBanner, 3500);
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installBanner && !isStandalone()) showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    markInstallOfferDismissed();
    hideInstallBanner();
    closeInstallHelp();
    deferredInstallPrompt = null;
    showOpenAppPrompt(true);
  });

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        updateRegistration = registration;
        const watchWorker = (worker) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && hadController) showUpdateNotice();
          });
        };
        if (registration.waiting && hadController) showUpdateNotice();
        registration.addEventListener('updatefound', () => watchWorker(registration.installing));
        if (navigator.onLine) registration.update().catch(() => undefined);
      })
      .catch((error) => console.warn('[PWA] Service worker registration failed:', error));
  };

  window.addEventListener('online', () => {
    if (updateRegistration) updateRegistration.update().catch(() => undefined);
  });

  const initialize = () => {
    const currentUrl = new URL(window.location.href);
    const appLaunchRequested = currentUrl.searchParams.has('comlab_open_app');
    if (appLaunchRequested) {
      currentUrl.searchParams.delete('comlab_open_app');
      window.history.replaceState(window.history.state, '', currentUrl.href);
    }
    setupInstallUi();
    registerServiceWorker();
    if (isStandalone()) {
      try { sessionStorage.removeItem(OPEN_APP_ATTEMPT_KEY); } catch { /* ignore unavailable storage */ }
    } else if (appLaunchRequested) {
      window.setTimeout(() => {
        let attempted = false;
        try {
          attempted = sessionStorage.getItem(OPEN_APP_ATTEMPT_KEY) === '1';
          sessionStorage.removeItem(OPEN_APP_ATTEMPT_KEY);
        } catch { /* no fallback state when session storage is unavailable */ }
        if (!attempted || isStandalone() || !openAppPrompt) return;
        const title = openAppPrompt.querySelector('#comlabOpenAppTitle');
        const message = openAppPrompt.querySelector('#comlabOpenAppMessage');
        const continueButton = openAppPrompt.querySelector('#comlabContinueBrowser');
        const launchButton = openAppPrompt.querySelector('#comlabOpenInstalledApp');
        if (title) title.textContent = 'Open ComLab from your home screen';
        if (message) message.textContent = 'Your browser kept this page in a browser tab. Tap the ComLab icon on your home screen to open the installed app, or continue here.';
        if (continueButton) continueButton.textContent = 'Continue here';
        if (launchButton) launchButton.hidden = true;
        openAppPrompt.hidden = false;
      }, 900);
    }
    window.setTimeout(async () => {
      if (await checkForInstalledApp()) showOpenAppPrompt();
    }, 1000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
