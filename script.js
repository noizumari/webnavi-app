        let map;             // 地図本体
        let currentMarker;   // 現在地マーカー
        let routeLayer;      // ルート線を描画するレイヤー
        let currentLat = 0;  // 現在の緯度
        let currentLng = 0;  // 現在の経度
        let navigationInstructions = []; // 案内のリスト
        let currentInstructionIndex = 0; // 今どこを目指しているか
        let isNavigating = false;        // ナビ中かどうかフラグ

        let isSimulation = false;        // シミュレーションモードフラグ
        let hasNotifiedPreparation = false; // 30m手前の予告通知済みフラグ

        // --- 初期化処理 (画面が開いたときに動く) ---
        window.onload = function() {
            // 1. 地図を初期化 (初期位置は東京駅あたり)
            map = L.map('map').setView([35.6812, 139.7671], 15);

            // 2. OpenStreetMapの画像タイルを読み込む
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);

            // 3. 現在地を取得する
            startLocationTracking();
            
            // 4. シミュレーション用のクリックイベントを設定
            map.on('click', function(e) {
                if (!isSimulation) return;
                
                // クリックされた座標を現在地として扱う
                handleLocationUpdate(e.latlng.lat, e.latlng.lng);
            });
        };
        
        // --- シミュレーションモード切替 ---
        function toggleSimulationMode(enabled) {
            isSimulation = enabled;
            if (isSimulation) {
                alert("シミュレーションモードON: 地図をクリックすると現在地が移動します");
            }
        }
        
        // --- 位置更新処理 (GPS受信時とシミュレーションクリック時の共通処理) ---
        function handleLocationUpdate(lat, lng) {
            // 変数に保存
            currentLat = lat;
            currentLng = lng;

            // マーカーの更新
            if (currentMarker) {
                currentMarker.setLatLng([lat, lng]);
            } else {
                // 初回はマーカーを作成
                currentMarker = L.marker([lat, lng]).addTo(map).bindPopup("現在地").openPopup();
            }

            // ナビ中なら判定ロジックを動かす (シミュレーション時も動かす)
            if (isNavigating) {
                checkNavigationProgress(lat, lng);
            }
        }

        // --- 位置情報の取得と更新 ---
        function startLocationTracking() {
            if (!navigator.geolocation) {
                alert("このブラウザは位置情報に対応していません");
                return;
            }

            // 位置情報を監視する (GPSが動くとここが呼ばれる)
            navigator.geolocation.watchPosition(
                (position) => {
                    // シミュレーション中はGPSを無視する（お好みで併用も可だが、テストの邪魔になるので無視）
                    if (isSimulation) return;
                    
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    
                    handleLocationUpdate(lat, lng);
                },
                (error) => {
                    console.error("位置情報エラー:", error);
                },
                {
                    enableHighAccuracy: true, // 高精度モード (GPSオン)
                    timeout: 5000,
                    maximumAge: 0
                }
            );
        }

        // --- ルート検索ボタンが押されたときの処理 (ロジック実装予定地) ---
        // あなたのGraphHopper APIキーをここに入れてください
        const API_KEY = "b3c407d3-32ac-4df4-9743-6519e24b27f8"; 

        // ルート検索ボタンが押されたときの振り分け
        function handleSearchOrRoute() {
            const input = document.getElementById('destInput').value.trim();
            
            // 入力が座標っぽい場合 (数字とカンマのみ) -> そのままルート検索
            if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(input)) {
                calculateRoute(input);
            } else {
                // 住所や建物名の場合 -> 場所検索APIを呼ぶ
                searchLocation(input);
            }
        }

        // 場所検索 (Nominatim APIを使用)
        async function searchLocation(query) {
            if (!query) return;
            
            // 現在地周辺を優先するパラメータ (viewbox)
            // 簡易的に現在地から±1度くらいの範囲を優先エリアとみなす
            let viewboxParam = "";
            if (currentLat && currentLng) {
                const boxSize = 0.5; // 約50km圏内
                viewboxParam = `&viewbox=${currentLng-boxSize},${currentLat+boxSize},${currentLng+boxSize},${currentLat-boxSize}&bounded=0`;
            }

            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}${viewboxParam}&limit=5`;

            try {
                const response = await fetch(url);
                const results = await response.json();

                const list = document.getElementById('searchResults');
                list.innerHTML = "";
                list.style.display = 'block';

                if (results.length === 0) {
                    list.innerHTML = "<div class='search-item'>見つかりませんでした</div>";
                    return;
                }

                // 候補を表示
                results.forEach(place => {
                    const div = document.createElement('div');
                    div.className = 'search-item';
                    div.innerText = place.display_name; // 施設名・住所
                    div.onclick = () => selectLocation(place.lat, place.lon, place.display_name);
                    list.appendChild(div);
                });

            } catch (e) {
                alert("検索エラー: " + e);
            }
        }

        // 候補を選んだとき
        function selectLocation(lat, lon, name) {
            // 入力欄にセット (座標ではなく名前にしておくと親切だが、ロジック上は座標が必要)
            // ここでは隠し技として、見た目はそのまま、内部でルート検索を走らせます
            
            document.getElementById('searchResults').style.display = 'none';
            document.getElementById('destInput').value = name; // 表示名をセット
            
            // 座標文字を作ってルート検索へ
            calculateRoute(`${lat}, ${lon}`);
        }

        // ルート検索ロジック
        async function calculateRoute(coordString) {
            // 引数がなければ入力欄から取得 (座標形式であることを期待)
            const destInput = coordString || document.getElementById('destInput').value;
            
            // カンマで区切って数字にする (エラーなら戻る)
            const parts = destInput.split(',');
            if (parts.length !== 2) {
                alert("場所を検索して候補から選んでください");
                return;
            }
            const [destLat, destLng] = parts.map(n => parseFloat(n.trim()));

            if (!currentLat || !currentLng) {
                alert("現在地がまだ取得できていません");
                return;
            }

            // GraphHopperのURLを作成 (C#の時と同じパラメータ)
            // point=現在地 & point=目的地 & vehicle=foot (徒歩)
            const url = `https://graphhopper.com/api/1/route?point=${currentLat},${currentLng}&point=${destLat},${destLng}&vehicle=foot&locale=ja&key=${API_KEY}&points_encoded=true`;

            try {
                // APIにアクセス (C#のHttpClientにあたる部分)
                const response = await fetch(url);
                const data = await response.json();

                // エラーチェック
                if (data.message) {
                    alert("APIエラー: " + data.message);
                    return;
                }

                // ルート情報を取得 (最初のルート)
                const path = data.paths[0];
                
                // 1. 地図に線を引く
                drawRouteOnMap(path.points);

                // 2. ナビ案内(instructions)を取り出す
                // これがあなたがC#で処理していた「曲がる指示」のリストです
                const instructions = path.instructions;
                
                // 画面に最初の案内を表示してみる
                const firstInstruction = instructions[0];
                document.getElementById('guidance').style.display = 'block';
                document.getElementById('guidance').innerText = 
                    `距離: ${path.distance.toFixed(0)}m / 時間: ${(path.time / 1000 / 60).toFixed(0)}分\n` +
                    `次の指示: ${firstInstruction.text} (サイン: ${firstInstruction.sign})`;

                // ★ここで「ナビゲーションロジック」を開始します（手順3で実装）
                // (calculateRoute関数の中の tryブロックの最後あたり)

                // ナビ用データを保存して開始
                navigationInstructions = instructions;
                currentInstructionIndex = 0;
                isNavigating = true;

                // 最初の案内を表示
                updateGuidanceDisplay();
                sendSignToM5(100);

                alert("ナビを開始します！実際に歩いて移動すると案内が切り替わります。");
                console.log("全指示データ:", instructions);

            } catch (error) {
                console.error(error);
                alert("通信エラーが発生しました");
            }
        }

        // --- 補助関数: ポリライン(エンコードされた文字列)を座標の配列に変換 ---
        // ※GraphHopperが返す "a~l~Fjk~uOn..." みたいな文字を解読する魔法のコードです
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

        // --- 補助関数: 地図にルートを描画 ---
        function drawRouteOnMap(encodedString) {
            // 既存のルートがあれば消す
            if (routeLayer) {
                map.removeLayer(routeLayer);
            }

            // デコードして座標リストにする
            const latlngs = decodePolyline(encodedString);
            
            // ★ナビゲーション判定用にグローバル変数に保存
            window.routeLatlngs = latlngs;

            // 青い線で描画
            routeLayer = L.polyline(latlngs, {color: 'blue', weight: 6, opacity: 0.7}).addTo(map);

            // ルート全体が見えるようにズーム調整
            map.fitBounds(routeLayer.getBounds());
        } 
        // --- 補助関数: 2点間の距離を計算 (Haversine formula) ---
        // 戻り値: メートル (m)
        function calculateDistance(lat1, lng1, lat2, lng2) {
            const R = 6371000; // 地球の半径 (メートル)
            const toRad = Math.PI / 180;
            const dLat = (lat2 - lat1) * toRad;
            const dLng = (lng2 - lng1) * toRad;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        // --- ナビ判定ロジック: 現在地が次のポイントに近づいたかチェック ---

        function checkNavigationProgress(lat, lng) {
            // 全ての案内が終了している場合
            if (currentInstructionIndex >= navigationInstructions.length) {
                document.getElementById('guidance').innerText = "目的地に到着しました！";
                isNavigating = false;
                return;
            }

            // 1. 距離計算用: 現在の区間（ここを移動中）
            const currentInst = navigationInstructions[currentInstructionIndex];
            const interval = currentInst.interval;
            const targetPointIndex = interval[1]; // この区間の終わりの座標
            
            if (!window.routeLatlngs) return;
            const targetLatLng = window.routeLatlngs[targetPointIndex];
            
            // 残り距離を計算
            const distance = calculateDistance(lat, lng, targetLatLng[0], targetLatLng[1]);

            // 2. 表示・通知用: 次の指示（この区間の終わりで何をするか）
            let nextText = "";
            let nextSign = 0; // GraphHopper Sign Code
            
            const nextIndex = currentInstructionIndex + 1;
            
            if (nextIndex < navigationInstructions.length) {
                // 次の指示がある場合（普通の曲がり角など）
                const nextInst = navigationInstructions[nextIndex];
                nextText = nextInst.text;
                nextSign = nextInst.sign;
            } else {
                // 次の指示がない場合 ＝ 今の区間が終わればゴール
                nextText = "目的地周辺";
                nextSign = 15; // Arrived sign code
            }

            // 画面表示更新
            let infoText = `次の指示: ${nextText}\n` +
                           `残り距離: ${distance.toFixed(0)}m`;

            // 3. 30m手前の予告通知 (15m以上30m未満)
            if (distance < 30 && distance >= 15) {
                if (!hasNotifiedPreparation) {
                    // 予告用シグナルを送る ("PREPARE" という文字列を使用)
                    notifyM5Stick("PREPARE"); 
                    hasNotifiedPreparation = true;
                }
                infoText += "\n(そろそろ曲がります)";
            }
            
            document.getElementById('guidance').innerText = infoText;

            // 4. 15m手前の実行指示 (15m未満)
            if (distance < 15) {
                // 次の動作（右左折やゴール）を通知
                notifyM5Stick(nextSign);
                
                // 次の区間へ
                currentInstructionIndex++;
                hasNotifiedPreparation = false; // フラグリセット
                
                // もしこれで全工程終了なら
                if (currentInstructionIndex >= navigationInstructions.length) {
                    document.getElementById('guidance').innerText = "目的地に到着しました";
                    isNavigating = false;
                } else {
                    // 即座に表示を更新（次の区間に入ったので、ターゲット等は次のループで更新される）
                    document.getElementById('guidance').innerText = "次の指示へ...";
                }
            }
        }

        // --- M5StickCへの通知関数 (Placeholder) ---

        // --- 画面表示の更新 (初期表示用) ---
        function updateGuidanceDisplay() {
            if (!navigationInstructions || navigationInstructions.length === 0) return;
            const instruction = navigationInstructions[currentInstructionIndex];
            const text = `次の指示: ${instruction.text}`;
            document.getElementById('guidance').innerText = text;
        }
        // --- Bluetooth (BLE) 関連の変数と設定 ---
const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"; // M5StickC Plus2と一致させる
const CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

let navigationCharacteristic = null;

// M5StickC Plus2に接続する関数
async function connectToM5() {
    try {
        console.log("M5StickC Plus2を検索中...");
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: "M5_Navi_Stick" }], // Arduino側の名前と一致させる
            optionalServices: [SERVICE_UUID]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        navigationCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

        alert("M5StickC Plus2に接続成功！");
        document.getElementById('guidance').innerText = "M5接続済み: 案内待機中...";
    } catch (error) {
        console.error("Bluetooth接続エラー:", error);
        alert("接続に失敗しました: " + error);
    }
}

// M5StickC Plus2に数値を送る関数
async function sendSignToM5(sign) {
    if (!navigationCharacteristic) return;

    try {
        // GraphHopperのsign（0, 2, -2, 4など）を1バイトの整数として送信
        const buffer = new Int8Array([sign]);
        await navigationCharacteristic.writeValue(buffer);
        console.log("M5に送信完了:", sign);
    } catch (error) {
        console.error("送信エラー:", error);
    }
}
// --- M5StickCへの通知関数 (書き換え) ---
function notifyM5Stick(sign) {
    console.log(`【M5StickC通知】Sign Code: ${sign}`);
    
    // 文字列 "PREPARE" が来た場合は一旦無視するか、特定の数値（例: 99）として送る
    if (sign === "PREPARE") {
        sendSignToM5(99); // 予告用
    } else {
        sendSignToM5(sign); // 通常の指示(0, 2, -2, 4)を送信
    }
    
    const guidance = document.getElementById('guidance');
    if (guidance) {
        guidance.style.backgroundColor = 'red';
        setTimeout(() => {
             guidance.style.backgroundColor = '#222';
        }, 1000);
    }
}
