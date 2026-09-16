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
const LOCAL_ROUTE_INDEX = [
  {
    name: '景美-榮總(快)',
    city: 'Taipei',
    category: '快速',
    aliases: ['景美-榮總', '景美—榮總', '景美榮總']
  },
  {
    name: '629汐東捷運先導公車',
    query: '629',
    city: 'NewTaipei',
    category: '先導',
    aliases: ['629先導公車', '汐東捷運先導公車']
  },
  {
    name: '985萬大樹林先導公車',
    query: '985',
    city: 'NewTaipei',
    category: '先導',
    aliases: ['985先導公車', '萬大樹林先導公車']
  },
  {
    name: '藍海2線先導公車',
    city: 'NewTaipei',
    category: '先導',
    aliases: ['藍海2線', '藍海2線先導']
  }
];

const CATEGORY_OPTIONS = {
  幹線: { title: '幹線路線', query: '幹線', list: true },
  通勤: { title: '通勤路線', options: ['內科', '南軟'] },
  輕軌: { title: '輕軌接駁：請輸入路線名稱或編號', query: '輕軌' },
  先導: { title: '先導公車', local: LOCAL_ROUTE_INDEX.filter(item => item.category === '先導') },
  小: { title: '小型公車：請輸入路線名稱或編號', query: '小' },
  市民小巴: { title: '市民小巴：請輸入路線名稱或編號', query: '市民小巴' },
  跳蛙: { title: '跳蛙：請輸入路線名稱或起訖點', query: '跳蛙' },
  其他: {
    title: '其他特殊路線',
    options: ['觀光', '花季', '假日', '活動專車', '兒童樂園', '停車場接駁', '懷恩', '其他接駁']
  }
};

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      stops: Array.isArray(parsed.stops) ? parsed.stops : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : []
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

function localRouteMatch(query) {
  const q = normalize(query);
  return LOCAL_ROUTE_INDEX.find(item =>
    normalize(item.name) === q || item.aliases.some(alias => normalize(alias) === q)
  );
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
      <button class="sheet-action" type="button" data-stop-action="reminder">
        <span class="sheet-icon">♧</span><span>設定到站提醒</span>
      </button>
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
      return;
    }

    if (action === 'reminder') {
      const minutes = Number(prompt('提前幾分鐘提醒？', '5'));
      if (!Number.isFinite(minutes) || minutes < 0) return;
      const reminder = {
        id: uid('reminder'), stopUID: stop.stopUID || stop.id,
        name: stop.name, city: stop.city || '', route: stop.route || '',
        minutes: Math.round(minutes), enabled: true
      };
      state.settings.reminders = (state.settings.reminders || [])
        .filter(item => item.stopUID !== reminder.stopUID || item.route !== reminder.route);
      state.settings.reminders.push(reminder);
      saveSettings();
      setStatus('success', '已設定提醒', `到站前 ${reminder.minutes} 分鐘提醒「${stop.name}」。`);
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

async function getDestinationForEta(row, city) {
  const direct = tdxName(row.DirectionName);
  if (direct) return direct.startsWith('往') ? direct : `往 ${direct}`;

  const routeName = tdxName(row.RouteName);
  if (!routeName || !city) return '行駛方向';

  try {
    const records = await getRouteStopData(city, routeName);
    if (!Array.isArray(records)) return '行駛方向';

    const direction = Number(row.Direction);
    const stopUID = row.StopUID;

    // 部分新北 F 路線的 stop 回應沒有 Direction；先用實際站序比對，
    // 否則會把同一路線的另一個方向誤當成目前公車方向。
    let record = records.find(item =>
      (!Number.isFinite(direction) || !Number.isFinite(Number(item.Direction)) ||
        Number(item.Direction) === direction) &&
      Array.isArray(item.Stops) &&
      item.Stops.some(stop => stop.StopUID === stopUID)
    );

    if (!record) {
      record = records.find(item =>
        Array.isArray(item.Stops) && item.Stops.some(stop => stop.StopUID === stopUID)
      );
    }

    const last = record?.Stops?.[record.Stops.length - 1];
    const destination = tdxName(last?.StopName);
    return destination ? `往 ${destination}` : '行駛方向';
  } catch {
    return '行駛方向';
  }
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

  const directions = new Map();

  await Promise.all(sorted.map(async row => {
    const key = `${routeName(row)}|${row.Direction}|${row.StopUID || ''}`;
    if (!directions.has(key)) {
      directions.set(key, await getDestinationForEta(row, stop.city));
    }
  }));

  state.lastArrivals = sorted.map(row => {
    const key = `${routeName(row)}|${row.Direction}|${row.StopUID || ''}`;
    return {
      route: routeName(row),
      direction: directions.get(key) || '行駛方向',
      minutes: etaMinutes(row),
      status: row.StopStatus
    };
  });

  if (!sorted.length) {
    $('arrivalList').innerHTML = `<div class="empty">TDX 找不到這個候車點的即時資料。</div>`;
  } else {
    $('arrivalList').innerHTML = sorted.map(row => {
      const min = etaMinutes(row);
      const status = etaStatus(row, min);

      const key = `${routeName(row)}|${row.Direction}|${row.StopUID || ''}`;

      return `
      <article class="arrival-row">
          <div class="route-number">${esc(routeName(row))}</div>
          <div>
            <strong>${esc(directions.get(key) || '行駛方向')}</strong>
            <div class="route-destination">${esc(stop.name)}｜官方即時資料</div>
          </div>
          <div class="arrival-time">
            <strong>${esc(status)}</strong>
            <small>預估到站</small>
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
        <strong>${esc(group.name)}</strong>
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
          <strong>${index + 1}. ${esc(stop.name)}</strong>
          <small>站牌｜${Math.round(stop.distance)} 公尺</small>
        </div>
        <span class="text-button">查到站</span>
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
  const local = localRouteMatch(query);
  const routeQuery = local?.query || local?.name || query;
  const q = normalize(routeQuery);

  const results = await Promise.allSettled(
    cities.map(async city => {
      if (local && city !== local.city) return [];
      const routes = await searchCityRoutes(city, routeQuery);
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
      const ends = [...new Set((item.subRoutes || []).map(sub => {
        const name = tdxName(sub.RouteName) || tdxName(sub.SubRouteName);
        return name;
      }).filter(Boolean))].slice(0, 2);
      return `
        <button class="list-row" data-route-result="${esc(item.key)}">
          <div class="list-main">
            <strong>${esc(item.name)}</strong>
            <small>${esc(cityLabel(item.city))}｜${ends.length ? esc(ends.join(' ↔ ')) : '公車路線'}</small>
          </div>
          <span class="text-button">查看到站</span>
        </button>`;
    }

    return `
      <button class="list-row" data-stop-group-result="${esc(item.key)}">
        <div class="list-main">
          <strong>${esc(item.name)}</strong>
          <small>
            ${esc(cityLabel(item.city))}
            ${item.members.length > 1 ? `｜${item.members.length} 個候車點` : ''}
          </small>
        </div>
        <span class="text-button">查看</span>
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
          <strong>${index + 1}. ${esc(stop.name)}</strong>
          <small>站牌｜${esc(cityLabel(stop.city))}</small>
        </div>
        <span class="text-button">查到站</span>
      </button>
    `).join('')}
  `;
}

/* ---------- 路線摘要 ---------- */

function summarizeDirection(record) {
  const stops = Array.isArray(record?.Stops) ? record.Stops : [];
  return {
    first: tdxName(stops[0]?.StopName),
    last: tdxName(stops[stops.length - 1]?.StopName),
    count: stops.length
  };
}

async function getRouteEta(item) {
  try {
    const rows = await fetchJson(`/eta?city=${item.city}&route=${encodeURIComponent(item.name)}`);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function directionRows(record, etaRows) {
  const direction = Number(record.Direction);
  return new Map(
    etaRows
      .filter(row => !Number.isFinite(direction) || !Number.isFinite(Number(row.Direction)) || Number(row.Direction) === direction)
      .map(row => [row.StopUID, row])
  );
}

async function renderRouteSummary(item) {
  $('searchResults').innerHTML = `<div class="empty">正在讀取路線、站牌與即時動態…</div>`;

  try {
    const records = await getRouteStopData(item.city, item.name);
    const usable = (Array.isArray(records) ? records : [])
      .filter(record => Array.isArray(record.Stops) && record.Stops.length);

    if (!usable.length) throw new Error('找不到路線站序');

    // 同一條路線可能因 SubRouteUID 或業者資料版本而回傳多筆相同方向。
    // 路線頁先收斂成「去程／返程」兩個選擇；若同方向有多筆，採站序較完整者。
    const byDirection = new Map();
    for (const record of usable) {
      const summary = summarizeDirection(record);
      const direction = Number.isFinite(Number(record.Direction))
        ? Number(record.Direction)
        : byDirection.size;
      const current = byDirection.get(direction);
      if (!current || summary.count > current._summary.count) {
        byDirection.set(direction, {
          ...record,
          _summary: summary,
          _directionValue: direction
        });
      }
    }

    item._records = [...byDirection.values()]
      .sort((a, b) => a._directionValue - b._directionValue)
      .map((record, index) => ({
        ...record,
        _directionIndex: index,
        _directionLabel: index === 0 ? '去程' : index === 1 ? '返程' : `支線 ${index + 1}`
      }));

    const etaRows = await getRouteEta(item);
    item._etaRows = etaRows;
    renderRouteDetail(item, etaRows);
  } catch (err) {
    $('searchResults').innerHTML =
      `<div class="empty">路線資料暫時無法取得：${esc(err.message)}</div>`;
  }
}

function renderRouteDetail(item, etaRows) {
  const records = item._records || [];
  const selectedIndex = Math.min(
    Number.isInteger(item._selectedDirection) ? item._selectedDirection : 0,
    Math.max(records.length - 1, 0)
  );
  item._selectedDirection = selectedIndex;
  const selected = records[selectedIndex];

  if (!selected) {
    $('searchResults').innerHTML = '<div class="empty">找不到可顯示的行駛方向。</div>';
    return;
  }

  const etaByStop = directionRows(selected, etaRows);
  const directionLabel = `往 ${selected._summary.last || '行駛方向'}`;

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
        ${records.map((record, index) => `
          <button class="direction-tab ${index === selectedIndex ? 'selected' : ''}"
            type="button" role="tab"
            aria-selected="${index === selectedIndex}"
            data-route-direction-index="${index}">
            ${esc(record._directionLabel)}
          </button>
        `).join('')}
      </div>
      <section class="route-direction-block" aria-labelledby="route-selected-direction">
        <div class="route-direction-heading">
          <div>
            <span class="route-direction-kicker">${esc(selected._directionLabel)}</span>
            <h3 id="route-selected-direction">${esc(directionLabel)}</h3>
            <small>${esc(selected._summary.first)} → ${esc(selected._summary.last)}｜${selected._summary.count} 站</small>
          </div>
          <span class="live-badge">即時動態</span>
        </div>
        <div class="route-stop-list">
          ${(selected.Stops || []).map((stop, stopIndex) => {
            const eta = etaByStop.get(stop.StopUID);
            const status = eta ? etaStatus(eta, etaMinutes(eta)) : '即時資料暫時無法取得';
            const plate = eta ? vehicleLabel(eta) : '';
            return `
              <button class="route-stop-row" type="button"
                data-route-stop="${esc(stop.StopUID || '')}"
                data-route-stop-city="${esc(item.city)}"
                data-route-stop-name="${esc(tdxName(stop.StopName))}"
                data-route-name="${esc(item.name)}"
                data-route-direction="${esc(directionLabel)}">
                <span class="stop-sequence">${stopIndex + 1}</span>
                <span class="route-stop-name">${esc(tdxName(stop.StopName))}</span>
                <span class="route-stop-meta">${plate ? `車號 ${esc(plate)}` : ''}</span>
                <span class="stop-arrival-status">${esc(status)}</span>
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

function renderCategoryOptions(category) {
  const box = $('categoryOptions');
  const config = CATEGORY_OPTIONS[category];
  if (!box || !config) return;

  const localItems = config.local || [];
  const options = config.options || [];
  box.hidden = false;
  box.innerHTML = `
    <strong class="category-options-title">${esc(config.title)}</strong>
    ${localItems.length ? `
      <div class="category-option-grid">
        ${localItems.map(item => `
          <button class="category-option" type="button"
            data-category-query="${esc(item.name)}">${esc(item.name)}</button>
        `).join('')}
      </div>` : ''}
    ${options.length ? `
      <div class="category-option-grid">
        ${options.map(option => `
          <button class="category-option" type="button"
            data-category-query="${esc(option)}">${esc(option)}</button>
        `).join('')}
      </div>` : ''}
    ${config.query ? `<p class="helper-text">請在上方搜尋欄輸入完整路線，再按「搜尋」。</p>` : ''}
  `;

  if (config.query && config.list) {
    box.innerHTML = `<strong class="category-options-title">${esc(config.title)}</strong><div class="empty">正在取得全部${esc(category)}路線…</div>`;
    $('searchResults').hidden = false;
    $('searchResults').innerHTML = '';
    // 分類不是路線名稱搜尋：先取路線主檔，再依名稱／分類關鍵字篩選，
    // 才能找到「內湖幹線」這類關鍵字不在開頭的路線。
    Promise.allSettled([
      getRouteList('Taipei'),
      getRouteList('NewTaipei')
    ]).then(results => {
      const rows = results.flatMap((result, index) =>
        result.status === 'fulfilled' && Array.isArray(result.value)
          ? result.value.filter(route => normalize(tdxName(route.RouteName)).includes(normalize(category))).map(route => ({
            kind: 'route', city: index === 0 ? 'Taipei' : 'NewTaipei',
            key: `${index === 0 ? 'Taipei' : 'NewTaipei'}|route|${tdxName(route.RouteName)}`,
            name: tdxName(route.RouteName),
            routeUID: route.RouteUID || '', routeID: route.RouteID || '',
            subRoutes: route.SubRoutes || []
          })) : []
      ).filter(item => item.name);
      state.searchResults = [...new Map(rows.map(item => [item.key, item])).values()];
      renderSearchResults(state.searchResults, category);
    });
    return;
  }

  if (config.query) {
    $('searchInput').value = '';
    $('searchInput').placeholder = config.title;
  }
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
      renderRouteDetail(item, item._etaRows || []);
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

    $('categoryOptions').hidden = true;
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
  const option = event.target.closest('[data-category-query]');
  if (!option) return;

  const query = option.dataset.categoryQuery;
  const input = $('searchInput');
  if (!input) return;

  input.value = query;
  input.placeholder = `已選分類：${query}；請按「搜尋」`;
  input.focus();
  $('categoryOptions').hidden = true;
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
