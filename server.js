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
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// Trust proxy for platforms like Render, Railway, Heroku
app.set('trust proxy', 1);

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
    
    // Calculate results for each player
    const results = [];
    gameState.players.forEach((player, socketId) => {
        const playerAnswer = gameState.answers.get(socketId);
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
        io.to(result.socketId).emit('your-result', {
            isCorrect: result.isCorrect,
            newScore: result.score,
            explanation: question.explanation
        });
    });
    
    // Notify admin
    io.emit('admin-update', {
        status: gameState.status,
        currentQuestion: gameState.currentQuestion,
        totalQuestions: questions.length,
        playerCount: gameState.players.size,
        leaderboard: getLeaderboard(),
        questions: questions
    });
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

// Socket.io
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Check if this is an admin
    socket.on('admin-connect', () => {
        socket.join('admins');
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
        const playerPhoto = data.photo || null;
        
        gameState.players.set(socket.id, {
            name: playerName,
            score: 0,
            answers: [],
            joinedAt: Date.now(),
            lang: playerLang,
            photo: playerPhoto
        });
        
        console.log(`Player joined: ${playerName} (${playerLang})${playerPhoto ? ' with photo' : ''}`);
        
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
        io.to('admins').emit('player-joined', {
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard()
        });
    });
    
    // Player submits answer
    socket.on('submit-answer', (data) => {
        if (gameState.status !== 'question') return;
        if (gameState.answers.has(socket.id)) return;
        
        gameState.answers.set(socket.id, data.answer);
        
        socket.emit('answer-received', { answer: data.answer });
        
        // Notify admin of answer count
        io.to('admins').emit('answer-count', {
            count: gameState.answers.size,
            total: gameState.players.size
        });
    });
    
    // Admin starts game
    socket.on('admin-start-game', () => {
        resetGame();
        io.emit('game-started');
        io.emit('game-state', { status: 'waiting', totalQuestions: questions.length });
        
        io.to('admins').emit('admin-update', {
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
        if (gameState.currentQuestion >= questions.length - 1) {
            // Game finished
            gameState.status = 'finished';
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
        
        io.emit('new-question', {
            question: question,
            timeRemaining: gameState.questionDuration
        });
        
        startTimer();
        
        io.to('admins').emit('admin-update', {
            status: gameState.status,
            currentQuestion: gameState.currentQuestion,
            totalQuestions: questions.length,
            playerCount: gameState.players.size,
            leaderboard: getLeaderboard(),
            questions: questions
        });
    });
    
    // Admin reveals answer early
    socket.on('admin-reveal-answer', () => {
        if (gameState.status !== 'question') return;
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        revealAnswer();
    });
    
    // Admin resets game
    socket.on('admin-reset-game', () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        resetGame();
        
        io.emit('game-reset');
        
        io.to('admins').emit('admin-update', {
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
        
        io.to('admins').emit('questions-updated', { questions });
        io.to('admins').emit('admin-update', {
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
            
            io.to('admins').emit('questions-updated', { questions });
            console.log('Question updated at index:', index);
        }
    });
    
    // Admin deletes question
    socket.on('admin-delete-question', (data) => {
        const { index } = data;
        if (index >= 0 && index < questions.length) {
            questions.splice(index, 1);
            saveQuestions(questions);
            
            io.to('admins').emit('questions-updated', { questions });
            io.to('admins').emit('admin-update', {
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
        const player = gameState.players.get(socket.id);
        if (player) {
            console.log(`Player disconnected: ${player.name}`);
        }
        gameState.players.delete(socket.id);
        gameState.answers.delete(socket.id);
        
        io.to('admins').emit('player-left', {
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
