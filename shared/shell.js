/*
 * Общая оболочка для всех приложений демо.
 *
 * Суть — в двух местах:
 *   1. каждая вкладка при загрузке получает постоянное имя (window.name);
 *   2. переход делается через window.open('', имя): браузер возвращает уже
 *      открытую вкладку с таким именем либо создаёт новую пустую.
 *
 * Всё остальное (статусы, журнал, карточка вкладки) — обвязка для наглядности.
 */
(() => {
  'use strict';

  // Корень сайта вычисляется от адреса этого скрипта, поэтому демо работает
  // из любой подпапки (например, /tab-switch-demo/ на GitHub Pages).
  const BASE = new URL('..', document.currentScript.src);

  const HOME = { id: 'home', title: 'О демо', path: '', color: '#5b6470', letter: '?' };
  const APPS = [
    { id: 'notes',   title: 'Заметки', path: 'notes/',   color: '#d9622b', letter: 'З' },
    { id: 'counter', title: 'Счётчик', path: 'counter/', color: '#12908a', letter: 'С' },
    { id: 'timer',   title: 'Таймер',  path: 'timer/',   color: '#7c5cdb', letter: 'Т' },
    { id: 'todo',    title: 'Дела',    path: 'todo/',    color: '#2f7fd6', letter: 'Д' },
    { id: 'canvas',  title: 'Холст',   path: 'canvas/',  color: '#cf4b8b', letter: 'Х' },
  ];
  const BY_ID = Object.fromEntries([HOME, ...APPS].map((a) => [a.id, a]));
  const current = BY_ID[document.body.dataset.app] || HOME;

  const NAME_PREFIX = 'tabdemo-';
  const urlOf = (app) => new URL(app.path, BASE).href;

  // ───────────────────────── 1. Имя вкладки ─────────────────────────
  window.name = NAME_PREFIX + current.id;

  // ───────────────────────── 2. Переход ─────────────────────────────
  // Вызывать только из обработчика клика: иначе сработает блокировщик
  // всплывающих окон, а focus() будет проигнорирован.
  function switchTo(app) {
    const url = urlOf(app);

    // Пустой URL: найденная вкладка не перезагружается.
    const target = window.open('', NAME_PREFIX + app.id);
    if (!target) {
      log('blocked', app);
      location.href = url;
      return;
    }

    let existed = false;
    try {
      existed = target.location.href !== 'about:blank';
    } catch {
      // Вкладка с этим именем ушла на чужой origin — просто загрузим приложение заново.
    }

    if (!existed) target.location.href = url;
    target.focus();

    if (existed) {
      log('focused', app);
      checkFocusMoved(app);
    } else {
      log(statusOf(app) === 'detached' ? 'duplicate' : 'opened', app);
    }
  }

  // Если спустя полсекунды эта вкладка всё ещё видима и в фокусе,
  // значит браузер нашёл целевую вкладку, но не переключился на неё.
  function checkFocusMoved(app) {
    setTimeout(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()) log('nofocus', app);
    }, 500);
  }

  // ───────────────────────── Кто сейчас открыт ──────────────────────
  // BroadcastChannel видит все вкладки этого origin, в том числе открытые
  // вручную. Переключиться на такие нельзя, но показать их можно.
  const tabId = Math.random().toString(36).slice(2, 8);

  // Идентификатор «связки» вкладок. sessionStorage копируется во вкладку,
  // открытую через window.open, поэтому у всех связанных вкладок он общий.
  let groupId = null;
  try {
    groupId = sessionStorage.getItem('tabdemo-group');
    if (!groupId) {
      groupId = Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('tabdemo-group', groupId);
    }
  } catch {
    groupId = tabId;
  }

  const me = { tabId, app: current.id, groupId };
  const peers = new Map();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('tabdemo') : null;

  if (channel) {
    channel.onmessage = ({ data }) => {
      if (!data || !data.tab || data.tab.tabId === tabId) return;
      if (data.type === 'bye') peers.delete(data.tab.tabId);
      else peers.set(data.tab.tabId, { ...data.tab, seen: Date.now() });
      if (data.type === 'ping') channel.postMessage({ type: 'here', tab: me });
      renderStatuses();
    };
  }

  // Опрос идёт только из видимой вкладки: таймеры в фоне браузер замедляет,
  // а ответы приходят из обработчика сообщения, который не замедляется.
  function poll() {
    if (!channel || document.hidden) return;
    const sentAt = Date.now();
    channel.postMessage({ type: 'ping', tab: me });
    setTimeout(() => {
      for (const [id, peer] of peers) if (peer.seen < sentAt) peers.delete(id);
      renderStatuses();
    }, 700);
  }

  function statusOf(app) {
    if (app.id === current.id) return 'current';
    let found = 'closed';
    for (const peer of peers.values()) {
      if (peer.app !== app.id) continue;
      if (peer.groupId === groupId) return 'linked';
      found = 'detached';
    }
    return found;
  }

  const STATUS_TEXT = {
    current: 'вы здесь',
    linked: 'открыто — переключится на эту вкладку',
    detached: 'открыто отдельно — переключиться нельзя',
    closed: 'не открыто — откроется в новой вкладке',
  };

  // ───────────────────────── Журнал переходов ───────────────────────
  // Общий для всех вкладок: лежит в localStorage, обновляется по событию storage.
  const LOG_KEY = 'tabdemo-log';
  const LOG_TEXT = {
    focused: 'вкладка уже была открыта — переключился на неё без перезагрузки',
    opened: 'вкладки не было — открыл новую',
    duplicate: 'открыто в независимой вкладке, переключиться на неё браузер не даёт — открыл ещё одну',
    blocked: 'браузер заблокировал новую вкладку — перешёл в текущей',
    nofocus: 'вкладка найдена, но браузер не переключил на неё фокус',
  };

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch {
      return [];
    }
  }

  function log(kind, to) {
    const entries = [{ t: Date.now(), from: current.id, to: to.id, kind }, ...readLog()].slice(0, 30);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch {
      /* журнал — не критично */
    }
    renderLog();
  }

  // ───────────────────────── Отрисовка ──────────────────────────────
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };

  const time = (t) => new Date(t).toLocaleTimeString('ru-RU');

  document.documentElement.style.setProperty('--accent', current.color);
  document.head.append(
    el('link', {
      rel: 'icon',
      href:
        'data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${current.color}"/><text x="16" y="23" font-family="system-ui,sans-serif" font-size="19" font-weight="700" text-anchor="middle" fill="#fff">${current.letter}</text></svg>`
        ),
    })
  );

  // Любая ссылка с data-switch="<id>" становится переключателем.
  // Ctrl/Cmd/средняя кнопка остаются за браузером.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-switch]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const app = BY_ID[link.dataset.switch];
    if (!app) return;
    event.preventDefault();
    if (app.id !== current.id) switchTo(app);
  });

  function appLink(app, className) {
    const link = el(
      'a',
      { class: className, href: urlOf(app), 'data-switch': app.id, style: `--app:${app.color}` },
      el('span', { class: 'badge', text: app.letter, 'aria-hidden': 'true' }),
      el('span', { class: 'label', text: app.title }),
      el('span', { class: 'dot' })
    );
    if (app.id === current.id) link.setAttribute('aria-current', 'page');
    return link;
  }

  const header = document.getElementById('shell-header');
  if (header) {
    header.append(
      el(
        'nav',
        { class: 'switcher', 'aria-label': 'Приложения' },
        el('a', { class: 'brand', href: urlOf(HOME), 'data-switch': 'home', text: 'О демо' }),
        el('div', { class: 'apps' }, ...APPS.map((app) => appLink(app, 'pill')))
      )
    );
  }

  // На узком экране текущее приложение может оказаться за краем ленты.
  header?.querySelector('.pill[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const tiles = document.getElementById('shell-tiles');
  if (tiles) tiles.append(...APPS.map((app) => appLink(app, 'tile')));

  const loadedAt = Date.now();
  const uptime = el('span');
  const logList = el('ol', { class: 'log' });

  const panels = document.getElementById('shell-panels');
  if (panels) {
    const clear = el('button', { class: 'ghost', type: 'button', text: 'Очистить' });
    clear.addEventListener('click', () => {
      try {
        localStorage.removeItem(LOG_KEY);
      } catch {
        /* нечего чистить */
      }
      renderLog();
    });

    const row = (term, ...value) => el('div', {}, el('dt', { text: term }), el('dd', {}, ...value));

    panels.append(
      el(
        'section',
        { class: 'card' },
        el('h2', { text: 'Эта вкладка' }),
        el(
          'dl',
          { class: 'facts' },
          row('Имя', el('code', { text: window.name })),
          row('Загружена', `${time(loadedAt)} · живёт `, uptime),
          row('Открыта', window.opener ? 'из другой вкладки' : 'вручную'),
          row('Связка', el('code', { text: groupId }))
        ),
        el('p', {
          class: 'hint',
          text: 'Если после возврата время загрузки прежнее, вкладка не перезагружалась.',
        })
      ),
      el(
        'section',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', { text: 'Журнал переходов' }), clear),
        logList,
        el(
          'ul',
          { class: 'legend' },
          el('li', {}, el('span', { class: 'dot', 'data-status': 'linked' }), 'открыто, переключится'),
          el('li', {}, el('span', { class: 'dot', 'data-status': 'detached' }), 'открыто отдельно'),
          el('li', {}, el('span', { class: 'dot', 'data-status': 'closed' }), 'не открыто')
        )
      )
    );
  }

  function renderStatuses() {
    for (const link of document.querySelectorAll('a[data-switch]')) {
      const app = BY_ID[link.dataset.switch];
      const dot = link.querySelector('.dot');
      if (!app || !dot) continue;
      const status = statusOf(app);
      dot.dataset.status = status;
      link.title = `${app.title}: ${STATUS_TEXT[status]}`;
    }
  }

  function renderLog() {
    const entries = readLog();
    logList.replaceChildren(
      ...(entries.length
        ? entries.map((entry) =>
            el(
              'li',
              { 'data-kind': entry.kind },
              el('time', { text: time(entry.t) }),
              el('b', { text: `${BY_ID[entry.from]?.title ?? '?'} → ${BY_ID[entry.to]?.title ?? '?'}` }),
              el('span', { text: LOG_TEXT[entry.kind] ?? entry.kind })
            )
          )
        : [el('li', { class: 'empty', text: 'Пока пусто — переключитесь на другое приложение.' })])
    );
  }

  function renderUptime() {
    const seconds = Math.floor((Date.now() - loadedAt) / 1000);
    uptime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  window.addEventListener('storage', (event) => {
    if (event.key === LOG_KEY || event.key === null) renderLog();
  });
  document.addEventListener('visibilitychange', () => {
    poll();
    renderUptime();
    renderLog();
  });
  window.addEventListener('pagehide', (event) => {
    if (channel && !event.persisted) channel.postMessage({ type: 'bye', tab: me });
  });
  window.addEventListener('pageshow', poll);

  setInterval(poll, 2000);
  setInterval(renderUptime, 1000);
  renderStatuses();
  renderLog();
  renderUptime();
  poll();
})();
