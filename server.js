const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configure Socket.io for production (handles various hosting environments)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Trust proxy for platforms like Render, Railway, Heroku
app.set('trust proxy', 1);

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', players: gameState.players.size });
});

// Questions file path
const QUESTIONS_FILE = './questions.json';

// Load questions
function loadQuestions() {
    try {
        const data = fs.readFileSync(QUESTIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.log('No questions file found, starting fresh.');
        return [];
    }
}

// Save questions
function saveQuestions(questions) {
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
}

let questions = loadQuestions();

// Serve static files
app.use(express.static('public'));

// Game state
let gameState = {
    status: 'waiting', // waiting, question, answer, finished
    currentQuestion: -1,
    players: new Map(),
    questionStartTime: null,
    questionDuration: 60, // seconds
    timeRemaining: 60,
    answers: new Map(), // Store answers for current question
};

// Reset game
function resetGame() {
    gameState.status = 'waiting';
    gameState.currentQuestion = -1;
    gameState.questionStartTime = null;
    gameState.timeRemaining = gameState.questionDuration;
    gameState.answers.clear();
    
    // Reset player scores but keep players
    gameState.players.forEach((player, id) => {
        player.score = 0;
        player.answers = [];
    });
}

// Get leaderboard
function getLeaderboard() {
    const players = Array.from(gameState.players.values())
        .filter(p => p.name)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({
            name: p.name,
            score: p.score,
            photo: p.photo || null
        }));
    return players;
}

// Get current question (without correct answer for players)
function getCurrentQuestionForPlayers() {
    if (gameState.currentQuestion < 0 || gameState.currentQuestion >= questions.length) {
        return null;
    }
    const q = questions[gameState.currentQuestion];
    return {
        id: q.id,
        question: q.question, // Can be string or {en, ar, fr} object
        options: q.options,
        questionNumber: gameState.currentQuestion + 1,
        totalQuestions: questions.length
    };
}

// Get current question (with correct answer for reveal)
function getCurrentQuestionWithAnswer() {
    if (gameState.currentQuestion < 0 || gameState.currentQuestion >= questions.length) {
        return null;
    }
    return questions[gameState.currentQuestion];
}

// Timer interval
let timerInterval = null;

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    gameState.questionStartTime = Date.now();
    gameState.timeRemaining = gameState.questionDuration;
    
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - gameState.questionStartTime) / 1000);
        gameState.timeRemaining = Math.max(0, gameState.questionDuration - elapsed);
        
        io.emit('timer', { timeRemaining: gameState.timeRemaining });
        
        if (gameState.timeRemaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            revealAnswer();
        }
    }, 1000);
}

function revealAnswer() {
    gameState.status = 'answer';
    const question = getCurrentQuestionWithAnswer();
    
    console.log('🎯 Revealing answer for question', gameState.currentQuestion + 1);
    console.log(`📊 Players: ${gameState.players.size}, Answers: ${gameState.answers.size}`);
    
    // Calculate results for each player
    const results = [];
    gameState.players.forEach((player, socketId) => {
        const playerAnswer = gameState.answers.get(socketId);
        const isCorrect = playerAnswer !== undefined && playerAnswer === question.correct;
        
        if (isCorrect) {
            player.score += 10;
            console.log(`✅ ${player.name} answered correctly! New score: ${player.score}`);
        } else {
            console.log(`❌ ${player.name} answered ${playerAnswer}, correct was ${question.correct}`);
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
            score: player.score,
            lang: player.lang || 'en'
        });
    });
    
    io.emit('answer-reveal', {
        question: question,
        correctAnswer: question.correct,
        explanation: question.explanation,
        leaderboard: getLeaderboard()
    });
    
    // Send individual results to each player
    results.forEach(result => {
        console.log(`📤 Sending result to ${result.name} (${result.socketId}): correct=${result.isCorrect}, score=${result.score}`);
        io.to(result.socketId).emit('your-result', {
            isCorrect: result.isCorrect,
            newScore: result.score,
            explanation: question.explanation
        });
    });
    
    // Notify admins
    broadcastToAdmins('admin-update', {
        status: gameState.status,
        currentQuestion: gameState.currentQuestion,
        totalQuestions: questions.length,
        playerCount: gameState.players.size,
        leaderboard: getLeaderboard(),
        questions: questions
    });
    
    console.log('📊 Leaderboard:', getLeaderboard());
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// QR Code endpoint
app.get('/qr', async (req, res) => {
    try {
        // Determine the correct protocol (https for production, http for local)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const url = `${protocol}://${host}/`;
        
        const qrCode = await QRCode.toDataURL(url, {
            width: 300,
            margin: 2,
            color: {
                dark: '#8D0000',
                light: '#ffffff'
            }
        });
        res.json({ qrCode, url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Track admin sockets
let adminSockets = new Set();

// Broadcast to all admins
function broadcastToAdmins(event, data) {
    adminSockets.forEach(socketId => {
        io.to(socketId).emit(event, data);
    });
    // Also emit to admins room as backup
    io.to('admins').emit(event, data);
}

// Socket.io
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Check if this is an admin
    socket.on('admin-connect', () => {
        socket.join('admins');
        adminSockets.add(socket.id);
        console.log('✅ Admin connected:', socket.id, 'Total admins:', adminSockets.size);
        
        socket.emit('admin-update', {
            status: gameState.status,
            currentQuestion: gameState.currentQuestion,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
    });
    
    // Player joins
    socket.on('join-game', (data) => {
        const playerName = data.name.trim().substring(0, 20);
        const playerLang = data.lang || 'en';
        
        // Limit photo size to prevent memory issues (max ~50KB base64)
        let playerPhoto = null;
        if (data.photo && data.photo.length < 70000) {
            playerPhoto = data.photo;
        } else if (data.photo) {
            console.log(`⚠️ Photo too large for ${playerName}: ${Math.round(data.photo.length / 1024)}KB - skipping`);
        }
        
        gameState.players.set(socket.id, {
            name: playerName,
            score: 0,
            answers: [],
            joinedAt: Date.now(),
            lang: playerLang,
            photo: playerPhoto
        });
        
        console.log(`✅ Player joined: ${playerName} (${playerLang})${playerPhoto ? ' with photo' : ''} | Total: ${gameState.players.size}`);
        
        // Send current state to player
        socket.emit('game-state', {
            status: gameState.status,
            question: gameState.status === 'question' ? getCurrentQuestionForPlayers() : null,
            timeRemaining: gameState.timeRemaining,
            playerName: playerName,
            score: 0,
            totalQuestions: questions.length
        });
        
        // Notify admins
        const updateData = {
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard()
        };
        broadcastToAdmins('player-joined', updateData);
        console.log('📢 Broadcasted player-joined to admins:', updateData.playerCount, 'players');
    });
    
    // Player submits answer
    socket.on('submit-answer', (data) => {
        if (gameState.status !== 'question') return;
        if (gameState.answers.has(socket.id)) return;
        
        gameState.answers.set(socket.id, data.answer);
        console.log(`📝 Answer received from ${socket.id}: ${data.answer} | Total answers: ${gameState.answers.size}`);
        
        socket.emit('answer-received', { answer: data.answer });
        
        // Notify admin of answer count
        broadcastToAdmins('answer-count', {
            count: gameState.answers.size,
            total: gameState.players.size
        });
    });
    
    // Admin starts game
    socket.on('admin-start-game', () => {
        console.log('🎮 Admin starting game...');
        resetGame();
        io.emit('game-started');
        io.emit('game-state', { status: 'waiting', totalQuestions: questions.length });
        
        broadcastToAdmins('admin-update', {
            status: 'waiting',
            currentQuestion: -1,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
    });
    
    // Admin shows next question
    socket.on('admin-next-question', () => {
        console.log('⏭️ Admin showing next question...');
        if (gameState.currentQuestion >= questions.length - 1) {
            // Game finished
            gameState.status = 'finished';
            console.log('🏁 Game finished!');
            io.emit('game-finished', {
                leaderboard: getLeaderboard(),
                totalQuestions: questions.length
            });
            return;
        }
        
        gameState.currentQuestion++;
        gameState.status = 'question';
        gameState.answers.clear();
        
        const question = getCurrentQuestionForPlayers();
        console.log(`❓ Question ${gameState.currentQuestion + 1}: Broadcasting to all players`);
        
        io.emit('new-question', {
            question: question,
            timeRemaining: gameState.questionDuration
        });
        
        startTimer();
        
        broadcastToAdmins('admin-update', {
            status: gameState.status,
            currentQuestion: gameState.currentQuestion,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
        
        // Reset answer count for new question
        broadcastToAdmins('answer-count', {
            count: 0,
            total: gameState.players.size
        });
    });
    
    // Admin reveals answer early
    socket.on('admin-reveal-answer', () => {
        console.log('👀 Admin revealing answer early...');
        if (gameState.status !== 'question') return;
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        revealAnswer();
    });
    
    // Admin resets game
    socket.on('admin-reset-game', () => {
        console.log('🔄 Admin resetting game...');
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        resetGame();
        
        io.emit('game-reset');
        
        broadcastToAdmins('admin-update', {
            status: gameState.status,
            currentQuestion: gameState.currentQuestion,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
    });
    
    // Admin adds question
    socket.on('admin-add-question', (data) => {
        const newQuestion = {
            id: Date.now(),
            ...data.question
        };
        questions.push(newQuestion);
        saveQuestions(questions);
        
        broadcastToAdmins('questions-updated', { questions });
        broadcastToAdmins('admin-update', {
            status: gameState.status,
            currentQuestion: gameState.currentQuestion,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
        
        console.log('Question added. Total questions:', questions.length);
    });
    
    // Admin updates question
    socket.on('admin-update-question', (data) => {
        const { index, question } = data;
        if (index >= 0 && index < questions.length) {
            questions[index] = {
                id: questions[index].id,
                ...question
            };
            saveQuestions(questions);
            
            broadcastToAdmins('questions-updated', { questions });
            console.log('Question updated at index:', index);
        }
    });
    
    // Admin deletes question
    socket.on('admin-delete-question', (data) => {
        const { index } = data;
        if (index >= 0 && index < questions.length) {
            questions.splice(index, 1);
            saveQuestions(questions);
            
            broadcastToAdmins('questions-updated', { questions });
            broadcastToAdmins('admin-update', {
                status: gameState.status,
                currentQuestion: gameState.currentQuestion,
                totalQuestions: questions.length,
                playerCount: gameState.players.size,
                leaderboard: getLeaderboard(),
                questions: questions
            });
            
            console.log('Question deleted. Total questions:', questions.length);
        }
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        // Check if admin disconnected
        if (adminSockets.has(socket.id)) {
            adminSockets.delete(socket.id);
            console.log('❌ Admin disconnected:', socket.id, 'Remaining admins:', adminSockets.size);
        }
        
        const player = gameState.players.get(socket.id);
        if (player) {
            console.log(`❌ Player disconnected: ${player.name} | Remaining: ${gameState.players.size - 1}`);
        }
        gameState.players.delete(socket.id);
        gameState.answers.delete(socket.id);
        
        broadcastToAdmins('player-left', {
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard()
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🏆 AFCON Trivia Server running!`);
    console.log(`\n📱 Player URL: http://localhost:${PORT}`);
    console.log(`🎮 Admin Panel: http://localhost:${PORT}/admin`);
    console.log(`📝 Questions loaded: ${questions.length}`);
    console.log(`\n✨ Ready for the game!\n`);
});
