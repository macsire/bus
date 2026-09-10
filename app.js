const API = {
  // 臺北市公共運輸處公開資料；若未來改用自家 Worker 代理，只需改這裡。
  estimate: 'https://tcgbusfs.blob.core.windows.net/blobbus/GetEstimateTime.gz'
};

const stops = {
  home: { name: '民權吉林路口', routes: ['307', '604', '277'], aliases: ['民權吉林路口'] },
  'taipei-main': { name: '臺北車站', routes: ['307', '260', '299'], aliases: ['臺北車站'] },
  xinsheng: { name: '捷運行天宮站', routes: ['49', '214', '225'], aliases: ['捷運行天宮站', '行天宮'] }
};

const demo = {
  home: [
    { route: '307', destination: '往板橋', minutes: 4 },
    { route: '604', destination: '往板橋', minutes: 9 },
    { route: '277', destination: '往榮總', minutes: 15 }
  ],
  'taipei-main': [
    { route: '307', destination: '往撫遠街', minutes: 6 },
    { route: '260', destination: '往陽明山', minutes: 12 },
    { route: '299', destination: '往永春高中', minutes: 18 }
  ],
  xinsheng: [
    { route: '49', destination: '往建國北路', minutes: 3 },
    { route: '214', destination: '往中和', minutes: 11 },
    { route: '225', destination: '往民生社區', minutes: 21 }
  ]
};

let selectedStop = 'home';
let selectedRoute = 'all';
let usingLive = false;

const $ = (id) => document.getElementById(id);

function renderChips() {
  $('quickRoutes').innerHTML = ['all', ...stops[selectedStop].routes].map((route) => `
    <button class="route-chip ${selectedRoute === route ? 'active' : ''}" type="button" data-route="${route}">
      ${route === 'all' ? '全部路線' : route}
    </button>`).join('');
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => { selectedRoute = button.dataset.route; render(); });
  });
}

function renderArrivals(items) {
  const filtered = selectedRoute === 'all' ? items : items.filter((item) => item.route === selectedRoute);
  $('arrivalList').innerHTML = filtered.length ? filtered.map((item) => `
    <article class="arrival-row">
      <div class="route-number">${item.route}</div>
      <div><strong>${item.destination}</strong><div class="route-destination">臺北市公車</div></div>
      <div class="arrival-time"><strong>${item.minutes === 0 ? '進站中' : `${item.minutes} 分`}</strong><small>${item.minutes === 0 ? '請準備上車' : '預估到站'}</small></div>
    </article>`).join('') : '<div class="empty">這個站牌目前沒有符合的路線。</div>';
}

function setStatus(live, text) {
  usingLive = live;
  $('statusDot').className = `status-dot ${live ? 'live' : 'error'}`;
  $('statusTitle').textContent = live ? '即時資料' : '示範資料';
  $('statusText').textContent = text;
  $('updatedAt').textContent = `更新 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
}

function render(items = demo[selectedStop]) {
  $('stopName').textContent = stops[selectedStop].name;
  $('directionHint').textContent = selectedRoute === 'all' ? '雙向' : `路線 ${selectedRoute}`;
  renderChips();
  renderArrivals(items);
}

function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && (row.RouteName?.Zh_tw || row.RouteName || row.RouteNameZh)).map((row) => ({
    route: row.RouteName?.Zh_tw || row.RouteName || row.RouteNameZh,
    destination: row.StopName?.Zh_tw || row.DirectionName || '往市區',
    minutes: Math.max(0, Math.round(Number(row.EstimateTime || row.EstimateMinutes || 0) / (row.EstimateMinutes ? 1 : 60)))
  })).filter((row) => row.route);
}

async function loadLive() {
  setStatus(false, '正在讀取臺北市公共運輸處資料…');
  try {
    const response = await fetch(API.estimate, { cache: 'no-store' });
    if (!response.ok) throw new Error('資料來源暫時無法連線');
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.data || payload.Data || [];
    const name = stops[selectedStop].aliases;
    const live = normalize(rows.filter((row) => name.some((alias) => JSON.stringify(row).includes(alias))));
    if (!live.length) throw new Error('找不到這個站牌的即時資料');
    setStatus(true, '資料已由臺北市公共運輸處更新');
    render(live);
  } catch (error) {
    setStatus(false, '目前暫時讀不到即時資料，以下顯示示範畫面');
    render();
  }
}

function refresh() { loadLive(); }

$('stopSelect').addEventListener('change', (event) => { selectedStop = event.target.value; selectedRoute = 'all'; loadLive(); });
$('refreshBtn').addEventListener('click', refresh);
render();
loadLive();
