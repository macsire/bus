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

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { stops: Array.isArray(parsed.stops) ? parsed.stops : [] };
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

/* ---------- AI 分享 ---------- */

function ensureResultActions() {
  let box = $('resultActions');
  if (box) return box;

  box = document.createElement('div');
  box.id = 'resultActions';
  box.className = 'button-row';
  box.style.marginTop = '12px';
  $('arrivalList')?.insertAdjacentElement('afterend', box);
  return box;
}

function buildAiText() {
  const stop = state.selected;
  if (!stop || stop.kind === 'route') return '';

  const lines = [
    '請根據以下即時公車資訊協助我規劃交通方式。',
    `目前站牌：${stop.name}${stop.city ? `（${cityLabel(stop.city)}）` : ''}`
  ];

  if (state.lastArrivals.length) {
    lines.push('目前到站資訊：');
    state.lastArrivals.slice(0, 8).forEach(item => {
      const time =
        item.status === 1 ? '尚未發車' :
        item.minutes === 0 ? '即將到站' :
        item.minutes == null ? '時間未提供' :
        `${item.minutes} 分`;
      lines.push(`- ${item.route}｜${item.direction}｜${time}`);
    });
  }

  lines.push('請先問我的目的地，再建議較簡單的搭車或轉乘方式。');
  return lines.join('\n');
}

async function handoffToAi() {
  const text = buildAiText();
  if (!text) return;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'MyBUS 公車資訊', text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    alert('已複製目前公車資訊。請開啟你慣用的 AI App 貼上即可。');
  } catch {
    window.prompt('複製以下內容到 AI App：', text);
  }
}

function renderResultActions() {
  const box = ensureResultActions();
  if (!box) return;

  if (!state.selected || state.selected.kind === 'route') {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <button id="favoriteCurrentBtn" class="secondary-button" type="button">☆ 加入常用</button>
    <button id="aiHandoffBtn" class="secondary-button" type="button">交給 AI 規劃</button>
  `;

  $('favoriteCurrentBtn')?.addEventListener('click', favoriteFromSelected);
  $('aiHandoffBtn')?.addEventListener('click', handoffToAi);
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

    let record = records.find(item =>
      Number(item.Direction) === direction &&
      Array.isArray(item.Stops) &&
      item.Stops.some(stop => stop.StopUID === stopUID)
    );

    if (!record) {
      record = records.find(item =>
        Number(item.Direction) === direction &&
        Array.isArray(item.Stops)
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
      `${tdxName(row.RouteName)}|${row.StopUID || ''}|${row.Direction}`,
      row
    ])
  ).values()];

  const sorted = unique
    .filter(row => row.StopStatus !== 2)
    .sort((a, b) => (etaMinutes(a) ?? 999) - (etaMinutes(b) ?? 999))
    .slice(0, 16);

  const directions = new Map();

  await Promise.all(sorted.map(async row => {
    const key = `${tdxName(row.RouteName)}|${row.Direction}|${row.StopUID || ''}`;
    if (!directions.has(key)) {
      directions.set(key, await getDestinationForEta(row, stop.city));
    }
  }));

  state.lastArrivals = sorted.map(row => {
    const key = `${tdxName(row.RouteName)}|${row.Direction}|${row.StopUID || ''}`;
    return {
      route: tdxName(row.RouteName),
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
      const status =
        row.StopStatus === 1 ? '尚未發車' :
        min === 0 ? '即將到站' :
        min == null ? '時間未提供' :
        `${min} 分`;

      const key = `${tdxName(row.RouteName)}|${row.Direction}|${row.StopUID || ''}`;

      return `
        <article class="arrival-row">
          <div class="route-number">${esc(tdxName(row.RouteName))}</div>
          <div>
            <strong>${esc(directions.get(key) || '行駛方向')}</strong>
            <div class="route-destination">${esc(stop.name)}｜TDX 即時資料</div>
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
  $('arrivalList').innerHTML = `<div class="empty">正在查詢 TDX 即時到站資料…</div>`;
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
          <strong>${members.length > 1 ? `候車點 ${index + 1}` : esc(stop.name)}</strong>
          <small>${Math.round(stop.distance)} 公尺</small>
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
    ['Taipei', 'NewTaipei'].map(loadCityStops)
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

async function searchRoutes(query) {
  const q = normalize(query);

  const results = await Promise.allSettled(
    ['Taipei', 'NewTaipei'].map(async city => {
      const routes = await getRouteList(city);
      if (!Array.isArray(routes)) return [];

      return routes
        .filter(route => normalize(tdxName(route.RouteName)).includes(q))
        .map(route => ({
          kind: 'route',
          key: `${city}|route|${tdxName(route.RouteName)}`,
          name: tdxName(route.RouteName),
          city
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
        <button class="list-row" data-route-result="${esc(item.key)}">
          <div class="list-main">
            <strong>${esc(item.name)}</strong>
            <small>${esc(cityLabel(item.city))}｜公車路線</small>
          </div>
          <span class="text-button">查看路線</span>
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
          <strong>${group.members.length > 1 ? `候車點 ${index + 1}` : esc(stop.name)}</strong>
          <small>${esc(stop.name)}</small>
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

async function renderRouteSummary(item) {
  $('searchResults').innerHTML = `<div class="empty">正在讀取路線方向…</div>`;

  try {
    const records = await getRouteStopData(item.city, item.name);
    const usable = (Array.isArray(records) ? records : [])
      .filter(record => Array.isArray(record.Stops) && record.Stops.length);

    if (!usable.length) throw new Error('找不到路線站序');

    const seen = new Set();
    const unique = [];

    for (const record of usable) {
      const s = summarizeDirection(record);
      const key = `${record.Direction}|${s.first}|${s.last}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ ...record, _summary: s });
    }

    item._records = unique;

    $('searchResults').innerHTML = `
      <div class="list-row">
        <div class="list-main">
          <strong>${esc(item.name)}</strong>
          <small>${esc(cityLabel(item.city))}｜${unique.length} 個方向</small>
        </div>
        <button class="mini-button" data-search-back="1">返回</button>
      </div>

      ${unique.map((record, index) => `
        <div class="list-row">
          <div class="list-main">
            <strong>${record._summary.last ? `往 ${esc(record._summary.last)}` : '行駛方向'}</strong>
            <small>
              ${esc(record._summary.first)} → ${esc(record._summary.last)}
              ｜${record._summary.count} 站
            </small>
          </div>
          <button class="mini-button"
            data-route-expand="${index}"
            data-route-key="${esc(item.key)}">
            沿線站牌
          </button>
        </div>
      `).join('')}
    `;
  } catch (err) {
    $('searchResults').innerHTML =
      `<div class="empty">路線資料暫時無法取得：${esc(err.message)}</div>`;
  }
}

function renderRouteStops(item, index) {
  const record = item._records?.[index];
  if (!record) return;

  const stops = record.Stops || [];

  $('searchResults').innerHTML = `
    <div class="list-row">
      <div class="list-main">
        <strong>
          ${esc(item.name)}｜
          ${record._summary.last ? `往 ${esc(record._summary.last)}` : '行駛方向'}
        </strong>
        <small>${stops.length} 站</small>
      </div>
      <button class="mini-button" data-route-summary="${esc(item.key)}">返回方向</button>
    </div>

    ${stops.map(stop => `
      <button class="list-row"
        data-route-stop="${esc(stop.StopUID || '')}"
        data-route-stop-city="${esc(item.city)}"
        data-route-stop-name="${esc(tdxName(stop.StopName))}"
        data-route-name="${esc(item.name)}">
        <div class="list-main">
          <strong>${esc(tdxName(stop.StopName))}</strong>
        </div>
        <span class="text-button">查到站</span>
      </button>
    `).join('')}
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
    if (item) renderRouteStops(item, Number(expandEl.dataset.routeExpand));
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
    showArrivals({
      id: routeStopEl.dataset.routeStop,
      stopUID: routeStopEl.dataset.routeStop,
      name: routeStopEl.dataset.routeStopName,
      city: routeStopEl.dataset.routeStopCity,
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
