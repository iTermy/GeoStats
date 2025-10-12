// ==UserScript==
// @name         GeoGuessr Stats Tracker
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Track your GeoGuessr game performance and export statistics
// @author       You
// @match        https://www.geoguessr.com/*
// @match        https://geoguessr.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      www.geoguessr.com
// @connect      geoguessr.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('%c📊 GeoGuessr Stats Tracker v3.1 Loaded!', 'color: #4CAF50; font-weight: bold; font-size: 14px');

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

    console.log('📊 Found', statsData.length, 'saved games');

    // ==================== SHARED UI CONTAINER ====================
    function getOrCreateToolbar() {
    let toolbar = document.getElementById('geoguessr-toolbar');
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'geoguessr-toolbar';
        toolbar.style.cssText = `
            position: fixed;
            top: 80px; /* Positioned right under the GeoGuessr banner */
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

    // Smaller button styling
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

    // Add hover effects
    button.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.1)';
        this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
    });

    button.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    });

    // Check if button already exists to avoid duplicates
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

    handleUrlChange(currentUrl); // Check current URL on init
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
                    console.log('🎮 Game detected:', currentGameToken);
                    updateStatus('Game: ' + currentGameToken.substring(0, 8) + '...');

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
        console.log('🔄 Monitoring game:', currentGameToken);

        const monitorInterval = setInterval(async () => {
            if (!currentGameToken || !isTracking) {
                clearInterval(monitorInterval);
                isMonitoring = false;
                return;
            }

            try {
                const gameData = await fetchGameData(currentGameToken);
                if (gameData && gameData.state === 'finished') {
                    console.log('✅ Game finished, saving...');
                    saveGame(gameData);
                    currentGameToken = null;
                    clearInterval(monitorInterval);
                    isMonitoring = false;
                }
            } catch (error) {
                console.error('❌ Monitoring error:', error);
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

    function saveGame(gameData) {
        if (!gameData || !gameData.token) return;

        if (statsData.find(g => g.token === gameData.token)) {
            console.log('Game already saved');
            return;
        }

        const formattedGame = formatGameData(gameData);
        statsData.push(formattedGame);
        GM_setValue(CONFIG.STORAGE_KEY, statsData);

        updateStatus(`✅ Saved! Score: ${formattedGame.totalScore}`);
        updateSummary();
        updateGameInfo(formattedGame);
        showNotification(`Game saved! Score: ${formattedGame.totalScore}`, 'success');

        // Broadcast event for other scripts (like screen capture)
        window.dispatchEvent(new CustomEvent('geoguessr-game-saved', {
            detail: { game: formattedGame }
        }));
    }

    function formatGameData(gameData) {
        const player = gameData.player || {};
        const rounds = [];

        if (gameData.rounds && player.guesses) {
            gameData.rounds.forEach((round, index) => {
                const guess = player.guesses[index] || {};
                rounds.push({
                    roundNumber: index + 1,
                    actual: {
                        country: round.streakLocationCode || 'Unknown',
                        lat: round.lat,
                        lng: round.lng
                    },
                    guessed: {
                        country: guess.streakLocationCode || 'Unknown',
                        lat: guess.lat,
                        lng: guess.lng
                    },
                    distance: Math.round(guess.distanceInMeters || 0),
                    score: guess.roundScoreInPoints || 0,
                    time: guess.time || 0,
                    timedOut: guess.timedOut || false
                });
            });
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
                                    saveGame(gameData);
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

        // Create toggle button for toolbar
        const toggleBtn = document.createElement('div');
        toggleBtn.id = 'stats-tracker-toggle';
        toggleBtn.className = 'geoguessr-toolbar-btn';
        toggleBtn.innerHTML = '📊';
        toggleBtn.title = 'GeoGuessr Stats Tracker';

        // Add button to shared toolbar
        addButtonToToolbar(toggleBtn);

        // Create main panel
        const panel = document.createElement('div');
        panel.id = 'stats-tracker-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <h3>📊 Stats Tracker</h3>
            <div id="tracker-status">✅ Ready</div>
            <div id="current-game-info">No active game</div>

            <button id="export-csv-btn">📥 Export to CSV</button>
            <button id="import-recent-btn">📤 Import Recent Games</button>
            <button id="test-api-btn">🔧 Test API Connection</button>

            <button id="clear-data-btn">🗑️ Clear Data</button>
            <button id="toggle-tracking-btn">⏸️ Pause Tracking</button>

            <div id="stats-summary">
                <p><strong>Games tracked:</strong> <span id="total-games">0</span></p>
                <p><strong>Total rounds:</strong> <span id="total-rounds">0</span></p>
            </div>
        `;
        document.body.appendChild(panel);

        // Add event listeners
        toggleBtn.addEventListener('click', () => {
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';

            // Close other panels when opening this one
            if (!isVisible) {
                const capturePanel = document.getElementById('capture-panel');
                if (capturePanel) capturePanel.style.display = 'none';
            }
        });

        document.getElementById('export-csv-btn')?.addEventListener('click', exportToCSV);
        document.getElementById('import-recent-btn')?.addEventListener('click', importRecentGames);
        document.getElementById('test-api-btn')?.addEventListener('click', testAPIConnection);
        document.getElementById('clear-data-btn')?.addEventListener('click', clearData);
        document.getElementById('toggle-tracking-btn')?.addEventListener('click', toggleTracking);

        updateSummary();
        showNotification('Stats Tracker loaded!', 'success');
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

    async function testAPIConnection() {
        updateStatus('Testing API...');
        try {
            const response = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://www.geoguessr.com/api/v3/profiles/user',
                    headers: { 'Accept': 'application/json' },
                    onload: resolve,
                    onerror: () => resolve({ status: 0 })
                });
            });

            if (response.status === 200) {
                const data = JSON.parse(response.responseText);
                showNotification(`✅ API working! User: ${data.nick || 'Unknown'}`, 'success');
            } else {
                showNotification('API connection failed', 'error');
            }
        } catch (error) {
            showNotification('API test failed', 'error');
        }
    }

    function updateStatus(message) {
        const statusEl = document.getElementById('tracker-status');
        if (statusEl) statusEl.textContent = message;
    }

    function updateSummary() {
        const totalGames = statsData.length;
        const totalRounds = statsData.reduce((sum, game) => sum + (game.rounds?.length || 0), 0);

        const totalGamesEl = document.getElementById('total-games');
        const totalRoundsEl = document.getElementById('total-rounds');

        if (totalGamesEl) totalGamesEl.textContent = totalGames;
        if (totalRoundsEl) totalRoundsEl.textContent = totalRounds;
    }

    function updateGameInfo(game) {
        const infoEl = document.getElementById('current-game-info');
        if (infoEl && game) {
            infoEl.innerHTML = `
                <strong>Last Game:</strong><br>
                Map: ${game.map}<br>
                Score: ${game.totalScore.toLocaleString()}<br>
                Mode: ${game.gameMode}
            `;
        }
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
    top: 90px !important; /* Right under the GeoGuessr banner */
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

#capture-toggle {
    background: linear-gradient(135deg, #2196F3, #1976D2) !important;
    color: white !important;
}

#stats-tracker-toggle {
    background: linear-gradient(135deg, #4CAF50, #45a049) !important;
    color: white !important;
}

.geoguessr-toolbar-btn:hover {
    transform: scale(1.1) !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
}

#capture-toggle:hover {
    box-shadow: 0 4px 12px rgba(33, 150, 243, 0.4) !important;
}

#stats-tracker-toggle:hover {
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4) !important;
}

/* Update panel positioning to be below the toolbar */
#capture-panel, #stats-tracker-panel {
    position: fixed !important;
    top: 140px !important; /* Below the toolbar */
    right: 90px !important;
    background: rgba(20, 20, 20, 0.95) !important;
    color: white !important;
    padding: 12px !important;
    border-radius: 8px !important;
    z-index: 2147483646 !important;
    min-width: 220px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
    border: 2px solid #2196F3 !important;
    backdrop-filter: blur(10px) !important;
}

#stats-tracker-panel {
    border-color: #4CAF50 !important;
}

#capture-panel *,
#stats-tracker-panel * {
    box-sizing: border-box !important;
}

#capture-panel h3,
#stats-tracker-panel h3 {
    margin: 0 0 8px 0 !important;
    color: #2196F3 !important;
    font-size: 16px !important;
    font-weight: bold !important;
}

#stats-tracker-panel h3 {
    color: #4CAF50 !important;
}

#capture-panel button,
#stats-tracker-panel button {
    display: block !important;
    width: 100% !important;
    margin: 4px 0 !important;
    padding: 6px 10px !important;
    background: #2196F3 !important;
    color: white !important;
    border: none !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    transition: all 0.2s !important;
}

#stats-tracker-panel button {
    background: #4CAF50 !important;
}

#capture-panel button:hover,
#stats-tracker-panel button:hover {
    transform: translateY(-1px) !important;
}

#capture-panel button:hover {
    background: #1976D2 !important;
}

#stats-tracker-panel button:hover {
    background: #45a049 !important;
}

#stop-capture-btn,
#clear-data-btn {
    background: #f44336 !important;
}

#stop-capture-btn:hover,
#clear-data-btn:hover {
    background: #da190b !important;
}

/* Smaller status elements */
#capture-status,
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

#capture-info,
#current-game-info,
#stats-summary {
    font-size: 11px !important;
    margin: 8px 0 !important;
    padding: 6px !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border-radius: 4px !important;
    line-height: 1.4 !important;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    #geoguessr-toolbar {
        top: 70px !important;
        right: 10px !important;
        gap: 6px !important;
        padding: 8px 6px !important;
    }

    .geoguessr-toolbar-btn {
        width: 35px !important;
        height: 35px !important;
        font-size: 16px !important;
    }

    #capture-panel,
    #stats-tracker-panel {
        top: 120px !important;
        right: 10px !important;
        min-width: 200px !important;
        padding: 10px !important;
    }
}

@media (max-width: 480px) {
    #geoguessr-toolbar {
        top: 60px !important;
        flex-direction: row !important; /* Horizontal on very small screens */
        gap: 8px !important;
        padding: 8px 10px !important;
        border-radius: 15px !important;
    }

    #capture-panel,
    #stats-tracker-panel {
        top: 110px !important;
        right: 10px !important;
        min-width: 180px !important;
    }
}
    `);

    // ==================== INITIALIZATION ====================
    function init() {
        console.log('🚀 Initializing Stats Tracker...');
        createUI();
        startUrlMonitoring();
        updateStatus('Ready to track');

        // Expose current game token for screen capture script
        window.geoguessrCurrentGame = () => currentGameToken;
    }

    // Start the script
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();