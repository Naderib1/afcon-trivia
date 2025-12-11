// AFCON Trivia - Admin Client with Question Editor
const socket = io({
    transports: ['polling', 'websocket'],
    upgrade: true,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 20000
});

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
    qrCode: document.getElementById('qr-code'),
    qrUrl: document.getElementById('qr-url'),
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
    qExplanationFr: document.getElementById('q-explanation-fr')
};

// Game State
let adminState = {
    status: 'waiting',
    currentQuestion: -1,
    totalQuestions: 10,
    questions: []
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
            break;
        case 'question':
            elements.btnStart.disabled = true;
            elements.btnNext.disabled = true;
            elements.btnReveal.disabled = false;
            break;
        case 'answer':
            elements.btnStart.disabled = true;
            elements.btnNext.disabled = false;
            elements.btnReveal.disabled = true;
            break;
        case 'finished':
            elements.btnStart.disabled = false;
            elements.btnNext.disabled = true;
            elements.btnReveal.disabled = true;
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

// Load QR Code
function loadQRCode() {
    fetch('/qr')
        .then(res => res.json())
        .then(data => {
            elements.qrCode.innerHTML = `<img src="${data.qrCode}" alt="QR Code">`;
            elements.qrUrl.textContent = data.url;
        })
        .catch(err => {
            elements.qrCode.innerHTML = '<div class="qr-loading">Failed to load QR</div>';
            console.error('QR Error:', err);
        });
}

// Render questions list
function renderQuestionsList() {
    if (!adminState.questions || adminState.questions.length === 0) {
        elements.questionsList.innerHTML = '<p class="empty-state">No questions yet. Add your first question!</p>';
        return;
    }
    
    const letters = ['A', 'B', 'C', 'D'];
    
    elements.questionsList.innerHTML = adminState.questions.map((q, index) => {
        const questionText = typeof q.question === 'object' ? q.question.en : q.question;
        
        return `
            <div class="question-item" data-index="${index}">
                <div class="question-item-header">
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

// Make functions global for onclick handlers
window.editQuestion = editQuestion;
window.deleteQuestion = deleteQuestion;

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

// Close modal on overlay click
elements.questionModal.addEventListener('click', (e) => {
    if (e.target === elements.questionModal) {
        closeModal();
    }
});

// Socket Events - Admin connect
socket.on('connect', () => {
    console.log('✅ Admin fully connected, initializing...');
    socket.emit('admin-connect');
    loadQRCode();
});

socket.on('admin-update', (data) => {
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
loadQRCode();
