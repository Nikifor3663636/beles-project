(() => {
  'use strict';
  const consentKey = 'beles-google-consent';
  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (value) => {
    try {
      localStorage.setItem(consentKey, value);
    } catch {}
  };
  const blocked = () => navigator.doNotTrack === '1' || read('beles-analytics-off') === '1';
  if (blocked()) return;

  fetch('/api/public-integrations')
    .then((response) => response.json())
    .then((config) => {
      const id = config.gaMeasurementId;
      if (!/^G-[A-Z0-9]{4,20}$/.test(id || '') || blocked()) return;
      const catalog = window.__BELES_CMS_PAYLOAD__ || [];
      let accepted = read(consentKey) === 'yes',
        loaded = false;
      const denied = {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      };

      function start() {
        if (loaded || !accepted || blocked()) return;
        window.dataLayer = window.dataLayer || [];
        window.gtag =
          window.gtag ||
          function () {
            window.dataLayer.push(arguments);
          };
        window['ga-disable-' + id] = false;
        window.gtag('consent', 'default', denied);
        window.gtag('consent', 'update', { ...denied, analytics_storage: 'granted' });
        window.gtag('js', new Date());
        let referrer = '';
        try {
          if (document.referrer) referrer = new URL(document.referrer).origin;
        } catch {}
        window.gtag('config', id, {
          send_page_view: true,
          page_location: location.origin + location.pathname,
          page_referrer: referrer,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        });
        const tag = document.createElement('script');
        tag.async = true;
        tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
        document.head.append(tag);
        loaded = true;
      }
      function stop() {
        if (!loaded) return;
        window['ga-disable-' + id] = true;
        window.gtag('consent', 'update', denied);
        location.reload();
      }

      const box = document.createElement('aside');
      box.className = 'beles-google-consent';
      box.setAttribute('aria-label', 'Google Analytics: згода');
      Object.assign(box.style, {
        position: 'fixed',
        bottom: '18px',
        left: '18px',
        right: '18px',
        maxWidth: '500px',
        padding: '20px',
        background: '#fff',
        color: '#192428',
        border: '1px solid #d9e4df',
        borderRadius: '16px',
        boxShadow: '0 8px 40px #0002',
        zIndex: '99999',
        font: '14px/1.5 system-ui',
      });
      const text = document.createElement('p'),
        privacy = document.createElement('a'),
        yes = document.createElement('button'),
        no = document.createElement('button');
      privacy.href = 'https://policies.google.com/privacy';
      privacy.target = '_blank';
      privacy.rel = 'noopener noreferrer';
      privacy.style.display = 'block';
      for (const button of [yes, no]) {
        button.type = 'button';
        Object.assign(button.style, {
          padding: '8px 15px',
          margin: '10px 8px 0 0',
          border: '1px solid #bdc9c2',
          borderRadius: '8px',
          cursor: 'pointer',
          background: '#f3f7f4',
          color: '#192428',
        });
      }
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.className = 'analytics-preference';
      function language() {
        const en = document.documentElement.lang === 'en';
        text.textContent = en
          ? 'Allow Google Analytics to measure visits and catalog interactions? We do not send the contents of contact forms. You can change your choice in the footer.'
          : 'Дозволити Google Analytics аналізувати відвідування та перегляди каталогу? Вміст контактних форм не передаємо. Змінити вибір можна у футері.';
        privacy.textContent = en ? 'Google privacy policy' : 'Конфіденційність Google';
        yes.textContent = en ? 'Allow' : 'Дозволити';
        no.textContent = en ? 'Decline' : 'Відхилити';
        settings.textContent = en ? 'Google Analytics: settings' : 'Google Analytics: налаштування';
      }
      language();
      document.addEventListener('beles:languagechange', language);
      box.append(text, privacy, yes, no);
      document.body.append(box);
      (document.querySelector('footer') || document.body).append(settings);
      box.hidden = read(consentKey) !== null;
      settings.onclick = () => {
        box.hidden = false;
      };
      yes.onclick = () => {
        accepted = true;
        store('yes');
        box.hidden = true;
        start();
      };
      no.onclick = () => {
        accepted = false;
        store('no');
        box.hidden = true;
        stop();
      };

      document.addEventListener('beles:tracked-action', (event) => {
        if (!loaded || !accepted || blocked()) return;
        const { type, key } = event.detail || {};
        const send = (name, parameters) =>
          window.gtag('event', name, { send_to: id, ...parameters });
        if (type === 'product') {
          const product = catalog.find((row) => row.kind === 'product' && row.itemKey === key);
          if (product)
            send('view_item', {
              items: [
                {
                  item_id: product.itemKey,
                  item_name: product.name,
                  item_brand: product.brand || '',
                },
              ],
            });
        } else if (type === 'brand') {
          const brand = catalog.find((row) => row.kind === 'brand' && row.itemKey === key);
          if (brand) send('view_brand', { brand_id: brand.itemKey, brand_name: brand.name });
        } else if (type === 'pdf') {
          const pdf = catalog.find((row) => row.kind === 'presentation' && row.itemKey === key);
          if (pdf)
            send('catalog_pdf_download', {
              catalog_id: pdf.itemKey,
              file_name: pdf.name,
              file_extension: 'pdf',
            });
        } else if (
          type === 'contact' &&
          ['phone', 'email', 'telegram', 'instagram'].includes(key)
        ) {
          send('contact_click', { contact_method: key });
        } else if (
          type === 'contact' &&
          [
            'cooperation_assortment',
            'cooperation_delivery',
            'cooperation_first_order',
            'cooperation_product_request',
            'cooperation_availability',
            'cooperation_cooperation',
          ].includes(key)
        ) {
          send('cooperation_cta', { topic: key.slice(12) });
        } else if (type === 'feedback') send('generate_lead', { lead_source: 'contact_form' });
      });
      addEventListener('storage', (event) => {
        if ([consentKey, 'beles-analytics-off'].includes(event.key)) {
          if (loaded && (blocked() || read(consentKey) !== 'yes'))
            window['ga-disable-' + id] = true;
          location.reload();
        }
      });
      start();
    })
    .catch(() => {});
})();
