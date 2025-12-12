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
    transports: ['websocket', 'polling'], // Prefer websocket for better performance
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    // Scalability optimizations
    maxHttpBufferSize: 1e6, // 1MB max message size
    connectTimeout: 45000,
    upgradeTimeout: 30000,
    perMessageDeflate: {
        threshold: 1024, // Compress messages > 1KB
        zlibDeflateOptions: { chunkSize: 16 * 1024 },
        zlibInflateOptions: { chunkSize: 16 * 1024 }
    }
});

// Trust proxy for platforms like Render, Railway, Heroku
app.set('trust proxy', 1);

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

// Serve static files
app.use(express.static('public'));

// ============================================
// MULTI-GAME SUPPORT - 4 separate games
// ============================================
const GAME_IDS = [1, 2, 3, 4];
const games = {};
const gameTimers = {};
const autoPlayTimers = {}; // For auto-play mode
const gameAdmins = {}; // Track admin sockets per game

// Initialize all 4 games
GAME_IDS.forEach(gameId => {
    games[gameId] = {
        status: 'waiting',
        currentQuestion: -1,
        players: new Map(),
        questionStartTime: null,
        questionDuration: 30, // Default 30 seconds for questions
        answerDuration: 15,   // 15 seconds for showing answer
        timeRemaining: 30,
        answers: new Map(),
        autoPlayMode: false   // Auto-play toggle
    };
    gameTimers[gameId] = null;
    autoPlayTimers[gameId] = null;
    gameAdmins[gameId] = new Set();
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
    
    // Clear any running timers
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
    });
}

// Get leaderboard for a game
function getLeaderboard(gameId) {
    const game = getGame(gameId);
    return Array.from(game.players.values())
        .filter(p => p.name)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({
            name: p.name,
            score: p.score,
            photo: p.photo || null
        }));
}

// Get current question for players (uses only active questions)
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

// Get current question with answer (uses only active questions)
function getCurrentQuestionWithAnswer(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    if (game.currentQuestion < 0 || game.currentQuestion >= activeQuestions.length) {
        return null;
    }
    return activeQuestions[game.currentQuestion];
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
        
        // Emit timer only to players in this game
        io.to(`game-${gameId}`).emit('timer', { timeRemaining: game.timeRemaining });
        
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
    
    const results = [];
    game.players.forEach((player, socketId) => {
        const playerAnswer = game.answers.get(socketId);
        const isCorrect = playerAnswer !== undefined && playerAnswer === question.correct;
        
        if (isCorrect) {
            player.score += 10;
        }
        
        player.answers.push({
            questionId: question.id,
            answer: playerAnswer,
            correct: isCorrect
        });
        
        results.push({
            socketId,
            name: player.name,
            answer: playerAnswer,
            isCorrect,
            score: player.score
        });
    });
    
    // Emit to game room
    io.to(`game-${gameId}`).emit('answer-reveal', {
        question: question,
        correctAnswer: question.correct,
        explanation: question.explanation,
        leaderboard: getLeaderboard(gameId)
    });
    
    // Send individual results
    results.forEach(result => {
        io.to(result.socketId).emit('your-result', {
            isCorrect: result.isCorrect,
            newScore: result.score,
            explanation: question.explanation
        });
    });
    
    // Notify admins of this game
    broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
    
    // Auto-play: schedule next question after answer duration
    if (game.autoPlayMode) {
        scheduleAutoPlayNext(gameId);
    }
}

// Schedule next question in auto-play mode
function scheduleAutoPlayNext(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    // Clear any existing auto-play timer
    if (autoPlayTimers[gameId]) {
        clearTimeout(autoPlayTimers[gameId]);
    }
    
    console.log(`⏰ [Game ${gameId}] Auto-play: Next action in ${game.answerDuration}s`);
    
    autoPlayTimers[gameId] = setTimeout(() => {
        // Check if we've finished all questions
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
    
    // Clear timers
    if (gameTimers[gameId]) {
        clearInterval(gameTimers[gameId]);
        gameTimers[gameId] = null;
    }
    if (autoPlayTimers[gameId]) {
        clearTimeout(autoPlayTimers[gameId]);
        autoPlayTimers[gameId] = null;
    }
    
    console.log(`🏁 [Game ${gameId}] Game finished!`);
    
    // Send game-finished with leaderboard to all players
    io.to(`game-${gameId}`).emit('game-finished', {
        leaderboard: getLeaderboard(gameId),
        totalQuestions: activeQuestions.length
    });
    
    // Send individual final scores to each player
    game.players.forEach((player, socketId) => {
        io.to(socketId).emit('your-final-score', {
            score: player.score,
            totalQuestions: activeQuestions.length,
            maxScore: activeQuestions.length * 10
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
    
    const question = getCurrentQuestionForPlayers(gameId);
    
    console.log(`❓ [Game ${gameId}] Showing question ${game.currentQuestion + 1}/${activeQuestions.length}`);
    
    io.to(`game-${gameId}`).emit('new-question', {
        question: question,
        timeRemaining: game.questionDuration
    });
    
    startTimer(gameId);
    
    broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
    broadcastToGameAdmins(gameId, 'answer-count', {
        count: 0,
        total: game.players.size
    });
}

// Get admin update data - FIXED to include active questions mapping
function getAdminUpdate(gameId) {
    const game = getGame(gameId);
    const activeQuestions = getActiveQuestions();
    
    // Get the actual current question being shown (from active questions)
    let currentActiveQuestion = null;
    if (game.currentQuestion >= 0 && game.currentQuestion < activeQuestions.length) {
        currentActiveQuestion = activeQuestions[game.currentQuestion];
    }
    
    return {
        gameId: gameId,
        status: game.status,
        currentQuestion: game.currentQuestion,
        currentActiveQuestion: currentActiveQuestion, // The actual question being shown
        totalQuestions: activeQuestions.length,
        playerCount: game.players.size,
        leaderboard: getLeaderboard(gameId),
        questions: questions, // All questions for the editor
        activeQuestions: activeQuestions, // Active questions for display
        autoPlayMode: game.autoPlayMode,
        questionDuration: game.questionDuration,
        answerDuration: game.answerDuration,
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

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// QR Code endpoint - supports game parameter
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
    
    // Admin connects and selects a game
    socket.on('admin-connect', (data) => {
        const gameId = data?.gameId || 1;
        isAdmin = true;
        
        // Remove from previous game admins if switching
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
        
        // Remove from old game
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
        const playerName = data.name.trim().substring(0, 20);
        const playerLang = data.lang || 'en';
        
        // Limit photo size
        let playerPhoto = null;
        if (data.photo && data.photo.length < 70000) {
            playerPhoto = data.photo;
        }
        
        currentGameId = gameId;
        socket.join(`game-${gameId}`);
        
        game.players.set(socket.id, {
            name: playerName,
            score: 0,
            answers: [],
            joinedAt: Date.now(),
            lang: playerLang,
            photo: playerPhoto
        });
        
        console.log(`✅ [Game ${gameId}] Player joined: ${playerName} | Total: ${game.players.size}`);
        
        const activeQuestions = getActiveQuestions();
        socket.emit('game-state', {
            gameId: gameId,
            status: game.status,
            question: game.status === 'question' ? getCurrentQuestionForPlayers(gameId) : null,
            timeRemaining: game.timeRemaining,
            playerName: playerName,
            score: 0,
            totalQuestions: activeQuestions.length
        });
        
        // Notify admins of this game
        broadcastToGameAdmins(gameId, 'player-joined', {
            playerCount: game.players.size,
            leaderboard: getLeaderboard(gameId)
        });
    });
    
    // Player submits answer
    socket.on('submit-answer', (data) => {
        if (!currentGameId) return;
        const game = getGame(currentGameId);
        
        if (game.status !== 'question') return;
        if (game.answers.has(socket.id)) return;
        
        game.answers.set(socket.id, data.answer);
        console.log(`📝 [Game ${currentGameId}] Answer from ${socket.id}: ${data.answer}`);
        
        socket.emit('answer-received', { answer: data.answer });
        
        broadcastToGameAdmins(currentGameId, 'answer-count', {
            count: game.answers.size,
            total: game.players.size
        });
    });
    
    // Admin starts game (manual mode - just resets)
    socket.on('admin-start-game', () => {
        if (!currentGameId) return;
        const activeQuestions = getActiveQuestions();
        console.log(`🎮 [Game ${currentGameId}] Admin starting game with ${activeQuestions.length} active questions...`);
        
        if (activeQuestions.length === 0) {
            socket.emit('error', { message: 'No active questions! Please activate some questions first.' });
            return;
        }
        
        resetGame(currentGameId);
        
        io.to(`game-${currentGameId}`).emit('game-started');
        io.to(`game-${currentGameId}`).emit('game-state', { 
            status: 'waiting', 
            totalQuestions: activeQuestions.length,
            gameId: currentGameId
        });
        
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
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
        
        // Reset game and enable auto-play
        resetGame(currentGameId);
        game.autoPlayMode = true;
        
        // Apply custom durations if provided
        if (data?.questionDuration) {
            game.questionDuration = Math.max(10, Math.min(120, data.questionDuration));
        }
        if (data?.answerDuration) {
            game.answerDuration = Math.max(5, Math.min(60, data.answerDuration));
        }
        
        io.to(`game-${currentGameId}`).emit('game-started');
        io.to(`game-${currentGameId}`).emit('game-state', { 
            status: 'waiting', 
            totalQuestions: activeQuestions.length,
            gameId: currentGameId
        });
        
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
        
        // Start the first question after 3 seconds
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
        
        // Clear auto-play timer
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
        broadcastToGameAdmins(currentGameId, 'admin-update', getAdminUpdate(currentGameId));
    });
    
    // Admin adds question (shared across all games)
    socket.on('admin-add-question', (data) => {
        const newQuestion = {
            id: Date.now(),
            active: true, // New questions are active by default
            ...data.question
        };
        questions.push(newQuestion);
        saveDatabase();
        
        // Notify all admins
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
            // Preserve the id and active state
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
            console.log(`🔄 Question ${index + 1} ${questions[index].active ? 'activated' : 'deactivated'}. Active questions: ${activeCount}`);
            
            GAME_IDS.forEach(gameId => {
                broadcastToGameAdmins(gameId, 'questions-updated', { questions, dbVersion: db.version });
                broadcastToGameAdmins(gameId, 'admin-update', getAdminUpdate(gameId));
            });
        }
    });
    
    // Admin bulk toggle questions
    socket.on('admin-bulk-toggle', (data) => {
        const { action } = data; // 'activate-all' or 'deactivate-all'
        
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
        if (isAdmin && currentGameId && gameAdmins[currentGameId]) {
            gameAdmins[currentGameId].delete(socket.id);
            console.log(`❌ Admin disconnected from Game ${currentGameId}`);
        }
        
        if (currentGameId && !isAdmin) {
            const game = getGame(currentGameId);
            const player = game.players.get(socket.id);
            
            if (player) {
                console.log(`❌ [Game ${currentGameId}] Player left: ${player.name}`);
            }
            
            game.players.delete(socket.id);
            game.answers.delete(socket.id);
            
            broadcastToGameAdmins(currentGameId, 'player-left', {
                playerCount: game.players.size,
                leaderboard: getLeaderboard(currentGameId)
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🏆 AFCON Trivia Server running!`);
    console.log(`\n📱 Player URL: http://localhost:${PORT}/?game=1`);
    console.log(`🎮 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`📝 Questions loaded: ${questions.length} (${getActiveQuestions().length} active)`);
    console.log(`🎯 Games available: ${GAME_IDS.join(', ')}`);
    console.log(`💾 Database version: ${db.version}`);
    console.log(`\n✨ Ready for 10K+ players!\n`);
});
