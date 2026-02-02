# InkFrame Firmware Setup Guide

Complete guide for setting up your ESP32 + E-ink display development environment.

## Hardware Requirements

### What You'll Need

1. **ESP32 Development Board** (any of these work):
   - ESP32-DevKitC (recommended for beginners)
   - ESP32-WROOM-32
   - ESP32-S3-DevKitC (for production with PSRAM)
   - NodeMCU ESP32

2. **E-ink Display** (current + future):
   - **Development**: Waveshare 1.54" B/W (Model 12561) - 200×200px
   - **Production Target**: Waveshare 7.5" 3-Color (B/W/Red) - 800×480px

3. **Accessories**:
   - Micro-USB or USB-C cable (depending on your ESP32)
   - Jumper wires (female-to-female)
   - Breadboard (optional but helpful)

---

## Wiring Guide

### Waveshare 1.54" Display to ESP32

Your Waveshare 12561 1.54" display has an 8-pin connector. Here's how to wire it:

```
┌─────────────────────────────────────────────────┐
│         E-INK DISPLAY PINOUT                    │
├──────────┬──────────┬──────────────────────────┤
│ E-Ink Pin│ ESP32 Pin│ Description              │
├──────────┼──────────┼──────────────────────────┤
│ VCC      │ 3.3V     │ Power (3.3V ONLY!)       │
│ GND      │ GND      │ Ground                   │
│ DIN      │ GPIO 23  │ SPI MOSI (Data In)       │
│ CLK      │ GPIO 18  │ SPI Clock                │
│ CS       │ GPIO 5   │ Chip Select              │
│ DC       │ GPIO 17  │ Data/Command             │
│ RST      │ GPIO 16  │ Reset                    │
│ BUSY     │ GPIO 4   │ Busy Signal              │
└──────────┴──────────┴──────────────────────────┘
```

### Visual Wiring Diagram

```
ESP32                          E-Ink Display
┌─────────┐                    ┌─────────────┐
│         │                    │             │
│    3.3V ├────────────────────┤ VCC         │
│         │                    │             │
│     GND ├────────────────────┤ GND         │
│         │                    │             │
│  GPIO23 ├────────────────────┤ DIN (MOSI)  │
│         │                    │             │
│  GPIO18 ├────────────────────┤ CLK (SCK)   │
│         │                    │             │
│   GPIO5 ├────────────────────┤ CS          │
│         │                    │             │
│  GPIO17 ├────────────────────┤ DC          │
│         │                    │             │
│  GPIO16 ├────────────────────┤ RST         │
│         │                    │             │
│   GPIO4 ├────────────────────┤ BUSY        │
│         │                    │             │
└─────────┘                    └─────────────┘
```

### ⚠️ Important Notes

1. **NEVER connect VCC to 5V** - E-ink displays run on 3.3V only!
2. **Double-check wiring before powering on**
3. **The BUSY pin is essential** - it tells the ESP32 when the display is ready

---

## Software Setup

### Step 1: Install Visual Studio Code

1. Download from: https://code.visualstudio.com/
2. Install and open VS Code

### Step 2: Install PlatformIO Extension

1. In VS Code, click the Extensions icon (or press `Ctrl+Shift+X`)
2. Search for "PlatformIO IDE"
3. Click "Install"
4. Wait for installation (may take a few minutes)
5. Restart VS Code when prompted

### Step 3: Open the Project

1. In VS Code, click **File → Open Folder**
2. Navigate to the `eink-assistant/firmware` folder
3. Select the folder and click "Open"
4. PlatformIO will automatically detect the project

### Step 4: Install Dependencies

PlatformIO handles this automatically, but if needed:

1. Click the PlatformIO icon in the sidebar (alien head)
2. Click "Miscellaneous" → "PlatformIO Core CLI"
3. Run: `pio lib install`

### Step 5: Build the Firmware

1. Connect your ESP32 via USB
2. Click the ✓ (checkmark) in the bottom toolbar to build
3. Or click the → (arrow) to build and upload

### Step 6: Monitor Serial Output

1. Click the plug icon in the bottom toolbar
2. Or run: `pio device monitor`
3. You should see startup messages and the display will show "Starting..."

---

## First Boot Experience

When you first power on the device:

1. **Display shows "Setup"** with WiFi instructions
2. **Device creates WiFi network**: `InkFrame-Setup-XXXX`
3. **Connect your phone/computer** to this network
4. **Configuration page opens automatically** (or go to 192.168.4.1)
5. **Enter your home WiFi credentials**
6. **Device restarts and connects**
7. **Display shows image mode** (placeholder for now)

### Switching Modes

- **Press the BOOT button** (GPIO 0) to switch between:
  - **Image Mode**: Shows artwork/photos
  - **Dashboard Mode**: Shows weather, calendar, tasks

---

## Troubleshooting

### Display Shows Nothing

1. Check all wiring connections
2. Verify 3.3V power (not 5V!)
3. Try pressing the RST button on ESP32
4. Check serial monitor for error messages

### "Failed to connect" WiFi Error

1. Make sure you entered the correct WiFi password
2. Your router must be 2.4GHz (ESP32 doesn't support 5GHz)
3. Try moving closer to your router

### Display Flickers or Ghosts

This is normal for E-ink! The display needs to "flash" to fully update. We optimize refresh cycles to minimize this.

### Compile Errors

1. Make sure you have the latest PlatformIO
2. Try: PlatformIO → Miscellaneous → "Upgrade PlatformIO Core"
3. Delete the `.pio` folder and rebuild

### Upload Fails

1. Hold the BOOT button while pressing RST
2. Release BOOT after upload starts
3. Try a different USB cable
4. Make sure the correct COM port is selected

---

## Customization

### Change Display Type

Edit `platformio.ini` and change the default environment:

```ini
; For 7.5" B/W display
default_envs = esp32dev_75bw

; For 7.5" 3-Color display (production)
default_envs = esp32dev_75_3c
```

### Change Pin Assignments

Edit the pin definitions at the top of `main.cpp`:

```cpp
#define EPD_CS    5   // Change these if needed
#define EPD_DC    17
#define EPD_RST   16
#define EPD_BUSY  4
```

### Change Update Intervals

```cpp
const unsigned long WEATHER_UPDATE_INTERVAL = 30 * 60 * 1000;  // 30 minutes
const unsigned long DEEP_SLEEP_DURATION = 10 * 60 * 1000000ULL; // 10 minutes
```

---

## Next Steps

1. ✅ Hardware wired and tested
2. ✅ Firmware uploaded and running
3. ⬜ Set up the backend server (see `/backend/README.md`)
4. ⬜ Configure API endpoint in device settings
5. ⬜ Connect to Google Calendar and Todoist
6. ⬜ Upload your first images

---

## Getting Help

- **Serial Monitor**: Most errors are logged here
- **GitHub Issues**: Report bugs and request features
- **Discord**: Join our community for real-time help

Happy building! 🖼️
