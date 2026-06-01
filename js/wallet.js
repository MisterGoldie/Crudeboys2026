(function () {
  'use strict';

  const STORAGE_KEY = 'crudeboys_wallet';
  const MYDOGE_INSTALL_URL = 'https://www.mydoge.com/';
  const SPOOKY_INSTALL_URL =
    'https://chromewebstore.google.com/detail/spooky-doge/llefaokflckonkllgdflmboibglnbbac';

  const connectBtn = document.getElementById('walletConnectBtn');
  if (!connectBtn) return;

  // MyDoge injects window.doge after firing 'doge#initialized'.
  let myDoge = window.doge && window.doge.isMyDoge ? window.doge : null;
  window.addEventListener(
    'doge#initialized',
    () => {
      if (window.doge && window.doge.isMyDoge) myDoge = window.doge;
      restoreSession();
    },
    { once: true }
  );

  // Spooky Doge (and other Unisat-compatible doge wallets) inject window.dogecoin.
  function getSpooky() {
    return window.dogecoin || window.spooky || null;
  }

  // ---- UI helpers ----------------------------------------------------------
  function truncate(addr) {
    return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
  }

  function showConnected(type, address) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, address }));
    connectBtn.textContent = truncate(address);
    connectBtn.title = address;
    connectBtn.classList.add('connected');
  }

  function showDisconnected() {
    localStorage.removeItem(STORAGE_KEY);
    connectBtn.textContent = 'Connect Wallet';
    connectBtn.title = '';
    connectBtn.classList.remove('connected');
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  // ---- Connect flows -------------------------------------------------------
  async function connectMyDoge() {
    const dg = myDoge || (window.doge && window.doge.isMyDoge ? window.doge : null);
    if (!dg) {
      window.open(MYDOGE_INSTALL_URL, '_blank', 'noopener');
      throw new Error('MyDoge wallet is not installed.');
    }
    const res = await dg.connect();
    if (res && res.approved && res.address) {
      showConnected('mydoge', res.address);
      return res.address;
    }
    throw new Error('MyDoge connection was not approved.');
  }

  async function connectSpooky() {
    const sp = getSpooky();
    if (!sp) {
      window.open(SPOOKY_INSTALL_URL, '_blank', 'noopener');
      throw new Error('Spooky Doge wallet is not installed.');
    }

    let accounts;
    if (typeof sp.requestAccounts === 'function') {
      accounts = await sp.requestAccounts();
    } else if (typeof sp.enable === 'function') {
      accounts = await sp.enable();
    } else if (typeof sp.connect === 'function') {
      const r = await sp.connect();
      accounts = r && r.address ? [r.address] : r;
    } else {
      throw new Error('Spooky Doge connect method not found.');
    }

    const address = Array.isArray(accounts) ? accounts[0] : accounts;
    if (address) {
      // Keep button in sync if the user switches accounts in the wallet.
      if (typeof sp.on === 'function') {
        sp.on('accountsChanged', (accs) => {
          const next = Array.isArray(accs) ? accs[0] : accs;
          if (next) showConnected('spooky', next);
          else showDisconnected();
        });
      }
      showConnected('spooky', address);
      return address;
    }
    throw new Error('Spooky Doge returned no account.');
  }

  async function disconnect() {
    const session = getSession();
    try {
      if (session && session.type === 'mydoge' && myDoge && myDoge.disconnect) {
        await myDoge.disconnect();
      }
      const sp = getSpooky();
      if (session && session.type === 'spooky' && sp && typeof sp.disconnect === 'function') {
        await sp.disconnect();
      }
    } catch (e) {
      /* ignore – we still clear local state below */
    }
    showDisconnected();
  }

  // ---- Restore a previous session on reload --------------------------------
  async function restoreSession() {
    const session = getSession();
    if (!session) return;

    try {
      if (session.type === 'mydoge') {
        const dg = myDoge || (window.doge && window.doge.isMyDoge ? window.doge : null);
        if (dg && dg.getConnectionStatus) {
          const status = await dg.getConnectionStatus();
          if (status && status.connected && status.address) {
            showConnected('mydoge', status.address);
            return;
          }
        }
      } else if (session.type === 'spooky') {
        const sp = getSpooky();
        if (sp && typeof sp.getAccounts === 'function') {
          const accs = await sp.getAccounts();
          const address = Array.isArray(accs) ? accs[0] : accs;
          if (address) {
            showConnected('spooky', address);
            return;
          }
        }
      }
    } catch (e) {
      /* fall through to disconnect */
    }
    showDisconnected();
  }

  // ---- Wallet chooser modal ------------------------------------------------
  function openModal() {
    const session = getSession();
    const modal = document.createElement('div');
    modal.className = 'wallet-modal';

    if (session && session.address) {
      modal.innerHTML = `
        <div class="wallet-modal-content">
          <h3>Wallet Connected</h3>
          <p class="wallet-address">${session.address}</p>
          <button class="wallet-option wallet-disconnect" type="button">Disconnect</button>
          <button class="wallet-close" type="button">Close</button>
        </div>
      `;
    } else {
      modal.innerHTML = `
        <div class="wallet-modal-content">
          <h3>Connect a wallet</h3>
          <button class="wallet-option" data-wallet="mydoge" type="button">MyDoge</button>
          <button class="wallet-option" data-wallet="spooky" type="button">Spooky Doge</button>
          <p class="wallet-error" style="display:none;"></p>
          <button class="wallet-close" type="button">Close</button>
        </div>
      `;
    }

    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    modal.querySelector('.wallet-close').onclick = close;

    const disconnectBtn = modal.querySelector('.wallet-disconnect');
    if (disconnectBtn) {
      disconnectBtn.onclick = async () => {
        await disconnect();
        close();
      };
    }

    const errorEl = modal.querySelector('.wallet-error');
    modal.querySelectorAll('.wallet-option[data-wallet]').forEach((btn) => {
      btn.onclick = async () => {
        const wallet = btn.getAttribute('data-wallet');
        btn.disabled = true;
        if (errorEl) errorEl.style.display = 'none';
        try {
          if (wallet === 'mydoge') await connectMyDoge();
          else await connectSpooky();
          close();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message || 'Could not connect.';
            errorEl.style.display = 'block';
          }
          btn.disabled = false;
        }
      };
    });
  }

  connectBtn.addEventListener('click', openModal);

  // Attempt restore immediately (covers Spooky / already-injected MyDoge).
  restoreSession();
})();
