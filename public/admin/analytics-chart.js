'use strict';
window.BelesAnalyticsChart = {
  render(data) {
    const box = el('section', undefined, 'analytics-panel analytics-chart');
    box.append(el('h2', 'Відвідуваність за днями'));
    const controls = el('div', undefined, 'analytics-controls');
    const type = el('select');
    type.setAttribute('aria-label', 'Вигляд графіка');
    type.add(new Option('Лінії', 'line'));
    type.add(new Option('Стовпчики', 'bar'));
    const series = [
      ['views', 'Перегляди', '#ed087b'],
      ['visitors', 'Браузери', '#2863d6'],
      ['visits', 'Візити', '#00847a'],
    ];
    const selected = new Set(['views', 'visitors']);
    const canvas = el('div', undefined, 'chart-canvas');
    const tooltip = el(
      'p',
      'Наведіть на дату або виберіть її клавішею Tab. Дати — UTC.',
      'chart-tooltip',
    );
    tooltip.setAttribute('aria-live', 'polite');
    controls.append(type);
    for (const [field, title, color] of series) {
      const label = el('label', title),
        checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(field);
      label.style.color = color;
      label.prepend(checkbox);
      checkbox.onchange = () => {
        checkbox.checked ? selected.add(field) : selected.delete(field);
        draw();
      };
      controls.append(label);
    }
    function draw() {
      canvas.replaceChildren();
      const ns = 'http://www.w3.org/2000/svg';
      const node = (tag, attrs = {}) => {
        const n = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
        return n;
      };
      const svg = node('svg', {
        viewBox: '0 0 960 300',
        role: 'img',
        'aria-label': 'Відвідуваність: перегляди, браузери та візити',
      });
      const fields = series.filter(([key]) => selected.has(key));
      const raw = Math.max(1, ...data.flatMap((day) => fields.map(([key]) => day[key])));
      const magnitude = 10 ** Math.floor(Math.log10(raw));
      const max = Math.max(4, Math.ceil(raw / magnitude) * magnitude);
      const left = 65,
        width = 870,
        bottom = 250,
        height = 215;
      const step = width / Math.max(1, data.length);
      for (let i = 0; i <= 4; i++) {
        const y = bottom - (i * height) / 4;
        svg.append(node('line', { x1: left, x2: left + width, y1: y, y2: y, stroke: '#e1e7ef' }));
        const text = node('text', {
          x: left - 10,
          y: y + 4,
          'text-anchor': 'end',
          'font-size': 12,
          fill: '#53647b',
        });
        text.textContent = Math.round((max * i) / 4).toLocaleString('uk-UA');
        svg.append(text);
      }
      const x = (i) => left + (i + 0.5) * step;
      const y = (value) => bottom - (value / max) * height;
      for (const [field, title, color] of fields) {
        if (type.value === 'line') {
          const points = data.map((day, i) => `${x(i)},${y(day[field])}`).join(' ');
          if (data.length)
            svg.append(
              node('polygon', {
                points: `${x(0)},${bottom} ${points} ${x(data.length - 1)},${bottom}`,
                fill: color,
                opacity: 0.06,
              }),
            );
          svg.append(
            node('polyline', {
              points,
              fill: 'none',
              stroke: color,
              'stroke-width': 2.5,
              'stroke-linejoin': 'round',
            }),
          );
        }
        data.forEach((day, i) => {
          if (type.value === 'bar') {
            const barWidth = (step * 0.75) / Math.max(1, fields.length);
            svg.append(
              node('rect', {
                x: x(i) - step * 0.375 + fields.findIndex((s) => s[0] === field) * barWidth,
                y: y(day[field]),
                width: Math.max(0.3, barWidth - 1),
                height: bottom - y(day[field]),
                fill: color,
                rx: 2,
              }),
            );
          } else if (data.length <= 31)
            svg.append(node('circle', { cx: x(i), cy: y(day[field]), r: 3, fill: color }));
        });
      }
      data.forEach((day, i) => {
        const info = `${day.date}: ${day.views} переглядів · ${day.visitors} браузерів · ${day.visits} візитів`;
        const hit = node('rect', {
          x: left + i * step,
          y: 25,
          width: step,
          height: height + 10,
          fill: 'transparent',
          tabindex: 0,
          role: 'img',
          'aria-label': info,
        });
        const title = node('title');
        title.textContent = info;
        hit.append(title);
        hit.onmouseenter = hit.onfocus = () => {
          tooltip.textContent = info;
          hit.setAttribute('fill', '#2863d610');
        };
        hit.onmouseleave = hit.onblur = () => hit.setAttribute('fill', 'transparent');
        svg.append(hit);
        if (i === 0 || i === data.length - 1 || i % Math.max(1, Math.ceil(data.length / 8)) === 0) {
          const label = node('text', {
            x: x(i),
            y: 275,
            'text-anchor': 'middle',
            'font-size': 12,
            fill: '#53647b',
          });
          label.textContent = day.date.slice(5);
          svg.append(label);
        }
      });
      canvas.append(svg);
    }
    type.onchange = draw;
    box.append(controls, canvas, tooltip);
    const details = el('details');
    details.append(el('summary', 'Дані графіка таблицею'));
    const table = el('table');
    for (const [i, row] of [
      ['Дата UTC', 'Перегляди', 'Візити', 'Браузери'],
      ...data.map((day) => [day.date, day.views, day.visits, day.visitors]),
    ].entries()) {
      const tr = el('tr');
      row.forEach((value) => tr.append(el(i ? 'td' : 'th', String(value))));
      table.append(tr);
    }
    details.append(table);
    box.append(details);
    draw();
    return box;
  },
};
