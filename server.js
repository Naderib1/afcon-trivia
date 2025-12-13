const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configure Socket.io for HIGH SCALABILITY (10K+ users)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    connectTimeout: 45000,
    upgradeTimeout: 30000,
    perMessageDeflate: {
        threshold: 1024,
        zlibDeflateOptions: { chunkSize: 16 * 1024 },
        zlibInflateOptions: { chunkSize: 16 * 1024 }
    }
});

// Trust proxy for platforms like Render, Railway, Heroku
app.set('trust proxy', 1);

// Parse JSON bodies for import endpoint
app.use(express.json({ limit: '5mb' }));

// Database file path
const DB_FILE = './database.json';

// Load database
function loadDatabase() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.log('No database file found, creating fresh database.');
        return { questions: [], version: 1 };
    }
}

// Save database
function saveDatabase() {
    const data = {
        questions: questions,
        version: db.version + 1,
        lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    db.version = data.version;
    console.log(`💾 Database saved (v${db.version})`);
}

// Initialize database
let db = loadDatabase();
let questions = db.questions || [];

// If old questions.json exists, migrate it
try {
    if (questions.length === 0 && fs.existsSync('./questions.json')) {
        const oldData = fs.readFileSync('./questions.json', 'utf8');
        questions = JSON.parse(oldData);
        saveDatabase();
        console.log('📦 Migrated questions from questions.json to database.json');
    }
} catch (err) {
    console.log('No migration needed');
}

// Get only active questions for gameplay
function getActiveQuestions() {
    return questions.filter(q => q.active === true);
}

// ============================================
// SPEED-BASED SCORING SYSTEM
// ============================================
function calculateScore(responseTimeMs, questionDuration) {
    const responseTimeSec = responseTimeMs / 1000;
    
    // Speed bonus tiers
    if (responseTimeSec <= 3) {
        return 20; // Lightning fast!
    } else if (responseTimeSec <= 7) {
        return 15; // Very fast
    } else if (responseTimeSec <= 15) {
        return 10; // Normal
    } else {
        return 5; // Slow but correct
    }
}

// Serve static files
app.use(express.static('public'));

// ============================================
// MULTI-GAME SUPPORT - 4 separate games
// ============================================
const GAME_IDS = [1, 2, 3, 4];
const games = {};
const gameTimers = {};
const autoPlayTimers = {};
const gameAdmins = {};
const displayClients = {}; // Stadium display clients

// Disconnected players storage for reconnection
const disconnectedPlayers = {};

// Initialize all 4 games
GAME_IDS.forEach(gameId => {
    games[gameId] = {
        status: 'waiting',
        currentQuestion: -1,
        players: new Map(),
        questionStartTime: null,
        questionDuration: 30,
        answerDuration: 15,
        timeRemaining: 30,
        answers: new Map(), // socketId -> { answer, responseTime }
        autoPlayMode: false,
        answerStats: {} // Track answer distribution
    };
    gameTimers[gameId] = null;
    autoPlayTimers[gameId] = null;
    gameAdmins[gameId] = new Set();
    displayClients[gameId] = new Set();
    disconnectedPlayers[gameId] = new Map(); // name -> playerData
});

// Get game state
function getGame(gameId) {
    return games[gameId] || games[1];
}

// Reset game
function resetGame(gameId) {
    const game = getGame(gameId);
    game.status = 'waiting';
    game.currentQuestion = -1;
    game.questionStartTime = null;
    game.timeRemaining = game.questionDuration;
    game.answers.clear();
    game.autoPlayMode = false;
    game.answerStats = {};
    
    if (gameTimers[gameId]) {
        clearInterval(gameTimers[gameId]);
        gameTimers[gameId] = null;
    }
    if (autoPlayTimers[gameId]) {
        clearTimeout(autoPlayTimers[gameId]);
        autoPlayTimers[gameId] = null;
    }
    
    game.players.forEach((player) => {
        player.score = 0;
        player.answers = [];
        player.totalResponseTime = 0;
        player.correctAnswers = 0;
    });
}

// Get leaderboard for a game - WITH TIEBREAKER (faster average time wins)
function getLeaderboard(gameId) {
    const game = getGame(gameId);
    return Array.from(game.players.values())
        .filter(p => p.name)
        .sort((a, b) => {
            // First sort by score (descending)
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            // If same score, faster average response time wins
            const aAvgTime = a.correctAnswers > 0 ? a.totalResponseTime / a.correctAnswers : Infinity;
            const bAvgTime = b.correctAnswers > 0 ? b.totalResponseTime / b.correctAnswers : Infinity;
            return aAvgTime - bAvgTime;
        })
        .slice(0, 10)
        .map((p, index) => ({
            name: p.name,
            score: p.score,
            photo: p.photo || null,
            avgTime: p.correctAnswers > 0 ? Math.round(p.totalResponseTime / p.correctAnswers / 100) / 10 : null,
            rank: index + 1
        }));
}

// Get current question for players
function getCurrentQuestionForPlayers(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    if (game.currentQuestion < 0 || game.currentQuestion >= activeQuestions.length) {
        return null;
    }
    const q = activeQuestions[game.currentQuestion];
    return {
        id: q.id,
        question: q.question,
        options: q.options,
        questionNumber: game.currentQuestion + 1,
        totalQuestions: activeQuestions.length
    };
}

// Get current question with answer
function getCurrentQuestionWithAnswer(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    if (game.currentQuestion < 0 || game.currentQuestion >= activeQuestions.length) {
        return null;
    }
    return activeQuestions[game.currentQuestion];
}

// Calculate answer distribution stats
function calculateAnswerStats(gameId) {
    const game = getGame(gameId);
    const question = getCurrentQuestionWithAnswer(gameId);
    if (!question) return {};
    
    const stats = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const totalAnswers = game.answers.size;
    
    game.answers.forEach((answerData) => {
        const answer = typeof answerData === 'object' ? answerData.answer : answerData;
        if (stats.hasOwnProperty(answer)) {
            stats[answer]++;
        }
    });
    
    // Convert to percentages
    const percentages = {};
    for (let i = 0; i < 4; i++) {
        percentages[i] = totalAnswers > 0 ? Math.round((stats[i] / totalAnswers) * 100) : 0;
    }
    
    return {
        counts: stats,
        percentages: percentages,
        total: totalAnswers,
        correctAnswer: question.correct
    };
}

// Start timer for a game
function startTimer(gameId) {
    if (gameTimers[gameId]) clearInterval(gameTimers[gameId]);
    
    const game = getGame(gameId);
    game.questionStartTime = Date.now();
    game.timeRemaining = game.questionDuration;
    
    gameTimers[gameId] = setInterval(() => {
        const elapsed = Math.floor((Date.now() - game.questionStartTime) / 1000);
        game.timeRemaining = Math.max(0, game.questionDuration - elapsed);
        
        // Emit timer to game room and display clients
        const timerData = { timeRemaining: game.timeRemaining };
        io.to(`game-${gameId}`).emit('timer', timerData);
        io.to(`display-${gameId}`).emit('timer', timerData);
        
        if (game.timeRemaining <= 0) {
            clearInterval(gameTimers[gameId]);
            gameTimers[gameId] = null;
            revealAnswer(gameId);
        }
    }, 1000);
}

// Reveal answer for a game
function revealAnswer(gameId) {
    const game = getGame(gameId);
    game.status = 'answer';
    const question = getCurrentQuestionWithAnswer(gameId);
    
    if (!question) {
        console.log(`⚠️ [Game ${gameId}] No question to reveal answer for`);
        return;
    }
    
    console.log(`🎯 [Game ${gameId}] Revealing answer for question ${game.currentQuestion + 1}`);
    
    // Calculate answer distribution
    const answerStats = calculateAnswerStats(gameId);
    game.answerStats = answerStats;
    
    const results = [];
    game.players.forEach((player, socketId) => {
        const answerData = game.answers.get(socketId);
        let playerAnswer = null;
        let responseTime = game.questionDuration * 1000; // Default to max time
        
        if (answerData) {
            playerAnswer = typeof answerData === 'object' ? answerData.answer : answerData;
            responseTime = typeof answerData === 'object' ? answerData.responseTime : game.questionDuration * 1000;
        }
        
        const isCorrect = playerAnswer !== null && playerAnswer === question.correct;
        
        if (isCorrect) {
            const points = calculateScore(responseTime, game.questionDuration);
            player.score += points;
            player.totalResponseTime += responseTime;
            player.correctAnswers++;
            
            results.push({
                socketId,
                name: player.name,
                answer: playerAnswer,
                isCorrect: true,
                points: points,
                responseTime: responseTime,
                score: player.score
            });
        } else {
            results.push({
                socketId,
                name: player.name,
                answer: playerAnswer,
                isCorrect: false,
                points: 0,
                responseTime: responseTime,
                score: player.score
            });
        }
        
        player.answers.push({
            questionId: question.id,
            answer: playerAnswer,
            correct: isCorrect,
            responseTime: responseTime
        });
    });
    
    const leaderboard = getLeaderboard(gameId);
    
    // Emit to game room
    io.to(`game-${gameId}`).emit('answer-reveal', {
        question: question,
        correctAnswer: question.correct,
        explanation: question.explanation,
        leaderboard: leaderboard,
        answerStats: answerStats
    });
    
    // Emit to display clients
    io.to(`display-${gameId}`).emit('answer-reveal', {
        question: question,
        correctAnswer: question.correct,
        explanation: question.explanation,
        leaderboard: leaderboard,
        answerStats: answerStats
    });
    
    // Send individual results with points earned
    results.forEach(result => {
        io.to(result.socketId).emit('your-result', {
            isCorrect: result.isCorrect,
            points: result.points,
            responseTime: result.responseTime,
            newScore: result.score,
            explanation: question.explanation
        });
    });
    
    // Notify admins
    broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
    
    // Auto-play: schedule next question
    if (game.autoPlayMode) {
        scheduleAutoPlayNext(gameId);
    }
}

// Schedule next question in auto-play mode
function scheduleAutoPlayNext(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    if (autoPlayTimers[gameId]) {
        clearTimeout(autoPlayTimers[gameId]);
    }
    
    console.log(`⏰ [Game ${gameId}] Auto-play: Next action in ${game.answerDuration}s`);
    
    autoPlayTimers[gameId] = setTimeout(() => {
        if (game.currentQuestion >= activeQuestions.length - 1) {
            finishGame(gameId);
        } else {
            showNextQuestion(gameId);
        }
    }, game.answerDuration * 1000);
}

// Finish game
function finishGame(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    game.status = 'finished';
    game.autoPlayMode = false;
    
    if (gameTimers[gameId]) {
        clearInterval(gameTimers[gameId]);
        gameTimers[gameId] = null;
    }
    if (autoPlayTimers[gameId]) {
        clearTimeout(autoPlayTimers[gameId]);
        autoPlayTimers[gameId] = null;
    }
    
    console.log(`🏁 [Game ${gameId}] Game finished!`);
    
    const leaderboard = getLeaderboard(gameId);
    
    // Emit game finished
    io.to(`game-${gameId}`).emit('game-finished', {
        leaderboard: leaderboard,
        totalQuestions: activeQuestions.length
    });
    
    io.to(`display-${gameId}`).emit('game-finished', {
        leaderboard: leaderboard,
        totalQuestions: activeQuestions.length
    });
    
    // Send individual final scores
    game.players.forEach((player, socketId) => {
        io.to(socketId).emit('your-final-score', {
            score: player.score,
            totalQuestions: activeQuestions.length,
            maxScore: activeQuestions.length * 20, // Max possible with speed bonus
            avgTime: player.correctAnswers > 0 ? Math.round(player.totalResponseTime / player.correctAnswers / 100) / 10 : null,
            correctAnswers: player.correctAnswers
        });
    });
    
    broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
}

// Show next question
function showNextQuestion(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    if (game.currentQuestion >= activeQuestions.length - 1) {
        finishGame(gameId);
        return;
    }
    
    game.currentQuestion++;
    game.status = 'question';
    game.answers.clear();
    game.answerStats = {};
    
    const question = getCurrentQuestionForPlayers(gameId);
    
    console.log(`❓ [Game ${gameId}] Showing question ${game.currentQuestion + 1}/${activeQuestions.length}`);
    
    const questionData = {
        question: question,
        timeRemaining: game.questionDuration
    };
    
    io.to(`game-${gameId}`).emit('new-question', questionData);
    io.to(`display-${gameId}`).emit('new-question', questionData);
    
    startTimer(gameId);
    
    broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
    broadcastToGameAdmins(gameId, 'answer-count', {
        count: 0,
        total: game.players.size
    });
}

// Get admin update data
function getAdminUpdate(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    let currentActiveQuestion = null;
    if (game.currentQuestion >= 0 && game.currentQuestion < activeQuestions.length) {
        currentActiveQuestion = activeQuestions[game.currentQuestion];
    }
    
    return {
        gameId: gameId,
        status: game.status,
        currentQuestion: game.currentQuestion,
        currentActiveQuestion: currentActiveQuestion,
        totalQuestions: activeQuestions.length,
        playerCount: game.players.size,
        leaderboard: getLeaderboard(gameId),
        questions: questions,
        activeQuestions: activeQuestions,
        autoPlayMode: game.autoPlayMode,
        questionDuration: game.questionDuration,
        answerDuration: game.answerDuration,
        answerStats: game.answerStats,
        dbVersion: db.version
    };
}

// Broadcast to admins of a specific game
function broadcastToGameAdmins(gameId, event, data) {
    gameAdmins[gameId].forEach(socketId => {
        io.to(socketId).emit(event, data);
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    const totalPlayers = GAME_IDS.reduce((sum, id) => sum + games[id].players.size, 0);
    res.status(200).json({ 
        status: 'ok', 
        totalPlayers, 
        games: GAME_IDS.length,
        dbVersion: db.version,
        questionsTotal: questions.length,
        questionsActive: getActiveQuestions().length
    });
});

// API endpoint to get database info
app.get('/api/db-status', (req, res) => {
    res.json({
        version: db.version,
        totalQuestions: questions.length,
        activeQuestions: getActiveQuestions().length,
        lastUpdated: db.lastUpdated || null
    });
});

// Export questions as JSON
app.get('/api/questions/export', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=afcon-trivia-questions.json');
    res.json(questions);
});

// Import questions from JSON
app.post('/api/questions/import', (req, res) => {
    try {
        const importedQuestions = req.body;
        
        if (!Array.isArray(importedQuestions)) {
            return res.status(400).json({ error: 'Invalid format. Expected array of questions.' });
        }
        
        // Validate each question
        const validQuestions = importedQuestions.filter(q => {
            return q.question && q.options && Array.isArray(q.options) && q.options.length === 4 && typeof q.correct === 'number';
        });
        
        // Add IDs and active status if missing
        validQuestions.forEach((q, index) => {
            if (!q.id) q.id = Date.now() + index;
            if (q.active === undefined) q.active = true;
        });
        
        // Merge or replace based on query param
        const mode = req.query.mode || 'merge';
        
        if (mode === 'replace') {
            questions = validQuestions;
        } else {
            questions = [...questions, ...validQuestions];
        }
        
        saveDatabase();
        
        // Notify all admins
        GAME_IDS.forEach(gameId => {
            broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
            broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
        });
        
        res.json({ 
            success: true, 
            imported: validQuestions.length,
            total: questions.length 
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to import questions: ' + err.message });
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Stadium Display route
app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// QR Code endpoint
app.get('/qr', async (req, res) => {
    try {
        const gameId = parseInt(req.query.game) || 1;
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const url = `${protocol}://${host}/?game=${gameId}`;
        
        const qrCode = await QRCode.toDataURL(url, {
            width: 400,
            margin: 2,
            color: {
                dark: '#8D0000',
                light: '#ffffff'
            }
        });
        res.json({ qrCode, url, gameId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Get all QR codes for admin
app.get('/qr/all', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        
        const qrCodes = await Promise.all(GAME_IDS.map(async (gameId) => {
            const url = `${protocol}://${host}/?game=${gameId}`;
            const qrCode = await QRCode.toDataURL(url, {
                width: 600,
                margin: 3,
                color: {
                    dark: '#8D0000',
                    light: '#ffffff'
                }
            });
            return { gameId, qrCode, url };
        }));
        
        res.json({ qrCodes });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR codes' });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let currentGameId = null;
    let isAdmin = false;
    let isDisplay = false;
    let playerName = null;
    
    // Stadium Display connects
    socket.on('display-connect', (data) => {
        const gameId = data?.gameId || 1;
        isDisplay = true;
        currentGameId = gameId;
        
        socket.join(`display-${gameId}`);
        displayClients[gameId].add(socket.id);
        
        console.log(`📺 [Game ${gameId}] Stadium Display connected:`, socket.id);
        
        const game = getGame(gameId);
        const activeQuestions = getActiveQuestions();
        
        socket.emit('display-state', {
            gameId: gameId,
            status: game.status,
            currentQuestion: game.currentQuestion,
            question: game.status === 'question' ? getCurrentQuestionForPlayers(gameId) : null,
            timeRemaining: game.timeRemaining,
            totalQuestions: activeQuestions.length,
            leaderboard: getLeaderboard(gameId),
            playerCount: game.players.size,
            answerStats: game.answerStats
        });
    });
    
    // Admin connects
    socket.on('admin-connect', (data) => {
        const gameId = data?.gameId || 1;
        isAdmin = true;
        
        if (currentGameId && gameAdmins[currentGameId]) {
            gameAdmins[currentGameId].delete(socket.id);
            socket.leave(`admin-game-${currentGameId}`);
        }
        
        currentGameId = gameId;
        socket.join(`admin-game-${gameId}`);
        gameAdmins[gameId].add(socket.id);
        
        console.log(`✅ Admin connected to Game ${gameId}:`, socket.id);
        
        socket.emit('admin-update', getAdminUpdate(gameId));
    });
    
    // Admin switches game
    socket.on('admin-switch-game', (data) => {
        const newGameId = data.gameId;
        if (!GAME_IDS.includes(newGameId)) return;
        
        if (currentGameId && gameAdmins[currentGameId]) {
            gameAdmins[currentGameId].delete(socket.id);
            socket.leave(`admin-game-${currentGameId}`);
        }
        
        currentGameId = newGameId;
        socket.join(`admin-game-${newGameId}`);
        gameAdmins[newGameId].add(socket.id);
        
        console.log(`🔄 Admin switched to Game ${newGameId}:`, socket.id);
        
        socket.emit('admin-update', getAdminUpdate(newGameId));
    });
    
    // Player joins a game
    socket.on('join-game', (data) => {
        const gameId = data.gameId || 1;
        const game = getGame(gameId);
        playerName = data.name.trim().substring(0, 20);
        const playerLang = data.lang || 'en';
        
        let playerPhoto = null;
        if (data.photo && data.photo.length < 70000) {
            playerPhoto = data.photo;
        }
        
        currentGameId = gameId;
        socket.join(`game-${gameId}`);
        
        // Check for reconnection
        const disconnectedPlayer = disconnectedPlayers[gameId].get(playerName.toLowerCase());
        let playerData;
        
        if (disconnectedPlayer && Date.now() - disconnectedPlayer.disconnectedAt < 300000) { // 5 min window
            // Restore player data
            playerData = {
                ...disconnectedPlayer,
                socketId: socket.id,
                reconnected: true
            };
            disconnectedPlayers[gameId].delete(playerName.toLowerCase());
            console.log(`🔄 [Game ${gameId}] Player reconnected: ${playerName} | Score: ${playerData.score}`);
        } else {
            // New player
            playerData = {
                name: playerName,
                score: 0,
                answers: [],
                joinedAt: Date.now(),
                lang: playerLang,
                photo: playerPhoto,
                totalResponseTime: 0,
                correctAnswers: 0
            };
            console.log(`✅ [Game ${gameId}] Player joined: ${playerName} | Total: ${game.players.size + 1}`);
        }
        
        game.players.set(socket.id, playerData);
        
        const activeQuestions = getActiveQuestions();
        socket.emit('game-state', {
            gameId: gameId,
            status: game.status,
            question: game.status === 'question' ? getCurrentQuestionForPlayers(gameId) : null,
            timeRemaining: game.timeRemaining,
            playerName: playerName,
            score: playerData.score,
            totalQuestions: activeQuestions.length,
            reconnected: playerData.reconnected || false
        });
        
        // Update display with new player count
        io.to(`display-${gameId}`).emit('player-count', {
            playerCount: game.players.size
        });
        
        broadcastToGameAdmins(gameId, 'player-joined', {
            playerCount: game.players.size,
            leaderboard: getLeaderboard(gameId)
        });
    });
    
    // Player submits answer - WITH RESPONSE TIME
    socket.on('submit-answer', (data) => {
        if (!currentGameId) return;
        const game = getGame(currentGameId);
        
        if (game.status !== 'question') return;
        if (game.answers.has(socket.id)) return;
        
        // Calculate response time
        const responseTime = Date.now() - game.questionStartTime;
        
        game.answers.set(socket.id, {
            answer: data.answer,
            responseTime: responseTime
        });
        
        const player = game.players.get(socket.id);
        console.log(`📝 [Game ${currentGameId}] Answer from ${player?.name || socket.id}: ${data.answer} (${Math.round(responseTime/100)/10}s)`);
        
        socket.emit('answer-received', { 
            answer: data.answer,
            responseTime: responseTime
        });
        
        // Update answer stats in real-time for display
        const answerStats = calculateAnswerStats(currentGameId);
        io.to(`display-${currentGameId}`).emit('answer-stats-update', {
            answerStats: answerStats,
            answeredCount: game.answers.size,
            totalPlayers: game.players.size
        });
        
        broadcastToGameAdmins(currentGameId, 'answer-count', {
            count: game.answers.size,
            total: game.players.size
        });
    });
    
    // Admin starts AUTO-PLAY mode
    socket.on('admin-start-autoplay', (data) => {
        if (!currentGameId) return;
        const game = getGame(currentGameId);
        const activeQuestions = getActiveQuestions();
        
        console.log(`🤖 [Game ${currentGameId}] Admin starting AUTO-PLAY mode...`);
        
        if (activeQuestions.length === 0) {
            socket.emit('error', { message: 'No active questions! Please activate some questions first.' });
            return;
        }
        
        resetGame(currentGameId);
        game.autoPlayMode = true;
        
        if (data?.questionDuration) {
            game.questionDuration = Math.max(10, Math.min(120, data.questionDuration));
        }
        if (data?.answerDuration) {
            game.answerDuration = Math.max(5, Math.min(60, data.answerDuration));
        }
        
        io.to(`game-${currentGameId}`).emit('game-started');
        io.to(`display-${currentGameId}`).emit('game-started', {
            totalQuestions: activeQuestions.length,
            playerCount: game.players.size
        });
        
        io.to(`game-${currentGameId}`).emit('game-state', { 
            status: 'waiting', 
            totalQuestions: activeQuestions.length,
            gameId: currentGameId
        });
        
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
        
        // Start first question after 3 seconds
        setTimeout(() => {
            if (game.autoPlayMode) {
                showNextQuestion(currentGameId);
            }
        }, 3000);
    });
    
    // Admin stops auto-play
    socket.on('admin-stop-autoplay', () => {
        if (!currentGameId) return;
        const game = getGame(currentGameId);
        
        console.log(`⏹️ [Game ${currentGameId}] Admin stopping AUTO-PLAY mode`);
        
        game.autoPlayMode = false;
        
        if (autoPlayTimers[currentGameId]) {
            clearTimeout(autoPlayTimers[currentGameId]);
            autoPlayTimers[currentGameId] = null;
        }
        
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
    });
    
    // Admin shows next question (manual)
    socket.on('admin-next-question', () => {
        if (!currentGameId) return;
        showNextQuestion(currentGameId);
    });
    
    // Admin reveals answer early
    socket.on('admin-reveal-answer', () => {
        if (!currentGameId) return;
        const game = getGame(currentGameId);
        
        if (game.status !== 'question') return;
        
        if (gameTimers[currentGameId]) {
            clearInterval(gameTimers[currentGameId]);
            gameTimers[currentGameId] = null;
        }
        
        revealAnswer(currentGameId);
    });
    
    // Admin resets game
    socket.on('admin-reset-game', () => {
        if (!currentGameId) return;
        
        console.log(`🔄 [Game ${currentGameId}] Admin resetting game...`);
        
        resetGame(currentGameId);
        
        io.to(`game-${currentGameId}`).emit('game-reset');
        io.to(`display-${currentGameId}`).emit('game-reset');
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
    });
    
    // Admin adds question
    socket.on('admin-add-question', (data) => {
        const newQuestion = {
            id: Date.now(),
            active: true,
            ...data.question
        };
        questions.push(newQuestion);
        saveDatabase();
        
        GAME_IDS.forEach(gameId => {
            broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
            broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
        });
        
        console.log('Question added. Total:', questions.length);
    });
    
    // Admin updates question
    socket.on('admin-update-question', (data) => {
        const { index, question } = data;
        if (index >= 0 && index < questions.length) {
            questions[index] = { 
                id: questions[index].id, 
                active: questions[index].active,
                ...question 
            };
            saveDatabase();
            
            GAME_IDS.forEach(gameId => {
                broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
            });
        }
    });
    
    // Admin deletes question
    socket.on('admin-delete-question', (data) => {
        const { index } = data;
        if (index >= 0 && index < questions.length) {
            questions.splice(index, 1);
            saveDatabase();
            
            GAME_IDS.forEach(gameId => {
                broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
                broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
            });
        }
    });
    
    // Admin toggles question active state
    socket.on('admin-toggle-question', (data) => {
        const { index } = data;
        if (index >= 0 && index < questions.length) {
            questions[index].active = !questions[index].active;
            saveDatabase();
            
            const activeCount = getActiveQuestions().length;
            console.log(`🔄 Question ${index + 1} ${questions[index].active ? 'activated' : 'deactivated'}. Active: ${activeCount}`);
            
            GAME_IDS.forEach(gameId => {
                broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
                broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
            });
        }
    });
    
    // Admin bulk toggle questions
    socket.on('admin-bulk-toggle', (data) => {
        const { action } = data;
        
        questions.forEach(q => {
            q.active = action === 'activate-all';
        });
        saveDatabase();
        
        const activeCount = getActiveQuestions().length;
        console.log(`🔄 Bulk ${action}: ${activeCount} active questions`);
        
        GAME_IDS.forEach(gameId => {
            broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
            broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        if (isDisplay && currentGameId && displayClients[currentGameId]) {
            displayClients[currentGameId].delete(socket.id);
            console.log(`📺 Display disconnected from Game ${currentGameId}`);
        }
        
        if (isAdmin && currentGameId && gameAdmins[currentGameId]) {
            gameAdmins[currentGameId].delete(socket.id);
            console.log(`❌ Admin disconnected from Game ${currentGameId}`);
        }
        
        if (currentGameId && !isAdmin && !isDisplay) {
            const game = getGame(currentGameId);
            const player = game.players.get(socket.id);
            
            if (player) {
                // Store player data for potential reconnection
                disconnectedPlayers[currentGameId].set(player.name.toLowerCase(), {
                    ...player,
                    disconnectedAt: Date.now()
                });
                
                console.log(`❌ [Game ${currentGameId}] Player disconnected: ${player.name} (can reconnect within 5 min)`);
            }
            
            game.players.delete(socket.id);
            game.answers.delete(socket.id);
            
            io.to(`display-${currentGameId}`).emit('player-count', {
                playerCount: game.players.size
            });
            
            broadcastToGameAdmins(currentGameId, 'player-left', {
                playerCount: game.players.size,
                leaderboard: getLeaderboard(currentGameId)
            });
        }
    });
});

// Clean up old disconnected players every 10 minutes
setInterval(() => {
    const now = Date.now();
    GAME_IDS.forEach(gameId => {
        disconnectedPlayers[gameId].forEach((player, name) => {
            if (now - player.disconnectedAt > 300000) { // 5 minutes
                disconnectedPlayers[gameId].delete(name);
            }
        });
    });
}, 600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🏆 AFCON Trivia Server running!`);
    console.log(`\n📱 Player URL: http://localhost:${PORT}/?game=1`);
    console.log(`🎮 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`📺 Stadium Display: http://localhost:${PORT}/display?game=1`);
    console.log(`📝 Questions loaded: ${questions.length} (${getActiveQuestions().length} active)`);
    console.log(`🎯 Games available: ${GAME_IDS.join(', ')}`);
    console.log(`💾 Database version: ${db.version}`);
    console.log(`\n✨ Ready for 10K+ players with speed scoring!\n`);
});
