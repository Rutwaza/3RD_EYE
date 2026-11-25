// Basic HTTP MJPEG streamer for the common AI-Thinker ESP32-CAM (OV2640).
// The stream URL is http://<device-ip>/stream
#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

const char *WIFI_SSID = "YOUR_WIFI_NAME";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// AI-Thinker ESP32-CAM camera pins.
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

static const char *BOUNDARY = "\r\n--face-map-frame\r\n";
static httpd_handle_t cameraHttpd = nullptr;

static esp_err_t rootHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/plain; charset=utf-8");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, "ESP32-CAM ready. MJPEG stream: /stream\n", HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=face-map-frame");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store, no-cache, must-revalidate");

  char partHeader[96];
  while (true) {
    camera_fb_t *frame = esp_camera_fb_get();
    if (!frame) return ESP_FAIL;

    esp_err_t result = httpd_resp_send_chunk(req, BOUNDARY, strlen(BOUNDARY));
    if (result == ESP_OK) {
      const int headerLength = snprintf(
          partHeader, sizeof(partHeader),
          "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
          static_cast<unsigned int>(frame->len));
      result = httpd_resp_send_chunk(req, partHeader, headerLength);
    }
    if (result == ESP_OK)
      result = httpd_resp_send_chunk(req, reinterpret_cast<const char *>(frame->buf), frame->len);
    esp_camera_fb_return(frame);
    if (result != ESP_OK) break; // Browser disconnected or stopped the stream.
  }
  return ESP_OK;
}

static void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  config.max_uri_handlers = 4;
  config.max_open_sockets = 4;

  if (httpd_start(&cameraHttpd, &config) != ESP_OK) {
    Serial.println("Could not start HTTP server");
    return;
  }
  httpd_uri_t rootUri = {};
  rootUri.uri = "/";
  rootUri.method = HTTP_GET;
  rootUri.handler = rootHandler;
  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;
  httpd_register_uri_handler(cameraHttpd, &rootUri);
  httpd_register_uri_handler(cameraHttpd, &streamUri);
}

void setup() {
  Serial.begin(115200);
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA; // 640x480: enough for Face Map's 224px minimum face box.
  config.jpeg_quality = 18; // Higher number means smaller JPEGs and less work.
  config.jpeg_buffer_size = 300000;
  config.fb_count = 1; // Start conservatively to reduce camera and memory pressure.
  config.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  const esp_err_t cameraResult = esp_camera_init(&config);
  if (cameraResult != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", cameraResult);
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  startCameraServer();
  Serial.print("Open http://");
  Serial.print(WiFi.localIP());
  Serial.println("/stream");
}

void loop() { delay(1000); }
