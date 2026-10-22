'use strict';
window.BelesGalleryEditor = (initial, options) => {
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  let images = Array.isArray(initial) ? [...initial] : [];
  const box = make('div');
  box.className = 'wide galleryEditor';
  const value = make('input');
  value.type = 'hidden';
  value.name = 'images';
  const list = make('div');
  list.className = 'galleryEditorList';
  const fileLabel = make('label', 'Додати кілька фото');
  const files = make('input');
  files.type = 'file';
  files.multiple = true;
  files.accept = '.png,.jpg,.jpeg,.webp,.gif,.avif';
  fileLabel.append(files);
  const urlLabel = make('label', 'Або посилання на фото');
  const url = make('input');
  url.type = 'url';
  url.placeholder = 'https://…';
  urlLabel.append(url);
  const add = make('button', 'Додати фото за посиланням');
  add.type = 'button';
  const update = (changed = true) => {
    value.value = JSON.stringify(images);
    list.replaceChildren();
    images.forEach((src, index) => {
      const card = make('div');
      card.className = 'galleryEditorItem';
      const photo = make('img');
      photo.src = src;
      photo.alt = 'Додаткове фото ' + (index + 1);
      card.append(photo, make('span', String(index + 1)));
      for (const [label, delta] of [
        ['Раніше', -1],
        ['Пізніше', 1],
        ['Прибрати', 0],
      ]) {
        const button = make('button', label);
        button.type = 'button';
        button.setAttribute('aria-label', label + ' фото ' + (index + 1));
        button.disabled = delta !== 0 && (index + delta < 0 || index + delta >= images.length);
        button.onclick = () => {
          if (delta)
            [images[index], images[index + delta]] = [images[index + delta], images[index]];
          else images.splice(index, 1);
          update();
          list.querySelectorAll('button')[Math.min(index, images.length - 1) * 3]?.focus();
        };
        card.append(button);
      }
      list.append(card);
    });
    if (changed) options.changed();
  };
  add.onclick = () => {
    try {
      const parsed = new URL(url.value.trim());
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
        throw Error('Вкажіть посилання http:// або https://');
      if (images.length >= 20) throw Error('Максимум 20 додаткових фото');
      if (!images.includes(parsed.href)) images.push(parsed.href);
      url.value = '';
      update();
    } catch (error) {
      options.note(error.message);
    }
  };
  files.onchange = async () => {
    const selected = [...files.files];
    if (!selected.length) return;
    if (selected.length + images.length > 20) return options.note('Максимум 20 додаткових фото');
    if (selected.some((file) => file.size > 20 * 1024 * 1024))
      return options.note('Максимум 20 МБ на одне фото');
    try {
      options.busy(true);
      files.disabled = add.disabled = true;
      for (const [index, file] of selected.entries()) {
        options.note('Завантаження фото ' + (index + 1) + ' / ' + selected.length);
        const response = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'X-CSRF-Token': options.csrf,
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Помилка завантаження');
        if (!images.includes(result.url)) images.push(result.url);
        update();
      }
      options.note('Фото завантажено. Збережіть зміни.');
    } catch (error) {
      options.note(error.message);
    } finally {
      options.busy(false);
      files.disabled = add.disabled = false;
      files.value = '';
    }
  };
  box.append(
    make('strong', 'Галерея у «Докладніше»'),
    make(
      'p',
      'Головне фото показується першим. Додайте до 20 інших фото та налаштуйте їхній порядок.',
    ),
    value,
    list,
    fileLabel,
    urlLabel,
    add,
  );
  update(false);
  return box;
};
