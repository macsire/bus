const STORAGE_KEY = 'familyBusSettings.v4';
const API_BASE = 'https://b-proxy.biscuit-trove0d.workers.dev';

const state = {
  settings: loadSettings(),
  selected: null,
  location: null,
  nearbyGroups: [],
  searchResults: [],
  lastArrivals: [],
  editingFavorite: null,
};

const routeStopCache = new Map();
const routeListCache = new Map();
const cityStopCache = new Map();

const $ = (id) => document.getElementById(id);


/* =========================================================
   基本工具
========================================================= */

function loadSettings() {
  try {
    const parsed =
      JSON.parse(
        localStorage.getItem(STORAGE_KEY) || '{}'
      );

    return {
      stops:
        Array.isArray(parsed.stops)
          ? parsed.stops
          : [],
    };

  } catch {
    return {
      stops: [],
    };
  }
}


function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(state.settings)
  );
}


function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}


function esc(value) {
  return String(value ?? '')
    .replace(
      /[&<>'"]/g,
      (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      }[c])
    );
}


function normalize(value) {
  return String(value || '')
    .replace(/[臺台\s]/g, '')
    .toLowerCase();
}


function tdxName(value) {
  return (
    value?.Zh_tw ||
    value?.En ||
    ''
  );
}


function cityLabel(city) {
  if (city === 'Taipei') {
    return '臺北市';
  }

  if (city === 'NewTaipei') {
    return '新北市';
  }

  return '';
}


function setStatus(
  kind,
  title,
  message
) {
  $('statusDot').className =
    `status-dot ${kind || ''}`;

  $('statusTitle').textContent =
    title;

  $('statusText').textContent =
    message;
}


function showPanel(id) {
  document
    .querySelectorAll('.content-panel')
    .forEach((panel) => {
      panel.hidden =
        panel.id !== id;
    });

  $(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}


function closePanels() {
  document
    .querySelectorAll('.content-panel')
    .forEach((panel) => {
      panel.hidden = true;
    });
}


function apiUrl(path) {
  return `${API_BASE}${path}`;
}


async function fetchJson(path) {
  const response =
    await fetch(
      apiUrl(path)
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    data?.error
  ) {
    throw new Error(
      data?.error ||
      `API ${response.status}`
    );
  }

  return data;
}


/* =========================================================
   ETA
========================================================= */

function etaMinutes(row) {
  if (
    Number.isFinite(
      row.EstimateTime
    )
  ) {
    return Math.max(
      0,
      Math.round(
        row.EstimateTime / 60
      )
    );
  }

  if (row.NextBusTime) {
    const minutes =
      Math.round(
        (
          new Date(row.NextBusTime) -
          Date.now()
        ) / 60000
      );

    return (
      minutes >= 0
        ? minutes
        : null
    );
  }

  return null;
}


/* =========================================================
   距離
========================================================= */

function haversine(a, b) {
  const rad =
    Math.PI / 180;

  const dLat =
    (b.lat - a.lat) *
    rad;

  const dLon =
    (b.lon - a.lon) *
    rad;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) *
    Math.cos(b.lat * rad) *
    Math.sin(dLon / 2) ** 2;

  return (
    6371000 *
    2 *
    Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    )
  );
}


/* =========================================================
   StopUID
========================================================= */

function stopIds(stop) {
  if (
    Array.isArray(stop?.ids) &&
    stop.ids.length
  ) {
    return stop.ids;
  }

  if (stop?.stopUID) {
    return [
      stop.stopUID
    ];
  }

  if (
    stop?.id &&
    !String(stop.id)
      .startsWith('fav-')
  ) {
    return [
      stop.id
    ];
  }

  return [];
}


/* =========================================================
   API 快取
========================================================= */

async function loadCityStops(city) {
  if (
    !cityStopCache.has(city)
  ) {
    cityStopCache.set(
      city,

      fetchJson(
        `/stops?city=${city}`
      ).then(
        (rows) =>
          rows.map(
            (stop) => ({
              ...stop,

              city,

              routes:
                Array.isArray(stop.routes)
                  ? stop.routes
                  : [],
            })
          )
      )
    );
  }

  try {
    return await cityStopCache.get(
      city
    );

  } catch (error) {
    cityStopCache.delete(
      city
    );

    throw error;
  }
}


async function getRouteList(city) {
  if (
    !routeListCache.has(city)
  ) {
    routeListCache.set(
      city,

      fetchJson(
        `/route?city=${city}`
      )
    );
  }

  try {
    return await routeListCache.get(
      city
    );

  } catch (error) {
    routeListCache.delete(
      city
    );

    throw error;
  }
}


async function getRouteStopData(
  city,
  routeName
) {
  const key =
    `${city}|${routeName}`;

  if (
    !routeStopCache.has(key)
  ) {
    routeStopCache.set(
      key,

      fetchJson(
        `/stop?city=${city}&route=${encodeURIComponent(routeName)}`
      )
    );
  }

  try {
    return await routeStopCache.get(
      key
    );

  } catch (error) {
    routeStopCache.delete(
      key
    );

    throw error;
  }
}


/* =========================================================
   我的常用
========================================================= */

function prepareEditorUI() {
  const routeEditor =
    $('routeEditor');

  if (routeEditor) {
    routeEditor.hidden =
      true;
  }


  const addRouteBtn =
    $('addRouteBtn');

  if (addRouteBtn) {
    addRouteBtn.hidden =
      true;
  }


  const nameInput =
    $('nameInput');

  if (nameInput) {
    nameInput.readOnly =
      true;

    nameInput.required =
      false;
  }


  const label =
    document.querySelector(
      'label[for="labelInput"]'
    );

  if (label) {
    label.textContent =
      '常用名稱';
  }


  const nameLabel =
    document.querySelector(
      'label[for="nameInput"]'
    );

  if (nameLabel) {
    nameLabel.textContent =
      '站牌';
  }


  const addStopBtn =
    $('addStopBtn');

  if (addStopBtn) {
    addStopBtn.textContent =
      '＋ 從查詢結果加入常用';
  }
}


function renderStops() {
  const list =
    $('stopList');


  if (
    !state.settings.stops.length
  ) {
    list.innerHTML =
      `<div class="empty">
        尚未加入常用站牌。<br>
        請先從附近站牌或搜尋結果選擇站牌，
        再按「☆ 加入常用」。
      </div>`;

    return;
  }


  list.innerHTML =
    state.settings.stops
      .map(
        (stop) => {

          const subtitle =
            [
              stop.name,
              cityLabel(stop.city),
            ]
              .filter(Boolean)
              .join('｜');


          return `
            <div class="list-row">

              <div class="list-main">

                <strong>
                  ${esc(
                    stop.label ||
                    stop.name
                  )}
                </strong>

                <small>
                  ${esc(subtitle)}
                </small>

              </div>

              <div class="row-actions">

                <button
                  class="mini-button"
                  data-view-stop="${esc(stop.id)}">
                  查看
                </button>

                <button
                  class="mini-button"
                  data-action="up-stop"
                  data-id="${esc(stop.id)}"
                  aria-label="上移">
                  ↑
                </button>

                <button
                  class="mini-button"
                  data-action="edit-stop"
                  data-id="${esc(stop.id)}">
                  改名
                </button>

                <button
                  class="mini-button delete"
                  data-action="delete-stop"
                  data-id="${esc(stop.id)}">
                  刪除
                </button>

              </div>

            </div>
          `;
        }
      )
      .join('');
}


function openEditor(item) {
  if (!item) {
    alert(
      '請先從「附近站牌」或搜尋結果選擇站牌，再加入常用。'
    );

    return;
  }


  state.editingFavorite =
    item;


  $('editId').value =
    item.id ||
    '';


  $('editorTitle').textContent =
    '編輯常