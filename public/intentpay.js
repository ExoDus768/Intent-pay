(function () {
  'use strict';

  var script = document.currentScript;
  var defaultBase = script && script.getAttribute('data-base-url')
    ? script.getAttribute('data-base-url')
    : (script && script.src ? new URL(script.src, window.location.href).origin : window.location.origin);
  var baseUrl = String(defaultBase || window.location.origin).replace(/\/$/, '');

  function checkoutUrl(invoiceId) {
    return baseUrl + '/?invoice=' + encodeURIComponent(invoiceId) + '&source=widget';
  }

  function openCheckout(options) {
    options = options || {};
    var invoiceId = String(options.invoiceId || '').trim();
    if (!/^[a-f0-9]{24,64}$/i.test(invoiceId)) {
      throw new Error('IntentPay requires a valid invoice ID.');
    }
    var url = checkoutUrl(invoiceId);
    var popup = window.open(url, options.target || 'intentpay_checkout', 'popup,width=480,height=760,resizable=yes,scrollbars=yes');
    if (!popup) {
      window.location.assign(url);
      return null;
    }
    try { popup.focus(); } catch (_) {}
    return popup;
  }

  function bindButton(button) {
    if (!button || button.dataset.intentpayBound === 'true') return;
    button.dataset.intentpayBound = 'true';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      var invoiceId = button.getAttribute('data-intentpay-invoice');
      if (!invoiceId) {
        button.dispatchEvent(new CustomEvent('intentpay:error', { bubbles: true, detail: { message: 'Add data-intentpay-invoice with an invoice ID.' } }));
        return;
      }
      try {
        var popup = openCheckout({ invoiceId: invoiceId });
        button.dispatchEvent(new CustomEvent('intentpay:open', { bubbles: true, detail: { invoiceId: invoiceId, popup: popup } }));
      } catch (error) {
        button.dispatchEvent(new CustomEvent('intentpay:error', { bubbles: true, detail: { message: error.message } }));
      }
    });
  }

  function scan(root) {
    (root || document).querySelectorAll('[data-intentpay-checkout]').forEach(bindButton);
  }

  window.IntentPay = window.IntentPay || {};
  window.IntentPay.open = openCheckout;
  window.IntentPay.scan = scan;
  window.IntentPay.version = '1.0.0';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(document); });
  } else {
    scan(document);
  }
})();
