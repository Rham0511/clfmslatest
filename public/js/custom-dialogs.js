(() => {
  const styles = `
    #app-dialog-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(2,18,11,.72);backdrop-filter:blur(4px)}
    #app-dialog{width:min(100%,420px);border:1px solid rgba(4,106,56,.9);border-radius:16px;background:#103d2b;color:#f0fdf4;box-shadow:0 24px 80px rgba(0,0,0,.45);font:inherit}
    #app-dialog-content{padding:22px 22px 16px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}
    #app-dialog-input{display:block;width:100%;min-height:42px;margin-top:14px;padding:10px 12px;border:1px solid rgba(110,231,183,.45);border-radius:9px;background:#092d20;color:#fff;font:inherit;resize:vertical}
    #app-dialog-input:focus{outline:2px solid #34d399;outline-offset:2px}
    #app-dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 22px 18px}
    #app-dialog-actions button{min-width:82px;padding:9px 15px;border:1px solid #046a38;border-radius:9px;background:#046a38;color:#fff;font:inherit;font-weight:650;cursor:pointer}
    #app-dialog-actions button[data-dialog-cancel]{background:transparent;border-color:rgba(110,231,183,.4);color:#d1fae5}
    #app-dialog-actions button:hover{filter:brightness(1.12)}
  `;

  const show = (mode, message, initialValue = '') => new Promise((resolve) => {
    document.getElementById('app-dialog-backdrop')?.remove();
    if (!document.getElementById('app-dialog-styles')) {
      const style = document.createElement('style');
      style.id = 'app-dialog-styles';
      style.textContent = styles;
      document.head.append(style);
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'app-dialog-backdrop';
    backdrop.innerHTML = `<section id="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-content">
      <div id="app-dialog-content"></div>
      ${mode === 'prompt' ? '<textarea id="app-dialog-input" aria-label="Response"></textarea>' : ''}
      <div id="app-dialog-actions">
        ${mode === 'alert' ? '' : '<button type="button" data-dialog-cancel>Cancel</button>'}
        <button type="button" data-dialog-ok>${mode === 'alert' ? 'OK' : 'Continue'}</button>
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
