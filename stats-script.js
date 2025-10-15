// ==UserScript==
// @name         GeoGuessr Stats Tracker
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Tracks GeoGuessr game performance
// @author       Ben Foronda
// @match        https://www.geoguessr.com/*
// @match        https://geoguessr.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      www.geoguessr.com
// @connect      geoguessr.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const POLL_MS = 5000;
    const STORAGE_KEY = 'geoguessr_stats_data';
    
    let games = GM_getValue(STORAGE_KEY, []);
    let activeToken = null;
    let monitoring = false;
    let tracking = true;
    let lastGame = null;
    let countryData = null;
    let turfReady = false;

    async function loadTurf() {
        if (turfReady || window.turf) {
            turfReady = true;
            return;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js';
            script.onload = () => {
                turfReady = true;
                resolve();
            };
            script.onerror = resolve;
            document.head.appendChild(script);
        });
    }

    async function loadCountries() {
        if (countryData) return;
        
        await loadTurf();
        
        try {
            const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson');
            const geo = await res.json();
            
            countryData = {};
            geo.features.forEach(f => {
                const code = f.properties.ISO_A2 || f.properties.iso_a2 || f.properties.ISO_A2_EH;
                if (code && code !== '-99' && code.length === 2) {
                    countryData[code.toUpperCase()] = {
                        geometry: f.geometry,
                        properties: f.properties
                    };
                }
            });
        } catch (e) {
            console.warn('Failed to load country data:', e);
            countryData = {};
        }
    }

    function getCountry(lat, lng) {
        if (!countryData || lat == null || lng == null) return 'Unknown';
        
        lng = ((lng + 180) % 360 + 360) % 360 - 180;

        if (turfReady && window.turf) {
            const pt = window.turf.point([lng, lat]);
            
            for (const [code, data] of Object.entries(countryData)) {
                try {
                    if (window.turf.booleanPointInPolygon(pt, data.geometry)) {
                        return code;
                    }
                } catch (e) {
                    continue;
                }
            }

            let nearest = 'Unknown';
            let minDist = Infinity;
            
            for (const [code, data] of Object.entries(countryData)) {
                try {
                    const dist = window.turf.pointToLineDistance(pt, data.geometry, {units: 'kilometers'});
                    if (dist < minDist && dist < 10) {
                        minDist = dist;
                        nearest = code;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            return nearest;
        }

        const pt = [lng, lat];
        for (const [code, data] of Object.entries(countryData)) {
            const geom = data.geometry;
            if (geom.type === 'Polygon' && pointInPoly(pt, geom.coordinates)) {
                return code;
            } else if (geom.type === 'MultiPolygon') {
                for (const poly of geom.coordinates) {
                    if (pointInPoly(pt, poly)) return code;
                }
            }
        }
        
        return 'Unknown';
    }

    function pointInPoly(pt, coords) {
        if (!pointInRing(pt, coords[0])) return false;
        for (let i = 1; i < coords.length; i++) {
            if (pointInRing(pt, coords[i])) return false;
        }
        return true;
    }

    function pointInRing(pt, ring) {
        const [x, y] = pt;
        let inside = false;
        
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }

    function getToolbar() {
        let toolbar = document.getElementById('geoguessr-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = 'geoguessr-toolbar';
            toolbar.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                z-index: 2147483647;
                align-items: center;
            `;
            document.body.appendChild(toolbar);
        }
        return toolbar;
    }

    function addButton(btn) {
        const toolbar = getToolbar();
        
        btn.style.cssText = `
            width: 40px !important;
            height: 40px !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            font-size: 18px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
            transition: all 0.3s ease !important;
            border: 1px solid rgba(255, 255, 255, 0.3) !important;
            user-select: none !important;
            flex-shrink: 0;
        `;

        btn.onmouseenter = function() {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
        };
        
        btn.onmouseleave = function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        };

        if (!document.getElementById(btn.id)) {
            toolbar.appendChild(btn);
        }
    }

    function watchUrl() {
        let url = window.location.href;
        
        setInterval(() => {
            if (window.location.href !== url) {
                url = window.location.href;
                checkUrl(url);
            }
        }, 1000);
        
        checkUrl(url);
    }

    function checkUrl(url) {
        const patterns = [
            /\/game\/([a-zA-Z0-9_-]+)/,
            /\/challenge\/([a-zA-Z0-9_-]+)/,
            /\/results\/([a-zA-Z0-9_-]+)/,
            /\/duel\/([a-zA-Z0-9_-]+)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                const token = match[1];
                if (token !== activeToken) {
                    activeToken = token;
                    setStatus('Game: ' + activeToken.substring(0, 8) + '...');
                    updateGameInfo();
                    
                    if (!monitoring) startMonitoring();
                }
                break;
            }
        }
    }

    function startMonitoring() {
        if (monitoring || !activeToken) return;
        monitoring = true;

        const check = setInterval(async () => {
            if (!activeToken || !tracking) {
                clearInterval(check);
                monitoring = false;
                return;
            }

            try {
                const data = await fetchGame(activeToken);
                if (data && data.state === 'finished') {
                    await saveGame(data);
                    activeToken = null;
                    clearInterval(check);
                    monitoring = false;
                }
            } catch (e) {
                console.error('Monitor error:', e);
            }
        }, POLL_MS);
    }

    async function fetchGame(token) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.geoguessr.com/api/v3/games/${token}`,
                headers: { 'Accept': 'application/json' },
                onload: function(res) {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch (e) {
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                },
                onerror: reject
            });
        });
    }

    async function saveGame(data) {
        if (!data || !data.token || games.find(g => g.token === data.token)) return;

        const formatted = await formatGame(data);
        games.push(formatted);
        GM_setValue(STORAGE_KEY, games);

        lastGame = formatted;
        setStatus(`✅ Saved! Score: ${formatted.totalScore}`);
        updateStats();
        updateGameInfo();
        notify(`Game saved! Score: ${formatted.totalScore}`, 'success');
    }

    async function formatGame(data) {
        const player = data.player || {};
        const rounds = [];

        if (data.rounds && player.guesses) {
            for (let i = 0; i < data.rounds.length; i++) {
                const r = data.rounds[i];
                const g = player.guesses[i] || {};

                const actual = (r.streakLocationCode || 'Unknown').toUpperCase();
                const guessed = getCountry(g.lat, g.lng);

                rounds.push({
                    roundNumber: i + 1,
                    actual: { country: actual, lat: r.lat, lng: r.lng },
                    guessed: { country: guessed, lat: g.lat, lng: g.lng },
                    distance: Math.round(g.distanceInMeters || 0),
                    score: g.roundScoreInPoints || 0,
                    time: g.time || 0,
                    timedOut: g.timedOut || false
                });
            }
        }

        return {
            token: data.token,
            timestamp: new Date().toISOString(),
            gameMode: getMode(data),
            map: data.mapName || 'Unknown',
            rounds: rounds,
            totalScore: player.totalScore?.amount || 0,
            totalDistance: Math.round(player.totalDistanceInMeters || 0),
            totalTime: player.totalTime || 0,
            restrictions: {
                timeLimit: data.timeLimit || 0,
                forbidMoving: data.forbidMoving || false,
                forbidZooming: data.forbidZooming || false,
                forbidRotating: data.forbidRotating || false
            }
        };
    }

    function getMode(data) {
        const { forbidMoving, forbidZooming, forbidRotating } = data;
        if (forbidMoving && forbidZooming && forbidRotating) return 'NMPZ';
        if (forbidMoving && !forbidZooming && !forbidRotating) return 'No Move';
        if (!forbidMoving && !forbidZooming && !forbidRotating) return 'Moving';
        return 'Custom';
    }

    async function importGames() {
        const pages = prompt('How many pages to scan? (1 page = ~10 games)', '5');
        if (!pages) return;

        const n = parseInt(pages) || 5;
        let imported = 0;

        setStatus('Importing...');
        notify(`Scanning ${n} pages...`, 'info');

        try {
            for (let p = 0; p < n; p++) {
                setStatus(`Page ${p + 1}/${n}...`);

                const res = await new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://www.geoguessr.com/api/v3/user/activities?page=${p}&count=10`,
                        headers: { 'Accept': 'application/json' },
                        onload: resolve,
                        onerror: () => resolve({ status: 0 })
                    });
                });

                if (res.status === 200) {
                    const acts = JSON.parse(res.responseText);
                    for (const act of acts) {
                        if (act.game) {
                            const data = await fetchGame(act.game);
                            if (data && data.state === 'finished') {
                                if (!games.find(g => g.token === act.game)) {
                                    await saveGame(data);
                                    imported++;
                                }
                            }
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 500));
            }

            setStatus(`✅ Imported ${imported} games`);
            notify(`Imported ${imported} new games!`, 'success');
        } catch (e) {
            console.error('Import error:', e);
            notify('Import failed', 'error');
        }
    }

    function exportCSV() {
        if (games.length === 0) {
            alert('No data to export!');
            return;
        }

        const headers = [
            'Timestamp', 'Game Mode', 'Map', 'Total Score', 'Total Distance (m)', 'Total Time (s)',
            'Round', 'Actual Country', 'Actual Lat', 'Actual Lng',
            'Guessed Country', 'Guessed Lat', 'Guessed Lng',
            'Distance (m)', 'Score', 'Time (s)', 'Timed Out',
            'Time Limit', 'No Move', 'No Zoom', 'No Pan'
        ];

        let csv = headers.join(',') + '\n';

        games.forEach(g => {
            g.rounds.forEach(r => {
                const row = [
                    g.timestamp, g.gameMode, `"${g.map}"`,
                    g.totalScore, g.totalDistance, g.totalTime,
                    r.roundNumber, r.actual.country, r.actual.lat, r.actual.lng,
                    r.guessed.country, r.guessed.lat, r.guessed.lng,
                    r.distance, r.score, r.time, r.timedOut,
                    g.restrictions.timeLimit, g.restrictions.forbidMoving,
                    g.restrictions.forbidZooming, g.restrictions.forbidRotating
                ];
                csv += row.join(',') + '\n';
            });
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `geoguessr_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        notify(`Exported ${games.length} games`, 'success');
    }

    function createUI() {
        if (document.getElementById('stats-tracker-toggle')) return;

        const btn = document.createElement('div');
        btn.id = 'stats-tracker-toggle';
        btn.className = 'geoguessr-toolbar-btn';
        btn.innerHTML = '📊';
        btn.title = 'GeoGuessr Stats Tracker';

        addButton(btn);

        const panel = document.createElement('div');
        panel.id = 'stats-tracker-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <h3>📊 Stats Tracker v3.4</h3>
            <div id="tracker-status">✅ Ready</div>
            <div id="current-game-info">No active game</div>

            <button id="export-csv-btn">📥 Export to CSV</button>
            <button id="import-recent-btn">📤 Import Recent Games</button>
            <button id="toggle-tracking-btn">⏸️ Pause Tracking</button>
            <button id="clear-data-btn">🗑️ Clear Data</button>

            <div id="stats-summary">
                <p><strong>Games tracked:</strong> <span id="total-games">0</span></p>
                <p><strong>Total rounds:</strong> <span id="total-rounds">0</span></p>
            </div>
        `;
        document.body.appendChild(panel);

        document.addEventListener('click', function(e) {
            const p = document.getElementById('stats-tracker-panel');
            const b = document.getElementById('stats-tracker-toggle');
            
            if (p && p.style.display !== 'none') {
                if (!p.contains(e.target) && !b.contains(e.target)) {
                    p.style.display = 'none';
                }
            }
        });

        btn.onclick = () => {
            const visible = panel.style.display !== 'none';
            panel.style.display = visible ? 'none' : 'block';
        };

        document.getElementById('export-csv-btn').onclick = exportCSV;
        document.getElementById('import-recent-btn').onclick = importGames;
        document.getElementById('toggle-tracking-btn').onclick = toggleTracking;
        document.getElementById('clear-data-btn').onclick = clearData;

        updateStats();
    }

    function toggleTracking() {
        tracking = !tracking;
        const btn = document.getElementById('toggle-tracking-btn');
        btn.textContent = tracking ? '⏸️ Pause Tracking' : '▶️ Resume Tracking';
        notify(tracking ? 'Tracking resumed' : 'Tracking paused', 'info');
    }

    function clearData() {
        if (confirm('Clear all tracked data? This cannot be undone.')) {
            games = [];
            GM_setValue(STORAGE_KEY, games);
            updateStats();
            notify('All data cleared', 'warning');
        }
    }

    function setStatus(msg) {
        const el = document.getElementById('tracker-status');
        if (el) el.textContent = msg;
    }

    function updateGameInfo() {
        const el = document.getElementById('current-game-info');
        if (!el) return;
        
        if (activeToken) {
            el.innerHTML = `
                <strong>Currently Tracking:</strong><br>
                Game: ${activeToken.substring(0, 8)}...
            `;
        } else if (lastGame) {
            el.innerHTML = `
                <strong>Last Game:</strong><br>
                Map: ${lastGame.map}<br>
                Score: ${lastGame.totalScore.toLocaleString()}<br>
                Mode: ${lastGame.gameMode}
            `;
        } else {
            el.innerHTML = 'No active game';
        }
    }

    function updateStats() {
        const total = games.length;
        const rounds = games.reduce((sum, g) => sum + (g.rounds?.length || 0), 0);

        const tg = document.getElementById('total-games');
        const tr = document.getElementById('total-rounds');

        if (tg) tg.textContent = total;
        if (tr) tr.textContent = rounds;
    }

    function notify(msg, type = 'info') {
        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196F3'
        };

        const n = document.createElement('div');
        n.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${colors[type]};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 2147483648;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 14px;
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;
        n.textContent = msg;
        document.body.appendChild(n);

        setTimeout(() => {
            n.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => n.remove(), 300);
        }, 3000);
    }

    GM_addStyle(`
        #geoguessr-toolbar {
            position: fixed !important;
            top: 90px !important;
            right: 15px !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            z-index: 2147483647 !important;
            align-items: center !important;
            background: rgba(0, 0, 0, 0.7) !important;
            padding: 10px 8px !important;
            border-radius: 20px !important;
            backdrop-filter: blur(10px) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            transition: all 0.3s ease !important;
        }

        .geoguessr-toolbar-btn {
            width: 40px !important;
            height: 40px !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            font-size: 18px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
            transition: all 0.3s ease !important;
            border: 1px solid rgba(255, 255, 255, 0.3) !important;
            user-select: none !important;
            flex-shrink: 0 !important;
        }

        #stats-tracker-toggle {
            background: linear-gradient(135deg, #4CAF50, #45a049) !important;
            color: white !important;
        }

        .geoguessr-toolbar-btn:hover {
            transform: scale(1.1) !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
        }

        #stats-tracker-panel {
            position: fixed !important;
            top: 140px !important;
            right: 90px !important;
            background: rgba(20, 20, 20, 0.95) !important;
            color: white !important;
            padding: 12px !important;
            border-radius: 8px !important;
            z-index: 2147483646 !important;
            min-width: 220px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
            border: 2px solid #4CAF50 !important;
            backdrop-filter: blur(10px) !important;
        }

        #stats-tracker-panel h3 {
            margin: 0 0 8px 0 !important;
            color: #4CAF50 !important;
            font-size: 16px !important;
            font-weight: bold !important;
        }

        #stats-tracker-panel button {
            display: block !important;
            width: 100% !important;
            margin: 4px 0 !important;
            padding: 6px 10px !important;
            background: #4CAF50 !important;
            color: white !important;
            border: none !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            transition: all 0.2s !important;
        }

        #stats-tracker-panel button:hover {
            transform: translateY(-1px) !important;
            background: #45a049 !important;
        }

        #clear-data-btn {
            background: #f44336 !important;
        }

        #clear-data-btn:hover {
            background: #da190b !important;
        }

        #tracker-status {
            padding: 6px !important;
            margin: 6px 0 !important;
            background: rgba(255, 255, 255, 0.1) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            border-radius: 4px !important;
            text-align: center !important;
            font-size: 12px !important;
            font-weight: 500 !important;
        }

        #current-game-info, #stats-summary {
            font-size: 11px !important;
            margin: 8px 0 !important;
            padding: 6px !important;
            background: rgba(255, 255, 255, 0.05) !important;
            border-radius: 4px !important;
            line-height: 1.4 !important;
        }

        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
    `);

    async function init() {
        await loadCountries();
        createUI();
        watchUrl();
        setStatus('Ready to track');
        updateGameInfo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();