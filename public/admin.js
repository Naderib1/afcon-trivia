// AFCON Trivia - Admin Client with Multi-Game Support
const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 20000
});

// Current selected game
let currentGameId = 1;

// Connection status
socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
});

socket.on('reconnect', (attemptNumber) => {
    console.log('🔄 Reconnected after', attemptNumber, 'attempts');
});

// DOM Elements
const elements = {
    gameStatus: document.getElementById('game-status'),
    playerCount: document.getElementById('player-count'),
    currentQ: document.getElementById('current-q'),
    totalQ: document.getElementById('total-q'),
    btnStart: document.getElementById('btn-start'),
    btnNext: document.getElementById('btn-next'),
    btnReveal: document.getElementById('btn-reveal'),
    btnReset: document.getElementById('btn-reset'),
    answerCount: document.getElementById('answer-count'),
    answerTotal: document.getElementById('answer-total'),
    qrGrid: document.getElementById('qr-grid'),
    currentQuestionCard: document.getElementById('current-question-card'),
    adminLeaderboard: document.getElementById('admin-leaderboard'),
    questionsList: document.getElementById('questions-list'),
    btnAddQuestion: document.getElementById('btn-add-question'),
    questionModal: document.getElementById('question-modal'),
    modalTitle: document.getElementById('modal-title'),
    modalClose: document.getElementById('modal-close'),
    btnModalCancel: document.getElementById('btn-modal-cancel'),
    btnModalSave: document.getElementById('btn-modal-save'),
    questionForm: document.getElementById('question-form'),
    questionId: document.getElementById('question-id'),
    qTextEn: document.getElementById('q-text-en'),
    qTextAr: document.getElementById('q-text-ar'),
    qTextFr: document.getElementById('q-text-fr'),
    qExplanationEn: document.getElementById('q-explanation-en'),
    qExplanationAr: document.getElementById('q-explanation-ar'),
    qExplanationFr: document.getElementById('q-explanation-fr'),
    winnersDownload: document.getElementById('winners-download'),
    btnDownloadWinners: document.getElementById('btn-download-winners'),
    gameButtons: document.querySelectorAll('.game-btn'),
    activeCount: document.getElementById('active-count')
};

// Game State
let adminState = {
    gameId: 1,
    status: 'waiting',
    currentQuestion: -1,
    totalQuestions: 10,
    questions: [],
    leaderboard: []
};

// Format status for display
function formatStatus(status) {
    const statusMap = {
        'waiting': 'Waiting',
        'question': 'Question Active',
        'answer': 'Showing Answer',
        'finished': 'Game Over'
    };
    return statusMap[status] || status;
}

// Update button states
function updateButtons(status) {
    switch (status) {
        case 'waiting':
            elements.btnStart.disabled = false;
            elements.btnNext.disabled = false;
            elements.btnReveal.disabled = true;
            elements.winnersDownload.style.display = 'none';
            break;
        case 'question':
            elements.btnStart.disabled = true;
            elements.btnNext.disabled = true;
            elements.btnReveal.disabled = false;
            elements.winnersDownload.style.display = 'none';
            // Reset answer count for new question
            elements.answerCount.textContent = '0';
            break;
        case 'answer':
            elements.btnStart.disabled = true;
            elements.btnNext.disabled = false;
            elements.btnReveal.disabled = true;
            elements.winnersDownload.style.display = 'none';
            break;
        case 'finished':
            elements.btnStart.disabled = false;
            elements.btnNext.disabled = true;
            elements.btnReveal.disabled = true;
            elements.winnersDownload.style.display = 'block';
            break;
    }
}

// Update current question display
function updateCurrentQuestion(questionIndex) {
    if (questionIndex < 0 || !adminState.questions || questionIndex >= adminState.questions.length) {
        elements.currentQuestionCard.innerHTML = '<p class="no-question">No question active</p>';
        return;
    }
    
    const q = adminState.questions[questionIndex];
    const letters = ['A', 'B', 'C', 'D'];
    const questionText = typeof q.question === 'object' ? q.question.en : q.question;
    
    let optionsHtml = q.options.map((opt, i) => `
        <div class="option ${i === q.correct ? 'correct' : ''}">
            <span class="option-marker">${letters[i]}</span>
            <span>${opt}</span>
            ${i === q.correct ? ' ✓' : ''}
        </div>
    `).join('');
    
    elements.currentQuestionCard.innerHTML = `
        <p class="question">${questionText}</p>
        <div class="options">${optionsHtml}</div>
    `;
}

// Update leaderboard
function updateLeaderboard(leaderboard) {
    // Store leaderboard in state
    adminState.leaderboard = leaderboard || [];
    
    if (!leaderboard || leaderboard.length === 0) {
        elements.adminLeaderboard.innerHTML = '<li class="empty-state">No players yet</li>';
        return;
    }
    
    const medals = ['🥇', '🥈', '🥉'];
    
    elements.adminLeaderboard.innerHTML = leaderboard.map((player, index) => {
        const photoHtml = player.photo 
            ? `<img src="${player.photo}" alt="${player.name}">`
            : `<span>${player.name.charAt(0).toUpperCase()}</span>`;
        
        return `
            <li>
                <span class="leader-rank">${medals[index] || (index + 1)}</span>
                <div class="leader-photo">${photoHtml}</div>
                <span class="leader-name">${player.name}</span>
                <span class="leader-score">${player.score}</span>
            </li>
        `;
    }).join('');
}

// Load all QR Codes
function loadAllQRCodes() {
    fetch('/qr/all')
        .then(res => res.json())
        .then(data => {
            elements.qrGrid.innerHTML = data.qrCodes.map(qr => `
                <div class="qr-card ${qr.gameId === currentGameId ? 'active' : ''}" data-game="${qr.gameId}">
                    <div class="qr-card-header">
                        <span class="qr-game-label">Game ${qr.gameId}</span>
                    </div>
                    <div class="qr-card-body" onclick="downloadQR(${qr.gameId})">
                        <img src="${qr.qrCode}" alt="Game ${qr.gameId} QR" class="qr-image">
                    </div>
                    <div class="qr-card-footer">
                        <p class="qr-url-small">${qr.url}</p>
                        <button class="btn-download-qr" onclick="downloadQR(${qr.gameId})">
                            📥 Download QR
                        </button>
                    </div>
                </div>
            `).join('');
        })
        .catch(err => {
            elements.qrGrid.innerHTML = '<div class="qr-loading">Failed to load QR codes</div>';
            console.error('QR Error:', err);
        });
}

// Download QR code as image (1920x1080)
async function downloadQR(gameId) {
    try {
        const response = await fetch(`/qr?game=${gameId}`);
        const data = await response.json();
        
        // Create a canvas - 1920x1080 for stadium screens
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        // Background gradient
        const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
        gradient.addColorStop(0, '#B22222');
        gradient.addColorStop(1, '#8B0000');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1920, 1080);
        
        // Decorative elements
        ctx.fillStyle = 'rgba(255, 215, 0, 0.1)';
        ctx.beginPath();
        ctx.arc(1700, 200, 300, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(200, 900, 250, 0, Math.PI * 2);
        ctx.fill();
        
        // White card area
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(560, 80, 800, 920, 40);
        ctx.fill();
        
        // Title
        ctx.fillStyle = '#B22222';
        ctx.font = 'bold 72px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('AFCON TRIVIA', 960, 180);
        
        // Game number with gold background
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.roundRect(760, 200, 400, 90, 20);
        ctx.fill();
        ctx.fillStyle = '#8B0000';
        ctx.font = 'bold 60px Arial, sans-serif';
        ctx.fillText(`GAME ${gameId}`, 960, 268);
        
        // QR Code
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = data.qrCode;
        });
        ctx.drawImage(img, 610, 320, 700, 700);
        
        // Footer text
        ctx.fillStyle = '#B22222';
        ctx.font = 'bold 36px Arial, sans-serif';
        ctx.fillText('SCAN TO PLAY!', 960, 900);
        
        ctx.font = '24px Arial, sans-serif';
        ctx.fillStyle = '#666666';
        ctx.fillText(data.url, 960, 945);
        
        ctx.fillStyle = '#B22222';
        ctx.font = '20px Arial, sans-serif';
        ctx.fillText('AFRICA CUP OF NATIONS - MOROCCO 2025', 960, 985);
        
        // Download
        const link = document.createElement('a');
        link.download = `AFCON_Game_${gameId}_QR_1920x1080.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
    } catch (err) {
        console.error('Failed to download QR:', err);
        alert('Failed to download QR code');
    }
}

// Make downloadQR global
window.downloadQR = downloadQR;

// Switch game
function switchGame(gameId) {
    currentGameId = gameId;
    
    // Update button states
    elements.gameButtons.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.game) === gameId);
    });
    
    // Update QR card highlights
    document.querySelectorAll('.qr-card').forEach(card => {
        card.classList.toggle('active', parseInt(card.dataset.game) === gameId);
    });
    
    // Tell server we switched games
    socket.emit('admin-switch-game', { gameId });
}

// Render questions list with activation toggles
function renderQuestionsList() {
    if (!adminState.questions || adminState.questions.length === 0) {
        elements.questionsList.innerHTML = '<p class="empty-state">No questions yet. Add your first question!</p>';
        updateActiveCount();
        return;
    }
    
    const letters = ['A', 'B', 'C', 'D'];
    
    elements.questionsList.innerHTML = adminState.questions.map((q, index) => {
        const questionText = typeof q.question === 'object' ? q.question.en : q.question;
        const isActive = q.active === true;
        
        return `
            <div class="question-item ${isActive ? 'active' : 'inactive'}" data-index="${index}">
                <div class="question-item-header">
                    <button class="btn-toggle ${isActive ? 'on' : 'off'}" onclick="toggleQuestion(${index})" title="${isActive ? 'Click to deactivate' : 'Click to activate'}">
                        ${isActive ? '✅' : '⬜'}
                    </button>
                    <span class="question-item-number">Q${index + 1}</span>
                    <span class="question-item-text">${questionText}</span>
                    <div class="question-item-actions">
                        <button class="btn-edit" onclick="editQuestion(${index})">✏️ Edit</button>
                        <button class="btn-delete" onclick="deleteQuestion(${index})">🗑️</button>
                    </div>
                </div>
                <div class="question-item-options">
                    ${q.options.map((opt, i) => `
                        <span class="${i === q.correct ? 'correct-option' : ''}">${letters[i]}: ${opt}</span>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
    
    updateActiveCount();
}

// Update active questions count
function updateActiveCount() {
    const activeCount = adminState.questions.filter(q => q.active === true).length;
    if (elements.activeCount) {
        elements.activeCount.textContent = `${activeCount} Active`;
        elements.activeCount.className = `active-count ${activeCount > 0 ? 'has-active' : ''}`;
    }
}

// Toggle question active state
function toggleQuestion(index) {
    socket.emit('admin-toggle-question', { index });
}

// Open modal for adding question
function openAddModal() {
    elements.modalTitle.textContent = 'Add Question';
    elements.questionId.value = '';
    elements.questionForm.reset();
    document.querySelector('input[name="correct"][value="0"]').checked = true;
    elements.questionModal.classList.add('active');
}

// Open modal for editing question
function editQuestion(index) {
    const q = adminState.questions[index];
    if (!q) return;
    
    elements.modalTitle.textContent = 'Edit Question';
    elements.questionId.value = index;
    
    // Set question text
    if (typeof q.question === 'object') {
        elements.qTextEn.value = q.question.en || '';
        elements.qTextAr.value = q.question.ar || '';
        elements.qTextFr.value = q.question.fr || '';
    } else {
        elements.qTextEn.value = q.question || '';
        elements.qTextAr.value = '';
        elements.qTextFr.value = '';
    }
    
    // Set options
    q.options.forEach((opt, i) => {
        document.getElementById(`option-${i}`).value = opt;
    });
    
    // Set correct answer
    document.querySelector(`input[name="correct"][value="${q.correct}"]`).checked = true;
    
    // Set explanations
    if (typeof q.explanation === 'object') {
        elements.qExplanationEn.value = q.explanation.en || '';
        elements.qExplanationAr.value = q.explanation.ar || '';
        elements.qExplanationFr.value = q.explanation.fr || '';
    } else {
        elements.qExplanationEn.value = q.explanation || '';
        elements.qExplanationAr.value = '';
        elements.qExplanationFr.value = '';
    }
    
    elements.questionModal.classList.add('active');
}

// Delete question
function deleteQuestion(index) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    
    socket.emit('admin-delete-question', { index });
}

// Close modal
function closeModal() {
    elements.questionModal.classList.remove('active');
}

// Save question
function saveQuestion() {
    const index = elements.questionId.value;
    const isEdit = index !== '';
    
    const questionData = {
        question: {
            en: elements.qTextEn.value.trim(),
            ar: elements.qTextAr.value.trim() || elements.qTextEn.value.trim(),
            fr: elements.qTextFr.value.trim() || elements.qTextEn.value.trim()
        },
        options: [
            document.getElementById('option-0').value.trim(),
            document.getElementById('option-1').value.trim(),
            document.getElementById('option-2').value.trim(),
            document.getElementById('option-3').value.trim()
        ],
        correct: parseInt(document.querySelector('input[name="correct"]:checked').value),
        explanation: {
            en: elements.qExplanationEn.value.trim(),
            ar: elements.qExplanationAr.value.trim() || elements.qExplanationEn.value.trim(),
            fr: elements.qExplanationFr.value.trim() || elements.qExplanationEn.value.trim()
        }
    };
    
    // Validate
    if (!questionData.question.en || questionData.options.some(o => !o)) {
        alert('Please fill in the question and all options.');
        return;
    }
    
    if (isEdit) {
        socket.emit('admin-update-question', { index: parseInt(index), question: questionData });
    } else {
        socket.emit('admin-add-question', { question: questionData });
    }
    
    closeModal();
}

// Helper to draw photo with proper aspect ratio (no stretch) and mirror fix
async function drawPlayerPhoto(ctx, photo, x, y, size) {
    if (!photo) return false;
    
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = photo;
        });
        
        // Calculate crop to make it square (center crop)
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        
        // Save context and flip horizontally to fix selfie mirror
        ctx.save();
        ctx.translate(x + size, y);
        ctx.scale(-1, 1);
        
        // Draw with proper aspect ratio
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        ctx.restore();
        
        return true;
    } catch (e) {
        console.error('Failed to load photo:', e);
        return false;
    }
}

// Download all 3 winners in ONE frame (1920x1080)
async function downloadWinners() {
    const top3 = adminState.leaderboard.slice(0, 3);
    if (top3.length === 0) {
        alert('No winners to download!');
        return;
    }
    
    // Create canvas - 1920x1080 for stadium screens
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    
    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 1920, 1080);
    gradient.addColorStop(0, '#B22222');
    gradient.addColorStop(1, '#8B0000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1920, 1080);
    
    // Decorative gold circles
    ctx.fillStyle = 'rgba(255, 215, 0, 0.15)';
    ctx.beginPath();
    ctx.arc(100, 150, 200, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(1820, 930, 200, 0, Math.PI * 2);
    ctx.fill();
    
    // Gold accent bar at bottom
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(0, 1020, 1920, 60);
    
    // Title
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 80px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AFCON TRIVIA WINNERS', 960, 100);
    
    // Subtitle
    ctx.font = '36px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText('Top 3 Players', 960, 150);
    
    const medals = ['🥇', '🥈', '🥉'];
    const ranks = ['1ST PLACE', '2ND PLACE', '3RD PLACE'];
    const positions = [960, 400, 1520]; // Center, Left, Right (1st in center)
    const photoSizes = [280, 200, 200]; // 1st place bigger
    const yOffsets = [280, 350, 350]; // 1st place higher
    
    // Draw winners (1st in center, 2nd on left, 3rd on right)
    const drawOrder = top3.length >= 2 ? [1, 0, 2] : [0]; // Draw 2nd, 1st, 3rd (1st on top)
    
    for (const orderIdx of drawOrder) {
        if (orderIdx >= top3.length) continue;
        
        const player = top3[orderIdx];
        const x = positions[orderIdx];
        const photoSize = photoSizes[orderIdx];
        const y = yOffsets[orderIdx];
        const photoRadius = photoSize / 2;
        
        // Photo circle background
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(x, y + photoRadius, photoRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw player photo or initial
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + photoRadius, photoRadius - 5, 0, Math.PI * 2);
        ctx.clip();
        
        const photoDrawn = await drawPlayerPhoto(ctx, player.photo, x - photoRadius + 5, y + 5, photoSize - 10);
        
        if (!photoDrawn) {
            // Draw initial
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(x - photoRadius, y, photoSize, photoSize);
            ctx.fillStyle = '#B22222';
            ctx.font = `bold ${photoSize * 0.5}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(player.name.charAt(0).toUpperCase(), x, y + photoRadius);
        }
        ctx.restore();
        
        // Gold border
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = orderIdx === 0 ? 8 : 6;
        ctx.beginPath();
        ctx.arc(x, y + photoRadius, photoRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Medal emoji
        ctx.font = orderIdx === 0 ? '80px Arial' : '60px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(medals[orderIdx], x, y - 20);
        
        // Rank text
        ctx.fillStyle = '#FFD700';
        ctx.font = orderIdx === 0 ? 'bold 36px Arial, sans-serif' : 'bold 28px Arial, sans-serif';
        ctx.fillText(ranks[orderIdx], x, y + photoSize + 50);
        
        // Player name
        ctx.fillStyle = '#FFFFFF';
        ctx.font = orderIdx === 0 ? 'bold 52px Arial, sans-serif' : 'bold 40px Arial, sans-serif';
        ctx.fillText(player.name, x, y + photoSize + 100);
        
        // Score
        ctx.fillStyle = '#FFD700';
        ctx.font = orderIdx === 0 ? 'bold 44px Arial, sans-serif' : 'bold 32px Arial, sans-serif';
        ctx.fillText(player.score + ' POINTS', x, y + photoSize + 150);
    }
    
    // Footer text on gold bar
    ctx.fillStyle = '#8B0000';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AFRICA CUP OF NATIONS - MOROCCO 2025', 960, 1058);
    
    // Download
    const link = document.createElement('a');
    link.download = `AFCON_Winners_1920x1080.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    alert('✅ Downloaded winners card!');
}

// Make functions global for onclick handlers
window.editQuestion = editQuestion;
window.deleteQuestion = deleteQuestion;
window.toggleQuestion = toggleQuestion;

// Button Event Listeners
elements.btnStart.addEventListener('click', () => {
    socket.emit('admin-start-game');
});

elements.btnNext.addEventListener('click', () => {
    socket.emit('admin-next-question');
});

elements.btnReveal.addEventListener('click', () => {
    socket.emit('admin-reveal-answer');
});

elements.btnReset.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset the game? All progress will be lost.')) {
        socket.emit('admin-reset-game');
    }
});

elements.btnAddQuestion.addEventListener('click', openAddModal);
elements.modalClose.addEventListener('click', closeModal);
elements.btnModalCancel.addEventListener('click', closeModal);
elements.btnModalSave.addEventListener('click', saveQuestion);
elements.btnDownloadWinners.addEventListener('click', downloadWinners);

// Close modal on overlay click
elements.questionModal.addEventListener('click', (e) => {
    if (e.target === elements.questionModal) {
        closeModal();
    }
});

// Game button click handlers
elements.gameButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const gameId = parseInt(btn.dataset.game);
        switchGame(gameId);
    });
});

// Socket Events - Admin connect
socket.on('connect', () => {
    console.log('✅ Admin fully connected, initializing...');
    socket.emit('admin-connect', { gameId: currentGameId });
    loadAllQRCodes();
});

socket.on('admin-update', (data) => {
    // Only update if it's for our current game
    if (data.gameId && data.gameId !== currentGameId) return;
    
    adminState.status = data.status;
    adminState.currentQuestion = data.currentQuestion;
    adminState.totalQuestions = data.totalQuestions;
    
    if (data.questions) {
        adminState.questions = data.questions;
        renderQuestionsList();
    }
    
    elements.gameStatus.textContent = formatStatus(data.status);
    elements.playerCount.textContent = data.playerCount;
    elements.currentQ.textContent = data.currentQuestion + 1;
    elements.totalQ.textContent = data.totalQuestions;
    elements.answerTotal.textContent = data.playerCount;
    
    updateButtons(data.status);
    updateCurrentQuestion(data.currentQuestion);
    updateLeaderboard(data.leaderboard);
});

socket.on('questions-updated', (data) => {
    adminState.questions = data.questions;
    adminState.totalQuestions = data.questions.length;
    elements.totalQ.textContent = data.questions.length;
    renderQuestionsList();
});

socket.on('player-joined', (data) => {
    elements.playerCount.textContent = data.playerCount;
    elements.answerTotal.textContent = data.playerCount;
    updateLeaderboard(data.leaderboard);
});

socket.on('player-left', (data) => {
    elements.playerCount.textContent = data.playerCount;
    elements.answerTotal.textContent = data.playerCount;
    updateLeaderboard(data.leaderboard);
});

socket.on('answer-count', (data) => {
    elements.answerCount.textContent = data.count;
    elements.answerTotal.textContent = data.total;
});

socket.on('disconnect', () => {
    console.log('Admin disconnected');
});

// Initialize
loadAllQRCodes();
