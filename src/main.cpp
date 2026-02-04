/**
 * InkFrame E-Ink Display
 * For: Waveshare E-Paper ESP32 Driver Board
 *
 * Features:
 * - WiFi configuration via captive portal
 * - Fetches images from InkFrame API
 * - Displays dashboard with uptime, IP, signal
 * - Image rotation support
 *
 * IMPORTANT: Hold BOOT button during startup to reset WiFi!
 */

#include <Arduino.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSans9pt7b.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ============================================================
// PIN DEFINITIONS FOR WAVESHARE ESP32 DRIVER BOARD
// ============================================================
#define EPD_SCK   13
#define EPD_MOSI  14
#define EPD_CS    15
#define EPD_BUSY  25
#define EPD_RST   26
#define EPD_DC    27

#define BUTTON_PIN 0  // BOOT button for WiFi reset

// ============================================================
// DISPLAY DRIVER SELECTION
// The Waveshare 1.54" display may use different controllers
// Try these options if display shows nothing:
// ============================================================

// OPTION 1: GxEPD2_154_D67 - for GDEH0154D67 (SSD1681)
//GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(
//  GxEPD2_154_D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
//);

// OPTION 2: GxEPD2_154 - for older GDEP015OC1 (IL3829)
//GxEPD2_BW<GxEPD2_154, GxEPD2_154::HEIGHT> display(
 // GxEPD2_154(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
//);

// OPTION 3: GxEPD2_154_GDEY0154D67 
GxEPD2_BW<GxEPD2_154_GDEY0154D67, GxEPD2_154_GDEY0154D67::HEIGHT> display(
GxEPD2_154_GDEY0154D67(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);

// ============================================================
// API CONFIGURATION
// ============================================================
// For local development, use your computer's IP:
// #define API_SERVER "http://192.168.1.100:3000"
// For production, use your domain:
#define API_SERVER "https://www.eink-luvia.com"
#define DISPLAY_WIDTH 200
#define DISPLAY_HEIGHT 200

// ============================================================
// GLOBALS
// ============================================================
SPIClass hspi(HSPI);
WiFiManager wifiManager;
Preferences preferences;
WiFiClientSecure secureClient;
bool wifiConnected = false;

// Display modes
enum DisplayMode {
  MODE_DASHBOARD,
  MODE_IMAGE,
  MODE_SETUP
};

DisplayMode currentMode = MODE_DASHBOARD;
int currentImageIndex = 0;
int totalImages = 0;
unsigned long lastImageRotation = 0;
unsigned long imageRotateInterval = 3600000;  // 1 hour default

// Server-driven polling variables
int serverRefreshVersion = 0;
int nextPollSeconds = 30;  // Default: poll every 30 seconds
unsigned long lastPollTime = 0;

// Image buffer (200x200 / 8 = 5000 bytes)
uint8_t imageBuffer[DISPLAY_WIDTH * DISPLAY_HEIGHT / 8];
bool hasImage = false;

// Function declarations
void initDisplay();
void drawTestScreen();
void drawDashboard();
bool fetchBitmap(int index, const char* mode);
bool fetchDashboard();
void drawSetupScreen();
void setupWiFi();
void resetWiFiSettings();
bool fetchImage(int index);
void drawImage();
void registerDevice();
void fetchDeviceSettings();
void toggleMode();
void advanceImage();
void setupSecureClient();
bool pollServerForInstructions();
void notifyServerModeChange(const char* mode);

// ============================================================
// SETUP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  
  Serial.println("\n========================================");
  Serial.println("  INKFRAME v1.0");
  Serial.println("  Waveshare ESP32 Driver Board");
  Serial.println("========================================");
  Serial.println("\n** Hold BOOT button now to reset WiFi **\n");
  
  // Check for WiFi reset
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  delay(100);
  
  if (digitalRead(BUTTON_PIN) == LOW) {
    Serial.println("!!! BOOT BUTTON HELD !!!");
    Serial.println("Resetting WiFi settings...");
    resetWiFiSettings();
    Serial.println("WiFi reset complete. Restarting...");
    delay(1000);
    ESP.restart();
  }
  
  // Initialize display
  initDisplay();
  
  // Draw test pattern
  Serial.println("\nDrawing test screen...");
  drawTestScreen();
  
  delay(2000);
  
  // Setup WiFi
  setupWiFi();
  
  Serial.println("\n========================================");
  Serial.println("Setup complete!");
  Serial.println("========================================");
}

// ============================================================
// LOOP - SERVER-DRIVEN POLLING
// The server tells us when to refresh, what mode to use, etc.
// ============================================================
void loop() {
  static unsigned long lastButtonPress = 0;

  // Check for button press (manual mode toggle)
  static bool lastButtonState = HIGH;
  bool currentButtonState = digitalRead(BUTTON_PIN);

  if (currentButtonState == LOW && lastButtonState == HIGH && millis() - lastButtonPress > 300) {
    lastButtonPress = millis();
    Serial.println("Button pressed - toggling mode");
    toggleMode();
    // Reset poll timer to allow immediate server sync
    lastPollTime = 0;
  }
  lastButtonState = currentButtonState;

  if (!wifiConnected) {
    delay(50);
    return;
  }

  // Server-driven polling
  // Poll interval is controlled by server (returned in 'n' field)
  unsigned long pollIntervalMs = (unsigned long)nextPollSeconds * 1000UL;

  if (millis() - lastPollTime > pollIntervalMs) {
    pollServerForInstructions();
    lastPollTime = millis();
  }

  delay(50);
}

// ============================================================
// TOGGLE MODE (BOOT button cycles: Dashboard -> Photos -> Dashboard)
// ============================================================
void toggleMode() {
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);

  if (currentMode == MODE_DASHBOARD) {
    // Try to switch to photo mode
    currentMode = MODE_IMAGE;
    Serial.println("Switching to PHOTO mode");

    // Notify server of mode change
    notifyServerModeChange("photo");

    if (fetchImage(currentImageIndex)) {
      drawImage();
    } else {
      Serial.println("No photos available, staying on dashboard");
      currentMode = MODE_DASHBOARD;
      notifyServerModeChange("dashboard");
      // Fetch server-rendered dashboard
      if (fetchDashboard()) {
        drawImage();
      } else {
        drawDashboard();  // Local fallback
      }
    }
  } else {
    // Switch back to dashboard mode
    currentMode = MODE_DASHBOARD;
    Serial.println("Switching to DASHBOARD mode");

    // Notify server of mode change
    notifyServerModeChange("dashboard");

    // Fetch server-rendered dashboard (with weather, calendar, todos)
    if (fetchDashboard()) {
      drawImage();
    } else {
      drawDashboard();  // Local fallback
    }
  }
}

// ============================================================
// NOTIFY SERVER OF MODE CHANGE
// ============================================================
void notifyServerModeChange(const char* mode) {
  HTTPClient http;
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  String url = String(API_SERVER) + "/api/device/" + deviceId + "/set-mode";

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);

  String payload = "{\"mode\":\"" + String(mode) + "\"}";
  int httpCode = http.POST(payload);

  if (httpCode == 200) {
    Serial.printf("Server mode updated to: %s\n", mode);
  } else {
    Serial.printf("Failed to update server mode: %d\n", httpCode);
  }

  http.end();
}

// ============================================================
// ADVANCE IMAGE
// ============================================================
void advanceImage() {
  if (totalImages <= 1) return;

  currentImageIndex = (currentImageIndex + 1) % totalImages;
  Serial.printf("Advancing to image %d/%d\n", currentImageIndex + 1, totalImages);

  // Notify server
  HTTPClient http;
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  String url = String(API_SERVER) + "/api/device/" + deviceId + "/next-image";

  http.begin(secureClient, url);
  http.setTimeout(10000);
  http.POST("");
  http.end();

  // Fetch and display new image
  if (fetchImage(currentImageIndex)) {
    drawImage();
  }
}

// ============================================================
// HTTPS CLIENT HELPER
// ============================================================
void setupSecureClient() {
  // Skip certificate verification (required for ESP32 to connect to HTTPS)
  secureClient.setInsecure();
}

// ============================================================
// REGISTER DEVICE
// ============================================================
void registerDevice() {
  Serial.println("\n--- REGISTERING DEVICE ---");

  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("Device ID: %s\n", deviceId.c_str());
  Serial.printf("Server: %s\n", API_SERVER);

  // Test basic connectivity first
  Serial.println("Testing HTTPS connection...");

  HTTPClient http;
  String testUrl = String(API_SERVER) + "/api/health";

  http.begin(secureClient, testUrl);
  http.setTimeout(15000);

  int testCode = http.GET();
  if (testCode == 200) {
    Serial.println("Server reachable! Health check OK.");
    Serial.println(http.getString());
  } else if (testCode < 0) {
    Serial.printf("HTTPS FAILED: %s\n", http.errorToString(testCode).c_str());
    Serial.println("Check: 1) WiFi connected 2) DNS working 3) Server online");
    http.end();
    return;
  } else {
    Serial.printf("Health check returned: %d\n", testCode);
  }
  http.end();

  // Now register
  Serial.println("\nSending registration...");
  String url = String(API_SERVER) + "/api/devices/register";

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  JsonDocument doc;
  doc["deviceId"] = deviceId;
  doc["displayType"] = "154_BW";
  doc["firmwareVersion"] = "1.0.0";

  String payload;
  serializeJson(doc, payload);
  Serial.printf("Payload: %s\n", payload.c_str());

  int httpCode = http.POST(payload);

  if (httpCode == 200 || httpCode == 201) {
    Serial.println("SUCCESS! Device registered.");
    Serial.println(http.getString());
  } else if (httpCode < 0) {
    Serial.printf("CONNECTION ERROR: %s\n", http.errorToString(httpCode).c_str());
  } else {
    Serial.printf("SERVER ERROR: HTTP %d\n", httpCode);
    Serial.println(http.getString());
  }

  http.end();
  Serial.println("--- REGISTRATION COMPLETE ---\n");
}

// ============================================================
// FETCH DEVICE SETTINGS
// ============================================================
void fetchDeviceSettings() {
  HTTPClient http;
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  String url = String(API_SERVER) + "/api/device/" + deviceId + "/image-info";

  http.begin(secureClient, url);
  http.setTimeout(10000);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      totalImages = doc["total"] | 0;
      currentImageIndex = doc["currentIndex"] | 0;
      int rotateMinutes = doc["rotateMinutes"] | 60;
      imageRotateInterval = rotateMinutes * 60 * 1000UL;

      Serial.printf("Settings: %d images, current: %d, rotate every %d min\n",
                    totalImages, currentImageIndex, rotateMinutes);
    }
  } else {
    Serial.printf("Failed to fetch settings: %d\n", httpCode);
  }

  http.end();
}

// ============================================================
// POLL SERVER FOR INSTRUCTIONS (Server-driven logic)
// This is the main polling function - server tells us what to do
// ============================================================
bool pollServerForInstructions() {
  Serial.println("Polling server for instructions...");

  HTTPClient http;
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);

  // Build URL with current state so server can compare
  String url = String(API_SERVER) + "/api/device/" + deviceId + "/poll";
  url += "?v=" + String(serverRefreshVersion);
  url += "&m=" + String(currentMode == MODE_DASHBOARD ? "dashboard" : "photo");
  url += "&i=" + String(currentImageIndex);

  http.begin(secureClient, url);
  http.setTimeout(10000);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String response = http.getString();
    Serial.printf("Poll response: %s\n", response.c_str());

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      bool shouldRefresh = doc["r"] | false;
      const char* mode = doc["m"] | "dashboard";
      int newVersion = doc["v"] | 0;
      int newPollSeconds = doc["n"] | 30;
      int newIndex = doc["i"] | 0;
      int newTotal = doc["t"] | 0;

      Serial.printf("Poll result: refresh=%d, mode=%s, ver=%d, next=%ds, idx=%d/%d\n",
                    shouldRefresh, mode, newVersion, newPollSeconds, newIndex, newTotal);

      // Update local state from server
      serverRefreshVersion = newVersion;
      nextPollSeconds = newPollSeconds;
      totalImages = newTotal;

      // Determine if mode changed
      DisplayMode newMode = (strcmp(mode, "photo") == 0) ? MODE_IMAGE : MODE_DASHBOARD;
      bool modeChanged = (newMode != currentMode);

      // Update image index if changed
      bool indexChanged = (newIndex != currentImageIndex);
      currentImageIndex = newIndex;

      // Refresh display if server says so, or mode/index changed
      if (shouldRefresh || modeChanged || indexChanged) {
        currentMode = newMode;
        http.end();

        Serial.printf("Refreshing display (reason: refresh=%d, modeChange=%d, indexChange=%d)\n",
                      shouldRefresh, modeChanged, indexChanged);

        // Fetch and display new content based on mode
        if (currentMode == MODE_DASHBOARD) {
          if (fetchDashboard()) {
            drawImage();
          } else {
            drawDashboard();  // Local fallback
          }
        } else {
          if (totalImages > 0 && fetchImage(currentImageIndex)) {
            drawImage();
          } else {
            // No images, fall back to dashboard
            currentMode = MODE_DASHBOARD;
            if (fetchDashboard()) {
              drawImage();
            } else {
              drawDashboard();
            }
          }
        }
        return true;
      }
    } else {
      Serial.printf("JSON parse error: %s\n", error.c_str());
    }
  } else if (httpCode == 404) {
    Serial.println("Device not found on server");
  } else {
    Serial.printf("Poll failed: %d\n", httpCode);
  }

  http.end();
  return false;
}

// ============================================================
// FETCH IMAGE (supports both photo and dashboard mode)
// ============================================================
bool fetchImage(int index) {
  return fetchBitmap(index, "photo");
}

bool fetchDashboard() {
  return fetchBitmap(0, "dashboard");
}

bool fetchBitmap(int index, const char* mode) {
  Serial.printf("Fetching %s (index %d)...\n", mode, index);

  HTTPClient http;
  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  String url = String(API_SERVER) + "/api/device/" + deviceId + "/bitmap?index=" + String(index) + "&mode=" + String(mode);

  http.begin(secureClient, url);
  http.setTimeout(15000);  // 15 second timeout

  // Collect headers including new X-Content-Type
  const char* headerKeys[] = {"X-Image-Total", "X-Image-Index", "X-Image-Width", "X-Image-Height", "X-Content-Type"};
  http.collectHeaders(headerKeys, 5);

  int httpCode = http.GET();

  if (httpCode == 200) {
    int len = http.getSize();
    int expectedSize = DISPLAY_WIDTH * DISPLAY_HEIGHT / 8;

    // Get metadata from headers
    if (http.hasHeader("X-Image-Total")) {
      totalImages = http.header("X-Image-Total").toInt();
      Serial.printf("Total images: %d\n", totalImages);
    }

    if (http.hasHeader("X-Content-Type")) {
      String contentType = http.header("X-Content-Type");
      Serial.printf("Content type: %s\n", contentType.c_str());
    }

    if (len == expectedSize || len == -1) {  // -1 means chunked/unknown
      WiFiClient* stream = http.getStreamPtr();
      int bytesRead = 0;
      unsigned long startTime = millis();

      while (http.connected() && bytesRead < expectedSize && (millis() - startTime < 10000)) {
        if (stream->available()) {
          int toRead = min(stream->available(), expectedSize - bytesRead);
          int c = stream->read(imageBuffer + bytesRead, toRead);
          if (c > 0) bytesRead += c;
        }
        delay(1);
      }

      if (bytesRead == expectedSize) {
        Serial.printf("Bitmap received: %d bytes\n", bytesRead);
        hasImage = true;
        http.end();
        return true;
      } else {
        Serial.printf("Incomplete read: got %d, expected %d\n", bytesRead, expectedSize);
      }
    } else {
      Serial.printf("Wrong size: got %d, expected %d\n", len, expectedSize);
    }
  } else if (httpCode == 404) {
    Serial.println("No content available on server");
    totalImages = 0;
  } else {
    Serial.printf("HTTP error: %d\n", httpCode);
  }

  http.end();
  return false;
}

// ============================================================
// DRAW IMAGE
// ============================================================
void drawImage() {
  if (!hasImage) return;

  Serial.println("Drawing image...");

  display.setRotation(0);
  display.setFullWindow();

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    // Draw the bitmap from buffer
    // The buffer is packed 1-bit (8 pixels per byte, MSB first)
    for (int y = 0; y < DISPLAY_HEIGHT; y++) {
      for (int x = 0; x < DISPLAY_WIDTH; x++) {
        int byteIndex = (y * DISPLAY_WIDTH + x) / 8;
        int bitIndex = 7 - ((y * DISPLAY_WIDTH + x) % 8);
        bool isWhite = (imageBuffer[byteIndex] >> bitIndex) & 1;

        if (!isWhite) {
          display.drawPixel(x, y, GxEPD_BLACK);
        }
      }
    }
  } while (display.nextPage());

  Serial.println("Image displayed!");
}

// ============================================================
// RESET WIFI
// ============================================================
void resetWiFiSettings() {
  // Clear WiFiManager settings
  wifiManager.resetSettings();
  
  // Clear ESP32 WiFi credentials
  WiFi.disconnect(true, true);
  
  // Clear preferences
  preferences.begin("inkframe", false);
  preferences.clear();
  preferences.end();
  
  Serial.println("All settings cleared!");
}

// ============================================================
// DISPLAY INIT
// ============================================================
void initDisplay() {
  Serial.println("Initializing display...");
  Serial.printf("  Using HSPI - SCK:%d, MOSI:%d\n", EPD_SCK, EPD_MOSI);
  
  // Start HSPI with custom pins
  hspi.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  
  // Configure display to use HSPI
  display.epd2.selectSPI(hspi, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  
  // Initialize display
  // Parameters: debug_speed, initial, reset_duration_ms, pulldown_rst
  display.init(115200, true, 20, false);
  
  Serial.println("Display initialized!");
  Serial.printf("  BUSY pin: %s\n", digitalRead(EPD_BUSY) ? "HIGH" : "LOW");
}

// ============================================================
// TEST SCREEN
// ============================================================
void drawTestScreen() {
  Serial.println("  Drawing test pattern...");
  
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFullWindow();
  
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    
    // Double border
    display.drawRect(0, 0, 200, 200, GxEPD_BLACK);
    display.drawRect(4, 4, 192, 192, GxEPD_BLACK);
    
    // Title
    display.setFont(&FreeSansBold12pt7b);
    display.setCursor(30, 40);
    display.print("INKFRAME");
    
    // Separator
    display.fillRect(20, 55, 160, 2, GxEPD_BLACK);
    
    // Status text
    display.setFont(&FreeSans9pt7b);
    display.setCursor(20, 85);
    display.print("Display: OK!");
    
    display.setCursor(20, 110);
    display.print("Resolution: 200x200");
    
    display.setCursor(20, 135);
    display.print("Driver Board: OK");
    
    // Separator
    display.fillRect(20, 150, 160, 2, GxEPD_BLACK);
    
    // Test shapes
    display.fillRect(30, 165, 20, 20, GxEPD_BLACK);
    display.drawRect(60, 165, 20, 20, GxEPD_BLACK);
    display.fillCircle(105, 175, 10, GxEPD_BLACK);
    display.drawCircle(140, 175, 10, GxEPD_BLACK);
    display.drawTriangle(165, 185, 175, 165, 185, 185, GxEPD_BLACK);
    
  } while (display.nextPage());
  
  Serial.println("  Test screen complete!");
}

// ============================================================
// WIFI SETUP
// ============================================================
void setupWiFi() {
  Serial.println("\nConfiguring WiFi...");
  
  // Show setup screen
  drawSetupScreen();
  
  // Configure WiFiManager
  wifiManager.setConfigPortalTimeout(180);  // 3 min timeout
  wifiManager.setConnectTimeout(30);        // 30 sec connect timeout
  wifiManager.setDebugOutput(true);
  
  // Custom AP name
  String apName = "InkFrame-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  
  Serial.printf("Starting WiFi manager (AP: %s)...\n", apName.c_str());
  
  if (wifiManager.autoConnect(apName.c_str())) {
    Serial.println("\n*** WiFi Connected! ***");
    Serial.printf("SSID: %s\n", WiFi.SSID().c_str());
    Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("Signal: %d dBm\n", WiFi.RSSI());

    wifiConnected = true;

    // Setup secure client for HTTPS
    setupSecureClient();

    // Register device with server
    registerDevice();

    // Fetch settings (for backward compatibility)
    fetchDeviceSettings();

    // Initial poll to get server instructions and display content
    // Server will tell us what mode to use and whether to refresh
    Serial.println("Initial server poll...");
    if (!pollServerForInstructions()) {
      // Polling failed, show local dashboard as fallback
      currentMode = MODE_DASHBOARD;
      drawDashboard();
    }

    // Set initial poll time so next poll happens after configured interval
    lastPollTime = millis();
  } else {
    Serial.println("\nWiFi connection failed or timed out.");
    Serial.println("Device will work in offline mode.");
    wifiConnected = false;
    
    // Show error on display
    display.setFullWindow();
    display.firstPage();
    do {
      display.fillScreen(GxEPD_WHITE);
      display.setFont(&FreeSansBold12pt7b);
      display.setCursor(20, 80);
      display.print("WiFi Failed");
      display.setFont(&FreeSans9pt7b);
      display.setCursor(20, 120);
      display.print("Hold BOOT + RST");
      display.setCursor(20, 145);
      display.print("to reset WiFi");
    } while (display.nextPage());
  }
}

// ============================================================
// SETUP SCREEN
// ============================================================
void drawSetupScreen() {
  Serial.println("  Drawing setup screen...");
  
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFullWindow();
  
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    
    // Border
    display.drawRect(5, 5, 190, 190, GxEPD_BLACK);
    
    // Title
    display.setFont(&FreeSansBold12pt7b);
    display.setCursor(25, 40);
    display.print("WiFi Setup");
    
    display.fillRect(20, 50, 160, 2, GxEPD_BLACK);
    
    // Instructions
    display.setFont(&FreeSans9pt7b);
    display.setCursor(15, 80);
    display.print("On your phone:");
    
    display.setCursor(15, 105);
    display.print("1. Open WiFi");
    
    display.setCursor(15, 125);
    display.print("2. Connect to:");
    
    display.setFont(&FreeMonoBold9pt7b);
    display.setCursor(15, 148);
    display.print("InkFrame-xxx");
    
    display.setFont(&FreeSans9pt7b);
    display.setCursor(15, 175);
    display.print("3. Follow prompts");
    
  } while (display.nextPage());
}

// ============================================================
// DASHBOARD
// ============================================================
void drawDashboard() {
  Serial.println("Drawing dashboard...");

  String deviceId = String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("Device ID: %s\n", deviceId.c_str());

  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFullWindow();

  // Calculate uptime
  unsigned long secs = millis() / 1000;
  int hrs = secs / 3600;
  int mins = (secs % 3600) / 60;

  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    // Border
    display.drawRect(2, 2, 196, 196, GxEPD_BLACK);

    // Title
    display.setFont(&FreeSansBold12pt7b);
    display.setCursor(35, 28);
    display.print("INKFRAME");

    // Separator
    display.fillRect(20, 38, 160, 2, GxEPD_BLACK);

    // Device ID - IMPORTANT for linking
    display.setFont(&FreeSans9pt7b);
    display.setCursor(15, 58);
    display.print("Device ID:");
    display.setFont(&FreeMonoBold9pt7b);
    display.setCursor(15, 76);
    display.print(deviceId);

    // Separator
    display.fillRect(20, 86, 160, 2, GxEPD_BLACK);

    // WiFi info
    display.setFont(&FreeSans9pt7b);
    if (wifiConnected) {
      display.setCursor(15, 106);
      display.print(WiFi.localIP().toString());
      display.setCursor(15, 124);
      display.printf("Signal: %d dBm", WiFi.RSSI());
    } else {
      display.setCursor(15, 115);
      display.print("WiFi: Offline");
    }

    // Separator
    display.fillRect(20, 134, 160, 2, GxEPD_BLACK);

    // Images info
    display.setCursor(15, 154);
    if (totalImages > 0) {
      display.printf("Images: %d", totalImages);
      display.setCursor(15, 172);
      display.print("BTN = show art");
    } else {
      display.print("No images yet");
      display.setCursor(15, 172);
      display.print("Link device in app");
    }

    // Footer
    display.fillRect(20, 182, 160, 2, GxEPD_BLACK);
    display.setCursor(15, 198);
    char uptimeStr[20];
    sprintf(uptimeStr, "Up: %02d:%02d", hrs, mins);
    display.print(uptimeStr);

  } while (display.nextPage());

  Serial.println("Dashboard complete!");
}
