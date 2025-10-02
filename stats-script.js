// ==UserScript==
// @name         GeoGuessr Stats Tracker
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Track your GeoGuessr performance with detailed statistics
// @author       You
// @match        https://www.geoguessr.com/*
// @match        https://geoguessr.com/*
// @match        http://www.geoguessr.com/*
// @match        http://geoguessr.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_download
// @connect      www.geoguessr.com
// @connect      geoguessr.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Immediate console log to verify script is loading
    console.log('%c🎯 GeoGuessr Stats Tracker: Script injected!', 'color: #4CAF50; font-weight: bold; font-size: 14px');
    console.log('Current URL:', window.location.href);
    console.log('Document ready state:', document.readyState);

    // Configuration
    const CONFIG = {
        CHECK_INTERVAL: 5000,
        STORAGE_KEY: 'geoguessr_stats_data'
    };

    // ==================== IMAGE CAPTURE MODULE ====================
    const IMAGE_CAPTURE = {
        enabled: GM_getValue('capture_images', false),
        quality: GM_getValue('image_quality', 0.8),
        format: 'jpeg',
        capturedThisRound: false,
        currentRoundNumber: 0,
        debugMode: true // Set to false once working
    };

    // Canvas detection and capture functions
    function findStreetViewCanvas() {
        const canvases = document.querySelectorAll('canvas');
        
        if (IMAGE_CAPTURE.debugMode) {
            console.log(`🖼️ Found ${canvases.length} canvases on page:`);
            canvases.forEach((canvas, index) => {
                console.log(`  Canvas ${index}: ${canvas.width}x${canvas.height}, parent: ${canvas.parentElement?.className}`);
            });
        }
        
        // Strategy 1: Find the largest canvas (usually Street View)
        const largeCanvases = Array.from(canvases)
            .filter(c => c.width >= 500 && c.height >= 400)
            .sort((a, b) => (b.width * b.height) - (a.width * a.height));
        
        if (largeCanvases.length > 0) {
            // Street View is typically the largest or second-largest canvas
            // Sometimes UI overlay is on top
            return largeCanvases[0];
        }
        
        // Strategy 2: Look for canvas in specific game container
        const gameCanvas = document.querySelector('.game_canvas canvas, .game-layout__canvas canvas, [class*="game"] canvas');
        if (gameCanvas && gameCanvas.width > 400) {
            return gameCanvas;
        }
        
        return null;
    }

    function captureCanvas(canvas) {
        try {
            // First, check if this is a WebGL canvas
            const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
                    canvas.getContext('webgl2', { preserveDrawingBuffer: true }) || 
                    canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
            
            if (gl) {
                console.log('🎨 WebGL context detected');
                
                // Method 1: Try to force preserve the drawing buffer
                if (!gl.getContextAttributes().preserveDrawingBuffer) {
                    console.log('⚠️ Drawing buffer not preserved, attempting workaround...');
                    
                    // Create a new canvas and copy the pixels
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    
                    // Read pixels directly from WebGL
                    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    
                    // Create ImageData from pixels
                    const imageData = new ImageData(new Uint8ClampedArray(pixels), canvas.width, canvas.height);
                    
                    // Flip vertically (WebGL renders upside down)
                    tempCtx.translate(0, canvas.height);
                    tempCtx.scale(1, -1);
                    tempCtx.putImageData(imageData, 0, 0);
                    
                    return tempCanvas.toDataURL(`image/${IMAGE_CAPTURE.format}`, IMAGE_CAPTURE.quality);
                }
            }
            
            // Try direct capture
            const dataURL = canvas.toDataURL(`image/${IMAGE_CAPTURE.format}`, IMAGE_CAPTURE.quality);
            
            // Check if we got actual image data (not blank)
            if (dataURL && dataURL.length > 1000) { // Increased threshold
                // Quick check if it's not all black
                const img = new Image();
                img.src = dataURL;
                return dataURL;
            }
            
            console.log('⚠️ Direct capture returned empty/black image');
            
        } catch (error) {
            console.error('❌ Canvas capture error:', error);
        }
        return null;
    }

    function saveImage(dataURL, gameToken, roundNumber) {
        if (!dataURL) return false;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `geoguessr_${gameToken}_r${roundNumber}_${timestamp}.${IMAGE_CAPTURE.format}`;
        
        try {
            // Use GM_download to save the image
            GM_download({
                url: dataURL,
                name: filename,
                saveAs: false // Auto-save to downloads folder
            });
            
            console.log(`✅ Image saved: ${filename}`);
            showNotification(`Image captured for round ${roundNumber}`, 'success');
            return true;
        } catch (error) {
            console.error('❌ Image save error:', error);
            return false;
        }
    }

    // Debug function to capture ALL canvases
    function captureAllCanvases() {
        const canvases = document.querySelectorAll('canvas');
        canvases.forEach((canvas, index) => {
            if (canvas.width > 100 && canvas.height > 100) {
                try {
                    const dataURL = canvas.toDataURL('image/png', 1.0);
                    if (dataURL && dataURL.length > 1000) {
                        saveImage(dataURL, `CANVAS_TEST_${index}`, canvas.width);
                        console.log(`✅ Saved canvas ${index}: ${canvas.width}x${canvas.height}`);
                    } else {
                        console.log(`❌ Canvas ${index} is blank/black`);
                    }
                } catch (e) {
                    console.log(`❌ Canvas ${index} error:`, e.message);
                }
            }
        });
    }

    // Test capture function for manual testing
    function testImageCapture() {
        console.log('🧪 Testing image capture...');
        updateStatus('Testing image capture...');
        
        const canvas = findStreetViewCanvas();
        
        if (!canvas) {
            showNotification('❌ No Street View canvas found', 'error');
            updateStatus('Canvas not found');
            return;
        }
        
        console.log(`📐 Found canvas: ${canvas.width}x${canvas.height}`);
        const dataURL = captureCanvas(canvas);
        
        if (dataURL) {
            // For testing, save with a test filename
            saveImage(dataURL, 'TEST', 0);
            updateStatus('✅ Test capture successful!');
            
            // Optional: Show preview
            if (IMAGE_CAPTURE.debugMode) {
                showImagePreview(dataURL);
            }
        } else {
            showNotification('❌ Failed to capture canvas', 'error');
            updateStatus('Capture failed');
        }
    }

    // Show a preview of captured image (for debugging)
    function showImagePreview(dataURL) {
        const preview = document.createElement('div');
        preview.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 999999;
            background: white;
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            max-width: 300px;
        `;
        
        const img = document.createElement('img');
        img.src = dataURL;
        img.style.cssText = 'width: 100%; border-radius: 4px;';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close Preview';
        closeBtn.style.cssText = `
            width: 100%;
            margin-top: 10px;
            padding: 5px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        `;
        closeBtn.onclick = () => preview.remove();
        
        preview.appendChild(img);
        preview.appendChild(closeBtn);
        document.body.appendChild(preview);
        
        // Auto-remove after 5 seconds
        setTimeout(() => preview.remove(), 5000);
    }

    // Hook into guess submission
    function initializeImageCapture() {
        console.log('📸 Initializing image capture module...');
        
        // Monitor for guess button clicks
        document.addEventListener('click', function(e) {
            // Look for guess button (multiple possible selectors)
            const guessButton = e.target.closest(
                'button[data-qa="guess-button"], ' +
                'button[class*="guess"], ' +
                'button[class*="submit"], ' +
                '.game-statuses__guess-button, ' +
                '[class*="game-status"] button'
            );
            
            if (guessButton && IMAGE_CAPTURE.enabled && !IMAGE_CAPTURE.capturedThisRound) {
                console.log('🎯 Guess button clicked! Attempting capture...');
                
                // Small delay to ensure the guess is registered
                setTimeout(() => {
                    const canvas = findStreetViewCanvas();
                    if (canvas && currentGameToken) {
                        const dataURL = captureCanvas(canvas);
                        if (dataURL) {
                            // Determine round number (you may need to adjust this logic)
                            const roundNumber = IMAGE_CAPTURE.currentRoundNumber + 1;
                            saveImage(dataURL, currentGameToken, roundNumber);
                            IMAGE_CAPTURE.capturedThisRound = true;
                            IMAGE_CAPTURE.currentRoundNumber = roundNumber;
                        }
                    }
                }, 100);
            }
        }, true); // Use capture phase to catch event early
        
        // Reset capture flag when new round starts
        const observer = new MutationObserver(() => {
            // Look for round change indicators
            const roundIndicator = document.querySelector('[class*="round-result"], [class*="round-number"]');
            if (roundIndicator) {
                IMAGE_CAPTURE.capturedThisRound = false;
            }
        });
        
        observer.observe(document.body, { 
            childList: true, 
            subtree: true 
        });
    }

    // ==================== END IMAGE CAPTURE MODULE ====================

    // Data storage
    let statsData = GM_getValue(CONFIG.STORAGE_KEY, []);
    let currentGameToken = null;
    let isMonitoring = false;
    let isTracking = true;

    console.log('📊 Stats Tracker: Found', statsData.length, 'saved games');

    // CSS Styles - inject immediately
    const styles = `
        #stats-tracker-panel {
            position: fixed !important;
            top: 80px !important;
            right: 10px !important;
            background: rgba(20, 20, 20, 0.95) !important;
            color: white !important;
            padding: 15px !important;
            border-radius: 8px !important;
            z-index: 2147483647 !important;
            min-width: 250px !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
            border: 2px solid #4CAF50 !important;
        }

        #stats-tracker-panel * {
            box-sizing: border-box !important;
        }

        #stats-tracker-panel h3 {
            margin: 0 0 10px 0 !important;
            color: #4CAF50 !important;
            font-size: 18px !important;
            font-weight: bold !important;
        }

        #stats-tracker-panel button {
            display: block !important;
            width: 100% !important;
            margin: 5px 0 !important;
            padding: 8px 12px !important;
            background: #4CAF50 !important;
            color: white !important;
            border: none !important;
            border-radius: 4px !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            transition: all 0.2s !important;
        }

        #stats-tracker-panel button:hover {
            background: #45a049 !important;
            transform: translateY(-1px) !important;
        }

        #clear-data-btn {
            background: #f44336 !important;
        }

        #clear-data-btn:hover {
            background: #da190b !important;
        }

        #tracker-status {
            padding: 8px !important;
            margin: 8px 0 !important;
            background: rgba(76, 175, 80, 0.2) !important;
            border: 1px solid #4CAF50 !important;
            border-radius: 4px !important;
            text-align: center !important;
            font-size: 13px !important;
            font-weight: 500 !important;
        }

        #current-game-info {
            font-size: 12px !important;
            margin: 10px 0 !important;
            padding: 8px !important;
            background: rgba(255, 255, 255, 0.05) !important;
            border-radius: 4px !important;
            line-height: 1.5 !important;
        }

        #stats-summary {
            margin-top: 10px !important;
            padding-top: 10px !important;
            border-top: 1px solid rgba(255, 255, 255, 0.2) !important;
            font-size: 13px !important;
        }

        #stats-summary p {
            margin: 5px 0 !important;
        }

        #stats-tracker-toggle {
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            width: 50px !important;
            height: 50px !important;
            background: linear-gradient(135deg, #4CAF50, #45a049) !important;
            color: white !important;
            border-radius: 50% !important;
            cursor: pointer !important;
            z-index: 2147483647 !important;
            font-size: 24px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
            transition: all 0.3s ease !important;
            border: 2px solid white !important;
            user-select: none !important;
        }

        #stats-tracker-toggle:hover {
            transform: scale(1.1) rotate(10deg) !important;
            box-shadow: 0 6px 20px rgba(76, 175, 80, 0.6) !important;
        }

        #stats-tracker-toggle:active {
            transform: scale(0.95) !important;
        }
    `;

    // Inject styles
    GM_addStyle(styles);
    console.log('✅ Stats Tracker: Styles injected');

    // Create UI with multiple attempts
    function createUI() {
        console.log('🔨 Stats Tracker: Creating UI...');

        // Check if UI already exists
        if (document.getElementById('stats-tracker-toggle')) {
            console.log('⚠️ Stats Tracker: UI already exists');
            return;
        }

        try {
            // Create toggle button
            const toggleBtn = document.createElement('div');
            toggleBtn.id = 'stats-tracker-toggle';
            toggleBtn.innerHTML = '📊';
            toggleBtn.title = 'GeoGuessr Stats Tracker (Click to toggle)';
            document.body.appendChild(toggleBtn);
            console.log('✅ Toggle button created');

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
                <button id="test-capture-btn">📸 Test Image Capture</button>
                <button id="toggle-capture-btn">${IMAGE_CAPTURE.enabled ? '🔴' : '⚫'} ${IMAGE_CAPTURE.enabled ? 'Disable' : 'Enable'} Auto Capture</button>
                <div id="capture-status" style="margin-top: 10px; padding: 5px; background: rgba(255,255,255,0.1); border-radius: 4px; font-size: 12px;">
                    Image Capture: ${IMAGE_CAPTURE.enabled ? 'ON' : 'OFF'}
                </div>
                <button id="capture-all-btn">🔍 Capture All Canvases</button>
                <button id="clear-data-btn">🗑️ Clear Data</button>
                <button id="toggle-tracking-btn">⏸️ Pause Tracking</button>
                <div id="stats-summary">
                    <p><strong>Games tracked:</strong> <span id="total-games">0</span></p>
                    <p><strong>Total rounds:</strong> <span id="total-rounds">0</span></p>
                </div>
            `;
            document.body.appendChild(panel);
            console.log('✅ Panel created');

            // Add event listeners
            toggleBtn.addEventListener('click', togglePanel);
            document.getElementById('export-csv-btn').addEventListener('click', exportToCSV);
            document.getElementById('import-recent-btn').addEventListener('click', importRecentGames);
            document.getElementById('test-api-btn').addEventListener('click', testAPIConnection);
            document.getElementById('clear-data-btn').addEventListener('click', clearData);
            document.getElementById('toggle-tracking-btn').addEventListener('click', toggleTracking);
            document.getElementById('test-capture-btn').addEventListener('click', testImageCapture);
            document.getElementById('toggle-capture-btn').addEventListener('click', toggleImageCapture);
            document.getElementById('capture-all-btn').addEventListener('click', captureAllCanvases);

            updateSummary();
            console.log('✅ Stats Tracker: UI created successfully!');

            // Show notification that script is loaded
            showNotification('Stats Tracker loaded! Click 📊 to open.', 'success');

        } catch (error) {
            console.error('❌ Stats Tracker: Error creating UI:', error);
        }
    }

    // Test API connection
    async function testAPIConnection() {
        updateStatus('Testing API connection...');

        try {
            // Try to fetch user profile as a test
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://www.geoguessr.com/api/v3/profiles/user',
                    headers: {
                        'Accept': 'application/json',
                    },
                    onload: resolve,
                    onerror: reject
                });
            });

            if (response.status === 200) {
                const data = JSON.parse(response.responseText);
                showNotification(`✅ API working! Logged in as: ${data.nick || 'User'}`, 'success');
                updateStatus('API connection successful!');
            } else if (response.status === 401) {
                showNotification('⚠️ Not logged in to GeoGuessr', 'warning');
                updateStatus('Please log in to GeoGuessr');
            } else {
                showNotification(`❌ API error: ${response.status}`, 'error');
                updateStatus(`API error: ${response.status}`);
            }
        } catch (error) {
            console.error('API test error:', error);
            showNotification('❌ Failed to connect to API', 'error');
            updateStatus('API connection failed');
        }
    }

    // Show notification
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
            font-family: Arial, sans-serif;
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

    // Add animation styles
    GM_addStyle(`
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
    `);

    // Toggle panel visibility
    function togglePanel() {
        const panel = document.getElementById('stats-tracker-panel');
        if (panel) {
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';
            console.log('Panel toggled:', !isVisible ? 'visible' : 'hidden');
        }
    }

    // Monitor for URL changes
    function startUrlMonitoring() {
        console.log('👀 Stats Tracker: Starting URL monitoring...');
        let currentUrl = window.location.href;

        // Check URL periodically
        setInterval(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                console.log('📍 URL changed to:', currentUrl);
                handleUrlChange(currentUrl);
            }
        }, 1000);

        // Check initial URL
        handleUrlChange(currentUrl);
    }

    // Handle URL changes
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
                    updateStatus('Game detected: ' + currentGameToken.substring(0, 8) + '...');

                    // Start monitoring this game
                    if (!isMonitoring) {
                        startGameMonitoring();
                    }
                }
                break;
            }
        }
    }

    // Monitor current game
    function startGameMonitoring() {
        if (isMonitoring || !currentGameToken) return;

        isMonitoring = true;
        console.log('🔄 Starting game monitoring for:', currentGameToken);

        const monitorInterval = setInterval(async () => {
            if (!currentGameToken || !isTracking) {
                clearInterval(monitorInterval);
                isMonitoring = false;
                return;
            }

            try {
                const gameData = await fetchGameData(currentGameToken);
                if (gameData) {
                    if (gameData.state === 'finished') {
                        console.log('✅ Game finished, saving...');
                        saveGame(gameData);
                        currentGameToken = null;
                        clearInterval(monitorInterval);
                        isMonitoring = false;
                    } else {
                        console.log('⏳ Game still in progress...');
                    }
                }
            } catch (error) {
                console.error('❌ Error monitoring game:', error);
            }
        }, CONFIG.CHECK_INTERVAL);
    }

    // Fetch game data
    async function fetchGameData(token) {
        console.log('🔍 Fetching game data for:', token);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.geoguessr.com/api/v3/games/${token}`,
                headers: {
                    'Accept': 'application/json',
                },
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            console.log('✅ Game data received');
                            resolve(data);
                        } catch (error) {
                            console.error('❌ Error parsing game data:', error);
                            resolve(null);
                        }
                    } else {
                        console.warn(`⚠️ Could not fetch game ${token}: ${response.status}`);
                        resolve(null);
                    }
                },
                onerror: function(error) {
                    console.error('❌ Request error:', error);
                    reject(error);
                }
            });
        });
    }

    // Save game data
    function saveGame(gameData) {
        if (!gameData || !gameData.token) {
            console.log('⚠️ Invalid game data');
            return;
        }

        // Check if already saved
        const existingGame = statsData.find(g => g.token === gameData.token);
        if (existingGame) {
            console.log('ℹ️ Game already saved');
            return;
        }

        // Format game data
        const formattedGame = formatGameData(gameData);

        // Add to stats
        statsData.push(formattedGame);
        GM_setValue(CONFIG.STORAGE_KEY, statsData);

        updateStatus(`✅ Game saved! Score: ${formattedGame.totalScore}`);
        updateSummary();
        updateGameInfo(formattedGame);
        showNotification(`Game saved! Score: ${formattedGame.totalScore}`, 'success');

        console.log('💾 Game saved:', formattedGame);
    }

    // Format game data for storage
    function formatGameData(gameData) {
        const player = gameData.player || {};
        const rounds = [];

        // Process each round
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

    // Determine game mode
    function getGameMode(gameData) {
        const { forbidMoving, forbidZooming, forbidRotating } = gameData;

        if (forbidMoving && forbidZooming && forbidRotating) {
            return 'NMPZ';
        } else if (forbidMoving && !forbidZooming && !forbidRotating) {
            return 'No Move';
        } else if (!forbidMoving && !forbidZooming && !forbidRotating) {
            return 'Moving';
        } else {
            return 'Custom';
        }
    }

    // Import recent games
    async function importRecentGames() {
        updateStatus('Starting import...');
        console.log('📤 Starting import of recent games...');

        const pagesToScan = prompt('How many pages to scan? (1 page = ~10 games)', '5');
        if (!pagesToScan) return;

        const numPages = parseInt(pagesToScan) || 5;
        let imported = 0;
        let checked = 0;

        showNotification(`Scanning ${numPages} pages...`, 'info');

        try {
            for (let page = 0; page < numPages; page++) {
                updateStatus(`Scanning page ${page + 1}/${numPages}...`);

                // Try to fetch from activity feed
                const activities = await fetchActivities(page);

                if (activities && activities.length > 0) {
                    for (const activity of activities) {
                        if (activity.game) {
                            checked++;
                            const gameData = await fetchGameData(activity.game);
                            if (gameData && gameData.state === 'finished') {
                                const existingGame = statsData.find(g => g.token === activity.game);
                                if (!existingGame) {
                                    saveGame(gameData);
                                    imported++;
                                }
                            }
                            await delay(200);
                        }
                    }
                }

                await delay(500);
            }

            updateStatus(`✅ Import complete! ${imported} new games`);
            showNotification(`Imported ${imported} new games!`, 'success');

        } catch (error) {
            console.error('❌ Import error:', error);
            updateStatus('Import failed');
            showNotification('Import failed', 'error');
        }
    }

    // Fetch activities
    async function fetchActivities(page) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://www.geoguessr.com/api/v3/user/activities?page=${page}&count=10`,
                headers: {
                    'Accept': 'application/json',
                },
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            resolve([]);
                        }
                    } else {
                        resolve([]);
                    }
                },
                onerror: () => resolve([])
            });
        });
    }

    // Export to CSV
    function exportToCSV() {
        if (statsData.length === 0) {
            alert('No data to export! Play some games first.');
            return;
        }

        // CSV Headers
        const headers = [
            'Timestamp',
            'Game Mode',
            'Map',
            'Total Score',
            'Total Distance (m)',
            'Total Time (s)',
            'Round',
            'Actual Country',
            'Actual Lat',
            'Actual Lng',
            'Guessed Country',
            'Guessed Lat',
            'Guessed Lng',
            'Distance (m)',
            'Score',
            'Time (s)',
            'Timed Out',
            'Time Limit',
            'No Move',
            'No Zoom',
            'No Pan'
        ];

        // Create CSV content
        let csvContent = headers.join(',') + '\n';

        statsData.forEach(game => {
            game.rounds.forEach(round => {
                const row = [
                    game.timestamp,
                    game.gameMode,
                    `"${game.map}"`,
                    game.totalScore,
                    game.totalDistance,
                    game.totalTime,
                    round.roundNumber,
                    round.actual.country,
                    round.actual.lat,
                    round.actual.lng,
                    round.guessed.country,
                    round.guessed.lat,
                    round.guessed.lng,
                    round.distance,
                    round.score,
                    round.time,
                    round.timedOut,
                    game.restrictions.timeLimit,
                    game.restrictions.forbidMoving,
                    game.restrictions.forbidZooming,
                    game.restrictions.forbidRotating
                ];
                csvContent += row.join(',') + '\n';
            });
        });

        // Download CSV
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `geoguessr_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showNotification(`Exported ${statsData.length} games to CSV`, 'success');
    }

    // Clear all data
    function clearData() {
        if (confirm('Are you sure you want to clear all tracked data? This cannot be undone.')) {
            statsData = [];
            GM_setValue(CONFIG.STORAGE_KEY, statsData);
            updateSummary();
            updateStatus('Data cleared');
            showNotification('All data cleared', 'warning');
        }
    }

    // Toggle tracking
    function toggleTracking() {
        isTracking = !isTracking;
        const btn = document.getElementById('toggle-tracking-btn');
        if (btn) {
            btn.textContent = isTracking ? '⏸️ Pause Tracking' : '▶️ Resume Tracking';
        }
        updateStatus(isTracking ? 'Tracking resumed' : 'Tracking paused');
        showNotification(isTracking ? 'Tracking resumed' : 'Tracking paused', 'info');
    }

    // Update status message
    function updateStatus(message) {
        const statusEl = document.getElementById('tracker-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
        console.log('📝 Status:', message);
    }

    // Update summary statistics
    function updateSummary() {
        const totalGames = statsData.length;
        const totalRounds = statsData.reduce((sum, game) => sum + (game.rounds ? game.rounds.length : 0), 0);

        const totalGamesEl = document.getElementById('total-games');
        const totalRoundsEl = document.getElementById('total-rounds');

        if (totalGamesEl) totalGamesEl.textContent = totalGames;
        if (totalRoundsEl) totalRoundsEl.textContent = totalRounds;
    }

    // Update current game info
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

    function toggleImageCapture() {
        IMAGE_CAPTURE.enabled = !IMAGE_CAPTURE.enabled;
        GM_setValue('capture_images', IMAGE_CAPTURE.enabled);
        
        const btn = document.getElementById('toggle-capture-btn');
        const status = document.getElementById('capture-status');
        
        if (btn) {
            btn.innerHTML = `${IMAGE_CAPTURE.enabled ? '🔴' : '⚫'} ${IMAGE_CAPTURE.enabled ? 'Disable' : 'Enable'} Auto Capture`;
        }
        if (status) {
            status.textContent = `Image Capture: ${IMAGE_CAPTURE.enabled ? 'ON' : 'OFF'}`;
        }
        
        showNotification(`Image capture ${IMAGE_CAPTURE.enabled ? 'enabled' : 'disabled'}`, 'info');
        
        if (IMAGE_CAPTURE.enabled) {
            initializeImageCapture();
        }
    }

    // Utility function for delays
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Initialize with multiple attempts
    async function init() {
        console.log('🚀 Stats Tracker: Initializing...');

        // Try to create UI immediately
        createUI();

        // Check of image capture is enabled
        if (IMAGE_CAPTURE.enabled) {
            initializeImageCapture();
        }

        // Start monitoring
        startUrlMonitoring();

        // Retry UI creation if it failed
        let retries = 0;
        const maxRetries = 5;

        const retryInterval = setInterval(() => {
            if (document.getElementById('stats-tracker-toggle')) {
                clearInterval(retryInterval);
                console.log('✅ UI verified, initialization complete!');
            } else if (retries < maxRetries) {
                retries++;
                console.log(`🔄 Retry ${retries}/${maxRetries} creating UI...`);
                createUI();
            } else {
                clearInterval(retryInterval);
                console.error('❌ Failed to create UI after', maxRetries, 'attempts');
            }
        }, 2000);

        updateStatus('Ready to track');
    }

    // Multiple initialization strategies
    console.log('🎯 Starting initialization strategies...');

    // Strategy 1: Immediate execution
    init();

    // Strategy 2: Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📄 DOM loaded, checking UI...');
            if (!document.getElementById('stats-tracker-toggle')) {
                init();
            }
        });
    }

    // Strategy 3: Wait for window load
    window.addEventListener('load', () => {
        console.log('🪟 Window loaded, checking UI...');
        if (!document.getElementById('stats-tracker-toggle')) {
            init();
        }
    });

    // Strategy 4: Delayed fallback
    setTimeout(() => {
        if (!document.getElementById('stats-tracker-toggle')) {
            console.log('⏱️ Delayed initialization...');
            init();
        }
    }, 3000);

})();