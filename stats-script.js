// ==UserScript==
// @name         GeoGuessr Stats Tracker (Enhanced Geocoding)
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Track your GeoGuessr game performance with high-precision country detection
// @author       You
// @match        https://www.geoguessr.com/*
// @match        https://geoguessr.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      www.geoguessr.com
// @connect      geoguessr.com
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      nominatim.openstreetmap.org
// @connect      api.bigdatacloud.net
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('%c📊 GeoGuessr Stats Tracker v3.3 Loaded!', 'color: #4CAF50; font-weight: bold; font-size: 14px');

    // ==================== ENHANCED GEOCODING SYSTEM ====================
    const CountryGeocoder = {
        polygons: null,
        loading: false,
        loaded: false,
        turfLoaded: false,
        useAPI: true,

        async init() {
            if (this.loaded || this.loading) return;
            this.loading = true;

            try {
                await this.loadTurf();

                const dataSources = [
                    {
                        name: 'Natural Earth 10m',
                        url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson',
                        resolution: '10m (~1-5km precision)'
                    },
                    {
                        name: 'World Boundaries',
                        url: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
                        resolution: '50m (~5-10km precision)'
                    },
                    {
                        name: 'Simplified Boundaries',
                        url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
                        resolution: '110m (~10-20km precision)',
                        isTopoJSON: true
                    }
                ];

                let dataLoaded = false;
                for (const source of dataSources) {
                    try {
                        const response = await fetch(source.url);
                        if (response.ok) {
                            const data = await response.json();
                            if (source.isTopoJSON) {
                                await this.loadTopoJSON();
                                this.polygons = await this.processTopoJSON(data);
                            } else {
                                this.polygons = this.processGeoJSON(data);
                            }
                            dataLoaded = true;
                            break;
                        }
                    } catch (error) {
                        continue;
                    }
                }

                if (!dataLoaded) {
                    this.polygons = this.getOfflinePreciseData();
                }

                this.loaded = true;
            } catch (error) {
                this.polygons = this.getOfflinePreciseData();
                this.loaded = true;
            }

            this.loading = false;
        },

        async loadTurf() {
            if (this.turfLoaded) return;

            return new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js';
                script.onload = () => {
                    this.turfLoaded = true;
                    resolve();
                };
                script.onerror = resolve;
                document.head.appendChild(script);
            });
        },

        async loadTopoJSON() {
            return new Promise((resolve) => {
                if (window.topojson) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3';
                script.onload = resolve;
                script.onerror = resolve;
                document.head.appendChild(script);
            });
        },

        processGeoJSON(geoData) {
            const countries = {};
            if (!geoData.features) return countries;

            geoData.features.forEach(feature => {
                if (!feature.properties || !feature.geometry) return;

                const iso2 = feature.properties.ISO_A2 ||
                            feature.properties.iso_a2 ||
                            feature.properties.ISO2 ||
                            feature.properties.iso_3166_1_alpha_2 ||
                            feature.properties.ISO_A2_EH;

                if (!iso2 || iso2 === '-99' || iso2.length !== 2) return;

                countries[iso2.toUpperCase()] = {
                    geometry: feature.geometry,
                    properties: feature.properties
                };
            });

            return countries;
        },

        async processTopoJSON(topology) {
            if (!window.topojson) return {};
            try {
                const geojson = window.topojson.feature(topology, topology.objects.countries);
                return this.processGeoJSON(geojson);
            } catch (error) {
                return {};
            }
        },

        async getCountry(lat, lng) {
            if (lat === null || lng === null || lat === undefined || lng === undefined) {
                return 'Unknown';
            }

            lng = ((lng + 180) % 360 + 360) % 360 - 180;

            const polygonCountry = this.getCountryFromPolygons(lat, lng);
            if (polygonCountry !== 'Unknown') {
                return polygonCountry;
            }

            if (this.useAPI) {
                try {
                    const apiCountry = await this.getCountryFromAPI(lat, lng);
                    if (apiCountry !== 'Unknown') {
                        return apiCountry;
                    }
                } catch (error) {
                    console.warn('API geocoding failed:', error);
                }
            }

            return 'Unknown';
        },

        getCountryFromPolygons(lat, lng) {
            if (!this.loaded || !this.polygons) return 'Unknown';
            const point = [lng, lat];

            if (this.turfLoaded && window.turf) {
                return this.getCountryWithTurf(point);
            }

            return this.getCountryManual(point);
        },

        getCountryWithTurf(point) {
            const turfPoint = window.turf.point(point);

            for (const [countryCode, data] of Object.entries(this.polygons)) {
                try {
                    if (window.turf.booleanPointInPolygon(turfPoint, data.geometry)) {
                        return countryCode;
                    }
                } catch (e) {
                    continue;
                }
            }

            return this.findNearestCountry(point);
        },

        findNearestCountry(point) {
            if (!this.turfLoaded || !window.turf) return 'Unknown';

            const turfPoint = window.turf.point(point);
            let nearestCountry = 'Unknown';
            let minDistance = Infinity;

            for (const [countryCode, data] of Object.entries(this.polygons)) {
                try {
                    const distance = window.turf.pointToLineDistance(turfPoint, data.geometry, {units: 'kilometers'});
                    if (distance < minDistance && distance < 10) {
                        minDistance = distance;
                        nearestCountry = countryCode;
                    }
                } catch (e) {
                    continue;
                }
            }

            return nearestCountry;
        },

        getCountryManual(point) {
            for (const [countryCode, data] of Object.entries(this.polygons)) {
                try {
                    const geometry = data.geometry;
                    if (geometry.type === 'Polygon') {
                        if (this.pointInPolygon(point, geometry.coordinates)) {
                            return countryCode;
                        }
                    } else if (geometry.type === 'MultiPolygon') {
                        if (this.pointInMultiPolygon(point, geometry.coordinates)) {
                            return countryCode;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
            return 'Unknown';
        },

        pointInPolygon(point, polygonCoords) {
            if (!this.pointInRing(point, polygonCoords[0])) {
                return false;
            }

            for (let i = 1; i < polygonCoords.length; i++) {
                if (this.pointInRing(point, polygonCoords[i])) {
                    return false;
                }
            }

            return true;
        },

        pointInMultiPolygon(point, multiPolygonCoords) {
            for (const polygonCoords of multiPolygonCoords) {
                if (this.pointInPolygon(point, polygonCoords)) {
                    return true;
                }
            }
            return false;
        },

        pointInRing(point, ring) {
            const [x, y] = point;
            let inside = false;

            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i];
                const [xj, yj] = ring[j];

                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

                if (intersect) inside = !inside;
            }

            return inside;
        },

        async getCountryFromAPI(lat, lng) {
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`
                );
                const data = await response.json();
                return data.address?.country_code?.toUpperCase() || 'Unknown';
            } catch (error) {
                return 'Unknown';
            }
        },

        getOfflinePreciseData() {
            return {
                'US': { geometry: { type: 'MultiPolygon', coordinates: [[[[-125, 49], [-125, 25], [-66, 25], [-66, 49], [-125, 49]]], [[[-170, 52], [-170, 71], [-130, 71], [-130, 52], [-170, 52]]], [[[-161, 18], [-161, 23], [-154, 23], [-154, 18], [-161, 18]]]] } },
                'CA': { geometry: { type: 'Polygon', coordinates: [[[-141, 42], [-141, 84], [-52, 84], [-52, 42], [-141, 42]]] } },
                'MX': { geometry: { type: 'Polygon', coordinates: [[[-118, 14], [-118, 33], [-86, 33], [-86, 14], [-118, 14]]] } },
                'BR': { geometry: { type: 'Polygon', coordinates: [[[-74, -34], [-74, 5], [-35, 5], [-35, -34], [-74, -34]]] } },
                'AR': { geometry: { type: 'Polygon', coordinates: [[[-74, -55], [-74, -21], [-53, -21], [-53, -55], [-74, -55]]] } },
                'GB': { geometry: { type: 'MultiPolygon', coordinates: [[[[-8, 50], [-8, 61], [2, 61], [2, 50], [-8, 50]]], [[[-7, 54], [-7, 59], [-5, 59], [-5, 54], [-7, 54]]]] } },
                'FR': { geometry: { type: 'Polygon', coordinates: [[[-5, 42], [-5, 51], [9, 51], [9, 42], [-5, 42]]] } },
                'DE': { geometry: { type: 'Polygon', coordinates: [[[6, 47], [6, 55], [15, 55], [15, 47], [6, 47]]] } },
                'IT': { geometry: { type: 'Polygon', coordinates: [[[6, 36], [6, 47], [19, 47], [19, 36], [6, 36]]] } },
                'ES': { geometry: { type: 'Polygon', coordinates: [[[-9, 36], [-9, 44], [4, 44], [4, 36], [-9, 36]]] } },
                'RU': { geometry: { type: 'Polygon', coordinates: [[[20, 41], [20, 82], [180, 82], [180, 41], [20, 41]]] } },
                'CN': { geometry: { type: 'Polygon', coordinates: [[[73, 18], [73, 54], [135, 54], [135, 18], [73, 18]]] } },
                'IN': { geometry: { type: 'Polygon', coordinates: [[[68, 8], [68, 37], [97, 37], [97, 8], [68, 8]]] } },
                'AU': { geometry: { type: 'Polygon', coordinates: [[[113, -44], [113, -10], [154, -10], [154, -44], [113, -44]]] } },
                'ZA': { geometry: { type: 'Polygon', coordinates: [[[16, -35], [16, -22], [33, -22], [33, -35], [16, -35]]] } },
                'JP': { geometry: { type: 'MultiPolygon', coordinates: [[[[129, 31], [129, 46], [146, 46], [146, 31], [129, 31]]]] } },
                'KR': { geometry: { type: 'Polygon', coordinates: [[[125, 33], [125, 39], [131, 39], [131, 33], [125, 33]]] } }
            };
        }
    };

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        CHECK_INTERVAL: 5000,
        STORAGE_KEY: 'geoguessr_stats_data'
    };

    // ==================== DATA STORAGE ====================
    let statsData = GM_getValue(CONFIG.STORAGE_KEY, []);
    let currentGameToken = null;
    let isMonitoring = false;
    let isTracking = true;
    let lastSavedGame = null;

    // ==================== SHARED UI CONTAINER ====================
    function getOrCreateToolbar() {
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

    function addButtonToToolbar(button) {
        const toolbar = getOrCreateToolbar();

        button.style.cssText = `
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

        button.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
        });

        button.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        });

        const existingButton = document.getElementById(button.id);
        if (!existingButton) {
            toolbar.appendChild(button);
        }
    }

    function startUrlMonitoring() {
        let currentUrl = window.location.href;

        setInterval(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                handleUrlChange(currentUrl);
            }
        }, 1000);

        handleUrlChange(currentUrl);
    }

    function handleUrlChange(url) {
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
                if (token !== currentGameToken) {
                    currentGameToken = token;
                    updateStatus('Game: ' + currentGameToken.substring(0, 8) + '...');
                    updateGameInfo(); // Update to show current tracking

                    if (!isMonitoring) {
                        startGameMonitoring();
                    }
                }
                break;
            }
        }
    }

    function startGameMonitoring() {
        if (isMonitoring || !currentGameToken) return;

        isMonitoring = true;

        const monitorInterval = setInterval(async () => {
            if (!currentGameToken || !isTracking) {
                clearInterval(monitorInterval);
                isMonitoring = false;
                return;
            }

            try {
                const gameData = await fetchGameData(currentGameToken);
                if (gameData && gameData.state === 'finished') {
                    await saveGame(gameData);
                    currentGameToken = null;
                    clearInterval(monitorInterval);
                    isMonitoring = false;
                }
            } catch (error) {
                console.error('Monitoring error:', error);
            }
        }, CONFIG.CHECK_INTERVAL);
    }

    async function fetchGameData(token) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.geoguessr.com/api/v3/games/${token}`,
                headers: { 'Accept': 'application/json' },
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (error) {
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

    async function saveGame(gameData) {
        if (!gameData || !gameData.token) return;

        if (statsData.find(g => g.token === gameData.token)) {
            return;
        }

        const formattedGame = await formatGameData(gameData);
        statsData.push(formattedGame);
        GM_setValue(CONFIG.STORAGE_KEY, statsData);

        lastSavedGame = formattedGame;
        updateStatus(`✅ Saved! Score: ${formattedGame.totalScore}`);
        updateSummary();
        updateGameInfo();
        showNotification(`Game saved! Score: ${formattedGame.totalScore}`, 'success');

        window.dispatchEvent(new CustomEvent('geoguessr-game-saved', {
            detail: { game: formattedGame }
        }));
    }

    async function formatGameData(gameData) {
        const player = gameData.player || {};
        const rounds = [];

        if (gameData.rounds && player.guesses) {
            for (let index = 0; index < gameData.rounds.length; index++) {
                const round = gameData.rounds[index];
                const guess = player.guesses[index] || {};

                const actualCountry = (round.streakLocationCode || 'Unknown').toUpperCase();
                const guessedCountry = await CountryGeocoder.getCountry(guess.lat, guess.lng);

                rounds.push({
                    roundNumber: index + 1,
                    actual: {
                        country: actualCountry,
                        lat: round.lat,
                        lng: round.lng
                    },
                    guessed: {
                        country: guessedCountry,
                        lat: guess.lat,
                        lng: guess.lng
                    },
                    distance: Math.round(guess.distanceInMeters || 0),
                    score: guess.roundScoreInPoints || 0,
                    time: guess.time || 0,
                    timedOut: guess.timedOut || false
                });
            }
        }

        return {
            token: gameData.token,
            timestamp: new Date().toISOString(),
            gameMode: getGameMode(gameData),
            map: gameData.mapName || 'Unknown',
            rounds: rounds,
            totalScore: player.totalScore?.amount || 0,
            totalDistance: Math.round(player.totalDistanceInMeters || 0),
            totalTime: player.totalTime || 0,
            restrictions: {
                timeLimit: gameData.timeLimit || 0,
                forbidMoving: gameData.forbidMoving || false,
                forbidZooming: gameData.forbidZooming || false,
                forbidRotating: gameData.forbidRotating || false
            }
        };
    }

    function getGameMode(gameData) {
        const { forbidMoving, forbidZooming, forbidRotating } = gameData;
        if (forbidMoving && forbidZooming && forbidRotating) return 'NMPZ';
        if (forbidMoving && !forbidZooming && !forbidRotating) return 'No Move';
        if (!forbidMoving && !forbidZooming && !forbidRotating) return 'Moving';
        return 'Custom';
    }

    // ==================== IMPORT/EXPORT FUNCTIONS ====================
    async function importRecentGames() {
        const pagesToScan = prompt('How many pages to scan? (1 page = ~10 games)', '5');
        if (!pagesToScan) return;

        const numPages = parseInt(pagesToScan) || 5;
        let imported = 0;

        updateStatus('Importing...');
        showNotification(`Scanning ${numPages} pages...`, 'info');

        try {
            for (let page = 0; page < numPages; page++) {
                updateStatus(`Page ${page + 1}/${numPages}...`);

                const response = await new Promise((resolve) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://www.geoguessr.com/api/v3/user/activities?page=${page}&count=10`,
                        headers: { 'Accept': 'application/json' },
                        onload: resolve,
                        onerror: () => resolve({ status: 0 })
                    });
                });

                if (response.status === 200) {
                    const activities = JSON.parse(response.responseText);
                    for (const activity of activities) {
                        if (activity.game) {
                            const gameData = await fetchGameData(activity.game);
                            if (gameData && gameData.state === 'finished') {
                                if (!statsData.find(g => g.token === activity.game)) {
                                    await saveGame(gameData);
                                    imported++;
                                }
                            }
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }
                }
                await new Promise(r => setTimeout(r, 500));
            }

            updateStatus(`✅ Imported ${imported} games`);
            showNotification(`Imported ${imported} new games!`, 'success');
        } catch (error) {
            console.error('Import error:', error);
            showNotification('Import failed', 'error');
        }
    }

    function exportToCSV() {
        if (statsData.length === 0) {
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

        let csvContent = headers.join(',') + '\n';

        statsData.forEach(game => {
            game.rounds.forEach(round => {
                const row = [
                    game.timestamp, game.gameMode, `"${game.map}"`,
                    game.totalScore, game.totalDistance, game.totalTime,
                    round.roundNumber, round.actual.country, round.actual.lat, round.actual.lng,
                    round.guessed.country, round.guessed.lat, round.guessed.lng,
                    round.distance, round.score, round.time, round.timedOut,
                    game.restrictions.timeLimit, game.restrictions.forbidMoving,
                    game.restrictions.forbidZooming, game.restrictions.forbidRotating
                ];
                csvContent += row.join(',') + '\n';
            });
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `geoguessr_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showNotification(`Exported ${statsData.length} games`, 'success');
    }

    // ==================== UI FUNCTIONS ====================
    function createUI() {
        if (document.getElementById('stats-tracker-toggle')) return;

        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'stats-tracker-toggle';
        toggleBtn.className = 'geoguessr-toolbar-btn';
        toggleBtn.innerHTML = '📊';
        toggleBtn.title = 'GeoGuessr Stats Tracker';

        addButtonToToolbar(toggleBtn);

        const panel = document.createElement('div');
        panel.id = 'stats-tracker-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <h3>📊 Stats Tracker v3.3</h3>
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

        // Click outside to close functionality
        document.addEventListener('click', function(event) {
            const panel = document.getElementById('stats-tracker-panel');
            const toggleBtn = document.getElementById('stats-tracker-toggle');
            
            if (panel && panel.style.display !== 'none') {
                if (!panel.contains(event.target) && !toggleBtn.contains(event.target)) {
                    panel.style.display = 'none';
                }
            }
        });

        toggleBtn.addEventListener('click', () => {
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';

            if (!isVisible) {
                const capturePanel = document.getElementById('capture-panel');
                if (capturePanel) capturePanel.style.display = 'none';
            }
        });

        document.getElementById('export-csv-btn')?.addEventListener('click', exportToCSV);
        document.getElementById('import-recent-btn')?.addEventListener('click', importRecentGames);
        document.getElementById('toggle-tracking-btn')?.addEventListener('click', toggleTracking);
        document.getElementById('clear-data-btn')?.addEventListener('click', clearData);

        updateSummary();
    }

    function toggleTracking() {
        isTracking = !isTracking;
        const btn = document.getElementById('toggle-tracking-btn');
        if (btn) {
            btn.textContent = isTracking ? '⏸️ Pause Tracking' : '▶️ Resume Tracking';
        }
        showNotification(isTracking ? 'Tracking resumed' : 'Tracking paused', 'info');
    }

    function clearData() {
        if (confirm('Clear all tracked data? This cannot be undone.')) {
            statsData = [];
            GM_setValue(CONFIG.STORAGE_KEY, statsData);
            updateSummary();
            showNotification('All data cleared', 'warning');
        }
    }

    function updateStatus(message) {
        const statusEl = document.getElementById('tracker-status');
        if (statusEl) statusEl.textContent = message;
    }

    function updateGameInfo() {
        const infoEl = document.getElementById('current-game-info');
        if (infoEl) {
            if (currentGameToken) {
                // Currently tracking a game
                infoEl.innerHTML = `
                    <strong>Currently Tracking:</strong><br>
                    Game: ${currentGameToken.substring(0, 8)}...
                `;
            } else if (lastSavedGame) {
                // Show last saved game
                infoEl.innerHTML = `
                    <strong>Last Game:</strong><br>
                    Map: ${lastSavedGame.map}<br>
                    Score: ${lastSavedGame.totalScore.toLocaleString()}<br>
                    Mode: ${lastSavedGame.gameMode}
                `;
            } else {
                // No active or previous game
                infoEl.innerHTML = 'No active game';
            }
        }
    }

    function updateSummary() {
        const totalGames = statsData.length;
        const totalRounds = statsData.reduce((sum, game) => sum + (game.rounds?.length || 0), 0);

        const totalGamesEl = document.getElementById('total-games');
        const totalRoundsEl = document.getElementById('total-rounds');

        if (totalGamesEl) totalGamesEl.textContent = totalGames;
        if (totalRoundsEl) totalRoundsEl.textContent = totalRounds;
    }

    function showNotification(message, type = 'info') {
        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196F3'
        };

        const notification = document.createElement('div');
        notification.style.cssText = `
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
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // ==================== STYLES ====================
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

    // ==================== INITIALIZATION ====================
    async function init() {
        await CountryGeocoder.init();
        createUI();
        startUrlMonitoring();
        updateStatus('Ready to track');
        updateGameInfo(); // Initialize game info display

        window.geoguessrCurrentGame = () => currentGameToken;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();