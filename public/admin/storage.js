'use strict';
window.BelesStorage = {
  async render(root) {
    const data = await api('/api/storage'),
      mb = (value) => (value / 1048576).toFixed(1) + ' МБ';
    root.append(
      el('h2', 'Сховище · ' + data.driver),
      el(
        'p',
        'Бюджет медіа: ' +
          mb(data.budgetBytes) +
          '. Це налаштування сайту, а не тарифна квота провайдера.',
      ),
      el(
        'p',
        'Локальний диск: ' + mb(data.filesystemBytes) + ' · вільно ' + mb(data.filesystemFreeBytes),
      ),
    );
    if (data.localStagingOnly)
      root.append(
        el(
          'p',
          'Статистика диска стосується локальних файлів і тимчасових завантажень. Квоту S3 перевіряйте у провайдера.',
        ),
      );
    if (data.warning)
      root.append(
        el(
          'p',
          'Увага: мало вільного місця. Великі файли можуть бути відхилені без зміни каталогу.',
          'helper',
        ),
      );
    const table = el('table');
    for (const [label, key] of [
      ['Зображення', 'images'],
      ['PDF', 'pdf'],
      ['Шрифти', 'fonts'],
      ['Інше', 'other'],
      ['Тимчасовий кеш', 'cache'],
    ]) {
      const row = el('tr');
      row.append(el('th', label), el('td', mb(data[key])));
      table.append(row);
    }
    root.append(table);
    const clear = el('button', 'Очистити старий тимчасовий кеш'),
      report = el('button', 'Перевірити файли без посилань'),
      preview = el('button', 'Переглянути пропозицію нових блоків');
    clear.onclick = async () => {
      try {
        const result = await api('/api/storage/cache', 'DELETE');
        note('Звільнено ' + mb(result.freedBytes) + ', файлів: ' + result.files);
        root.replaceChildren();
        await this.render(root);
      } catch (error) {
        note(error.message);
      }
    };
    report.onclick = async () => {
      try {
        const result = await api('/api/storage/orphans'),
          section = el('section');
        section.append(
          el('h3', 'Кандидати на видалення · ' + result.items.length),
          el(
            'p',
            'Перевірені посилання каталогу, профілів, шаблону, оригіналу, історії, резервної версії каталогу та статичних ресурсів. Перед видаленням потрібна актуальна резервна копія.',
          ),
          el('p', 'Разом: ' + mb(result.bytes)),
        );
        const list = el('ul');
        for (const item of result.items) list.append(el('li', item.key + ' · ' + mb(item.bytes)));
        section.append(list);
        if (result.items.length && hasPermission('storage.write')) {
          const remove = el('button', 'Видалити переглянуті файли', 'danger');
          remove.onclick = async () => {
            try {
              if (!confirm('Ви перевірили список і резервну копію? Видалити лише ці файли?'))
                return;
              if (currentUser?.role !== 'owner') await window.BelesSecurity.reauthenticate();
              const done = await api('/api/storage/orphans', 'DELETE', {
                reportId: result.id,
                confirm: 'DELETE REVIEWED ORPHANS',
              });
              note('Звільнено ' + mb(done.freedBytes));
              section.remove();
            } catch (error) {
              note(error.message);
            }
          };
          section.append(remove);
        }
        root.append(section);
      } catch (error) {
        note(error.message);
      }
    };
    preview.onclick = async () => {
      try {
        const result = await api('/api/editorial-preview', 'POST', {});
        const frame = el('iframe');
        frame.src = result.url;
        frame.title = 'Пропозиція комерційних блоків';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.width = '100%';
        frame.height = '800';
        root.append(
          el(
            'p',
            'Чернетка для погодження. Форми у цьому ізольованому перегляді не надсилають дані.',
          ),
          frame,
        );
      } catch (error) {
        note(error.message);
      }
    };
    clear.hidden = !hasPermission('storage.write');
    root.append(clear, report, preview, el('h2', 'Журнал безпеки'));
    const log = await api('/api/audit');
    const list = el('ol');
    for (const item of log.items)
      list.append(
        el(
          'li',
          new Date(item.at).toLocaleString('uk-UA') +
            ' · ' +
            item.action +
            ' · ' +
            (item.actorId || '—') +
            ' · ' +
            item.result,
        ),
      );
    root.append(list);
  },
};
