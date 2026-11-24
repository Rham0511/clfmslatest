(() => {
  const styles = `
    #app-dialog-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;box-sizing:border-box;padding:24px;background:rgba(2,18,11,.48);backdrop-filter:blur(8px) saturate(1.08);-webkit-backdrop-filter:blur(8px) saturate(1.08)}
    #app-dialog{box-sizing:border-box;width:min(100%,440px);overflow:hidden;border:1px solid rgba(110,231,183,.22);border-radius:20px;background:#0b2b1e!important;background-image:linear-gradient(160deg,#103d2b,#0b2b1e)!important;color:#f0fdf4;opacity:1!important;box-shadow:0 24px 64px rgba(0,0,0,.36),0 0 0 1px rgba(110,231,183,.04);font:inherit;animation:app-dialog-enter .18s ease-out both}
    #app-dialog-header{display:flex;align-items:center;gap:14px;padding:22px 24px 16px}
    #app-dialog-icon{display:grid;width:44px;height:44px;flex:0 0 44px;place-items:center;border:1px solid rgba(110,231,183,.2);border-radius:14px;background:rgba(16,163,106,.16);color:#6ee7b7;font-size:1.1rem}
    #app-dialog-eyebrow{margin:0 0 3px;color:#6ee7b7;font-size:.65rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
    #app-dialog-title{margin:0;color:#f0fdf4;font-size:1.08rem;font-weight:750;line-height:1.3}
    #app-dialog-content{padding:0 24px 22px;color:#cbded2;font-size:.93rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
    #app-dialog-input{display:block;box-sizing:border-box;width:calc(100% - 48px);min-height:96px;margin:0 24px 20px;padding:11px 13px;border:1px solid rgba(110,231,183,.25);border-radius:12px;background:#092d20;color:#f0fdf4;font:inherit;resize:vertical}
    #app-dialog-input:focus{border-color:#34d399;outline:3px solid rgba(52,211,153,.2);outline-offset:1px}
    #app-dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px 20px;border-top:1px solid rgba(110,231,183,.12);background:rgba(2,18,11,.2)}
    #app-dialog-actions button{box-sizing:border-box;min-width:96px;min-height:42px;padding:9px 16px;border:1px solid #15945d;border-radius:11px;background:#11834f;color:#fff;font:inherit;font-size:.88rem;font-weight:700;cursor:pointer;transition:background-color .16s ease,border-color .16s ease,transform .16s ease}
    #app-dialog-actions button[data-dialog-cancel]{border-color:rgba(167,197,180,.28);background:transparent;color:#d1fae5}
    #app-dialog-actions button:hover{filter:brightness(1.12);transform:translateY(-1px)}
    #app-dialog-actions button:focus-visible{outline:3px solid rgba(110,231,183,.4);outline-offset:2px}
    html.theme-light #app-dialog{border-color:#dce5df;background:#fff!important;background-image:none!important;color:#1e293b;opacity:1!important;box-shadow:0 24px 64px rgba(15,23,42,.2),0 0 0 1px rgba(15,23,42,.03)}
    html.theme-light #app-dialog-icon{border-color:#bbf7d0;background:#ecfdf3;color:#15803d}
    html.theme-light #app-dialog-eyebrow{color:#15803d}
    html.theme-light #app-dialog-title{color:#14231b}
    html.theme-light #app-dialog-content{color:#475569}
    html.theme-light #app-dialog-input{border-color:#cbd5e1;background:#fff;color:#1e293b}
    html.theme-light #app-dialog-actions{border-top-color:#e5e7eb;background:#f8faf9}
    html.theme-light #app-dialog-actions button[data-dialog-cancel]{border-color:#cbd5e1;background:#fff;color:#334155}
    @keyframes app-dialog-enter{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
    @media(max-width:480px){#app-dialog-backdrop{padding:16px}#app-dialog{border-radius:17px}#app-dialog-header{padding:20px 20px 14px}#app-dialog-content{padding:0 20px 20px}#app-dialog-input{width:calc(100% - 40px);margin:0 20px 18px}#app-dialog-actions{padding:14px 20px 18px}}
    @media(prefers-reduced-motion:reduce){#app-dialog{animation:none}#app-dialog-actions button{transition:none}}
  `;

  const show = (mode, message, initialValue = '') => new Promise((resolve, reject) => {
    let parentDialogs = null;
    try {
      if (window.top !== window) parentDialogs = window.top.appDialogs;
    } catch (error) {
      if (error?.name !== 'SecurityError') throw error;
    }
    if (parentDialogs && typeof parentDialogs[mode] === 'function') {
      parentDialogs[mode](message, initialValue).then(resolve, reject);
      return;
    }

    document.getElementById('app-dialog-backdrop')?.remove();
    if (!document.getElementById('app-dialog-styles')) {
      const style = document.createElement('style');
      style.id = 'app-dialog-styles';
      style.textContent = styles;
      document.head.append(style);
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'app-dialog-backdrop';
    const dialogTitle = mode === 'confirm' ? 'Confirm action' : mode === 'prompt' ? 'Enter a response' : 'Notice';
    const dialogIcon = mode === 'confirm' ? 'fa-circle-question' : mode === 'prompt' ? 'fa-pen-to-square' : 'fa-circle-info';
    backdrop.innerHTML = `<section id="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-content">
      <header id="app-dialog-header">
        <span id="app-dialog-icon" aria-hidden="true"><i class="fas ${dialogIcon}"></i></span>
        <div><p id="app-dialog-eyebrow">ComLab</p><h2 id="app-dialog-title">${dialogTitle}</h2></div>
      </header>
      <div id="app-dialog-content"></div>
      ${mode === 'prompt' ? '<textarea id="app-dialog-input" aria-label="Response"></textarea>' : ''}
      <div id="app-dialog-actions">
        ${mode === 'alert' ? '' : '<button type="button" data-dialog-cancel>Cancel</button>'}
        <button type="button" data-dialog-ok>${mode === 'alert' ? 'OK' : mode === 'confirm' ? 'Confirm' : 'Continue'}</button>
      </div>
    </section>`;
    backdrop.querySelector('#app-dialog-content').textContent = String(message ?? '');
    const input = backdrop.querySelector('#app-dialog-input');
    if (input) input.value = initialValue;

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(mode === 'alert' ? undefined : mode === 'confirm' ? false : null);
      } else if (event.key === 'Enter' && !event.shiftKey && event.target !== input) {
        event.preventDefault();
        finish(mode === 'alert' ? undefined : mode === 'confirm' ? true : input.value);
      }
    };
    backdrop.querySelector('[data-dialog-ok]').addEventListener('click', () => {
      finish(mode === 'alert' ? undefined : mode === 'confirm' ? true : input.value);
    });
    backdrop.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => {
      finish(mode === 'confirm' ? false : null);
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && mode !== 'alert') finish(mode === 'confirm' ? false : null);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.append(backdrop);
    (input || backdrop.querySelector('[data-dialog-ok]')).focus();
  });

  const dialogs = {
    alert: (message) => show('alert', message),
    confirm: (message) => show('confirm', message),
    prompt: (message, initialValue = '') => show('prompt', message, initialValue)
  };
  window.appDialogs = dialogs;
  window.alert = (message) => dialogs.alert(message);
})();
