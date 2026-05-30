# LiquorKiosk — AI Bartender Kiosk

A professional touchscreen kiosk application built with **Python + Flask** backend and vanilla JS + SVG frontend.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | **Python 3 + Flask** — REST API, product database, Anthropic API proxy |
| Frontend | **Vanilla JS + SVG** — No framework dependencies, instant load |
| Avatar | **Humanized SVG** — Lip sync, hand wave, emotion system, breathing animation |
| Voice | **Web Speech API** — TTS (Linda speaks) + STT (microphone input) |
| AI | **Claude claude-sonnet-4-20250514** — Natural language bartender personality |

## Project Structure

```
liquorkiosk/
├── app.py                  # Flask backend — API routes, product DB
├── templates/
│   └── index.html          # Main HTML template
├── static/
│   ├── css/
│   │   └── kiosk.css       # Full UI stylesheet (dark luxury theme)
│   └── js/
│       ├── avatar.js       # SVG avatar — animations, lip sync, emotions
│       └── app.js          # App logic — voice, chat, catalog, nav
└── README.md
```

## Setup & Run

### Prerequisites
- Python 3.8+
- pip

### Install & Start

```bash
# Install dependencies
pip install flask flask-cors

# Run the kiosk server
python app.py
```

Then open: **http://localhost:5000**

For full-screen kiosk mode in Chrome:
```
google-chrome --kiosk --disable-infobars --disable-session-crashed-bubble http://localhost:5000
```

## Features

### 🧑 Linda — AI Avatar
- Humanized SVG character with realistic face, beard, shirt, pants
- **Lip sync** — jaw opens/closes while speaking
- **Hand wave** — greets customers on load
- **Talking gestures** — arms move expressively while chatting
- **Listening pose** — body language changes when mic is active
- **Emotions** — eyebrows, cheek blush change per response (happy/excited/thinking/surprised/cool)
- **Auto-blink** — eyes blink naturally every 3–5 seconds
- **Breathing** — subtle body movement always running

### 🔊 Voice System
- **Text-to-Speech** — Linda speaks every response aloud
- **Speech Recognition** — Customers can speak to Linda (Chrome/Edge)
- Voice status indicator (Ready / Listening / Thinking / Speaking)
- Stop button to interrupt speech

### 🍾 Product Catalog
- 22 premium products with aisle locations, descriptions, tags
- Filter by category (Bourbon, Scotch, Tequila, Gin, Vodka, Rum, Wine)
- Search across name, description, and tags
- Click any product for detail modal → "Ask Linda about this"

### 🍹 Cocktail Recipes
- 8 classic recipes with ingredients and step-by-step method
- Difficulty ratings (Easy / Medium / Advanced)

### 🎓 Liquor University
- Educational content about spirits, tasting, regions, and pairings

### ⚡ UX
- Animated slideshow hero on home screen
- Smooth screen transitions
- Idle auto-reset after 3 minutes
- Toast notifications
- Product/recipe modals

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Serve kiosk UI |
| GET | `/api/products` | Get products (filter by `category`, search by `q`) |
| GET | `/api/recipes` | Get all cocktail recipes |
| GET | `/api/search` | Quick product search |
| POST | `/api/chat` | Proxy to Anthropic Claude API |

## Customization

### Add products
Edit the `PRODUCTS` list in `app.py`

### Change Linda's personality
Edit the `SYSTEM` prompt in `static/js/app.js`

### Add categories
Add filter buttons in `templates/index.html` and update `CHIPS` in `app.js`

### Kiosk deployment
```bash
# Production server
pip install gunicorn
gunicorn -w 2 -b 0.0.0.0:5000 app:app
```
