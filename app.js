import * as db from './db.js';
import {
  normalizeName, localDateStr, isExpired, formatMD, formatMDW, formatDateTime,
  compactDate, isValidDateStr, isValidIso,
} from './util.js';

const APP_VERSION = self.SHOPPINGLIST_VERSION;
const LAST_BACKUP_KEY = 'shoppinglist-lastBackupAt';
const SCHEMA_VERSION = 1;
const NAME_MAX = 40;
const MEMO_MAX = 200;
const LONG_PRESS_MS = 500;
const BACKUP_WARN_DAYS = 30;
const LIST_LABEL = { now: '今回', later: 'あとで' };

const state = { items: [], history: [], persisted: null };
const app = document.getElementById('app');

async function reload() {
  const data = await db.loadAll();
  state.items = data.items;
  state.history = data.history;
}

// ---------- DOM ヘルパー（ユーザー入力は必ず textContent で出す） ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// 線画のアイコン（固定の文字列だけを使う）
const ICONS = {
  cart: '<path d="M1.5 3H5l2.6 12h11.9L22 7H6"/><circle cx="9.5" cy="19.5" r="1.6"/><circle cx="17.5" cy="19.5" r="1.6"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.3v.2"/>',
  check: '<path d="M6.5 12.5l3.8 3.8 7.2-8.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

// ---------- 画面遷移（ハッシュ） ----------

let renderedHash = null;

function parseRoute() {
  const raw = location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  switch (parts[0]) {
    case 'now':
    case 'later':
    case 'backup':
      return { name: parts[0] };
    case 'add':
      return { name: 'add', dest: params.get('dest') === 'later' ? 'later' : 'now' };
    case 'edit':
      if (parts[1]) return { name: 'edit', id: decodeURIComponent(parts[1]) };
      break;
  }
  return null;
}

function navigate(hash) {
  history.pushState({ inApp: true }, '', hash);
  render();
}

// アプリ内で進んできたなら履歴を戻る。直接開いた場合は fallback の画面へ。
function goBack(fallback) {
  if (history.state && history.state.inApp) {
    history.back();
  } else {
    history.replaceState(null, '', fallback);
    render();
  }
}

function onLocationChange() {
  if (location.hash !== renderedHash) render();
}

function render() {
  hideDialog();
  let route = parseRoute();
  if (!route) {
    history.replaceState(history.state, '', '#/now');
    route = { name: 'now' };
  }
  renderedHash = location.hash;
  const screens = {
    now: renderNow, later: renderLater, add: renderAdd, edit: renderEdit, backup: renderBackup,
  };
  app.replaceChildren(screens[route.name](route));
}

// 一覧画面だけを、スクロール位置を保ったまま描き直す
function refreshList() {
  const route = parseRoute();
  if (!route || !['now', 'later', 'backup'].includes(route.name)) return;
  const top = app.querySelector('.content')?.scrollTop ?? 0;
  render();
  const content = app.querySelector('.content');
  if (content) content.scrollTop = top;
}

// 長押しで画面が変わった直後の click を捨てる
let suppressClickUntil = 0;
document.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

// ---------- 共通部品 ----------

function needsBackup() {
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* 読めなければ未実施扱い */ }
  if (!last || !isValidIso(last)) return true;
  return Date.now() - Date.parse(last) >= BACKUP_WARN_DAYS * 24 * 60 * 60 * 1000;
}

function mainHeader(active) {
  const today = localDateStr();
  const nowCount = state.items.filter((i) => i.list === 'now' && !i.done).length;
  const later = state.items.filter((i) => i.list === 'later');
  const expired = later.filter((i) => isExpired(i.dueDate, today)).length;
  const warnBackup = needsBackup();

  const tab = (name, label) => h('button', {
    class: 'tab',
    role: 'tab',
    'aria-selected': String(active === name),
    onclick: () => { if (active !== name) navigate(`#/${name}`); },
  }, label);

  return h('header', { class: 'header' },
    h('div', { class: 'title-row' },
      icon('cart', 'title-icon'),
      h('h1', { class: 'title', text: '買い物リスト' }),
      h('button', {
        class: 'backup-btn',
        'aria-label': warnBackup ? 'バックアップ（30日以上していません）' : 'バックアップ',
        onclick: () => navigate('#/backup'),
      }, 'バックアップ', warnBackup && h('span', { class: 'dot', 'aria-hidden': 'true' }))),
    active === 'now' && expired > 0 && h('button', {
      class: 'expired-alert',
      onclick: () => navigate('#/later'),
    }, icon('warn', 'alert-icon'), h('span', { text: `あとでリストに期限切れ ${expired}件` })),
    h('div', { class: 'tabs', role: 'tablist' },
      tab('now', `今回 ${nowCount}`),
      tab('later', `あとで ${later.length}`)),
    active === 'later' && h('p', { class: 'hint', text: '期限が近い順。期限なしは最後' }));
}

function subHeader(title, onBack) {
  return h('header', { class: 'sub-header' },
    h('button', { class: 'back-btn', onclick: onBack }, icon('back', 'back-icon'), '戻る'),
    h('h1', { class: 'sub-title', text: title }));
}

function openAddBar(dest, placeholder) {
  const open = () => navigate(`#/add?dest=${dest}`);
  return h('footer', { class: 'bar' },
    h('button', { class: 'fake-input', onclick: open, text: placeholder }),
    h('button', { class: 'btn btn-accent', onclick: open, text: '追加' }));
}

function screen(...parts) {
  return h('div', { class: 'screen' }, ...parts);
}

// 行のタップと長押しを区別する（長押し時は onTap を呼ばない）
function bindPress(el, onTap, onLong) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    el.classList.remove('pressing');
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    el.classList.add('pressing');
    timer = setTimeout(() => {
      cancel();
      suppressClickUntil = Date.now() + 700;
      if (navigator.vibrate) navigator.vibrate(30);
      onLong();
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', onTap);
}

// ---------- トースト・ダイアログ ----------

const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(text, { action = null, duration = 3000 } = {}) {
  toastEl.replaceChildren(h('span', { class: 'toast-text', text }));
  if (action) {
    toastEl.append(h('button', {
      class: 'toast-action',
      text: action.label,
      onclick: () => { hideToast(); action.run(); },
    }));
  }
  const bar = app.querySelector('.bar');
  toastEl.style.bottom = `${(bar ? bar.offsetHeight : 0) + 12}px`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
  toastEl.replaceChildren();
}

const dialogEl = document.getElementById('dialog');
let dialogResolve = null;

function confirmDialog(message, okLabel, danger = false) {
  hideDialog();
  return new Promise((resolve) => {
    dialogResolve = resolve;
    const close = (value) => {
      if (dialogResolve !== resolve) return;
      dialogResolve = null;
      dialogEl.close();
      resolve(value);
    };
    dialogEl.replaceChildren(
      h('p', { class: 'dialog-msg', text: message }),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn btn-outline', onclick: () => close(false), text: 'キャンセル' }),
        h('button', { class: danger ? 'btn btn-warn-fill' : 'btn btn-accent', onclick: () => close(true), text: okLabel })));
    dialogEl.oncancel = (e) => { e.preventDefault(); close(false); };
    dialogEl.showModal();
  });
}

function hideDialog() {
  if (dialogResolve) {
    const resolve = dialogResolve;
    dialogResolve = null;
    resolve(false);
  }
  if (dialogEl.open) dialogEl.close();
}

// ---------- 今回タブ ----------

function renderNow() {
  const nowItems = state.items.filter((i) => i.list === 'now');
  const todo = nowItems.filter((i) => !i.done)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = nowItems.filter((i) => i.done)
    .sort((a, b) => (a.doneAt || '').localeCompare(b.doneAt || ''));

  const content = h('main', { class: 'content' });

  if (todo.length === 0) {
    content.append(h('p', { class: 'empty', text: '買うものはありません' }));
  } else {
    content.append(h('ul', { class: 'list' }, todo.map((item) => {
      const row = h('button', { class: 'row row-todo' },
        h('span', { class: 'circle', 'aria-hidden': 'true' }),
        h('span', { class: 'row-body' },
          h('span', { class: 'row-name', text: item.name }),
          item.memo && h('span', { class: 'row-memo', text: item.memo })));
      bindPress(row, () => toggleDone(item.id, true), () => navigate(`#/edit/${encodeURIComponent(item.id)}`));
      return h('li', null, row);
    })));
  }

  if (done.length > 0) {
    content.append(
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title', text: `買ったもの ${done.length}` }),
        h('button', { class: 'text-btn', onclick: clearDone, text: 'まとめて消す' })),
      h('ul', { class: 'list' }, done.map((item) => {
        const row = h('button', { class: 'row row-done' },
          h('span', { class: 'circle checked', 'aria-hidden': 'true' }, icon('check', 'check-icon')),
          h('span', { class: 'row-body' },
            h('span', { class: 'row-name', text: item.name })));
        bindPress(row, () => toggleDone(item.id, false), () => navigate(`#/edit/${encodeURIComponent(item.id)}`));
        return h('li', null, row);
      })));
  }

  return screen(mainHeader('now'), content, openAddBar('now', '品名を入力'));
}

async function toggleDone(id, done) {
  await db.setDone(id, done);
  await reload();
  refreshList();
}

async function clearDone() {
  const done = state.items.filter((i) => i.list === 'now' && i.done);
  if (done.length === 0) return;
  await db.deleteItems(done.map((i) => i.id));
  await reload();
  refreshList();
  showToast(`${done.length}件を消しました`, {
    duration: 5000,
    action: {
      label: '元に戻す',
      run: async () => {
        await db.restoreItems(done);
        await reload();
        refreshList();
      },
    },
  });
}

// ---------- あとでタブ ----------

function renderLater() {
  const today = localDateStr();
  const items = state.items.filter((i) => i.list === 'later').sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  const content = h('main', { class: 'content' });
  if (items.length === 0) {
    content.append(h('p', { class: 'empty', text: 'あとで買うものはありません' }));
  } else {
    content.append(h('ul', { class: 'list' }, items.map((item) => {
      let due = null;
      if (item.dueDate && isExpired(item.dueDate, today)) {
        due = h('span', { class: 'row-due expired' },
          icon('warn', 'due-icon'), `期限切れ（${formatMD(item.dueDate)}）`);
      } else if (item.dueDate) {
        due = h('span', { class: 'row-due', text: item.dueDate === today ? '今日まで' : `${formatMD(item.dueDate)}まで` });
      }
      return h('li', { class: 'later-row' },
        h('button', {
          class: 'later-main',
          onclick: () => navigate(`#/edit/${encodeURIComponent(item.id)}`),
        },
        h('span', { class: 'row-name', text: item.name }),
        due,
        item.memo && h('span', { class: 'row-memo', text: item.memo })),
        h('button', { class: 'to-now-btn', onclick: () => moveToNow(item), text: '今回へ' }));
    })));
  }

  return screen(mainHeader('later'), content, openAddBar('later', 'あとで買うものを入力'));
}

async function moveToNow(item) {
  const next = {
    ...item, list: 'now', dueDate: null, done: false, doneAt: null, updatedAt: new Date().toISOString(),
  };
  await db.saveItem(next, item);
  await reload();
  refreshList();
  showToast(`「${item.name}」を今回へ移しました`);
}

// ---------- 追加画面 ----------

function findActive(name, list, exceptId = null) {
  const key = normalizeName(name);
  return state.items.find((i) => i.id !== exceptId && i.list === list && !i.done && normalizeName(i.name) === key);
}

function sortedHistory() {
  return [...state.history].sort((a, b) => b.count - a.count || b.lastBoughtAt.localeCompare(a.lastBoughtAt));
}

function renderAdd(route) {
  let dest = route.dest;
  let due = null;

  const input = h('input', {
    class: 'text-input',
    type: 'text',
    placeholder: '品名を入力',
    maxlength: String(NAME_MAX),
    enterkeyhint: 'enter',
    autocomplete: 'off',
    'aria-label': '品名',
  });
  const destBox = h('div');
  const dueBox = h('div');
  const candBox = h('div', { class: 'cands' });

  function setDest(next) {
    dest = next;
    history.replaceState(history.state, '', `#/add?dest=${dest}`);
    renderedHash = location.hash;
    update();
  }

  function renderDest() {
    destBox.replaceChildren(
      h('p', { class: 'field-label', text: '追加先' }),
      h('div', { class: 'segment' }, ['now', 'later'].map((l) => h('button', {
        class: 'seg-btn',
        'aria-pressed': String(dest === l),
        onclick: () => { if (dest !== l) setDest(l); },
        text: LIST_LABEL[l],
      }))));
  }

  function renderDue() {
    if (dest !== 'later') {
      dueBox.replaceChildren();
      return;
    }
    const picker = h('input', { class: 'date-hidden', type: 'date', tabindex: '-1', 'aria-hidden': 'true', value: due || '' });
    picker.addEventListener('change', () => {
      due = isValidDateStr(picker.value) ? picker.value : null;
      renderDue();
    });
    const openPicker = () => {
      try { picker.showPicker(); } catch { picker.focus(); }
    };
    dueBox.replaceChildren(
      h('p', { class: 'field-label', text: '期限（任意）' }),
      h('div', { class: 'due-row' },
        h('button', { class: 'due-btn', onclick: openPicker },
          icon('calendar', 'due-btn-icon'),
          h('span', { text: due ? `${formatMDW(due)}まで` : '期限なし' })),
        due && h('button', { class: 'btn btn-outline small', onclick: () => { due = null; renderDue(); }, text: '期限なし' }),
        picker));
  }

  function renderCands() {
    const value = input.value.trim();
    const all = sortedHistory();
    let heading;
    let list;
    if (!value) {
      heading = 'よく買うもの（タップで追加）';
      list = all.slice(0, 10);
    } else {
      const key = normalizeName(value);
      heading = `「${value}」で始まる品名`;
      list = all.filter((x) => x.key.startsWith(key)).slice(0, 20);
    }
    candBox.replaceChildren(h('p', { class: 'field-label', text: heading }));
    if (list.length === 0) {
      candBox.append(h('p', {
        class: 'cand-empty',
        text: value ? '候補はありません。「追加」でそのまま登録します' : 'まだ購入の記録がありません',
      }));
      return;
    }
    candBox.append(h('ul', { class: 'list' }, list.map((x) => {
      const exists = !!findActive(x.name, dest);
      return h('li', null, h('button', {
        class: 'cand',
        'aria-disabled': String(exists),
        onclick: () => { if (!exists) addItem(x.name); },
      },
      h('span', { class: 'cand-name', text: x.name }),
      exists && h('span', { class: 'cand-tag', text: `${LIST_LABEL[dest]}にあり` })));
    })));
  }

  function update() {
    renderDest();
    renderDue();
    renderCands();
  }

  async function addItem(rawName) {
    const name = rawName.trim();
    if (!name) return;
    if (findActive(name, dest)) {
      showToast(`すでに${LIST_LABEL[dest]}にあります`);
      return;
    }
    const now = new Date().toISOString();
    await db.saveItem({
      id: crypto.randomUUID(),
      name: name.slice(0, NAME_MAX),
      memo: '',
      list: dest,
      done: false,
      dueDate: dest === 'later' ? due : null,
      createdAt: now,
      updatedAt: now,
      doneAt: null,
    });
    await reload();
    input.value = '';
    renderCands();
    showToast(`「${name}」を${LIST_LABEL[dest]}に追加しました`);
  }

  input.addEventListener('input', renderCands);
  const form = h('form', { class: 'bar add-form' },
    input,
    h('button', { class: 'btn btn-accent', type: 'submit', text: '追加' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addItem(input.value);
  });

  update();
  return screen(
    subHeader('追加', () => goBack(`#/${dest}`)),
    h('main', { class: 'content' }, destBox, dueBox, candBox),
    form);
}

// ---------- 編集画面 ----------

function renderEdit(route) {
  const item = state.items.find((i) => i.id === route.id);
  if (!item) {
    return screen(
      subHeader('編集', () => goBack('#/now')),
      h('main', { class: 'content' }, h('p', { class: 'empty', text: 'アイテムが見つかりません' })));
  }

  const back = () => goBack(`#/${item.list}`);
  let list = item.list;
  let due = item.dueDate;

  const nameInput = h('input', {
    class: 'text-input', type: 'text', value: item.name, autocomplete: 'off', id: 'edit-name',
  });
  const nameError = h('p', { class: 'error', hidden: true });
  const memoInput = h('textarea', { class: 'memo-input', rows: '3', id: 'edit-memo', value: item.memo });
  const memoError = h('p', { class: 'error', hidden: true });
  const listBox = h('div');
  const dueBox = h('div');

  function renderList() {
    listBox.replaceChildren(
      h('p', { class: 'field-label', text: 'リスト' }),
      h('div', { class: 'segment' }, ['now', 'later'].map((l) => h('button', {
        class: 'seg-btn',
        'aria-pressed': String(list === l),
        onclick: () => {
          list = l;
          renderList();
          renderDue();
        },
        text: LIST_LABEL[l],
      }))));
  }

  function renderDue() {
    if (list !== 'later') {
      dueBox.replaceChildren();
      return;
    }
    const dateInput = h('input', { class: 'date-input', type: 'date', value: due || '', 'aria-label': '期限' });
    dateInput.addEventListener('change', () => {
      due = isValidDateStr(dateInput.value) ? dateInput.value : null;
    });
    dueBox.replaceChildren(
      h('p', { class: 'field-label', text: '期限' }),
      h('div', { class: 'due-row' },
        dateInput,
        h('button', {
          class: 'btn btn-outline small',
          onclick: () => { due = null; dateInput.value = ''; },
          text: '期限なし',
        })));
  }

  function showError(el, msg) {
    el.replaceChildren(icon('warn', 'error-icon'), msg);
    el.hidden = false;
  }

  async function save() {
    const name = nameInput.value.trim();
    const memo = memoInput.value;
    let ok = true;
    nameError.hidden = true;
    memoError.hidden = true;
    if (!name) {
      showError(nameError, '品名を入力してください');
      ok = false;
    } else if (name.length > NAME_MAX) {
      showError(nameError, `品名は${NAME_MAX}文字以内にしてください（いま${name.length}文字）`);
      ok = false;
    }
    if (memo.length > MEMO_MAX) {
      showError(memoError, `メモは${MEMO_MAX}文字以内にしてください（いま${memo.length}文字）`);
      ok = false;
    }
    if (!ok) return;

    const moved = list !== item.list;
    const next = {
      ...item,
      name,
      memo,
      list,
      dueDate: list === 'later' ? due : null,
      done: moved ? false : item.done,
      doneAt: moved ? null : item.doneAt,
      updatedAt: new Date().toISOString(),
    };
    await db.saveItem(next, item);
    await reload();
    back();
  }

  async function remove() {
    if (!await confirmDialog(`「${item.name}」を削除しますか`, '削除', true)) return;
    await db.deleteItems([item.id]);
    await reload();
    back();
  }

  renderList();
  renderDue();

  return screen(
    subHeader('編集', back),
    h('main', { class: 'content' },
      h('label', { class: 'field-label', for: 'edit-name', text: '品名' }),
      nameInput,
      nameError,
      h('label', { class: 'field-label', for: 'edit-memo', text: 'メモ（任意）' }),
      memoInput,
      memoError,
      listBox,
      dueBox),
    h('footer', { class: 'bar' },
      h('button', { class: 'btn btn-warn', onclick: remove, text: '削除' }),
      h('button', { class: 'btn btn-accent btn-save', onclick: save, text: '保存' })));
}

// ---------- バックアップ画面（仕様書 7章） ----------

function renderBackup() {
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* 表示は未実施にする */ }
  const persistedText = state.persisted === null ? '不明' : state.persisted ? '有効' : '無効';
  const message = h('p', { class: 'backup-msg', hidden: true, role: 'status' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'file-hidden', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) await importBackup(file, message);
  });

  return screen(
    subHeader('バックアップ', () => goBack('#/now')),
    h('main', { class: 'content' },
      h('dl', { class: 'info' },
        h('dt', { text: '最終バックアップ' }),
        h('dd', { text: last && isValidIso(last) ? formatDateTime(last) : '未実施' }),
        h('dt', { text: '永続化' }),
        h('dd', { text: persistedText }),
        h('dt', { text: 'アプリのバージョン' }),
        h('dd', { text: APP_VERSION })),
      needsBackup() && h('p', { class: 'note warn-note' },
        icon('warn', 'note-icon'), `最後のバックアップから${BACKUP_WARN_DAYS}日以上たっています`),
      h('button', { class: 'btn btn-accent wide', onclick: () => exportBackup(message), text: 'エクスポート（書き出し）' }),
      h('p', { class: 'note', text: '全データをJSONファイルに書き出します。' }),
      h('button', { class: 'btn btn-outline wide', onclick: () => fileInput.click(), text: 'インポート（読み込み）' }),
      h('p', { class: 'note', text: 'バックアップファイルを読み込み、いまのデータをすべて置き換えます。' }),
      fileInput,
      message,
      h('p', { class: 'note', text: 'Chromeの「サイトデータを削除」を行うと、このアプリのデータも消えます。定期的にエクスポートしてください。' })));
}

function setBackupMessage(el, text, isError = false) {
  el.replaceChildren();
  if (isError) el.append(icon('warn', 'note-icon'));
  el.append(text);
  el.classList.toggle('error-text', isError);
  el.hidden = false;
}

function markBackedUp() {
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch { /* 保存できなくても続行 */ }
}

async function exportBackup(message) {
  const data = await db.loadAll();
  const payload = {
    app: 'shoppinglist',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    items: data.items,
    history: data.history,
  };
  const fileName = `shoppinglist-backup-${compactDate()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const file = new File([blob], fileName, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      markBackedUp();
      refreshList();
      showToast('バックアップを書き出しました');
      return;
    } catch (e) {
      if (e.name === 'AbortError') {
        setBackupMessage(message, '書き出しをキャンセルしました');
        return;
      }
      // 共有に失敗した場合はダウンロードにする
    }
  }

  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackedUp();
  refreshList();
  showToast(`${fileName} を保存しました`);
}

// インポートするJSONの検証。問題があれば Error を投げる。
function validateBackup(data) {
  const fail = (msg) => { throw new Error(msg); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('バックアップファイルの形式ではありません');
  if (data.app !== 'shoppinglist') fail('買い物リストのバックアップではありません');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    fail(typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION
      ? '新しい版のアプリで作られたファイルです'
      : 'ファイルの版が正しくありません');
  }
  if (!isValidIso(data.exportedAt)) fail('書き出し日時が正しくありません');
  if (!Array.isArray(data.items) || !Array.isArray(data.history)) fail('データが見つかりません');
  if (data.items.length > 10000 || data.history.length > 10000) fail('データの件数が多すぎます');

  const ids = new Set();
  const items = data.items.map((it, n) => {
    const where = `アイテム${n + 1}件目`;
    if (!it || typeof it !== 'object') fail(`${where}の形式が正しくありません`);
    if (typeof it.id !== 'string' || !it.id || it.id.length > 100 || ids.has(it.id)) fail(`${where}のIDが正しくありません`);
    ids.add(it.id);
    if (typeof it.name !== 'string' || it.name.trim() !== it.name || it.name.length < 1 || it.name.length > NAME_MAX) {
      fail(`${where}の品名が正しくありません`);
    }
    if (typeof it.memo !== 'string' || it.memo.length > MEMO_MAX) fail(`${where}のメモが正しくありません`);
    if (it.list !== 'now' && it.list !== 'later') fail(`${where}のリストが正しくありません`);
    if (typeof it.done !== 'boolean' || (it.list === 'later' && it.done)) fail(`${where}の購入状態が正しくありません`);
    if (it.dueDate !== null && !(it.list === 'later' && isValidDateStr(it.dueDate))) fail(`${where}の期限が正しくありません`);
    if (!isValidIso(it.createdAt) || !isValidIso(it.updatedAt)) fail(`${where}の日時が正しくありません`);
    if (it.doneAt !== null && !isValidIso(it.doneAt)) fail(`${where}の購入日時が正しくありません`);
    return {
      id: it.id, name: it.name, memo: it.memo, list: it.list, done: it.done, dueDate: it.dueDate,
      createdAt: it.createdAt, updatedAt: it.updatedAt, doneAt: it.doneAt,
    };
  });

  const keys = new Set();
  const history = data.history.map((x, n) => {
    const where = `品名履歴${n + 1}件目`;
    if (!x || typeof x !== 'object') fail(`${where}の形式が正しくありません`);
    if (typeof x.name !== 'string' || x.name.trim() !== x.name || x.name.length < 1 || x.name.length > NAME_MAX) {
      fail(`${where}の品名が正しくありません`);
    }
    if (typeof x.key !== 'string' || x.key !== normalizeName(x.name) || keys.has(x.key)) fail(`${where}のキーが正しくありません`);
    keys.add(x.key);
    if (!Number.isInteger(x.count) || x.count < 1) fail(`${where}の回数が正しくありません`);
    if (!isValidIso(x.lastBoughtAt)) fail(`${where}の日時が正しくありません`);
    return { key: x.key, name: x.name, count: x.count, lastBoughtAt: x.lastBoughtAt };
  });

  return { items, history };
}

async function importBackup(file, message) {
  let parsed;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('ファイルが大きすぎます');
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new Error('JSONファイルとして読み込めません');
    }
    parsed = validateBackup(json);
  } catch (e) {
    setBackupMessage(message, `読み込めませんでした：${e.message}（いまのデータは変更していません）`, true);
    return;
  }

  const ok = await confirmDialog(
    `いまのデータ（アイテム${state.items.length}件・履歴${state.history.length}件）を、`
    + `ファイルの内容（アイテム${parsed.items.length}件・履歴${parsed.history.length}件）で置き換えます。`
    + '元には戻せません。',
    '置き換える',
    true,
  );
  if (!ok) return;

  try {
    await db.replaceAll(parsed.items, parsed.history);
  } catch (e) {
    setBackupMessage(message, `置き換えに失敗しました：${e.message}（いまのデータは変更していません）`, true);
    return;
  }
  await reload();
  refreshList();
  showToast('バックアップを読み込みました');
}

// ---------- 起動 ----------

async function start() {
  try {
    await reload();
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty', text: `データを読み込めませんでした：${e.message}` }));
    return;
  }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist()
      .then((r) => { state.persisted = r; })
      .catch(() => { state.persisted = false; });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch((e) => console.warn('Service Workerの登録に失敗しました', e));
  }

  window.addEventListener('popstate', onLocationChange);
  window.addEventListener('hashchange', onLocationChange);
  // 日付が変わってから戻ってきたときに、期限切れの表示を更新する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshList();
  });

  render();
}

start();
