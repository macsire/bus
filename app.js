const STORAGE_KEY = 'familyBusSettings.v4';
const API_BASE = 'https://b-proxy.biscuit-trove0d.workers.dev';

const state = {
  settings: loadSettings(),
  selected: null,
  location: null,
  nearbyGroups: [],
  searchResults: [],
  lastArrivals: []
};

const cityStopCache = new Map();
const routeListCache = new Map();
const routeStopCache = new Map();
const $ = id => document.getElementById(id);

// 本地只保存分類與非數字路線的搜尋別名；站序與即時到站仍由 API 取得。
// 有 Worker /route-category 資料可查的分類，key 要跟 worker.js 的
// ROUTE_CATEGORIES 完全一致。「通勤」底下的內科/南軟專車也是靠這份
// 端點查，用兩層選單（先選子分類，再顯示清單）。
// 小、市民小巴、輕軌目前還沒有對應的官方分類對照表，維持原本的
// 「填入搜尋關鍵字」提示做法，不是真正的分類清單。
const CATEGORY_OPTIONS = {
  幹線: { title: '幹線專車', mode: 'list', category: '幹線專車' },
  通勤: { title: '通勤專車', mode: 'combined-list', categories: ['內科專車', '南軟專車'] },
  輕軌: { title: '輕軌接駁公車', mode: 'list', category: '輕軌接駁公車' },
  先導: { title: '捷運先導公車', mode: 'list', category: '捷運先導公車' },
  小: { title: '小型公車：請輸入路線名稱或編號', mode: 'query', query: '小' },
  市民小巴: { title: '市民小巴：請輸入路線名稱或編號', mode: 'query', query: '市民小巴' },
  新巴士F: { title: 'F 新巴士', mode: 'list', category: 'F新巴士' },
  跳蛙: { title: '跳蛙公車', mode: 'list', category: '跳蛙' },
  其他: { title: '其他特殊路線（觀光、花季、懷恩⋯）', mode: 'combined-list', categories: ['其他', '觀光巴士', '活動專車'] }
};

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      stops: Array.isArray(parsed.stops) ? parsed.stops : []
    };
  } catch {
    return { stops: [] };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

function normalize(value) {
  return String(value || '').replace(/[臺台\s]/g, '').toLowerCase();
}

function tdxName(value) {
  return value?.Zh_tw || value?.En || '';
}

function routeName(row) {
  return tdxName(row?.RouteName) || tdxName(row?.SubRouteName) ||
    String(row?.route || row || '').trim();
}

function cityLabel(city) {
  return city === 'Taipei' ? '臺北市' : city === 'NewTaipei' ? '新北市' : '';
}

function setStatus(kind, title, message) {
  if ($('statusDot')) $('statusDot').className = `status-dot ${kind || ''}`;
  if ($('statusTitle')) $('statusTitle').textContent = title;
  if ($('statusText')) $('statusText').textContent = message;
}

function showPanel(id) {
  document.querySelectorAll('.content-panel').forEach(panel => {
    panel.hidden = panel.id !== id;
  });
  $(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePanels() {
  document.querySelectorAll('.content-panel').forEach(panel => {
    panel.hidden = true;
  });
}

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`API ${res.status}`);
  }
  if (!res.ok || data?.error) {
    if (res.status === 429 || data?.status === 429) {
      throw new Error('TDX 暫時達到查詢上限，請稍候再試。');
    }
    throw new Error(data?.error || `API ${res.status}`);
  }
  return data;
}

function etaMinutes(row) {
  if (Number.isFinite(row.EstimateTime)) {
    return Math.max(0, Math.round(row.EstimateTime / 60));
  }
  if (row.NextBusTime) {
    const min = Math.round((new Date(row.NextBusTime) - Date.now()) / 60000);
    return min >= 0 ? min : null;
  }
  return null;
}

function etaStatus(row, minutes) {
  // TDX StopStatus：1 尚未發車、3 末班已過；2 為交管不停靠，不能當成資料遺失。
  const stopStatus = Number(row.StopStatus);
  if (stopStatus === 1) return '尚未發車';
  if (stopStatus === 3) return '末班已過';
  if (stopStatus === 2) return '暫不停靠';
  if (minutes === 0) return '即將到站';
  if (minutes != null) return `${minutes} 分`;
  return '即時資料暫時無法取得';
}

// 只有真的快到站（3 分鐘內、且不是尚未發車／末班已過這種狀態文字）才加粗，
// 其餘一律用一般字重，避免整排到站時間都用粗體、反而看不出誰真的快到了。
function isEtaSoon(row, minutes) {
  const stopStatus = Number(row.StopStatus);
  if (stopStatus === 1 || stopStatus === 3) return false;
  return minutes != null && minutes <= 3;
}

function vehicleLabel(row) {
  const plate = row?.PlateNumb || row?.VehicleID || row?.BusID;
  return plate ? String(plate) : '';
}

function haversine(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function stopIds(stop) {
  if (Array.isArray(stop?.ids) && stop.ids.length) return stop.ids;
  if (stop?.stopUID) return [stop.stopUID];
  if (stop?.id && !String(stop.id).startsWith('fav-')) return [stop.id];
  return [];
}

// 站牌清單（附近站牌／搜尋結果）裡的站名不需要每一筆都加粗，
// 只有使用者已經收藏在「我的常用」裡的站牌，才用加粗字重凸顯出來。
function isFavoriteStop(stop) {
  const ids = stopIds(stop);
  if (!ids.length) return false;
  return state.settings.stops.some(saved => {
    const savedIds = Array.isArray(saved.ids)
      ? saved.ids
      : [saved.stopUID || saved.id].filter(Boolean);
    return saved.city === stop.city && ids.some(id => savedIds.includes(id));
  });
}

function isFavoriteGroup(group) {
  return (group.members || []).some(isFavoriteStop);
}

async function loadCityStops(city) {
  if (!cityStopCache.has(city)) {
    cityStopCache.set(
      city,
      fetchJson(`/stops?city=${city}`).then(rows =>
        rows.map(stop => ({
          ...stop,
          city,
          routes: Array.isArray(stop.routes) ? stop.routes : []
        }))
      )
    );
  }
  try {
    return await cityStopCache.get(city);
  } catch (err) {
    cityStopCache.delete(city);
    throw err;
  }
}

async function searchCityStops(city, query) {
  const rows = await fetchJson(
    `/stops?city=${city}&query=${encodeURIComponent(query)}`
  );
  return (Array.isArray(rows) ? rows : []).map(stop => ({
    ...stop,
    city,
    routes: Array.isArray(stop.routes) ? stop.routes : []
  }));
}

async function getRouteList(city) {
  if (!routeListCache.has(city)) {
    routeListCache.set(city, fetchJson(`/route?city=${city}`));
  }
  try {
    return await routeListCache.get(city);
  } catch (err) {
    routeListCache.delete(city);
    throw err;
  }
}

async function searchCityRoutes(city, query) {
  const rows = await fetchJson(
    `/route?city=${city}&query=${encodeURIComponent(query)}`
  );
  return Array.isArray(rows) ? rows : [];
}

async function getRouteStopData(city, routeName) {
  const key = `${city}|${routeName}`;
  if (!routeStopCache.has(key)) {
    routeStopCache.set(
      key,
      fetchJson(`/stop?city=${city}&route=${encodeURIComponent(routeName)}`)
    );
  }
  try {
    return await routeStopCache.get(key);
  } catch (err) {
    routeStopCache.delete(key);
    throw err;
  }
}

/* ---------- 常用站牌 ---------- */

function prepareEditorUI() {
  if ($('routeEditor')) $('routeEditor').hidden = true;
  if ($('addRouteBtn')) $('addRouteBtn').hidden = true;

  if ($('nameInput')) {
    $('nameInput').readOnly = true;
    $('nameInput').required = false;
  }

  const label = document.querySelector('label[for="labelInput"]');
  if (label) label.textContent = '常用名稱';

  const nameLabel = document.querySelector('label[for="nameInput"]');
  if (nameLabel) nameLabel.textContent = '站牌';

  if ($('addStopBtn')) {
    $('addStopBtn').textContent = '＋ 從查詢結果加入常用';
  }
}

function renderStops() {
  const list = $('stopList');
  if (!list) return;

  if (!state.settings.stops.length) {
    list.innerHTML = `
      <div class="empty">
        尚未加入常用站牌。<br>
        請先從「附近站牌」或搜尋結果選擇站牌，再按「☆ 加入常用」。
      </div>`;
    return;
  }

  list.innerHTML = state.settings.stops.map(stop => `
    <div class="list-row">
      <div class="list-main">
        <strong>${esc(stop.label || stop.name)}</strong>
        <small>${esc([stop.name, cityLabel(stop.city)].filter(Boolean).join('｜'))}</small>
      </div>
      <div class="row-actions">
        <button class="mini-button" data-view-stop="${esc(stop.id)}">查看</button>
        <button class="mini-button" data-action="up-stop" data-id="${esc(stop.id)}">↑</button>
        <button class="mini-button" data-action="edit-stop" data-id="${esc(stop.id)}">改名</button>
        <button class="mini-button delete" data-action="delete-stop" data-id="${esc(stop.id)}">刪除</button>
      </div>
    </div>
  `).join('');
}

function openEditor(item) {
  if (!item) return;
  $('editId').value = item.id || '';
  $('editorTitle').textContent = '編輯常用名稱';
  $('labelInput').value = item.label || item.name || '';
  $('nameInput').value = item.name || '';
  showPanel('editorPanel');
}

function closeEditor() {
  if ($('editorPanel')) $('editorPanel').hidden = true;
  if (document.body.dataset.page === 'favorites' && $('stopsPanel')) {
    $('stopsPanel').hidden = false;
  }
}

function favoriteFromSelected() {
  const stop = state.selected;
  if (!stop || stop.kind === 'route') return;

  const ids = stopIds(stop);
  const exists = state.settings.stops.some(saved => {
    const savedIds = Array.isArray(saved.ids)
      ? saved.ids
      : [saved.stopUID || saved.id].filter(Boolean);
    return saved.city === stop.city && ids.some(id => savedIds.includes(id));
  });

  if (exists) {
    setStatus('', '已在常用', `「${stop.name}」已經在我的常用。`);
    return;
  }

  state.settings.stops.push({
    id: uid('fav'),
    label: stop.name,
    name: stop.name,
    city: stop.city || '',
    ids,
    stopUID: ids[0] || '',
    lat: stop.lat ?? null,
    lon: stop.lon ?? null
  });

  saveSettings();
  renderStops();
  setStatus('success', '已加入常用', `已收藏「${stop.name}」。`);
}

/* ---------- 路線站牌操作選單 ---------- */

function closeStopActionSheet() {
  $('stopActionSheet')?.remove();
}

function openStopActionSheet(stop) {
  closeStopActionSheet();
  const sheet = document.createElement('div');
  sheet.id = 'stopActionSheet';
  sheet.className = 'action-sheet-backdrop';
  sheet.innerHTML = `
    <section class="action-sheet" role="dialog" aria-modal="true" aria-labelledby="stopActionTitle">
      <button class="sheet-close" type="button" data-stop-sheet-close aria-label="關閉">×</button>
      <p class="eyebrow">${esc(stop.route || '公車站牌')}</p>
      <h2 id="stopActionTitle">${esc(stop.name)}</h2>
      <p class="sheet-subtitle">${esc(stop.direction || cityLabel(stop.city))}</p>
      <button class="sheet-action" type="button" data-stop-action="group">
        <span class="sheet-icon">＋</span><span>加入群組</span>
      </button>
      <button class="sheet-action sheet-primary" type="button" data-stop-action="arrival">
        <span class="sheet-icon">↗</span><span>查看即時到站</span>
      </button>
    </section>`;
  document.body.appendChild(sheet);
  sheet.querySelector('[data-stop-sheet-close]')?.focus();

  sheet.addEventListener('click', event => {
    if (event.target === sheet || event.target.closest('[data-stop-sheet-close]')) {
      closeStopActionSheet();
      return;
    }
    const action = event.target.closest('[data-stop-action]')?.dataset.stopAction;
    if (!action) return;

    if (action === 'arrival') {
      closeStopActionSheet();
      showArrivals(stop);
      return;
    }

    if (action === 'group') {
      const group = prompt('請輸入群組名稱', '我的常用');
      if (!group?.trim()) return;
      const ids = stopIds(stop);
      const exists = state.settings.stops.some(saved => {
        const savedIds = Array.isArray(saved.ids)
          ? saved.ids : [saved.stopUID || saved.id].filter(Boolean);
        return saved.group === group.trim() && saved.city === stop.city &&
          ids.some(id => savedIds.includes(id));
      });
      if (!exists) {
        state.settings.stops.push({
          id: uid('fav'), label: stop.name, name: stop.name,
          group: group.trim(), city: stop.city || '', ids,
          stopUID: ids[0] || '', lat: stop.lat ?? null, lon: stop.lon ?? null
        });
        saveSettings();
        renderStops();
      }
      setStatus('success', '已加入群組', `「${stop.name}」已加入「${group.trim()}」。`);
      closeStopActionSheet();
    }
  });
}

/* ---------- 到站結果操作 ---------- */

function renderResultActions() {
  let box = $('resultActions');
  if (!box) {
    box = document.createElement('div');
    box.id = 'resultActions';
    box.className = 'button-row';
    box.style.marginTop = '12px';
    $('arrivalList')?.insertAdjacentElement('afterend', box);
  }

  if (!state.selected || state.selected.kind === 'route') {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = '<button id="favoriteCurrentBtn" class="secondary-button" type="button">☆ 加入常用</button>';
  $('favoriteCurrentBtn')?.addEventListener('click', favoriteFromSelected);
}

/* ---------- ETA 與方向 ---------- */

function destinationFromRow(row) {
  const direct = tdxName(row.DirectionName);
  return direct ? (direct.startsWith('往') ? direct : `往 ${direct}`) : '行駛方向';
}

async function renderLiveArrivals(rows, stop) {
  const ids = stopIds(stop);
  const wantedName = normalize(stop.name);

  const matched = rows.filter(row => {
    if (ids.length) return ids.includes(row.StopUID);
    const name = normalize(tdxName(row.StopName));
    return name && (name.includes(wantedName) || wantedName.includes(name));
  });

  const unique = [...new Map(
    matched.map(row => [
      `${routeName(row)}|${row.StopUID || ''}|${row.Direction}`,
      row
    ])
  ).values()];

  const sorted = unique
    .filter(row => row.StopStatus !== 2)
    .sort((a, b) => (etaMinutes(a) ?? 999) - (etaMinutes(b) ?? 999))
    .slice(0, 16);

  // 這裡不再逐一呼叫 /stop 反查目的地：候車點清單重視「馬上能看到哪班車快到了」，
  // 有 DirectionName 就顯示，沒有就顯示通用的「行駛方向」，換取一次查詢不再併發
  // 大量請求（路線詳情頁另有 /live 端點負責完整的去程／返程與逐站資訊）。
  state.lastArrivals = sorted.map(row => ({
    route: routeName(row),
    direction: destinationFromRow(row),
    minutes: etaMinutes(row),
    status: row.StopStatus
  }));

  if (!sorted.length) {
    $('arrivalList').innerHTML = `<div class="empty">TDX 找不到這個候車點的即時資料。</div>`;
  } else {
    $('arrivalList').innerHTML = sorted.map(row => {
      const min = etaMinutes(row);
      const status = etaStatus(row, min);
      const soon = isEtaSoon(row, min);
      const plate = vehicleLabel(row);

      return `
      <article class="arrival-row">
          <div class="arrival-badge ${soon ? 'eta-soon' : ''}">${esc(status)}</div>
          <div>
            <div class="route-number">${esc(routeName(row))}</div>
            <strong>${esc(destinationFromRow(row))}</strong>
            <div class="route-destination">${esc(stop.name)}｜官方即時資料${plate ? `<span class="vehicle-plate">${esc(plate)}</span>` : ''}</div>
          </div>
        </article>`;
    }).join('');
  }

  renderResultActions();
  setStatus('success', '即時資料', '資料來自 TDX，會依公車回報狀態更新。');
}

async function loadLiveArrivals(stop) {
  const routeNames = [...new Set(
    (stop.routes || [])
      .map(route => String(route.route || route || '').trim())
      .filter(Boolean)
  )];

  const cities = stop.city ? [stop.city] : ['Taipei', 'NewTaipei'];
  let rows = [];

  if (routeNames.length) {
    const results = await Promise.allSettled(
      routeNames.flatMap(route =>
        cities.map(city =>
          fetchJson(`/eta?city=${city}&route=${encodeURIComponent(route)}`)
        )
      )
    );
    rows = results.flatMap(r =>
      r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
    );
  } else {
    const results = await Promise.allSettled(
      cities.map(city => fetchJson(`/eta?city=${city}`))
    );
    rows = results.flatMap(r =>
      r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []
    );
  }

  if (!rows.length) throw new Error('TDX 沒有回傳這個站牌的即時資料');
  await renderLiveArrivals(rows, stop);
}

async function showArrivals(stop, label = stop.name) {
  state.selected = stop;
  state.lastArrivals = [];

  $('resultTag').textContent = label;
  $('resultTitle').textContent = stop.name;
  $('arrivalList').innerHTML = `<div class="empty">正在查詢大臺北公車即時到站資料…</div>`;
  renderResultActions();

  $('resultPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    await loadLiveArrivals(stop);
  } catch (err) {
    $('arrivalList').innerHTML =
      `<div class="empty">即時資料暫時無法取得：${esc(err.message)}</div>`;
    state.lastArrivals = [];
    renderResultActions();
    setStatus('error', '即時資料暫時無法取得', err.message);
  }
}

/* ---------- 附近站牌 ---------- */

function groupNearbyStops(stops) {
  const map = new Map();

  for (const stop of stops) {
    const key = `${stop.city}|${normalize(stop.name)}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        name: stop.name,
        city: stop.city,
        distance: stop.distance,
        members: []
      });
    }

    const group = map.get(key);
    group.members.push(stop);
    group.distance = Math.min(group.distance, stop.distance);
  }

  return [...map.values()].sort((a, b) => a.distance - b.distance);
}

function renderNearbyGroups(groups) {
  if (!groups.length) {
    $('nearbyList').innerHTML =
      `<div class="empty">800 公尺內目前沒有找到公車站牌。</div>`;
    return;
  }

  $('nearbyList').innerHTML = groups.map(group => `
    <button class="list-row" data-nearby-group="${esc(group.key)}">
      <div class="list-main">
        <strong class="stop-name ${isFavoriteGroup(group) ? 'is-favorite' : ''}">${esc(group.name)}</strong>
        <small>
          最近 ${Math.round(group.distance)} 公尺
          ${group.members.length > 1 ? `｜${group.members.length} 個候車點` : ''}
        </small>
      </div>
      <span class="text-button">查看</span>
    </button>
  `).join('');
}

function renderNearbyGroupDetail(group) {
  const members = [...group.members].sort((a, b) => a.distance - b.distance);

  $('nearbyList').innerHTML = `
    <div class="list-row">
      <div class="list-main">
        <strong>${esc(group.name)}</strong>
        <small>${esc(cityLabel(group.city))}｜${members.length} 個候車點</small>
      </div>
      <button class="mini-button" data-nearby-back="1">返回</button>
    </div>

    ${members.map((stop, index) => `
      <button class="list-row"
        data-nearby-stop="${esc(stop.id)}"
        data-nearby-city="${esc(stop.city)}">
        <div class="list-main">
          <strong class="stop-name ${isFavoriteStop(stop) ? 'is-favorite' : ''}">${index + 1}. ${esc(stop.name)}</strong>
          <small>站牌｜${Math.round(stop.distance)} 公尺</small>
        </div>
        <span class="text-button">公車動態</span>
      </button>
    `).join('')}
  `;
}

async function loadNearbyGroups(location) {
  const results = await Promise.all(
    ['Taipei', 'NewTaipei'].map(async city => {
      const rows = await loadCityStops(city);
      return rows.map(stop => ({
        ...stop,
        distance: haversine(location, { lat: stop.lat, lon: stop.lon })
      }));
    })
  );

  const nearby = results
    .flat()
    .filter(stop => stop.distance <= 800)
    .sort((a, b) => a.distance - b.distance);

  return groupNearbyStops(nearby).slice(0, 30);
}

function locate() {
  if (!navigator.geolocation) {
    $('locationMessage').textContent =
      '這個瀏覽器不支援定位，請改用我的常用或搜尋站牌。';
    return;
  }

  $('locationMessage').textContent = '正在取得位置，請稍候…';

  navigator.geolocation.getCurrentPosition(
    async position => {
      state.location = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };

      try {
        state.nearbyGroups = await loadNearbyGroups(state.location);
        $('locationMessage').textContent =
          '已取得位置，顯示 800 公尺內的站牌群組';
        renderNearbyGroups(state.nearbyGroups);
        setStatus('success', '定位完成', '請先選站名，再選實際候車點。');
      } catch (err) {
        $('nearbyList').innerHTML =
          `<div class="empty">附近站牌資料暫時無法取得。</div>`;
        $('locationMessage').textContent = 'TDX 站牌資料暫時無法取得';
        setStatus('error', '站牌資料暫時無法取得', err.message);
      }
    },
    error => {
      $('locationMessage').textContent =
        `無法取得位置（${error.code}）。請確認瀏覽器的定位權限與系統定位服務。`;
      setStatus('error', '定位未完成', '沒有取得位置，並未儲存任何定位資料。');
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000
    }
  );
}

/* ---------- 搜尋 ---------- */

async function searchStationGroups(query) {
  const q = normalize(query);

  const results = await Promise.allSettled(
    ['Taipei', 'NewTaipei'].map(city => searchCityStops(city, query))
  );

  const groups = new Map();

  for (const stop of results.flatMap(r =>
    r.status === 'fulfilled' ? r.value : []
  )) {
    if (!normalize(stop.name).includes(q)) continue;

    const key = `${stop.city}|${normalize(stop.name)}`;

    if (!groups.has(key)) {
      groups.set(key, {
        kind: 'stop-group',
        key,
        name: stop.name,
        city: stop.city,
        members: []
      });
    }

    groups.get(key).members.push(stop);
  }

  return [...groups.values()].slice(0, 12);
}

async function searchRoutes(query, cities = ['Taipei', 'NewTaipei']) {
  const q = normalize(query);

  const results = await Promise.allSettled(
    cities.map(async city => {
      const routes = await searchCityRoutes(city, query);
      if (!Array.isArray(routes)) return [];

      return routes
        .filter(route => normalize(tdxName(route.RouteName)).startsWith(q))
        .map(route => ({
          kind: 'route',
          key: `${city}|route|${tdxName(route.RouteName)}`,
          name: tdxName(route.RouteName),
          city,
          routeUID: route.RouteUID || '',
          routeID: route.RouteID || '',
          subRoutes: route.SubRoutes || []
        }))
        .slice(0, 8);
    })
  );

  const seen = new Set();

  return results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(item => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
}

async function searchAll(query) {
  const normalized = normalize(query);

  // 「新北 F」是新北市公車分類，不需要再向臺北市查詢，
  // 也不需要同時查站牌；減少一次搜尋造成的 TDX 429 風險。
  if (normalized === 'f' || /^f\d/.test(normalized)) {
    return searchRoutes(query, ['NewTaipei']);
  }

  const [routes, stations] = await Promise.all([
    searchRoutes(query),
    searchStationGroups(query)
  ]);
  return [...routes, ...stations].slice(0, 20);
}

function renderSearchResults(items, query) {
  const box = $('searchResults');
  box.hidden = false;

  if (!items.length) {
    box.innerHTML =
      `<div class="empty">找不到「${esc(query)}」，請確認站牌或路線名稱，或改用附近站牌。</div>`;
    return;
  }

  box.innerHTML = items.map(item => {
    if (item.kind === 'route') {
      return `
        <button class="list-row route-result-row" data-route-result="${esc(item.key)}">
          <div class="list-main">
            <strong>${esc(item.name)}</strong>
            <small>${esc(cityLabel(item.city))}｜公車路線${item.categoryLabel ? ` <span class="category-tag">${esc(item.categoryLabel)}</span>` : ''}</small>
          </div>
          <span class="text-button">公車動態</span>
        </button>`;
    }

    return `
      <button class="list-row" data-stop-group-result="${esc(item.key)}">
        <div class="list-main">
          <strong class="stop-name ${isFavoriteGroup(item) ? 'is-favorite' : ''}">${esc(item.name)}</strong>
          <small>
            ${esc(cityLabel(item.city))}
            ${item.members.length > 1 ? `｜${item.members.length} 個候車點` : ''}
          </small>
        </div>
        <span class="text-button">公車動態</span>
      </button>`;
  }).join('');
}

function renderSearchStopGroup(group) {
  $('searchResults').innerHTML = `
    <div class="list-row">
      <div class="list-main">
        <strong>${esc(group.name)}</strong>
        <small>${esc(cityLabel(group.city))}｜${group.members.length} 個候車點</small>
      </div>
      <button class="mini-button" data-search-back="1">返回</button>
    </div>

    ${group.members.map((stop, index) => `
      <button class="list-row"
        data-search-stop="${esc(stop.id)}"
        data-search-city="${esc(stop.city)}">
        <div class="list-main">
          <strong class="stop-name ${isFavoriteStop(stop) ? 'is-favorite' : ''}">${index + 1}. ${esc(stop.name)}</strong>
          <small>站牌｜${esc(cityLabel(stop.city))}</small>
        </div>
        <span class="text-button">公車動態</span>
      </button>
    `).join('')}
  `;
}

/* ---------- 路線摘要 ---------- */

// 對應 Worker /live 回傳的 stopStatus 代碼（跟 TDX StopStatus 同一套），
// 邏輯跟 etaStatus() 一致，只是這裡的來源是 /live 合併後的欄位，不是原始 TDX row。
function liveStopStatusText(stop) {
  const status = Number(stop.stopStatus);
  if (status === 1) return '尚未發車';
  if (status === 3) return '末班已過';
  if (status === 2) return '暫不停靠';
  if (stop.eta === 0) return '即將到站';
  if (stop.eta != null) return `${stop.eta} 分`;
  return '即時資料暫時無法取得';
}

function liveStopPlateLabel(stop) {
  // 跟官方介面（ebus.gov.taipei）呈現方式一致：車號只在「即將到站」
  // 那一刻才顯示，其餘距離只顯示倒數分鐘數字，不特別秀車號；
  // 尚未發車／末班已過的狀態也不顯示車號，避免自相矛盾。「離站」
  // 事件不特別呈現，直接反映在下一站的倒數分鐘更新即可。
  if (stop.eta !== 0) return '';
  const plates = [...new Set((stop.buses || []).map(bus => bus.plate).filter(Boolean))];
  return plates.join('、');
}

function isLiveStopSoon(stop) {
  const status = Number(stop.stopStatus);
  if (status === 1 || status === 3) return false;
  return stop.eta != null && stop.eta <= 3;
}

async function renderRouteSummary(item) {
  $('searchResults').innerHTML = `<div class="empty">正在讀取路線、站牌與即時動態…</div>`;

  try {
    // /live 一次回傳站序、預估到站、即時車輛位置，取代原本「先查站序、
    // 再查到站、再逐一補查目的地」的三段式呼叫，減少 TDX 請求次數。
    const live = await fetchJson(`/live?city=${item.city}&route=${encodeURIComponent(item.name)}`);
    const directions = Array.isArray(live?.directions) ? live.directions : [];

    if (!directions.length) throw new Error('找不到路線站序');

    item._directions = directions;
    renderRouteDetail(item);
  } catch (err) {
    $('searchResults').innerHTML =
      `<div class="empty">路線資料暫時無法取得：${esc(err.message)}</div>`;
  }
}

function renderRouteDetail(item) {
  const directions = item._directions || [];
  const selectedIndex = Math.min(
    Number.isInteger(item._selectedDirection) ? item._selectedDirection : 0,
    Math.max(directions.length - 1, 0)
  );
  item._selectedDirection = selectedIndex;
  const selected = directions[selectedIndex];

  if (!selected) {
    $('searchResults').innerHTML = '<div class="empty">找不到可顯示的行駛方向。</div>';
    return;
  }

  const stops = selected.stops || [];
  const first = stops[0]?.stopName || '';
  const last = stops[stops.length - 1]?.stopName || '';
  const directionLabel = `往 ${last || '行駛方向'}`;

  $('searchResults').innerHTML = `
    <section class="route-result-shell" data-route-detail-key="${esc(item.key)}" aria-label="${esc(item.name)} 路線結果">
      <div class="route-primary-card">
        <div>
          <span class="route-primary-label">公車路線</span>
          <strong>${esc(item.name)}</strong>
          <small>${esc(cityLabel(item.city))}｜選擇行駛方向後查看站牌</small>
        </div>
        <button class="route-back-button" data-search-back="1">返回</button>
      </div>
      <div class="direction-tabs" role="tablist" aria-label="選擇行駛方向">
        ${directions.map((direction, index) => `
          <button class="direction-tab ${index === selectedIndex ? 'selected' : ''}"
            type="button" role="tab"
            aria-selected="${index === selectedIndex}"
            data-route-direction-index="${index}">
            ${esc(direction.directionLabel)}
          </button>
        `).join('')}
      </div>
      <section class="route-direction-block" aria-labelledby="route-selected-direction">
        <div class="route-direction-heading">
          <div>
            <span class="route-direction-kicker">${esc(selected.directionLabel)}</span>
            <h3 id="route-selected-direction">${esc(directionLabel)}</h3>
            <small>${esc(first)} → ${esc(last)}｜${stops.length} 站</small>
          </div>
          <span class="live-badge">即時動態</span>
        </div>
        <div class="route-stop-list">
          ${stops.map(stop => {
            const status = liveStopStatusText(stop);
            const plate = liveStopPlateLabel(stop);
            const soon = isLiveStopSoon(stop);
            const favorite = isFavoriteStop({ stopUID: stop.stopUID, city: item.city });

            return `
              <button class="route-stop-row" type="button"
                data-route-stop="${esc(stop.stopUID || '')}"
                data-route-stop-city="${esc(item.city)}"
                data-route-stop-name="${esc(stop.stopName)}"
                data-route-name="${esc(item.name)}"
                data-route-direction="${esc(directionLabel)}">
                <span class="stop-sequence">${stop.sequence}</span>
                <span class="route-stop-name ${favorite ? 'is-favorite' : ''}">${esc(stop.stopName)}</span>
                <span class="route-stop-meta">${plate ? `車號 ${esc(plate)}` : ''}</span>
                <span class="stop-arrival-status ${soon ? 'eta-soon' : ''}">${esc(status)}</span>
              </button>`;
          }).join('')}
        </div>
      </section>
      <p class="route-live-note">資料會顯示官方目前回報的到站狀態；若沒有車號，代表目前沒有可對應的車輛回報。</p>
    </section>
  `;
}

async function doSearch() {
  const query = $('searchInput').value.trim();

  $('categoryOptions').hidden = true;
  $('categoryOptions').innerHTML = '';
  document.querySelectorAll('.route-key').forEach(item => item.classList.remove('selected'));

  if (!query) {
    $('searchResults').hidden = true;
    $('searchResults').innerHTML = '';
    return;
  }

  $('searchResults').hidden = false;
  $('searchResults').innerHTML = `<div class="empty">搜尋中…</div>`;

  try {
    state.searchResults = await searchAll(query);
    renderSearchResults(state.searchResults, query);
  } catch (err) {
    $('searchResults').innerHTML =
      `<div class="empty">搜尋失敗：${esc(err.message)}</div>`;
  }
}

// 每個分類的「一眼看得出關聯」關鍵字：符合的排前面，其餘（像純數字
// 這種看不出關聯、但官方確實歸在這個分類的路線）排後面。這只影響
// 排序，不影響哪些路線會被列出來。
const CATEGORY_NAME_HINT = {
  '幹線專車': name => name.includes('幹線'),
  '捷運先導公車': name => name.includes('先導'),
  '內科專車': name => name.includes('內科'),
  '南軟專車': name => name.includes('南軟'),
  '跳蛙': name => name.includes('跳蛙'),
  'F新巴士': name => name.startsWith('F')
};

async function fetchCategoryRoutes(category) {
  const data = await fetchJson(`/route-category?category=${encodeURIComponent(category)}`);
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  const items = routes.map(route => ({
    kind: 'route',
    city: route.city,
    key: `${route.city}|route|${route.name}`,
    name: route.name,
    categoryLabel: category,
    routeUID: '', routeID: '', subRoutes: []
  }));

  const isNamed = CATEGORY_NAME_HINT[category];
  if (isNamed) {
    // 穩定排序：符合關鍵字的維持原順序排前面，其餘維持原順序排後面。
    return [
      ...items.filter(item => isNamed(item.name)),
      ...items.filter(item => !isNamed(item.name))
    ];
  }
  return items;
}

async function showCategoryList(category, label) {
  $('categoryOptions').hidden = true;
  $('categoryOptions').innerHTML = '';
  $('searchResults').hidden = false;
  $('searchResults').innerHTML = `<div class="empty">正在取得${esc(label)}路線…</div>`;

  try {
    state.searchResults = await fetchCategoryRoutes(category);
    renderSearchResults(state.searchResults, label);
  } catch (err) {
    $('searchResults').innerHTML = `<div class="empty">分類資料暫時無法取得：${esc(err.message)}</div>`;
  }
}

async function showCombinedCategoryList(categories, label) {
  $('categoryOptions').hidden = true;
  $('categoryOptions').innerHTML = '';
  $('searchResults').hidden = false;
  $('searchResults').innerHTML = `<div class="empty">正在取得${esc(label)}路線…</div>`;

  try {
    const groups = await Promise.all(categories.map(fetchCategoryRoutes));
    state.searchResults = groups.flat();
    renderSearchResults(state.searchResults, label);
  } catch (err) {
    $('searchResults').innerHTML = `<div class="empty">分類資料暫時無法取得：${esc(err.message)}</div>`;
  }
}

function renderCategoryOptions(categoryKey) {
  const box = $('categoryOptions');
  const config = CATEGORY_OPTIONS[categoryKey];
  if (!box || !config) return;

  // 每次切換分類鍵，先把「上一個分類的結果」跟「分類選項框」都清乾淨，
  // 不然會像「先按幹線、再按先導」那樣，兩批結果同時疊在畫面上。
  $('searchResults').hidden = true;
  $('searchResults').innerHTML = '';
  box.hidden = true;
  box.innerHTML = '';

  if (config.mode === 'list') {
    showCategoryList(config.category, config.title);
    return;
  }

  if (config.mode === 'combined-list') {
    showCombinedCategoryList(config.categories, config.title);
    return;
  }

  if (config.mode === 'submenu') {
    box.hidden = false;
    box.innerHTML = `
      <strong class="category-options-title">${esc(config.title)}</strong>
      <div class="category-option-grid">
        ${config.options.map(option => `
          <button class="category-option" type="button"
            data-category-list="${esc(option.category)}"
            data-category-label="${esc(option.label)}">${esc(option.label)}</button>
        `).join('')}
      </div>
    `;
    return;
  }

  // mode === 'query'：目前沒有官方分類對照表可查，維持原本
  // 「把關鍵字放進搜尋欄、請使用者自己按搜尋」的提示做法。
  $('searchInput').value = '';
  $('searchInput').placeholder = config.title;
  $('searchInput').focus();
}

/* ---------- 事件 ---------- */

document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset;
  if (!action) return;

  const index = state.settings.stops.findIndex(item => item.id === action.id);
  if (index < 0) return;

  if (action.action === 'delete-stop') {
    if (!confirm(`確定刪除「${state.settings.stops[index].label || state.settings.stops[index].name}」？`)) return;
    state.settings.stops.splice(index, 1);
    saveSettings();
    renderStops();
    return;
  }

  if (action.action === 'edit-stop') {
    openEditor(state.settings.stops[index]);
    return;
  }

  if (action.action === 'up-stop' && index > 0) {
    [state.settings.stops[index - 1], state.settings.stops[index]] =
      [state.settings.stops[index], state.settings.stops[index - 1]];
    saveSettings();
    renderStops();
  }
});

document.addEventListener('click', event => {
  const groupKey = event.target.closest('[data-nearby-group]')?.dataset.nearbyGroup;
  if (groupKey) {
    const group = state.nearbyGroups.find(item => item.key === groupKey);
    if (group) renderNearbyGroupDetail(group);
    return;
  }

  if (event.target.closest('[data-nearby-back]')) {
    renderNearbyGroups(state.nearbyGroups);
    return;
  }

  const nearbyStopEl = event.target.closest('[data-nearby-stop]');
  if (nearbyStopEl) {
    const stop = state.nearbyGroups
      .flatMap(group => group.members)
      .find(item =>
        item.id === nearbyStopEl.dataset.nearbyStop &&
        item.city === nearbyStopEl.dataset.nearbyCity
      );
    if (stop) showArrivals(stop);
    return;
  }

  const favoriteId = event.target.closest('[data-view-stop]')?.dataset.viewStop;
  if (favoriteId) {
    const stop = state.settings.stops.find(item => item.id === favoriteId);
    if (stop) showArrivals(stop, stop.label || stop.name);
    return;
  }

  const routeKey = event.target.closest('[data-route-result]')?.dataset.routeResult;
  if (routeKey) {
    const item = state.searchResults.find(row => row.key === routeKey);
    if (item) renderRouteSummary(item);
    return;
  }

  const stopGroupKey =
    event.target.closest('[data-stop-group-result]')?.dataset.stopGroupResult;
  if (stopGroupKey) {
    const group = state.searchResults.find(row => row.key === stopGroupKey);
    if (group) renderSearchStopGroup(group);
    return;
  }

  if (event.target.closest('[data-search-back]')) {
    renderSearchResults(state.searchResults, $('searchInput').value.trim());
    return;
  }

  const directionEl = event.target.closest('[data-route-direction-index]');
  if (directionEl) {
    const routeShell = event.target.closest('.route-result-shell');
    const routeKey = routeShell?.dataset.routeDetailKey;
    const item = state.searchResults.find(row => row.key === routeKey);
    if (item) {
      item._selectedDirection = Number(directionEl.dataset.routeDirectionIndex) || 0;
      renderRouteDetail(item);
    }
    return;
  }

  const searchStopEl = event.target.closest('[data-search-stop]');
  if (searchStopEl) {
    const stop = state.searchResults
      .filter(row => row.kind === 'stop-group')
      .flatMap(group => group.members)
      .find(item =>
        item.id === searchStopEl.dataset.searchStop &&
        item.city === searchStopEl.dataset.searchCity
      );
    if (stop) showArrivals(stop);
    return;
  }

  const expandEl = event.target.closest('[data-route-expand]');
  if (expandEl) {
    const item = state.searchResults.find(row => row.key === expandEl.dataset.routeKey);
    if (item) renderRouteSummary(item);
    return;
  }

  const summaryKey = event.target.closest('[data-route-summary]')?.dataset.routeSummary;
  if (summaryKey) {
    const item = state.searchResults.find(row => row.key === summaryKey);
    if (item) renderRouteSummary(item);
    return;
  }

  const routeStopEl = event.target.closest('[data-route-stop]');
  if (routeStopEl) {
    openStopActionSheet({
      id: routeStopEl.dataset.routeStop,
      stopUID: routeStopEl.dataset.routeStop,
      name: routeStopEl.dataset.routeStopName,
      city: routeStopEl.dataset.routeStopCity,
      route: routeStopEl.dataset.routeName,
      direction: routeStopEl.dataset.routeDirection,
      routes: [{ route: routeStopEl.dataset.routeName }]
    });
  }
});

/* ---------- UI 綁定 ---------- */

$('nearbyBtn')?.addEventListener('click', () => {
  showPanel('nearbyPanel');
  locate();
});

$('retryLocationBtn')?.addEventListener('click', locate);

$('stopsBtn')?.addEventListener('click', () => {
  renderStops();
  showPanel('stopsPanel');
});

$('settingsTopBtn')?.addEventListener('click', () => showPanel('settingsPanel'));

$('manageStopsBtn')?.addEventListener('click', () => {
  renderStops();
  showPanel('stopsPanel');
});

$('addStopBtn')?.addEventListener('click', () => {
  alert('請先從「附近站牌」或搜尋結果選擇站牌，再按「☆ 加入常用」。');
});

$('closeEditorBtn')?.addEventListener('click', closeEditor);
$('cancelEditorBtn')?.addEventListener('click', closeEditor);

document.querySelectorAll('[data-close-panel]').forEach(button => {
  button.addEventListener('click', closePanels);
});

$('searchForm')?.addEventListener('submit', event => {
  event.preventDefault();
  doSearch();
});

document.querySelectorAll('[data-route-prefix], [data-category]').forEach(button => {
  button.addEventListener('click', () => {
    const prefix = button.dataset.routePrefix;
    const category = button.dataset.category;
    const input = $('searchInput');
    if (!input) return;

    document.querySelectorAll('.route-key').forEach(item => item.classList.remove('selected'));
    button.classList.add('selected');
    if (category) {
      renderCategoryOptions(category);
      return;
    }

    // 色塊字頭（藍/紅/綠/棕/橘）跟分類鍵共用同一個結果區，切換時一樣要
    // 把分類鍵留下的清單清乾淨，不然會疊在一起。
    $('categoryOptions').hidden = true;
    $('categoryOptions').innerHTML = '';
    $('searchResults').hidden = true;
    $('searchResults').innerHTML = '';
    input.value = prefix || '';
    input.placeholder = `輸入${prefix}字頭路線，例如 ${prefix}1、${prefix}7`;
    input.focus();
  });
});

$('clearRouteFilterBtn')?.addEventListener('click', () => {
  const input = $('searchInput');
  if (input) {
    input.value = '';
    input.placeholder = '輸入站牌名稱或路線，例如 南京復興、306';
  }
  document.querySelectorAll('.route-key').forEach(item => item.classList.remove('selected'));
  if ($('categoryOptions')) {
    $('categoryOptions').hidden = true;
    $('categoryOptions').innerHTML = '';
  }
  if ($('searchResults')) {
    $('searchResults').hidden = true;
    $('searchResults').innerHTML = '';
  }
  state.searchResults = [];
  setStatus('', '準備查詢', '請選擇上方功能，或直接搜尋站牌／路線。');
  input?.focus();
});

document.addEventListener('click', event => {
  const option = event.target.closest('[data-category-list]');
  if (!option) return;

  const category = option.dataset.categoryList;
  const label = option.dataset.categoryLabel || category;
  showCategoryList(category, label);
});

/* ---------- 常用名稱編輯 ---------- */

$('editorForm')?.addEventListener('submit', event => {
  event.preventDefault();

  const id = $('editId').value;
  const index = state.settings.stops.findIndex(item => item.id === id);
  if (index < 0) return;

  const label = $('labelInput').value.trim();
  if (!label) {
    alert('請填寫常用名稱。');
    return;
  }

  state.settings.stops[index].label = label;
  saveSettings();
  renderStops();
  closeEditor();

  setStatus('', '設定已儲存', '已更新常用名稱。');
});

/* ---------- 備份 ---------- */

$('backupBtn')?.addEventListener('click', () => {
  const blob = new Blob(
    [JSON.stringify({
      app: 'mybus',
      version: 4,
      exportedAt: new Date().toISOString(),
      stops: state.settings.stops
    }, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mybus-settings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('restoreBtn')?.addEventListener('click', () => $('restoreInput')?.click());

$('restoreInput')?.addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.stops)) throw new Error();

    state.settings = { stops: data.stops };
    saveSettings();
    renderStops();
    setStatus('', '設定已匯入', '本機設定已還原。');
  } catch {
    alert('這不是有效的 MyBUS 設定檔。');
  }

  event.target.value = '';
});

/* ---------- 初始化 ---------- */

prepareEditorUI();
renderStops();
renderResultActions();
