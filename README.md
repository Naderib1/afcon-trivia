# 🏆 AFCON Trivia

A real-time, multiplayer trivia game for stadium events - built for the Africa Cup of Nations!

![AFCON Trivia](public/images/logo.png)

## ✨ Features

- 📱 **Mobile-Friendly** - Optimized for phones (QR code scanning)
- 🌍 **Multi-Language** - English, Arabic, French
- 📸 **Photo Support** - Players can add selfies via camera
- ⚡ **Real-Time Sync** - All players see the same question simultaneously
- 🎮 **Admin Control Panel** - Start game, control questions, view leaderboard
- 📝 **Question Editor** - Add/edit/delete questions from admin panel
- 🏅 **Live Leaderboard** - Track top scorers in real-time
- 🎉 **Celebrations** - Confetti and animations for correct answers

---

## 🚀 Quick Deploy (FREE)

### Option 1: Deploy to Render (Recommended)

1. Push your code to GitHub
2. Go to [render.com](https://render.com) and sign up (free)
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repo
5. Settings:
   - **Name:** `afcon-trivia`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
6. Click **"Create Web Service"**
7. Wait ~2 minutes, then visit your URL!

### Option 2: Deploy to Railway

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) and sign up
3. Click **"New Project"** → **"Deploy from GitHub repo"**
4. Select your repo
5. Railway auto-detects Node.js and deploys!
6. Click **"Generate Domain"** to get your URL

### Option 3: Deploy to Glitch

1. Go to [glitch.com](https://glitch.com)
2. Click **"New Project"** → **"Import from GitHub"**
3. Paste your repo URL
4. Glitch will auto-deploy!

### Option 4: Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy
fly launch
fly deploy
```

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open in browser
# Player: http://localhost:3000
# Admin:  http://localhost:3000/admin
```

---

## 📁 Project Structure

```
afcon-trivia/
├── server.js           # Node.js server with Socket.io
├── package.json        # Dependencies
├── questions.json      # Trivia questions (editable)
├── public/
│   ├── index.html      # Player page
│   ├── admin.html      # Admin control panel
│   ├── style.css       # Player styles
│   ├── admin.css       # Admin styles
│   ├── player.js       # Player logic
│   ├── admin.js        # Admin logic
│   └── images/
│       └── logo.png    # AFCON logo (add your own!)
├── .gitignore
├── Procfile            # For Heroku/Railway
├── render.yaml         # For Render
└── README.md
```

---

## 🎮 How to Use

### For Admins:
1. Open `/admin` page
2. Share the QR code with players (or the URL)
3. Wait for players to join
4. Click **"Start Game"** to reset scores
5. Click **"Next Question"** to show each question
6. Players have 60 seconds (or click **"Reveal Answer"** early)
7. After all questions, final leaderboard shows!

### For Players:
1. Scan QR code or visit the URL
2. Choose language
3. Enter name (optionally add photo)
4. Wait for game to start
5. Answer questions within 60 seconds
6. See your score and leaderboard!

---

## 📝 Customizing Questions

Edit `questions.json` directly, or use the **Admin Panel** → **Questions Editor**:

```json
{
  "question": {
    "en": "Question in English?",
    "ar": "السؤال بالعربية؟",
    "fr": "Question en français?"
  },
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct": 0,
  "explanation": {
    "en": "Fun fact in English",
    "ar": "معلومة بالعربية",
    "fr": "Info en français"
  }
}
```

---

## ⚠️ Important: Add Your Logo!

Add your AFCON logo to:
```
public/images/logo.png
```

---

## 🔧 Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

---

## 📱 Stadium Setup Tips

1. **Create a dedicated WiFi network** for players
2. **Print large QR codes** for easy scanning
3. **Test beforehand** with expected player count
4. **Have backup questions** ready in the editor
5. **Display admin panel on big screen** for leaderboard

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS
- **Real-time:** WebSockets via Socket.io
- **QR Codes:** qrcode library

---

## 📄 License

MIT License - Feel free to use for your events!

---

Made with ❤️ for AFCON 2025 🏆

