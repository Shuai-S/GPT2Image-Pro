package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"
	stdhttp "net/http"
)

const (
	defaultBind        = ":3021"
	defaultProfile     = "chrome_146"
	defaultTimeoutSecs = 300
	defaultIdleTTL     = 30 * time.Minute
	defaultMaxBodyMB   = 32
	chatGPTOrigin      = "https://chatgpt.com"
)

type requestPayload struct {
	SessionKey string            `json:"sessionKey"`
	Method     string            `json:"method"`
	URLPath    string            `json:"urlPath"`
	TargetPath string            `json:"targetPath"`
	// TargetURL 为可选的绝对 URL（https）。设置后走主机白名单转发（用于 Adobe Firefly
	// 等多主机直连）；未设置时回落到 URLPath + chatgpt.com（保持原 ChatGPT Web 行为）。
	TargetURL  string            `json:"targetUrl"`
	Headers    map[string]string `json:"headers"`
	HeaderOrder []string         `json:"headerOrder"`
	BodyBase64 string            `json:"bodyBase64"`
}

type responsePayload struct {
	Status     int                 `json:"status"`
	Headers    map[string][]string `json:"headers"`
	BodyBase64 string              `json:"bodyBase64"`
}

type sessionClient struct {
	client   tls_client.HttpClient
	lastUsed time.Time
}

type server struct {
	secret        string
	profileName   string
	timeoutSecs   int
	upstreamProxy string
	maxBodyBytes  int64

	mu      sync.Mutex
	clients map[string]*sessionClient
}

func main() {
	s := &server{
		secret:        strings.TrimSpace(os.Getenv("CHATGPT_WEB_PROXY_SECRET")),
		profileName:   envString("CHATGPT_WEB_PROXY_PROFILE", defaultProfile),
		timeoutSecs:   envInt("CHATGPT_WEB_PROXY_TIMEOUT_SECONDS", defaultTimeoutSecs),
		upstreamProxy: strings.TrimSpace(os.Getenv("CHATGPT_WEB_UPSTREAM_PROXY_URL")),
		maxBodyBytes:  int64(envInt("CHATGPT_WEB_PROXY_MAX_BODY_MB", defaultMaxBodyMB)) * 1024 * 1024,
		clients:       map[string]*sessionClient{},
	}

	go s.cleanupLoop()

	mux := stdhttp.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/request", s.handleRequest)

	bind := envString("CHATGPT_WEB_PROXY_BIND", defaultBind)
	log.Printf("chatgpt-web-proxy listening on %s profile=%s", bind, s.profileName)
	if err := stdhttp.ListenAndServe(bind, mux); err != nil {
		log.Fatal(err)
	}
}

func envString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func (s *server) handleHealth(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleRequest(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if r.Method != stdhttp.MethodPost {
		writeError(w, stdhttp.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if s.secret != "" && r.Header.Get("X-Proxy-Secret") != s.secret {
		writeError(w, stdhttp.StatusUnauthorized, "unauthorized")
		return
	}

	defer r.Body.Close()
	var payload requestPayload
	if err := json.NewDecoder(stdhttp.MaxBytesReader(w, r.Body, 8*1024*1024)).Decode(&payload); err != nil {
		writeError(w, stdhttp.StatusBadRequest, "invalid request payload")
		return
	}

	result, err := s.forward(payload)
	if err != nil {
		writeError(w, stdhttp.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (s *server) forward(payload requestPayload) (*responsePayload, error) {
	var targetURL string
	var err error
	if strings.TrimSpace(payload.TargetURL) != "" {
		targetURL, err = buildAllowlistedURL(payload.TargetURL)
	} else {
		targetURL, err = buildTargetURL(payload.URLPath)
	}
	if err != nil {
		return nil, err
	}

	method := strings.ToUpper(strings.TrimSpace(payload.Method))
	if method == "" {
		method = fhttp.MethodGet
	}

	body, err := decodeBody(payload.BodyBase64)
	if err != nil {
		return nil, err
	}

	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}

	req, err := fhttp.NewRequest(method, targetURL, reader)
	if err != nil {
		return nil, err
	}
	applyHeaders(req, payload.Headers, payload.HeaderOrder)

	client, err := s.getClient(payload.SessionKey)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := readLimited(resp.Body, s.maxBodyBytes)
	if err != nil {
		return nil, err
	}

	return &responsePayload{
		Status:     resp.StatusCode,
		Headers:    mapHeaders(resp.Header),
		BodyBase64: base64.StdEncoding.EncodeToString(responseBody),
	}, nil
}

func buildTargetURL(urlPath string) (string, error) {
	if !strings.HasPrefix(urlPath, "/") || strings.HasPrefix(urlPath, "//") {
		return "", errors.New("urlPath must be an absolute path")
	}
	parsed, err := url.Parse(chatGPTOrigin + urlPath)
	if err != nil {
		return "", fmt.Errorf("invalid urlPath: %w", err)
	}
	if parsed.Scheme != "https" || parsed.Host != "chatgpt.com" {
		return "", errors.New("only https://chatgpt.com requests are allowed")
	}
	return parsed.String(), nil
}

// buildAllowlistedURL 校验绝对 URL：必须 https，且主机在白名单内（chatgpt.com 或 Adobe
// 系域名）。用于 Adobe Firefly 直连的多主机转发（firefly-3p / IMS / platform-cs 等）。
func buildAllowlistedURL(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("invalid targetUrl: %w", err)
	}
	if parsed.Scheme != "https" {
		return "", errors.New("only https targetUrl is allowed")
	}
	if !isAllowlistedHost(parsed.Hostname()) {
		return "", fmt.Errorf("host not allowlisted: %s", parsed.Hostname())
	}
	return parsed.String(), nil
}

func isAllowlistedHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if host == "chatgpt.com" {
		return true
	}
	// Adobe 系域名（含子域）。
	suffixes := []string{".adobe.io", ".adobe.com", ".adobelogin.com"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func decodeBody(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	body, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, errors.New("bodyBase64 is invalid")
	}
	return body, nil
}

func applyHeaders(req *fhttp.Request, headers map[string]string, order []string) {
	req.Header = fhttp.Header{}
	for key, value := range headers {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" || shouldSkipHeader(trimmedKey) {
			continue
		}
		req.Header.Set(trimmedKey, value)
	}
	if len(order) > 0 {
		headerOrder := make([]string, 0, len(order))
		for _, key := range order {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" || shouldSkipHeader(trimmedKey) {
				continue
			}
			headerOrder = append(headerOrder, strings.ToLower(trimmedKey))
		}
		if len(headerOrder) > 0 {
			req.Header[fhttp.HeaderOrderKey] = headerOrder
		}
	}
}

func shouldSkipHeader(key string) bool {
	switch strings.ToLower(key) {
	case "host", "content-length", "connection":
		return true
	default:
		return false
	}
}

func (s *server) getClient(sessionKey string) (tls_client.HttpClient, error) {
	key := strings.TrimSpace(sessionKey)
	if key == "" {
		key = "default"
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if existing := s.clients[key]; existing != nil {
		existing.lastUsed = time.Now()
		return existing.client, nil
	}

	profile, ok := profiles.MappedTLSClients[s.profileName]
	if !ok {
		return nil, fmt.Errorf("unknown tls-client profile: %s", s.profileName)
	}

	options := []tls_client.HttpClientOption{
		tls_client.WithTimeoutSeconds(s.timeoutSecs),
		tls_client.WithClientProfile(profile),
		tls_client.WithCookieJar(tls_client.NewCookieJar()),
		tls_client.WithDisableHttp3(),
		tls_client.WithCatchPanics(),
	}
	if s.upstreamProxy != "" {
		options = append(options, tls_client.WithProxyUrl(s.upstreamProxy))
	}

	client, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(), options...)
	if err != nil {
		return nil, err
	}

	s.clients[key] = &sessionClient{client: client, lastUsed: time.Now()}
	return client, nil
}

func (s *server) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		for key, item := range s.clients {
			if time.Since(item.lastUsed) > defaultIdleTTL {
				item.client.CloseIdleConnections()
				delete(s.clients, key)
			}
		}
		s.mu.Unlock()
	}
}

func readLimited(reader io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("upstream response body is too large")
	}
	return data, nil
}

func mapHeaders(headers fhttp.Header) map[string][]string {
	result := make(map[string][]string, len(headers))
	for key, values := range headers {
		if strings.EqualFold(key, fhttp.HeaderOrderKey) {
			continue
		}
		copied := make([]string, len(values))
		copy(copied, values)
		result[key] = copied
	}
	return result
}

func writeJSON(w stdhttp.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("write json failed: %v", err)
	}
}

func writeError(w stdhttp.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
