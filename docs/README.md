# 🖼️ InkFrame — E-Ink Smart Display

> Transform any space with an elegant E-ink display that shows your art when idle and becomes your personal assistant on demand.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-ESP32-green.svg)](https://www.espressif.com/)
[![Display](https://img.shields.io/badge/display-E--Ink-black.svg)](https://www.waveshare.com/)

## ✨ Features

**Dual-Mode Operation**
- **Art Mode**: Display beautiful images, artwork, or photos with zero power draw
- **Assistant Mode**: Calendar events, task lists, weather at a glance

**Smart & Connected**
- Google Calendar integration
- Todoist task sync
- Real-time weather updates
- OTA firmware updates

**Designed for Life**
- Ultra-low power consumption (weeks on battery)
- No eye strain (E-ink technology)
- Privacy-first (no camera or microphone)
- Elegant, minimal design

---

## 📦 Project Structure

```
eink-assistant/
├── firmware/              # ESP32 firmware code
│   ├── src/
│   │   └── main.cpp       # Main firmware source
│   ├── platformio.ini     # PlatformIO configuration
│   └── README.md          # Hardware setup guide
├── backend/               # Node.js API server
│   ├── server.js          # Express API server
│   ├── package.json       # Dependencies
│   └── .env.example       # Environment config template
├── web/                   # Marketing website
│   └── index.html         # Landing page
├── business/              # Business documentation
│   └── market-analysis.md # Complete market analysis
├── docs/                  # Additional documentation
└── README.md              # This file
```

---

## 🚀 Quick Start

### Prerequisites

- **Hardware**: ESP32 development board + Waveshare E-ink display
- **Software**: 
  - [Visual Studio Code](https://code.visualstudio.com/)
  - [PlatformIO Extension](https://platformio.org/install/ide?install=vscode)
  - [Node.js 18+](https://nodejs.org/)

### Step 1: Hardware Setup

**Wiring (ESP32 to Waveshare 1.54" Display)**

| E-Ink Pin | ESP32 Pin | Description |
|-----------|-----------|-------------|
| VCC       | 3.3V      | Power       |
| GND       | GND       | Ground      |
| DIN       | GPIO 23   | SPI MOSI    |
| CLK       | GPIO 18   | SPI Clock   |
| CS        | GPIO 5    | Chip Select |
| DC        | GPIO 17   | Data/Command|
| RST       | GPIO 16   | Reset       |
| BUSY      | GPIO 4    | Busy Signal |

### Step 2: Flash Firmware

```bash
# Clone or download this repository
cd eink-assistant/firmware

# Open in VS Code with PlatformIO
code .

# Build and upload (PlatformIO will handle dependencies)
# Click the → Upload button or run:
pio run --target upload
```

### Step 3: Configure WiFi

1. The device will create a WiFi network: `InkFrame-Setup`
2. Connect to it with your phone/computer
3. A configuration page will open automatically
4. Enter your WiFi credentials and save

### Step 4: Set Up Backend (Optional for Full Features)

```bash
cd backend

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
# - OpenWeatherMap API key
# - Google Calendar credentials
# - Todoist API token

# Start the server
npm start
```

### Step 5: Configure Device

1. Visit your backend URL (or `http://localhost:3000`)
2. Create an account
3. Add your device using the ID shown on screen
4. Upload images, connect calendars, configure settings

---

## 🔧 Hardware Compatibility

### Currently Supported

| Display | Size | Colors | Status |
|---------|------|--------|--------|
| Waveshare 1.54" (12561) | 200×200 | B/W | ✅ Development |
| Waveshare 7.5" v2 | 800×480 | B/W | ✅ Supported |
| Waveshare 7.5" 3-color | 800×480 | B/W/R | 🎯 Target Product |

### Planned Support

- Good Display 7.5" ACeP (7-color)
- Waveshare 10.3" (1872×1404)
- Custom displays via configuration

---

## 📱 Display Modes

### Art Mode (Default)
- Displays your uploaded images
- Automatic image rotation (configurable)
- Optimized dithering for E-ink
- Zero power draw when static

### Dashboard Mode (On-Demand)
- **Weather**: Current conditions, temperature, forecast
- **Calendar**: Today's events from Google Calendar
- **Tasks**: Priority items from Todoist
- Press button or use app to switch modes

### Setup Mode
- WiFi configuration
- Device pairing
- Firmware updates

---

## 🌐 API Reference

### Device Endpoints

```
GET  /api/device/:id/data     # Get all display data
GET  /api/device/:id/image    # Get current image
POST /api/device/:id/register # Register new device
PUT  /api/device/:id/settings # Update settings
```

### User Endpoints

```
POST /api/auth/register       # Create account
POST /api/auth/login          # Login
GET  /api/user/devices        # List user's devices
POST /api/user/images         # Upload image
```

---

## 🛣️ Roadmap

- [x] Basic E-ink display driver
- [x] WiFi configuration portal
- [x] Weather integration
- [ ] Calendar sync (Google)
- [ ] Task sync (Todoist)
- [ ] Mobile app (React Native)
- [ ] Multi-device dashboard
- [ ] Image scheduling
- [ ] Voice activation (optional)

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 💬 Support

- **Documentation**: [docs.inkframe.com](https://docs.inkframe.com)
- **Discord**: [Join our community](https://discord.gg/inkframe)
- **Email**: hello@inkframe.com

---

<p align="center">
  <strong>InkFrame</strong> — Where art meets utility
</p>
