// --- 1. 定数・設定 (CONSTANTS) ---
const CONFIG = {
    // APIキー 
    API_KEY: "b3c407d3-32ac-4df4-9743-6519e24b27f8",
    
    // マップ設定
    MAP: {
        DEFAULT_LAT: 35.6812, // 東京駅
        DEFAULT_LNG: 139.7671,
        DEFAULT_ZOOM: 15,
        TRACKING_ZOOM: 25, // ナビ中の追従ズームレベル
        TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        ATTRIBUTION: '&copy; OpenStreetMap contributors'
    },

    // ナビゲーション閾値 (メートル)
    NAV: {
        PREPARE_DISTANCE: 30, // 予告通知を出す距離
        TURN_DISTANCE: 15,    // 実行指示を出す距離
    },

    // Bluetooth / M5Stick 設定
    BLE: {
        SERVICE_UUID: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
        CHARACTERISTIC_UUID: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
        DEVICE_NAME: "M5_Navi_Stick",
        // M5Stickに送る特殊シグナル
        SIGNAL: {
            PREPARE: 99 // 予告用
        }
    }
};

// --- 2. グローバル変数 (STATE) ---

// アプリ全体の状態
const appState = {
    currentLat: 0,
    currentLng: 0,
    isSimulation: false,    // シミュレーションモード
    isAutoCentering: true   // 地図自動追従フラグ
};

// ナビゲーションの状態
const navState = {
    isNavigating: false,
    instructions: [],       // 案内リスト
    currentIndex: 0,        // 現在の案内インデックス
    hasNotifiedPreparation: false, // 予告通知済みフラグ
    routeLatlngs: null      // デコード済みのルート座標配列
};

// Leafletオブジェクト (地図, マーカー, レイヤー)
const mapItems = {
    map: null,
    currentMarker: null,
    routeLayer: null
};

// Bluetooth特性
let navigationCharacteristic = null;


// --- 3. 初期化処理 (INITIALIZATION) ---
window.onload = function() {
    initMap();
    startLocationTracking();
    setupEventHandlers();
};


 // 地図の初期化
function initMap() {
    mapItems.map = L.map('map').setView(
        [CONFIG.MAP.DEFAULT_LAT, CONFIG.MAP.DEFAULT_LNG], 
        CONFIG.MAP.DEFAULT_ZOOM
    );

    L.tileLayer(CONFIG.MAP.TILE_URL, {
        attribution: CONFIG.MAP.ATTRIBUTION
    }).addTo(mapItems.map);
}

// イベントハンドラの設定
function setupEventHandlers() {
    // シミュレーション用クリック
    mapItems.map.on('click', function(e) {
        if (!appState.isSimulation) return;
        handleLocationUpdate(e.latlng.lat, e.latlng.lng);
    });

    // ドラッグで自動追従OFF
    mapItems.map.on('dragstart', function() {
        appState.isAutoCentering = false;
    });
}


// --- 4. 位置情報処理 (LOCATION HANDLING) ---

// 位置情報の追跡開始 (GPS)
function startLocationTracking() {
    if (!navigator.geolocation) {
        alert("このブラウザは位置情報に対応していません");
        return;
    }

    navigator.geolocation.watchPosition(
        (position) => {
            // シミュレーション中はGPSを無視
            if (appState.isSimulation) return;
            handleLocationUpdate(position.coords.latitude, position.coords.longitude);
        },
        (error) => console.error("位置情報エラー:", error),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
}

/**
 * 位置情報更新時のメイン処理
 * @param {number} lat 緯度
 * @param {number} lng 経度
 */
function handleLocationUpdate(lat, lng) {
    appState.currentLat = lat;
    appState.currentLng = lng;

    updateCurrentMarker(lat, lng);
    updateMapCenter(lat, lng);

    // ナビ中なら進行状況をチェック
    if (navState.isNavigating) {
        checkNavigationProgress(lat, lng);
    }
}

// 現在地マーカーの更新
function updateCurrentMarker(lat, lng) {
    if (mapItems.currentMarker) {
        mapItems.currentMarker.setLatLng([lat, lng]);
    } else {
        mapItems.currentMarker = L.marker([lat, lng])
            .addTo(mapItems.map)
            .bindPopup("現在地")
            .openPopup();
    }
}

// 地図中心の更新 (自動追従ONの場合)
function updateMapCenter(lat, lng) {
    if (appState.isAutoCentering) {
        // 設定された追従ズームレベルを維持するか、現在のズームを使うか
        // ここでは実装通り現在のズームレベルを維持し、位置だけ移動
        // ただしナビ中の見やすさを考慮して少しズームしても良い (CONFIG.MAP.TRACKING_ZOOM)
        mapItems.map.setView([lat, lng]); // 引数省略で現在のズーム維持
    }
}

// シミュレーションモード切替
function toggleSimulationMode(enabled) {
    appState.isSimulation = enabled;
    if (appState.isSimulation) {
        alert("シミュレーションモードON: 地図をクリックすると現在地が移動します");
    }
}

// 現在地へ戻るボタン (追従再開)
function enableAutoCenter() {
    appState.isAutoCentering = true;
    if (appState.currentLat && appState.currentLng) {
        // ナビ中は少し拡大して見やすくする
        mapItems.map.setView(
            [appState.currentLat, appState.currentLng], 
            CONFIG.MAP.TRACKING_ZOOM
        ); 
    }
}


// --- 5. 検索 & ルート計算 (SEARCH & ROUTING) ---

// 検索またはルート開始ボタンのハンドラ
function handleSearchOrRoute() {
    const input = document.getElementById('destInput').value.trim();
    
    // 座標入力形式の判定 (例: "35.123, 139.123")
    if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(input)) {
        calculateRoute(input);
    } else {
        searchLocation(input);
    }
}

// 場所検索 (Nominatim API)
async function searchLocation(query) {
    if (!query) return;

    // 現在地周辺を優先検索
    let viewboxParam = "";
    if (appState.currentLat && appState.currentLng) {
        const boxSize = 0.5;
        viewboxParam = `&viewbox=${appState.currentLng-boxSize},${appState.currentLat+boxSize},${appState.currentLng+boxSize},${appState.currentLat-boxSize}&bounded=0`;
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}${viewboxParam}&limit=5`;

    try {
        const response = await fetch(url);
        const results = await response.json();
        showSearchResults(results);
    } catch (e) {
        alert("検索エラー: " + e);
    }
}

// 検索結果リストの表示
function showSearchResults(results) {
    const list = document.getElementById('searchResults');
    list.innerHTML = "";
    list.style.display = 'block';

    if (!results || results.length === 0) {
        list.innerHTML = "<div class='search-item'>見つかりませんでした</div>";
        return;
    }

    results.forEach(place => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.innerText = place.display_name;
        div.onclick = () => selectLocation(place.lat, place.lon, place.display_name);
        list.appendChild(div);
    });
}

// 候補選択時の処理
function selectLocation(lat, lon, name) {
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('destInput').value = name;
    calculateRoute(`${lat}, ${lon}`);
}

/**
 * ルート計算 (GraphHopper API)
 * @param {string} coordString "lat,lng" 形式の文字列
 */
async function calculateRoute(coordString) {
    const inputVal = coordString || document.getElementById('destInput').value;
    const parts = inputVal.split(',');

    if (parts.length !== 2) {
        alert("場所を検索して候補から選んでください");
        return;
    }
    
    const [destLat, destLng] = parts.map(n => parseFloat(n.trim()));

    if (!appState.currentLat || !appState.currentLng) {
        alert("現在地がまだ取得できていません");
        return;
    }

    const url = `https://graphhopper.com/api/1/route?point=${appState.currentLat},${appState.currentLng}&point=${destLat},${destLng}&vehicle=foot&locale=ja&key=${CONFIG.API_KEY}&points_encoded=true`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.message) {
            alert("APIエラー: " + data.message);
            return;
        }

        startNavigation(data.paths[0]);

    } catch (error) {
        console.error(error);
        alert("通信エラーが発生しました");
    }
}


// --- 6. ナビゲーションロジック (NAVIGATION CORE) ---

/**
 * ナビゲーション開始処理
 * @param {object} path GraphHopperのルートデータ
 */
function startNavigation(path) {
    // 1. 地図描画
    drawRouteOnMap(path.points);

    // 2. ナビデータ保存
    navState.instructions = path.instructions;
    navState.currentIndex = 0;
    navState.isNavigating = true;
    navState.hasNotifiedPreparation = false;

    // 3. UI切り替え
    startNavigationUI();
    updateGuidanceDisplay();

    alert("ナビを開始します！実際に歩いて移動すると案内が切り替わります。");
    console.log("全指示データ:", navState.instructions);
}

// ナビ進行状況のチェック (現在位置 vs 現在の目標地点)
function checkNavigationProgress(lat, lng) {
    if (navState.currentIndex >= navState.instructions.length) {
        finishNavigation("目的地に到着しました！");
        return;
    }

    // A. 現在目指している地点(区間の終わり)を取得
    const currentInst = navState.instructions[navState.currentIndex];
    const targetIndex = currentInst.interval[1]; // 座標配列上のインデックス
    
    if (!navState.routeLatlngs) return;
    const targetLatLng = navState.routeLatlngs[targetIndex];
    
    // B. 残り距離計算
    const distance = calculateDistance(lat, lng, targetLatLng[0], targetLatLng[1]);

    // C. 次の行動を取得 (UI表示 & M5通知用)
    const nextAction = getNextActionInfo();
    
    // D. 画面更新
    updateGuidanceText(nextAction.text, distance);

    // E. 通知ロジック
    handleNotifications(distance, nextAction.sign);
}

// 次の行動（指示）情報を取得
function getNextActionInfo() {
    const nextIndex = navState.currentIndex + 1;
    if (nextIndex < navState.instructions.length) {
        const nextInst = navState.instructions[nextIndex];
        return { text: nextInst.text, sign: nextInst.sign };
    } else {
        return { text: "目的地周辺", sign: 15 }; // 15=Arrived
    }
}

// 案内テキスト更新
function updateGuidanceText(nextText, distance) {
    let infoText = `次の指示: ${nextText}\n残り距離: ${distance.toFixed(0)}m`;
    
    // 30m以内の場合の補足
    if (distance < CONFIG.NAV.PREPARE_DISTANCE && distance >= CONFIG.NAV.TURN_DISTANCE) {
        infoText += "\n(そろそろ曲がります)";
    }
    
    document.getElementById('guidance').innerText = infoText;
}

// 通知判定と実行 (M5Stick / 画面遷移)
function handleNotifications(distance, nextSign) {
    // 1. 予告通知 (30m手前)
    if (distance < CONFIG.NAV.PREPARE_DISTANCE && distance >= CONFIG.NAV.TURN_DISTANCE) {
        if (!navState.hasNotifiedPreparation) {
            notifyM5Stick("PREPARE");
            navState.hasNotifiedPreparation = true;
        }
    }

    // 2. 実行通知 & 次のステップへ (15m手前)
    if (distance < CONFIG.NAV.TURN_DISTANCE) {
        notifyM5Stick(nextSign);

        // 次の区間へ進める
        navState.currentIndex++;
        navState.hasNotifiedPreparation = false;

        if (navState.currentIndex >= navState.instructions.length) {
            finishNavigation("目的地に到着しました");
        } else {
            document.getElementById('guidance').innerText = "次の指示へ...";
        }
    }
}

// ナビ終了処理 (到着時)
function finishNavigation(message) {
    document.getElementById('guidance').innerText = message;
    navState.isNavigating = false;
}
 
// 2点間の距離計算 (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}


// --- 7. M5Stick / BLE 通信 (BLE COMMUNICATION) ---

// M5Stick接続
async function connectToM5() {
    try {
        console.log("M5StickC Plus2を検索中...");
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: CONFIG.BLE.DEVICE_NAME }],
            optionalServices: [CONFIG.BLE.SERVICE_UUID]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(CONFIG.BLE.SERVICE_UUID);
        navigationCharacteristic = await service.getCharacteristic(CONFIG.BLE.CHARACTERISTIC_UUID);

        alert("M5StickC Plus2に接続成功！");
        document.getElementById('guidance').innerText = "M5接続済み: 案内待機中...";
    } catch (error) {
        console.error("Bluetooth接続エラー:", error);
        alert("接続に失敗しました: " + error);
    }
}

// データを送信
async function sendSignToM5(sign) {
    if (!navigationCharacteristic) return;

    try {
        const buffer = new Int8Array([sign]);
        await navigationCharacteristic.writeValue(buffer);
        console.log("M5に送信完了:", sign);
    } catch (error) {
        console.error("送信エラー:", error);
    }
}

// 通知ラッパー関数 (ここにご要望の独自ロジックが含まれています)
function notifyM5Stick(sign) {
    console.log(`【M5StickC通知】Sign Code: ${sign}`);
    
    // ロジック: "PREPARE" なら 99、それ以外はそのまま送信
    if (sign === "PREPARE") {
        sendSignToM5(CONFIG.BLE.SIGNAL.PREPARE); // 予告用
    } else {
        sendSignToM5(sign); // 通常の指示
    }
    
    // 視覚フィードバック (画面フラッシュ)
    const el = document.getElementById('guidance');
    if(el) {
        el.style.backgroundColor = 'red';
        setTimeout(() => {
             el.style.backgroundColor = '#222';
        }, 1000);
    }
}


// --- 8. UI操作 & ユーティリティ (UI & UTILS) ---

// ナビ開始時のUI切り替え
function startNavigationUI() {
    document.getElementById('search-ui').style.display = 'none';
    document.getElementById('navigation-ui').style.display = 'block';
}

// ナビ終了時の処理 (ユーザー操作)
function endNavigation() {
    navState.isNavigating = false;
    navState.instructions = [];
    navState.currentIndex = 0;
    
    if (mapItems.routeLayer) {
        mapItems.map.removeLayer(mapItems.routeLayer);
        mapItems.routeLayer = null;
    }

    document.getElementById('navigation-ui').style.display = 'none';
    document.getElementById('search-ui').style.display = 'block';
    
    document.getElementById('guidance').innerText = "案内待機中...";
    
    enableAutoCenter();
}

// 案内表示の初期更新
function updateGuidanceDisplay() {
    if (!navState.instructions || navState.instructions.length === 0) return;
    const instruction = navState.instructions[navState.currentIndex];
    document.getElementById('guidance').innerText = `次の指示: ${instruction.text}`;
}

// ポリラインデコード
function decodePolyline(encoded) {
    var points = [];
    var index = 0, len = encoded.length;
    var lat = 0, lng = 0;
    while (index < len) {
        var b, shift = 0, result = 0;
        do {
            b = encoded.charAt(index++).charCodeAt(0) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        var dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charAt(index++).charCodeAt(0) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        var dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        points.push([lat * 1e-5, lng * 1e-5]);
    }
    return points;
}

// 地図にルートを描画
function drawRouteOnMap(encodedString) {
    if (mapItems.routeLayer) {
        mapItems.map.removeLayer(mapItems.routeLayer);
    }

    const latlngs = decodePolyline(encodedString);
    navState.routeLatlngs = latlngs;

    mapItems.routeLayer = L.polyline(latlngs, {color: 'blue', weight: 6, opacity: 0.7}).addTo(mapItems.map);
    mapItems.map.fitBounds(mapItems.routeLayer.getBounds());
} 
