(function () {
  'use strict';
  var script = document.currentScript;
  var defaultBase = script && script.getAttribute('data-base-url')
    ? script.getAttribute('data-base-url')
    : (script && script.src ? new URL(script.src, window.location.href).origin : window.location.origin);
  var baseUrl = String(defaultBase || window.location.origin).replace(/\/$/, '');

  function checkoutUrl(config) {
    if (config.url) {
      var supplied = new URL(config.url, baseUrl);
      if (supplied.origin !== baseUrl) throw new Error('XoDuspay checkout URL must use the configured XoDuspay host.');
      return supplied.toString();
    }
    var params = new URLSearchParams();
    params.set('merchantAsset', String(config.merchantAsset || ''));
    params.set('merchantRecipient', String(config.merchantRecipient || ''));
    if (config.amount) params.set('merchantAmount', String(config.amount));
    if (config.merchantName) params.set('merchantName', String(config.merchantName));
    if (!config.merchantAsset || !config.merchantRecipient) throw new Error('XoDuspay requires merchantAsset and merchantRecipient.');
    return baseUrl + '/?' + params.toString();
  }
  function openCheckout(options) {
    options = options || {};
    var url = checkoutUrl(options);
    var popup = window.open(url, options.target || 'xoduspay_checkout', 'popup,width=480,height=760,resizable=yes,scrollbars=yes');
    if (!popup) { window.location.assign(url); return null; }
    try { popup.focus(); } catch (_) {}
    return popup;
  }
  function bindButton(button) {
    if (!button || button.dataset.xoduspayBound === 'true') return;
    button.dataset.xoduspayBound = 'true';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      try {
        var url = button.getAttribute('data-xoduspay-url');
        var popup = openCheckout(url ? { url: url } : {
          merchantAsset: button.getAttribute('data-xoduspay-asset'),
          merchantRecipient: button.getAttribute('data-xoduspay-recipient'),
          amount: button.getAttribute('data-xoduspay-amount'),
          merchantName: button.getAttribute('data-xoduspay-name')
        });
        button.dispatchEvent(new CustomEvent('xoduspay:open', { bubbles: true, detail: { url: url || '', popup: popup } }));
      } catch (error) {
        button.dispatchEvent(new CustomEvent('xoduspay:error', { bubbles: true, detail: { message: error.message } }));
      }
    });
  }
  function scan(root) { (root || document).querySelectorAll('[data-xoduspay-checkout]').forEach(bindButton); }
  window.XoDuspay = window.XoDuspay || {};
  window.XoDuspay.open = openCheckout;
  window.XoDuspay.scan = scan;
  window.XoDuspay.version = '2.0.0';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(document); });
  else scan(document);
})();
