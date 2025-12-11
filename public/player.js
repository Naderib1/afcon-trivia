// AFCON Trivia - Player Client with i18n
const socket = io();

// Translations
const translations = {
    en: {
        triviaTitle: "TRIVIA",
        subtitle: "Test your African football knowledge!",
        enterName: "Enter your name",
        joinGame: "Join Game",
        addPhoto: "Add Photo",
        photoOptional: "(Optional)",
        getReady: "Get Ready!",
        waitingForGame: "Waiting for the game to start...",
        yourScore: "Your Score",
        answerLocked: "Answer locked!",
        correct: "Correct!",
        wrong: "Wrong!",
        nextQuestion: "Next question coming up...",
        gameOver: "Game Over!",
        finalScore: "Your Final Score",
        topPlayers: "Top Players",
        thanks: "Thanks for playing AFCON Trivia!"
    },
    ar: {
        triviaTitle: "المسابقة",
        subtitle: "اختبر معلوماتك عن كرة القدم الأفريقية!",
        enterName: "أدخل اسمك",
        joinGame: "انضم للعبة",
        addPhoto: "أضف صورة",
        photoOptional: "(اختياري)",
        getReady: "استعد!",
        waitingForGame: "في انتظار بدء اللعبة...",
        yourScore: "نقاطك",
        answerLocked: "تم تأكيد إجابتك!",
        correct: "صحيح!",
        wrong: "خطأ!",
        nextQuestion: "السؤال التالي قادم...",
        gameOver: "انتهت اللعبة!",
        finalScore: "مجموع نقاطك",
        topPlayers: "أفضل اللاعبين",
        thanks: "شكراً للعب AFCON Trivia!"
    },
    fr: {
        triviaTitle: "QUIZ",
        subtitle: "Testez vos connaissances sur le football africain!",
        enterName: "Entrez votre nom",
        joinGame: "Rejoindre",
        addPhoto: "Ajouter Photo",
        photoOptional: "(Optionnel)",
        getReady: "Préparez-vous!",
        waitingForGame: "En attente du début du jeu...",
        yourScore: "Votre Score",
        answerLocked: "Réponse enregistrée!",
        correct: "Correct!",
        wrong: "Faux!",
        nextQuestion: "Prochaine question...",
        gameOver: "Fin du Jeu!",
        finalScore: "Votre Score Final",
        topPlayers: "Meilleurs Joueurs",
        thanks: "Merci d'avoir joué AFCON Trivia!"
    }
};

// Current language
let currentLang = 'en';

// DOM Elements
const screens = {
    language: document.getElementById('language-screen'),
    welcome: document.getElementById('welcome-screen'),
    waiting: document.getElementById('waiting-screen'),
    question: document.getElementById('question-screen'),
    result: document.getElementById('result-screen'),
    final: document.getElementById('final-screen')
};

const elements = {
    joinForm: document.getElementById('join-form'),
    playerNameInput: document.getElementById('player-name'),
    displayName: document.getElementById('display-name'),
    waitingScore: document.getElementById('waiting-score'),
    gameScore: document.getElementById('game-score'),
    qNumber: document.getElementById('q-number'),
    qTotal: document.getElementById('q-total'),
    timerText: document.getElementById('timer-text'),
    timerCircle: document.getElementById('timer-circle'),
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),
    answerStatus: document.getElementById('answer-status'),
    resultIcon: document.getElementById('result-icon'),
    resultTitle: document.getElementById('result-title'),
    resultExplanation: document.getElementById('result-explanation'),
    resultScore: document.getElementById('result-score'),
    finalScore: document.getElementById('final-score'),
    maxPossibleScore: document.getElementById('max-possible-score'),
    finalLeaderboard: document.getElementById('final-leaderboard'),
    confetti: document.getElementById('confetti'),
    photoInput: document.getElementById('photo-input'),
    photoBtn: document.getElementById('photo-btn'),
    photoPreview: document.getElementById('photo-preview'),
    badgePhoto: document.getElementById('badge-photo')
};

// Game State
let playerState = {
    name: '',
    score: 0,
    currentAnswer: null,
    hasAnswered: false,
    photo: null
};

// Apply translations
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang][key]) {
            el.textContent = translations[currentLang][key];
        }
    });
    
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[currentLang][key]) {
            el.placeholder = translations[currentLang][key];
        }
    });
    
    // Set RTL for Arabic
    if (currentLang === 'ar') {
        document.body.classList.add('rtl');
    } else {
        document.body.classList.remove('rtl');
    }
}

// Set language
function setLanguage(lang) {
    currentLang = lang;
    applyTranslations();
    showScreen('welcome');
}

// Show specific screen
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
    }
}

// Update timer display
function updateTimer(seconds, totalSeconds = 60) {
    elements.timerText.textContent = seconds;
    
    const circumference = 2 * Math.PI * 45;
    const offset = circumference * (1 - seconds / totalSeconds);
    elements.timerCircle.style.strokeDashoffset = offset;
    
    elements.timerCircle.classList.remove('warning', 'danger');
    if (seconds <= 10) {
        elements.timerCircle.classList.add('danger');
    } else if (seconds <= 20) {
        elements.timerCircle.classList.add('warning');
    }
}

// Create option buttons
function createOptions(options) {
    elements.optionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    
    options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.dataset.index = index;
        btn.innerHTML = `
            <span class="option-letter">${letters[index]}</span>
            <span class="option-text">${option}</span>
        `;
        btn.addEventListener('click', () => selectAnswer(index));
        elements.optionsContainer.appendChild(btn);
    });
}

// Select answer
function selectAnswer(index) {
    if (playerState.hasAnswered) return;
    
    playerState.currentAnswer = index;
    playerState.hasAnswered = true;
    
    document.querySelectorAll('.option-btn').forEach((btn, i) => {
        btn.classList.remove('selected');
        btn.classList.add('disabled');
        if (i === index) {
            btn.classList.add('selected');
        }
    });
    
    elements.answerStatus.classList.add('show');
    socket.emit('submit-answer', { answer: index });
}

// Show result with animation
function showResult(isCorrect, explanation, newScore) {
    playerState.score = newScore;
    
    if (isCorrect) {
        elements.resultIcon.textContent = '🎉';
        elements.resultTitle.textContent = translations[currentLang].correct;
        elements.resultTitle.className = 'result-title correct';
        createMiniConfetti();
    } else {
        elements.resultIcon.textContent = '😢';
        elements.resultTitle.textContent = translations[currentLang].wrong;
        elements.resultTitle.className = 'result-title wrong';
    }
    
    elements.resultExplanation.textContent = explanation || '';
    elements.resultScore.textContent = newScore;
    
    showScreen('result');
}

// Reveal answer on question screen
function revealAnswerOnQuestion(correctAnswer) {
    document.querySelectorAll('.option-btn').forEach((btn, i) => {
        btn.classList.add('disabled');
        if (i === correctAnswer) {
            btn.classList.add('correct');
        } else if (i === playerState.currentAnswer && i !== correctAnswer) {
            btn.classList.add('wrong');
        }
    });
}

// Create mini confetti with emojis
function createMiniConfetti() {
    const colors = ['#B22222', '#c93c3c', '#0EC76A', '#fbbf24', '#f59e0b', '#ffffff'];
    const emojis = ['⚽', '🌟', '✨', '🎉', '🏆'];
    
    // Confetti pieces
    for (let i = 0; i < 40; i++) {
        setTimeout(() => {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (2.5 + Math.random() * 2) + 's';
            piece.style.width = (8 + Math.random() * 10) + 'px';
            piece.style.height = (8 + Math.random() * 10) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            elements.confetti.appendChild(piece);
            setTimeout(() => piece.remove(), 4500);
        }, i * 40);
    }
    
    // Emoji burst
    for (let i = 0; i < 8; i++) {
        setTimeout(() => {
            const emoji = document.createElement('div');
            emoji.className = 'confetti-piece';
            emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            emoji.style.left = (20 + Math.random() * 60) + '%';
            emoji.style.fontSize = (20 + Math.random() * 15) + 'px';
            emoji.style.background = 'transparent';
            emoji.style.animationDuration = (2 + Math.random() * 1.5) + 's';
            elements.confetti.appendChild(emoji);
            setTimeout(() => emoji.remove(), 3500);
        }, i * 100);
    }
}

// Create full confetti celebration
function createFullConfetti() {
    const colors = ['#B22222', '#c93c3c', '#8D0000', '#0EC76A', '#fbbf24', '#f59e0b', '#ffffff'];
    const emojis = ['🏆', '⚽', '🌟', '✨', '🎉', '🇲🇦', '🥇', '🎊', '👏'];
    
    // Massive confetti burst
    for (let i = 0; i < 120; i++) {
        setTimeout(() => {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (3 + Math.random() * 3) + 's';
            piece.style.width = (6 + Math.random() * 12) + 'px';
            piece.style.height = (6 + Math.random() * 12) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
            elements.confetti.appendChild(piece);
            setTimeout(() => piece.remove(), 6000);
        }, i * 30);
    }
    
    // Emoji rain
    for (let i = 0; i < 25; i++) {
        setTimeout(() => {
            const emoji = document.createElement('div');
            emoji.className = 'confetti-piece';
            emoji.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            emoji.style.left = Math.random() * 100 + '%';
            emoji.style.fontSize = (24 + Math.random() * 20) + 'px';
            emoji.style.background = 'transparent';
            emoji.style.animationDuration = (2.5 + Math.random() * 2) + 's';
            emoji.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))';
            elements.confetti.appendChild(emoji);
            setTimeout(() => emoji.remove(), 5000);
        }, i * 150);
    }
    
    // Second wave
    setTimeout(() => {
        for (let i = 0; i < 60; i++) {
            setTimeout(() => {
                const piece = document.createElement('div');
                piece.className = 'confetti-piece';
                piece.style.left = Math.random() * 100 + '%';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                piece.style.animationDuration = (3 + Math.random() * 2) + 's';
                piece.style.width = (8 + Math.random() * 10) + 'px';
                piece.style.height = (8 + Math.random() * 10) + 'px';
                piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
                elements.confetti.appendChild(piece);
                setTimeout(() => piece.remove(), 5000);
            }, i * 50);
        }
    }, 2000);
}

// Update leaderboard
function updateLeaderboard(leaderboard) {
    elements.finalLeaderboard.innerHTML = '';
    
    if (leaderboard.length === 0) {
        elements.finalLeaderboard.innerHTML = '<li class="empty-state">No scores yet</li>';
        return;
    }
    
    const medals = ['🥇', '🥈', '🥉'];
    
    leaderboard.forEach((player, index) => {
        const li = document.createElement('li');
        const photoHtml = player.photo 
            ? `<img src="${player.photo}" alt="${player.name}">`
            : `<span>${player.name.charAt(0).toUpperCase()}</span>`;
        
        li.innerHTML = `
            <span class="leader-rank">${medals[index] || (index + 1)}</span>
            <div class="leader-photo">${photoHtml}</div>
            <span class="leader-name">${player.name}</span>
            <span class="leader-score">${player.score}</span>
        `;
        
        if (player.name === playerState.name) {
            li.style.background = 'rgba(14, 199, 106, 0.15)';
            li.style.borderRadius = '10px';
        }
        
        elements.finalLeaderboard.appendChild(li);
    });
}

// Language button event listeners
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        setLanguage(lang);
    });
});

// Photo button click - trigger file input
elements.photoBtn.addEventListener('click', () => {
    elements.photoInput.click();
});

// Photo input change - handle selected/captured photo
elements.photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const photoData = event.target.result;
            playerState.photo = photoData;
            
            // Update preview
            elements.photoPreview.innerHTML = `<img src="${photoData}" alt="Your photo">`;
            
            // Update button text
            elements.photoBtn.innerHTML = `<span>✓</span><span>${translations[currentLang].addPhoto}</span>`;
            elements.photoBtn.style.background = 'linear-gradient(135deg, #0EC76A 0%, #0aa858 100%)';
        };
        reader.readAsDataURL(file);
    }
});

// Form submit
elements.joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = elements.playerNameInput.value.trim();
    
    if (name.length < 1) return;
    
    playerState.name = name;
    elements.displayName.textContent = name;
    
    // Update badge photo
    if (playerState.photo) {
        elements.badgePhoto.innerHTML = `<img src="${playerState.photo}" alt="${name}">`;
    } else {
        elements.badgePhoto.innerHTML = `<span>${name.charAt(0).toUpperCase()}</span>`;
    }
    
    socket.emit('join-game', { name, lang: currentLang, photo: playerState.photo });
    showScreen('waiting');
});

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('game-state', (data) => {
    if (data.totalQuestions) {
        elements.qTotal.textContent = data.totalQuestions;
        elements.maxPossibleScore.textContent = data.totalQuestions * 10;
    }
    
    if (data.status === 'waiting') {
        elements.waitingScore.textContent = data.score || 0;
        showScreen('waiting');
    } else if (data.status === 'question' && data.question) {
        elements.qNumber.textContent = data.question.questionNumber;
        elements.qTotal.textContent = data.question.totalQuestions;
        elements.questionText.textContent = getLocalizedText(data.question.question);
        createOptions(data.question.options);
        updateTimer(data.timeRemaining);
        playerState.hasAnswered = false;
        playerState.currentAnswer = null;
        elements.answerStatus.classList.remove('show');
        showScreen('question');
    }
});

socket.on('game-started', () => {
    playerState.score = 0;
    elements.waitingScore.textContent = 0;
    elements.gameScore.textContent = 0;
    showScreen('waiting');
});

socket.on('new-question', (data) => {
    playerState.hasAnswered = false;
    playerState.currentAnswer = null;
    
    elements.qNumber.textContent = data.question.questionNumber;
    elements.qTotal.textContent = data.question.totalQuestions;
    elements.maxPossibleScore.textContent = data.question.totalQuestions * 10;
    elements.questionText.textContent = getLocalizedText(data.question.question);
    elements.gameScore.textContent = playerState.score;
    
    createOptions(data.question.options);
    updateTimer(data.timeRemaining);
    
    elements.answerStatus.classList.remove('show');
    showScreen('question');
});

socket.on('timer', (data) => {
    updateTimer(data.timeRemaining);
});

socket.on('answer-received', (data) => {
    console.log('Answer received:', data);
});

socket.on('answer-reveal', (data) => {
    revealAnswerOnQuestion(data.correctAnswer);
});

socket.on('your-result', (data) => {
    setTimeout(() => {
        showResult(data.isCorrect, getLocalizedText(data.explanation), data.newScore);
        elements.gameScore.textContent = data.newScore;
        elements.waitingScore.textContent = data.newScore;
    }, 1000);
});

socket.on('game-finished', (data) => {
    elements.finalScore.textContent = playerState.score;
    if (data.totalQuestions) {
        elements.maxPossibleScore.textContent = data.totalQuestions * 10;
    }
    updateLeaderboard(data.leaderboard);
    createFullConfetti();
    showScreen('final');
});

socket.on('game-reset', () => {
    playerState.score = 0;
    playerState.hasAnswered = false;
    playerState.currentAnswer = null;
    elements.waitingScore.textContent = 0;
    elements.gameScore.textContent = 0;
    showScreen('waiting');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Helper to get localized text
function getLocalizedText(textObj) {
    if (typeof textObj === 'string') return textObj;
    if (textObj && typeof textObj === 'object') {
        return textObj[currentLang] || textObj.en || textObj.ar || textObj.fr || '';
    }
    return '';
}

// Initialize
showScreen('language');
