const STORAGE_KEY = 'familyBusSettings.v4';
const API_BASE = 'https://b-proxy.biscuit-trove0d.workers.dev';

const state = {
  settings: loadSettings(),
  selected: null,
  location: null,
  nearbyStops: [],
  searchResults: []
};

const routeStopCache = new Map();

const $ = (id) => document.getElementById(id);

const demoStops = [
  {
    id: 'demo-taipei-main',
    name: '臺北車站',
    lat: 25.0478,
    lon: 121.5170,
    routes: [
      { route: '919', directionA: '往新店', directionB: '往北車' },
      { route: '307', directionA: '往板橋', directionB: '往撫遠街' }
    ]
  },
  {
    id: 'demo-ximen',
    name: '捷運西門站',
    lat: 25.0423,
    lon: 121.5080,
    routes: [
      { route: '965', directionA: '往九份', directionB: '往板橋' },
      { route: '705', directionA: '往三峽', directionB: '往西門' }
    ]
  },
  {
    id: 'demo-zhongxiao',
    name: '捷運忠孝復興站',
    lat: 25.0417,
    lon: 121.5440,
    routes: [
      { route: '212', directionA: '往青年公園', directionB: '往舊莊' },
      { route: '262', directionA: '往宏國德霖科技大學', directionB: '往民生社區' }
    ]
  },
  {
    id: 'demo-banqiao',
    name: '板橋車站',
    lat: 25.0143,
    lon: 121.4620,
    routes: [
      { route: '310', directionA: '往中和', directionB: '往板橋' },
      { route: '307', directionA: '往撫遠街', directionB: '往板橋' }
    ]
  }
];

function loadSettings() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    return {
      stops: parsed.stops || []
    };
  } catch {
    return {
      stops: []
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
  return String(value ?? '').replace(
    /[&<>'"]/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[c])
  );
}

function normalize(value) {
  return String(value || '').replace(
    /[臺台\s]/g,
    ''
  );
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
    .forEach(panel => {
      panel.hidden =
        panel.id !== id;
    });

  $(id).scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

function closePanels() {
  document
    .querySelectorAll('.content-panel')
    .forEach(panel => {
      panel.hidden = true;
    });
}

function renderStops() {
  const list =
    $('stopList');

  list.innerHTML =
    state.settings.stops.length

      ? state.settings.stops
          .map(
            stop =>
              `<div class="list-row">
                <div class="list-main">
                  <strong>${esc(stop.label)}</strong>
                  <small>
                    ${esc(stop.name)}
                    ｜${stop.routes.length} 條路線
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
                    編輯
                  </button>

                  <button
                    class="mini-button delete"
                    data-action="delete-stop"
                    data-id="${esc(stop.id)}">
                    刪除
                  </button>
                </div>
              </div>`
          )
          .join('')

      : `<div class="empty">
          尚未設定常用站牌。<br>
          按下方按鈕新增第一個站牌。
        </div>`;
}

function renderRouteFields(
  routes = [{}]
) {
  $('routeFields').innerHTML = '';

  routes.forEach(
    addRouteField
  );
}

function addRouteField(
  route = {}
) {
  const row =
    document.createElement('div');

  row.className =
    'route-field';

  row.innerHTML =
    `<div>
      <label>路線</label>
      <input
        data-route
        value="${esc(route.route || '')}"
        placeholder="919"
        required>
    </div>

    <div>
      <label>方向一</label>
      <input
        data-a
        value="${esc(route.directionA || '')}"
        placeholder="往新店"
        required>
    </div>

    <div>
      <label>方向二</label>
      <input
        data-b
        value="${esc(route.directionB || '')}"
        placeholder="往北車"
        required>
    </div>

    <button
      type="button"
      aria-label="刪除路線">
      刪除
    </button>`;

  row
    .querySelector('button')
    .addEventListener(
      'click',
      () => row.remove()
    );

  $('routeFields')
    .appendChild(row);
}

function openEditor(
  item = null
) {
  $('editorPanel').hidden =
    false;

  $('editId').value =
    item?.id || '';

  $('editorTitle').textContent =
    item
      ? '編輯常用站牌'
      : '新增常用站牌';

  $('labelInput').value =
    item?.label || '';

  $('nameInput').value =
    item?.name || '';

  renderRouteFields(
    item?.routes || [{}]
  );

  showPanel(
    'editorPanel'
  );
}

function closeEditor() {
  $('editorPanel').hidden =
    true;
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function fetchJson(
  path
) {
  const response =
    await fetch(
      apiUrl(path)
    );

  const data =
    await response.json();

  if (
    !response.ok ||
    data.error
  ) {
    throw new Error(
      data.error ||
      `API ${response.status}`
    );
  }

  return data;
}

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
          new Date(
            row.NextBusTime
          ) -
          Date.now()
        ) / 60000
      );

    return minutes >= 0
      ? minutes
      : null;
  }

  return null;
}

function tdxName(value) {
  return (
    value?.Zh_tw ||
    value?.En ||
    ''
  );
}


/* =========================
   路線站序快取
========================= */

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


/* =========================
   Direction → 往哪裡
========================= */

async function getDestinationForEta(
  row,
  city
) {
  const directName =
    tdxName(
      row.DirectionName
    );

  if (directName) {
    return directName;
  }

  const routeName =
    tdxName(
      row.RouteName
    );

  if (
    !routeName ||
    !city
  ) {
    return '行駛方向';
  }

  try {
    const records =
      await getRouteStopData(
        city,
        routeName
      );

    if (
      !Array.isArray(records)
    ) {
      return '行駛方向';
    }

    const direction =
      Number(
        row.Direction
      );

    const stopUID =
      row.StopUID;

    let record =
      records.find(
        item =>
          Number(item.Direction) === direction &&
          Array.isArray(item.Stops) &&
          item.Stops.some(
            stop =>
              stop.StopUID === stopUID
          )
      );

    if (!record) {
      record =
        records.find(
          item =>
            Number(item.Direction) === direction &&
            Array.isArray(item.Stops)
        );
    }

    const lastStop =
      record?.Stops?.[
        record.Stops.length - 1
      ];

    const destination =
      tdxName(
        lastStop?.StopName
      );

    return destination
      ? `往 ${destination}`
      : '行駛方向';

  } catch {
    return '行駛方向';
  }
}


/* =========================
   多 StopUID 支援
========================= */

function stopIds(stop) {
  if (
    Array.isArray(stop.ids) &&
    stop.ids.length
  ) {
    return stop.ids;
  }

  return stop.id
    ? [stop.id]
    : [];
}


/* =========================
   ETA 顯示
========================= */

async function renderLiveArrivals(
  rows,
  stop,
  label
) {
  const wanted =
    normalize(
      stop.name
    );

  const ids =
    stopIds(stop);

  const matched =
    rows.filter(row => {

      if (
        ids.length &&
        !ids.some(
          id =>
            String(id)
              .startsWith('demo-')
        )
      ) {
        return ids.includes(
          row.StopUID
        );
      }

      const name =
        normalize(
          tdxName(
            row.StopName
          )
        );

      return (
        name &&
        (
          name.includes(wanted) ||
          wanted.includes(name)
        )
      );
    });


  const unique =
    [
      ...new Map(
        matched.map(
          row => [
            `${tdxName(row.RouteName)}|${row.StopUID || ''}|${row.Direction}`,
            row
          ]
        )
      ).values()
    ];


  const sorted =
    unique
      .filter(
        row =>
          row.StopStatus !== 2
      )
      .sort(
        (a, b) =>
          (
            etaMinutes(a) ??
            999
          ) -
          (
            etaMinutes(b) ??
            999
          )
      );


  const directions =
    new Map();


  await Promise.all(
    [
      ...new Set(
        sorted.map(
          row =>
            `${tdxName(row.RouteName)}|${row.Direction}|${row.StopUID || ''}`
        )
      )
    ].map(
      async key => {

        const row =
          sorted.find(
            item =>
              `${tdxName(item.RouteName)}|${item.Direction}|${item.StopUID || ''}`
              === key
          );

        directions.set(
          key,
          await getDestinationForEta(
            row,
            stop.city
          )
        );
      }
    )
  );


  $('arrivalList').innerHTML =
    sorted.length

      ? sorted
          .map(row => {

            const minutes =
              etaMinutes(row);

            const status =
              row.StopStatus === 1
                ? '尚未發車'
                : minutes === 0
                  ? '即將到站'
                  : minutes == null
                    ? '時間未提供'
                    : `${minutes} 分`;

            const key =
              `${tdxName(row.RouteName)}|${row.Direction}|${row.StopUID || ''}`;

            const direction =
              directions.get(key) ||
              '行駛方向';

            return (
              `<article class="arrival-row">

                <div class="route-number">
                  ${esc(
                    tdxName(
                      row.RouteName
                    )
                  )}
                </div>

                <div>
                  <strong>
                    ${esc(direction)}
                  </strong>

                  <div class="route-destination">
                    ${esc(stop.name)}
                    ｜TDX 即時資料
                  </div>
                </div>

                <div class="arrival-time">
                  <strong>
                    ${esc(status)}
                  </strong>

                  <small>
                    預估到站
                  </small>
                </div>

              </article>`
            );
          })
          .join('')

      : `<div class="empty">
          TDX 找不到這個站牌的即時資料，請確認站牌名稱。
        </div>`;


  setStatus(
    'success',
    '即時資料',
    '資料來自 TDX，會依公車回報狀態更新。'
  );
}


async function loadLiveArrivals(
  stop,
  label
) {
  const routeNames =
    [
      ...new Set(
        (stop.routes || [])
          .map(
            route =>
              String(
                route.route || ''
              ).trim()
          )
          .filter(Boolean)
      )
    ];

  const cities =
    stop.city
      ? [stop.city]
      : ['Taipei', 'NewTaipei'];

  let rows = [];


  if (
    routeNames.length
  ) {

    const results =
      await Promise.allSettled(
        routeNames.flatMap(
          route =>
            cities.map(
              city =>
                fetchJson(
                  `/eta?city=${city}&route=${encodeURIComponent(route)}`
                )
            )
        )
      );

    rows =
      results.flatMap(
        result =>
          result.status === 'fulfilled' &&
          Array.isArray(
            result.value
          )
            ? result.value
            : []
      );

  } else {

    const results =
      await Promise.allSettled(
        cities.map(
          city =>
            fetchJson(
              `/eta?city=${city}`
            )
        )
      );

    rows =
      results.flatMap(
        result =>
          result.status === 'fulfilled' &&
          Array.isArray(
            result.value
          )
            ? result.value
            : []
      );
  }


  if (!rows.length) {
    throw new Error(
      'TDX 沒有回傳這個站牌的資料'
    );
  }


  await renderLiveArrivals(
    rows,
    stop,
    label
  );
}


async function showArrivals(
  stop,
  label = stop.name
) {
  state.selected =
    stop;

  $('resultTag').textContent =
    label;

  $('resultTitle').textContent =
    stop.name;

  $('arrivalList').innerHTML =
    `<div class="empty">
      正在查詢 TDX 即時到站資料…
    </div>`;

  $('resultPanel')
    .scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });


  try {
    await loadLiveArrivals(
      stop,
      label
    );

  } catch (error) {

    const rows =
      (stop.routes || [])
        .flatMap(
          (route, index) => [
            {
              route:
                route.route,

              destination:
                route.directionA,

              minutes:
                4 + index * 5
            },
            {
              route:
                route.route,

              destination:
                route.directionB,

              minutes:
                9 + index * 5
            }
          ]
        );


    $('arrivalList').innerHTML =
      rows.length

        ? rows
            .map(
              row =>
                `<article class="arrival-row">

                  <div class="route-number">
                    ${esc(row.route)}
                  </div>

                  <div>
                    <strong>
                      ${esc(row.destination)}
                    </strong>

                    <div class="route-destination">
                      無法取得即時資料，以下為示範畫面
                    </div>
                  </div>

                  <div class="arrival-time">
                    <strong>
                      ${row.minutes} 分
                    </strong>

                    <small>
                      示範資料
                    </small>
                  </div>

                </article>`
            )
            .join('')

        : `<div class="empty">
            這個站牌目前沒有設定路線，也找不到即時資料。
          </div>`;


    setStatus(
      'error',
      '即時資料暫時無法取得',
      error.message
    );
  }
}


/* =========================
   距離計算
========================= */

function haversine(
  a,
  b
) {
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


/* =========================
   合併附近重複站牌
========================= */

function mergeNearbyStops(
  stops,
  threshold = 5
) {
  const merged = [];


  for (
    const stop
    of stops
  ) {

    const existing =
      merged.find(
        item =>
          item.city === stop.city &&
          normalize(item.name) ===
            normalize(stop.name) &&
          haversine(
            item,
            stop
          ) <= threshold
      );


    if (!existing) {

      merged.push({
        ...stop,

        ids:
          stop.id
            ? [stop.id]
            : [],

        routes:
          [
            ...(stop.routes || [])
          ]
      });

      continue;
    }


    if (
      stop.id &&
      !existing.ids.includes(
        stop.id
      )
    ) {
      existing.ids.push(
        stop.id
      );
    }


    existing.distance =
      Math.min(
        existing.distance,
        stop.distance
      );


    const routeMap =
      new Map(
        (existing.routes || [])
          .map(
            route => [
              route.route ||
              route,
              route
            ]
          )
      );


    for (
      const route
      of stop.routes || []
    ) {
      routeMap.set(
        route.route ||
        route,
        route
      );
    }


    existing.routes =
      [
        ...routeMap.values()
      ];
  }


  return merged.sort(
    (a, b) =>
      a.distance -
      b.distance
  );
}


function renderNearby(
  stops
) {
  $('nearbyList').innerHTML =
    stops.length

      ? stops
          .map(stop => {

            const routes =
              [
                ...new Set(
                  (stop.routes || [])
                    .map(
                      route =>
                        route.route ||
                        route
                    )
                    .filter(Boolean)
                )
              ];


            return (
              `<button
                class="list-row"
                data-nearby-id="${esc(stop.id)}">

                <div class="list-main">
                  <strong>
                    ${esc(stop.name)}
                  </strong>

                  <small>
                    ${Math.round(stop.distance)} 公尺
                    ${
                      routes.length
                        ? `｜${esc(routes.join('、'))}`
                        : ''
                    }
                  </small>
                </div>

                <span class="text-button">
                  查看
                </span>

              </button>`
            );
          })
          .join('')

      : `<div class="empty">
          800 公尺內目前沒有找到公車站牌。
        </div>`;
}


async function loadCityStops(
  city
) {
  const rows =
    await fetchJson(
      `/stops?city=${city}`
    );


  return rows.map(
    stop => ({
      ...stop,

      city,

      routes:
        (stop.routes || [])
          .map(
            route => ({
              route:
                route.route,

              directionA:
                '',

              directionB:
                ''
            })
          )
    })
  );
}


async function loadNearbyStops(
  location
) {
  const results =
    await Promise.all(
      ['Taipei', 'NewTaipei']
        .map(
          async city => {

            const rows =
              await loadCityStops(
                city
              );


            return rows.map(
              stop => ({
                ...stop,

                distance:
                  haversine(
                    location,
                    {
                      lat:
                        stop.lat,

                      lon:
                        stop.lon
                    }
                  )
              })
            );
          }
        )
    );


  const nearby =
    results
      .flat()
      .filter(
        stop =>
          stop.distance <= 800
      )
      .sort(
        (a, b) =>
          a.distance -
          b.distance
      );


  return mergeNearbyStops(
    nearby
  ).slice(
    0,
    30
  );
}


/* =========================
   定位
========================= */

function locate() {

  if (
    !navigator.geolocation
  ) {
    $('locationMessage').textContent =
      '這個瀏覽器不支援定位，請改用我的常用或搜尋站牌。';

    return;
  }


  $('locationMessage').textContent =
    '正在取得位置，請稍候…';


  navigator.geolocation
    .getCurrentPosition(

      async position => {

        state.location = {
          lat:
            position.coords.latitude,

          lon:
            position.coords.longitude
        };


        try {

          state.nearbyStops =
            await loadNearbyStops(
              state.location
            );


          $('locationMessage').textContent =
            '已取得位置，顯示 800 公尺內的實際站牌';


          renderNearby(
            state.nearbyStops
          );


          setStatus(
            'success',
            '定位完成',
            '站牌資料來自 TDX，請選擇要查詢的站牌。'
          );

        } catch (error) {

          state.nearbyStops =
            demoStops
              .map(
                stop => ({
                  ...stop,

                  distance:
                    haversine(
                      state.location,
                      stop
                    )
                })
              )
              .filter(
                stop =>
                  stop.distance <= 800
              )
              .sort(
                (a, b) =>
                  a.distance -
                  b.distance
              );


          $('locationMessage').textContent =
            'TDX 站牌資料暫時無法取得，顯示示範資料';


          renderNearby(
            state.nearbyStops
          );


          setStatus(
            'error',
            '站牌資料暫時無法取得',
            error.message
          );
        }
      },

      error => {

        $('locationMessage').textContent =
          `無法取得位置（${error.code}）。請確認瀏覽器的定位權限與系統定位服務。`;


        setStatus(
          'error',
          '定位未完成',
          '沒有取得位置，並未儲存任何定位資料。'
        );
      },

      {
        enableHighAccuracy:
          true,

        timeout:
          12000,

        maximumAge:
          60000
      }
    );
}


/* =========================
   路線搜尋
========================= */

function routeNameOf(
  route
) {
  return tdxName(
    route.RouteName
  );
}


function flattenRouteStops(
  records,
  city,
  routeName
) {
  if (
    !Array.isArray(records)
  ) {
    return [];
  }


  const rows = [];


  for (
    const record
    of records
  ) {

    if (
      !Array.isArray(
        record.Stops
      )
    ) {
      continue;
    }


    for (
      const stop
      of record.Stops
    ) {

      if (
        !stop?.StopUID
      ) {
        continue;
      }


      rows.push({

        id:
          stop.StopUID,

        searchKey:
          `${city}|${routeName}|${stop.StopUID}|${record.Direction ?? ''}`,

        name:
          tdxName(
            stop.StopName
          ),

        city,

        lat:
          stop.StopPosition?.PositionLat,

        lon:
          stop.StopPosition?.PositionLon,

        routes: [
          {
            route:
              routeName,

            directionA:
              '',

            directionB:
              ''
          }
        ],

        routeSearch:
          true,

        direction:
          record.Direction
      });
    }
  }


  const seen =
    new Set();


  return rows.filter(
    stop => {

      const key =
        `${stop.city}|${stop.id}|${stop.direction}`;


      if (
        seen.has(key)
      ) {
        return false;
      }


      seen.add(key);

      return true;
    }
  );
}


async function searchRouteStops(
  query
) {
  const q =
    normalize(query);


  const cityResults =
    await Promise.allSettled(
      ['Taipei', 'NewTaipei']
        .map(
          async city => {

            const routes =
              await fetchJson(
                `/route?city=${city}`
              );


            if (
              !Array.isArray(routes)
            ) {
              return [];
            }


            const exact =
              routes.filter(
                route =>
                  normalize(
                    routeNameOf(route)
                  ) === q
              );


            const prefix =
              exact.length
                ? []
                : routes
                    .filter(
                      route =>
                        normalize(
                          routeNameOf(route)
                        ).startsWith(q)
                    )
                    .slice(
                      0,
                      5
                    );


            const matchedRoutes =
              [
                ...exact,
                ...prefix
              ];


            const stopResults =
              await Promise.allSettled(
                matchedRoutes.map(
                  async route => {

                    const routeName =
                      routeNameOf(
                        route
                      );


                    const records =
                      await getRouteStopData(
                        city,
                        routeName
                      );


                    return flattenRouteStops(
                      records,
                      city,
                      routeName
                    );
                  }
                )
              );


            return stopResults
              .flatMap(
                result =>
                  result.status === 'fulfilled'
                    ? result.value
                    : []
              );
          }
        )
    );


  return cityResults
    .flatMap(
      result =>
        result.status === 'fulfilled'
          ? result.value
          : []
    );
}


/* =========================
   站牌＋路線搜尋
========================= */

async function searchStops(
  query
) {
  const q =
    normalize(query);


  if (!q) {
    return [];
  }


  const stopResults =
    await Promise.allSettled(
      ['Taipei', 'NewTaipei']
        .map(
          loadCityStops
        )
    );


  const stopRows =
    stopResults.flatMap(
      result =>
        result.status === 'fulfilled'
          ? result.value
          : []
    );


  const stationMatches =
    stopRows
      .filter(
        stop =>
          normalize(
            stop.name
          ).includes(q)
      )
      .map(
        stop => ({
          ...stop,

          searchKey:
            `${stop.city}|stop|${stop.id}`
        })
      );


  const routeMatches =
    await searchRouteStops(
      query
    );


  const seen =
    new Set();


  return [
    ...stationMatches,
    ...routeMatches
  ]
    .filter(
      stop => {

        const key =
          stop.searchKey ||
          `${stop.city}|${stop.id || stop.name}`;


        if (
          seen.has(key)
        ) {
          return false;
        }


        seen.add(key);

        return true;
      }
    )
    .slice(
      0,
      30
    );
}


function renderSearchResults(
  stops,
  query
) {
  const box =
    $('searchResults');


  box.hidden =
    false;


  box.innerHTML =
    stops.length

      ? stops
          .map(stop => {

            const routeText =
              stop.routeSearch &&
              stop.routes?.[0]?.route

                ? `｜${stop.routes[0].route}`

                : '';


            return (
              `<button
                class="list-row"
                data-search-key="${esc(
                  stop.searchKey ||
                  `${stop.city}|${stop.id}`
                )}">

                <div class="list-main">

                  <strong>
                    ${esc(stop.name)}
                  </strong>

                  <small>
                    ${esc(
                      stop.city === 'Taipei'
                        ? '臺北市'
                        : '新北市'
                    )}
                    ${esc(routeText)}
                  </small>

                </div>

                <span class="text-button">
                  查看
                </span>

              </button>`
            );
          })
          .join('')

      : `<div class="empty">
          找不到「${esc(query)}」，請確認站牌或路線名稱，或改用附近站牌。
        </div>`;
}


async function doSearch() {

  const query =
    $('searchInput')
      .value
      .trim();


  if (!query) {

    $('searchResults').hidden =
      true;

    $('searchResults').innerHTML =
      '';

    return;
  }


  $('searchResults').hidden =
    false;


  $('searchResults').innerHTML =
    `<div class="empty">
      搜尋中…
    </div>`;


  try {

    state.searchResults =
      await searchStops(
        query
      );


    renderSearchResults(
      state.searchResults,
      query
    );

  } catch (error) {

    $('searchResults').innerHTML =
      `<div class="empty">
        搜尋失敗：${esc(error.message)}
      </div>`;
  }
}


/* =========================
   點擊事件
========================= */

document.addEventListener(
  'click',
  event => {

    const action =
      event.target
        .closest('[data-action]')
        ?.dataset;


    if (!action) {
      return;
    }


    const index =
      state.settings.stops
        .findIndex(
          item =>
            item.id === action.id
        );


    if (
      index < 0
    ) {
      return;
    }


    if (
      action.action
        .startsWith('delete')
    ) {

      if (
        !confirm(
          `確定刪除「${state.settings.stops[index].label}」？`
        )
      ) {
        return;
      }


      state.settings.stops
        .splice(
          index,
          1
        );


      saveSettings();
      renderStops();

      return;
    }


    if (
      action.action
        .startsWith('edit')
    ) {

      openEditor(
        state.settings.stops[
          index
        ]
      );

      return;
    }


    if (
      action.action
        .startsWith('up') &&
      index > 0
    ) {

      [
        state.settings.stops[
          index - 1
        ],

        state.settings.stops[
          index
        ]

      ] = [

        state.settings.stops[
          index
        ],

        state.settings.stops[
          index - 1
        ]
      ];


      saveSettings();
      renderStops();
    }
  }
);


document.addEventListener(
  'click',
  event => {

    const nearbyId =
      event.target
        .closest('[data-nearby-id]')
        ?.dataset
        .nearbyId;


    if (nearbyId) {

      const stop =
        state.nearbyStops
          .find(
            item =>
              item.id === nearbyId
          );


      if (stop) {
        showArrivals(stop);
      }
    }


    const stopId =
      event.target
        .closest('[data-view-stop]')
        ?.dataset
        .viewStop;


    if (stopId) {

      const stop =
        state.settings.stops
          .find(
            item =>
              item.id === stopId
          );


      if (stop) {
        showArrivals(
          stop,
          stop.label
        );
      }
    }


    const searchKey =
      event.target
        .closest('[data-search-key]')
        ?.dataset
        .searchKey;


    if (searchKey) {

      const stop =
        state.searchResults
          .find(
            item =>
              (
                item.searchKey ||
                `${item.city}|${item.id}`
              ) === searchKey
          );


      if (stop) {
        showArrivals(stop);
      }
    }
  }
);


/* =========================
   UI 綁定
========================= */

$('nearbyBtn')
  .addEventListener(
    'click',
    () => {
      showPanel(
        'nearbyPanel'
      );

      locate();
    }
  );


$('retryLocationBtn')
  .addEventListener(
    'click',
    locate
  );


$('stopsBtn')
  .addEventListener(
    'click',
    () => {
      renderStops();
      showPanel(
        'stopsPanel'
      );
    }
  );


$('settingsTopBtn')
  .addEventListener(
    'click',
    () => {
      showPanel(
        'settingsPanel'
      );
    }
  );


$('manageStopsBtn')
  .addEventListener(
    'click',
    () => {
      renderStops();
      showPanel(
        'stopsPanel'
      );
    }
  );


$('addStopBtn')
  .addEventListener(
    'click',
    () => openEditor()
  );


$('addRouteBtn')
  .addEventListener(
    'click',
    () => addRouteField()
  );


$('closeEditorBtn')
  .addEventListener(
    'click',
    closeEditor
  );


$('cancelEditorBtn')
  .addEventListener(
    'click',
    closeEditor
  );


document
  .querySelectorAll(
    '[data-close-panel]'
  )
  .forEach(
    button =>
      button.addEventListener(
        'click',
        closePanels
      )
  );


$('searchForm')
  .addEventListener(
    'submit',
    event => {

      event.preventDefault();

      doSearch();
    }
  );


/* =========================
   常用站牌編輯
========================= */

$('editorForm')
  .addEventListener(
    'submit',
    event => {

      event.preventDefault();


      const id =
        $('editId').value;


      const item = {

        id:
          id ||
          uid('stop'),

        label:
          $('labelInput')
            .value
            .trim(),

        name:
          $('nameInput')
            .value
            .trim(),

        routes:
          [
            ...document
              .querySelectorAll(
                '.route-field'
              )
          ]

            .map(
              row => ({

                route:
                  row
                    .querySelector(
                      '[data-route]'
                    )
                    .value
                    .trim(),

                directionA:
                  row
                    .querySelector(
                      '[data-a]'
                    )
                    .value
                    .trim(),

                directionB:
                  row
                    .querySelector(
                      '[data-b]'
                    )
                    .value
                    .trim()
              })
            )

            .filter(
              route =>
                route.route &&
                route.directionA &&
                route.directionB
            )
      };


      if (
        !item.label ||
        !item.name ||
        !item.routes.length
      ) {

        alert(
          '請填寫名稱，並至少新增一條完整路線。'
        );

        return;
      }


      const index =
        state.settings.stops
          .findIndex(
            entry =>
              entry.id === id
          );


      if (
        index >= 0
      ) {

        state.settings.stops[
          index
        ] = item;

      } else {

        state.settings.stops
          .push(item);
      }


      saveSettings();
      renderStops();
      closeEditor();


      setStatus(
        '',
        '設定已儲存',
        '資料只存在這支裝置的瀏覽器中。'
      );
    }
  );


/* =========================
   備份
========================= */

$('backupBtn')
  .addEventListener(
    'click',
    () => {

      const blob =
        new Blob(
          [
            JSON.stringify(
              {
                app:
                  'mybus',

                version:
                  4,

                exportedAt:
                  new Date()
                    .toISOString(),

                stops:
                  state.settings.stops
              },
              null,
              2
            )
          ],
          {
            type:
              'application/json'
          }
        );


      const url =
        URL.createObjectURL(
          blob
        );


      const link =
        document.createElement(
          'a'
        );


      link.href =
        url;


      link.download =
        'mybus-settings.json';


      link.click();


      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        1000
      );
    }
  );


$('restoreBtn')
  .addEventListener(
    'click',
    () =>
      $('restoreInput')
        .click()
  );


$('restoreInput')
  .addEventListener(
    'change',
    async event => {

      const file =
        event.target.files[0];


      if (!file) {
        return;
      }


      try {

        const data =
          JSON.parse(
            await file.text()
          );


        if (
          !Array.isArray(
            data.stops
          )
        ) {
          throw new Error();
        }


        state.settings = {
          stops:
            data.stops
        };


        saveSettings();
        renderStops();


        setStatus(
          '',
          '設定已匯入',
          '本機設定已還原。'
        );

      } catch {

        alert(
          '這不是有效的 MyBUS 設定檔。'
        );
      }


      event.target.value =
        '';
    }
  );


renderStops();